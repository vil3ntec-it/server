// ---------------------------------------------------------------------------
//  حساب‌ها و اشتراکِ دکان — از سرورِ حساب، با ورودِ خودِ پنل
//
//      اپِ مدیریت / پنل ──(توکنِ پنل)──▶ /api/account-admin/… ──(توکنِ مدیرِ سرورِ حساب)──▶ shop/server /api/admin/…
//
//  ── چرا این فایل هست ─────────────────────────────────────────────────
//  تا ۱.۴۰.۰ این پنل یک **دفترِ حسابِ دوم** داشت (‎src/tohid/‎): جدول‌های
//  ‎th_accounts‎، ‎th_subscriptions‎، پلن، کدِ ورود، پشتیبانی — رونوشتی از
//  همان چیزی که سرورِ حساب (shop/server) دارد. اپِ مدیریت روی گوشی از
//  همان دفترِ دوم می‌خواند و اشتراک می‌داد، در حالی که برنامهٔ دکان
//  اشتراکش را از سرورِ حساب می‌گرفت. دو حقیقت، دو جواب: مدیر «فعال»
//  می‌دید و مشتری «تمام شده».
//
//  حالا دفترِ حساب یکی است و این‌جا نیست. این روتر فقط **پل** است — همان
//  کاری که ‎stations/cloud.js‎ برای پمپ‌ها می‌کند — و شکلِ پاسخ‌ها را همانی
//  نگه می‌دارد که اپِ مدیریت از قبل می‌خواند (‎data/Api.kt‎)، تا اپِ روی
//  گوشیِ صاحبِ سامانه بی به‌روزرسانی هم کار کند.
//
//  ── قاعده‌ها ──────────────────────────────────────────────────────────
//  ⛔ فهرستِ سفید است: فقط مسیرهایی که این‌جا نوشته شده‌اند به سرورِ حساب
//     می‌روند. مسیرِ دلخواه ۴۰۴ می‌گیرد — وگرنه یک پروکسیِ باز با توکنِ
//     مدیرِ سرورِ حساب می‌داشتیم (مدیرِ تازه ساختن، پاک کردنِ پشتیبان…).
//  ⛔ روی پورتِ عمومی سوار نمی‌شود. اپِ مدیریت با نشستِ **پنل** می‌آید
//     (‎requireAuth‎ + ‎writeNeedsOperator‎ در ‎index.js‎)، و بستنِ حساب
//     فقط دستِ admin است — همان نقش‌بندیِ دفترِ قدیم.
//  ⛔ «حساب» در اپِ مدیریت یعنی **دکان**: اشتراک روی سرورِ حساب به دکان
//     بسته است، نه به آدم. ‎accountId‎ی که اپ می‌خواند شناسهٔ دکان است و
//     نام/ایمیل/شمارهٔ کنارش مالِ صاحبِ همان دکان.
//  ⛔ هیچ چیزی این‌جا ذخیره نمی‌شود — نه حساب، نه اشتراک، نه پیام.
// ---------------------------------------------------------------------------
import express from 'express';
import { cloudRaw, cloudRawText } from '../stations/cloud.js';
import { requireRole } from '../control/roles.js';
import { audit } from '../control/audit.js';

const router = express.Router();
const DAY = 24 * 3600 * 1000;

/** خطای پل را با همان کدِ خودش برگردان، نه ۵۰۰ی گنگ. */
function cloudFail(res, err) {
  return res.status(err.status || 502).json({
    error: err.code || 'cloud_error',
    message: err.message || 'سرورِ حساب جواب نداد',
  });
}

function guard(handler) {
  return async (req, res) => {
    try { await handler(req, res); } catch (err) { cloudFail(res, err); }
  };
}

const actorOf = (req) => req.user?.username || 'admin';

/** شناسه‌ای که به مسیرِ آن‌طرف می‌چسبد — فقط حرف/رقم/خطِ تیره. */
function idOf(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    const err = new Error('شناسه معتبر نیست');
    err.code = 'bad_id';
    err.status = 400;
    throw err;
  }
  return id;
}

/** بخشِ دکان است مگر صریح گفته شود پمپ. */
const appOf = (req) => (String(req.query?.app || req.body?.app || '').toLowerCase() === 'pump' ? 'pump' : 'shop');

/** «یک ماه یعنی یک ماه، نه سی روز» — همان حسابِ تقویمیِ سرورِ حساب. */
export function addPeriod(startMs, amount, unit) {
  const d = new Date(Number(startMs));
  const n = Math.max(1, Number(amount) || 1);
  switch (String(unit || 'month')) {
    case 'day': d.setUTCDate(d.getUTCDate() + n); break;
    case 'week': d.setUTCDate(d.getUTCDate() + n * 7); break;
    case 'year': d.setUTCFullYear(d.getUTCFullYear() + n); break;
    default: d.setUTCMonth(d.getUTCMonth() + n); break;
  }
  return d.getTime();
}

const daysLeftOf = (endsAt, at = Date.now()) => (endsAt ? Math.max(0, Math.ceil((Number(endsAt) - at) / DAY)) : -1);

/* ------------------------------ حساب‌ها ------------------------------- */

/**
 * ردیفی که فهرستِ «حساب‌های فروشگاه»ِ اپ می‌خواند.
 * ورودی: یک ردیفِ ‎GET /api/admin/shops‎ سرورِ حساب.
 */
function shapeAccountRow(r, at = Date.now()) {
  const subStatus = String(r.sub_status || '');
  const vip = subStatus === 'active' || subStatus === 'trial';
  return {
    accountId: r.id,
    shopId: r.id,
    name: r.name || r.owner_name || '',
    ownerName: r.owner_name || '',
    ownerUserId: r.owner_user_id || '',
    email: r.owner_email || '',
    phone: r.owner_phone || '',
    disabled: r.status !== undefined && r.status !== null && r.status !== 'active',
    createdAt: Number(r.created_at) || 0,
    members: Number(r.members) || 0,
    vip,
    plan: r.plan || null,
    planCode: r.plan || null,
    daysLeft: vip ? daysLeftOf(r.ends_at, at) : -1,
    subEndsAt: r.ends_at ? Number(r.ends_at) : null,
    status: subStatus || 'none',
  };
}

/** حساب‌های دکان — همان شکلی که اپِ مدیریت می‌خواند (‎items[].accountId‎). */
router.get('/shop-accounts', guard(async (req, res) => {
  const out = await cloudRaw('GET', '/api/admin/shops', {
    query: { q: String(req.query.q || '').slice(0, 60), limit: 200 },
  });
  const at = Date.now();
  res.json({ items: (out.shops || []).map((r) => shapeAccountRow(r, at)), total: out.total ?? null });
}));

/**
 * پروندهٔ یک دکان: صاحبش، اشتراک‌ها، دستگاه‌ها.
 *
 * دو خواندن از سرورِ حساب: دکان (اعضا، اشتراک، تاریخچه) و کاربرِ صاحبش
 * (ایمیل، شماره، آخرین ورود، دستگاه‌ها). عنوانِ پلن از فهرستِ پلن‌ها.
 */
router.get('/shop-accounts/:id', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const detail = await cloudRaw('GET', `/api/admin/shops/${id}`);
  const shop = detail.shop || {};
  let owner = null;
  let devices = [];
  if (shop.ownerUserId) {
    try {
      const u = await cloudRaw('GET', `/api/admin/users/${idOf(shop.ownerUserId)}`);
      owner = u.user || null;
      devices = Array.isArray(u.devices) ? u.devices : [];
    } catch { /* صاحبِ حذف‌شده — پرونده بی او هم خواندنی است */ }
  }
  let plans = [];
  try { plans = (await cloudRaw('GET', '/api/admin/plans', { query: { app: 'shop' } })).plans || []; } catch { /* بی عنوان */ }
  const titleOf = (code) => plans.find((p) => p.code === code)?.title || '';

  const ent = detail.entitlement || {};
  const sub = ent.subscription || {};
  const active = Boolean(sub.active);
  const source = String(ent.source || 'none');
  const entitlement = {
    isPaid: source === 'subscription' || source === 'trial',
    source,
    status: source === 'trial' ? 'trial' : (sub.status || 'none'),
    daysLeft: source === 'trial' ? daysLeftOf(ent.trial?.endsAt) : (active ? Number(sub.daysLeft) || 0 : 0),
    plan: sub.plan || '',
    planTitle: titleOf(sub.plan) || (source === 'trial' ? 'دورهٔ آزمایشی' : ''),
    subEndsAt: sub.endsAt || null,
    maxDevices: Number(sub.maxDevices) || 0,
    features: Array.isArray(ent.features) ? ent.features : [],
    message: source === 'trial'
      ? 'دورهٔ آزمایشی'
      : active ? '' : (sub.status === 'expired' ? 'اشتراک تمام شده' : 'اشتراک ندارد'),
  };

  res.json({
    account: {
      accountId: shop.id,
      shopId: shop.id,
      name: shop.name || '',
      ownerName: owner?.name || '',
      ownerUserId: shop.ownerUserId || '',
      email: owner?.email || '',
      phone: owner?.phone || '',
      note: '',
      disabled: (shop.status && shop.status !== 'active') || owner?.status === 'disabled' || false,
      createdAt: Number(shop.createdAt) || 0,
      lastLoginAt: owner?.lastLoginAt || null,
    },
    entitlement,
    subscriptions: (detail.subscriptions || []).map((s) => ({
      ...s,
      plan_code: s.plan,
      plan_title: titleOf(s.plan),
      starts_at: Number(s.starts_at) || 0,
      ends_at: Number(s.ends_at) || 0,
    })),
    devices: devices.map((d) => ({
      id: d.id,
      uid: d.device_uid || d.uid || d.id || '',
      name: d.name || d.label || d.platform || '',
      lastSeenAt: d.last_seen_at ? Number(d.last_seen_at) : 0,
      revoked: Boolean(d.revoked),
    })),
    members: detail.members || [],
    counts: detail.counts || {},
    location: detail.location || null,
  });
}));

/**
 * بستن یا باز کردنِ یک حساب.
 *
 * سرورِ حساب «دکان» را نمی‌بندد، **صاحبش** را می‌بندد (‎users/:id/status‎)
 * و همان لحظه همهٔ نشست‌هایش را باطل می‌کند — که همان چیزی است که
 * مدیر می‌خواهد: کسی که بسته شد، از همه‌جا بیرون بیفتد.
 */
router.post('/shop-accounts/:id/disable', requireRole('admin'), guard(async (req, res) => {
  const id = idOf(req.params.id);
  const disabled = req.body?.disabled !== false;
  const detail = await cloudRaw('GET', `/api/admin/shops/${id}`);
  const ownerId = detail.shop?.ownerUserId;
  if (!ownerId) {
    return res.status(409).json({ error: 'no_owner', message: 'این دکان صاحبی ندارد که بسته شود' });
  }
  await cloudRaw('POST', `/api/admin/users/${idOf(ownerId)}/status`, { body: { status: disabled ? 'disabled' : 'active' } });
  audit({ actor: actorOf(req), action: disabled ? 'account.disable' : 'account.enable', entity: 'shop', entityId: id });
  res.json({ ok: true, disabled });
}));

/* ------------------------------ اشتراک -------------------------------- */

/**
 * اشتراک دادن به یک دکان.
 *
 * اپ «پلن + مقدار + واحد» می‌فرستد. اگر مقدار و واحد همانِ خودِ پلن باشد،
 * مدت به سرورِ حساب سپرده می‌شود (حسابِ تقویمی و فهرستِ قابلیت‌های همان
 * پلن)؛ وگرنه تاریخِ پایان همین‌جا از روی همان مقدار ساخته می‌شود.
 * پلنِ ناشناخته (‎custom‎) بی مقدار پذیرفته نمی‌شود.
 */
router.post('/shop-accounts/:id/vip', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const b = req.body || {};
  const planCode = String(b.planCode || 'custom').slice(0, 20);
  const plans = (await cloudRaw('GET', '/api/admin/plans', { query: { app: 'shop' } })).plans || [];
  const plan = plans.find((p) => p.code === planCode) || null;
  const amount = Number(b.amount) || plan?.amount || 0;
  const unit = String(b.unit || plan?.unit || 'month');

  const body = { shopId: id, plan: planCode };
  if (Array.isArray(b.features) && b.features.length) body.features = b.features;
  if (b.note) body.note = String(b.note).slice(0, 300);
  if (b.maxDevices) body.maxDevices = Number(b.maxDevices);
  if (b.graceDays) body.graceDays = Number(b.graceDays);
  const samePeriod = plan && amount === Number(plan.amount) && unit === String(plan.unit);
  if (!samePeriod) {
    if (!amount) {
      return res.status(400).json({ error: 'missing_duration', message: 'مدتِ اشتراک مشخص نیست' });
    }
    //  اشتراکِ زنده از پایانِ خودش جلو می‌رود، نه از امروز — همان قاعدهٔ سرورِ حساب
    const detail = await cloudRaw('GET', `/api/admin/shops/${id}`);
    const live = detail.entitlement?.subscription;
    const base = live?.active && Number(live.endsAt) > Date.now() ? Number(live.endsAt) : Date.now();
    body.endsAt = addPeriod(base, amount, unit);
    if (!(live?.active)) body.startsAt = Date.now();
  }
  const out = await cloudRaw('POST', '/api/admin/subscriptions', { body });
  audit({ actor: actorOf(req), action: 'account.subscription.grant', entity: 'shop', entityId: id, detail: { plan: planCode, amount, unit } });
  res.json({ ok: true, subscription: out.subscription || null, state: out.state || null });
}));

/** اشتراکی که اپ فقط شناسه‌اش را دارد — از فهرستِ سرورِ حساب پیدا می‌شود. */
async function findSubscription(id) {
  const out = await cloudRaw('GET', '/api/admin/subscriptions', { query: { limit: 200 } });
  const row = (out.subscriptions || []).find((s) => String(s.id) === String(id));
  if (!row) {
    const err = new Error('اشتراک پیدا نشد');
    err.code = 'not_found';
    err.status = 404;
    throw err;
  }
  return row;
}

/** تمدید — تاریخِ پایان به اندازهٔ «مقدار + واحد» جلو می‌رود (تقویمی). */
router.post('/subscriptions/:id/extend', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const amount = Number(req.body?.amount) || 1;
  const unit = String(req.body?.unit || 'month');
  const current = await findSubscription(id);
  const base = Math.max(Number(current.ends_at) || 0, Date.now());
  const out = await cloudRaw('PUT', `/api/admin/subscriptions/${id}`, { body: { endsAt: addPeriod(base, amount, unit) } });
  audit({ actor: actorOf(req), action: 'account.subscription.extend', entity: 'subscription', entityId: id, detail: { amount, unit } });
  res.json({ ok: true, subscription: out.subscription || null, state: out.state || null });
}));

router.post('/subscriptions/:id/status', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const status = String(req.body?.status || '');
  const out = await cloudRaw('POST', `/api/admin/subscriptions/${id}/status`, { body: { status } });
  audit({ actor: actorOf(req), action: 'account.subscription.status', entity: 'subscription', entityId: id, detail: { status } });
  res.json({ ok: true, subscription: out.subscription || null, state: out.state || null });
}));

/* ------------------------------- پلن‌ها -------------------------------- */

/**
 * پلن‌های دکان به شکلی که فرمِ اشتراکِ اپ می‌خواند (‎items[]‎ با ‎active‎ی
 * ۰/۱). ⚠️ ‎optInt("active")‎ی اندروید روی ‎true/false‎ مقدارِ پیش‌فرض
 * می‌دهد، پس ‎false‎ هم «فعال» خوانده می‌شد — عدد می‌فرستیم.
 */
router.get('/shop-plans', guard(async (req, res) => {
  const out = await cloudRaw('GET', '/api/admin/plans', { query: { app: appOf(req) } });
  res.json({
    items: (out.plans || []).map((p) => ({ ...p, active: p.active ? 1 : 0, max_devices: p.maxDevices })),
    app: out.app || appOf(req),
  });
}));

/** نرخ‌نامه با تخفیف‌ها — همان شکلِ خودِ سرورِ حساب (‎plans[]‎ با ‎fullPrice‎ و ‎discount‎). */
router.get('/plans', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/plans', { query: { app: appOf(req) } }));
}));

router.put('/plans/:code/discount', guard(async (req, res) => {
  const code = idOf(req.params.code);
  res.json(await cloudRaw('PUT', `/api/admin/plans/${code}/discount`, { query: { app: appOf(req) }, body: req.body || {} }));
}));

router.delete('/plans/:code/discount', guard(async (req, res) => {
  const code = idOf(req.params.code);
  res.json(await cloudRaw('DELETE', `/api/admin/plans/${code}/discount`, { query: { app: appOf(req) } }));
}));

/* ----------------------------- پشتیبانی ------------------------------- */

/**
 * بخشِ پشتیبانی به زبانِ سرورِ حساب: ‎pump‎ یا ‎shop‎.
 * اپِ مدیریت از قدیم ‎station‎ می‌گفت؛ همان را ترجمه می‌کنیم.
 */
function supportAppOf(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'station' || v === 'pump' || v === 'pump-station') return 'pump';
  if (v === 'shop') return 'shop';
  return '';
}

router.get('/support/threads', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/support/threads', {
    query: {
      app: supportAppOf(req.query.app),
      status: String(req.query.status || '').slice(0, 20),
      q: String(req.query.q || '').slice(0, 60),
      limit: Math.min(200, Math.max(1, Number(req.query.limit) || 100)),
    },
  }));
}));

router.get('/support/threads/:id', guard(async (req, res) => {
  const id = idOf(req.params.id);
  res.json(await cloudRaw('GET', `/api/admin/support/threads/${id}`, {
    query: { after: Number(req.query.after) || 0 },
  }));
}));

router.post('/support/threads/:id/messages', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const body = String(req.body?.body ?? req.body?.text ?? '');
  res.json(await cloudRaw('POST', `/api/admin/support/threads/${id}/messages`, { body: { body } }));
}));

router.post('/support/threads/:id/status', guard(async (req, res) => {
  const id = idOf(req.params.id);
  res.json(await cloudRaw('POST', `/api/admin/support/threads/${id}/status`, { body: { status: String(req.body?.status || '') } }));
}));

router.post('/support/broadcast', guard(async (req, res) => {
  const b = req.body || {};
  const out = await cloudRaw('POST', '/api/admin/support/broadcast', {
    body: { body: String(b.body || ''), target: b.target, limit: b.limit, app: b.app || 'both' },
  });
  audit({ actor: actorOf(req), action: 'account.broadcast', detail: { target: b.target, sent: out.sent } });
  res.json(out);
}));

/* ═══════════════════════════════════════════════════════════════════════
   بخشِ دومِ پل — مشتری‌ها، پلن و قیمت، تخفیف، مرکزِ اعلان، فروش و Sync
   (بندهای ۱۱.۳.۱ تا ۱۱.۵ و ۱۲ و ۱۶ پرامپت)

   ⛔ همان قاعدهٔ بالا: **یک مسیرِ نوشته‌شده برای هر مقصد**. هیچ‌کدام از
      این‌ها مسیرِ آن‌طرف را از ورودیِ کاربر نمی‌سازد؛ بخش (`shop`/`pump`)
      از یک جدولِ ثابت درمی‌آید و شناسه‌ها از `idOf` رد می‌شوند.
   ⛔ هیچ چیزی این‌جا ذخیره یا حساب نمی‌شود. قیمت، تخفیف، گزارشِ تحویل و
      حالِ اشتراک همه از سرورِ حساب می‌آیند — «یک دفترِ حساب، نه دو».
   ═══════════════════════════════════════════════════════════════════════ */

/** بخشِ معتبر، و پیشوندِ مسیرِ همان بخش روی سرورِ حساب. */
const SECTION = { shop: '', pump: '/pump' };

function sectionOf(value) {
  const app = String(value || '').toLowerCase();
  if (app === 'pump' || app === 'station') return 'pump';
  if (app === 'shop') return 'shop';
  const err = new Error('بخش باید shop یا pump باشد');
  err.code = 'bad_app';
  err.status = 400;
  throw err;
}

/** `shop` · `pump` · `both` — برای جایی که سرورِ حساب هر سه را می‌پذیرد. */
function scopeOf(value, def = '') {
  const app = String(value || '').toLowerCase();
  if (['shop', 'pump', 'both'].includes(app)) return app;
  return def;
}

/** `/api/admin/subscriptions/…` یا `/api/admin/pump/subscriptions/…` */
const subsPath = (app, tail = '') => `/api/admin${SECTION[sectionOf(app)]}/subscriptions${tail}`;

/* --------------------------- مشتری‌ها و اشتراک‌ها ----------------------- */

/**
 * فهرستِ مشتری‌ها با فیلتر — بندِ ۱۱.۴.
 *
 * یک فهرست برای هر دو بخش، چون «یک نفر هم دکان دارد هم پمپ» (سناریوی
 * ۱۳) و مدیر باید هر دو را کنارِ هم ببیند. خودِ فیلتر کارِ سرورِ حساب
 * است تا دو جا دو قاعده نشود.
 */
router.get('/customers', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/sales/subscriptions', {
    query: {
      app: scopeOf(req.query.app) === 'both' ? '' : scopeOf(req.query.app),
      status: String(req.query.status || '').slice(0, 20),
      city: String(req.query.city || '').slice(0, 60),
      kind: String(req.query.kind || '').slice(0, 20),
      limit: Math.min(2000, Math.max(1, Number(req.query.limit) || 300)),
    },
  }));
}));

/**
 * پروندهٔ یک پمپ — همتای `shop-accounts/:id`.
 *
 * ⚠️ شکلش عمداً **همان** پروندهٔ دکان نیست و نباید بشود: پمپ کدِ اپِ
 * کارمندان و پوشهٔ فایل دارد و ممکن است اصلاً صاحب نداشته باشد (با کدِ
 * شش‌رقمی فعال شده). یکی کردنشان یعنی نشان دادنِ خانهٔ خالی.
 */
router.get('/pump-accounts/:id', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const detail = await cloudRaw('GET', `/api/admin/pump/stations/${id}`);
  let devices = [];
  if (detail.owner?.id) {
    try {
      const u = await cloudRaw('GET', `/api/admin/users/${idOf(detail.owner.id)}`);
      devices = Array.isArray(u.devices) ? u.devices : [];
    } catch { /* صاحبِ حذف‌شده — پرونده بی او هم خواندنی است */ }
  }
  res.json({
    station: detail.station || null,
    accessCode: detail.accessCode || '',
    owner: detail.owner || null,
    members: detail.members || [],
    entitlement: detail.entitlement || null,
    subscription: detail.subscription || null,
    files: detail.files || [],
    devices: devices.map((d) => ({
      id: d.id,
      uid: d.device_uid || d.uid || d.id || '',
      name: d.name || d.label || d.platform || '',
      lastSeenAt: d.last_seen_at ? Number(d.last_seen_at) : 0,
      revoked: Boolean(d.revoked) || d.status === 'revoked',
    })),
  });
}));

/** تاریخچهٔ اشتراکِ یک حساب — چه کسی کِی چه کرد. */
router.get('/customers/:app/:id/history', guard(async (req, res) => {
  const app = sectionOf(req.params.app);
  const id = idOf(req.params.id);
  const path = app === 'pump' ? `/api/admin/pump/stations/${id}/history` : `/api/admin/shops/${id}/history`;
  res.json(await cloudRaw('GET', path));
}));

/* ------------------------- کارها روی یک اشتراک ------------------------- */

/** اشتراکِ یک حساب را از فهرستِ همان بخش پیدا کن (برای تمدید). */
async function subscriptionOf(app, id) {
  const a = sectionOf(app);
  const out = await cloudRaw('GET', subsPath(a), { query: { limit: a === 'pump' ? 200 : 500 } });
  const row = (out.subscriptions || []).find((s) => String(s.id) === String(id));
  if (!row) {
    const err = new Error('اشتراک پیدا نشد');
    err.code = 'not_found';
    err.status = 404;
    throw err;
  }
  return row;
}

/**
 * اشتراک دادن — دکان و پمپ، با یک فرم.
 *
 * ⚠️ نامِ فیلدِ شناسهٔ حساب در دو بخش فرق دارد (`shopId` / `stationId`) و
 * این عمدی است: دو جدولِ جدا، دو دفتر. پس همین‌جا ترجمه می‌شود، نه در
 * مرورگر.
 */
router.post('/subs/:app/grant', guard(async (req, res) => {
  const app = sectionOf(req.params.app);
  const tenantId = idOf(req.body?.tenantId);
  const b = req.body || {};
  const body = { [app === 'pump' ? 'stationId' : 'shopId']: tenantId, plan: String(b.plan || 'custom').slice(0, 20) };
  if (Array.isArray(b.features) && b.features.length) body.features = b.features;
  if (b.note) body.note = String(b.note).slice(0, 300);
  if (b.maxDevices) body.maxDevices = Number(b.maxDevices);
  if (b.graceDays !== undefined && b.graceDays !== null && b.graceDays !== '') body.graceDays = Number(b.graceDays);
  if (b.endsAt) body.endsAt = Number(b.endsAt);
  const out = await cloudRaw('POST', subsPath(app), { body });
  audit({ actor: actorOf(req), action: 'account.subscription.grant', entity: app, entityId: tenantId, detail: { plan: body.plan } });
  res.json({ ok: true, subscription: out.subscription || null, state: out.state || null });
}));

/**
 * تمدید — «یک ماه یعنی یک ماه» (`addPeriod`)، از پایانِ اشتراکِ فعلی.
 *
 * ⚠️ بخشِ پمپ `PUT /subscriptions/:id` ندارد؛ همان `grant` با `endsAt`ِ
 * صریح تمدید می‌کند. پس مقدارهای فعلی (پلن، دستگاه، مهلت) هم با آن
 * می‌روند، وگرنه پیش‌فرض‌های سرور روی اشتراکِ زنده می‌نشستند.
 */
router.post('/subs/:app/:id/extend', guard(async (req, res) => {
  const app = sectionOf(req.params.app);
  const id = idOf(req.params.id);
  const amount = Number(req.body?.amount) || 1;
  const unit = String(req.body?.unit || 'month');
  const current = await subscriptionOf(app, id);
  const endsAt = addPeriod(Math.max(Number(current.ends_at) || 0, Date.now()), amount, unit);
  const out = app === 'pump'
    ? await cloudRaw('POST', subsPath(app), {
      body: {
        stationId: current.station_id, plan: current.plan || 'custom', endsAt,
        maxDevices: Number(current.max_devices) || 10, graceDays: Number(current.grace_days) || 0,
        note: current.note || '',
      },
    })
    : await cloudRaw('PUT', `${subsPath(app)}/${id}`, { body: { endsAt } });
  audit({ actor: actorOf(req), action: 'account.subscription.extend', entity: 'subscription', entityId: id, detail: { app, amount, unit } });
  res.json({ ok: true, subscription: out.subscription || null, state: out.state || null });
}));

/** تعلیق · لغو · برگرداندن به فعال. */
router.post('/subs/:app/:id/status', guard(async (req, res) => {
  const app = sectionOf(req.params.app);
  const id = idOf(req.params.id);
  const status = String(req.body?.status || '');
  const out = await cloudRaw('POST', `${subsPath(app)}/${id}/status`, { body: { status } });
  audit({ actor: actorOf(req), action: 'account.subscription.status', entity: 'subscription', entityId: id, detail: { app, status } });
  res.json({ ok: true, subscription: out.subscription || null, state: out.state || null });
}));

/** تبدیل به دائمی — بی شمارشِ روز، ولی همچنان با تپش و پشتیبانی. */
router.post('/subs/:app/:id/permanent', guard(async (req, res) => {
  const app = sectionOf(req.params.app);
  const id = idOf(req.params.id);
  const out = await cloudRaw('POST', `${subsPath(app)}/${id}/permanent`);
  audit({ actor: actorOf(req), action: 'account.subscription.permanent', entity: 'subscription', entityId: id, detail: { app } });
  res.json(out);
}));

/** تخفیفِ مستقیم روی همین یک اشتراک، با دلیل (بندِ ۱۱.۳.۲). */
router.post('/subs/:app/:id/discount', guard(async (req, res) => {
  const app = sectionOf(req.params.app);
  const id = idOf(req.params.id);
  const b = req.body || {};
  const out = await cloudRaw('POST', `${subsPath(app)}/${id}/discount`, {
    body: {
      percent: Number(b.percent) || 0,
      amount: Number(b.amount) || 0,
      reason: String(b.reason || '').slice(0, 200),
    },
  });
  audit({ actor: actorOf(req), action: 'account.subscription.discount', entity: 'subscription', entityId: id, detail: { app, percent: Number(b.percent) || 0 } });
  res.json(out);
}));

/** افزونه‌ها — قابلیتِ جدا روی همین اشتراک. */
router.get('/subs/:app/:id/addons', guard(async (req, res) => {
  const app = sectionOf(req.params.app);
  res.json(await cloudRaw('GET', `${subsPath(app)}/${idOf(req.params.id)}/addons`));
}));

router.post('/subs/:app/:id/addons', guard(async (req, res) => {
  const app = sectionOf(req.params.app);
  const id = idOf(req.params.id);
  const out = await cloudRaw('POST', `${subsPath(app)}/${id}/addons`, {
    body: {
      feature: String(req.body?.feature || '').slice(0, 40),
      price: Number(req.body?.price) || 0,
      note: String(req.body?.note || '').slice(0, 200),
    },
  });
  audit({ actor: actorOf(req), action: 'account.addon.add', entity: 'subscription', entityId: id, detail: { app, feature: out.addon?.feature } });
  res.json(out);
}));

router.delete('/subs/:app/:id/addons/:addonId', guard(async (req, res) => {
  const app = sectionOf(req.params.app);
  const id = idOf(req.params.id);
  const out = await cloudRaw('DELETE', `${subsPath(app)}/${id}/addons/${idOf(req.params.addonId)}`);
  audit({ actor: actorOf(req), action: 'account.addon.remove', entity: 'subscription', entityId: id, detail: { app, feature: out.addon?.feature } });
  res.json(out);
}));

/* ----------------------------- پلن و قیمت ------------------------------ */

/**
 * عوض کردنِ خودِ پلن (عنوان، مدت، قیمت، دستگاه، قابلیت‌ها).
 *
 * ⛔ هیچ عددِ قیمتی در پنل نوشته نمی‌شود — این مسیر فقط همان چیزی را که
 *    مدیر تایپ کرده به سرورِ حساب می‌برد و پاسخِ خودِ او را برمی‌گرداند.
 * ⚠️ `app` همیشه همراه است: «m1»ی دکان و «m1»ی پمپ دو ردیفِ جدا با دو
 *    ارزند و یک بار همین شرط جا افتاده بود.
 */
router.patch('/plans/:code', guard(async (req, res) => {
  const app = sectionOf(req.query.app || req.body?.app || 'shop');
  const code = idOf(req.params.code);
  const b = req.body || {};
  const body = { app };
  for (const key of ['title', 'badge']) if (b[key] !== undefined) body[key] = String(b[key]).slice(0, 60);
  for (const key of ['amount', 'price', 'sortOrder', 'maxDevices']) if (b[key] !== undefined && b[key] !== '') body[key] = Number(b[key]);
  if (b.unit !== undefined) body.unit = String(b.unit).slice(0, 10);
  if (b.active !== undefined) body.active = Boolean(b.active);
  if (b.negotiable !== undefined) body.negotiable = Boolean(b.negotiable);
  if (Array.isArray(b.features)) body.features = b.features;
  const out = await cloudRaw('PATCH', `/api/admin/plans/${code}`, { query: { app }, body });
  audit({ actor: actorOf(req), action: 'account.plan.update', entity: 'plan', entityId: code, detail: { app } });
  res.json(out);
}));

/** تاریخچهٔ قیمتِ یک پلن — «اشتراک‌های قبلی با قیمتِ زمانِ خرید می‌مانند». */
router.get('/plans/:code/price-history', guard(async (req, res) => {
  const app = sectionOf(req.query.app || 'shop');
  res.json(await cloudRaw('GET', `/api/admin/plans/${idOf(req.params.code)}/price-history`, { query: { app } }));
}));

/** تاریخچهٔ قیمتِ همهٔ پلن‌های یک بخش. */
router.get('/price-history', guard(async (req, res) => {
  const app = sectionOf(req.query.app || 'shop');
  res.json(await cloudRaw('GET', '/api/admin/price-history', {
    query: { app, plan: String(req.query.plan || '').slice(0, 20) },
  }));
}));

/* ------------------------------- تخفیف -------------------------------- */

router.get('/discount-codes', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/discount-codes', {
    query: {
      app: scopeOf(req.query.app) === 'both' ? '' : scopeOf(req.query.app),
      status: String(req.query.status || '').slice(0, 20),
      limit: Math.min(1000, Math.max(1, Number(req.query.limit) || 200)),
    },
  }));
}));

router.post('/discount-codes', guard(async (req, res) => {
  const b = req.body || {};
  const out = await cloudRaw('POST', '/api/admin/discount-codes', {
    body: {
      app: sectionOf(b.app || 'shop'),
      code: String(b.code || '').slice(0, 40),
      kind: b.kind === 'amount' ? 'amount' : 'percent',
      value: Number(b.value) || 0,
      plan: String(b.plan || '').slice(0, 20),
      userId: String(b.userId || '').slice(0, 80),
      expiresAt: b.expiresAt ? Number(b.expiresAt) : null,
      maxUses: b.maxUses === '' || b.maxUses === undefined || b.maxUses === null ? null : Number(b.maxUses),
      oncePerCustomer: b.oncePerCustomer !== false,
      note: String(b.note || '').slice(0, 200),
    },
  });
  audit({ actor: actorOf(req), action: 'account.discount.create', entity: 'discount_code', entityId: out.code?.id || '', detail: { app: out.code?.app, kind: out.code?.kind } });
  res.json(out);
}));

router.post('/discount-codes/:id/revoke', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const out = await cloudRaw('POST', `/api/admin/discount-codes/${id}/revoke`);
  audit({ actor: actorOf(req), action: 'account.discount.revoke', entity: 'discount_code', entityId: id });
  res.json(out);
}));

/** سنجیدنِ یک کد پیش از دادنش — همان `quote`ی که خودِ برنامه می‌زند. */
router.post('/discount-codes/quote', guard(async (req, res) => {
  res.json(await cloudRaw('POST', '/api/admin/discount-codes/quote', {
    body: {
      code: String(req.body?.code || '').slice(0, 40),
      app: sectionOf(req.body?.app || 'shop'),
      plan: String(req.body?.plan || '').slice(0, 20),
      userId: String(req.body?.userId || '').slice(0, 80),
    },
  }));
}));

/* ------------------------------- کمپین -------------------------------- */

router.get('/campaigns', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/campaigns'));
}));

/** فیلتر ⇒ کدِ تخفیف ⇒ اعلان، در یک تماس (سناریوی ۱۱ پرامپت). */
router.post('/campaigns', guard(async (req, res) => {
  const b = req.body || {};
  const out = await cloudRaw('POST', '/api/admin/campaigns', {
    body: {
      name: String(b.name || '').slice(0, 120),
      app: scopeOf(b.app, 'shop'),
      filter: b.filter && typeof b.filter === 'object' ? b.filter : { kind: 'all' },
      discount: b.discount && typeof b.discount === 'object' ? b.discount : {},
      notice: b.notice && typeof b.notice === 'object' ? b.notice : {},
      send: b.send !== false,
    },
  });
  audit({ actor: actorOf(req), action: 'account.campaign.create', entity: 'campaign', entityId: out.campaign?.id || '', detail: { app: out.campaign?.app } });
  res.json(out);
}));

router.get('/campaigns/:id/stats', guard(async (req, res) => {
  res.json(await cloudRaw('GET', `/api/admin/campaigns/${idOf(req.params.id)}/stats`));
}));

/* ---------------------------- مرکزِ اعلان ------------------------------ */

router.get('/notice-templates', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/notice-templates'));
}));

router.put('/notice-templates/:key', guard(async (req, res) => {
  const key = idOf(req.params.key);
  const b = req.body || {};
  const out = await cloudRaw('PUT', `/api/admin/notice-templates/${key}`, {
    body: {
      app: scopeOf(b.app, 'both'),
      title: String(b.title || '').slice(0, 200),
      body: String(b.body || '').slice(0, 8000),
      channels: Array.isArray(b.channels) ? b.channels : undefined,
    },
  });
  audit({ actor: actorOf(req), action: 'account.notice.template', entity: 'notice_template', entityId: key });
  res.json(out);
}));

router.get('/notices', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/notices', {
    query: {
      status: String(req.query.status || '').slice(0, 20),
      app: scopeOf(req.query.app),
      system: req.query.system === undefined ? '' : String(req.query.system),
      limit: Math.min(500, Math.max(1, Number(req.query.limit) || 100)),
    },
  }));
}));

/** بدنهٔ ساختن/ویرایشِ اعلان — یک جا، تا فرم و ویرایش یک شکل بمانند. */
function noticeInput(b = {}) {
  const out = {
    app: scopeOf(b.app, 'shop'),
    audience: b.audience && typeof b.audience === 'object' ? b.audience : { kind: 'all' },
    channels: Array.isArray(b.channels) && b.channels.length ? b.channels : ['inapp'],
    title: String(b.title || '').slice(0, 200),
    body: String(b.body || '').slice(0, 8000),
    templateKey: String(b.templateKey || '').slice(0, 40),
  };
  if (b.variables && typeof b.variables === 'object') out.variables = b.variables;
  if (b.scheduleAt !== undefined) out.scheduleAt = b.scheduleAt ? Number(b.scheduleAt) : null;
  if (b.repeat !== undefined) out.repeat = b.repeat === 'monthly' ? 'monthly' : 'none';
  return out;
}

router.post('/notices', guard(async (req, res) => {
  const out = await cloudRaw('POST', '/api/admin/notices', {
    body: { ...noticeInput(req.body), send: req.body?.send === true },
  });
  audit({ actor: actorOf(req), action: 'account.notice.create', entity: 'notice', entityId: out.notice?.id || '', detail: { app: out.notice?.app, sent: Boolean(out.sent) } });
  res.json(out);
}));

router.get('/notices/:id', guard(async (req, res) => {
  res.json(await cloudRaw('GET', `/api/admin/notices/${idOf(req.params.id)}`));
}));

router.put('/notices/:id', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const out = await cloudRaw('PUT', `/api/admin/notices/${id}`, { body: noticeInput(req.body) });
  audit({ actor: actorOf(req), action: 'account.notice.update', entity: 'notice', entityId: id });
  res.json(out);
}));

router.delete('/notices/:id', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const out = await cloudRaw('DELETE', `/api/admin/notices/${id}`);
  audit({ actor: actorOf(req), action: 'account.notice.delete', entity: 'notice', entityId: id });
  res.json(out);
}));

/**
 * پیش‌نمایش — گیرنده‌ها، متنِ پرشده برای چند نفرِ اول، و HTMLِ ایمیل.
 *
 * ⚠️ هیچ ردیفِ تحویلی نمی‌گذارد و نباید بگذارد، وگرنه آمارِ کمپین با
 * آزمایش‌های خودِ مدیر آلوده می‌شود.
 */
router.post('/notices/:id/preview', guard(async (req, res) => {
  res.json(await cloudRaw('POST', `/api/admin/notices/${idOf(req.params.id)}/preview`, {
    body: { limit: Math.min(100, Math.max(1, Number(req.body?.limit) || 20)) },
  }));
}));

/** ارسالِ آزمایشی به نشانیِ خودِ مدیر — باز هم بی هیچ ردیفی در گزارش. */
router.post('/notices/:id/test', guard(async (req, res) => {
  res.json(await cloudRaw('POST', `/api/admin/notices/${idOf(req.params.id)}/test`, {
    body: { to: String(req.body?.to || '').slice(0, 160) },
  }));
}));

router.post('/notices/:id/send', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const out = await cloudRaw('POST', `/api/admin/notices/${id}/send`);
  audit({ actor: actorOf(req), action: 'account.notice.send', entity: 'notice', entityId: id, detail: { sent: out.sent, failed: out.failed } });
  res.json(out);
}));

router.post('/notices/:id/schedule', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const at = req.body?.scheduleAt === null || req.body?.scheduleAt === '' ? null : Number(req.body?.scheduleAt);
  const out = await cloudRaw('POST', `/api/admin/notices/${id}/schedule`, {
    body: { scheduleAt: at, repeat: req.body?.repeat === 'monthly' ? 'monthly' : 'none' },
  });
  audit({ actor: actorOf(req), action: 'account.notice.schedule', entity: 'notice', entityId: id, detail: { scheduleAt: at } });
  res.json(out);
}));

/** گزارشِ ارسال — یک ردیف برای هر گیرنده در هر کانال، با حالِ واقعی. */
router.get('/notices/:id/report', guard(async (req, res) => {
  res.json(await cloudRaw('GET', `/api/admin/notices/${idOf(req.params.id)}/report`, {
    query: { limit: Math.min(5000, Math.max(1, Number(req.query.limit) || 500)) },
  }));
}));

/** «این فیلتر چند نفر می‌شود؟» — بی ساختنِ اعلان. */
router.post('/notices/audience', guard(async (req, res) => {
  res.json(await cloudRaw('POST', '/api/admin/notices/audience', {
    body: {
      app: scopeOf(req.body?.app, 'shop'),
      audience: req.body?.audience && typeof req.body.audience === 'object' ? req.body.audience : { kind: 'all' },
    },
  }));
}));

/** اجرای دستیِ اعلان‌های خودکار — برای وقتی مدیر تا فردا صبر نمی‌کند. */
router.post('/notices/run-system', guard(async (req, res) => {
  const out = await cloudRaw('POST', '/api/admin/notices/run-system');
  audit({ actor: actorOf(req), action: 'account.notice.run_system', detail: out });
  res.json(out);
}));

/* -------------------------------- فروش -------------------------------- */

router.get('/sales/summary', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/sales/summary'));
}));

router.get('/sales/expiring', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/sales/expiring', {
    query: {
      days: Math.min(90, Math.max(1, Number(req.query.days) || 7)),
      app: scopeOf(req.query.app) === 'both' ? '' : scopeOf(req.query.app),
    },
  }));
}));

/** یادآوری به همهٔ رو به پایان‌ها — از همان مرکزِ اعلان، پس گزارشش هم آن‌جاست. */
router.post('/sales/expiring/remind', guard(async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.body?.days) || 7));
  const app = scopeOf(req.body?.app, 'both');
  const out = await cloudRaw('POST', '/api/admin/sales/expiring/remind', { body: { days, app } });
  audit({ actor: actorOf(req), action: 'account.sales.remind', detail: { days, app, sent: out.sent } });
  res.json(out);
}));

router.get('/sales/debts', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/sales/debts', {
    query: { app: scopeOf(req.query.app) === 'both' ? '' : scopeOf(req.query.app) },
  }));
}));

/* ------------------------------ پرداخت‌ها ------------------------------ */

router.get('/payments', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/payments', {
    query: {
      app: scopeOf(req.query.app) === 'both' ? '' : scopeOf(req.query.app),
      tenantId: String(req.query.tenantId || '').slice(0, 80),
      limit: Math.min(500, Math.max(1, Number(req.query.limit) || 100)),
    },
  }));
}));

function paymentInput(b = {}) {
  const out = {};
  if (b.app !== undefined) out.app = sectionOf(b.app);
  if (b.tenantId !== undefined) out.tenantId = String(b.tenantId).slice(0, 80);
  if (b.subscriptionId !== undefined) out.subscriptionId = String(b.subscriptionId || '').slice(0, 80);
  if (b.amount !== undefined && b.amount !== '') out.amount = Number(b.amount);
  if (b.currency !== undefined) out.currency = b.currency === 'USD' ? 'USD' : 'AFN';
  if (b.method !== undefined) out.method = ['cash', 'hawala', 'exchange'].includes(b.method) ? b.method : 'cash';
  if (b.receiptNo !== undefined) out.receiptNo = String(b.receiptNo || '').slice(0, 60);
  if (b.note !== undefined) out.note = String(b.note || '').slice(0, 300);
  if (b.paidAt) out.paidAt = Number(b.paidAt);
  return out;
}

router.post('/payments', guard(async (req, res) => {
  const out = await cloudRaw('POST', '/api/admin/payments', { body: paymentInput(req.body) });
  audit({ actor: actorOf(req), action: 'account.payment.create', entity: 'payment', entityId: out.payment?.id || '', detail: { app: out.payment?.app, amount: out.payment?.amount } });
  res.json(out);
}));

router.put('/payments/:id', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const out = await cloudRaw('PUT', `/api/admin/payments/${id}`, { body: paymentInput(req.body) });
  audit({ actor: actorOf(req), action: 'account.payment.update', entity: 'payment', entityId: id });
  res.json(out);
}));

router.delete('/payments/:id', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const out = await cloudRaw('DELETE', `/api/admin/payments/${id}`);
  audit({ actor: actorOf(req), action: 'account.payment.delete', entity: 'payment', entityId: id });
  res.json(out);
}));

/**
 * رسید/فاکتور — صفحهٔ **HTMLِ چاپیِ فارسیِ خودِ سرورِ حساب**.
 *
 * ⛔ این‌جا دوباره ساخته نمی‌شود و هیچ کتابخانهٔ PDFی نمی‌آید: مرورگر
 *    خودش «چاپ ⇒ ذخیره به PDF» دارد. یک رسید، یک شکل، یک جا.
 * ⚠️ پنل آن را با نشستِ خودش می‌خواند و به مرورگر می‌دهد، پس هیچ توکنی
 *    در نشانیِ قابلِ اشتراک‌گذاری نمی‌نشیند.
 */
router.get('/payments/:id/receipt', guard(async (req, res) => {
  const out = await cloudRawText('GET', `/api/admin/payments/${idOf(req.params.id)}/receipt`);
  res.set('Content-Type', out.contentType.includes('html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:");
  res.send(out.text);
}));

/* ----------------------------- وضعیتِ Sync ----------------------------- */

/**
 * ⛔ **فقط حال، نه محتوا.** این‌جا آخرین همگام‌سازی، صف، تعارض و خطا
 *    دیده می‌شود — نه یک ردیف از دادهٔ خودِ مشتری. قاعدهٔ بندِ ۱۱.۳ی
 *    پرامپت: «مدیر فقط وضعیت را می‌بیند، نه محتوا را.»
 */
router.get('/sync/status', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/sync/status', {
    query: {
      app: sectionOf(req.query.app || 'shop'),
      account: String(req.query.account || '').slice(0, 80),
      limit: Math.min(500, Math.max(1, Number(req.query.limit) || 100)),
    },
  }));
}));

router.get('/sync/conflicts', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/sync/conflicts', {
    query: {
      app: sectionOf(req.query.app || 'shop'),
      account: String(req.query.account || '').slice(0, 80),
      limit: Math.min(500, Math.max(1, Number(req.query.limit) || 100)),
      all: req.query.all === '1' ? '1' : '',
    },
  }));
}));

/** بازگرداندنِ نسخهٔ بازنده — یک opِ تازه از طرفِ سرور، نه پاک کردنِ چیزی. */
router.post('/sync/conflicts/:id/restore', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const out = await cloudRaw('POST', `/api/admin/sync/conflicts/${id}/restore`);
  audit({ actor: actorOf(req), action: 'account.sync.restore', entity: 'sync_conflict', entityId: id });
  res.json(out);
}));

router.get('/sync/errors', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/sync/errors', {
    query: {
      app: scopeOf(req.query.app) === 'both' ? '' : scopeOf(req.query.app),
      limit: Math.min(500, Math.max(1, Number(req.query.limit) || 100)),
    },
  }));
}));

/* -------------------- ورودها با کدِ ایمیلی (میزِ «کد نیامد») ------------ */

/**
 * ⛔ **`/logins/:id/reveal` عمداً این‌جا نیست.** آن مسیر کدِ زندهٔ ورودِ
 *    یک مشتری را برمی‌گرداند؛ در پشتیِ ورود است و سرورِ حساب هم فقط به
 *    مدیرِ کلِ خودش و با ثبت در دفتر می‌دهدش. بردنش به مرورگرِ پنل یعنی
 *    یک راز بیشتر که از دفترِ خودش بیرون آمده. کسی که لازمش دارد، از
 *    پنلِ خودِ سرورِ حساب می‌گیردش.
 */
router.get('/logins', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/logins', {
    query: {
      email: String(req.query.email || '').slice(0, 160),
      app: scopeOf(req.query.app) === 'both' ? '' : scopeOf(req.query.app),
      limit: Math.min(200, Math.max(1, Number(req.query.limit) || 50)),
    },
  }));
}));

router.get('/logins/stats', guard(async (req, res) => {
  res.json(await cloudRaw('GET', '/api/admin/logins/stats', {
    query: { hours: Math.min(720, Math.max(1, Number(req.query.hours) || 24)) },
  }));
}));

/** دوباره فرستادنِ همان کد — نه کدِ تازه. */
router.post('/logins/:id/resend', guard(async (req, res) => {
  const id = idOf(req.params.id);
  const out = await cloudRaw('POST', `/api/admin/logins/${id}/resend`);
  audit({ actor: actorOf(req), action: 'account.login.resend', entity: 'login_request', entityId: id });
  res.json(out);
}));

/** برداشتنِ قفلِ پانزده‌دقیقه‌ایِ «تلاشِ زیاد». */
router.post('/logins/unlock', guard(async (req, res) => {
  const email = String(req.body?.email || '').slice(0, 160);
  const app = sectionOf(req.body?.app || 'shop');
  const out = await cloudRaw('POST', '/api/admin/logins/unlock', { body: { app, email } });
  audit({ actor: actorOf(req), action: 'account.login.unlock', detail: { app } });
  res.json(out);
}));

/* --------------------------- خواندنی‌های دیگر -------------------------- */

/** فقط‌خواندنی — یک‌به‌یک، نه «هر چه زیرِ /api/admin بود». */
for (const [local, remote] of [
  ['/subscriptions/expiring', '/api/admin/subscriptions/expiring'],
  ['/stats', '/api/admin/stats'],
  ['/overview', '/api/admin/overview'],
  ['/users', '/api/admin/users'],
  ['/shops', '/api/admin/shops'],
  ['/subscriptions', '/api/admin/subscriptions'],
]) {
  router.get(local, guard(async (req, res) => {
    res.json(await cloudRaw('GET', remote, { query: req.query }));
  }));
}

/** هر چیزِ دیگری زیرِ این پیشوند «نیست» — نه «رد شد»، تا نقشهٔ آن‌طرف لو نرود. */
router.use((req, res) => res.status(404).json({ error: 'not_found', message: 'این مسیر وجود ندارد' }));

export default router;
