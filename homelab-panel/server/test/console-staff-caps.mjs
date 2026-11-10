// ---------------------------------------------------------------------------
//  shop #1025 (‎claude/acct-console-2‎) در پل — سه تواناییِ تازه، هر کدام با و بی (۱.۵۰.۷۷)
//      node test/console-staff-caps.mjs
//
//  سرورِ حسابِ ساختگی به شکلِ ‎admin-staff-perms.js‎ و ‎lib/admin-write-once.js‎ ِ همان شاخه:
//    • `staff-perms.v1`: ‎POST …/devices/:did/enable‎ (دلیلِ ۳ تا ۲۰۰؛ ‎400 device_not_disabled‎ · ‎404 device_not_found‎ ·
//      ‎409 disabled_by_other_shop‎) و صفحه‌بندیِ ‎GET …/staff-perms?limit=&offset=‎ ⇒ ‎page‎ (‎400 bad_page‎)
//    • `idempotent-writes.v1`: ‎Idempotency-Key‎ روی دستگاه، بازبینیِ بانکِ عکس و ‎POST /backups‎ — همان کلید ⇒ همان پاسخ با
//      ‎Idempotent-Replayed: true‎؛ بدنهٔ دیگر ⇒ ‎409 idempotency_key_reused‎؛ هنوز در راه ⇒ ‎409 idempotency_in_progress‎
//  سنجیده می‌شود: بی توانایی ⇒ همان رفتارِ پیشین (یادِ پل، «پشتیبانی نمی‌شود»، ۵۰۰ تا با `truncated`)؛ با توانایی ⇒ کلیدِ
//  پنجره بسته به کاربرِ پنل (`u<id>.`) بالا می‌رود، بازپخش ⇒ `replayed` بی ردیفِ دوم، «نامعلوم» با همان کلید از خودِ سرورِ
//  حساب روشن می‌شود (ردیف با `resolved`)، ‎409‎ ها همان‌طور می‌گذرند، و کارت ورق می‌خورد.
//  ۱.۵۰.۷۸ (بازبینیِ ۱.۵۰.۷۷): راهِ هر کلید ثابت است — «نامعلوم» ِ بی‌کلید پس از به‌روز شدنِ سرورِ حساب با کلید دوباره
//  فرستاده نمی‌شد (کارِ دوم، و پشتیبان: pg_dump ِ دوم + ردیفِ «روشن شد» ِ نادرست)، و کلیدِ کلیددار با پرسشِ ناموفقِ توانایی بی‌کلید.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4977);
const SHORT = 700;
const LONG = 900;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-staff-caps-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی ───────────── */
const NOW = Date.now();
const BASE_CAPS = ['actor.v1', 'ops.v1'];
const NEW_CAPS = ['staff-perms.v1', 'image-bank.v1', 'idempotent-writes.v1'];
let caps = [...BASE_CAPS];
const seen = [];
const held = new Set();
let hangNext = false;          //  کار انجام می‌شود ولی پاسخ گم می‌شود (هیچ پاسخی نمی‌آید)
let meFail = 0;                //  چند پرسشِ بعدیِ ‎/api/admin/me‎ ۵۰۳ می‌گیرند
let dumps = 0;
const keys = new Map();        //  Idempotency-Key ⇒ { hash, status, body }
const disabled = new Set(['d3']);
const MEMBERS = Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, userId: `u${i}`, name: `عضو ${i}`, role: i ? 'cashier' : 'owner', status: 'active', layer: {}, effective: {} }));
const DEVICES = Array.from({ length: 130 }, (_, i) => `d${i}`);
const devRow = (d) => ({ id: d, name: `گوشی ${d}`, platform: 'android', status: disabled.has(d) ? 'revoked' : 'active', createdAt: NOW - 9e8, lastSeenAt: NOW,
  disabledAt: disabled.has(d) ? NOW : null, blockedAttempts: 0, lastBlockedAt: null, member: { userId: 'u1', role: 'cashier', name: 'عضو 1' } });
const pageOf = (q) => {
  if (q.limit === undefined && q.offset === undefined) return null;
  const int = (x, min, max) => { const n = /^\d{1,7}$/.test(String(x)) ? Number(x) : NaN; return n >= min && n <= max ? n : null; };
  const limit = q.limit === undefined ? 50 : int(q.limit, 1, 200);
  const offset = q.offset === undefined ? 0 : int(q.offset, 0, 1e6);
  return limit === null || offset === null ? 'bad' : { limit, offset };
};

const fake = http.createServer((req, res) => {
  held.add(res);
  res.on('close', () => held.delete(res));
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const raw = Buffer.concat(chunks).toString();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const j = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') {
      //  پرسشِ ناموفقِ توانایی (۱.۵۰.۷۸): ‎capListed‎ ⇒ «نیست»، با این‌که سرورِ حساب همان سرورِ کلیددار است
      if (meFail > 0) { meFail--; return j(503, { error: { code: 'busy', message: 'کمی بعد' } }); }
      return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    }
    const idem = String(req.headers['idempotency-key'] || '');
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, idem });
    const paged = caps.includes('staff-perms.v1');
    const writes = caps.includes('idempotent-writes.v1');

    let m = /^\/api\/admin\/shops\/([^/]+)\/staff-perms$/.exec(p);
    if (m && req.method === 'GET') {
      if (m[1] === 'bp') return j(400, { error: { code: 'bad_page', message: 'limit باید عددی از ۱ تا ۲۰۰ باشد' } });
      const members = m[1] === 'big' ? Array.from({ length: 600 }, (_, i) => ({ ...MEMBERS[1], id: `b${i}`, userId: `ub${i}` })) : MEMBERS;
      const pg = paged ? pageOf(Object.fromEntries(u.searchParams)) : null;
      if (pg === 'bad') return j(400, { error: { code: 'bad_page', message: 'صفحه درست نیست' } });
      const slice = (a) => (pg ? a.slice(pg.offset, pg.offset + pg.limit) : a);
      const out = { shop: { id: m[1], name: 'دکان' }, perms: { v: 1, catalog: [], roles: {}, members: slice(members) }, devices: slice(DEVICES).map(devRow) };
      if (pg) {
        const next = pg.offset + pg.limit;
        out.page = { ...pg, membersTotal: members.length, devicesTotal: DEVICES.length, nextOffset: next < Math.max(members.length, DEVICES.length) ? next : null };
      }
      return j(200, out);
    }

    /** همان ‎lib/admin-write-once.js‎: با کلید (فقط سرورِ تازه) ⇒ یک بار؛ ‎run()‎ ⇒ ‎[status, body]‎ */
    const once = (run) => {
      if (writes && idem) {
        if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(idem)) return j(400, { error: { code: 'bad_idempotency_key', message: 'کلید' } });
        if (/busy/.test(idem)) return j(409, { error: { code: 'idempotency_in_progress', message: 'همین درخواست با همین کلید همین حالا در راه است' } });
        const hash = `${req.method} ${p}\n${raw}`;
        const prev = keys.get(idem);
        if (prev) {
          if (prev.hash !== hash) return j(409, { error: { code: 'idempotency_key_reused', message: 'این کلیدِ یکتایی پیش‌تر برای درخواستِ دیگری به کار رفته است' } });
          return j(prev.status, prev.body, { 'idempotent-replayed': 'true' });
        }
        const [status, out] = run();
        if (status < 400) keys.set(idem, { hash, status, body: out });
        if (hangNext) { hangNext = false; return; }   //  انجام شد، پاسخ گم شد
        return j(status, out);
      }
      const [status, out] = run();
      if (hangNext) { hangNext = false; return; }
      return j(status, out);
    };

    m = /^\/api\/admin\/shops\/s1\/staff-perms\/devices\/([^/]+)\/(disable|enable)$/.exec(p);
    if (m && req.method === 'POST') {
      const [, did, act] = m;
      if (act === 'enable' && !paged) return j(401, { error: { code: 'invalid_token', message: 'نشست' } });   //  سرورِ کهنه: مسیر نیست
      return once(() => {
        if (!DEVICES.includes(did)) return [404, { error: { code: 'device_not_found', message: 'این دستگاه مالِ اعضای این دکان نیست' } }];
        if (act === 'disable') { disabled.add(did); return [200, { ok: true, id: did, disabledAt: Date.now(), sessionsRevoked: 1 }]; }
        if (String(body?.reason || '').trim().length < 3) return [400, { error: { code: 'reason_required', message: 'دلیل' } }];
        if (did === 'd7') return [409, { error: { code: 'disabled_by_other_shop', message: 'این دستگاه را دکانِ دیگری از کار انداخته است' } }];
        if (!disabled.has(did)) return [400, { error: { code: 'device_not_disabled', message: 'این دستگاه از سوی دکان از کار نیفتاده است' } }];
        disabled.delete(did);
        return [200, { ok: true, id: did }];
      });
    }
    m = /^\/api\/admin\/image-bank\/images\/([^/]+)\/approve$/.exec(p);
    if (m && req.method === 'POST') return once(() => [200, { id: m[1], status: 'APPROVED', version: 1 }]);
    if (p === '/api/admin/backups' && req.method === 'POST') {
      return once(() => { dumps++; return [201, { file: '/srv/b/shop-manual-x.sql.gz', bytes: 10, kind: 'manual', createdAt: Date.now(), encrypted: true, sha256: 'ab'.repeat(32) }]; });
    }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ───────────── پنلِ واقعی ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_BRIDGE_TIMEOUT_MS: String(SHORT), HLP_BRIDGE_LONG_TIMEOUT_MS: String(LONG),
         HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, headers = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ups = (re, method = 'POST') => seen.filter((s) => s.method === method && re.test(s.path));
const last = (re, method = 'POST') => ups(re, method).at(-1);
const ST = '/api/account-admin/console/shops/s1/staff';
const auditRows = async (tok, q, action) => ((await api('GET', `/api/control/audit?q=${q}&limit=50&offset=0`, undefined, { Authorization: `Bearer ${tok}` })).json?.rows || [])
  .filter((r) => r.action === action);

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Cap-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Cap-1405-owner');
  const H = (t) => ({ Authorization: `Bearer ${t}` });
  for (const [u, role] of [['adm1', 'admin'], ['adm2', 'admin'], ['op1', 'operator'], ['view1', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Cap-${role}-1405-${u}`, role }, H(owner));
  }
  const T = { owner, adm1: await login('adm1', 'Cap-admin-1405-adm1'), adm2: await login('adm2', 'Cap-admin-1405-adm2'),
    op: await login('op1', 'Cap-operator-1405-op1'), view: await login('view1', 'Cap-viewer-1405-view1') };
  const uid = async (tok) => (await api('GET', '/api/auth/me', undefined, H(tok))).json?.user?.id;
  const U1 = await uid(T.adm1);
  const U2 = await uid(T.adm2);
  const dev = (did, act) => `${ST}/devices/${did}/${act}`;
  const dB = (k, extra = {}) => ({ reason: 'آزمونِ توانایی‌ها', confirm: true, idempotencyKey: `cap-key-${k}-0001`, ...extra });

  console.log('\n── بی توانایی (سرورِ حسابِ امروز) ──');
  const g0 = await api('GET', ST, undefined, H(T.view));
  check('پرونده: «برگرداندن» ⇒ «پشتیبانی نمی‌شود» و ‎canEnable: false‎', g0.status === 200 && g0.json?.canEnable === false
    && (g0.json?.notSupported || []).includes('POST /api/admin/shops/:id/staff-perms/devices/:did/enable'), `${g0.status} ${g0.text.slice(0, 200)}`);
  check('پل همیشه ‎limit/offset‎ می‌فرستد؛ سرورِ کهنه بی ‎page‎ ⇒ همه یک‌جا (‎page: null‎)',
    last(/\/s1\/staff-perms$/, 'GET')?.query?.limit === '50' && last(/\/s1\/staff-perms$/, 'GET')?.query?.offset === '0' && g0.json?.page === null && g0.json?.members?.length === 120,
    JSON.stringify(last(/\/s1\/staff-perms$/, 'GET')?.query));
  const big = await api('GET', '/api/account-admin/console/shops/big/staff', undefined, H(T.view));
  check('⛔ سرورِ کهنه با بیش از ۵۰۰ عضو ⇒ ۵۰۰ تا و ‎truncated: true‎ (نه بریدنِ بی‌صدا)', big.status === 200 && big.json?.members?.length === 500 && big.json?.truncated === true,
    `${big.status} ${big.json?.members?.length} ${big.json?.truncated}`);
  const e0 = await api('POST', dev('d3', 'enable'), dB('e0'), H(T.adm1));
  check('⛔ برگرداندن روی سرورِ بی ‎staff-perms.v1‎ ⇒ ‎501 capability_missing‎، بی درخواست به سرورِ حساب',
    e0.status === 501 && e0.json?.error === 'capability_missing' && ups(/\/enable$/).length === 0, `${e0.status} ${e0.text.slice(0, 200)}`);
  const d0 = await api('POST', dev('d10', 'disable'), dB('d0'), H(T.adm1));
  const d0b = await api('POST', dev('d10', 'disable'), dB('d0'), H(T.adm1));
  check('ازکارانداختن بی ‎idempotent-writes.v1‎: کلید بالا نمی‌رود، تکرار از یادِ پل (یک درخواست)',
    d0.status === 200 && d0b.json?.replayed === true && ups(/\/d10\/disable$/).length === 1 && last(/\/d10\/disable$/)?.idem === '', `${d0.status} ${d0b.text.slice(0, 120)} n=${ups(/\/d10\/disable$/).length}`);
  const bk0 = await api('POST', '/api/account-admin/console/backups', { reason: 'آزمونِ پشتیبان', confirm: true, idempotencyKey: 'cap-bk-none-0001' }, H(T.owner));
  check('پشتیبان بی توانایی: ‎201‎، بی کلید به سرورِ حساب', bk0.status === 201 && last(/^\/api\/admin\/backups$/)?.idem === '', `${bk0.status} ${bk0.text.slice(0, 160)}`);

  //  ۱.۵۰.۷۸ — «نامعلوم» روی راهِ یادِ پل (بی کلید)، و سرورِ حساب پیش از تکرار به‌روز می‌شود (پایین)
  const dumpsFlip = dumps;
  hangNext = true;
  const fd1 = await api('POST', dev('d40', 'disable'), dB('flip'), H(T.adm1));
  hangNext = true;
  const fi1 = await api('POST', '/api/account-admin/console/image-bank/images/img_9/approve', { reason: 'مجوز درست است', confirm: true, idempotencyKey: 'cap-img-flip-0001', version: 1 }, H(T.adm1));
  hangNext = true;
  const fbBody = { reason: 'آزمونِ پشتیبانِ جابه‌جا', confirm: true, idempotencyKey: 'cap-bk-flip-0001' };
  const fb1 = await api('POST', '/api/account-admin/console/backups', fbBody, H(T.owner));
  check('پیش‌زمینه: سه نوشتنِ بی‌پاسخ روی سرورِ کهنه ⇒ «نامعلوم»، بی کلید به سرورِ حساب',
    [fd1, fi1, fb1].every((r) => r.status === 504 && r.json?.outcome === 'unknown') && [last(/\/d40\/disable$/), last(/img_9\/approve$/), last(/^\/api\/admin\/backups$/)].every((x) => x?.idem === '')
      && dumps === dumpsFlip + 1, [fd1, fi1, fb1].map((r) => `${r.status}:${r.json?.error}`).join(' '));

  caps = [...BASE_CAPS, ...NEW_CAPS];
  console.log('\n── با `staff-perms.v1` و `idempotent-writes.v1` (shop #1025) ──');
  //  ⛔ همان کلید پس از به‌روز شدنِ سرورِ حساب: کارِ نخست **بی کلید** رفت، پس سرورِ حساب آن را نمی‌شناسد — فرستادنِ همان کار با
  //     کلید کارِ دوم است (و پشتیبان: pg_dump ِ دوم کنارِ شاید-هنوز-در-راهِ نخست). همان «نامعلوم» ِ یادِ پل باید بماند.
  const fd2 = await api('POST', dev('d40', 'disable'), dB('flip'), H(T.adm1));
  const fi2 = await api('POST', '/api/account-admin/console/image-bank/images/img_9/approve', { reason: 'مجوز درست است', confirm: true, idempotencyKey: 'cap-img-flip-0001', version: 1 }, H(T.adm1));
  const fb2 = await api('POST', '/api/account-admin/console/backups', fbBody, H(T.owner));
  check('⛔ دستگاه: همان کلید پس از به‌روز شدنِ سرورِ حساب ⇒ همان «نامعلوم» ِ یادِ پل، بی درخواستِ دوم (راهِ کلید عوض نمی‌شود)',
    fd2.status === 504 && fd2.json?.outcome === 'unknown' && ups(/\/d40\/disable$/).length === 1, `${fd2.status} ${fd2.text.slice(0, 160)} n=${ups(/\/d40\/disable$/).length}`);
  check('⛔ بانکِ عکس: همان', fi2.status === 504 && fi2.json?.outcome === 'unknown' && ups(/img_9\/approve$/).length === 1, `${fi2.status} ${fi2.text.slice(0, 160)} n=${ups(/img_9\/approve$/).length}`);
  check('⛔ پشتیبان: همان «نامعلوم»، بی pg_dump ِ دوم و بی ردیفِ «روشن شد»',
    fb2.status === 504 && fb2.json?.outcome === 'unknown' && dumps === dumpsFlip + 1 && ups(/^\/api\/admin\/backups$/).filter((x) => x.idem.endsWith('cap-bk-flip-0001')).length === 0,
    `${fb2.status} ${fb2.text.slice(0, 160)} dumps=${dumps - dumpsFlip}`);
  await sleep(LONG + 200);   //  ته‌نشینیِ «نامعلوم» ِ پشتیبان (‎HLP_BRIDGE_LONG_TIMEOUT_MS‎) تا پشتیبان‌های پایین

  const g1 = await api('GET', ST, undefined, H(T.view));
  check('صفحهٔ نخست: ۵۰ عضو و ۵۰ دستگاه با ‎page {limit, offset, totals, nextOffset: 50}‎ و ‎canEnable: true‎',
    g1.status === 200 && g1.json?.members?.length === 50 && g1.json?.devices?.length === 50 && JSON.stringify(g1.json?.page)
      === JSON.stringify({ limit: 50, offset: 0, membersTotal: 120, devicesTotal: 130, nextOffset: 50 }) && g1.json?.canEnable === true
      && (g1.json?.notSupported || []).length === 0 && g1.json?.truncated === false, `${g1.status} ${JSON.stringify(g1.json?.page)} ${g1.json?.canEnable}`);
  const g2 = await api('GET', `${ST}?offset=100`, undefined, H(T.view));
  check('صفحهٔ آخر (‎offset=100‎): ۲۰ عضو، ۳۰ دستگاه، ‎nextOffset: null‎', g2.json?.members?.length === 20 && g2.json?.devices?.length === 30 && g2.json?.page?.nextOffset === null
    && last(/\/s1\/staff-perms$/, 'GET')?.query?.offset === '100', JSON.stringify(g2.json?.page));
  const n0 = seen.length;
  const bp1 = await api('GET', `${ST}?offset=abc`, undefined, H(T.view));
  const bp2 = await api('GET', `${ST}?limit=500`, undefined, H(T.view));
  check('⛔ صفحهٔ نادرست ⇒ ‎400 bad_page‎ پیش از پل', bp1.status === 400 && bp1.json?.error === 'bad_page' && bp2.status === 400 && bp2.json?.error === 'bad_page'
    && !seen.slice(n0).some((s) => s.path.includes('staff-perms')), `${bp1.status} ${bp2.status}`);
  const bp3 = await api('GET', '/api/account-admin/console/shops/bp/staff', undefined, H(T.view));
  check('‎400 bad_page‎ ِ خودِ سرورِ حساب همان‌طور می‌گذرد', bp3.status === 400 && bp3.json?.error === 'bad_page', `${bp3.status} ${bp3.text.slice(0, 120)}`);

  const ev = await api('POST', dev('d3', 'enable'), dB('ev'), H(T.view));
  const eo = await api('POST', dev('d3', 'enable'), dB('eo'), H(T.op));
  check('⛔ viewer و operator دستگاه را برنمی‌گردانند (۴۰۳)، بی درخواست به سرورِ حساب', ev.status === 403 && eo.status === 403 && ups(/\/enable$/).length === 0, `${ev.status} ${eo.status}`);
  const eb = await api('POST', dev('d3', 'enable'), dB('eb', { reason: 'ab' }), H(T.adm1));
  const ec = await api('POST', dev('d3', 'enable'), dB('ec', { confirm: false }), H(T.adm1));
  const ek = await api('POST', dev('d3', 'enable'), dB('ek', { idempotencyKey: 'bad key!' }), H(T.adm1));
  check('دلیلِ کوتاه / بی تأیید / کلیدِ بد ⇒ ۴۰۰ پیش از پل', eb.json?.error === 'reason_required' && ec.json?.error === 'confirm_required' && ek.json?.error === 'bad_idempotency_key'
    && ups(/\/enable$/).length === 0, [eb, ec, ek].map((r) => `${r.status}:${r.json?.error}`).join(' '));
  const e1 = await api('POST', dev('d3', 'enable'), dB('e1'), H(T.adm1));
  const e1up = last(/\/d3\/enable$/);
  check('admin ⇒ ‎200 {ok, deviceId}‎؛ بالادست فقط ‎{reason}‎ و کلیدِ ‎u<کاربر>.<کلید>‎',
    e1.status === 200 && e1.json?.ok === true && e1.json?.deviceId === 'd3' && JSON.stringify(e1up?.body) === JSON.stringify({ reason: 'آزمونِ توانایی‌ها' })
      && e1up?.idem === `u${U1}.cap-key-e1-0001`, `${e1.status} ${e1.text.slice(0, 160)} ${JSON.stringify(e1up)}`);
  const e2 = await api('POST', dev('d3', 'enable'), dB('e1'), H(T.adm1));
  check('همان کلید ⇒ بازپخشِ خودِ سرورِ حساب (‎replayed‎)، نه کارِ دوم', e2.status === 200 && e2.json?.replayed === true && ups(/\/d3\/enable$/).length === 2 && !disabled.has('d3'),
    `${e2.status} ${e2.text.slice(0, 120)}`);
  const eNd = await api('POST', dev('d4', 'enable'), dB('end'), H(T.adm1));
  const eOs = await api('POST', dev('d7', 'enable'), dB('eos'), H(T.adm1));
  const eNf = await api('POST', dev('zz', 'enable'), dB('enf'), H(T.adm1));
  check('خطاهای سرورِ حساب با کدِ خودشان: ‎400 device_not_disabled‎ · ‎409 disabled_by_other_shop‎ · ‎404 device_not_found‎',
    eNd.status === 400 && eNd.json?.error === 'device_not_disabled' && eOs.status === 409 && eOs.json?.error === 'disabled_by_other_shop'
      && eNf.status === 404 && eNf.json?.error === 'device_not_found', [eNd, eOs, eNf].map((r) => `${r.status}:${r.json?.error}`).join(' '));
  const enRows = await auditRows(T.owner, 'account.shop_device', 'account.shop_device.enabled');
  check('دفترِ پنل: یک ردیفِ «برگشت» با دلیل (بازپخش و ردها نه)', enRows.length === 1 && enRows[0].actor === 'adm1' && String(enRows[0].detail).includes('d3'), JSON.stringify(enRows).slice(0, 300));

  const x1 = await api('POST', dev('d20', 'disable'), dB('x1'), H(T.adm1));
  const x2 = await api('POST', dev('d20', 'disable'), dB('x1'), H(T.adm1));
  check('⛔ ازکارانداختن با کلیدِ بالادست: یاد در سرورِ حساب است — تکرار به آن‌جا می‌رود و بازپخش می‌شود',
    x1.status === 200 && x2.json?.replayed === true && ups(/\/d20\/disable$/).length === 2 && last(/\/d20\/disable$/)?.idem === `u${U1}.cap-key-x1-0001`,
    `${x1.status} ${x2.text.slice(0, 120)} n=${ups(/\/d20\/disable$/).length}`);
  const x3 = await api('POST', dev('d20', 'disable'), dB('x1', { reason: 'دلیلِ دیگر برای همین' }), H(T.adm1));
  check('همان کلید برای کارِ دیگر ⇒ ‎409 idempotency_key_reused‎ ِ سرورِ حساب', x3.status === 409 && x3.json?.error === 'idempotency_key_reused', `${x3.status} ${x3.json?.error}`);
  const x4 = await api('POST', dev('d20', 'disable'), dB('x1'), H(T.adm2));
  check('⛔ کلیدِ یکسانِ دو کاربرِ پنل دو کلیدِ بالادست است (‎u<id>.‎) — پاسخِ کاربرِ دیگر بازپخش نمی‌شود',
    x4.status === 200 && x4.json?.replayed !== true && last(/\/d20\/disable$/)?.idem === `u${U2}.cap-key-x1-0001` && U1 !== U2, `${x4.status} ${x4.text.slice(0, 120)} ${last(/\/d20\/disable$/)?.idem}`);
  const x5 = await api('POST', dev('d21', 'disable'), dB('busy'), H(T.adm1));
  check('‎409 idempotency_in_progress‎ ِ سرورِ حساب همان‌طور می‌گذرد', x5.status === 409 && x5.json?.error === 'idempotency_in_progress', `${x5.status} ${x5.json?.error}`);

  hangNext = true;
  const u1 = await api('POST', dev('d22', 'disable'), dB('lost'), H(T.adm1));
  check('پاسخِ گم‌شده ⇒ ‎504 outcome_unknown‎', u1.status === 504 && u1.json?.error === 'outcome_unknown' && u1.json?.outcome === 'unknown', `${u1.status} ${u1.text.slice(0, 160)}`);
  const u2 = await api('POST', dev('d22', 'disable'), dB('lost'), H(T.adm1));
  check('⛔ همان پنجره دوباره ⇒ سرورِ حساب می‌گوید «انجام شده بود» (‎replayed‎) — نه «نامعلوم» ِ یادِ پل، نه کارِ دوم',
    u2.status === 200 && u2.json?.replayed === true && u2.json?.sessionsRevoked === 1 && ups(/\/d22\/disable$/).length === 2, `${u2.status} ${u2.text.slice(0, 160)}`);
  //  ۱.۵۰.۷۸ — وارونه: «نامعلوم» روی راهِ کلیددار، و پرسشِ توانایی سرِ تکرار شکست می‌خورد (‎capListed‎ ⇒ «نیست»)
  hangNext = true;
  const v1 = await api('POST', dev('d41', 'disable'), dB('flipb'), H(T.adm1));
  meFail = 1;
  const v2 = await api('POST', dev('d41', 'disable'), dB('flipb'), H(T.adm1));
  meFail = 0;
  check('⛔ همان کلید که با کلید رفت، با کلید می‌ماند: پرسشِ ناموفقِ توانایی آن را به راهِ بی‌کلید (کارِ دوم) نمی‌برد — بازپخشِ سرورِ حساب',
    v1.status === 504 && v2.status === 200 && v2.json?.replayed === true && ups(/\/d41\/disable$/).length === 2 && ups(/\/d41\/disable$/).every((x) => x.idem === `u${U1}.cap-key-flipb-0001`),
    `${v1.status} ${v2.status} ${v2.text.slice(0, 160)} ${JSON.stringify(ups(/\/d41\/disable$/).map((x) => x.idem))}`);
  const disRows = await auditRows(T.owner, 'account.shop_device', 'account.shop_device.disabled');
  check('دفترِ پنل: بازپخشِ عادی ردیفِ دوم ندارد، ولی بازپخشی که «نامعلوم» را روشن کرد ردیف دارد (‎resolved‎)',
    disRows.filter((r) => String(r.detail).includes('d20')).length === 2 && disRows.filter((r) => String(r.detail).includes('d22')).length === 1
      && String(disRows.find((r) => String(r.detail).includes('d22'))?.detail).includes('resolved'), JSON.stringify(disRows.map((r) => [r.actor, r.detail])).slice(0, 400));

  const IB = '/api/account-admin/console/image-bank/images/img_1/approve';
  const iB = { reason: 'مجوز درست است', confirm: true, idempotencyKey: 'cap-img-0001', version: 1 };
  const i1 = await api('POST', IB, iB, H(T.adm1));
  const i2 = await api('POST', IB, iB, H(T.adm1));
  check('بانکِ عکس: کلیدِ ‎u<کاربر>.‎ بالا می‌رود؛ تکرار ⇒ بازپخشِ سرورِ حساب، یک ردیفِ دفتر',
    i1.status === 200 && i1.json?.status === 'APPROVED' && i2.json?.replayed === true && ups(/img_1\/approve$/).length === 2 && last(/img_1\/approve$/)?.idem === `u${U1}.cap-img-0001`
      && (await auditRows(T.owner, 'account.image_bank', 'account.image_bank.approve')).length === 1, `${i1.status} ${i2.text.slice(0, 120)}`);

  console.log('\n── پشتیبانِ دستی با کلیدِ سرورِ حساب ──');
  const bk = (k) => ({ reason: 'آزمونِ پشتیبانِ کلیددار', confirm: true, idempotencyKey: `cap-bk-${k}-0001` });
  const dumps0 = dumps;
  const b1 = await api('POST', '/api/account-admin/console/backups', bk('a'), H(T.owner));
  check('پشتیبان: ‎201‎ و کلیدِ ‎u<مالک>.‎ همراهِ ‎POST /backups‎', b1.status === 201 && /^u\d+\.cap-bk-a-0001$/.test(last(/^\/api\/admin\/backups$/)?.idem || ''),
    `${b1.status} ${last(/^\/api\/admin\/backups$/)?.idem}`);
  hangNext = true;
  const b2 = await api('POST', '/api/account-admin/console/backups', bk('b'), H(T.owner));
  check('پشتیبانِ بی‌پاسخ ⇒ ‎504 outcome_unknown‎', b2.status === 504 && b2.json?.error === 'outcome_unknown', `${b2.status} ${b2.text.slice(0, 160)}`);
  const b3 = await api('POST', '/api/account-admin/console/backups', bk('b'), H(T.owner));
  check('⛔ همان کلید ⇒ از سرورِ حساب پرسیده می‌شود: «ساخته شده بود» (‎201 replayed‎)، بی pg_dump ِ دوم',
    b3.status === 201 && b3.json?.replayed === true && b3.json?.backup?.file === 'shop-manual-x.sql.gz' && dumps === dumps0 + 2, `${b3.status} ${b3.text.slice(0, 160)} dumps=${dumps - dumps0}`);
  const b4 = await api('POST', '/api/account-admin/console/backups', bk('c'), H(T.owner));
  check('و نامعلومِ روشن‌شده پشتیبانِ تازه را نمی‌بندد (نه ‎409 backup_outcome_unknown‎)', b4.status === 201 && dumps === dumps0 + 3, `${b4.status} ${b4.json?.error}`);
  const bRows = await auditRows(T.owner, 'account.backup', 'account.backup.created');
  check('دفترِ پنل: پشتیبانِ روشن‌شده با ‎resolved‎', bRows.some((r) => String(r.detail).includes('resolved')) && bRows.filter((r) => String(r.detail).includes('server')).length === 3,
    JSON.stringify(bRows.map((r) => r.detail)).slice(0, 400));
  check('⛔ هیچ پوشهٔ میزبان در پاسخ‌ها', ![b1, b3, b4].some((r) => r.text.includes('/srv/b')));
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
