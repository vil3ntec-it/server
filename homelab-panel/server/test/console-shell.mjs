// ---------------------------------------------------------------------------
//  پوستهٔ بخشِ «فروشگاه» (پنلِ مرکزیِ مالک، ۱۴۰۵/۰۸/۱۰) — درهای ‎/api/account-admin/console/{modules,summary,search,
//  admins…,flags…}‎ روی پنلِ واقعی با سرورِ حسابِ ساختگیِ ضبط‌کننده
//      node test/console-shell.mjs
//
//   ۱) فهرستِ ماژول‌ها به نقش؛ و **«پنهان = سرور هم نمی‌دهد»**: برای هر ماژول، درِ `probe` ِ همان ماژول با سه نقش —
//      زیرِ `minRole` ⇒ ۴۰۳، از آن به بالا ⇒ نه ۴۰۳. هر فایلِ ماژولِ وب شناسه‌ای دارد که سرور می‌شناسد، و برعکس.
//   ۲) داشبورد: منبع و زمانِ هر کارت، «—» (null) برای نیامده، خطای یک منبع فقط همان کارت، هشدار از عددِ واقعی
//   ۳) جست‌وجو: به نقش؛ با و بی `search.v1`؛ خطای یک منبع فقط همان
//   ۴) مدیرانِ سرورِ حساب: فقط admin می‌بیند؛ نوشتن فقط مالک + رمزِ پنل + دلیل + تأیید + کلیدِ یکتایی؛ مالک و حسابِ
//      پل دست نمی‌خورند؛ رمز در دفتر نیست؛ نشست‌ها با/بی توانایی؛ بی راهِ پیشین ⇒ «پشتیبانی نمی‌شود»
//   ۵) پرچم‌ها: نوع، scope، کاتالوگ، پرخطر ⇒ رمز + نامِ کلید؛ بی توانایی ⇒ ۵۰۱
//   ۶) روزهای آزمایشی: دلیل به سرورِ حساب، «پیشین ⇒ تازه» در دفتر
//   ۷) پورتِ عمومی: هیچ‌کدام
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PANEL = Number(process.env.TEST_PORT || 4971);
const PUBLIC = PANEL + 1;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'console-shell-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'unit');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 1200)}`);
};

/* ── ۰) فهرستِ سرور و فایل‌های وب، از خودِ کد ── */
const { CONSOLE_MODULES, CONSOLE_GROUPS } = await import('../src/console/modules.js');
const webDir = path.join(here, '..', '..', 'web', 'src', 'pages', 'account', 'console', 'modules');
const webIds = fs.readdirSync(webDir).filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ f, id: (/defineModule\(\{\s*id:\s*'([a-z][a-z0-9-]*)'/.exec(fs.readFileSync(path.join(webDir, f), 'utf8')) || [])[1] }));
console.log('\n── فهرستِ ماژول‌ها: سرور ⇄ وب ──');
check('۱۳ ماژولِ پرامپت (۴.۱ تا ۴.۱۳) همه در فهرستِ سرور', ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8', '4.9', '4.10', '4.11', '4.12', '4.13']
  .every((s) => CONSOLE_MODULES.some((m) => m.spec.split(' · ').includes(s))));
check('هر فایلِ ماژولِ وب شناسه‌ای دارد و نامِ فایل همان است', webIds.every((x) => x.id && `${x.id}.tsx` === x.f), JSON.stringify(webIds));
check('⛔ هر ماژولِ وب در سرور هست و «ساخته» است (probe دارد)', webIds.every((x) => CONSOLE_MODULES.find((m) => m.id === x.id)?.probe),
  webIds.filter((x) => !CONSOLE_MODULES.find((m) => m.id === x.id)?.probe).map((x) => x.id).join(' '));
check('⛔ هر ماژولِ «ساختهٔ» سرور فایلِ وب دارد (زبانهٔ بی‌صفحه نه)', CONSOLE_MODULES.filter((m) => m.probe).every((m) => webIds.some((x) => x.id === m.id)),
  CONSOLE_MODULES.filter((m) => m.probe && !webIds.some((x) => x.id === m.id)).map((m) => m.id).join(' '));
check('شناسه‌ها یکتا و گروه‌ها شناخته', new Set(CONSOLE_MODULES.map((m) => m.id)).size === CONSOLE_MODULES.length
  && CONSOLE_MODULES.every((m) => CONSOLE_GROUPS.some((g) => g.id === m.group) && ['viewer', 'operator', 'admin'].includes(m.minRole)
    && m.label.fa && m.label.en && m.label.ps));

/* ── ۱) سرورِ حسابِ ساختگی ── */
const NOW = Date.now();
const seen = [];
let caps = ['shop-health.v1', 'shop-holds.v1', 'flags.v1', 'actor.v1', 'service-key.v1', 'admin-sessions.v1', 'search.v1'];
let versionsDown = false;
let adminsDown = false;
let searchBroken = false;
let expiring = 2;
const admins = [
  { id: 'adm-owner', username: 'malek', name: 'مالک', role: 'superadmin', status: 'active', is_owner: true, created_at: NOW - 9e8 },
  { id: 'adm-bridge', username: 'boss', name: 'پل', role: 'superadmin', status: 'active', is_owner: false, created_at: NOW - 8e8 },
  { id: 'adm-fin', username: 'mali', name: 'مالی', role: 'finance', status: 'active', is_owner: false, created_at: NOW - 7e8 },
];
const flagItems = [{ key: 'shop.receipt_v2', value: true, updatedAt: NOW - 3600e3, updatedBy: 'malek' }];
const known = [
  { key: 'shop.receipt_v2', scope: 'shop', default: false, what: 'فاکتورِ نسخهٔ ۲' },
  { key: 'shop.orders', scope: 'shop', default: false, what: 'سفارشِ آنلاین' },
  { key: 'image_bank.central', scope: 'all', default: false, what: 'بانکِ تصاویر' },
  { key: 'hashchain.audit', scope: 'security', default: false, what: 'زنجیره' },
  { key: 'beta.shops', scope: 'release', default: [], what: 'کانالِ آزمایشی' },
];
const config = { trial_days: '14', pump_trial_days: '30' };

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
    seen.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body, bearer: (req.headers.authorization || '').slice(7) });
    const M = `${req.method} ${p}`;
    if (M === 'POST /api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (M === 'GET /api/admin/me') return j(200, { admin: { id: 'adm-bridge', username: 'boss', role: 'superadmin' }, capabilities: caps, serverTime: NOW });
    if (M === 'GET /api/admin/admins') return adminsDown ? err(500, 'db_unavailable', 'پایگاه در دسترس نیست') : j(200, { admins });
    if (M === 'POST /api/admin/admins') return j(201, { admin: { id: 'adm-new', username: body.username, name: body.name, role: body.role } });
    let m = /^\/api\/admin\/admins\/([^/]+)$/.exec(p);
    if (m && req.method === 'PATCH') {
      const a = admins.find((x) => x.id === m[1]);
      return a ? j(200, { admin: { ...a, ...(body.role ? { role: body.role } : {}), ...(body.status ? { status: body.status } : {}) } }) : err(404, 'not_found');
    }
    m = /^\/api\/admin\/admins\/([^/]+)\/sessions$/.exec(p);
    if (m) return j(200, { sessions: [{ id: '0123456789abcdef', issuedAt: NOW - 3600e3, expiresAt: NOW + 3600e3, current: false }], serverTime: NOW });
    m = /^\/api\/admin\/admins\/([^/]+)\/sessions\/revoke$/.exec(p);
    if (m) return j(200, { ok: true, revoked: body?.sessionId ? 1 : 3, serverTime: NOW });
    if (M === 'GET /api/admin/search') {
      if (searchBroken) return err(500, 'db_unavailable');
      return j(200, {
        q: u.searchParams.get('q'), kinds: ['shops', 'users', 'payments', 'orders', 'errors', 'admins'],
        results: { shops: [{ id: 's1', name: 'دکانِ کریم' }], users: [{ id: 'u1', name: 'کریم', email: 'k@x.af' }], payments: [{ id: 'p1', amount: 500, currency: 'AFN' }],
          orders: [], errors: [{ id: 'e1', message: 'crash' }], admins: [{ id: 'adm-fin', username: 'mali' }] },
      });
    }
    if (M === 'GET /api/admin/shops') return j(200, { shops: [{ id: 's1', name: 'دکانِ کریم' }], total: 1 });
    if (M === 'GET /api/admin/users') return j(200, { users: [{ id: 'u1', name: 'کریم' }], total: 1 });
    if (M === 'GET /api/admin/flags') {
      const scope = u.searchParams.get('scope') || 'all';
      return j(200, { scope, items: scope === 'all' ? flagItems : [], known, reserved: [], version: 3 });
    }
    if (M === 'GET /api/admin/flags/history') return j(200, { entries: [] });
    if (M === 'PUT /api/admin/flags') return j(200, { ok: true, scope: body.scope, key: body.key });
    if (M === 'DELETE /api/admin/flags') return j(200, { ok: true, removed: true });
    if (M === 'GET /api/admin/shop-desk/overview') {
      return j(200, { serverTime: NOW - 60e3, onlineWithinMs: 600e3, counts: { shops: 7, customers: 30, subscribed: 4, online: 0, expiring, supportOpen: 1, supportUnread: 0 }, expiring: [], support: [], days: 7 });
    }
    if (M === 'GET /api/admin/shop-desk/groups') return j(200, { groups: { has: [], none: [], expired: [] }, counts: { has: 0, none: 0, expired: 0 } });
    //  ⚠️ پاسخِ کهنه/ناقص: `counts` نیست ⇒ کارت «—» (null)، نه صفر
    if (M === 'GET /api/admin/sales/summary') return j(200, { revenue: { month: { shop: { AFN: 12000 } } }, serverTime: NOW });
    if (M === 'GET /api/admin/system/health') return j(200, { status: 'warn', checkedAt: NOW - 30e3, sync: { clientErrors24h: 3, conflicts24h: 0 } });
    if (M === 'GET /api/admin/system/versions') return versionsDown ? err(503, 'versions_unavailable') : j(200, { checkedAt: NOW, apps: [{ app: 'shop', devices: 9, latest: '2.14.5', belowMin: 1 }] });
    if (M === 'GET /api/admin/system/providers') return j(200, { checkedAt: NOW, production: true, providers: [{ id: 'sms', state: 'live' }, { id: 'email', state: 'mock' }] });
    if (M === 'GET /api/admin/plans') return j(200, { plans: [], config });
    if (M === 'PATCH /api/admin/config') { if (body.trial_days !== undefined) config.trial_days = String(body.trial_days); return j(200, { config }); }
    if (M === 'GET /api/admin/audit') return j(200, { entries: [] });
    return err(404, 'route_not_found', 'این مسیرِ مدیر روی این سرور نیست');
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE = `http://127.0.0.1:${fake.address().port}`;

/* ── ۲) پنلِ واقعی ── */
function startPanel(port, pub, extraEnv = {}) {
  const env = { ...process.env, HLP_PORT: String(port), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, `data-${port}`), HLP_SITES_ROOT: path.join(tmp, `sites-${port}`),
    HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(pub), HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_AUTOMATION: '0',
    HLP_STATIONS: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: FAKE,
    HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret', HLP_AUTH_RATE_LIMIT: '100000', ...extraEnv };
  for (const [k, v] of Object.entries(env)) if (v === null) delete env[k];
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], { cwd: path.join(here, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.out = '';
  child.stdout.on('data', (d) => (child.out += d));
  child.stderr.on('data', (d) => (child.out += d));
  return child;
}
const server = startPanel(PANEL, PUBLIC);
const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, token, base = BASE) {
  const res = await fetch(base + p, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* غیرِ JSON */ }
  return { status: res.status, json };
}
const upSince = (n) => seen.slice(n).map((c) => `${c.method} ${c.path}`);
const waitUp = async (base) => {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
};
const PW = 'Shell-1405-owner';
const panelAudit = async (token, q) => (await api('GET', `/api/control/audit?q=${encodeURIComponent(q)}&limit=50`, undefined, token)).json?.rows || [];

let other = null;
try {
  await waitUp(BASE);
  await api('POST', '/api/auth/setup', { username: 'owner1', password: PW });
  const login = async (u, p) => (await api('POST', '/api/auth/login', { username: u, password: p })).json?.token;
  const T = { admin: await login('owner1', PW) };
  for (const [u, role] of [['adm2', 'admin'], ['op1', 'operator'], ['view1', 'viewer']]) {
    await api('POST', '/api/auth/users', { username: u, password: `Shell-${role}-1405`, role }, T.admin);
  }
  T.admin2 = await login('adm2', 'Shell-admin-1405');
  T.operator = await login('op1', 'Shell-operator-1405');
  T.viewer = await login('view1', 'Shell-viewer-1405');
  check('چهار نشست: مالک · admin ِ دوم · operator · viewer', Object.values(T).every(Boolean));

  /* ── ۱) ماژول‌ها به نقش ── */
  console.log('\n── ۱) ماژول‌ها به نقش؛ «پنهان = سرور هم نمی‌دهد» ──');
  const mods = {};
  for (const r of ['admin', 'admin2', 'operator', 'viewer']) mods[r] = (await api('GET', '/api/account-admin/console/modules', undefined, T[r])).json;
  check('مالک: همهٔ ماژول‌ها، owner=true', mods.admin?.owner === true && mods.admin?.modules?.length === CONSOLE_MODULES.length, JSON.stringify(mods.admin).slice(0, 300));
  check('admin ِ دوم: همه، ولی owner=false', mods.admin2?.owner === false && mods.admin2?.modules?.some((m) => m.id === 'users'));
  check('⛔ operator و viewer «کاربران و نقش‌ها» را ندارند', ['operator', 'viewer'].every((r) => mods[r]?.modules && !mods[r].modules.some((m) => m.id === 'users')));
  check('رزروشده‌ها «ساخته‌نشده»اند (market، courier، errors، alerts) و بقیه ساخته', mods.admin.modules.filter((m) => !m.built).map((m) => m.id).sort().join(',') === 'alerts,courier,errors,market');
  check('برچسبِ سه‌زبانه برای هر ماژول و گروه', mods.admin.modules.every((m) => m.label?.fa && m.label?.en && m.label?.ps) && mods.admin.groups.every((g) => g.label?.ps));
  const RANK = { viewer: 0, operator: 1, admin: 2 };
  const leaks = [];
  for (const m of CONSOLE_MODULES.filter((x) => x.probe)) {
    for (const r of ['viewer', 'operator', 'admin']) {
      const before = seen.length;
      const res = await api('GET', m.probe, undefined, T[r]);
      const allowed = RANK[r] >= RANK[m.minRole];
      if (allowed ? res.status === 403 : res.status !== 403) leaks.push(`${m.id} ${r} ⇒ ${res.status}`);
      if (!allowed && seen.length !== before) leaks.push(`${m.id} ${r} ⇒ به سرورِ حساب رسید`);
      const listed = mods[r].modules.some((x) => x.id === m.id);
      if (listed !== allowed) leaks.push(`${m.id} ${r} در فهرست=${listed}`);
    }
  }
  check('⛔ برای هر ماژول: زیرِ minRole ⇒ ۴۰۳ و بی درخواست به سرورِ حساب؛ از minRole به بالا ⇒ نه ۴۰۳؛ فهرست همان', leaks.length === 0, leaks.join(' · '));

  /* ── ۲) داشبورد ── */
  console.log('\n── ۲) داشبورد: منبع، زمان، «—»، خطای یک منبع ──');
  versionsDown = true;
  const sum = await api('GET', '/api/account-admin/console/summary', undefined, T.viewer);
  versionsDown = false;
  const item = (id) => sum.json?.items?.find((x) => x.module === id);
  check('viewer کارت می‌گیرد، بی «کاربران»', sum.status === 200 && !item('users') && Boolean(item('shops')), JSON.stringify(sum.json).slice(0, 300));
  check('هر کارتِ موفق منبع و زمان دارد', sum.json.items.filter((x) => x.ok).every((x) => x.source && (x.at || x.receivedAt)));
  check('«دکان» از ‎/shop-desk/overview‎ با زمانِ همان‌جا (serverTime)', item('shops')?.ok && item('shops').at === NOW - 60e3
    && item('shops').metrics.find((x) => x.id === 'shops')?.value === 7 && item('shops').metrics.find((x) => x.id === 'online')?.value === 0, JSON.stringify(item('shops')));
  check('⛔ نیامده = null («—»)، نه صفر: «اشتراکِ فعال» در پاسخِ ناقصِ مالی', item('finance')?.ok && item('finance').metrics.find((x) => x.id === 'active')?.value === null
    && item('finance').metrics.find((x) => x.id === 'month_AFN')?.value === 12000, JSON.stringify(item('finance')));
  check('⛔ خطای یک منبع فقط همان کارت: «نسخه‌ها» با کدِ خودش، بقیه سالم', item('versions')?.ok === false && item('versions').error?.code === 'versions_unavailable' && item('health')?.ok === true);
  check('ماژولِ ساخته‌نشده «not_built» است، بی عدد', item('market')?.reason === 'not_built' && !item('market').metrics);
  check('ماژولِ بی خلاصه «no_summary»', item('codes')?.reason === 'no_summary');
  const al = sum.json.alerts || [];
  check('هشدار از عددِ واقعی، با پیوند و منبع: رو به پایان (۲) و سلامتِ «warn»', al.some((a) => a.module === 'subs' && /2/.test(a.text.en) && a.link)
    && al.some((a) => a.module === 'health' && a.level === 'warn' && a.source === '/api/admin/system/health'), JSON.stringify(al));
  check('هشدارها به شدت مرتب‌اند (bad ⇐ warn ⇐ info)', al.map((a) => ({ bad: 0, warn: 1, info: 2 }[a.level])).every((x, i, a) => i === 0 || a[i - 1] <= x));
  expiring = 0;
  const sum2 = await api('GET', '/api/account-admin/console/summary', undefined, T.admin);
  check('بی «رو به پایان» هشداری ساخته نمی‌شود؛ مالک کارتِ کاربرانِ پنل را می‌گیرد (۴ کاربر)', !(sum2.json.alerts || []).some((a) => a.module === 'subs')
    && sum2.json.items.find((x) => x.module === 'users')?.metrics.find((x) => x.id === 'panelUsers')?.value === 4);

  /* ── ۳) جست‌وجو ── */
  console.log('\n── ۳) جست‌وجوی سراسری ──');
  const s1 = await api('GET', '/api/account-admin/console/search?q=کریم', undefined, T.admin);
  const kinds = (r) => (r.json?.results || []).map((x) => x.kind).sort().join(',');
  check('مالک: همهٔ نوع‌ها + کاربرانِ پنل', s1.status === 200 && kinds(s1) === 'admins,errors,orders,panelUsers,payments,shops,users', kinds(s1));
  check('‎q‎ به ‎/api/admin/search‎ رسید', seen.some((c) => c.path === '/api/admin/search' && c.query.q === 'کریم'));
  const s2 = await api('GET', '/api/account-admin/console/search?q=owner', undefined, T.viewer);
  check('⛔ viewer: نه مدیرها، نه کاربرانِ پنل', s2.status === 200 && !/admins|panelUsers/.test(kinds(s2)), kinds(s2));
  const s3 = await api('GET', '/api/account-admin/console/search?q=owner', undefined, T.admin);
  check('کاربرِ پنل با نامِ کاربری (از پایگاهِ پنل)', s3.json.results.find((x) => x.kind === 'panelUsers')?.items?.some((r) => r.username === 'owner1'));
  check('کوتاه ⇒ ۴۰۰ و بی درخواست', (await api('GET', '/api/account-admin/console/search?q=a', undefined, T.admin)).status === 400);
  searchBroken = true;
  const s4 = await api('GET', '/api/account-admin/console/search?q=karim', undefined, T.admin);
  searchBroken = false;
  check('⛔ سرورِ حساب شکست ⇒ همان منابع با کدِ خودش، کاربرانِ پنل سالم', s4.status === 200
    && s4.json.results.filter((x) => x.kind !== 'panelUsers').every((x) => x.ok === false && x.error.code === 'db_unavailable')
    && s4.json.results.find((x) => x.kind === 'panelUsers')?.ok === true, JSON.stringify(s4.json).slice(0, 300));
  caps = caps.filter((c) => c !== 'search.v1');
  const s5 = await api('GET', '/api/account-admin/console/search?q=karim', undefined, T.admin);
  check('بی `search.v1`: دکان و کاربر از درهای پیشین؛ بقیه صریح «capability_missing»', s5.json.searchCapability === false
    && s5.json.results.find((x) => x.kind === 'shops')?.ok && s5.json.results.find((x) => x.kind === 'payments')?.error?.code === 'capability_missing',
  JSON.stringify(s5.json).slice(0, 300));
  caps.push('search.v1');

  /* ── ۴) مدیرانِ سرورِ حساب ── */
  console.log('\n── ۴) مدیرانِ سرورِ حساب ──');
  let n = seen.length;
  for (const r of ['operator', 'viewer']) {
    const x = await api('GET', '/api/account-admin/console/admins', undefined, T[r]);
    check(`⛔ ${r} ⇒ ۴۰۳`, x.status === 403);
  }
  check('⛔ و هیچ درخواستی به سرورِ حساب نرفت', seen.length === n, upSince(n).join(' · '));
  const list = await api('GET', '/api/account-admin/console/admins', undefined, T.admin2);
  const row = (id) => list.json?.admins?.find((a) => a.id === id);
  check('admin ِ دوم می‌بیند: مالک و حسابِ پل نشان‌دار، نشست پشتیبانی می‌شود، «مالکِ پنل» نیست',
    list.status === 200 && row('adm-owner')?.isOwner === true && row('adm-bridge')?.bridge === true && list.json.sessionsSupported === true && list.json.panelOwner === false,
    JSON.stringify(list.json).slice(0, 300));
  check('فهرست از راهِ پیشین (توکنِ ورودِ ارشد) خوانده شد', seen.some((c) => c.path === '/api/admin/admins' && c.bearer === 'tok-1'));

  const goodNew = { username: 'new.viewer', name: 'تازه', role: 'viewer', adminPassword: 'New-admin-1405!', reason: 'همکارِ تازهٔ پشتیبانی', confirm: true, idempotencyKey: 'shell-test-create-1', password: PW };
  n = seen.length;
  const notOwner = await api('POST', '/api/account-admin/console/admins', { ...goodNew, password: 'Shell-admin-1405' }, T.admin2);
  check('⛔ admin ِ غیرِمالک ⇒ ۴۰۳ owner_only و هیچ درخواستی', notOwner.status === 403 && notOwner.json?.error === 'owner_only' && seen.length === n);
  const noPw = await api('POST', '/api/account-admin/console/admins', { ...goodNew, password: undefined }, T.admin);
  check('⛔ مالک بی رمزِ پنل ⇒ ۴۰۳ reauth_required', noPw.status === 403 && noPw.json?.error === 'reauth_required');
  const badPw = await api('POST', '/api/account-admin/console/admins', { ...goodNew, password: 'nope-nope' }, T.admin);
  check('⛔ رمزِ غلط ⇒ ۴۰۳ reauth_failed', badPw.status === 403 && badPw.json?.error === 'reauth_failed');
  for (const [what, b, code] of [
    ['بی دلیل', { ...goodNew, reason: '' }, 'reason_required'], ['بی تأیید', { ...goodNew, confirm: undefined }, 'confirm_required'],
    ['بی نقش (نه پیش‌فرض)', { ...goodNew, role: '' }, 'role_required'], ['رمزِ کوتاه', { ...goodNew, adminPassword: 'short' }, 'weak_password'],
    ['بی کلیدِ یکتایی', { ...goodNew, idempotencyKey: undefined }, 'idempotency_key_required'],
  ]) {
    const x = await api('POST', '/api/account-admin/console/admins', b, T.admin);
    check(`⛔ ${what} ⇒ ۴۰۰ ${code}`, x.status === 400 && x.json?.error === code, `${x.status} ${JSON.stringify(x.json)}`);
  }
  check('⛔ و هیچ‌کدام به ساختن نرسید', !seen.slice(n).some((c) => c.method === 'POST' && c.path === '/api/admin/admins'));
  const made = await api('POST', '/api/account-admin/console/admins', goodNew, T.admin);
  const posted = seen.filter((c) => c.method === 'POST' && c.path === '/api/admin/admins');
  check('مالک + رمز + دلیل + تأیید ⇒ ساخته، «تأییدشده از سرور»', made.status === 200 && made.json?.confirmedByServer === true && made.json?.admin?.role === 'viewer', JSON.stringify(made.json));
  check('بدنهٔ بالادست: نقشِ صریح، دلیل، رمزِ حسابِ تازه؛ از راهِ پیشین', posted.length === 1 && posted[0].body.role === 'viewer' && posted[0].body.reason && posted[0].body.password === goodNew.adminPassword && posted[0].bearer === 'tok-1');
  check('⛔ رمزِ پنل به سرورِ حساب نرفت', !JSON.stringify(posted[0].body).includes(PW));
  const again = await api('POST', '/api/account-admin/console/admins', goodNew, T.admin);
  check('همان کلیدِ یکتایی ⇒ همان پاسخ (replayed) و درخواستِ دوم نه', again.status === 200 && again.json?.replayed === true && seen.filter((c) => c.method === 'POST' && c.path === '/api/admin/admins').length === 1);
  const reused = await api('POST', '/api/account-admin/console/admins', { ...goodNew, role: 'admin' }, T.admin);
  check('همان کلید با بدنهٔ دیگر ⇒ ۴۰۹', reused.status === 409 && reused.json?.error === 'idempotency_key_reused');
  const auditRows = await panelAudit(T.admin, 'account.admin');
  check('ردیفِ دفترِ پنل: چه کسی، چه، روی چه، دلیل — بی هیچ رمزی', auditRows.some((r) => r.action === 'account.admin.created' && r.actor === 'owner1' && /همکار/.test(r.detail))
    && !JSON.stringify(auditRows).includes(goodNew.adminPassword) && !JSON.stringify(auditRows).includes(PW));

  const upd = (id, b, tok = T.admin) => api('POST', `/api/account-admin/console/admins/${id}/update`, { reason: 'جابه‌جاییِ کار', confirm: true, password: PW, idempotencyKey: `shell-upd-${id}-${JSON.stringify(b).length}-${Math.random().toString(36).slice(2)}`, ...b }, tok);
  n = seen.length;
  const own = await upd('adm-owner', { role: 'viewer' });
  check('⛔ مالکِ اصلیِ سرورِ حساب ⇒ ۴۰۳ owner_protected و هیچ PATCH', own.status === 403 && own.json?.error === 'owner_protected' && !seen.slice(n).some((c) => c.method === 'PATCH'));
  const br = await upd('adm-bridge', { status: 'disabled' });
  check('⛔ حسابِ خودِ پل ⇒ ۴۰۹ bridge_account (پل قطع نمی‌شود)', br.status === 409 && br.json?.error === 'bridge_account' && !seen.slice(n).some((c) => c.method === 'PATCH'));
  const fin = await upd('adm-fin', { role: 'viewer' });
  const patch = seen.filter((c) => c.method === 'PATCH' && c.path === '/api/admin/admins/adm-fin').at(-1);
  check('تغییرِ نقشِ مدیرِ دیگر ⇒ PATCH با دلیل، تأییدشده', fin.status === 200 && fin.json?.admin?.role === 'viewer' && patch?.body?.reason === 'جابه‌جاییِ کار' && patch.body.role === 'viewer');
  const updRow = (await panelAudit(T.admin, 'account.admin.updated'))[0];
  check('دفتر: «پیشین ⇒ تازه»', /"from":\{"role":"finance"/.test(updRow?.detail || '') && /"to":\{"role":"viewer"/.test(updRow?.detail || ''), updRow?.detail);
  check('وضعیتِ نامعتبر ⇒ ۴۰۰', (await upd('adm-fin', { status: 'deleted' })).status === 400);

  const ses = await api('GET', '/api/account-admin/console/admins/adm-fin/sessions', undefined, T.admin2);
  check('نشست‌ها (با توانایی): فهرست', ses.status === 200 && ses.json?.available === true && ses.json.sessions[0].id === '0123456789abcdef');
  caps = caps.filter((c) => c !== 'admin-sessions.v1');
  const ses2 = await api('GET', '/api/account-admin/console/admins/adm-fin/sessions', undefined, T.admin2);
  check('بی `admin-sessions.v1` ⇒ «پشتیبانی نمی‌شود» با نامِ توانایی، نه خطا', ses2.status === 200 && ses2.json?.available === false && ses2.json.capability === 'admin-sessions.v1');
  const rv0 = await api('POST', '/api/account-admin/console/admins/adm-fin/sessions/revoke', { reason: 'آزمون', confirm: true, password: PW, idempotencyKey: 'shell-rv-0000' }, T.admin);
  check('بستن بی توانایی ⇒ ۵۰۱ capability_missing، نه «انجام شد»', rv0.status === 501 && rv0.json?.error === 'capability_missing');
  caps.push('admin-sessions.v1');
  const rv = await api('POST', '/api/account-admin/console/admins/adm-fin/sessions/revoke', { sessionId: '0123456789abcdef', reason: 'دستگاهِ گم‌شده', confirm: true, password: PW, idempotencyKey: 'shell-rv-0001' }, T.admin);
  const rvUp = seen.filter((c) => c.path === '/api/admin/admins/adm-fin/sessions/revoke').at(-1);
  check('بستنِ یک نشست ⇒ بالادست با شناسه و دلیل، ۱ بسته', rv.status === 200 && rv.json?.revoked === 1 && rvUp?.body?.sessionId === '0123456789abcdef' && rvUp.body.reason === 'دستگاهِ گم‌شده');
  check('⛔ شناسهٔ نشستِ بد ⇒ ۴۰۰', (await api('POST', '/api/account-admin/console/admins/adm-fin/sessions/revoke', { sessionId: 'zz', reason: 'آزمون', confirm: true, password: PW, idempotencyKey: 'shell-rv-0002' }, T.admin)).status === 400);
  adminsDown = true;
  const down = await api('GET', '/api/account-admin/console/admins', undefined, T.admin);
  adminsDown = false;
  check('خطای بالادست با کدِ خودش', down.status === 500 && down.json?.error === 'db_unavailable', JSON.stringify(down));

  /* ── ۵) پرچم‌ها ── */
  console.log('\n── ۵) پرچم‌ها ──');
  const put = (b, tok = T.admin) => api('PUT', '/api/account-admin/console/flags', { reason: 'آزمونِ پرچم', confirm: true, idempotencyKey: `shell-flag-${Math.random().toString(36).slice(2)}`, ...b }, tok);
  n = seen.length;
  check('⛔ viewer و operator ⇒ ۴۰۳ و بی درخواست', (await put({ scope: 's1', key: 'shop.receipt_v2', value: false }, T.viewer)).status === 403
    && (await put({ scope: 's1', key: 'shop.receipt_v2', value: false }, T.operator)).status === 403 && seen.length === n);
  for (const [what, b, code] of [
    ['مقدارِ رشته', { scope: 's1', key: 'shop.receipt_v2', value: 'true' }, 'bad_flag_value'],
    ['کلیدِ ناشناخته', { scope: 's1', key: 'shop.nope', value: true }, 'unknown_flag'],
    ['فهرستِ کانالِ آزمایشی', { scope: 'release', key: 'beta.shops', value: true }, 'use_versions_module'],
    ['scope ِ نادرست برای پرچمِ «همه»', { scope: 's1', key: 'image_bank.central', value: true, password: PW, confirmKey: 'image_bank.central' }, 'bad_flag_scope'],
  ]) {
    const x = await put(b);
    check(`⛔ ${what} ⇒ ۴۰۰ ${code}`, x.status === 400 && x.json?.error === code, `${x.status} ${JSON.stringify(x.json)}`);
  }
  n = seen.length;
  const riskyNoPw = await put({ scope: 'all', key: 'shop.receipt_v2', value: false });
  check('⛔ پرخطر (همهٔ دکان‌ها) بی رمز ⇒ ۴۰۳ reauth_required و بی درخواست', riskyNoPw.status === 403 && riskyNoPw.json?.error === 'reauth_required' && seen.length === n);
  const riskyNoKey = await put({ scope: 'all', key: 'shop.receipt_v2', value: false, password: PW });
  check('⛔ پرخطر بی نوشتنِ نامِ کلید ⇒ ۴۰۰ confirm_key_required', riskyNoKey.status === 400 && riskyNoKey.json?.error === 'confirm_key_required');
  const spaced = await put({ scope: ' all ', key: 'image_bank.central', value: true, confirmKey: 'image_bank.central' });
  check('⛔ scope با فاصله پرخطر بودن را دور نمی‌زند ⇒ ۴۰۳ reauth_required', spaced.status === 403 && spaced.json?.error === 'reauth_required', JSON.stringify(spaced));
  check('⛔ و هیچ PUT به سرورِ حساب نرفت', !seen.slice(n).some((c) => c.method === 'PUT'));
  const okAll = await put({ scope: 'all', key: 'shop.receipt_v2', value: false, password: PW, confirmKey: 'shop.receipt_v2' });
  const putUp = seen.filter((c) => c.method === 'PUT' && c.path === '/api/admin/flags').at(-1);
  check('پرخطر با رمز و نام ⇒ ۲۰۰، بدنهٔ بالادست {scope,key,value,reason}', okAll.status === 200 && okAll.json?.confirmedByServer === true
    && JSON.stringify(putUp?.body) === JSON.stringify({ scope: 'all', key: 'shop.receipt_v2', value: false, reason: 'آزمونِ پرچم' }), JSON.stringify(putUp?.body));
  const okShop = await put({ scope: 's1', key: 'shop.receipt_v2', value: true }, T.admin2);
  check('یک دکان، پرچمِ کم‌خطر ⇒ admin ِ دوم بی رمز هم', okShop.status === 200, JSON.stringify(okShop.json));
  const riskyKeyShop = await put({ scope: 's1', key: 'shop.orders', value: true }, T.admin2);
  check('⛔ پرچمِ پولی/سفارش حتی برای یک دکان ⇒ رمز', riskyKeyShop.status === 403 && riskyKeyShop.json?.error === 'reauth_required');
  const sec = await put({ scope: 'security', key: 'hashchain.audit', value: true, password: PW, confirmKey: 'hashchain.audit' });
  check('پرچمِ امنیت در scope ِ خودش', sec.status === 200 && seen.filter((c) => c.method === 'PUT').at(-1)?.body?.scope === 'security');
  const reset = await api('POST', '/api/account-admin/console/flags/reset', { scope: 's1', key: 'shop.receipt_v2', reason: 'برگشت', confirm: true, idempotencyKey: 'shell-reset-0001' }, T.admin);
  const del = seen.filter((c) => c.method === 'DELETE' && c.path === '/api/admin/flags').at(-1);
  check('بازگشت به پیش‌فرض ⇒ DELETE با scope، key و دلیل', reset.status === 200 && reset.json?.removed === true && del?.body?.reason === 'برگشت' && del.body.scope === 's1');
  const fRows = await panelAudit(T.admin, 'account.flag');
  check('دفتر: پرچم با «to» (مقدار پوشیده نمی‌شود) و دلیل', fRows.some((r) => r.action === 'account.flag.set' && /"to":false/.test(r.detail) && /آزمونِ پرچم/.test(r.detail)) && fRows.some((r) => r.action === 'account.flag.reset'));
  caps = caps.filter((c) => c !== 'flags.v1');
  const noCap = await put({ scope: 's1', key: 'shop.receipt_v2', value: true });
  check('بی `flags.v1` ⇒ ۵۰۱، نه «انجام شد»', noCap.status === 501 && noCap.json?.error === 'capability_missing');
  caps.push('flags.v1');

  /* ── ۶) روزهای آزمایشی ── */
  console.log('\n── ۶) روزهای آزمایشی ──');
  const tr = await api('PATCH', '/api/account-admin/account-config', { trial_days: 21, reason: 'کمپینِ نوروز' }, T.admin);
  const trUp = seen.filter((c) => c.method === 'PATCH' && c.path === '/api/admin/config').at(-1);
  check('دلیل به سرورِ حساب رسید', tr.status === 200 && trUp?.body?.reason === 'کمپینِ نوروز' && trUp.body.trial_days === '21');
  const trRow = (await panelAudit(T.admin, 'account.trial'))[0];
  check('دفتر: «پیشین ⇒ تازه» و دلیل', /"from":\{"trial_days":"14"\}/.test(trRow?.detail || '') && /نوروز/.test(trRow?.detail || ''), trRow?.detail);
  check('⛔ viewer نمی‌نویسد', (await api('PATCH', '/api/account-admin/account-config', { trial_days: 3 }, T.viewer)).status === 403);

  /* ── ۷) پورتِ عمومی ── */
  console.log('\n── ۷) پورتِ عمومی ──');
  const pub = [];
  for (const [method, p] of [['GET', 'modules'], ['GET', 'summary'], ['GET', 'search?q=ab'], ['GET', 'admins'], ['POST', 'admins'], ['PUT', 'flags']]) {
    const r = await api(method, `/api/account-admin/console/${p}`, method === 'GET' ? undefined : {}, T.admin, `http://127.0.0.1:${PUBLIC}`);
    if (r.status !== 404) pub.push(`${method} ${p} ⇒ ${r.status}`);
  }
  check('⛔ هیچ درِ پوسته روی پورتِ عمومی نیست (۴۰۴)', pub.length === 0, pub.join(' · '));

  /* ── ۸) بی راهِ پیشین ⇒ «پشتیبانی نمی‌شود» ── */
  console.log('\n── ۸) بی ورودِ ارشد (فقط کلیدِ سرویس یا هیچ) ──');
  other = startPanel(PANEL + 2, PANEL + 3, { HLP_ACCOUNT_ADMIN_USER: null, HLP_ACCOUNT_ADMIN_PASSWORD: null });
  const B2 = `http://127.0.0.1:${PANEL + 2}`;
  await waitUp(B2);
  const su = await api('POST', '/api/auth/setup', { username: 'owner2', password: PW }, undefined, B2);
  const li = await api('POST', '/api/auth/login', { username: 'owner2', password: PW }, undefined, B2);
  const t2 = li.json?.token;
  check('پنلِ دوم: راه‌اندازی و ورود', Boolean(t2), `${su.status} ${JSON.stringify(su.json)} · ${li.status} ${JSON.stringify(li.json)}`);
  const nl = await api('GET', '/api/account-admin/console/admins', undefined, t2, B2);
  check('فهرستِ مدیران ⇒ ۲۰۰ ‎available:false · not_linked‎ با دلیل (کلیدِ سرویس عمداً راه ندارد)', nl.status === 200 && nl.json?.available === false && nl.json.reason === 'not_linked' && nl.json.why === 'service_key_denied', JSON.stringify(nl.json));
  const nlc = await api('POST', '/api/account-admin/console/admins', { ...goodNew, idempotencyKey: 'shell-nl-0001' }, t2, B2);
  check('ساختن ⇒ ۴۰۹ not_linked، نه «انجام شد»', nlc.status === 409 && nlc.json?.error === 'not_linked');
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  other?.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log("\n" + server.out.slice(-1500) + "\n---- other ----\n" + (other?.out || "").slice(-2500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
