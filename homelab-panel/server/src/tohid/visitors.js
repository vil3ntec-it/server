// ---------------------------------------------------------------------------
//  بازدیدکننده‌ها — کسانی که آمده‌اند، چه حساب ساخته باشند چه نه
//
//  ── مشکلی که این حل می‌کند ────────────────────────────────────────────
//  پنل فقط کسانی را نشان می‌داد که ثبت‌نام کرده بودند. کسی که برنامه را
//  نصب کرده و باز کرده ولی هنوز حساب نساخته — یعنی دقیقاً همان کسی که
//  باید دنبالش رفت — هیچ‌جا دیده نمی‌شد. نه شمارش، نه اینکه از کجاست، نه
//  اینکه چند بار برگشته.
//
//  ردیف به «دستگاه» بسته است نه به حساب؛ اگر بعداً حساب ساخت، همان ردیف
//  به حسابش وصل می‌شود و تاریخِ اولین باری که آمده گم نمی‌شود.
//
//  ── حریم خصوصی ────────────────────────────────────────────────────────
//  لوکیشن فقط اگر خودِ دستگاه بدهد ثبت می‌شود. هیچ داده‌ای از دفترِ دکان
//  اینجا نمی‌آید — نه فروشی، نه کالایی.
// ---------------------------------------------------------------------------
import { db } from '../db.js';

//  دو تپشِ پشتِ سرِ هم یک بازدید است، نه دو تا. بدونِ این، برنامه‌ای که
//  هر چند دقیقه تپش می‌فرستد عددِ بازدید را بی‌معنی می‌کرد.
const VISIT_GAP_MS = 30 * 60 * 1000;

const cut = (v, max) => String(v ?? '').slice(0, max);
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function shape(r) {
  return {
    app: r.app,
    deviceUid: r.device_uid,
    platform: r.platform || '',
    appVersion: r.app_version || '',
    userId: r.account_id || '',
    accountId: r.account_id || '',
    name: r.name || '',
    ip: r.ip || '',
    language: r.language || '',
    location: r.lat === null || r.lng === null || r.lat === undefined ? null : {
      lat: Number(r.lat),
      lng: Number(r.lng),
      accuracy: r.accuracy === null ? null : Number(r.accuracy),
      label: r.place || '',
    },
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    visits: Number(r.visits) || 1,
    //  همان تفکیکی که مدیر می‌خواهد: مهمان یا حساب‌دار
    guest: !r.account_id,
  };
}

/** ثبتِ یک بازدید. بی شناسهٔ دستگاه کاری نمی‌کند — ردیفِ بی‌صاحب به درد نمی‌خورد. */
export function touchVisitor({
  app = 'shop', deviceUid = '', platform = '', appVersion = '',
  accountId = '', name = '', ip = '', userAgent = '', language = '', location = null,
} = {}) {
  const uid = cut(deviceUid, 64).trim();
  if (!uid) return null;

  const now = Date.now();
  const slug = cut(app || 'shop', 40);
  const lat = location ? num(location.lat) : null;
  const lng = location ? num(location.lng) : null;
  const hasPlace = lat !== null && lng !== null;

  const existing = db.prepare('SELECT * FROM th_visitors WHERE app = ? AND device_uid = ?')
    .get(slug, uid);

  if (!existing) {
    db.prepare(`
      INSERT INTO th_visitors
        (app, device_uid, platform, app_version, account_id, name, ip, user_agent, language,
         lat, lng, accuracy, place, first_seen_at, last_seen_at, visits)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
    `).run(slug, uid, cut(platform, 20), cut(appVersion, 30), cut(accountId, 40), cut(name, 80),
      cut(ip, 60), cut(userAgent, 300), cut(language, 20),
      hasPlace ? lat : null, hasPlace ? lng : null,
      hasPlace ? num(location.accuracy) : null, cut(location?.label, 120), now, now);
  } else {
    const bump = now - Number(existing.last_seen_at) > VISIT_GAP_MS ? 1 : 0;
    db.prepare(`
      UPDATE th_visitors SET
        platform    = CASE WHEN ? <> '' THEN ? ELSE platform END,
        app_version = CASE WHEN ? <> '' THEN ? ELSE app_version END,
        account_id  = CASE WHEN ? <> '' THEN ? ELSE account_id END,
        name        = CASE WHEN ? <> '' THEN ? ELSE name END,
        ip          = CASE WHEN ? <> '' THEN ? ELSE ip END,
        user_agent  = CASE WHEN ? <> '' THEN ? ELSE user_agent END,
        language    = CASE WHEN ? <> '' THEN ? ELSE language END,
        lat      = COALESCE(?, lat),
        lng      = COALESCE(?, lng),
        accuracy = COALESCE(?, accuracy),
        place    = CASE WHEN ? <> '' THEN ? ELSE place END,
        last_seen_at = ?,
        visits = visits + ?
      WHERE app = ? AND device_uid = ?
    `).run(
      cut(platform, 20), cut(platform, 20),
      cut(appVersion, 30), cut(appVersion, 30),
      cut(accountId, 40), cut(accountId, 40),
      cut(name, 80), cut(name, 80),
      cut(ip, 60), cut(ip, 60),
      cut(userAgent, 300), cut(userAgent, 300),
      cut(language, 20), cut(language, 20),
      hasPlace ? lat : null, hasPlace ? lng : null,
      hasPlace ? num(location.accuracy) : null,
      cut(location?.label, 120), cut(location?.label, 120),
      now, bump, slug, uid,
    );
  }

  return shape(db.prepare('SELECT * FROM th_visitors WHERE app = ? AND device_uid = ?').get(slug, uid));
}

/** وقتی مهمان بالاخره حساب ساخت، ردیفش به حسابش می‌چسبد */
export function claimVisitor(deviceUid, accountId) {
  const uid = cut(deviceUid, 64).trim();
  if (!uid || !accountId) return;
  db.prepare(`UPDATE th_visitors SET account_id = ? WHERE device_uid = ? AND account_id = ''`)
    .run(accountId, uid);
}

/** فهرست، با گزینهٔ «فقط مهمان‌ها» */
export function listVisitors({ app = '', onlyGuests = false, q = '', limit = 200, offset = 0 } = {}) {
  const like = `%${String(q || '').toLowerCase()}%`;
  return db.prepare(`
    SELECT v.*, a.name AS account_name, a.email AS account_email, s.name AS shop_name
      FROM th_visitors v
      LEFT JOIN th_accounts a ON a.account_id = v.account_id
      LEFT JOIN th_shops s ON s.owner_id = v.account_id
     WHERE (? = '' OR v.app = ?)
       AND (? = 0 OR v.account_id = '')
       AND (? = '' OR lower(v.name) LIKE ? OR lower(COALESCE(a.name,'')) LIKE ?
            OR lower(COALESCE(a.email,'')) LIKE ? OR v.ip LIKE ? OR lower(v.place) LIKE ?)
     ORDER BY v.last_seen_at DESC
     LIMIT ? OFFSET ?
  `).all(cut(app, 40), cut(app, 40), onlyGuests ? 1 : 0, String(q || ''),
    like, like, like, like, like, Number(limit) || 200, Number(offset) || 0)
    .map((r) => ({
      ...shape(r),
      accountName: r.account_name || '',
      accountEmail: r.account_email || '',
      shopName: r.shop_name || '',
    }));
}

/** شمارش‌ها برای بالای صفحه */
export function visitorSummary({ app = '' } = {}) {
  const slug = cut(app, 40);
  const now = Date.now();
  const one = (sql, ...args) => db.prepare(sql).get(...args).n;

  const total = one(`SELECT COUNT(*) AS n FROM th_visitors WHERE (? = '' OR app = ?)`, slug, slug);
  const guests = one(`SELECT COUNT(*) AS n FROM th_visitors WHERE (? = '' OR app = ?) AND account_id = ''`, slug, slug);
  const today = one(`SELECT COUNT(*) AS n FROM th_visitors WHERE (? = '' OR app = ?) AND last_seen_at > ?`,
    slug, slug, now - 24 * 3600 * 1000);
  const week = one(`SELECT COUNT(*) AS n FROM th_visitors WHERE (? = '' OR app = ?) AND last_seen_at > ?`,
    slug, slug, now - 7 * 24 * 3600 * 1000);
  const located = one(`SELECT COUNT(*) AS n FROM th_visitors WHERE (? = '' OR app = ?) AND lat IS NOT NULL`, slug, slug);

  const platforms = db.prepare(`
    SELECT platform, COUNT(*) AS n FROM th_visitors WHERE (? = '' OR app = ?)
     GROUP BY platform ORDER BY n DESC LIMIT 10
  `).all(slug, slug);

  return {
    total, guests, signedUp: total - guests, today, week, located,
    platforms: platforms.map((p) => ({ platform: p.platform || 'نامعلوم', count: p.n })),
  };
}
