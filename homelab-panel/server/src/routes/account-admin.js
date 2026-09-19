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
import { cloudRaw } from '../stations/cloud.js';
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
