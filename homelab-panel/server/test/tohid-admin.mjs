// ---------------------------------------------------------------------------
//  آزمونِ برنامهٔ مدیریتِ توحید — /api/v1/admin/**
//      node test/tohid-admin.mjs
//
//  اینجا سرورِ واقعی بالا می‌آید، یک مشتری واقعاً از راهِ برنامه ثبت‌نام
//  می‌کند، و بعد همان مسیرهایی صدا زده می‌شود که برنامهٔ اندروید صدا می‌زند
//  — با همان نام‌های میدان که آن برنامه می‌خواند. اگر اسمی عوض شود، اینجا
//  می‌شکند، نه روی گوشیِ کسی که وسطِ بازار ایستاده.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4841);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'th-admin-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 240)}`);
};

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '0', HLP_AI_ENABLED: '0', HLP_TUNNEL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const api = async (p, { method = 'GET', body, token } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const DAY = 24 * 60 * 60 * 1000;
const ADMIN_PASSWORD = 'ControlCenter!2026';

try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const setup = await api('/api/auth/setup', {
    method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD },
  });
  check('پنل بالا آمد', Boolean(setup.data.token), JSON.stringify(setup.data).slice(0, 120));

  /* ───────────────── مشتری، از راهِ خودِ برنامه ───────────────── */

  console.log('\n── مشتری در برنامه ثبت‌نام می‌کند ──');
  const reg = await api('/api/v1/auth/register', {
    method: 'POST',
    body: { name: 'عبدالله', email: 'abdullah@example.com', phone: '0700111222', password: 'shop-pass-1' },
  });
  check('حساب ساخته شد', reg.status === 200 && reg.data.ok === true, JSON.stringify(reg.data).slice(0, 160));

  const login = await api('/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'abdullah@example.com', password: 'shop-pass-1' },
  });
  const customerToken = login.data.accessToken;
  check('مشتری وارد شد', Boolean(customerToken), JSON.stringify(login.data).slice(0, 120));

  await api('/api/v1/shop/create', {
    method: 'POST', token: customerToken, body: { name: 'دکان عبدالله' },
  });

  // درخواستِ خرید، همان‌طور که خودِ برنامه می‌فرستد
  await api('/api/v1/billing/request', {
    method: 'POST', token: customerToken,
    body: { planCode: 'm1', contact: '0700111222', message: 'یک ماهه می‌خواهم' },
  });

  /* ───────────────── ورودِ برنامهٔ مدیریت ───────────────── */

  console.log('\n── ورودِ برنامهٔ مدیریت ──');
  const bad = await api('/api/v1/admin/login', {
    method: 'POST', body: { username: 'admin', password: 'غلط' },
  });
  check('رمزِ غلط رد می‌شود', bad.status === 401, JSON.stringify(bad.data).slice(0, 120));
  check('پیامِ خطا برای برنامه خواناست',
    typeof bad.data?.error?.message === 'string' && bad.data.error.message.length > 0,
    JSON.stringify(bad.data));

  const admin = await api('/api/v1/admin/login', {
    method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD },
  });
  const token = admin.data.token;
  check('مدیر وارد شد', Boolean(token), JSON.stringify(admin.data).slice(0, 160));
  check('نقش برمی‌گردد', admin.data.admin?.role === 'admin', JSON.stringify(admin.data.admin));

  const noToken = await api('/api/v1/admin/stats');
  check('بدونِ توکن هیچ‌چیز', noToken.status === 401, String(noToken.status));

  /* ───────────────── داشبورد ───────────────── */

  console.log('\n── داشبورد ──');
  const stats = await api('/api/v1/admin/stats', { token });
  const s = stats.data;
  check('شمارِ کاربران درست است', s.users === 1, JSON.stringify(s));
  check('شمارِ دکان‌ها درست است', s.shops === 1, JSON.stringify(s));
  check('درخواستِ خرید دیده می‌شود', s.pendingRequests === 1, JSON.stringify(s));
  check('ساعتِ سرور می‌آید', typeof s.serverTime === 'number' && s.serverTime > 0, String(s.serverTime));

  /* ───────────────── کاربران ───────────────── */

  console.log('\n── کاربران ──');
  const users = await api('/api/v1/admin/users?limit=50&q=', { token });
  const u = users.data.users?.[0];
  check('کاربر در فهرست است', Array.isArray(users.data.users) && users.data.users.length === 1);
  check('نام و شماره می‌آید', u?.name === 'عبدالله' && u?.phone === '0700111222', JSON.stringify(u));
  check('نامِ دکان کنارِ نامش است', u?.shop_name === 'دکان عبدالله', JSON.stringify(u));
  check('وضعیت active است', u?.status === 'active', String(u?.status));

  const found = await api(`/api/v1/admin/users?limit=50&q=${encodeURIComponent('عبدالله')}`, { token });
  check('جستجو با نام کار می‌کند', found.data.users?.length === 1, String(found.data.users?.length));
  const missing = await api('/api/v1/admin/users?limit=50&q=هیچ‌کس', { token });
  check('جستجوی بی‌نتیجه، تهی برمی‌گردد', missing.data.users?.length === 0);

  const detail = await api(`/api/v1/admin/users/${u.id}`, { token });
  check('صفحهٔ کاربر باز می‌شود', detail.data.user?.id === u.id, JSON.stringify(detail.data).slice(0, 160));
  check('تاریخِ ساخت عدد است', typeof detail.data.user?.createdAt === 'number');
  check('عضویت در دکان دیده می‌شود',
    detail.data.memberships?.[0]?.shop_name === 'دکان عبدالله',
    JSON.stringify(detail.data.memberships));
  check('فهرستِ دستگاه‌ها هست', Array.isArray(detail.data.devices));

  /* ───────────────── فروشِ اشتراک ───────────────── */

  console.log('\n── فروشِ اشتراک ──');
  const shops = await api('/api/v1/admin/shops?limit=50&q=', { token });
  const shop = shops.data.shops?.[0];
  check('مشتری در فهرستِ دکان‌هاست', shops.data.shops?.length === 1, JSON.stringify(shops.data).slice(0, 200));
  check('نامِ دکان نشان داده می‌شود', shop?.name === 'دکان عبدالله', JSON.stringify(shop));
  check('صاحب و شماره‌اش می‌آید',
    shop?.owner_name === 'عبدالله' && shop?.owner_phone === '0700111222', JSON.stringify(shop));
  check('هنوز اشتراکی ندارد', shop?.sub_status === null, String(shop?.sub_status));

  const plans = await api('/api/v1/admin/plans', { token });
  const plan = plans.data.plans?.find((p) => p.code === 'm1');
  check('پلن‌ها از سرور می‌آیند', (plans.data.plans?.length || 0) >= 3, JSON.stringify(plans.data.plans));
  check('پلن مدت و واحد دارد', plan?.amount === 1 && plan?.unit === 'month', JSON.stringify(plan));

  const granted = await api('/api/v1/admin/subscriptions', {
    method: 'POST', token, body: { shopId: shop.id, plan: 'm1', note: 'رسید ۱۲۳' },
  });
  check('اشتراک صادر شد', granted.status === 201 && granted.data.subscription?.status === 'active',
    JSON.stringify(granted.data).slice(0, 200));
  const firstEnd = granted.data.subscription?.ends_at;
  check('پایانِ اشتراک حدودِ یک ماه بعد است',
    Math.abs(firstEnd - (Date.now() + 30 * DAY)) < 5 * 60 * 1000,
    new Date(firstEnd).toISOString());

  // همان چیزی که مشتری در برنامه‌اش می‌بیند
  const ent = await api('/api/v1/billing/status', { token: customerToken });
  check('مشتری بلافاصله VIP می‌شود', ent.data.entitlement?.isPaid === true,
    JSON.stringify(ent.data.entitlement).slice(0, 200));
  check('قابلیتِ فروش برایش باز شد', ent.data.entitlement?.features?.includes('sales') === true,
    JSON.stringify(ent.data.entitlement?.features));

  /* ───────────────── تمدید ───────────────── */

  console.log('\n── تمدید ──');
  const again = await api('/api/v1/admin/subscriptions', {
    method: 'POST', token, body: { shopId: shop.id, plan: 'custom', days: 10 },
  });
  const secondEnd = again.data.subscription?.ends_at;
  check('تمدید به پایانِ قبلی اضافه شد، نه از امروز',
    Math.abs(secondEnd - (firstEnd + 10 * DAY)) < 5 * 60 * 1000,
    `${new Date(firstEnd).toISOString()} → ${new Date(secondEnd).toISOString()}`);

  const one = await api(`/api/v1/admin/shops/${shop.id}`, { token });
  const live = one.data.subscriptions?.[0];
  check('اشتراکِ زنده اولِ فهرست است', live?.status === 'active' && live?.ends_at === secondEnd,
    JSON.stringify(live).slice(0, 200));
  check('حقِ دسترسی هم می‌آید', one.data.entitlement?.isPaid === true);
  check('اعضای دکان می‌آیند', one.data.members?.[0]?.name === 'عبدالله',
    JSON.stringify(one.data.members));

  /* ───────────────── درست کردنِ تاریخ ───────────────── */

  console.log('\n── نشاندنِ تاریخِ پایان ──');
  const fixed = Date.now() + 90 * DAY;
  const put = await api(`/api/v1/admin/subscriptions/${live.id}`, {
    method: 'PUT', token, body: { endsAt: fixed },
  });
  check('تاریخِ پایان نشانده شد', put.data.subscription?.ends_at === fixed,
    JSON.stringify(put.data.subscription).slice(0, 160));

  /* ───────────────── دفترِ تغییرها ───────────────── */

  console.log('\n── دفترِ تغییرها ──');
  const history = await api(`/api/v1/admin/shops/${shop.id}/history`, { token });
  const h = history.data.history || [];
  check('هر سه کار ثبت شده', h.length === 3, `${h.length} ردیف`);
  check('تازه‌ترین اول است', h[0]?.action === 'set_end', JSON.stringify(h.map((r) => r.action)));
  check('از چه تاریخی به چه تاریخی، ثبت است',
    h[0]?.prev_ends_at === secondEnd && h[0]?.new_ends_at === fixed,
    JSON.stringify(h[0]));
  check('صادرکننده ثبت شده', h[2]?.action === 'grant' && h[2]?.actor === 'admin', JSON.stringify(h[2]));

  /* ───────────────── قطع و وصل ───────────────── */

  console.log('\n── قطعِ اشتراک ──');
  const suspended = await api(`/api/v1/admin/subscriptions/${live.id}/status`, {
    method: 'POST', token, body: { status: 'suspended' },
  });
  check('اشتراک قطع شد', suspended.data.subscription?.status === 'suspended',
    JSON.stringify(suspended.data.subscription).slice(0, 140));

  const afterCut = await api('/api/v1/billing/status', { token: customerToken });
  check('قابلیتِ فروش همان لحظه بسته شد',
    afterCut.data.entitlement?.isPaid === false
      && afterCut.data.entitlement?.features?.includes('sales') === false,
    JSON.stringify(afterCut.data.entitlement?.features));

  const resumed = await api(`/api/v1/admin/subscriptions/${live.id}/status`, {
    method: 'POST', token, body: { status: 'active' },
  });
  check('دوباره وصل شد', resumed.data.subscription?.status === 'active');
  const backOn = await api('/api/v1/billing/status', { token: customerToken });
  check('مشتری دوباره VIP شد', backOn.data.entitlement?.isPaid === true);

  const badStatus = await api(`/api/v1/admin/subscriptions/${live.id}/status`, {
    method: 'POST', token, body: { status: 'هرچیزی' },
  });
  check('وضعیتِ بی‌معنا رد می‌شود', badStatus.status === 400, String(badStatus.status));

  /* ───────────────── درخواستِ خرید ───────────────── */

  console.log('\n── درخواستِ خرید ──');
  const reqs = await api('/api/v1/admin/purchase-requests', { token });
  const first = reqs.data.requests?.[0];
  check('درخواست دیده می‌شود', reqs.data.requests?.length === 1, JSON.stringify(reqs.data).slice(0, 200));
  check('نام و شمارهٔ درخواست‌دهنده می‌آید',
    first?.user_name === 'عبدالله' && first?.phone === '0700111222', JSON.stringify(first));

  const approved = await api(`/api/v1/admin/purchase-requests/${first.id}/approve`, {
    method: 'POST', token, body: {},
  });
  check('تأیید، اشتراک را تمدید کرد',
    approved.data.subscription?.ends_at > fixed, JSON.stringify(approved.data.subscription).slice(0, 160));
  const left = await api('/api/v1/admin/purchase-requests', { token });
  check('درخواست از فهرستِ باز بیرون رفت', left.data.requests?.length === 0);
  const twice = await api(`/api/v1/admin/purchase-requests/${first.id}/approve`, {
    method: 'POST', token, body: {},
  });
  check('یک درخواست دو بار تأیید نمی‌شود', twice.status === 404, String(twice.status));

  /* ───────────────── بستنِ حساب ───────────────── */

  console.log('\n── بستنِ حساب ──');
  const off = await api(`/api/v1/admin/users/${u.id}/status`, {
    method: 'POST', token, body: { status: 'disabled' },
  });
  check('حساب بسته شد', off.data.user?.status === 'disabled', JSON.stringify(off.data));
  const shut = await api('/api/v1/v1/auth/login', { method: 'POST', body: {} }); // مسیرِ بی‌معنا
  check('مسیرِ ناموجود ۴۰۴ می‌دهد', shut.status === 404, String(shut.status));

  const blocked = await api('/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'abdullah@example.com', password: 'shop-pass-1' },
  });
  check('کاربرِ بسته دیگر وارد نمی‌شود', blocked.status === 403, JSON.stringify(blocked.data).slice(0, 120));

  await api(`/api/v1/admin/users/${u.id}/status`, {
    method: 'POST', token, body: { status: 'active' },
  });
  const reopened = await api('/api/v1/auth/login', {
    method: 'POST', body: { identifier: 'abdullah@example.com', password: 'shop-pass-1' },
  });
  check('باز کردنِ حساب هم کار می‌کند', reopened.status === 200);

  /* ───────────────── نقش‌ها ───────────────── */

  console.log('\n── نقش، سمتِ سرور نگه داشته می‌شود ──');
  const panel = await api('/api/auth/login', {
    method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD },
  });
  const made = await api('/api/auth/users', {
    method: 'POST', token: panel.data.token,
    body: { username: 'didar', password: 'JustLooking!2026', role: 'viewer' },
  });
  check('کاربرِ تماشاگر ساخته شد', made.status === 201, JSON.stringify(made.data).slice(0, 140));
  const viewer = await api('/api/v1/admin/login', {
    method: 'POST', body: { username: 'didar', password: 'JustLooking!2026' },
  });
  check('کاربرِ تماشاگر هم وارد می‌شود', Boolean(viewer.data.token), JSON.stringify(viewer.data).slice(0, 140));
  const peek = await api('/api/v1/admin/shops', { token: viewer.data.token });
  check('تماشاگر می‌بیند', peek.status === 200);
  const denied = await api('/api/v1/admin/subscriptions', {
    method: 'POST', token: viewer.data.token, body: { shopId: shop.id, plan: 'm1' },
  });
  check('تماشاگر نمی‌تواند اشتراک بفروشد', denied.status === 403, JSON.stringify(denied.data).slice(0, 140));

  /* ───────────────── سابقه ───────────────── */

  console.log('\n── سابقه ──');
  const auditLog = await api('/api/v1/admin/audit?limit=100', { token });
  const actions = (auditLog.data.entries || []).map((e) => e.action);
  check('کارهای اشتراک در سابقه هست',
    actions.includes('tohid.subscription.grant') && actions.includes('tohid.subscription.extend'),
    JSON.stringify(actions.slice(0, 8)));
  check('هر ردیف زمان دارد',
    (auditLog.data.entries || []).every((e) => typeof e.created_at === 'number' && e.created_at > 0));
  check('رمزی در سابقه نیست', !JSON.stringify(auditLog.data).includes(ADMIN_PASSWORD));

  /* ───────────────── خروج ───────────────── */

  console.log('\n── خروج ──');
  await api('/api/v1/admin/logout', { method: 'POST', token });
  const afterLogout = await api('/api/v1/admin/stats', { token });
  check('توکن بعد از خروج نمی‌سوزد… می‌سوزد', afterLogout.status === 401, String(afterLogout.status));
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 200));
  if (fail) console.log(`\n${out.slice(-3000)}`);
  await fsp.rm(tmp, { recursive: true, force: true });
  console.log(`\n════════════════════════\n  موفق: ${pass}    ناموفق: ${fail}\n════════════════════════`);
  process.exit(fail ? 1 : 0);
}
