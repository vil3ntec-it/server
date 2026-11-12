// ---------------------------------------------------------------------------
//  TEN-04 در پل (۱.۵۰.۹۸) — «اجازهٔ زندهٔ پشتیبانی» برای دیدنِ دادهٔ خصوصیِ دکان
//      node test/console-grant-read.mjs
//
//  سرورِ حسابِ ساختگی به شکلِ shop ‎claude/batch-55‎: با `support-grant-read.v1` و پرچمِ ‎security / admin.support_grant‎ ِ روشن،
//  درهای خواندنِ محتوای خصوصیِ یک دکان (‎staff-perms‎، جزئیاتِ دستهٔ عکس، تعارض‌های همگام‌سازیِ دکان) بی اجازهٔ زندهٔ `read_private`
//  ‎403 grant_required‎ می‌دهند و پرونده‌های دکان/کاربر (‎/shops/:id‎، ‎/users/:id‎) فقط فراداده با ‎restricted: {code, hidden}‎
//  (`lib/admin-dossier.js`). سنجیده می‌شود، هر سه حالت (سرورِ کهنه / اجازه لازم / اجازه هست):
//    ⛔ ‎403 grant_required‎ همان‌طور به رابط می‌رسد — فقط کد و پیام (نه بدنهٔ خامِ بالادست)، نه ۵۰۲ و نه بیرون انداختنِ نشست؛
//    ⛔ پروندهٔ دکان (‎shop-accounts‎) و پمپ (صاحبِ عضوِ دکان) ‎restricted‎ ِ سنجیده دارند: کد، بخش‌های پنهانِ شناخته، دکانی که
//       اجازه‌اش بازش می‌کند — و دستگاه/جای پنهان «خالی» نیست بلکه «پنهان» است؛
//    ⛔ پمپ (‎app=pump‎) هرگز؛ فهرستِ دسته‌های عکس (نه جزئیات) هرگز؛ اجازه ⇒ همه همان امروز و ‎restricted: null‎.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4947);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-grant-read-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 400)}`);
};

/* ───────────── سرورِ حسابِ ساختگی ───────────── */
const NOW = Date.now();
let caps = ['actor.v1', 'staff-perms.v1', 'image-changes.v1'];
let enforced = false;     //  ‎security / admin.support_grant‎
let granted = false;      //  اجازهٔ زندهٔ `read_private` ِ همین آدم روی ‎shpA‎
let weird;                //  ‎restricted‎ ِ کج از بالادست (بخشِ ۴)
const seen = [];
const needGrant = () => caps.includes('support-grant-read.v1') && enforced && !granted;
const GRANT_ERR = { error: { code: 'grant_required', message: 'برای این کار اجازهٔ زندهٔ دسترسیِ پشتیبانی به همین دکان لازم است', grantHint: 'adm_root:g_secret' } };
const RESTRICTED = (hidden) => ({ code: 'grant_required', hidden: [...hidden, 'secretPart'] });

const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams) });
    if (p === '/api/admin/shops/shpA/staff-perms') {
      if (needGrant()) return j(403, GRANT_ERR);
      return j(200, { shop: { id: 'shpA', name: 'دکانِ کریم' }, perms: { v: 1, catalog: [], roles: {}, members: [{ id: 'm1', userId: 'usr_1', name: 'کریم', role: 'owner', status: 'active' }] },
        devices: [{ id: 'dev_1', name: 'گوشیِ کریم', platform: 'android', status: 'active' }] });
    }
    if (p === '/api/admin/shops/shpA/images/changes') {
      return j(200, { enabled: true, changes: [{ id: 'chg_1', note: 'عکس‌های تازه', status: 'applied', item_count: 1, created_by: 'usr_1', created_at: NOW - 5000 }] });
    }
    if (p === '/api/admin/shops/shpA/images/changes/chg_1') {
      if (needGrant()) return j(403, GRANT_ERR);
      return j(200, { change: { id: 'chg_1', note: 'عکس‌های تازه', status: 'applied', item_count: 1, created_at: NOW - 5000,
        items: [{ product_id: 'rice', before: null, after: { source: 'bank', image_id: 'img_1', version: 1 } }] } });
    }
    if (p === '/api/admin/sync/conflicts') {
      if (u.searchParams.get('app') !== 'pump' && needGrant()) return j(403, GRANT_ERR);
      return j(200, { conflicts: [{ id: 5, table: 'products', row_id: 'rice', field: 'price', winner_device: 'd1', loser_device: 'd2', created_at: NOW }] });
    }
    if (p === '/api/admin/shops/shpA') {
      const r = needGrant();
      return j(200, { shop: { id: 'shpA', name: 'دکانِ کریم', status: 'active', createdAt: NOW - 9e8, ownerUserId: 'usr_1' },
        location: r ? null : { lat: 34.5, lng: 69.2, at: NOW }, members: [{ user_id: 'usr_1', role: 'owner' }], entitlement: {}, subscriptions: [], counts: {},
        ...(r ? { restricted: RESTRICTED(['location']) } : {}), ...(weird !== undefined ? { restricted: weird } : {}) });
    }
    if (p === '/api/admin/users/usr_1') {
      const r = needGrant();
      return j(200, { user: { id: 'usr_1', name: 'کریم', email: 'k@x.af', phone: '0700', status: 'active', lastLoginAt: NOW, lastLocation: r ? null : { lat: 1, lng: 2, at: NOW } },
        memberships: [{ shop_id: 'shpA', shop_name: 'دکانِ کریم', role: 'owner' }, { shop_id: 'bad id!', shop_name: 'x' }],
        devices: r ? [] : [{ id: 'dev_1', device_uid: 'uid-1', name: 'گوشیِ کریم', last_seen_at: NOW }], locations: [],
        ...(r ? { restricted: RESTRICTED(['devices', 'locations', 'lastLocation']) } : {}) });
    }
    if (p === '/api/admin/pump/stations/stA') {
      return j(200, { station: { id: 'stA', name: 'پمپِ کریم' }, owner: { id: 'usr_1', name: 'کریم' }, members: [], devices: [], entitlement: null });
    }
    if (p === '/api/admin/plans') return j(200, { plans: [] });
    return j(404, { error: { code: 'route_not_found', message: 'نیست' } });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ───────────── پنلِ واقعی ───────────── */
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  cwd: path.join(import.meta.dirname, '..'),
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'), HLP_SITESYNC: '0',
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`, HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_BRIDGE_TIMEOUT_MS: '2000', HLP_AUTH_RATE_LIMIT: '100000', HLP_TG_WATCH_MS: '0', HLP_TG_LONGPOLL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, token) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = '/api/account-admin';
const DOORS = {
  staff: `${A}/console/shops/shpA/staff`,
  list: `${A}/console/shops/shpA/images/changes`,
  change: `${A}/console/shops/shpA/images/changes/chg_1`,
  conflicts: `${A}/sync/conflicts?app=shop&account=shpA`,
  pumpConflicts: `${A}/sync/conflicts?app=pump&account=stA`,
  shop: `${A}/shop-accounts/shpA`,
  pump: `${A}/pump-accounts/stA`,
};
const all = async (tok) => Object.fromEntries(await Promise.all(Object.entries(DOORS).map(async ([k, p]) => [k, await api('GET', p, undefined, tok)])));

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await sleep(250);
  }
  await api('POST', '/api/auth/setup', { username: 'owner', password: 'Grant-1405-owner' });
  const login = async (u, pw) => (await api('POST', '/api/auth/login', { username: u, password: pw })).json?.token;
  const owner = await login('owner', 'Grant-1405-owner');
  await api('POST', '/api/auth/users', { username: 'view1', password: 'Grant-viewer-1405', role: 'viewer' }, owner);
  const view = await login('view1', 'Grant-viewer-1405');
  check('دو نشست (مالک و بیننده)', Boolean(owner && view));

  console.log('\n── ۱) سرورِ حسابِ کهنه (بی ‎support-grant-read.v1‎) — همان امروز ──');
  let r = await all(owner);
  check('همهٔ درها ۲۰۰؛ پرونده‌ها ‎restricted: null‎ با دستگاه و جای دکان', Object.values(r).every((x) => x.status === 200)
    && r.shop.json?.restricted === null && r.shop.json?.devices?.length === 1 && r.shop.json?.location?.lat === 34.5 && r.pump.json?.restricted === null,
    Object.entries(r).map(([k, x]) => `${k}:${x.status}`).join(' '));

  console.log('\n── ۲) ‎support-grant-read.v1‎ + پرچمِ روشن، بی اجازه ──');
  caps = [...caps, 'support-grant-read.v1'];
  enforced = true;
  r = await all(owner);
  const g403 = (x) => x.status === 403 && x.json?.error === 'grant_required' && /اجازهٔ زندهٔ دسترسیِ پشتیبانی/.test(x.json?.message || '')
    && Object.keys(x.json || {}).sort().join() === 'error,message' && !x.text.includes('g_secret');
  check('⛔ اجازه‌های کارکنان، جزئیاتِ دستهٔ عکس و تعارض‌های دکان ⇒ ‎403 grant_required‎ با پیامِ خودِ سرورِ حساب — فقط کد و پیام، نه بدنهٔ خام',
    g403(r.staff) && g403(r.change) && g403(r.conflicts), `${r.staff.status} ${r.staff.text.slice(0, 160)} · ${r.change.status} · ${r.conflicts.status}`);
  check('فهرستِ دسته‌های عکس و تعارض‌های پمپ اجازه نمی‌خواهند ⇒ ۲۰۰', r.list.status === 200 && r.list.json?.changes?.length === 1 && r.pumpConflicts.status === 200,
    `${r.list.status} ${r.pumpConflicts.status}`);
  const rs = r.shop.json?.restricted;
  check('پروندهٔ دکان: ۲۰۰ با ‎restricted‎ ِ سنجیده — کد، بخش‌های پنهانِ دکان و صاحبش (نه نامِ ناشناختهٔ ‎secretPart‎)، و دکانی که اجازه‌اش بازش می‌کند',
    r.shop.status === 200 && rs?.code === 'grant_required' && JSON.stringify([...rs.hidden].sort()) === JSON.stringify(['devices', 'lastLocation', 'location', 'locations'])
      && JSON.stringify(rs.shops) === JSON.stringify([{ id: 'shpA', name: 'دکانِ کریم' }]) && r.shop.json.devices.length === 0 && r.shop.json.location === null
      && !r.shop.text.includes('secretPart'), r.shop.text.slice(0, 400));
  const rp = r.pump.json?.restricted;
  check('پروندهٔ پمپ (صاحبش عضوِ دکان است): ‎restricted‎ با دکان‌های عضویتش — شناسهٔ نامعتبر بیرون',
    r.pump.status === 200 && rp?.code === 'grant_required' && JSON.stringify(rp.shops) === JSON.stringify([{ id: 'shpA', name: 'دکانِ کریم' }])
      && JSON.stringify(rp.hidden.sort()) === JSON.stringify(['devices', 'lastLocation', 'locations']), r.pump.text.slice(0, 300));
  const v = await api('GET', DOORS.staff, undefined, view);
  const me = await api('GET', '/api/auth/me', undefined, owner);
  check('بیننده هم همان ‎403 grant_required‎ (اجازه مالِ هر آدم است)؛ و ۴۰۳ ِ اجازه نشستِ پنل را نمی‌بندد', g403(v) && me.status === 200,
    `${v.status} ${v.json?.error} ${me.status}`);

  console.log('\n── ۳) اجازهٔ زنده ──');
  granted = true;
  r = await all(owner);
  check('با اجازه همه ۲۰۰ و ‎restricted: null‎ — دستگاه و جای دکان برگشتند', Object.values(r).every((x) => x.status === 200)
    && r.shop.json?.restricted === null && r.pump.json?.restricted === null && r.shop.json?.devices?.length === 1 && r.change.json?.change?.items?.length === 1
    && r.staff.json?.members?.length === 1, Object.entries(r).map(([k, x]) => `${k}:${x.status}`).join(' '));

  console.log('\n── ۴) ‎restricted‎ ِ کج از بالادست ──');
  const odd = [];
  for (const w of [{ code: 'other', hidden: ['location'] }, 'grant_required', ['grant_required'], { code: 'grant_required', hidden: 'location' }]) {
    weird = w;
    odd.push((await api('GET', DOORS.shop, undefined, owner)).json?.restricted);
  }
  weird = undefined;
  check('کدِ دیگر، رشته یا آرایه ⇒ پل جلو نمی‌برد (‎null‎)؛ ‎hidden‎ ِ نا‌آرایه ⇒ فهرستِ خالی، نه رشتهٔ خام',
    odd[0] === null && odd[1] === null && odd[2] === null && odd[3]?.code === 'grant_required' && Array.isArray(odd[3].hidden) && odd[3].hidden.length === 0,
    JSON.stringify(odd));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await sleep(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز`);
process.exit(fail ? 1 : 0);
