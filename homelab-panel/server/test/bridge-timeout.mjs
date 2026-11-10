// ---------------------------------------------------------------------------
//  مهلتِ پلِ پنل ⇒ سرورِ حساب (۱.۵۰.۷۵، ممیزی §۹ «باقی‌مانده»)
//      node test/bridge-timeout.mjs
//
//  تا ۱.۵۰.۷۴ درخواست‌های پل مهلتِ خودشان را نداشتند و فقط مهلتِ پیش‌فرضِ fetch ِ Node (≈۵ دقیقه) بود ⇒
//  سرورِ حسابِ گیر کرده هر صفحه را پنج دقیقه نگه می‌داشت، و پشتیبانِ کُند «شکست» نشان داده می‌شد با این‌که
//  شاید ساخته شده بود. این آزمون با مهلت‌های کوتاهِ آزمون (‎HLP_BRIDGE_TIMEOUT_MS‎، ‎HLP_BRIDGE_LONG_TIMEOUT_MS‎) می‌سنجد:
//    • خواندنِ گیرکرده (چه پیش از سرآیند، چه وسطِ بدنه) ⇒ ‎504 account_server_timeout‎ در مهلت — نه «{}» ِ موفق
//    • نوشتنِ گیرکرده ⇒ ‎504 outcome_unknown‎ («معلوم نیست؛ پیش از تکرار ببینید») — هرگز «شکست»، و یک ردیفِ دفتر
//    • نوشتنِ گیرکرده دوباره خودکار فرستاده نمی‌شود (یک درخواست به سرورِ حساب)
//    • پشتیبان مهلتِ بلندِ خودش را دارد؛ بیش از آن ⇒ نامعلوم، همان کلید ⇒ همان پاسخ بی pg_dump ِ دوم،
//      کلیدِ تازه تا پایانِ پنجرهٔ ته‌نشینی ⇒ ‎409 backup_outcome_unknown‎، پس از آن دوباره آزاد
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4987);
const SHORT = 500;
const LONG = 1500;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bridge-timeout-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی که می‌تواند گیر کند ───────────── */
const NOW = Date.now();
const seen = [];
const hang = { get: false, post: false, bodyGet: false, bodyPost: false, drop: false };
let backupDelay = 0;
const held = new Set();
const fake = http.createServer((req, res) => {
  held.add(res);
  res.on('close', () => held.delete(res));
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['actor.v1', 'ops.v1'], serverTime: NOW });
    seen.push({ method: req.method, path: p });
    //  گیر پیش از سرآیند: هیچ پاسخی نمی‌آید
    if (p === '/api/admin/backups' && req.method === 'GET' && hang.get) return;
    if (/\/notes$/.test(p) && hang.post) return;
    //  اتصال وسطِ کار می‌افتد (درخواست رسید، پاسخی نه)
    if (p === '/api/admin/ops/incidents/inc_drop/notes' || (p === '/api/admin/backups' && req.method === 'GET' && hang.drop)) return void req.socket.destroy();
    //  گیر وسطِ بدنه: سرآیندِ ۲۰۰ و نیمی از JSON، بعد هیچ
    if (p === '/api/admin/ops/incidents' && hang.bodyGet) { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"incidents":['); return; }
    if (p === '/api/admin/ops/alerts/evaluate' && hang.bodyPost) { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"evaluatedAt":'); return; }
    if (p === '/api/admin/backups' && req.method === 'GET') return j(200, { backups: [], enabled: true, encryption: { configured: true } });
    if (p === '/api/admin/backups' && req.method === 'POST') {
      return void setTimeout(() => j(201, { file: '/srv/b/shop-manual-x.sql.gz', bytes: 10, kind: 'manual', createdAt: Date.now(), encrypted: true, sha256: 'ab'.repeat(32) }), backupDelay);
    }
    if (p === '/api/admin/ops/incidents') return j(200, { incidents: [], total: 0, limit: 200, offset: 0, counts: {} });
    if (p === '/api/admin/ops/alerts/evaluate') return j(200, { evaluatedAt: NOW, rules: [] });
    if (/\/notes$/.test(p)) return j(201, { ok: true });
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

/* ───────────── پنلِ واقعی با مهلت‌های کوتاهِ آزمون ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: FAKE_URL, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_BRIDGE_TIMEOUT_MS: String(SHORT), HLP_BRIDGE_LONG_TIMEOUT_MS: String(LONG),
         HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
//  ⛔ مهلتِ سمتِ آزمون: پیش از اصلاح پل پنج دقیقه می‌ماند ⇒ آزمون باید سرخ شود، نه گیر کند
async function api(method, p, body, headers = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(6000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, json: null, text: String(e?.name || e), ms: Date.now() - t0 };
  }
}
const count = (m, p) => seen.filter((s) => s.method === m && s.path === p).length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Tmo-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Tmo-1405-owner');
  const H = (t) => ({ Authorization: `Bearer ${t}` });
  await api('POST', '/api/auth/users', { username: 'op1', password: 'Tmo-operator-1405', role: 'operator' }, H(owner));
  const op = await login('op1', 'Tmo-operator-1405');

  const warm = await api('GET', '/api/account-admin/console/backups', undefined, H(owner));
  check('پیش‌زمینه: پل سالم کار می‌کند', warm.status === 200, `${warm.status} ${warm.text.slice(0, 200)}`);

  /* ── خواندن ── */
  hang.get = true;
  const g = await api('GET', '/api/account-admin/console/backups', undefined, H(owner));
  hang.get = false;
  check('⛔ خواندنِ گیرکرده ⇒ ‎504 account_server_timeout‎ در مهلت (نه ۵ دقیقه)',
    g.status === 504 && g.json?.error === 'account_server_timeout' && g.ms < SHORT + 2500, `${g.status} ${g.json?.error} ${g.ms}ms`);
  check('خواندنِ گیرکرده «نامعلوم» نیست (خواندن تکرارپذیر است)', g.json?.outcome !== 'unknown', g.text.slice(0, 200));

  hang.bodyGet = true;
  const gb = await api('GET', '/api/account-admin/console/ops/incidents', undefined, H(owner));
  hang.bodyGet = false;
  check('⛔ بدنهٔ نیمه‌کاره ⇒ ‎504‎، نه «{}» ِ موفق', gb.status === 504 && gb.json?.error === 'account_server_timeout', `${gb.status} ${gb.text.slice(0, 200)}`);

  /* ── نوشتن ── */
  hang.post = true;
  const before = count('POST', '/api/admin/ops/incidents/inc_1/notes');
  const n = await api('POST', '/api/account-admin/console/ops/incidents/inc_1/notes', { note: 'یادداشتِ آزمون', idempotencyKey: 'note-key-00000001' }, H(op));
  hang.post = false;
  check('⛔ نوشتنِ گیرکرده ⇒ ‎504 outcome_unknown‎ و ‎outcome: "unknown"‎ — نه «شکست»',
    n.status === 504 && n.json?.error === 'outcome_unknown' && n.json?.outcome === 'unknown' && n.ms < SHORT + 2500, `${n.status} ${n.text.slice(0, 200)} ${n.ms}ms`);
  check('پیام: «معلوم نیست… پیش از تکرار ببینید»، نه «نشد/شکست»',
    /معلوم نیست/.test(n.json?.message || '') && /پیش از/.test(n.json?.message || '') && !/شکست|نشد/.test(n.json?.message || ''), n.json?.message);
  await sleep(SHORT + 300);
  check('⛔ نوشتنِ گیرکرده خودکار دوباره فرستاده نشد', count('POST', '/api/admin/ops/incidents/inc_1/notes') === before + 1,
    `${count('POST', '/api/admin/ops/incidents/inc_1/notes') - before}`);

  const dr = await api('POST', '/api/account-admin/console/ops/incidents/inc_drop/notes', { note: 'یادداشتِ آزمون', idempotencyKey: 'note-key-00000002' }, H(op));
  check('⛔ نوشتن و افتادنِ اتصال وسطِ کار ⇒ «نامعلوم» (۵۰۲ outcome_unknown)، نه «سرورِ حساب خاموش است»',
    dr.status === 502 && dr.json?.error === 'outcome_unknown' && dr.json?.outcome === 'unknown' && /معلوم نیست/.test(dr.json?.message || ''), `${dr.status} ${dr.text.slice(0, 200)}`);
  hang.drop = true;
  const gd = await api('GET', '/api/account-admin/console/backups', undefined, H(owner));
  hang.drop = false;
  check('خواندن و افتادنِ اتصال ⇒ همان «در دسترس نیست» ِ پیشین (تکرارپذیر)', gd.status === 503 && gd.json?.error === 'account_server_down', `${gd.status} ${gd.json?.error}`);

  hang.bodyPost = true;
  const e = await api('POST', '/api/account-admin/console/ops/alerts/evaluate', {}, H(op));
  hang.bodyPost = false;
  check('⛔ نوشتن با بدنهٔ نیمه‌کاره ⇒ نامعلوم، نه «انجام شد» با ‎{}‎', e.status === 504 && e.json?.error === 'outcome_unknown', `${e.status} ${e.text.slice(0, 200)}`);

  const aud = await api('GET', '/api/control/audit?q=outcome_unknown&limit=20&offset=0', undefined, H(owner));
  const rows = (aud.json?.rows || []).filter((r) => r.action === 'account.bridge.outcome_unknown');
  check('هر نوشتنِ نامعلوم یک ردیف در دفترِ پنل (چه کسی، کدام در)', rows.length === 3 && rows.some((r) => r.actor === 'op1' && JSON.stringify(r).includes('/notes')),
    JSON.stringify(aud.json?.rows || aud.json).slice(0, 400));

  /* ── پشتیبان: مهلتِ بلند ── */
  const bk = (k) => ({ reason: 'آزمونِ مهلت', confirm: true, idempotencyKey: `tmo-backup-${k}-00001` });
  backupDelay = SHORT + 400;   //  بیش از مهلتِ کوتاه، کم‌تر از بلند
  const b1 = await api('POST', '/api/account-admin/console/backups', bk('a'), H(owner));
  check('پشتیبان مهلتِ بلندِ خودش را دارد: کُندتر از مهلتِ عادی ⇒ هنوز ‎201‎', b1.status === 201 && b1.json?.backup?.file === 'shop-manual-x.sql.gz', `${b1.status} ${b1.text.slice(0, 200)}`);

  backupDelay = LONG + 2000;   //  بیش از مهلتِ بلند
  const posts0 = count('POST', '/api/admin/backups');
  const b2 = await api('POST', '/api/account-admin/console/backups', bk('b'), H(owner));
  check('⛔ پشتیبانِ کُندتر از مهلتِ بلند ⇒ ‎504 outcome_unknown‎، نه «شکست»', b2.status === 504 && b2.json?.error === 'outcome_unknown' && b2.json?.outcome === 'unknown',
    `${b2.status} ${b2.text.slice(0, 200)}`);
  const b2again = await api('POST', '/api/account-admin/console/backups', bk('b'), H(owner));
  check('همان کلید دوباره ⇒ همان «نامعلوم»، بی pg_dump ِ دوم', b2again.status === 504 && b2again.json?.error === 'outcome_unknown' && count('POST', '/api/admin/backups') === posts0 + 1,
    `${b2again.status} ${b2again.json?.error} posts=${count('POST', '/api/admin/backups') - posts0}`);
  const b3 = await api('POST', '/api/account-admin/console/backups', bk('c'), H(owner));
  check('⛔ کلیدِ تازه درست پس از نامعلوم ⇒ ‎409 backup_outcome_unknown‎ (اول فهرست را ببینید)', b3.status === 409 && b3.json?.error === 'backup_outcome_unknown'
    && count('POST', '/api/admin/backups') === posts0 + 1, `${b3.status} ${b3.text.slice(0, 200)}`);
  const bAud = await api('GET', '/api/control/audit?q=account.backup&limit=20&offset=0', undefined, H(owner));
  check('دفترِ پنل: «account.backup.unknown» با دلیل', (bAud.json?.rows || []).some((r) => r.action === 'account.backup.unknown' && JSON.stringify(r).includes('آزمونِ مهلت')),
    JSON.stringify(bAud.json?.rows || []).slice(0, 300));
  const dup = await api('GET', '/api/control/audit?q=outcome_unknown&limit=50&offset=0', undefined, H(owner));
  check('پشتیبانِ نامعلوم یک ردیف دارد، نه دو (ردیفِ عمومیِ پل تکرار نمی‌شود)',
    !(dup.json?.rows || []).some((r) => r.action === 'account.bridge.outcome_unknown' && String(r.detail).includes('/api/admin/backups')), JSON.stringify(dup.json?.rows || []).slice(0, 300));
  await sleep(LONG + 300);
  backupDelay = 0;
  const b4 = await api('POST', '/api/account-admin/console/backups', bk('d'), H(owner));
  check('پس از پنجرهٔ ته‌نشینی، پشتیبانِ تازه دوباره آزاد است', b4.status === 201, `${b4.status} ${b4.text.slice(0, 200)}`);
  check('⛔ هیچ پوشهٔ میزبان در پاسخ‌ها', ![g, n, b2, b3, b4].some((r) => r.text.includes('/srv/b')), '');
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  for (const r of held) r.destroy();
  fake.close();
  await sleep(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
