// ---------------------------------------------------------------------------
//  اشتراک‌های VIP
//
//  یک جای واحد تصمیم می‌گیرد که یک حساب همین حالا چه چیزی باز دارد. هم
//  License امضاشده از اینجا ساخته می‌شود، هم پاسخِ /billing/status. پس آنچه
//  در پنل می‌بینید دقیقاً همان است که برنامه اجرا می‌کند.
// ---------------------------------------------------------------------------
import { db } from '../db.js';
import { audit } from '../control/audit.js';

/** قابلیت‌هایی که همیشه باز است — خودِ برنامه هم همین‌ها را CORE می‌داند */
export const CORE = ['dashboard', 'products', 'settings'];
/** رایگان برای همه */
export const FREE = ['warehouse', 'expenses', 'purchasing', 'reports', 'audit_log', 'backup', 'csv_export'];
/** فقط با اشتراک */
export const PAID = ['sales', 'debtors', 'barcode', 'multi_device'];

export const STATUSES = ['active', 'suspended', 'cancelled', 'expired'];

const DAY = 24 * 60 * 60 * 1000;

export function daysToMs(amount, unit) {
  const n = Number(amount) || 0;
  if (unit === 'day') return n * DAY;
  if (unit === 'week') return n * 7 * DAY;
  if (unit === 'month') return n * 30 * DAY;
  if (unit === 'year') return n * 365 * DAY;
  return 0;
}

function parseFeatures(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((f) => PAID.includes(f)) : [];
  } catch {
    return [];
  }
}

export function subscriptionsFor(accountId) {
  return db.prepare('SELECT * FROM th_subscriptions WHERE account_id = ? ORDER BY ends_at DESC').all(accountId);
}

/**
 * اشتراکی که همین حالا معتبر است — یا null.
 * «معتبر» یعنی وضعیتش active است، شروع شده، و هنوز مهلتش (با احتسابِ مهلتِ
 * ارفاق) تمام نشده.
 */
export function activeSubscription(accountId, now = Date.now()) {
  const rows = subscriptionsFor(accountId);
  let best = null;
  for (const row of rows) {
    if (row.status !== 'active') continue;
    if (row.starts_at > now) continue;
    const graceEnd = row.ends_at + (row.grace_days || 0) * DAY;
    if (graceEnd < now) continue;
    if (!best || graceEnd > best.ends_at + (best.grace_days || 0) * DAY) best = row;
  }
  return best;
}

/** وضعیتِ کاملِ یک حساب — همان چیزی که هم پنل نشان می‌دهد هم برنامه می‌گیرد */
export function entitlementFor(accountId, now = Date.now()) {
  const account = db.prepare('SELECT * FROM th_accounts WHERE account_id = ?').get(accountId);
  if (!account) return null;

  if (account.disabled) {
    return {
      source: 'disabled', features: [], free: FREE, core: CORE,
      trial: { used: false, active: false, daysLeft: 0 },
      isPaid: false, message: 'این حساب غیرفعال شده است.',
      plan: null, expiresAt: null, subEndsAt: null, daysLeft: 0, status: 'disabled',
    };
  }

  const sub = activeSubscription(accountId, now);
  if (!sub) {
    const last = subscriptionsFor(accountId)[0] || null;
    return {
      source: 'free', features: FREE.slice(), free: FREE, core: CORE,
      trial: { used: false, active: false, daysLeft: 0 },
      isPaid: false,
      message: last ? 'اشتراک شما تمام شده است.' : '',
      plan: null, expiresAt: null, subEndsAt: null, daysLeft: 0,
      status: last ? last.status : 'none',
    };
  }

  const graceEnd = sub.ends_at + (sub.grace_days || 0) * DAY;
  return {
    source: 'subscription',
    features: FREE.concat(parseFeatures(sub.features)),
    free: FREE, core: CORE,
    trial: { used: false, active: false, daysLeft: 0 },
    isPaid: true,
    message: now > sub.ends_at ? 'اشتراک تمام شده و در مهلت ارفاق هستید.' : '',
    plan: sub.plan_code,
    planTitle: sub.plan_title || sub.plan_code,
    expiresAt: graceEnd,
    subEndsAt: sub.ends_at,
    daysLeft: Math.max(0, Math.ceil((sub.ends_at - now) / DAY)),
    maxDevices: sub.max_devices,
    status: sub.status,
  };
}

/* ---------------------------- کارهای مدیر ----------------------------- */

export function grantSubscription({
  accountId, planCode, planTitle, features, amount, unit,
  startsAt = Date.now(), graceDays = 0, maxDevices = 1, price = null,
  currency = null, note = null, actor = 'admin',
}) {
  const span = daysToMs(amount, unit);
  if (span <= 0) throw Object.assign(new Error('مدت اشتراک نامعتبر است'), { code: 'bad_duration' });

  const now = Date.now();
  const list = Array.isArray(features) ? features.filter((f) => PAID.includes(f)) : PAID.slice();

  db.prepare(`
    INSERT INTO th_subscriptions
      (account_id, plan_code, plan_title, features, status, starts_at, ends_at,
       grace_days, max_devices, price, currency, note, created_at, created_by, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(accountId, planCode, planTitle || planCode, JSON.stringify(list),
    startsAt, startsAt + span, graceDays, maxDevices, price, currency, note, now, actor, now);

  audit({ actor, action: 'tohid.subscription.grant', entity: 'tohid_account', entityId: accountId,
    detail: { planCode, amount, unit, features: list } });

  return activeSubscription(accountId);
}

export function extendSubscription(id, { amount, unit, actor = 'admin' }) {
  const row = db.prepare('SELECT * FROM th_subscriptions WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('اشتراک پیدا نشد'), { code: 'not_found' });
  const span = daysToMs(amount, unit);
  if (span <= 0) throw Object.assign(new Error('مدت نامعتبر است'), { code: 'bad_duration' });

  // اگر تمام شده، از حالا؛ وگرنه از انتهای فعلی — تا زمان از دست نرود
  const base = Math.max(row.ends_at, Date.now());
  db.prepare('UPDATE th_subscriptions SET ends_at = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(base + span, 'active', Date.now(), id);

  audit({ actor, action: 'tohid.subscription.extend', entity: 'tohid_account',
    entityId: row.account_id, detail: { id, amount, unit } });
  return db.prepare('SELECT * FROM th_subscriptions WHERE id = ?').get(id);
}

export function setSubscriptionStatus(id, status, { actor = 'admin' } = {}) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error('وضعیت نامعتبر'), { code: 'bad_status' });
  const row = db.prepare('SELECT * FROM th_subscriptions WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('اشتراک پیدا نشد'), { code: 'not_found' });

  db.prepare('UPDATE th_subscriptions SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id);
  audit({ actor, action: `tohid.subscription.${status}`, entity: 'tohid_account',
    entityId: row.account_id, detail: { id } });
  return db.prepare('SELECT * FROM th_subscriptions WHERE id = ?').get(id);
}
