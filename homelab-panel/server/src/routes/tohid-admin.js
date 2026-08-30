// ---------------------------------------------------------------------------
//  پنلِ مدیریتِ توحید روی گوشی — /api/v1/admin/**
//
//  همان کارهایی که در صفحهٔ توحیدِ پنل انجام می‌دهید، این بار از راهِ دور:
//  اشتراک دادن، تمدید، قطع، دیدنِ حساب‌ها. برنامهٔ اندرویدِ «توحید — مدیریت»
//  دقیقاً این مسیرها را صدا می‌زند، پس شکلِ پاسخ‌ها دستِ ما نیست و همانی است
//  که آن برنامه می‌خواند.
//
//  دو نکته که این فایل را از نگاهِ اول متفاوت می‌کند:
//
//  ۱) «دکان» در این API یعنی **حساب**. در برنامهٔ توحید اشتراک به حساب
//     بسته می‌شود نه به دکان، و کسی هم که پول می‌دهد صاحبِ همان حساب است.
//     اگر فقط دکان‌ها را فهرست می‌کردیم، حسابی که هنوز دکان نساخته از چشم
//     می‌افتاد و نمی‌شد به او اشتراک فروخت. پس هر حساب یک ردیف است و نامِ
//     دکانش — اگر دارد — همان‌جا نشان داده می‌شود.
//
//  ۲) ورود با همان نام کاربری و رمزِ خودِ پنل است. حسابِ جداگانه‌ای ساخته
//     نمی‌شود: یک رمزِ دیگر یعنی یک جای دیگر برای لو رفتن. نقش هم همان نقشِ
//     پنل است — کارِ نوشتن دستِ operator به بالا، و بستنِ حساب دستِ admin.
// ---------------------------------------------------------------------------
import express from 'express';
import { db } from '../db.js';
import { verifyPassword, findUser, createSession, verifyToken, destroySession } from '../auth.js';
import { roleOf, atLeast } from '../control/roles.js';
import { audit } from '../control/audit.js';
import {
  entitlementFor, subscriptionsFor, activeSubscription, grantSubscription, extendSubscription,
  setSubscriptionStatus, setSubscriptionEnd, subscriptionChangeLog, STATUSES,
} from '../tohid/subscriptions.js';
import { listDevices, revokeSessions, accountById } from '../tohid/accounts.js';
import { listPlans, planByCode } from '../tohid/plans.js';
import { readTohidSettings } from '../tohid/settings.js';
import { rateLimit, clientIp } from './control/_shared.js';

const router = express.Router();

const fail = (res, status, code, message) =>
  res.status(status).json({ error: { code, message } });

function guard(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (e.code === 'not_found') return fail(res, 404, e.code, e.message);
      if (e.code) return fail(res, 400, e.code, e.message);
      return fail(res, 500, 'server_error', e.message || 'خطای سرور');
    }
  };
}

/* ------------------------------- ورود --------------------------------- */

/**
 * این مسیر ممکن است از اینترنت هم در دسترس باشد (تونل)، پس شمارشِ تلاش
 * لازم است: بدونش، رمزِ مدیر با آزمون‌وخطا پیدا می‌شود.
 */
const loginLimit = rateLimit({ windowMs: 60_000, max: 10, key: (req) => clientIp(req) });

router.post('/login', loginLimit, guard(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const user = username ? findUser(username) : null;

  // یک پیام برای «نبود» و «رمز غلط» — وگرنه می‌شود فهرستِ کاربران را ساخت
  if (!user || user.disabled || !verifyPassword(password, user.password_hash)) {
    audit({
      actor: username || 'unknown', action: 'tohid.admin.login', result: 'denied',
      entity: 'tohid_admin_api', ip: clientIp(req),
    });
    return fail(res, 401, 'bad_credentials', 'نام کاربری یا رمز درست نیست');
  }

  const session = createSession(user, req);
  const role = db.prepare('SELECT role FROM users WHERE id = ?').get(user.id)?.role || 'viewer';
  audit({
    actor: user.username, action: 'tohid.admin.login', entity: 'tohid_admin_api',
    ip: clientIp(req), detail: { role },
  });
  res.json({
    token: session.token,
    expiresAt: session.expiresAt,
    admin: { id: String(user.id), username: user.username, name: user.username, role },
  });
}));

/* از اینجا به بعد، بدونِ توکن هیچ‌چیز */

router.use((req, res, next) => {
  const header = String(req.headers.authorization || '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
  const user = token ? verifyToken(token) : null;
  if (!user) return fail(res, 401, 'unauthorized', 'دوباره وارد شوید');
  req.user = user;
  req.role = roleOf(req);
  next();
});

/** کارِ نوشتن، دستِ هر کسی نیست */
function needs(role) {
  return (req, res, next) => {
    if (atLeast(req.role, role)) return next();
    audit({
      actor: req.user.username, action: 'access.denied', result: 'forbidden',
      entity: req.baseUrl + req.path, detail: { role: req.role, needed: role },
    });
    return fail(res, 403, 'forbidden', 'این حساب اجازهٔ این کار را ندارد');
  };
}

const actorOf = (req) => req.user?.username || 'admin';

router.post('/logout', guard(async (req, res) => {
  destroySession(req.user.sessionId);
  res.json({ ok: true });
}));

router.get('/me', guard(async (req, res) => {
  res.json({
    admin: { id: String(req.user.id), username: req.user.username, name: req.user.username, role: req.role },
    serverTime: Date.now(),
  });
}));

/* ------------------------------- آمار --------------------------------- */

router.get('/stats', guard(async (_req, res) => {
  const now = Date.now();
  const n = (sql, ...args) => db.prepare(sql).get(...args).n;
  res.json({
    users: n('SELECT COUNT(*) AS n FROM th_accounts'),
    shops: n('SELECT COUNT(*) AS n FROM th_shops'),
    members: n('SELECT COUNT(*) AS n FROM th_shop_members'),
    activeSubscriptions: n(
      "SELECT COUNT(*) AS n FROM th_subscriptions WHERE status = 'active' AND ends_at >= ?", now),
    expiredSubscriptions: n(
      "SELECT COUNT(*) AS n FROM th_subscriptions WHERE status = 'expired' OR (status = 'active' AND ends_at < ?)", now),
    pendingRequests: n("SELECT COUNT(*) AS n FROM th_billing_requests WHERE status = 'new'"),
    serverTime: now,
  });
}));

/* ------------------------------ حساب‌ها ------------------------------- */

const matches = (a, q) => !q
  || (a.name || '').toLowerCase().includes(q)
  || (a.email || '').toLowerCase().includes(q)
  || (a.phone || '').includes(q)
  || a.account_id.toLowerCase().includes(q);

const limitOf = (raw, def = 50) => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(1, Math.min(200, Math.trunc(n))) : def;
};

/** دکانی که این حساب عضوش است — همان که در فهرست کنارِ نامش می‌آید */
function membershipOf(accountId) {
  return db.prepare(`
    SELECT m.shop_id, m.role, s.name AS shop_name
      FROM th_shop_members m JOIN th_shops s ON s.shop_id = m.shop_id
     WHERE m.account_id = ? ORDER BY m.joined_at LIMIT 1
  `).get(accountId) || null;
}

router.get('/users', guard(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = limitOf(req.query.limit);
  const rows = db.prepare('SELECT * FROM th_accounts ORDER BY created_at DESC').all()
    .filter((a) => matches(a, q));

  res.json({
    total: rows.length,
    limit,
    users: rows.slice(0, limit).map((a) => {
      const shop = membershipOf(a.account_id);
      return {
        id: a.account_id,
        name: a.name || '',
        email: a.email || '',
        phone: a.phone || '',
        status: a.disabled ? 'disabled' : 'active',
        created_at: a.created_at,
        last_login_at: a.last_login_at,
        shop_id: shop?.shop_id || null,
        role: shop?.role || null,
        shop_name: shop?.shop_name || '',
      };
    }),
  });
}));

router.get('/users/:id', guard(async (req, res) => {
  const account = accountById(req.params.id);
  if (!account) return fail(res, 404, 'not_found', 'کاربر پیدا نشد');

  const memberships = db.prepare(`
    SELECT m.shop_id, m.role, m.joined_at, s.name AS shop_name
      FROM th_shop_members m JOIN th_shops s ON s.shop_id = m.shop_id
     WHERE m.account_id = ? ORDER BY m.joined_at
  `).all(account.account_id);

  res.json({
    user: {
      id: account.account_id,
      name: account.name || '',
      email: account.email || '',
      phone: account.phone || '',
      status: account.disabled ? 'disabled' : 'active',
      createdAt: account.created_at,
      lastLoginAt: account.last_login_at,
    },
    memberships,
    devices: listDevices(account.account_id).map((d) => ({
      id: d.id,
      name: d.name || '',
      platform: d.platform || '',
      revoked: Boolean(d.revoked),
      first_seen: d.first_seen,
      last_seen_at: d.last_seen,
    })),
  });
}));

/**
 * باز یا بستنِ حساب.
 *
 * بستن، نشست‌هایش را هم می‌بندد — وگرنه گوشی‌ای که همین حالا باز است تا
 * انقضای توکنش کار می‌کند و «بستم» فقط روی کاغذ می‌ماند.
 */
router.post('/users/:id/status', needs('admin'), guard(async (req, res) => {
  const status = String(req.body?.status || '');
  if (!['active', 'disabled'].includes(status)) {
    return fail(res, 400, 'bad_status', 'وضعیت باید active یا disabled باشد');
  }
  const account = accountById(req.params.id);
  if (!account) return fail(res, 404, 'not_found', 'کاربر پیدا نشد');

  db.prepare('UPDATE th_accounts SET disabled = ? WHERE account_id = ?')
    .run(status === 'disabled' ? 1 : 0, account.account_id);
  if (status === 'disabled') revokeSessions(account.account_id);

  audit({
    actor: actorOf(req), action: 'tohid.account.status', entity: 'tohid_account',
    entityId: account.account_id, detail: { status },
  });
  res.json({ user: { id: account.account_id, status } });
}));

/* ------------------------- «دکان‌ها» = حساب‌ها ------------------------- */

/** یک ردیفِ فهرست: حساب + دکانش + اشتراکِ زنده‌اش */
function customerRow(a) {
  const shop = db.prepare('SELECT * FROM th_shops WHERE owner_id = ?').get(a.account_id)
    || membershipOf(a.account_id);
  const live = activeSubscription(a.account_id);
  const last = live || subscriptionsFor(a.account_id)[0] || null;
  const members = shop?.shop_id
    ? db.prepare('SELECT COUNT(*) AS n FROM th_shop_members WHERE shop_id = ?').get(shop.shop_id).n
    : 0;

  return {
    id: a.account_id,
    name: shop?.name || shop?.shop_name || a.name || 'بی‌نام',
    status: a.disabled ? 'disabled' : 'active',
    created_at: a.created_at,
    owner_user_id: a.account_id,
    owner_name: a.name || '',
    owner_phone: a.phone || '',
    owner_email: a.email || '',
    members,
    subscription_id: last ? last.id : null,
    plan: last ? last.plan_code : null,
    sub_status: last ? (live ? 'active' : last.status) : null,
    starts_at: last ? last.starts_at : null,
    ends_at: last ? last.ends_at : null,
  };
}

router.get('/shops', guard(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = limitOf(req.query.limit);
  const rows = db.prepare('SELECT * FROM th_accounts ORDER BY created_at DESC').all();
  const shops = rows
    .map(customerRow)
    .filter((r) => !q
      || r.name.toLowerCase().includes(q)
      || r.owner_name.toLowerCase().includes(q)
      || r.owner_phone.includes(q)
      || r.id.toLowerCase().includes(q));

  res.json({ shops: shops.slice(0, limit), total: shops.length, limit });
}));

router.get('/shops/:id', guard(async (req, res) => {
  const account = accountById(req.params.id);
  if (!account) return fail(res, 404, 'not_found', 'دکان پیدا نشد');
  const shop = db.prepare('SELECT * FROM th_shops WHERE owner_id = ?').get(account.account_id) || null;

  const members = shop
    ? db.prepare(`
        SELECT m.role, m.joined_at, a.account_id AS user_id, a.name, a.phone, a.email
          FROM th_shop_members m JOIN th_accounts a ON a.account_id = m.account_id
         WHERE m.shop_id = ? ORDER BY m.joined_at
      `).all(shop.shop_id)
    : [];

  // اشتراکِ زنده باید اولِ فهرست باشد: برنامه همان اولی را «اشتراکِ فعلی»
  // می‌گیرد و روی همان تمدید و قطع می‌زند.
  const live = activeSubscription(account.account_id);
  const all = subscriptionsFor(account.account_id);
  const ordered = live ? [live, ...all.filter((s) => s.id !== live.id)] : all;

  res.json({
    shop: {
      id: account.account_id,
      name: shop?.name || account.name || 'بی‌نام',
      status: account.disabled ? 'disabled' : 'active',
      createdAt: account.created_at,
      ownerUserId: account.account_id,
      shopId: shop?.shop_id || null,
    },
    members,
    entitlement: entitlementFor(account.account_id),
    subscriptions: ordered,
  });
}));

router.get('/shops/:id/history', guard(async (req, res) => {
  const account = accountById(req.params.id);
  if (!account) return fail(res, 404, 'not_found', 'دکان پیدا نشد');
  res.json({
    history: subscriptionChangeLog(account.account_id, limitOf(req.query.limit)).map((r) => ({
      id: r.id,
      action: r.action,
      plan: r.plan_code || '',
      prev_ends_at: r.prev_ends_at || 0,
      new_ends_at: r.new_ends_at || 0,
      status: r.status || '',
      note: r.note || '',
      actor: r.actor || '',
      created_at: r.created_at,
    })),
  });
}));

/* ----------------------------- اشتراک‌ها ------------------------------ */

router.get('/subscriptions', guard(async (req, res) => {
  const status = String(req.query.status || '').trim();
  const limit = limitOf(req.query.limit);
  const rows = db.prepare(`
    SELECT s.*, a.name AS owner_name, a.phone AS owner_phone
      FROM th_subscriptions s JOIN th_accounts a ON a.account_id = s.account_id
     ORDER BY COALESCE(s.updated_at, s.created_at) DESC
  `).all().filter((r) => !status || r.status === status);

  res.json({
    subscriptions: rows.slice(0, limit).map((r) => ({
      ...r,
      plan: r.plan_code,
      shop_name: r.owner_name || '',
      state: r.status === 'active' && r.ends_at < Date.now() ? 'expired' : r.status,
    })),
  });
}));

/**
 * دادن یا تمدیدِ اشتراک.
 *
 * اگر همین حالا اشتراکِ زنده دارد، از **پایانِ همان** ادامه می‌دهد نه از
 * امروز — روزهایی که پولش را داده نباید بسوزد. این تصمیم اینجا گرفته
 * می‌شود، نه در گوشی: ساعتِ گوشی ممکن است اشتباه باشد.
 */
router.post('/subscriptions', needs('operator'), guard(async (req, res) => {
  const account = accountById(String(req.body?.shopId || ''));
  if (!account) return fail(res, 404, 'not_found', 'حساب پیدا نشد');

  const code = String(req.body?.plan || '').trim();
  const days = req.body?.days == null || req.body?.days === '' ? null : Number(req.body.days);
  const note = String(req.body?.note || '').slice(0, 300) || null;

  let amount;
  let unit;
  let planCode = code;
  let planTitle = code;
  let maxDevices = 1;
  let price = null;

  if (days != null) {
    if (!Number.isFinite(days) || days < 1 || days > 3650) {
      return fail(res, 400, 'bad_duration', 'تعداد روز درست نیست');
    }
    amount = Math.trunc(days);
    unit = 'day';
    if (!planCode || planCode === 'custom') { planCode = 'custom'; planTitle = 'مدت دلخواه'; }
  } else {
    const plan = planByCode(planCode);
    if (!plan) return fail(res, 404, 'not_found', 'این پلن روی سرور نیست');
    amount = plan.amount;
    unit = plan.unit;
    planTitle = plan.title;
    maxDevices = plan.max_devices || 1;
    price = plan.price;
  }

  const actor = actorOf(req);
  const live = activeSubscription(account.account_id);
  const settings = readTohidSettings();

  // اشتراکِ زنده تمدید می‌شود؛ اگر نبود، تازه صادر می‌شود
  const sub = live
    ? extendSubscription(live.id, { amount, unit, actor })
    : grantSubscription({
      accountId: account.account_id, planCode, planTitle, amount, unit,
      maxDevices, price, currency: settings.currency, note, actor,
    });

  res.status(201).json({ subscription: sub, state: sub.status });
}));

router.put('/subscriptions/:id', needs('operator'), guard(async (req, res) => {
  const endsAt = Number(req.body?.endsAt);
  if (!Number.isFinite(endsAt)) return fail(res, 400, 'bad_date', 'تاریخ پایان لازم است');
  const sub = setSubscriptionEnd(Number(req.params.id), endsAt, { actor: actorOf(req) });
  res.json({ subscription: sub, state: sub.status });
}));

router.post('/subscriptions/:id/status', needs('operator'), guard(async (req, res) => {
  const status = String(req.body?.status || '');
  if (!STATUSES.includes(status)) return fail(res, 400, 'bad_status', 'وضعیت نامعتبر است');
  const sub = setSubscriptionStatus(Number(req.params.id), status, { actor: actorOf(req) });
  res.json({ subscription: sub, state: sub.status });
}));

/* ------------------------------- پلن‌ها ------------------------------- */

router.get('/plans', guard(async (_req, res) => {
  const settings = readTohidSettings();
  res.json({
    plans: listPlans().map((p) => ({
      code: p.code,
      title: p.title,
      amount: p.amount,
      unit: p.unit,
      price: p.price,
      badge: p.badge || '',
      active: Boolean(p.active),
      max_devices: p.max_devices,
    })),
    config: { currency: settings.currency, whatsapp: settings.whatsapp },
  });
}));

/* --------------------------- درخواستِ خرید ---------------------------- */

/** برنامه «pending» می‌گوید؛ در این دیتابیس اسمش «new» است */
const requestStatus = (raw) => {
  const s = String(raw || '').trim();
  if (!s || s === 'pending') return 'new';
  if (s === 'approved') return 'done';
  return s;
};

router.get('/purchase-requests', guard(async (req, res) => {
  const status = requestStatus(req.query.status);
  const rows = db.prepare(`
    SELECT r.*, a.name AS user_name, a.phone
      FROM th_billing_requests r LEFT JOIN th_accounts a ON a.account_id = r.account_id
     WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 200
  `).all(status);

  res.json({
    requests: rows.map((r) => ({
      id: r.id,
      shop_id: r.account_id,
      plan_code: r.plan_code || '',
      contact: r.contact || '',
      note: r.message || '',
      status: r.status,
      created_at: r.created_at,
      shop_name: r.user_name || '',
      user_name: r.user_name || '',
      phone: r.phone || '',
    })),
  });
}));

router.post('/purchase-requests/:id/approve', needs('operator'), guard(async (req, res) => {
  const row = db.prepare("SELECT * FROM th_billing_requests WHERE id = ? AND status = 'new'")
    .get(Number(req.params.id));
  if (!row) return fail(res, 404, 'not_found', 'درخواست پیدا نشد');
  if (!row.account_id) return fail(res, 400, 'no_account', 'این درخواست به حسابی بسته نیست');

  const days = req.body?.days == null || req.body?.days === '' ? null : Number(req.body.days);
  const plan = row.plan_code ? planByCode(row.plan_code) : null;
  if (days == null && !plan) return fail(res, 400, 'no_plan', 'پلن این درخواست روی سرور نیست');

  const actor = actorOf(req);
  const live = activeSubscription(row.account_id);
  const amount = days != null ? Math.trunc(days) : plan.amount;
  const unit = days != null ? 'day' : plan.unit;
  if (!Number.isFinite(amount) || amount < 1) return fail(res, 400, 'bad_duration', 'مدت درست نیست');

  const sub = live
    ? extendSubscription(live.id, { amount, unit, actor })
    : grantSubscription({
      accountId: row.account_id,
      planCode: plan?.code || 'custom',
      planTitle: plan?.title || 'مدت دلخواه',
      amount, unit,
      maxDevices: plan?.max_devices || 1,
      price: plan?.price ?? null,
      currency: readTohidSettings().currency,
      note: row.message || null,
      actor,
    });

  db.prepare("UPDATE th_billing_requests SET status = 'done' WHERE id = ?").run(row.id);
  audit({ actor, action: 'tohid.request.approved', entity: 'tohid_request', entityId: String(row.id) });
  res.json({ subscription: sub, state: sub.status });
}));

router.post('/purchase-requests/:id/reject', needs('operator'), guard(async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM th_billing_requests WHERE id = ? AND status = 'new'").get(id);
  if (!row) return fail(res, 404, 'not_found', 'درخواست پیدا نشد');
  db.prepare("UPDATE th_billing_requests SET status = 'rejected' WHERE id = ?").run(id);
  audit({
    actor: actorOf(req), action: 'tohid.request.rejected', entity: 'tohid_request',
    entityId: String(id), detail: { reason: String(req.body?.reason || '').slice(0, 300) },
  });
  res.json({ ok: true });
}));

/* ------------------------------- سابقه -------------------------------- */

router.get('/audit', guard(async (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM cc_audit WHERE action LIKE 'tohid.%' ORDER BY at DESC LIMIT ?
  `).all(limitOf(req.query.limit, 100));

  res.json({
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor_type: r.actor,
      target_type: r.entity || '',
      target_id: r.entity_id || '',
      result: r.result,
      created_at: r.at,
    })),
  });
}));

export default router;
