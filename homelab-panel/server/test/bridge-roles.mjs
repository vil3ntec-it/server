// ---------------------------------------------------------------------------
//  هم‌خوانیِ نقش در پلِ سرورِ حساب — برای **همهٔ** مسیرهای پل، از روی خودِ کدِ سرورِ حساب
//      node test/bridge-roles.mjs            (ACCOUNT_SERVER_DIR=…/shop/server)
//
//  ممیزیِ پنلِ مرکزیِ مالک (`docs/OWNER-CONSOLE-AUDIT-fa.md` §۵-S3 و §۶-۸):
//  پل (`/api/account-admin/*` و `/api/stations-admin/cloud/*`) با حسابِ **ارشدِ** سرورِ حساب حرف
//  می‌زند، پس مرزِ نقش فقط در پنل است. سه جا جا افتاده بود (#109) و هر سه را آزمون‌هایی گرفتند که
//  مسیر به مسیر دستی نوشته شده بودند — یعنی مسیرِ تازهٔ فردا بی‌صدا از زیرشان رد می‌شد.
//
//  این سنجه دستی نیست:
//    ۱) جدولِ نقشِ سرورِ حساب را از **سورسِ خودش** می‌خواند (`src/app.js` ⇒ `routes/admin*.js`، هر
//       `requireSuperAdmin` روی هر مسیر، به ترتیبِ سوار شدن — همان «نخستین تطابق»ِ express).
//    ۲) فهرستِ مسیرهای پل را از **خودِ روترهای پنل** می‌گیرد (`router.stack`)، نه از یک کپی.
//    ۳) هر مسیرِ پل را با نقشِ admin می‌زند و می‌بیند **واقعاً** کدام مسیرِ سرورِ حساب صدا زده شد
//       (سرورِ حسابِ ساختگیِ ضبط‌کننده)؛ بعد همان را با operator و viewer.
//
//  قاعده‌ها (هر کدام یک بند):
//    ⛔ مقصدِ «فقط ارشد» ⇒ operator و viewer ۴۰۳ می‌گیرند و **هیچ** درخواستی به سرورِ حساب نمی‌رسد.
//    ⛔ viewer هیچ نوشتنی (غیرِ GET) به سرورِ حساب نمی‌رساند — جز فهرستِ کوتاه و دلیل‌دارِ `VIEWER_POST`.
//    ⛔ هر مقصدی که پل صدا می‌زند روی سرورِ حساب **هست** — جز مسیرهای فاز ۳ که پشتِ سنجشِ «توانایی»اند.
//    ⛔ هر مسیرِ پل دستِ‌کم یک مقصد دارد (وگرنه سنجه کورش است) — جز `LOCAL`ِ دلیل‌دار.
//  ⚠️ تنگ‌تر بودنِ پنل (admin در برابرِ مدیرِ عادیِ آن‌جا) مجاز است و سنجیده نمی‌شود.
//  ⚠️ بی کدِ سرورِ حساب (ACCOUNT_SERVER_DIR / HLP_ACCOUNT_DIR / ../shop/server) «رد شد» — نه سبز.
//     در CI همان کلونِ `vil3ntec-it/shop` است (`ci.yml`).
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOP = [
  process.env.ACCOUNT_SERVER_DIR,
  process.env.HLP_ACCOUNT_DIR,
  path.resolve(here, '..', '..', '..', '..', 'shop', 'server'),
].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'src', 'app.js')) && fs.existsSync(path.join(d, 'src', 'routes', 'admin.js')));

if (!SHOP) {
  console.log('⚠️  کدِ سرورِ حساب پیدا نشد (ACCOUNT_SERVER_DIR، HLP_ACCOUNT_DIR یا ../shop/server) — این سنجه رد شد، نه سبز.');
  process.exit(0);
}

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 1500)}`);
};

/* ───────────────────── ۱) جدولِ نقشِ سرورِ حساب، از سورس ───────────────────── */

const read = (rel) => fs.readFileSync(path.join(SHOP, 'src', rel), 'utf8');
//  توضیح‌ها بیرون، تا کدِ توضیح‌شده (مثلاً یک مسیرِ کنارگذاشته) خوانده نشود
const bare = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const join = (a, b) => (`${a}${b === '/' ? '' : b}`) || '/';

const unparsed = [];
const shopRoutes = [];   // به ترتیبِ سوار شدن: { method, path, superOnly, file }

/** `${prefix}`ِ حلقهٔ `for (const [prefix, app] of [['/a', …], ['/b', …]])` ⇒ هر دو */
function expand(src, p) {
  const loop = /for\s*\(\s*const\s*\[\s*(\w+)\s*,[^\]]*\]\s*of\s*(\[[\s\S]*?\]\s*\])\s*\)/.exec(src);
  if (!loop || !p.includes(`\${${loop[1]}}`)) return null;
  const firsts = [...loop[2].matchAll(/\[\s*'([^']+)'/g)].map((m) => m[1]);
  const out = firsts.map((x) => p.replaceAll(`\${${loop[1]}}`, x));
  return out.some((x) => x.includes('${')) ? null : out;
}

function routesOf(rel, prefix, seen = new Set()) {
  if (seen.has(rel + prefix)) return;
  seen.add(rel + prefix);
  const src = bare(read(rel));
  let fileSuper = false;
  for (const m of src.matchAll(/\brouter\.(get|post|put|patch|delete|use)\(\s*(?:(['`])([^'`]*)\2\s*,?)?/g)) {
    const verb = m[1];
    const p = m[3];
    const rest = src.slice(m.index + m[0].length, m.index + m[0].length + 600);
    if (verb === 'use') {
      if (p === undefined) {
        if (/^\s*requireSuperAdmin\b/.test(rest)) fileSuper = true;
        continue;
      }
      const sub = /^\s*require\(\s*'\.\/([a-z0-9-]+)'\s*\)/.exec(rest);
      if (sub) routesOf(`routes/${sub[1]}.js`, join(prefix, p), seen);
      continue;
    }
    if (p === undefined) { unparsed.push(`${rel}: ${m[0]}`); continue; }
    const head = rest.split(/\basync\b|\bwrap\(|\(\s*req\s*,|\bfunction\b/)[0];
    const superOnly = fileSuper || /\brequireSuperAdmin\b/.test(head);
    const paths = p.includes('${') ? expand(src, p) : [p];
    if (!paths) { unparsed.push(`${rel}: ${p}`); continue; }
    for (const pp of paths) shopRoutes.push({ method: verb.toUpperCase(), path: join(prefix, pp), superOnly, file: rel });
  }
}

{
  const app = bare(read('app.js'));
  for (const m of app.matchAll(/\bapi\.use\(\s*'(\/admin[^']*)'\s*,\s*require\(\s*'\.\/routes\/([a-z0-9-]+)'\s*\)\s*\)/g)) {
    routesOf(`routes/${m[2]}.js`, `/api${m[1]}`);
  }
}
const toRe = (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]\w*/g, '[^/]+')}/?$`);
for (const r of shopRoutes) r.re = toRe(r.path);
const shopRoleOf = (method, p) => shopRoutes.find((r) => r.method === method && r.re.test(p)) || null;

console.log(`\n── جدولِ نقشِ سرورِ حساب (${path.relative(process.cwd(), SHOP) || SHOP}) ──`);
check(`مسیرهای مدیرِ سرورِ حساب از سورس خوانده شد (${shopRoutes.length} مسیر، ${shopRoutes.filter((r) => r.superOnly).length} فقط ارشد)`,
  shopRoutes.length > 150 && shopRoutes.filter((r) => r.superOnly).length > 30, `${shopRoutes.length}`);
check('هیچ تعریفِ مسیری خوانده‌نشده نماند', unparsed.length === 0, unparsed.join(' · '));
//  لنگرهای شناخته — اگر خواندنِ سورس جایی بلغزد، همین‌جا سرخ می‌شود، نه بی‌صدا سبز
for (const [method, p, want] of [
  ['POST', '/api/admin/sync/conflicts/x/restore', true],
  ['GET', '/api/admin/sync/status', false],
  ['GET', '/api/admin/release/beta', true],
  ['POST', '/api/admin/pump/subscriptions/x/permanent', true],
  ['POST', '/api/admin/subscriptions/x/discount', true],
  ['POST', '/api/admin/pump/vip-codes', true],
  ['POST', '/api/admin/sms/test', true],
  ['POST', '/api/admin/email/test', false],
  ['GET', '/api/admin/shops/x/staff-codes', false],
  ['POST', '/api/admin/shops/x/staff-codes/reveal', true],
  ['GET', '/api/admin/trust/cases', true],
]) {
  const r = shopRoleOf(method, p);
  check(`لنگر: ${method} ${p} ⇒ ${want ? 'فقط ارشد' : 'مدیر'}`, Boolean(r) && r.superOnly === want, r ? `${r.file} ${r.path} super=${r.superOnly}` : 'پیدا نشد');
}

/* ───────────────────── ۲) مسیرهای پل، از خودِ روترهای پنل ───────────────────── */

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'bridge-roles-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'unit');
process.env.HLP_ACCOUNT_API = '0';
const accountAdmin = (await import('../src/routes/account-admin.js')).default;
const { adminRouter: stationsAdmin } = await import('../src/routes/stations.js');
const listOf = (router, base, keep = () => true) => router.stack
  .filter((l) => l.route && keep(l.route.path))
  .flatMap((l) => Object.keys(l.route.methods).filter((x) => x !== '_all').map((m) => ({ method: m.toUpperCase(), path: l.route.path, base })));
const BRIDGE = [
  ...listOf(accountAdmin, '/api/account-admin'),
  ...listOf(stationsAdmin, '/api/stations-admin', (p) => p.startsWith('/cloud/')),
];

/*
 *  مسیرهای پل که در این سنجه هیچ درخواستی به مسیرهای مدیرِ سرورِ حساب نمی‌زنند — با دلیل.
 *  ⚠️ سنجیده می‌شود که واقعاً نمی‌زنند؛ پلِ پنهان این‌جا جا نمی‌شود.
 */
const LOCAL = new Map([
  ['GET /api/stations-admin/cloud/status', 'حالِ اتصالِ خودِ پنل (گاوصندوق/ورودِ خودکار)'],
  ['POST /api/stations-admin/cloud/forget', 'پاک کردنِ توکنِ ذخیره‌شده در گاوصندوقِ پنل'],
  ['GET /api/stations-admin/cloud/mirror', 'حالِ آینهٔ محلی روی دیسکِ پنل'],
  ['POST /api/stations-admin/cloud/login', 'فقط ‎POST /api/admin/login‎ (ورودِ خودِ مدیر با نام و رمز؛ admin ِ پنل) — مسیرِ نقش‌دار نیست'],
  ['POST /api/stations-admin/cloud/mirror', 'با HLP_STATIONS=0 خاموش است (۵۰۳)؛ همان خواندنی‌های `cloudCall` را می‌زند که مسیرهای GETِ ‎/cloud/*‎ همین‌جا سنجیده‌اند'],
  //  چسبِ فاز ۳ — کلیدِ سرویس: بی کلیدِ ذخیره‌شده (همین سنجه) چیزی به سرورِ حساب نمی‌رود؛ با کلید هم فقط مالکِ
  //  admin (‎ownerOnly‎ + احرازِ دوباره) — مرزش را `account-admin.mjs` بند به بند می‌سنجد
  ['GET /api/account-admin/console/service-key', 'حالِ کلیدِ ذخیره‌شدهٔ خودِ پنل؛ بی کلید هیچ پرسشی به سرورِ حساب نمی‌رود (فقط admin)'],
  ['POST /api/account-admin/console/service-key/revoke', 'بی کلیدِ ذخیره‌شده ۴۰۴ ِ محلی؛ با کلید فقط مالک + رمز ⇒ درِ ابطالِ «فقط ارشد» (account-admin.mjs)'],
  //  پوستهٔ کنسول: فهرستِ ماژول‌ها از `console/modules.js` ِ خودِ پنل — بی هیچ پرسشی از سرورِ حساب
  ['GET /api/account-admin/console/modules', 'فهرستِ ماژول‌های همین نقش از فهرستِ خودِ پنل (console/modules.js)'],
]);

/*
 *  مقصدهای **عمومیِ** سرورِ حساب (بیرون از ‎/api/admin‎، بی نشستِ مدیر) — نقشی ندارند که بسنجیم.
 */
const PUBLIC_UP = new Map([
  ['GET /api/pump/plans', 'پلن و قیمتِ عمومیِ پمپ — همان چیزی که برنامهٔ پمپ بی ورود می‌خواند'],
]);

/*
 *  POSTهایی که viewer می‌زند و به سرورِ حساب هم می‌رسند — فقط «نگاه»، با دلیل.
 *  ⛔ این فهرست جای «آزمون»ی که می‌فرستد نیست (ایمیل/پیامک/اعلانِ آزمایشی) — #109.
 */
const VIEWER_POST = new Map([
  ['POST /api/admin/notices/:id/preview', 'فقط متنِ اعلان را برای دیدن می‌سازد؛ نه می‌فرستد نه ذخیره می‌کند'],
]);

/*
 *  مقصدهای فاز ۳ (ریپوی shop) — هنوز روی سرورِ حساب نیستند؛ پل فقط وقتی صدایشان می‌زند که سرورِ حساب
 *  توانایی‌اش را در ‎GET /api/admin/me‎ (`capabilities`) اعلام کند. روزی که آمدند، نقششان هم مثلِ بقیه
 *  سنجیده می‌شود (این فهرست فقط «نبودن» را می‌بخشد، نه نقش را).
 */
const PHASE3 = ['GET /api/admin/shops/:id/health', 'GET /api/admin/shops/:id/holds', 'POST /api/admin/shops/:id/holds',
  'POST /api/admin/shops/:id/holds/:holdId/lift', 'GET /api/admin/flags', 'GET /api/admin/flags/history',
  'POST /api/admin/service-keys', 'POST /api/admin/service-keys/:id/revoke',
  //  پوستهٔ کنسول (shop، شاخهٔ claude/console-shell-api): `admin-sessions.v1` و `search.v1`
  'GET /api/admin/admins/:id/sessions', 'POST /api/admin/admins/:id/sessions/revoke', 'GET /api/admin/search',
  //  نوشتنِ پرچم (‎flags.v1‎ ِ #597) — پوسته فقط با همان توانایی صدایش می‌زند
  'PUT /api/admin/flags', 'DELETE /api/admin/flags',
  //  ۴.۶ و ۴.۷ (shop: claude/console-market-api) — پشتِ `market-admin.v1` و `delivery-watch.v1`
  'GET /api/admin/market/overview', 'GET /api/admin/market/sellers', 'GET /api/admin/market/orders',
  'GET /api/admin/market/commission', 'GET /api/admin/market/history', 'GET /api/admin/delivery/overview',
  'GET /api/admin/delivery/queue', 'GET /api/admin/delivery/events', 'GET /api/admin/delivery/connectivity',
  'GET /api/admin/delivery/report', 'GET /api/admin/delivery/thresholds', 'PUT /api/admin/delivery/thresholds']
  .map((x) => { const [method, p] = x.split(' '); return { method, re: toRe(p), id: x }; });
const phase3Of = (method, p) => PHASE3.find((x) => x.method === method && x.re.test(p)) || null;

/* ───────────────────── ۳) سرورِ حسابِ ساختگیِ ضبط‌کننده ───────────────────── */

const NOW = Date.now();
const calls = [];
//  مسیرهایی که پنل خودش در پس‌زمینه می‌زند (دیدبانِ زنده)، نه در پاسخ به یک درخواست
const BACKGROUND = /^\/api\/admin\/stamps$/;
const sample = {
  ok: true,
  shop: { id: 'x1', name: 'دکان', status: 'active', ownerUserId: 'u1', createdAt: NOW },
  user: { id: 'u1', name: 'کاربر', email: 'a@b.af', status: 'active' },
  shops: [{ id: 'x1', name: 'دکان', status: 'active', owner_user_id: 'u1', owner_email: 'a@b.af', sub_status: 'active', ends_at: NOW + 9e8 }],
  stations: [{ id: 'x1', name: 'پمپ', status: 'active', owner_user_id: 'u1' }],
  users: [{ id: 'u1', name: 'کاربر', email: 'a@b.af' }],
  subscriptions: [{ id: 'x1', shop_id: 'x1', station_id: 'x1', plan: 'm1', status: 'active', starts_at: NOW - 9e8, ends_at: NOW + 9e8, features: [] }],
  subscription: { id: 'x1', plan: 'm1', status: 'active', ends_at: NOW + 9e8 },
  entitlement: { subscription: { id: 'x1', status: 'active', active: true }, trial: {} },
  plans: [{ code: 'm1', title: 'یک‌ماهه', amount: 1, unit: 'month', price: 1 }],
  config: { trial_days: '14', pump_trial_days: '30' },
  items: [], threads: [], messages: [], entries: [], codes: [], payments: [], requests: [], visitors: [], apps: [],
  notices: [], campaigns: [], reps: [], addons: [], errors: [], conflicts: [], devices: [], logins: [], series: [],
  thread: { id: 'x1', status: 'open' }, notice: { id: 'x1' }, payment: { id: 'x1' }, code: 'X', token: 'tok-1',
  total: 1, serverTime: NOW,
  //  پوستهٔ کنسول: کاتالوگِ پرچم (تا PUT/DELETE ِ «فقط ارشد» واقعاً دیده شود)، نوع‌های جست‌وجو، مدیرِ غیرِمالک
  known: [{ key: 'shop.receipt_v2', scope: 'shop', default: false }],
  kinds: ['shops', 'users', 'payments', 'orders', 'errors', 'admins'], results: {},
  admins: [{ id: 'x1', username: 'other', role: 'admin', status: 'active', is_owner: false }],
  sessions: [],
};
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const j = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
    if (p === '/api/health') return j(200, { ok: true, server: 'online', version: '9.9.9' });
    if (p === '/api/admin/login') return j(200, { token: 'tok-1', expiresAt: NOW + 12 * 3600e3 });
    if (!BACKGROUND.test(p)) calls.push({ method: req.method, path: p });
    //  همهٔ تواناییِ فاز ۳ اعلام می‌شود تا مقصدِ آن مسیرها هم دیده و سنجیده شود
    if (p === '/api/admin/me') return j(200, { admin: { id: 'a1', username: 'boss', role: 'superadmin' }, capabilities: ['shop-health.v1', 'shop-holds.v1', 'flags.v1', 'actor.v1', 'service-key.v1', 'admin-sessions.v1', 'search.v1', 'market-admin.v1', 'delivery-watch.v1'], serverTime: NOW });
    if (/\/receipt$/.test(p)) { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end('<html>رسید</html>'); }
    if (/^\/api\/admin\/support\/media\//.test(p)) { res.setHeader('content-type', 'image/png'); return res.end(Buffer.from([137, 80, 78, 71])); }
    return j(200, sample);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

/* ───────────────────── ۴) پنلِ واقعی و سه نقش ───────────────────── */

const PANEL = Number(process.env.TEST_PORT || 4931);
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  cwd: path.join(here, '..'),
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '0', HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
         HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret',
         HLP_AUTH_RATE_LIMIT: '100000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function hit(method, url, token, body, contentType = 'application/json') {
  const res = await fetch(BASE + url, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': contentType } : {}) },
    body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body)),
  });
  await res.arrayBuffer().catch(() => null);
  return res.status;
}

/** مقدارِ نمونه برای هر پارامترِ مسیر */
const PARAMS = { id: 'x1', code: 'm1', key: 'k1', mid: 'md1', deviceId: 'd1', action: 'revoke', addonId: 'ad1' };
/** بدنهٔ پُر تا اعتبارسنجیِ پنل پیش از پل رد نکند */
const bodyFor = (app) => ({
  app, reason: 'سنجهٔ هم‌خوانیِ نقش', status: 'active', disabled: true, amount: 1, unit: 'month', plan: 'm1',
  days: 30, months: 1, email: 'a@b.af', to: 'a@b.af', target: 'a@b.af', title: 'آزمون', body: 'متن', subject: 'آزمون',
  percent: 10, value: 10, kind: 'percent', feature: 'cloud', price: 1, fullPrice: 1, currency: 'AFN', method: 'cash',
  paidAt: NOW, shopId: 'x1', stationId: 'x1', accountId: 'x1', tenantId: 'x1', userId: 'u1', subscriptionId: 'x1',
  computer: 'K7QW-2MZD-9XRT-B4NA', note: 'آزمون', label: 'آزمون', name: 'آزمون', commissionPct: 5, code: 'NOWRUZ',
  channels: ['inapp'], audience: { kind: 'all' }, filter: { kind: 'all' }, at: NOW + 3600e3, scheduleAt: NOW + 3600e3,
  pump_trial_days: 30, trial_days: 14, provider: 'log', enabled: false, username: 'boss', password: 'top-secret',
  slug: 'shop', url: 'https://x.af', until: NOW + 9e8, endsAt: NOW + 9e8, startsAt: NOW, maxUses: 1,
});
const SPECIAL = {
  'POST /api/account-admin/support/threads/:id/media': { body: Buffer.from([137, 80, 78, 71]), type: 'image/png', query: '&name=a.png' },
  //  ساختنِ کلیدِ سرویس: مالک با رمزِ درستِ خودش (احرازِ دوباره) تا مقصدِ «فقط ارشد» واقعاً دیده و سنجیده شود
  'POST /api/account-admin/console/service-key': { body: { reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, password: 'Bridge-1405-roles' } },
  //  گذاشتنِ حالت: نوعِ معتبر و کلیدِ یکتایی (بدنهٔ همگانی `kind: 'percent'` دارد)
  'POST /api/account-admin/console/shops/:id/holds': { body: { kind: 'archived', reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, idempotencyKey: 'bridge-roles-0001' } },
  'POST /api/account-admin/console/shops/:id/holds/:holdId/lift': { body: { reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true } },
  //  پوستهٔ کنسول: جست‌وجو یک ‎q‎ می‌خواهد؛ نوشتن‌ها (مالک + رمزِ پنل + دلیل + تأیید + کلیدِ یکتایی) تا مقصدِ «فقط ارشد» دیده شود
  'GET /api/account-admin/console/search': { query: '&q=ab' },
  'POST /api/account-admin/console/admins': { body: { username: 'bridge.role', role: 'viewer', adminPassword: 'Bridge-role-1405!', reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, idempotencyKey: 'bridge-roles-adm-0001', password: 'Bridge-1405-roles' } },
  'POST /api/account-admin/console/admins/:id/update': { body: { role: 'viewer', reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, idempotencyKey: 'bridge-roles-adm-0002', password: 'Bridge-1405-roles' } },
  'POST /api/account-admin/console/admins/:id/sessions/revoke': { body: { reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, idempotencyKey: 'bridge-roles-adm-0003', password: 'Bridge-1405-roles' } },
  'PUT /api/account-admin/console/flags': { body: { scope: 'all', key: 'shop.receipt_v2', value: true, reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, confirmKey: 'shop.receipt_v2', idempotencyKey: 'bridge-roles-flag-0001', password: 'Bridge-1405-roles' } },
  'POST /api/account-admin/console/flags/reset': { body: { scope: 'all', key: 'shop.receipt_v2', reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, confirmKey: 'shop.receipt_v2', idempotencyKey: 'bridge-roles-flag-0002', password: 'Bridge-1405-roles' } },
  //  ۴.۶ و ۴.۷: کارِ حساس با رمزِ همان admin (احرازِ دوباره) تا مقصدِ «فقط ارشد» واقعاً دیده و سنجیده شود
  'POST /api/account-admin/console/market/trust/cases/:id/assign': { body: { confirm: true } },
  'POST /api/account-admin/console/market/trust/cases/:id/decide': { body: { outcome: 'upheld', reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, password: 'Bridge-1405-roles' } },
  'POST /api/account-admin/console/market/trust/cases/:id/appeal-decision': { body: { outcome: 'upheld', reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, password: 'Bridge-1405-roles' } },
  'POST /api/account-admin/console/market/trust/sanctions/:id/lift': { body: { reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, password: 'Bridge-1405-roles' } },
  'PUT /api/account-admin/console/delivery/thresholds': { body: { thresholds: { dispatchMin: 45 }, reason: 'سنجهٔ هم‌خوانیِ نقش', confirm: true, password: 'Bridge-1405-roles' } },
};
const urlOf = (r, app) => {
  const p = r.path.replace(/:([A-Za-z_]\w*)/g, (_, k) => (k === 'app' ? app : PARAMS[k] || 'x1'));
  const extra = SPECIAL[`${r.method} ${r.base}${r.path}`]?.query || '';
  return `${r.base}${p}?app=${app}&version=2.14.4&scope=all&limit=5${extra}`;
};

const failures = { unmapped: [], missing: [], superLeak: [], viewerWrite: [], localLeak: [] };
const superReached = new Set();
const upstreamSeen = new Set();

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const login = async (username, password) => (await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }),
  })).json())?.token;
  await fetch(`${BASE}/api/auth/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Bridge-1405-roles' }) });
  const admin = await login('admin', 'Bridge-1405-roles');
  for (const [u, role] of [['op1', 'operator'], ['view1', 'viewer']]) {
    await fetch(`${BASE}/api/auth/users`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
      body: JSON.stringify({ username: u, password: `Bridge-${role}-1405`, role }) });
  }
  const tokens = { admin, operator: await login('op1', 'Bridge-operator-1405'), viewer: await login('view1', 'Bridge-viewer-1405') };
  check('سه نشست: admin · operator · viewer', Object.values(tokens).every(Boolean), JSON.stringify(Object.keys(tokens).filter((k) => !tokens[k])));

  console.log(`\n── ${BRIDGE.length} مسیرِ پل، هر کدام با سه نقش و دو بخش ──`);
  /** یک درخواست ⇒ وضعیت و درخواست‌هایی که همان لحظه به سرورِ حساب رسید (پشتِ سرِ هم، نه هم‌زمان) */
  const run = async (r, role, app) => {
    const before = calls.length;
    const sp = SPECIAL[`${r.method} ${r.base}${r.path}`];
    const body = r.method === 'GET' || r.method === 'DELETE' ? undefined : (sp?.body ?? bodyFor(app));
    const status = await hit(r.method, urlOf(r, app), tokens[role], body, sp?.type);
    await new Promise((res) => setTimeout(res, 5));
    return { status, up: calls.slice(before) };
  };

  for (const r of BRIDGE) {
    const id = `${r.method} ${r.base}${r.path}`;
    const upAll = [];
    for (const app of ['shop', 'pump']) {
      const a = await run(r, 'admin', app);
      upAll.push(...a.up);
    }
    if (LOCAL.has(id)) {
      if (upAll.length) failures.localLeak.push(`${id} ⇒ ${upAll.map((c) => `${c.method} ${c.path}`).join(', ')}`);
      continue;
    }
    if (!upAll.length) { failures.unmapped.push(id); continue; }

    let needsAdmin = false;
    for (const c of upAll) {
      if (PUBLIC_UP.has(`${c.method} ${c.path}`)) continue;
      const role = shopRoleOf(c.method, c.path);
      if (!role) {
        if (!phase3Of(c.method, c.path)) failures.missing.push(`${id} ⇒ ${c.method} ${c.path}`);
        continue;
      }
      upstreamSeen.add(`${role.method} ${role.path}`);
      if (role.superOnly) { needsAdmin = true; superReached.add(`${role.method} ${role.path}`); }
    }

    for (const role of ['operator', 'viewer']) {
      for (const app of ['shop', 'pump']) {
        const { status, up } = await run(r, role, app);
        if (needsAdmin && (status !== 403 || up.length)) {
          failures.superLeak.push(`${role} ${id} (${app}) ⇒ ${status} ${up.map((c) => `${c.method} ${c.path}`).join(', ')}`);
        }
        if (role === 'viewer') {
          const leaked = up.filter((c) => {
            if (c.method === 'GET') return false;
            const s = shopRoleOf(c.method, c.path);
            return !(s && VIEWER_POST.has(`${s.method} ${s.path}`));
          });
          if (leaked.length) failures.viewerWrite.push(`${id} (${app}) ⇒ ${status} ${leaked.map((c) => `${c.method} ${c.path}`).join(', ')}`);
        }
      }
    }
  }

  console.log(`\n── نتیجه: ${upstreamSeen.size} مقصدِ سرورِ حساب، ${superReached.size} از آن‌ها فقط ارشد ──`);
  check('⛔ هر مقصدِ «فقط ارشد» در پنل فقط admin است — operator و viewer ۴۰۳ و هیچ درخواستی به سرورِ حساب',
    failures.superLeak.length === 0, failures.superLeak.join('\n      '));
  check('⛔ viewer هیچ نوشتنی به سرورِ حساب نمی‌رساند (جز پیش‌نمایشِ دلیل‌دار)',
    failures.viewerWrite.length === 0, failures.viewerWrite.join('\n      '));
  check('⛔ هر مقصدِ پل روی سرورِ حساب هست (جز فاز ۳ ِ پشتِ «توانایی»)',
    failures.missing.length === 0, failures.missing.join('\n      '));
  check('هر مسیرِ پل دستِ‌کم یک مقصد دارد — سنجه هیچ مسیری را کور رد نکرد',
    failures.unmapped.length === 0, failures.unmapped.join(' · '));
  check('مسیرهای محلیِ دلیل‌دار واقعاً به سرورِ حساب نمی‌روند', failures.localLeak.length === 0, failures.localLeak.join(' · '));
  check(`و سنجه دندان دارد: دستِ‌کم ده مقصدِ «فقط ارشد» از راهِ پل دیده و سنجیده شد (${superReached.size})`,
    superReached.size >= 10, [...superReached].join(' · '));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill('SIGTERM');
  fake.close();
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

if (fail) console.log('\n' + out.slice(-1500));
console.log(`\n${fail ? '❌' : '✅'} ${pass} سبز، ${fail} قرمز\n`);
process.exit(fail ? 1 : 0);
