// ---------------------------------------------------------------------------
//  ممیزی §۳-۴ (۱.۵۰.۷۵): کارکنان/مجوز/دستگاهِ هر دکان و بانکِ عکس — پلِ ‎routes/console-staff.js‎ و ‎console-image-bank.js‎
//      node test/console-staff.mjs
//
//  پنلِ واقعی + سرورِ حسابِ ساختگی با همان شکلِ ‎admin-staff-perms.js‎ و ‎admin-image-bank.js‎ ِ shop (و فیلدهای اضافه‌ای
//  که نباید بیرون بروند). سنجیده می‌شود:
//    • نقش: viewer و operator می‌خوانند، هیچ نوشتنی به سرورِ حساب نمی‌رسانند؛ admin با دلیل + تأیید + کلیدِ یکتایی
//    • IDOR: دستگاهِ دکانِ دیگر با شناسهٔ این دکان ⇒ ‎404 device_not_found‎ ِ سرورِ حساب، شناسهٔ دکان از مسیر
//    • کلیدِ یکتایی (بالادست ندارد): تکرار ⇒ همان پاسخ بی درخواستِ دوم؛ کلید برای کارِ دیگر ⇒ ۴۰۹؛ هم‌زمانی ⇒ ۴۰۹
//    • ورودی: شناسهٔ بد، دلیلِ کوتاه، بی تأیید، کلیدِ بد ⇒ ۴۰۰ پیش از پل؛ سقفِ نرخِ هر کاربر ⇒ ۴۲۹
//    • بی راز و بی پوشهٔ میزبان در پاسخ (توکنِ پوش، ایمیل، ‎consent_by‎، ‎/var/lib‎)؛ نشانیِ فایل فقط درِ همین پل
//    • فایلِ عکس فقط رسترِ شناخته با nosniff و CSP — SVG ⇒ ۴۱۵
//    • سرورِ حسابِ کهنه (بی این در) ⇒ ‎501 account_server_outdated‎، نه دادهٔ ساختگی؛ پرچمِ خاموش ⇒ «روشن نیست»
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4993);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-staff-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی (شکلِ shop) ───────────── */
const NOW = Date.now();
const seen = [];
let bankOn = true;
let disableDelay = 0;
const SHOPS = {
  s1: { members: [{ user_id: 'u1', role: 'owner', name: 'صاحب' }, { user_id: 'u2', role: 'cashier', name: 'صندوق‌دار' }], devices: ['d1', 'd2'] },
  s2: { members: [{ user_id: 'u9', role: 'staff', name: 'دیگری' }], devices: ['d9'] },
};
const DEVOWNER = { d1: 'u2', d2: 'u1', d9: 'u9' };
const staffOf = (id) => ({
  shop: { id, name: `دکانِ ${id}`, owner_email: 'leak@x.af' }, dir: '/var/lib/shop',
  perms: {
    v: 1,
    catalog: [{ key: 'sales.discount', edit: 'restrict', caps: ['maxPct'], approvable: true, display: false, defaults: { owner: 'allow', cashier: 'deny' } }],
    roles: { cashier: { 'sales.discount': { mode: 'approve' } }, manager: {} },
    members: SHOPS[id].members.map((m, i) => ({ id: `m${i}`, userId: m.user_id, name: m.name, role: m.role, status: 'active', email: 'leak@x.af',
      layer: m.role === 'owner' ? {} : { 'sales.discount': { mode: 'allow', caps: { maxPct: 5, evil: 'x' } } },
      effective: { 'sales.discount': { mode: m.role === 'owner' ? 'allow' : 'approve', caps: {} } } })),
  },
  devices: SHOPS[id].devices.map((d) => ({ id: d, name: `گوشی ${d}`, platform: 'android', status: 'active', createdAt: NOW - 9e8, lastSeenAt: NOW - 6e4,
    disabledAt: null, blockedAttempts: 0, lastBlockedAt: null, push_token: 'SECRET-PUSH-TOKEN',
    member: { userId: DEVOWNER[d], role: SHOPS[id].members.find((m) => m.user_id === DEVOWNER[d]).role, name: 'x' } })),
});
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    let body = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { body = null; }
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['actor.v1'], serverTime: NOW });
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body });
    let m = /^\/api\/admin\/shops\/([^/]+)\/staff-perms$/.exec(p);
    if (m && req.method === 'GET') {
      if (m[1] === 'old1') return j(401, { error: { code: 'invalid_token', message: 'نشست' } });   //  سرورِ حسابِ کهنه: مسیر نیست
      return SHOPS[m[1]] ? j(200, staffOf(m[1])) : j(404, { error: { code: 'not_found', message: 'دکان پیدا نشد' } });
    }
    m = /^\/api\/admin\/shops\/([^/]+)\/staff-perms\/devices\/([^/]+)\/disable$/.exec(p);
    if (m && req.method === 'POST') {
      const shop = SHOPS[m[1]];
      if (!shop) return j(404, { error: { code: 'not_found', message: 'دکان پیدا نشد' } });
      //  ⛔ همان ‎deviceOfShop‎ ِ shop: دستگاه باید مالِ یکی از اعضای همین دکان باشد
      if (!shop.devices.includes(m[2])) return j(404, { error: { code: 'device_not_found', message: 'این دستگاه مالِ اعضای این دکان نیست' } });
      return void setTimeout(() => j(200, { ok: true, id: m[2], disabledAt: Date.now(), sessionsRevoked: 2, path: '/var/lib/x' }), disableDelay);
    }
    if (p.startsWith('/api/admin/image-bank/')) {
      const sub = p.slice('/api/admin/image-bank'.length);
      if (sub === '/status') return j(200, { enabled: bankOn, rows_max: 1000, roles: ['main', 'back'], licenses: ['unknown', 'licensed'], resume: false });
      if (!bankOn) return j(403, { error: { code: 'image_bank_disabled', message: 'بانکِ مرکزیِ تصاویر روشن نیست' } });
      if (sub === '/review') {
        return j(200, { items: [
          { id: 'img_1', status: 'NEEDS_REVIEW', space: 'pending', role: 'main', from_shop: true, batch_id: '', created_at: NOW - 6e4, match_status: 'exact',
            match_reasons: ['barcode_exact'], quality_flags: ['low_light'], duplicate_of: [], license: { source: 'shop', status: 'licensed', commercial_use: true },
            product: { id: 'bp1', gtin: '6260000000001', name: 'روغن', brand: 'X', status: 'active' }, candidates: [], version: 1, versions_pending: 0,
            file: { url: '/api/admin/image-bank/file/img_1/1/thumb', mime: 'image/png', width: 400, height: 400 } },
          { id: 'img_2', status: 'NEEDS_REVIEW', space: 'pending', role: 'main', file: { url: 'https://evil.example/x.png', mime: 'image/svg+xml' } },
        ], next_cursor: 'img_2' });
      }
      if (sub === '/images/img_1') {
        return j(200, { id: 'img_1', space: 'pending', status: 'NEEDS_REVIEW', role: 'main', current_version: 1, search_enabled: false, match_status: 'exact',
          license: { source: 'shop', holder: 'دکان', type: 'own', status: 'licensed', commercial_use: true, checked_at: NOW },
          origin: { shop_id: 's1', consent_by: 'u_secret_consenter', consent_at: NOW - 1e5 }, proposal: { candidates: [] }, duplicate_of: [], quality_flags: [],
          versions: [{ version: 1, kind: 'original', review: 'needs_review', mime: 'image/png', size: 12, width: 400, height: 400, hash: 'ab'.repeat(32), created_by: 'adm_x',
            urls: { original: '/api/admin/image-bank/file/img_1/1/original', thumb: '/api/admin/image-bank/file/img_1/1/thumb', display: null, zoom: null } }] });
      }
      if (sub === '/images/img_shop') return j(404, { error: { code: 'not_found', message: 'عکس پیدا نشد' } });
      if (sub === '/search') return j(200, { items: [{ product: { id: 'bp1', name: 'روغن', gtin: '6260000000001' }, match: { kind: 'name_words', certain: false, reasons: ['name_words'] },
        ambiguous: false, distinguish: [], images: [{ id: 'img_1', role: 'main', version: 1, space: 'central', status: 'APPROVED', license_status: 'licensed',
          urls: { thumb: '/api/admin/image-bank/file/img_1/1/thumb', display: null, zoom: null } }] }], next_cursor: null, as_of: NOW, live: true, barcode_valid: null });
      if (sub === '/reports') return j(200, { items: [{ id: 'rep_1', image_id: 'img_1', kind: 'wrong_product', note: 'عکسِ کالای دیگر', status: 'open', created_at: NOW }] });
      if (sub === '/file/img_1/1/thumb') { res.setHeader('content-type', 'image/png'); return res.end(PNG); }
      if (sub === '/file/img_svg/1/thumb') { res.setHeader('content-type', 'image/svg+xml'); return res.end('<svg onload="alert(1)"/>'); }
      const mm = /^\/images\/([^/]+)\/(approve|reject|archive|search)$/.exec(sub);
      if (mm && req.method === 'POST') {
        if (mm[1] === 'img_nolic') return j(409, { error: { code: 'license_required', message: 'مجوزِ استفادهٔ تجاری ثبت نشده' } });
        if (mm[2] === 'search') return j(200, { id: mm[1], search_enabled: body?.enabled === true });
        return j(200, { id: mm[1], status: { approve: 'APPROVED', reject: 'REJECTED', archive: 'ARCHIVED' }[mm[2]], version: 1 });
      }
    }
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

/* ───────────── پنلِ واقعی ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: FAKE_URL, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, headers = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, buf, headers: res.headers };
}
const posts = (re) => seen.filter((s) => s.method === 'POST' && re.test(s.path)).length;
const ST = '/api/account-admin/console/shops';
const IB = '/api/account-admin/console/image-bank';

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Stf-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Stf-1405-owner');
  const H = (t) => ({ Authorization: `Bearer ${t}` });
  for (const [u, role] of [['admin2', 'admin'], ['admin3', 'admin'], ['op1', 'operator'], ['view1', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Stf-${role}-1405-${u}`, role }, H(owner));
  }
  const T = { owner, admin2: await login('admin2', 'Stf-admin-1405-admin2'), admin3: await login('admin3', 'Stf-admin-1405-admin3'),
    op: await login('op1', 'Stf-operator-1405-op1'), view: await login('view1', 'Stf-viewer-1405-view1') };

  console.log('\n── کارکنان و دستگاه‌ها ──');
  const g = await api('GET', `${ST}/s1/staff`, undefined, H(T.view));
  check('viewer پروندهٔ کارکنان را می‌خواند: دو عضو، دو دستگاه، کاتالوگ و لایهٔ نقش',
    g.status === 200 && g.json?.available === true && g.json?.members?.length === 2 && g.json?.devices?.length === 2
      && g.json?.catalog?.[0]?.key === 'sales.discount' && g.json?.roles?.cashier?.['sales.discount']?.mode === 'approve', `${g.status} ${g.text.slice(0, 300)}`);
  check('مجوزِ مؤثر همان سرورِ حساب (نه حسابِ پنل)', g.json?.members?.[1]?.effective?.['sales.discount']?.mode === 'approve'
    && g.json?.members?.[1]?.layer?.['sales.discount']?.caps?.maxPct === 5 && g.json?.members?.[1]?.layer?.['sales.discount']?.caps?.evil === undefined, JSON.stringify(g.json?.members?.[1]));
  check('⛔ بی راز و بی پوشهٔ میزبان: نه توکنِ پوش، نه ایمیل، نه ‎/var/lib‎', !/SECRET-PUSH|leak@x|\/var\/lib/.test(g.text), g.text.slice(0, 300));
  check('«برگرداندنِ دستگاه» صادقانه «پشتیبانی نمی‌شود» با نامِ درِ لازم', (g.json?.notSupported || []).includes('POST /api/admin/shops/:id/staff-perms/devices/:did/enable'));
  const bad = await api('GET', `${ST}/a%20b/staff`, undefined, H(T.view));
  check('شناسهٔ دکانِ بد ⇒ ‎400 bad_id‎، بی پرسش از سرورِ حساب', bad.status === 400 && bad.json?.error === 'bad_id' && !seen.some((s) => s.path.includes('a b')), `${bad.status} ${bad.text.slice(0, 100)}`);
  const nf = await api('GET', `${ST}/zz/staff`, undefined, H(T.view));
  check('دکانِ ناشناخته ⇒ ۴۰۴ ِ خودِ سرورِ حساب با کدش', nf.status === 404 && nf.json?.error === 'not_found', `${nf.status} ${nf.text.slice(0, 100)}`);
  const old = await api('GET', `${ST}/old1/staff`, undefined, H(T.view));
  check('⛔ سرورِ حسابِ کهنه (بی این در) ⇒ ‎501 account_server_outdated‎، نه فهرستِ خالی', old.status === 501 && old.json?.error === 'account_server_outdated', `${old.status} ${old.text.slice(0, 120)}`);

  const DIS = (shop, dev) => `${ST}/${shop}/staff/devices/${dev}/disable`;
  const dBody = (k, extra = {}) => ({ reason: 'گوشیِ گم‌شدهٔ صندوق‌دار', confirm: true, idempotencyKey: `stf-dev-${k}-00001`, ...extra });
  const p0 = posts(/\/disable$/);
  const rv = await api('POST', DIS('s1', 'd1'), dBody('v'), H(T.view));
  const ro = await api('POST', DIS('s1', 'd1'), dBody('o'), H(T.op));
  check('⛔ viewer و operator دستگاه را از کار نمی‌اندازند (۴۰۳) و هیچ درخواستی به سرورِ حساب نمی‌رسد',
    rv.status === 403 && ro.status === 403 && posts(/\/disable$/) === p0, `${rv.status} ${ro.status} ${posts(/\/disable$/) - p0}`);
  const v1 = await api('POST', DIS('s1', 'd1'), dBody('a', { confirm: false }), H(T.admin2));
  const v2 = await api('POST', DIS('s1', 'd1'), dBody('a', { reason: 'ab' }), H(T.admin2));
  const v3 = await api('POST', DIS('s1', 'd1'), dBody('a', { idempotencyKey: '' }), H(T.admin2));
  const v4 = await api('POST', DIS('s1', 'd1'), dBody('a', { idempotencyKey: 'bad key!' }), H(T.admin2));
  const v5 = await api('POST', DIS('s1', '..%2Fx'), dBody('a'), H(T.admin2));
  check('بی تأیید / دلیلِ کوتاه / بی کلید / کلیدِ بد / شناسهٔ دستگاهِ بد ⇒ ۴۰۰ پیش از پل',
    [v1, v2, v3, v4, v5].every((r) => r.status === 400) && v1.json?.error === 'confirm_required' && v2.json?.error === 'reason_required'
      && v3.json?.error === 'idempotency_key_required' && v4.json?.error === 'bad_idempotency_key' && posts(/\/disable$/) === p0,
    [v1, v2, v3, v4, v5].map((r) => `${r.status}:${r.json?.error}`).join(' '));
  const ok = await api('POST', DIS('s1', 'd1'), dBody('a'), H(T.admin2));
  check('admin ⇒ ۲۰۰، «۲ نشست باطل شد»، بدنهٔ بالادست فقط دلیل',
    ok.status === 200 && ok.json?.ok === true && ok.json?.sessionsRevoked === 2 && JSON.stringify(seen.at(-1)?.body) === JSON.stringify({ reason: 'گوشیِ گم‌شدهٔ صندوق‌دار' }) && !ok.text.includes('/var/lib'),
    `${ok.status} ${ok.text.slice(0, 200)}`);
  const again = await api('POST', DIS('s1', 'd1'), dBody('a'), H(T.admin2));
  check('همان کلید ⇒ همان پاسخ با ‎replayed‎، بی درخواستِ دوم', again.status === 200 && again.json?.replayed === true && posts(/\/disable$/) === p0 + 1, `${again.status} ${posts(/\/disable$/) - p0}`);
  const reuse = await api('POST', DIS('s1', 'd1'), dBody('a', { reason: 'دلیلِ دیگر برای همین' }), H(T.admin2));
  check('همان کلید برای کارِ دیگر ⇒ ‎409 idempotency_key_reused‎', reuse.status === 409 && reuse.json?.error === 'idempotency_key_reused', `${reuse.status} ${reuse.json?.error}`);
  const idor = await api('POST', DIS('s1', 'd9'), dBody('idor'), H(T.admin2));
  check('⛔ IDOR: دستگاهِ دکانِ s2 با شناسهٔ s1 ⇒ ‎404 device_not_found‎ ِ سرورِ حساب (شناسهٔ دکان از مسیر)',
    idor.status === 404 && idor.json?.error === 'device_not_found' && seen.at(-1)?.path === '/api/admin/shops/s1/staff-perms/devices/d9/disable', `${idor.status} ${idor.text.slice(0, 120)}`);
  const idorAgain = await api('POST', DIS('s1', 'd9'), dBody('idor'), H(T.admin2));
  check('شکستِ روشن کلید را آزاد می‌کند (همان کلید دوباره به سرورِ حساب می‌رود)', idorAgain.status === 404 && posts(/\/disable$/) === p0 + 3, `${posts(/\/disable$/) - p0}`);
  disableDelay = 300;
  const [c1, c2] = await Promise.all([api('POST', DIS('s1', 'd2'), dBody('c1'), H(T.admin2)), api('POST', DIS('s1', 'd2'), dBody('c2'), H(T.owner))]);
  disableDelay = 0;
  check('⛔ همان دستگاه از دو پنجرهٔ هم‌زمان ⇒ یکی ۲۰۰ و دیگری ‎409 action_in_progress‎',
    [c1.status, c2.status].sort().join(',') === '200,409' && [c1, c2].some((r) => r.json?.error === 'action_in_progress') && posts(/\/disable$/) === p0 + 4,
    `${c1.status} ${c2.status} ${posts(/\/disable$/) - p0}`);
  const aud = await api('GET', '/api/control/audit?q=account.shop_device&limit=20&offset=0', undefined, H(T.owner));
  const arows = (aud.json?.rows || []).filter((r) => r.action === 'account.shop_device.disabled');
  check('دفترِ پنل: یک ردیف برای هر ازکارانداختنِ تأییدشده، با دستگاه و دلیل (تکرار و رد نه)',
    arows.length === 2 && arows.some((r) => r.actor === 'admin2' && String(r.detail).includes('d1') && String(r.detail).includes('گوشیِ گم‌شدهٔ صندوق‌دار')), JSON.stringify(arows).slice(0, 300));
  let limited = null;
  for (let i = 0; i < 32 && !limited; i++) {
    const r = await api('POST', DIS('s1', 'd1'), dBody('rl', { confirm: false }), H(T.admin3));
    if (r.status === 429) limited = i;
  }
  check('⛔ سقفِ نرخِ هر کاربر روی ازکارانداختن ⇒ ۴۲۹ (پس از ۳۰ در ده دقیقه)', limited === 30, `429 at ${limited}`);

  console.log('\n── بانکِ عکس ──');
  const st = await api('GET', `${IB}/status`, undefined, H(T.view));
  check('viewer: «روشن است» با نقش‌ها و مجوزها', st.status === 200 && st.json?.enabled === true && st.json?.roles?.includes('main'), st.text.slice(0, 200));
  const rvw = await api('GET', `${IB}/review?status=NEEDS_REVIEW&space=pending&evil=1`, undefined, H(T.view));
  const it1 = rvw.json?.items?.[0];
  check('صفِ بازبینی: نشانیِ فایل به درِ همین پل بازنویسی شد', rvw.status === 200 && it1?.file?.url === '/api/account-admin/console/image-bank/file/img_1/1/thumb' && it1?.fromShop === true, rvw.text.slice(0, 300));
  check('⛔ نشانیِ بیرونی و نوعِ ناشناخته (SVG) ⇒ null/خالی، نه پیوند', rvw.json?.items?.[1]?.file?.url === null && rvw.json?.items?.[1]?.file?.mime === '', JSON.stringify(rvw.json?.items?.[1]));
  check('فقط پارامترهای شناخته بالا رفت', !('evil' in (seen.filter((s) => s.path === '/api/admin/image-bank/review').at(-1)?.query || {})), JSON.stringify(seen.at(-1)));
  const badQ = await api('GET', `${IB}/review?status=DROP`, undefined, H(T.view));
  check('وضعیتِ ناشناخته ⇒ ۴۰۰', badQ.status === 400 && badQ.json?.error === 'bad_status', `${badQ.status}`);
  const det = await api('GET', `${IB}/images/img_1`, undefined, H(T.view));
  check('جزئیات: نسخه‌ها، مجوز، دکانِ مبدأ — ⛔ بی شناسهٔ اجازه‌دهنده و بی سازندهٔ نسخه',
    det.status === 200 && det.json?.image?.origin?.shopId === 's1' && det.json?.image?.versions?.[0]?.urls?.thumb === '/api/account-admin/console/image-bank/file/img_1/1/thumb'
      && !det.text.includes('u_secret_consenter') && !det.text.includes('adm_x'), det.text.slice(0, 300));
  const shopImg = await api('GET', `${IB}/images/img_shop`, undefined, H(T.view));
  check('عکسِ اختصاصیِ دکان: ۴۰۴ ِ سرورِ حساب (پنل چیزی دورش نمی‌زند)', shopImg.status === 404, `${shopImg.status}`);
  const sr = await api('GET', `${IB}/search?q=${'ر'.repeat(150)}&brand=x&evil=1`, undefined, H(T.view));
  const srUp = seen.filter((s) => s.path === '/api/admin/image-bank/search').at(-1);
  check('جست‌وجو: فقط پارامترهای شناخته، کوتاه‌شده (۱۰۰)', sr.status === 200 && sr.json?.items?.[0]?.images?.[0]?.urls?.thumb?.startsWith('/api/account-admin/') && srUp?.query?.q?.length === 100 && !('evil' in (srUp?.query || {})), JSON.stringify(srUp?.query));
  const rep = await api('GET', `${IB}/reports`, undefined, H(T.view));
  check('گزارش‌های باز', rep.status === 200 && rep.json?.items?.[0]?.imageId === 'img_1', rep.text.slice(0, 200));
  const f = await api('GET', `${IB}/file/img_1/1/thumb`, undefined, H(T.view));
  check('⛔ فایل: همان بایت‌ها با ‎image/png‎، ‎nosniff‎ و ‎CSP default-src none‎',
    f.status === 200 && f.headers.get('content-type') === 'image/png' && f.headers.get('x-content-type-options') === 'nosniff'
      && f.headers.get('content-security-policy') === "default-src 'none'" && f.buf.equals(PNG), `${f.status} ${f.headers.get('content-type')}`);
  const svg = await api('GET', `${IB}/file/img_svg/1/thumb`, undefined, H(T.view));
  check('⛔ SVG از بالادست ⇒ ‎415 unsupported_media‎ (نه HTML/اسکریپت روی دامنهٔ پنل)', svg.status === 415 && !svg.text.includes('<svg'), `${svg.status} ${svg.text.slice(0, 80)}`);
  const fb = await api('GET', `${IB}/file/img_1/0/thumb`, undefined, H(T.view));
  const fs2 = await api('GET', `${IB}/file/img_1/1/huge`, undefined, H(T.view));
  check('نسخه/اندازهٔ بد ⇒ ۴۰۰', fb.status === 400 && fs2.status === 400, `${fb.status} ${fs2.status}`);

  const mBody = (k, extra = {}) => ({ reason: 'مجوز و تطبیق درست است', confirm: true, idempotencyKey: `stf-img-${k}-00001`, ...extra });
  const q0 = posts(/image-bank\/images\//);
  const mv = await api('POST', `${IB}/images/img_1/approve`, mBody('v'), H(T.view));
  const mo = await api('POST', `${IB}/images/img_1/approve`, mBody('o'), H(T.op));
  check('⛔ viewer و operator بازبینی نمی‌کنند (۴۰۳) و هیچ درخواستی بالا نمی‌رود', mv.status === 403 && mo.status === 403 && posts(/image-bank\/images\//) === q0, `${mv.status} ${mo.status}`);
  const ap = await api('POST', `${IB}/images/img_1/approve`, mBody('a', { version: 1 }), H(T.admin2));
  check('admin: تأیید ⇒ ۲۰۰ APPROVED، بالادست ‎{reason, version}‎', ap.status === 200 && ap.json?.status === 'APPROVED'
    && JSON.stringify(seen.at(-1)?.body) === JSON.stringify({ reason: 'مجوز و تطبیق درست است', version: 1 }), `${ap.status} ${ap.text.slice(0, 200)} ${JSON.stringify(seen.at(-1)?.body)}`);
  const apAgain = await api('POST', `${IB}/images/img_1/approve`, mBody('a', { version: 1 }), H(T.admin2));
  check('همان کلید ⇒ ‎replayed‎، بی درخواستِ دوم', apAgain.json?.replayed === true && posts(/image-bank\/images\//) === q0 + 1, `${posts(/image-bank\/images\//) - q0}`);
  const se = await api('POST', `${IB}/images/img_1/search`, mBody('s'), H(T.admin2));
  check('روشن/خاموشِ جست‌وجو بی ‎enabled‎ ِ بولی ⇒ ۴۰۰', se.status === 400 && se.json?.error === 'enabled_required', `${se.status}`);
  const se2 = await api('POST', `${IB}/images/img_1/search`, mBody('s2', { enabled: false }), H(T.admin2));
  check('خاموش در جست‌وجو ⇒ ‎searchEnabled: false‎', se2.status === 200 && se2.json?.searchEnabled === false, se2.text.slice(0, 200));
  const vb = await api('POST', `${IB}/images/img_1/reject`, mBody('vb', { version: '1; drop' }), H(T.admin2));
  check('نسخهٔ نامعتبر ⇒ ۴۰۰ پیش از پل', vb.status === 400 && vb.json?.error === 'bad_version', `${vb.status}`);
  const nl = await api('POST', `${IB}/images/img_nolic/approve`, mBody('nl'), H(T.admin2));
  check('قاعدهٔ انتشار در سرورِ حساب: ‎409 license_required‎ با کدِ خودش، و در دفترِ پنل «انجام شد» ثبت نشد',
    nl.status === 409 && nl.json?.error === 'license_required', `${nl.status} ${nl.text.slice(0, 120)}`);
  const iaud = await api('GET', '/api/control/audit?q=account.image_bank&limit=20&offset=0', undefined, H(T.owner));
  const irows = (iaud.json?.rows || []).filter((r) => r.action.startsWith('account.image_bank.'));
  check('دفترِ پنل: تأیید و جست‌وجو با دلیل — ردشده‌ها نه', irows.length === 2 && irows.some((r) => r.action === 'account.image_bank.approve' && String(r.detail).includes('مجوز و تطبیق')),
    JSON.stringify(irows).slice(0, 300));

  bankOn = false;
  const off = await api('GET', `${IB}/status`, undefined, H(T.view));
  const offR = await api('GET', `${IB}/review`, undefined, H(T.view));
  bankOn = true;
  check('⛔ پرچمِ خاموش ⇒ ‎enabled: false‎ و خواندن ‎403 image_bank_disabled‎ (نه فهرستِ خالیِ ساختگی)',
    off.status === 200 && off.json?.enabled === false && offR.status === 403 && offR.json?.error === 'image_bank_disabled', `${off.text.slice(0, 80)} ${offR.status} ${offR.json?.error}`);

  const mods = await api('GET', '/api/account-admin/console/modules', undefined, H(T.view));
  check('ماژولِ «بانکِ عکس» برای viewer در منوی فروشگاه', (mods.json?.modules || []).some((m) => m.id === 'imagebank'), JSON.stringify((mods.json?.modules || []).map((m) => m.id)));
  const pub = await fetch(`http://127.0.0.1:${PANEL}/api/account-admin/console/shops/s1/staff`);
  check('بی نشست ⇒ ۴۰۱', pub.status === 401, `${pub.status}`);
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
