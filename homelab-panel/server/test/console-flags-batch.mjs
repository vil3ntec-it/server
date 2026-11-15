// ---------------------------------------------------------------------------
//  پرچم‌های فروشگاه، ۱.۵۱.۱ — «حالتِ تغییر» (sudo) و تغییرِ دسته‌ای، روی پنلِ واقعی با سرورِ حسابِ ساختگیِ **حالت‌دار**
//      node test/console-flags-batch.mjs
//
//  دستورِ صاحب سامانه: «یک بار رمز رو می‌زنم و هر کدوم رو خواستم روشن یا خاموش کنم.»
//   ۱) پنجره پس از احرازِ دوبارهٔ کامل باز می‌شود (رمز، و کد اگر دوعاملی روشن است) و به **همین نشست** بسته است
//   ۲) در پنجره تغییرِ پرچمِ پرخطر رمز نمی‌خواهد — دسته‌ای و تکی؛ هر تغییر پنجره را می‌لغزاند
//   ۳) پانزده دقیقه بی‌کاری ⇒ بسته؛ سقفِ سخت ِ شصت دقیقه ⇒ بسته حتی با کارِ پیوسته (ساعتِ ردیفِ نشست جابه‌جا می‌شود)
//   ۴) بیرون رفتن، «بستن»، «خروج از همه»، عوض کردنِ رمز و روشن شدنِ دوعاملی ⇒ بسته
//   ۵) دسته همه یا هیچ: شکستِ یکی ⇒ برگشتِ همه (سرورِ ساختگی حالت را نگه می‌دارد)؛ برگشتِ ناموفق ⇒ «ماند» ِ دقیق
//   ۶) دفتر: یک ردیف برای هر پرچم با دلیلِ مشترک و شناسهٔ دسته
//   ۷) نوشتنِ تأیید فقط برای همهٔ دکان‌ها یا پرچمِ پرخطر (یک پرچم ⇒ نامش؛ چند ⇒ scope)؛ همان قاعده در وب
//   ۸) رمزِ غلط همان سقف و همان ردیفِ `account.console.reauth_failed` را دارد — حتی با پنجرهٔ باز
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PANEL = Number(process.env.TEST_PORT || 4981);
const PUBLIC = PANEL + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'flags-batch-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'unit');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 1200)}`);
};

/* ── ۰) قاعده‌های خالص: پنجره (auth.js)، متنِ تأیید (سرور ⇄ وب) ── */
console.log('\n── ۰) قاعده‌های خالص ──');
const auth = await import('../src/auth.js');
const { flagConfirmPhrase, isRiskyFlag } = await import('../src/modules/shop/routes/console-shell.js');
const web = await import(new URL('file://' + path.join(here, '..', '..', 'web', 'src', 'modules', 'shop', 'consoleData.ts')).href);
const MIN = 60_000;
const T0 = 1_800_000_000_000;
check('پانزده دقیقه و شصت دقیقه', auth.SUDO_IDLE_MS === 15 * MIN && auth.SUDO_MAX_MS === 60 * MIN);
check('بی ردیف یا بی زمان ⇒ بسته', !auth.sudoFromRow(null, T0).open && !auth.sudoFromRow({ sudo_at: null, sudo_seen: T0 }, T0).open);
const r1 = auth.sudoFromRow({ sudo_at: T0, sudo_seen: T0 }, T0 + 14 * MIN);
check('۱۴ دقیقه پس از باز شدن ⇒ باز، تا ۱۵ دقیقه پس از آخرین کار', r1.open && r1.until === T0 + 15 * MIN && r1.hardUntil === T0 + 60 * MIN, JSON.stringify(r1));
check('⛔ درست ۱۵ دقیقه بی‌کاری ⇒ بسته', !auth.sudoFromRow({ sudo_at: T0, sudo_seen: T0 }, T0 + 15 * MIN).open);
check('لغزان: کار در دقیقهٔ ۵۰ ⇒ تا دقیقهٔ ۶۰ باز (نه ۶۵)', auth.sudoFromRow({ sudo_at: T0, sudo_seen: T0 + 50 * MIN }, T0 + 59 * MIN).until === T0 + 60 * MIN);
check('⛔ سقفِ سخت: دقیقهٔ ۶۰ ⇒ بسته حتی با کارِ یک دقیقه پیش', !auth.sudoFromRow({ sudo_at: T0, sudo_seen: T0 + 59 * MIN }, T0 + 60 * MIN).open);
const phraseCases = [
  ['all', []], ['all', ['shop.chat']], ['all', ['shop.chat', 'shop.receipt_v2']], ['s1', ['shop.orders']],
  ['s1', ['shop.orders', 'shop.delivery']], ['security', ['hashchain.audit']], ['s1', ['shop.orders', 'shop.orders']],
];
check('متنِ تأیید: هیچ ⇒ null · یکی ⇒ نامِ کلید · چند ⇒ scope',
  flagConfirmPhrase('all', []) === null && flagConfirmPhrase('all', ['shop.chat']) === 'shop.chat'
    && flagConfirmPhrase('all', ['a.b', 'c.d']) === 'all' && flagConfirmPhrase('s1', ['shop.orders', 'shop.delivery']) === 's1'
    && flagConfirmPhrase('s1', ['shop.orders', 'shop.orders']) === 'shop.orders');
check('⛔ وب و سرور یک قاعده: متنِ تأیید و پرخطر', typeof web.flagConfirmPhrase === 'function' && typeof web.flagRisky === 'function'
  && phraseCases.every(([s, k]) => web.flagConfirmPhrase(s, k) === flagConfirmPhrase(s, k))
  && ['shop.chat', 'shop.orders', 'shop.orders.refunds', 'shop.delivery', 'shop.storefront', 'hashchain.audit', 'market.directory', 'image_bank.central']
    .every((k) => ['all', 's1', 'security', 'ops'].every((s) => web.flagRisky(k, s) === isRiskyFlag(k, s))));

/* ── ۱) سرورِ حسابِ ساختگیِ حالت‌دار ── */
const NOW = Date.now();
const seen = [];
const known = [
  { key: 'shop.receipt_v2', scope: 'shop', default: false, what: 'فاکتورِ نسخهٔ ۲' },
  { key: 'shop.chat', scope: 'shop', default: false, what: 'گفت‌وگو با مشتری' },
  { key: 'shop.promo_stamp', scope: 'shop', default: false, what: 'نشانِ تخفیف' },
  { key: 'shop.orders', scope: 'shop', default: false, what: 'سفارشِ آنلاین' },
  { key: 'shop.delivery', scope: 'shop', default: false, what: 'تحویل و پیک' },
  { key: 'image_bank.central', scope: 'all', default: false, what: 'بانکِ تصاویر' },
  { key: 'hashchain.audit', scope: 'security', default: false, what: 'زنجیره' },
  { key: 'beta.shops', scope: 'release', default: [], what: 'کانالِ آزمایشی' },
];
/** حالِ واقعیِ `live_config` ِ ساختگی: scope ⇒ key ⇒ مقدار */
const store = new Map([['all', new Map([['shop.receipt_v2', true]])], ['s1', new Map([['shop.chat', false]])]]);
const scopeMap = (s) => { if (!store.has(s)) store.set(s, new Map()); return store.get(s); };
const snapshot = () => JSON.stringify([...store].map(([s, m]) => [s, [...m].sort()]).sort());
let failPut = new Map();        // key ⇒ کدِ وضعیت برای PUT
let failRestore = new Set();    // کلیدهایی که «برگشتِ خودکار» شان هم نمی‌نشیند

const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    const err = (code, c, message = 'خطا') => j(code, { error: { code: c, message } });
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '9.9.9' });
    if (p === '/api/admin/stamps') return j(200, {});
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body });
    const M = `${req.method} ${p}`;
    if (M === 'POST /api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (M === 'GET /api/admin/me') return j(200, { admin: { id: 'adm-bridge', username: 'boss', role: 'superadmin' }, capabilities: ['flags.v1', 'actor.v1'], serverTime: NOW });
    if (M === 'GET /api/admin/flags') {
      const scope = u.searchParams.get('scope') || 'all';
      return j(200, { scope, version: 1, known, reserved: [], items: [...scopeMap(scope)].map(([key, value]) => ({ key, value, updatedAt: NOW, updatedBy: 'x' })) });
    }
    if (M === 'PUT /api/admin/flags') {
      const restoring = /^برگشتِ خودکارِ دستهٔ fb-/.test(body?.reason || '');
      if (restoring && failRestore.has(body.key)) return err(500, 'db_unavailable', 'پایگاه در دسترس نیست');
      if (!restoring && failPut.has(body.key)) {
        const st = failPut.get(body.key);
        //  ۵۰۰ ⇒ «شاید نشست»: عمداً می‌نشیند و بعد خطا می‌دهد (بدترین حالت)
        if (st >= 500) scopeMap(body.scope).set(body.key, body.value);
        return err(st, st >= 500 ? 'db_unavailable' : 'bad_flag_scope', 'نشد');
      }
      scopeMap(body.scope).set(body.key, body.value);
      return j(200, { ok: true, scope: body.scope, key: body.key, value: body.value, version: 2 });
    }
    if (M === 'DELETE /api/admin/flags') {
      const restoring = /^برگشتِ خودکارِ دستهٔ fb-/.test(body?.reason || '');
      if (restoring && failRestore.has(body.key)) return err(500, 'db_unavailable', 'پایگاه در دسترس نیست');
      const removed = scopeMap(body.scope).delete(body.key);
      return j(200, { ok: true, scope: body.scope, key: body.key, removed, version: 2 });
    }
    return err(404, 'route_not_found', 'این مسیرِ مدیر روی این سرور نیست');
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${fake.address().port}`;

/* ── ۲) پنلِ واقعی ── */
const env = { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
  HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
  HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_AUTOMATION: '0',
  HLP_STATIONS: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: FAKE,
  HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_AUTH_RATE_LIMIT: '100000', HLP_RATE_API: '100000' };
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], { cwd: path.join(here, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const { DatabaseSync } = await import('node:sqlite');
const sql = (q, ...args) => {
  const d = new DatabaseSync(path.join(tmp, 'data', 'panel.db'));
  try { d.exec('PRAGMA busy_timeout = 5000'); const st = d.prepare(q); return /^\s*select/i.test(q) ? st.all(...args) : st.run(...args); } finally { d.close(); }
};
/** نشستِ «کهنه»: نه ورودِ تازه، نه پنجرهٔ باز */
const stale = () => sql('UPDATE sessions SET auth_at = 0, sudo_at = NULL, sudo_seen = NULL');
const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* غیرِ JSON */ }
  return { status: res.status, json };
}
const waitUp = async () => {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
};
const PW = 'Flags-1405-owner';
const audits = async (token, q) => (await api('GET', `/api/control/audit?q=${encodeURIComponent(q)}&limit=200`, undefined, token)).json?.rows || [];
const writes = (from) => seen.slice(from).filter((c) => c.method !== 'GET');
let idem = 0;
const batch = (b, tok) => api('POST', '/api/account-admin/console/flags/batch',
  { reason: 'روشن کردنِ گروهی', confirm: true, idempotencyKey: `flags-batch-${++idem}-${Date.now()}`, ...b }, tok);
const sudo = (tok) => api('GET', '/api/account-admin/console/flags/sudo', undefined, tok);

try {
  await waitUp();
  await api('POST', '/api/auth/setup', { username: 'owner1', password: PW });
  const login = async (u, p) => (await api('POST', '/api/auth/login', { username: u, password: p })).json?.token;
  const T = { admin: await login('owner1', PW) };
  for (const [u, role] of [['adm2', 'admin'], ['adm3', 'admin'], ['op1', 'operator'], ['view1', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Flags-${u}-1405`, role }, T.admin);
  }
  T.admin2 = await login('adm2', 'Flags-adm2-1405');
  T.admin3 = await login('adm3', 'Flags-adm3-1405');
  T.operator = await login('op1', 'Flags-op1-1405');
  T.viewer = await login('view1', 'Flags-view1-1405');
  check('پنج نشست', Object.values(T).every(Boolean));

  /* ── نقش ── */
  console.log('\n── نقش ──');
  let n = seen.length;
  const vb = await batch({ scope: 's1', changes: [{ key: 'shop.receipt_v2', value: true }] }, T.viewer);
  const ob = await batch({ scope: 's1', changes: [{ key: 'shop.receipt_v2', value: true }] }, T.operator);
  const vs = await api('POST', '/api/account-admin/console/flags/sudo', { password: 'Flags-view1-1405' }, T.viewer);
  check('⛔ viewer و operator: دسته و پنجره ۴۰۳، بی هیچ درخواست به سرورِ حساب', vb.status === 403 && ob.status === 403 && vs.status === 403 && seen.length === n,
    `${vb.status} ${ob.status} ${vs.status}`);

  /* ── ۱) بی پنجره ── */
  console.log('\n── ۱) پنجرهٔ بسته ⇒ رمز ──');
  stale();
  check('GET ‎flags/sudo‎ ⇒ بسته، با ۱۵ و ۶۰ دقیقه', await sudo(T.admin).then((r) => r.status === 200 && r.json?.open === false && r.json.idleMs === 15 * MIN && r.json.maxMs === 60 * MIN));
  n = seen.length;
  const noPw = await batch({ scope: 'all', changes: [{ key: 'shop.chat', value: true }, { key: 'shop.promo_stamp', value: true }], confirmText: 'all' }, T.admin);
  check('⛔ دستهٔ «همهٔ دکان‌ها» بی رمز و بی پنجره ⇒ ۴۰۳ reauth_required و هیچ نوشتن', noPw.status === 403 && noPw.json?.error === 'reauth_required' && writes(n).length === 0, JSON.stringify(noPw));
  const lowShop = await batch({ scope: 's1', changes: [{ key: 'shop.receipt_v2', value: true }, { key: 'shop.chat', value: true }] }, T.admin);
  check('یک دکان، پرچمِ کم‌خطر ⇒ بی رمز و بی نوشتنِ تأیید (فقط خلاصه)', lowShop.status === 200 && lowShop.json?.count === 2 && store.get('s1').get('shop.chat') === true, JSON.stringify(lowShop.json));
  check('…و این پنجره را باز نکرد', (await sudo(T.admin)).json?.open === false);

  /* ── ۲) باز شدن پس از احرازِ دوباره ── */
  console.log('\n── ۲) باز شدن و کار در پنجره ──');
  const op = await api('POST', '/api/account-admin/console/flags/sudo', { password: PW }, T.admin);
  const st1 = await sudo(T.admin);
  check('رمزِ درست ⇒ پنجره باز، تا ۱۵ دقیقه (لغزان) و سقفِ ۶۰', op.status === 200 && op.json?.open === true && st1.json?.open === true
    && Math.abs(st1.json.until - (st1.json.openedAt + 15 * MIN)) < 5 && st1.json.hardUntil === st1.json.openedAt + 60 * MIN, JSON.stringify(st1.json));
  check('ردیفِ دفتر: account.flag.sudo_opened', (await audits(T.admin, 'account.flag.sudo_opened')).length === 1);
  check('⛔ به همین نشست بسته است: نشستِ دیگرِ همان کاربر بسته می‌بیند', (await sudo(await login('owner1', PW))).json?.open === false);
  n = seen.length;
  const before = snapshot();
  const allNoKey = await batch({ scope: 'all', changes: [{ key: 'shop.chat', value: true }, { key: 'shop.promo_stamp', value: true }, { key: 'shop.receipt_v2', value: false }] }, T.admin);
  check('⛔ «همهٔ دکان‌ها» در پنجره هم نوشتنِ تأیید می‌خواهد ⇒ ۴۰۰ confirm_text_required با «all»',
    allNoKey.status === 400 && allNoKey.json?.error === 'confirm_text_required' && allNoKey.json?.expected === 'all' && writes(n).length === 0, JSON.stringify(allNoKey.json));
  const allOk = await batch({ scope: 'all', changes: [{ key: 'shop.chat', value: true }, { key: 'shop.promo_stamp', value: true }, { key: 'shop.receipt_v2', value: false }], confirmText: 'all' }, T.admin);
  const w = writes(n);
  check('در پنجره: سه پرچمِ «همهٔ دکان‌ها» بی رمز ⇒ ۲۰۰، یک درخواست به پنل، سه PUT', allOk.status === 200 && allOk.json?.count === 3 && w.length === 3
    && w.every((x) => x.method === 'PUT' && x.body.scope === 'all' && x.body.reason === 'روشن کردنِ گروهی'), JSON.stringify(allOk.json));
  check('حالِ سرورِ حساب درست عوض شد', store.get('all').get('shop.chat') === true && store.get('all').get('shop.promo_stamp') === true && store.get('all').get('shop.receipt_v2') === false && snapshot() !== before);
  const rows = (await audits(T.admin, allOk.json?.batchId || 'x')).filter((r) => /"batch":"fb-/.test(r.detail || ''));
  check('دفتر: یک ردیف برای هر پرچم، دلیلِ مشترک، شناسهٔ دسته، «پیشین ⇒ تازه» و viaSudo',
    rows.length === 3 && rows.every((r) => r.action === 'account.flag.set' && r.detail.includes(allOk.json.batchId) && r.detail.includes('روشن کردنِ گروهی') && /"viaSudo":true/.test(r.detail))
      && rows.some((r) => /"key":"shop.receipt_v2"/.test(r.detail) && /"from":true/.test(r.detail) && /"to":false/.test(r.detail)), JSON.stringify(rows.map((r) => r.detail)));
  check('⛔ رمز در دفتر نیست', !JSON.stringify(await audits(T.admin, 'account.flag')).includes(PW));
  //  لغزان: آخرین کار ۱۴ دقیقه پیش ⇒ هنوز باز؛ کارِ تازه ⇒ «تا» جلو می‌رود
  sql('UPDATE sessions SET sudo_seen = ? WHERE sudo_at IS NOT NULL', Date.now() - 14 * MIN);
  const preSlide = (await sudo(T.admin)).json;
  const one = await api('PUT', '/api/account-admin/console/flags', { scope: 'all', key: 'shop.chat', value: false, reason: 'تکی در پنجره', confirm: true, confirmKey: 'shop.chat', idempotencyKey: `single-${Date.now()}` }, T.admin);
  const postSlide = (await sudo(T.admin)).json;
  check('⛔ درِ تکیِ پیشین هم در پنجره بی رمز (همان شکلِ پاسخ)', one.status === 200 && one.json?.confirmedByServer === true && one.json?.to === false, JSON.stringify(one.json));
  check('لغزان: کارِ تازه پنجره را جلو برد (۱۴ دقیقه بی‌کاری ⇒ باز؛ پس از کار ⇒ ~۱۵ دقیقهٔ تازه)',
    preSlide?.open === true && postSlide?.open === true && postSlide.until - preSlide.until > 13 * MIN, `${preSlide?.until} → ${postSlide?.until}`);
  const tiny = await batch({ scope: 'all', changes: [{ key: 'shop.chat', reset: true }], confirmText: 'shop.chat' }, T.admin);
  check('یک پرچمِ «همهٔ دکان‌ها» ⇒ نوشتنِ نامِ همان کلید؛ بازگشت به پیش‌فرض = DELETE', tiny.status === 200 && tiny.json?.applied?.[0]?.reset === true && !store.get('all').has('shop.chat'), JSON.stringify(tiny.json));
  const twoDanger = await batch({ scope: 's1', changes: [{ key: 'shop.orders', value: true }, { key: 'shop.delivery', value: true }, { key: 'shop.promo_stamp', value: true }] }, T.admin);
  check('یک دکان با دو پرچمِ پول/سفارش ⇒ نوشتنِ شناسهٔ همان دکان', twoDanger.status === 400 && twoDanger.json?.expected === 's1', JSON.stringify(twoDanger.json));
  const twoOk = await batch({ scope: 's1', changes: [{ key: 'shop.orders', value: true }, { key: 'shop.delivery', value: true }, { key: 'shop.promo_stamp', value: true }], confirmText: 's1' }, T.admin);
  check('…و با آن ⇒ ۲۰۰ در پنجره', twoOk.status === 200 && store.get('s1').get('shop.orders') === true);

  /* ── ۳) بسته شدن ── */
  console.log('\n── ۳) بسته شدن ──');
  sql('UPDATE sessions SET sudo_seen = ? WHERE sudo_at IS NOT NULL', Date.now() - 15 * MIN - 1000);
  sql('UPDATE sessions SET auth_at = 0');
  n = seen.length;
  const idle = await batch({ scope: 'all', changes: [{ key: 'shop.promo_stamp', value: false }], confirmText: 'shop.promo_stamp' }, T.admin);
  check('⛔ ۱۵ دقیقه بی‌کاری ⇒ بسته؛ دسته بی رمز ⇒ ۴۰۳ reauth_required و هیچ نوشتن', (await sudo(T.admin)).json?.open === false && idle.status === 403 && idle.json?.error === 'reauth_required' && writes(n).length === 0, JSON.stringify(idle.json));
  //  دوباره باز، بعد سقفِ سخت: باز شده ۶۰ دقیقه پیش، آخرین کار همین حالا
  const withPw = await batch({ scope: 'all', changes: [{ key: 'shop.promo_stamp', value: false }], confirmText: 'shop.promo_stamp', password: PW }, T.admin);
  check('رمزِ همراهِ دسته ⇒ کار انجام و پنجره دوباره باز', withPw.status === 200 && withPw.json?.sudo?.open === true && (await sudo(T.admin)).json?.open === true, JSON.stringify(withPw.json));
  sql('UPDATE sessions SET sudo_at = ?, sudo_seen = ? WHERE sudo_at IS NOT NULL', Date.now() - 60 * MIN - 1000, Date.now() - 1000);
  sql('UPDATE sessions SET auth_at = 0');
  n = seen.length;
  const hard = await batch({ scope: 'all', changes: [{ key: 'shop.promo_stamp', value: true }], confirmText: 'shop.promo_stamp' }, T.admin);
  check('⛔ سقفِ سخت ِ ۶۰ دقیقه ⇒ بسته حتی با کارِ یک ثانیه پیش', (await sudo(T.admin)).json?.open === false && hard.status === 403 && writes(n).length === 0, JSON.stringify(hard.json));
  check('⛔ «لغزاندن» پنجرهٔ بسته را زنده نمی‌کند', (await api('PUT', '/api/account-admin/console/flags', { scope: 'all', key: 'shop.chat', value: true, reason: 'آزمون', confirm: true, confirmKey: 'shop.chat', idempotencyKey: `single-h-${Date.now()}` }, T.admin)).status === 403
    && (await sudo(T.admin)).json?.open === false);
  //  «بستن»
  await api('POST', '/api/account-admin/console/flags/sudo', { password: PW }, T.admin);
  const cl = await api('DELETE', '/api/account-admin/console/flags/sudo', undefined, T.admin);
  sql('UPDATE sessions SET auth_at = 0');
  check('«بستن» ⇒ بسته، با ردیفِ دفتر', cl.status === 200 && cl.json?.open === false && (await sudo(T.admin)).json?.open === false
    && (await audits(T.admin, 'account.flag.sudo_closed')).length === 1);
  //  بیرون رفتن
  const T4 = await login('owner1', PW);
  await api('POST', '/api/account-admin/console/flags/sudo', { password: PW }, T4);
  const sidOpen = sql('SELECT COUNT(*) AS n FROM sessions WHERE sudo_at IS NOT NULL')[0].n;
  await api('POST', '/api/auth/logout', {}, T4);
  check('⛔ بیرون رفتن ⇒ نشست و پنجره‌اش رفت (توکنِ کهنه ۴۰۱)', sidOpen === 1 && sql('SELECT COUNT(*) AS n FROM sessions WHERE sudo_at IS NOT NULL')[0].n === 0
    && (await sudo(T4)).status === 401);
  //  «خروج از همه»
  await api('POST', '/api/account-admin/console/flags/sudo', { password: PW }, T.admin);
  await api('POST', '/api/auth/logout-all', {}, T.admin);
  check('⛔ «خروج از همه» ⇒ پنجرهٔ همین نشست هم بسته', (await sudo(T.admin)).json?.open === false);
  //  عوض کردنِ رمز (adm3)
  await api('POST', '/api/account-admin/console/flags/sudo', { password: 'Flags-adm3-1405' }, T.admin3);
  const chp = await api('POST', '/api/auth/change-password', { oldPassword: 'Flags-adm3-1405', newPassword: 'Flags-adm3-1406' }, T.admin3);
  check('⛔ عوض کردنِ رمز ⇒ همهٔ نشست‌ها و پنجره‌شان رفت', chp.status === 200 && (await sudo(T.admin3)).status === 401);

  /* ── ۴) دوعاملی ── */
  console.log('\n── ۴) دوعاملی ──');
  const { totp } = await import('../src/lib/totp.js');
  T.admin3 = await login('adm3', 'Flags-adm3-1406');
  await api('POST', '/api/account-admin/console/flags/sudo', { password: 'Flags-adm3-1406' }, T.admin3);
  const wasOpen = (await sudo(T.admin3)).json?.open === true;
  const setup = await api('POST', '/api/auth/totp/setup', {}, T.admin3);
  const en = await api('POST', '/api/auth/totp/enable', { code: totp(setup.json?.secret) }, T.admin3);
  check('⛔ روشن شدنِ دوعاملی ⇒ پنجرهٔ باز بسته شد', wasOpen && en.status === 200 && (await sudo(T.admin3)).json?.open === false, `${wasOpen} ${en.status}`);
  const pwOnly = await api('POST', '/api/account-admin/console/flags/sudo', { password: 'Flags-adm3-1406' }, T.admin3);
  check('⛔ با دوعاملی، رمزِ تنها پنجره را باز نمی‌کند (کد می‌خواهد)', pwOnly.json?.totpRequired === true && pwOnly.status !== 200 && (await sudo(T.admin3)).json?.open === false, JSON.stringify(pwOnly));
  const withCode = await api('POST', '/api/account-admin/console/flags/sudo', { password: 'Flags-adm3-1406', code: totp(setup.json?.secret, Date.now() + 30_000) }, T.admin3);
  check('رمز + کد ⇒ باز', withCode.status === 200 && withCode.json?.open === true, JSON.stringify(withCode));

  /* ── ۵) همه یا هیچ ── */
  console.log('\n── ۵) همه یا هیچ ──');
  await api('POST', '/api/account-admin/console/flags/sudo', { password: PW }, T.admin);
  store.get('all').set('shop.chat', false);
  store.get('all').delete('shop.promo_stamp');
  let snap = snapshot();
  failPut = new Map([['shop.receipt_v2', 400]]);
  n = seen.length;
  const rb = await batch({ scope: 'all', changes: [{ key: 'shop.chat', value: true }, { key: 'shop.promo_stamp', value: true }, { key: 'shop.receipt_v2', value: true }], confirmText: 'all' }, T.admin);
  check('⛔ سومی رد شد ⇒ ۴۰۰ batch_rolled_back، دوتای نشسته برگشتند، حالِ سرورِ حساب همان پیشین',
    rb.status === 400 && rb.json?.error === 'batch_rolled_back' && rb.json?.cause?.key === 'shop.receipt_v2' && snapshot() === snap
      && JSON.stringify(rb.json?.rolledBack) === JSON.stringify(['shop.promo_stamp', 'shop.chat']), `${rb.status} ${JSON.stringify(rb.json)} ${snapshot()}`);
  const rbw = writes(n);
  check('برگرداندن: مقدارِ پیشین با PUT، «نوشته نبود» با DELETE، دلیلِ «برگشتِ خودکارِ دسته»',
    rbw.some((x) => x.method === 'DELETE' && x.body.key === 'shop.promo_stamp' && /برگشتِ خودکارِ دستهٔ/.test(x.body.reason))
      && rbw.some((x) => x.method === 'PUT' && x.body.key === 'shop.chat' && x.body.value === false && /برگشتِ خودکار/.test(x.body.reason)), JSON.stringify(rbw));
  const rbRows = await audits(T.admin, rb.json?.batchId || 'x');
  check('دفتر: هیچ ردیفِ «set» برای دستهٔ برگشته؛ یک ردیفِ batch_rolled_back', rbRows.length === 1 && rbRows[0].action === 'account.flag.batch_rolled_back', JSON.stringify(rbRows));
  //  خطای «مبهم» (۵۰۰ پس از نشستن) ⇒ همان هم برمی‌گردد
  failPut = new Map([['shop.receipt_v2', 500]]);
  const before5 = store.get('all').get('shop.receipt_v2');
  const rb5 = await batch({ scope: 'all', changes: [{ key: 'shop.chat', value: true }, { key: 'shop.receipt_v2', value: !before5 }], confirmText: 'all' }, T.admin);
  check('⛔ ۵۰۰ ِ «شاید نشست» ⇒ همان پرچم هم برگشت (۵۰۲)', rb5.status === 502 && rb5.json?.error === 'batch_rolled_back' && snapshot() === snap
    && rb5.json?.rolledBack?.includes('shop.receipt_v2'), `${JSON.stringify(rb5.json)} ${snapshot()}`);
  //  برگرداندنِ یکی هم نشد ⇒ «ماند» ِ دقیق
  failPut = new Map([['shop.receipt_v2', 400]]);
  failRestore = new Set(['shop.promo_stamp']);
  const pt = await batch({ scope: 'all', changes: [{ key: 'shop.chat', value: true }, { key: 'shop.promo_stamp', value: true }, { key: 'shop.receipt_v2', value: true }], confirmText: 'all' }, T.admin);
  check('⛔ برگرداندنِ یکی نشد ⇒ ۵۰۲ batch_partial و دقیقاً همان در stillChanged', pt.status === 502 && pt.json?.error === 'batch_partial'
    && JSON.stringify(pt.json?.stillChanged?.map((x) => x.key)) === JSON.stringify(['shop.promo_stamp']) && store.get('all').get('shop.promo_stamp') === true
    && store.get('all').get('shop.chat') === false, JSON.stringify(pt.json));
  const ptRows = await audits(T.admin, pt.json?.batchId || 'x');
  check('دفتر: آن‌چه ماند ردیفِ خودش را دارد (partial) + یک batch_partial', ptRows.length === 2 && ptRows.some((r) => r.action === 'account.flag.set' && r.result === 'partial' && /shop.promo_stamp/.test(r.detail))
    && ptRows.some((r) => r.action === 'account.flag.batch_partial'), JSON.stringify(ptRows));
  failPut = new Map();
  failRestore = new Set();
  store.get('all').delete('shop.promo_stamp');
  snap = snapshot();
  n = seen.length;
  const pre = await batch({ scope: 's1', changes: [{ key: 'shop.chat', value: true }, { key: 'image_bank.central', value: true }] }, T.admin);
  check('⛔ یکی در scope ِ نادرست ⇒ ۴۰۰ پیش از هر نوشتن (سنجش پیش از نخستین PUT)', pre.status === 400 && pre.json?.error === 'bad_flag_scope' && writes(n).length === 0 && snapshot() === snap, JSON.stringify(pre.json));
  for (const [what, b, code] of [
    ['کلیدِ ناشناخته', { scope: 's1', changes: [{ key: 'shop.nope', value: true }] }, 'unknown_flag'],
    ['فهرستِ کانالِ آزمایشی', { scope: 'release', changes: [{ key: 'beta.shops', value: true }] }, 'use_versions_module'],
    ['مقدارِ رشته', { scope: 's1', changes: [{ key: 'shop.chat', value: 'true' }] }, 'bad_flag_value'],
    ['کلیدِ تکراری', { scope: 's1', changes: [{ key: 'shop.chat', value: true }, { key: 'shop.chat', value: false }] }, 'duplicate_flag'],
    ['دستهٔ خالی', { scope: 's1', changes: [] }, 'no_changes'],
    ['بی scope', { changes: [{ key: 'shop.chat', value: true }] }, 'bad_flag_scope'],
    ['دلیلِ کوتاه', { scope: 's1', changes: [{ key: 'shop.chat', value: true }], reason: 'ab' }, 'reason_required'],
    ['بی تأیید', { scope: 's1', changes: [{ key: 'shop.chat', value: true }], confirm: false }, 'confirm_required'],
    ['بیش از ۱۰۰', { scope: 's1', changes: Array.from({ length: 101 }, (_, i) => ({ key: `k.${i}`, value: true })) }, 'too_many_changes'],
  ]) {
    const x = await batch(b, T.admin);
    check(`⛔ ${what} ⇒ ۴۰۰ ${code}`, x.status === 400 && x.json?.error === code, `${x.status} ${JSON.stringify(x.json)}`);
  }
  check('⛔ هیچ‌کدام چیزی ننوشت', writes(n).length === 0);
  //  کلیدِ یکتایی: همان دسته دو بار ⇒ یک بار نوشتن
  n = seen.length;
  const body = { scope: 's1', changes: [{ key: 'shop.promo_stamp', value: true }], reason: 'دوبار زدن', confirm: true, idempotencyKey: 'flags-batch-same-0001' };
  const [d1, d2] = await Promise.all([api('POST', '/api/account-admin/console/flags/batch', body, T.admin), api('POST', '/api/account-admin/console/flags/batch', body, T.admin)]);
  check('⛔ دوکلیک (همان کلیدِ یکتایی) ⇒ یک PUT و همان شناسهٔ دسته', d1.status === 200 && d2.status === 200 && d1.json?.batchId === d2.json?.batchId
    && writes(n).filter((x) => x.method === 'PUT').length === 1, `${JSON.stringify(d1.json)} ${JSON.stringify(d2.json)}`);

  /* ── ۶) رمزِ غلط و سقف ── */
  console.log('\n── ۶) رمزِ غلط ⇒ همان سقف ──');
  stale();
  await api('POST', '/api/account-admin/console/flags/sudo', { password: 'Flags-adm2-1405' }, T.admin2);
  check('admin ِ دوم پنجره‌اش را باز کرد', (await sudo(T.admin2)).json?.open === true);
  n = seen.length;
  const codes = [];
  for (let i = 0; i < 5; i++) {
    const x = i % 2
      ? await api('POST', '/api/account-admin/console/flags/sudo', { password: `wrong-${i}` }, T.admin2)
      : await batch({ scope: 'all', changes: [{ key: 'shop.chat', value: true }], confirmText: 'shop.chat', password: `wrong-${i}` }, T.admin2);
    codes.push(`${x.status}:${x.json?.error}`);
  }
  check('⛔ رمزِ غلط حتی با پنجرهٔ باز ⇒ ۴۰۳ reauth_failed (دسته و درِ پنجره)', codes.every((c) => c === '403:reauth_failed'), codes.join(' '));
  const failedRows = (await audits(T.admin, 'account.console.reauth_failed')).filter((r) => r.actor === 'adm2');
  check('هر کدام یک ردیفِ account.console.reauth_failed (همان شمارشِ پیشین)', failedRows.length === 5, String(failedRows.length));
  const locked = await api('POST', '/api/account-admin/console/flags/sudo', { password: 'Flags-adm2-1405' }, T.admin2);
  const lockedB = await batch({ scope: 'all', changes: [{ key: 'shop.chat', value: true }], confirmText: 'shop.chat', password: 'Flags-adm2-1405' }, T.admin2);
  check('⛔ پنجمین شکست ⇒ ۴۲۹ حتی با رمزِ درست، و هیچ نوشتن', locked.status === 429 && lockedB.status === 429 && writes(n).length === 0, `${locked.status} ${lockedB.status}`);

  /* ── ۷) درِ تکیِ پیشین بی پنجره ── */
  console.log('\n── ۷) صداکننده‌های کهنه ──');
  stale();
  const legacy = await api('PUT', '/api/account-admin/console/flags', { scope: 'all', key: 'shop.chat', value: true, reason: 'راهِ پیشین', confirm: true, confirmKey: 'shop.chat', password: PW, idempotencyKey: `legacy-${Date.now()}` }, T.admin);
  check('درِ تکی با رمز و نامِ کلید ⇒ همان پاسخِ پیشین', legacy.status === 200 && legacy.json?.confirmedByServer === true && legacy.json?.key === 'shop.chat' && legacy.json?.scope === 'all', JSON.stringify(legacy.json));
  check('…و رمزِ درستِ آن هم پنجره را باز کرد', (await sudo(T.admin)).json?.open === true);
  stale();
  const legacyNoKey = await api('PUT', '/api/account-admin/console/flags', { scope: 'all', key: 'shop.chat', value: false, reason: 'راهِ پیشین', confirm: true, password: PW, idempotencyKey: `legacy-nk-${Date.now()}` }, T.admin);
  check('⛔ درِ تکی: پرخطر بی نامِ کلید همچنان ۴۰۰ confirm_key_required', legacyNoKey.status === 400 && legacyNoKey.json?.error === 'confirm_key_required');

  /* ── ۸) پورتِ عمومی ── */
  const pub = [];
  for (const [m, p] of [['GET', 'flags/sudo'], ['POST', 'flags/sudo'], ['DELETE', 'flags/sudo'], ['POST', 'flags/batch']]) {
    const r = await fetch(`http://127.0.0.1:${PUBLIC}/api/account-admin/console/${p}`, { method: m, headers: { authorization: `Bearer ${T.admin}`, 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' });
    if (r.status !== 404) pub.push(`${m} ${p} ⇒ ${r.status}`);
  }
  check('⛔ هیچ‌کدام روی پورتِ عمومی نیست (۴۰۴)', pub.length === 0, pub.join(' · '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-2000));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
