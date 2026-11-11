// ---------------------------------------------------------------------------
//  ۴-۱ «ب» در پل — فهرستِ مرکزیِ مترادف در «تنظیماتِ مرکزی»، با و بی `synonyms.v1` (۱.۵۰.۸۹)
//      node test/console-synonyms.mjs
//
//  سرورِ حسابِ ساختگی به شکلِ قراردادِ `routes/console-synonyms.js` (همان الگوی ‎holidays.v1‎):
//    GET ⇒ ‎{version, updatedAt, groups: string[][]}‎ · PUT ‎{groups, version, reason}‎ ⇒ نسخهٔ تازه؛ همان فهرست ⇒ ‎unchanged‎؛
//    نسخهٔ کهنه ⇒ ‎409 synonyms_version‎.
//  سنجیده می‌شود: بی توانایی ⇒ «در دسترس نیست» و نوشتن ‎501‎ بی درخواست؛ با توانایی ⇒ خواندن فقط فیلدهای شناخته، نوشتن فقط
//  admin با دلیل + تأیید + کلید + نسخه، سنجشِ گروه‌ها پیش از پل (دو واژه، سقف‌ها، یک واژه فقط در یک گروه با یک‌شکل کردنِ
//  ی/ک/نیم‌فاصله/رقم/بزرگی)، ‎409‎ همان‌طور، یک‌باره با کلید، و ردیفِ دفترِ پنل.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4973);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-synonyms-'));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ── واحد: همان سنجشِ پل، بی سرور ── */
process.env.HLP_DATA_DIR = path.join(tmp, 'unit');
const { validateSynonyms, synonymKey, shapeSynonyms } = await import('../src/routes/console-synonyms.js');
const bad = (code, message) => Object.assign(new Error(message), { code, status: 400 });
const tryV = (g) => { try { return { ok: true, out: validateSynonyms(g, bad) }; } catch (e) { return { ok: false, code: e.code, message: e.message }; } };
check('کلیدِ یک‌شکل: «ي/ی»، «ك/ک»، نیم‌فاصله، رقمِ فارسی و بزرگی یکی‌اند', synonymKey('روغنِ نباتي') === synonymKey('روغنِ نباتی') && synonymKey('كشمش') === synonymKey('کشمش')
  && synonymKey('می‌خواهم') === synonymKey('میخواهم') && synonymKey('کوکا ۱۲') === synonymKey('KOKA 12'.replace('KOKA', 'کوکا')) && synonymKey('Sugar') === synonymKey('sugar'));
const good = tryV([['بوره', 'شکر', ' sugar ', 'Sugar'], ['روغن', 'تیل']]);
check('گروهِ درست ⇒ پاک: فاصله‌ها برداشته، تکرارِ همان گروه یک بار', good.ok && JSON.stringify(good.out) === JSON.stringify([['بوره', 'شکر', 'sugar'], ['روغن', 'تیل']]), JSON.stringify(good));
for (const [name, g] of [
  ['یک واژه', [['شکر']]], ['دو بارِ یک واژه', [['شکر', 'شكر']]], ['واژهٔ نامتن', [['شکر', 5]]], ['گروهِ نافهرست', ['شکر']],
  ['فهرستِ نافهرست', { a: 1 }], ['واژهٔ بلند', [['شکر', 'x'.repeat(61)]]], ['بیش از ۲۰ واژه', [Array.from({ length: 21 }, (_, i) => `w${i}`)]],
  ['بیش از ۵۰۰ گروه', Array.from({ length: 501 }, (_, i) => [`a${i}`, `b${i}`])], ['یک واژه در دو گروه (ی/ي)', [['نباتی', 'روغن'], ['نباتي', 'تیل']]],
]) {
  const r = tryV(g);
  check(`⛔ ${name} ⇒ ‎synonym_invalid‎`, !r.ok && r.code === 'synonym_invalid', JSON.stringify(r).slice(0, 160));
}
const shaped = shapeSynonyms({ version: 2, updatedAt: 5, groups: [['a', 'b'], ['تنها'], 'x', [1, 'c', 'd\u0007'], null], evil: true });
check('پاسخِ بالادست ⇒ فقط فیلدهای شناخته؛ گروهِ خراب کنار، نویسهٔ کنترلی برداشته', JSON.stringify(shaped) === JSON.stringify({ version: 2, updatedAt: 5, groups: [['a', 'b'], ['c', 'd']] }), JSON.stringify(shaped));

/* ── سرورِ حسابِ ساختگی ── */
const NOW = Date.now();
let caps = ['actor.v1'];
const seen = [];
let doc = { version: 4, updatedAt: NOW - 3600e3, groups: [['بوره', 'شکر'], ['<img src=x onerror=1>', 'تیل']] };
let staleNext = false;
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const p = new URL(req.url, 'http://x').pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    seen.push({ method: req.method, path: p, body });
    if (p === '/api/admin/search/synonyms') {
      if (!caps.includes('synonyms.v1')) return j(401, { error: { code: 'invalid_token', message: 'نشست' } });
      if (req.method === 'GET') return j(200, doc);
      if (req.method === 'PUT') {
        if (JSON.stringify(body?.groups) === JSON.stringify(doc.groups)) return j(200, { ...doc, unchanged: true });
        if (staleNext || body?.version !== doc.version) { staleNext = false; return j(409, { error: { code: 'synonyms_version', message: 'فهرست در این میان عوض شده است' } }); }
        doc = { version: doc.version + 1, updatedAt: Date.now(), groups: body.groups };
        return j(200, doc);
      }
    }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_SITESYNC: '0', HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
    HLP_ACCOUNT_API: FAKE_URL, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
    HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));
const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, token) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}
const puts = () => seen.filter((s) => s.method === 'PUT' && s.path === '/api/admin/search/synonyms').length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SY = '/api/account-admin/console/search/synonyms';

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ } await sleep(250); }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Syn-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Syn-1405-owner');
  for (const [u, role] of [['op1', 'operator'], ['view1', 'viewer']]) await api('POST', '/api/auth/users', { username: u, password: `Syn-${role}-1405`, role }, owner);
  const op = await login('op1', 'Syn-operator-1405');
  const viewer = await login('view1', 'Syn-viewer-1405');
  const W = (over = {}) => ({ groups: [['بوره', 'شکر', 'قند'], ['روغن', 'تیل']], version: 4, reason: 'فهرستِ نخستِ صاحب‌کار', confirm: true, idempotencyKey: 'syn-key-000001', ...over });

  console.log('\n── سرورِ حسابِ بی `synonyms.v1` ──');
  const old = await api('GET', SY, undefined, viewer);
  check('⛔ خواندن ⇒ ‎available: false‎ با نامِ درِ لازم (نه فهرستِ ساختگی) و بی پرسش از آن در', old.status === 200 && old.json?.available === false && old.json?.capability === 'synonyms.v1'
    && /search\/synonyms/.test(old.json?.needs || '') && !seen.some((s) => s.path === '/api/admin/search/synonyms'), old.text.slice(0, 200));
  const oldW = await api('PUT', SY, W(), owner);
  check('⛔ نوشتن ⇒ ‎501 capability_missing‎ و هیچ درخواستی', oldW.status === 501 && oldW.json?.error === 'capability_missing' && puts() === 0, oldW.text.slice(0, 200));

  caps = ['actor.v1', 'synonyms.v1'];
  console.log('\n── با `synonyms.v1` ──');
  const rd = await api('GET', SY, undefined, viewer);
  check('خواندن برای viewer: نسخه، زمان و گروه‌ها، فقط متن', rd.status === 200 && rd.json?.available === true && rd.json.version === 4 && rd.json.groups.length === 2 && rd.json.max === 500, rd.text.slice(0, 200));
  const before = seen.length;
  const opW = await api('PUT', SY, W(), op);
  check('⛔ operator نمی‌نویسد (۴۰۳) و هیچ درخواستی بالا نمی‌رود', opW.status === 403 && seen.length === before, `${opW.status}`);
  const noConf = await api('PUT', SY, W({ confirm: false }), owner);
  const noWhy = await api('PUT', SY, W({ reason: 'ab' }), owner);
  const noKey = await api('PUT', SY, W({ idempotencyKey: undefined }), owner);
  const noVer = await api('PUT', SY, W({ version: undefined }), owner);
  const dup = await api('PUT', SY, W({ groups: [['نباتی', 'روغن'], ['نباتي', 'تیل']] }), owner);
  check('⛔ بی تأیید / دلیلِ کوتاه / بی کلید / بی نسخه / واژهٔ دوگروهه ⇒ ۴۰۰، پیش از سرورِ حساب', [noConf, noWhy, noKey, noVer, dup].every((r) => r.status === 400) && dup.json?.error === 'synonym_invalid' && puts() === 0,
    [noConf, noWhy, noKey, noVer, dup].map((r) => `${r.status}:${r.json?.error}`).join(' '));
  const ok = await api('PUT', SY, W(), owner);
  const sent = seen.filter((s) => s.method === 'PUT').at(-1);
  check('نوشتن ⇒ گروه‌های پاک، نسخه و دلیل به سرورِ حساب؛ پاسخ با نسخهٔ تازه', ok.status === 200 && ok.json?.version === 5 && JSON.stringify(sent?.body?.groups) === JSON.stringify([['بوره', 'شکر', 'قند'], ['روغن', 'تیل']])
    && sent.body.version === 4 && sent.body.reason === 'فهرستِ نخستِ صاحب‌کار', `${ok.text.slice(0, 200)} ${JSON.stringify(sent?.body)}`);
  const again = await api('PUT', SY, W(), owner);
  check('⛔ همان کلید ⇒ همان پاسخ، بی درخواستِ دوم', again.json?.version === 5 && puts() === 1, `${puts()}`);
  const same = await api('PUT', SY, W({ version: 5, idempotencyKey: 'syn-key-000002' }), owner);
  check('همان فهرست ⇒ ‎unchanged‎ (تکرار بی‌اثر)', same.status === 200 && same.json?.unchanged === true, same.text.slice(0, 160));
  staleNext = true;
  const stale = await api('PUT', SY, W({ groups: [['برنج', 'شالی']], version: 5, idempotencyKey: 'syn-key-000003' }), owner);
  check('⛔ نسخهٔ کهنه ⇒ ‎409 synonyms_version‎ همان‌طور (نه رونویسی)', stale.status === 409 && stale.json?.error === 'synonyms_version', stale.text.slice(0, 160));
  const aud = await api('GET', '/api/control/audit?q=account.synonyms&limit=20&offset=0', undefined, owner);
  const rows = (aud.json?.rows || []).filter((r) => r.action === 'account.synonyms.updated');
  check('دفترِ پنل: یک ردیف برای هر نوشتنِ رسیده (با دلیل)، ردشده‌ها و بازپخش نه', rows.length === 2 && rows.some((r) => String(r.detail).includes('فهرستِ نخستِ صاحب‌کار')), `${rows.length}`);
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await sleep(300);
  await fsp.rm(tmp, { recursive: true, force: true });
}
if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
