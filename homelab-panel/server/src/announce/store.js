// ---------------------------------------------------------------------------
//  اطلاعیه‌ها — «یک پیام بگذار روی صفحهٔ همهٔ برنامه‌ها»
//
//      برنامهٔ مدیر  →  این‌جا  →  پمپ / فروشگاه / سایت‌ها
//
//  ⚠️ چرا جدا از «اعلان» (notify): آن یکی پوشِ لحظه‌ای است — می‌آید، دیده
//  می‌شود، و می‌رود. این یکی روی صفحه *می‌ماند* تا وقتی خودتان برش دارید
//  یا مهلتش تمام شود. کسی که فردا برنامه را باز می‌کند هم باید «تخفیفِ
//  این هفته» را ببیند، نه اینکه چون دیروز آنلاین نبوده از دستش برود.
//
//  ⚠️ و چرا خودِ برنامه‌ها آن را می‌خوانند نه اینکه ما به‌شان بفرستیم:
//  برنامه‌ها همین حالا هر چند دقیقه قیمت‌نامه و وضعیتِ اشتراک را می‌گیرند.
//  اطلاعیه در همان پاسخ‌ها سوار می‌شود، پس نه اتصالِ تازه‌ای لازم است، نه
//  حسابِ گوگل، نه توکنِ پوش.
// ---------------------------------------------------------------------------
import { db } from '../db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS announcements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  audience    TEXT    NOT NULL DEFAULT 'all',  -- all | station | shop | site
  target_id   TEXT,                            -- یک حساب/پمپِ مشخص، یا خالی برای همه
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL DEFAULT '',
  kind        TEXT    NOT NULL DEFAULT 'info', -- info | success | warn | danger
  link        TEXT,
  dismissible INTEGER NOT NULL DEFAULT 1,
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER,
  enabled     INTEGER NOT NULL DEFAULT 1,
  seen        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  created_by  TEXT
);
CREATE INDEX IF NOT EXISTS idx_announce_live ON announcements (enabled, starts_at, ends_at);
`);

/** مخاطب‌هایی که می‌شناسیم. هر چیزِ دیگری «همه» حساب می‌شود. */
export const AUDIENCES = ['all', 'station', 'shop', 'site'];

export const AUDIENCE_LABELS = {
  all: 'همه',
  station: 'پمپ بنزین',
  shop: 'فروشگاه',
  site: 'سایت‌ها',
};

export const KINDS = ['info', 'success', 'warn', 'danger'];

const cleanAudience = (value) => {
  const raw = String(value ?? 'all').trim().toLowerCase();
  return AUDIENCES.includes(raw) ? raw : 'all';
};

const cleanKind = (value) => {
  const raw = String(value ?? 'info').trim().toLowerCase();
  return KINDS.includes(raw) ? raw : 'info';
};

const text = (value, max) => String(value ?? '').trim().slice(0, max);

/** شکلی که برنامهٔ مدیر و پنل می‌بینند */
export const publicRow = (row) => ({
  id: row.id,
  audience: row.audience,
  audienceLabel: AUDIENCE_LABELS[row.audience] || row.audience,
  targetId: row.target_id,
  title: row.title,
  body: row.body,
  kind: row.kind,
  link: row.link,
  dismissible: Boolean(row.dismissible),
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  enabled: Boolean(row.enabled),
  seen: row.seen,
  createdAt: row.created_at,
  createdBy: row.created_by,
  live: isLive(row),
});

/** همین حالا روی صفحه‌هاست؟ */
export function isLive(row, now = Date.now()) {
  if (!row.enabled) return false;
  if (row.starts_at > now) return false;
  if (row.ends_at && row.ends_at < now) return false;
  return true;
}

export function createAnnouncement(input = {}, actor = 'admin') {
  const now = Date.now();
  const title = text(input.title, 120);
  if (!title) {
    const e = new Error('عنوان لازم است');
    e.code = 'title_required';
    throw e;
  }

  const info = db.prepare(`
    INSERT INTO announcements
      (audience, target_id, title, body, kind, link, dismissible,
       starts_at, ends_at, enabled, created_at, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    cleanAudience(input.audience),
    text(input.targetId, 80) || null,
    title,
    text(input.body, 2000),
    cleanKind(input.kind),
    text(input.link, 500) || null,
    input.dismissible === false ? 0 : 1,
    Number(input.startsAt) || now,
    Number(input.endsAt) || null,
    input.enabled === false ? 0 : 1,
    now,
    text(actor, 60),
  );

  return byId(info.lastInsertRowid);
}

export function updateAnnouncement(id, patch = {}) {
  const row = byId(id);
  if (!row) return null;

  const next = {
    audience: patch.audience === undefined ? row.audience : cleanAudience(patch.audience),
    target_id: patch.targetId === undefined ? row.target_id : (text(patch.targetId, 80) || null),
    title: patch.title === undefined ? row.title : text(patch.title, 120),
    body: patch.body === undefined ? row.body : text(patch.body, 2000),
    kind: patch.kind === undefined ? row.kind : cleanKind(patch.kind),
    link: patch.link === undefined ? row.link : (text(patch.link, 500) || null),
    dismissible: patch.dismissible === undefined ? row.dismissible : (patch.dismissible ? 1 : 0),
    starts_at: patch.startsAt === undefined ? row.starts_at : (Number(patch.startsAt) || row.starts_at),
    ends_at: patch.endsAt === undefined ? row.ends_at : (Number(patch.endsAt) || null),
    enabled: patch.enabled === undefined ? row.enabled : (patch.enabled ? 1 : 0),
  };

  db.prepare(`
    UPDATE announcements SET
      audience = ?, target_id = ?, title = ?, body = ?, kind = ?, link = ?,
      dismissible = ?, starts_at = ?, ends_at = ?, enabled = ?
    WHERE id = ?
  `).run(
    next.audience, next.target_id, next.title, next.body, next.kind, next.link,
    next.dismissible, next.starts_at, next.ends_at, next.enabled, row.id,
  );

  return byId(row.id);
}

export function deleteAnnouncement(id) {
  return db.prepare('DELETE FROM announcements WHERE id = ?').run(Number(id) || 0).changes > 0;
}

export const byId = (id) =>
  db.prepare('SELECT * FROM announcements WHERE id = ?').get(Number(id) || 0) || null;

export const listAll = (limit = 200) =>
  db.prepare('SELECT * FROM announcements ORDER BY created_at DESC LIMIT ?').all(Math.min(500, limit));

/**
 *  اطلاعیه‌هایی که همین حالا باید روی صفحهٔ این برنامه باشند.
 *
 *  ⚠️ «همه» همیشه می‌آید، به‌علاوهٔ مخاطبِ خودش. و اگر اطلاعیه‌ای برای یک
 *  حسابِ مشخص باشد، فقط برای همان — نه برای بقیه. این‌طور یک پیامِ خصوصی
 *  («اشتراکت فردا تمام می‌شود») با یک اطلاعیهٔ عمومی از یک در می‌آید و
 *  برنامهٔ آن‌طرف لازم نیست دو جور کد داشته باشد.
 */
export function liveFor({ audience = 'all', targetId = null, now = Date.now() } = {}) {
  const want = cleanAudience(audience);
  return db.prepare(`
    SELECT * FROM announcements
    WHERE enabled = 1
      AND starts_at <= ?
      AND (ends_at IS NULL OR ends_at >= ?)
      AND (audience = 'all' OR audience = ?)
      AND (target_id IS NULL OR target_id = ?)
    ORDER BY
      CASE kind WHEN 'danger' THEN 0 WHEN 'warn' THEN 1 WHEN 'success' THEN 2 ELSE 3 END,
      created_at DESC
    LIMIT 20
  `).all(now, now, want, targetId ? String(targetId) : null);
}

/** شکلِ سبک، برای سوار شدن روی پاسخ‌هایی که برنامه‌ها همین حالا می‌گیرند */
export const noticePayload = (row) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  kind: row.kind,
  link: row.link || null,
  dismissible: Boolean(row.dismissible),
  until: row.ends_at || null,
});

/** «دیده شد» — فقط برای اینکه در پنل معلوم باشد پیام به چند نفر رسیده */
export function markSeen(id) {
  db.prepare('UPDATE announcements SET seen = seen + 1 WHERE id = ?').run(Number(id) || 0);
}

/**
 *  اطلاعیه‌های مخاطبِ خواسته‌شده، آمادهٔ چسباندن به هر پاسخی.
 *
 *  ⚠️ هیچ‌وقت استثنا نمی‌دهد. اگر این تابع روی مسیرِ قیمت‌نامه بیفتد و
 *  خطا بدهد، کلِ قیمت‌نامه می‌خوابد — و آن خیلی بدتر از ندیدنِ یک
 *  اطلاعیه است.
 */
export function noticesFor(audience, targetId = null) {
  try {
    return liveFor({ audience, targetId }).map(noticePayload);
  } catch {
    return [];
  }
}
