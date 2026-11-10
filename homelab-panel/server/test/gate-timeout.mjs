// ---------------------------------------------------------------------------
//  مهلتِ «درِ مدیر» (‎src/api/admin-gate.js‎) هم‌راستا با مهلتِ پل (۱.۵۰.۷۶)
//      node test/gate-timeout.mjs
//
//  تا ۱.۵۰.۷۵ درِ مدیر (راهِ برنامهٔ ادمینِ اندروید از اینترنت) مهلتِ ثابتِ ۶۰ ثانیه‌ایِ خودش را داشت، در حالی که پلِ
//  پنل برای پشتیبانِ دستیِ سرورِ حساب ۲۷۰ ثانیه صبر می‌کند ⇒ پشتیبانِ کُند از راهِ در در ۶۰ ثانیه بریده می‌شد و
//  «‎502 gate_upstream‎» (شکست) می‌دید با این‌که شاید ساخته شده بود. با مهلت‌های کوتاهِ آزمون
//  (‎HLP_GATE_TIMEOUT_MS‎، ‎HLP_BRIDGE_LONG_TIMEOUT_MS‎) می‌سنجد:
//    • فقط ‎POST /api/account-admin/console/backups‎ مهلتِ بلندِ پل (+ حاشیه) را می‌گیرد ⇒ پاسخِ خودِ پنل از در می‌گذرد:
//      کُندتر از مهلتِ در ⇒ ‎201‎؛ کُندتر از مهلتِ بلندِ پل ⇒ همان ‎504 outcome_unknown‎ ِ پل، و همان کلید ⇒ بی pg_dump ِ دوم
//    • نوشتنِ دیگری که از مهلتِ در گذشت ⇒ ‎504 outcome_unknown‎ («معلوم نیست»)، نه «‎502 gate_upstream‎» + یک ردیفِ دفتر
//    • خواندنی که از مهلتِ در گذشت ⇒ ‎504 gate_timeout‎ (تکرارپذیر)، نه «نامعلوم»
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4993);
const PUBLIC = PANEL + 1;
const GATE = 600;          //  مهلتِ عادیِ در (به‌جای ۶۰ ثانیه)
const LONG = 1500;         //  مهلتِ بلندِ پل (به‌جای ۲۷۰ ثانیه)
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'gate-timeout-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی که می‌تواند گیر کند ───────────── */
const NOW = Date.now();
const seen = [];
const hang = { get: false, post: false };
let backupDelay = 0;
const held = new Set();
const fake = http.createServer((req, res) => {
  held.add(res);
  res.on('close', () => held.delete(res));
  req.resume();
  req.on('end', () => {
    const p = new URL(req.url, 'http://x').pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['actor.v1', 'ops.v1'], serverTime: NOW });
    seen.push({ method: req.method, path: p });
    if (p === '/api/admin/backups' && req.method === 'GET') return hang.get ? undefined : j(200, { backups: [], enabled: true, encryption: { configured: true } });
    if (p === '/api/admin/backups' && req.method === 'POST') {
      return void setTimeout(() => j(201, { file: '/srv/b/shop-manual-g.sql.gz', bytes: 10, kind: 'manual', createdAt: Date.now(), encrypted: true, sha256: 'cd'.repeat(32) }), backupDelay);
    }
    if (/\/notes$/.test(p)) return hang.post ? undefined : j(201, { ok: true });
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

/* ───────────── پنلِ واقعی (با درگاهِ عمومی، همان‌جا که درِ مدیر هست) ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  cwd: path.join(import.meta.dirname, '..'),
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_SITESYNC_PORT: String(PUBLIC), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: FAKE_URL, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_BRIDGE_TIMEOUT_MS: '4000', HLP_BRIDGE_LONG_TIMEOUT_MS: String(LONG), HLP_GATE_TIMEOUT_MS: String(GATE),
         HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
//  ⛔ مهلتِ سمتِ آزمون: پیش از اصلاح هم آزمون باید سرخ شود، نه گیر کند
async function call(base, method, p, body, headers = {}) {
  const t0 = Date.now();
  try {
    const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json, text, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, json: null, text: String(e?.name || e), ms: Date.now() - t0 };
  }
}
const count = (m, p) => seen.filter((s) => s.method === m && s.path === p).length;

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PANEL}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  const inside = (m, p, b, h) => call(`http://127.0.0.1:${PANEL}`, m, p, b, h);
  await inside('POST', '/api/auth/setup', { username: 'owner', password: 'Gate-1405-owner' });
  const token = (await inside('POST', '/api/auth/login', { username: 'owner', password: 'Gate-1405-owner' })).json?.token;
  const auth = { Authorization: `Bearer ${token}` };
  const issued = await inside('POST', '/api/settings/remote/device', { deviceId: 'phone-gt', name: 'گوشیِ آزمون' }, auth);
  const key = issued.json?.key;
  check('پیش‌زمینه: کلیدِ در از داخل صادر شد', typeof key === 'string' && key.length >= 40, issued.text.slice(0, 200));
  const gate = (m, p, b) => call(`http://127.0.0.1:${PUBLIC}`, m, `/api/admin-gate${p}`, b, { ...auth, 'x-admin-gate': key });

  const warm = await gate('GET', '/api/account-admin/console/backups');
  check('پیش‌زمینه: پشتیبان‌ها از راهِ در خوانده می‌شوند', warm.status === 200 && Array.isArray(warm.json?.backups), `${warm.status} ${warm.text.slice(0, 200)}`);

  /* ── پشتیبانِ دستی: مهلتِ بلند فقط برای همین در ── */
  const bk = (k) => ({ reason: 'آزمونِ مهلتِ در', confirm: true, idempotencyKey: `gate-backup-${k}-0001` });
  backupDelay = GATE + 500;   //  بیش از مهلتِ در، کم‌تر از مهلتِ بلندِ پل
  const b1 = await gate('POST', '/api/account-admin/console/backups', bk('a'));
  check('⛔ پشتیبانِ کُندتر از مهلتِ عادیِ در ⇒ از راهِ در هم ‎201‎ (نه بریده در مهلتِ در)',
    b1.status === 201 && b1.json?.backup?.file === 'shop-manual-g.sql.gz', `${b1.status} ${b1.text.slice(0, 200)} ${b1.ms}ms`);

  backupDelay = LONG + 2000;  //  بیش از مهلتِ بلندِ پل
  const posts0 = count('POST', '/api/admin/backups');
  const b2 = await gate('POST', '/api/account-admin/console/backups', bk('b'));
  check('⛔ پشتیبانِ کُندتر از مهلتِ بلندِ پل ⇒ همان ‎504 outcome_unknown‎ ِ پل از در می‌گذرد، نه ‎502 gate_upstream‎',
    b2.status === 504 && b2.json?.error === 'outcome_unknown' && b2.json?.outcome === 'unknown' && b2.ms < LONG + 2500,
    `${b2.status} ${b2.text.slice(0, 200)} ${b2.ms}ms`);
  const b2again = await gate('POST', '/api/account-admin/console/backups', bk('b'));
  check('همان کلید دوباره از راهِ در ⇒ همان «نامعلوم»، بی pg_dump ِ دوم',
    b2again.status === 504 && b2again.json?.error === 'outcome_unknown' && count('POST', '/api/admin/backups') === posts0 + 1,
    `${b2again.status} ${b2again.json?.error} posts=${count('POST', '/api/admin/backups') - posts0}`);

  /* ── نوشتنِ دیگر: مهلتِ عادیِ در، با معنای «نامعلوم» ── */
  hang.post = true;
  const notesPath = '/api/admin/ops/incidents/inc_9/notes';
  const n = await gate('POST', '/api/account-admin/console/ops/incidents/inc_9/notes', { note: 'یادداشتِ آزمونِ در', idempotencyKey: 'gate-note-0000001' });
  check('⛔ نوشتنی که از مهلتِ در گذشت ⇒ ‎504 outcome_unknown‎ و ‎outcome: "unknown"‎ — نه ‎502 gate_upstream‎',
    n.status === 504 && n.json?.error === 'outcome_unknown' && n.json?.outcome === 'unknown', `${n.status} ${n.text.slice(0, 200)} ${n.ms}ms`);
  check('مهلتِ بلند فقط برای پشتیبان است: همین نوشتن در مهلتِ عادیِ در بریده شد', n.ms < GATE + 2000, `${n.ms}ms`);
  check('پیام: «معلوم نیست… پیش از تکرار ببینید»، نه «شکست»',
    /معلوم نیست/.test(n.json?.message || '') && /پیش از/.test(n.json?.message || '') && !/شکست/.test(n.json?.message || ''), n.json?.message);
  check('در خودش نوشتن را دوباره نفرستاد', count('POST', notesPath) === 1, `${count('POST', notesPath)}`);

  /* ── خواندن: مهلتِ عادیِ در، تکرارپذیر ── */
  hang.get = true;
  const g = await gate('GET', '/api/account-admin/console/backups');
  hang.get = false;
  check('⛔ خواندنی که از مهلتِ در گذشت ⇒ ‎504 gate_timeout‎ (تکرارپذیر)، نه «نامعلوم»',
    g.status === 504 && g.json?.error === 'gate_timeout' && g.json?.outcome !== 'unknown' && g.ms < GATE + 2000, `${g.status} ${g.text.slice(0, 200)} ${g.ms}ms`);

  /* ── دفتر ── */
  const aud = await inside('GET', '/api/control/audit?q=admin-gate.outcome_unknown&limit=20&offset=0', undefined, auth);
  const rows = (aud.json?.rows || []).filter((r) => r.action === 'admin-gate.outcome_unknown');
  check('نوشتنِ نامعلومِ در یک ردیف در دفترِ پنل دارد (کدام دستگاه، کدام در)',
    rows.length === 1 && JSON.stringify(rows[0]).includes('/notes') && JSON.stringify(rows[0]).includes('phone-gt'), JSON.stringify(aud.json?.rows || aud.json).slice(0, 400));
  check('⛔ کلیدِ در و توکن هیچ‌جا در دفتر و پاسخ‌ها نیست',
    ![JSON.stringify(aud.json || {}), n.text, g.text, b2.text].some((t) => t.includes(key) || t.includes(token)), '');
  check('⛔ هیچ پوشهٔ میزبان در پاسخ‌های در', ![b1, b2, b2again, n, g].some((r) => r.text.includes('/srv/b')), '');
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
