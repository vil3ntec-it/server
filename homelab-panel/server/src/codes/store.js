// ---------------------------------------------------------------------------
//  جدول‌های «کدهای شش‌رقمی»
//
//  دو جدول، و همین دو تا کافی است:
//
//    code_apps      دفترِ برنامه‌ها و سایت‌ها — هر کدام با کلیدِ خودش
//    code_requests  هر درخواستِ کد، با همهٔ چیزی که بعداً باید بشود دید:
//                   شناسهٔ برنامه، شناسهٔ کاربر/دستگاه، نوعِ درخواست، خودِ کد،
//                   زمانِ ایجاد، زمانِ انقضا، مصرف‌شده یا نه، و تلاش‌های ناموفق
//
//  ⚠️ کد دو بار ذخیره می‌شود و دلیلش این است:
//
//      code_hash  برای سنجیدن — HMAC، و مقایسه‌اش ثابت‌زمان است تا از روی
//                 زمانِ پاسخ نشود رقم‌به‌رقم حدسش زد.
//      code_seal  برای دیدن — رمزنگاری‌شده با کلیدِ گاوصندوق، چون صاحبِ سرور
//                 خواسته کد را در پنل ببیند و کپی کند. اگر فقط hash داشتیم،
//                 آن دکمهٔ کپی هیچ‌وقت نمی‌توانست وجود داشته باشد.
//
//  هیچ‌کدام کدِ خام نیستند: دیتابیس بی کلیدِ گاوصندوق چیزی لو نمی‌دهد، و کلید
//  یک فایلِ جدا داخلِ پوشهٔ داده است.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db } from '../db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS code_apps (
  slug          TEXT PRIMARY KEY,           -- app-fuel / shop / site-1
  name          TEXT NOT NULL,              -- نامی که در پنل دیده می‌شود
  kind          TEXT NOT NULL DEFAULT 'app',-- app | site
  api_key       TEXT,                       -- کلیدِ اختصاصیِ همین برنامه
  require_key   INTEGER NOT NULL DEFAULT 1,
  enabled       INTEGER NOT NULL DEFAULT 1,
  code_ttl      INTEGER,                    -- ثانیه — خالی یعنی از تنظیماتِ کلی
  subject       TEXT,                       -- عنوانِ ایمیلِ همین برنامه
  note          TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

CREATE TABLE IF NOT EXISTS code_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  app             TEXT NOT NULL,            -- شناسهٔ برنامه
  subject_id      TEXT,                     -- شناسهٔ کاربر/دستگاه در آن برنامه
  subject_name    TEXT,                     -- نامِ خودِ شخص، برای «فلانی عزیز» در ایمیل
  purpose         TEXT NOT NULL DEFAULT 'login', -- نوعِ درخواست
  email           TEXT NOT NULL,
  code_hash       TEXT NOT NULL,
  code_seal       TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  used_at         INTEGER,                  -- وضعیت: استفاده‌شده
  cancelled_at    INTEGER,                  -- کدِ تازه جایش را گرفت
  tries           INTEGER NOT NULL DEFAULT 0, -- تعدادِ تلاش‌های ناموفق
  send_state      TEXT NOT NULL DEFAULT 'queued', -- queued|sending|sent|failed
  send_tries      INTEGER NOT NULL DEFAULT 0,
  send_error      TEXT,
  sent_at         INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  resend_chain    INTEGER NOT NULL DEFAULT 0, -- چندمین ارسالِ خودکارِ همین درخواست
  parent_id       INTEGER,                    -- کدی که این جایش را گرفت
  ip              TEXT
);

CREATE INDEX IF NOT EXISTS idx_code_requests_live  ON code_requests(app, email, id DESC);
CREATE INDEX IF NOT EXISTS idx_code_requests_queue ON code_requests(send_state, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_code_requests_time  ON code_requests(created_at DESC);
`);

/*
 *  ستون‌هایی که بعداً اضافه شدند.
 *
 *  ⚠️ چرا لازم است: «CREATE TABLE IF NOT EXISTS» فقط روی دیتابیسِ نو کار
 *  می‌کند. روی سروری که از قبل بالا بوده، جدول هست و ستونِ تازه نیست —
 *  و اولین کدی که ساخته شود با خطای «چنین ستونی نداریم» می‌افتد.
 *
 *  یعنی بی این چند خط، به‌روزرسانی روی سرورِ واقعی کلِ کدهای شش‌رقمی را
 *  از کار می‌انداخت، در حالی که روی دیتابیسِ خالیِ آزمون همه‌چیز سبز بود.
 */
function addColumn(table, column, type) {
  try {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch { /* ستون از قبل هست یا جدول نیست — هر دو بی‌ضرر */ }
}

addColumn('code_requests', 'subject_name', 'TEXT');
/*
 *  رسیدِ خودِ سرورِ ایمیل — همان جمله‌ای که بعدِ تحویل می‌گوید، مثلاً:
 *      250 2.0.0 OK 1699… j7-20020a17…sm… - gsmtp
 *
 *  ⚠️ چرا نگهش می‌داریم: بدونِ آن، «فرستاده شد» فقط ادعای ماست. با آن،
 *  می‌شود ثابت کرد که جیمیل پیام را گرفته و اگر باز هم نرسیده، مشکل
 *  بعدِ جیمیل است (اسپم یا برگشتِ دیرهنگام)، نه این‌جا.
 */
addColumn('code_requests', 'send_response', 'TEXT');

/* ------------------------------ برنامه‌ها -------------------------------- */

export const KINDS = ['app', 'site'];
export const KIND_LABELS = { app: 'برنامه', site: 'سایت' };

/** شناسه‌ای که هم در آدرس جا شود هم در چشم — APP-FUEL-001 هم قبول است */
export function cleanSlug(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  const slug = raw.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug || 'main';
}

export const newApiKey = () => `code_${crypto.randomBytes(20).toString('hex')}`;

export function getApp(slug) {
  return db.prepare('SELECT * FROM code_apps WHERE slug = ?').get(cleanSlug(slug)) || null;
}

export function listApps() {
  return db.prepare('SELECT * FROM code_apps ORDER BY created_at DESC').all();
}

/**
 * برنامه را می‌سازد اگر نبود.
 *
 * برنامهٔ تازه با `require_key = 1` می‌آید و کلیدش همان لحظه ساخته می‌شود:
 * یعنی تا صاحبِ سرور کلید را در پنل ندیده و داخلِ برنامه‌اش نگذاشته، کسی
 * نمی‌تواند با نامِ آن برنامه ایمیل بفرستد.
 */
export function ensureApp(slug, { name = null, kind = 'app' } = {}) {
  const key = cleanSlug(slug);
  const found = getApp(key);
  if (found) return found;
  db.prepare(
    'INSERT INTO code_apps(slug, name, kind, api_key, created_at) VALUES(?,?,?,?,?)'
  ).run(key, String(name || key).slice(0, 80), KINDS.includes(kind) ? kind : 'app', newApiKey(), Date.now());
  return getApp(key);
}

export function saveApp(slug, patch = {}) {
  const row = getApp(slug);
  if (!row) return null;
  const fields = [];
  const values = [];
  const set = (column, value) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.name !== undefined) set('name', String(patch.name).slice(0, 80));
  if (patch.kind !== undefined) set('kind', KINDS.includes(patch.kind) ? patch.kind : 'app');
  if (patch.enabled !== undefined) set('enabled', patch.enabled ? 1 : 0);
  if (patch.requireKey !== undefined) set('require_key', patch.requireKey ? 1 : 0);
  if (patch.codeTtl !== undefined) set('code_ttl', patch.codeTtl ? Number(patch.codeTtl) : null);
  if (patch.subject !== undefined) set('subject', patch.subject ? String(patch.subject).slice(0, 200) : null);
  if (patch.note !== undefined) set('note', patch.note ? String(patch.note).slice(0, 500) : null);
  if (!fields.length) return row;
  values.push(row.slug);
  db.prepare(`UPDATE code_apps SET ${fields.join(', ')} WHERE slug = ?`).run(...values);
  return getApp(row.slug);
}

export function rotateKey(slug) {
  const row = getApp(slug);
  if (!row) return null;
  db.prepare('UPDATE code_apps SET api_key = ? WHERE slug = ?').run(newApiKey(), row.slug);
  return getApp(row.slug);
}

export function deleteApp(slug) {
  const row = getApp(slug);
  if (!row) return false;
  db.prepare('DELETE FROM code_apps WHERE slug = ?').run(row.slug);
  db.prepare('DELETE FROM code_requests WHERE app = ?').run(row.slug);
  return true;
}

export function touchApp(slug) {
  try {
    db.prepare('UPDATE code_apps SET last_seen_at = ? WHERE slug = ?').run(Date.now(), cleanSlug(slug));
  } catch { /* اگر برنامه پاک شده، اهمیتی ندارد */ }
}

/* ------------------------------ درخواست‌ها ------------------------------- */

export function insertRequest(row) {
  return db
    .prepare(
      `INSERT INTO code_requests
         (app, subject_id, subject_name, purpose, email, code_hash, code_seal,
          created_at, expires_at, ip, resend_chain, parent_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       RETURNING id`
    )
    .get(
      row.app,
      row.subjectId || null,
      row.subjectName || null,
      row.purpose,
      row.email,
      row.codeHash,
      row.codeSeal,
      row.createdAt,
      row.expiresAt,
      row.ip || null,
      row.resendChain || 0,
      row.parentId || null,
    ).id;
}

export function getRequest(id) {
  return db.prepare('SELECT * FROM code_requests WHERE id = ?').get(id) || null;
}

/** تازه‌ترین کدِ زنده برای این ایمیل در این برنامه */
export function liveRequest(app, email) {
  return (
    db
      .prepare(
        `SELECT * FROM code_requests
          WHERE app = ? AND email = ? AND used_at IS NULL AND cancelled_at IS NULL
          ORDER BY id DESC LIMIT 1`
      )
      .get(app, email) || null
  );
}

/** آخرین درخواستِ این ایمیل — هر وضعیتی که داشته باشد (برای فاصلهٔ ارسالِ دوباره) */
export function lastRequest(app, email) {
  return (
    db
      .prepare('SELECT * FROM code_requests WHERE app = ? AND email = ? ORDER BY id DESC LIMIT 1')
      .get(app, email) || null
  );
}

/** کدهای قبلیِ همین ایمیل باطل می‌شوند — همیشه فقط یک کدِ زنده */
export function cancelLive(app, email, at = Date.now()) {
  return db
    .prepare(
      `UPDATE code_requests SET cancelled_at = ?
        WHERE app = ? AND email = ? AND used_at IS NULL AND cancelled_at IS NULL`
    )
    .run(at, app, email).changes;
}

export function markUsed(id, at = Date.now()) {
  db.prepare('UPDATE code_requests SET used_at = ? WHERE id = ?').run(at, id);
}

export function bumpTries(id) {
  db.prepare('UPDATE code_requests SET tries = tries + 1 WHERE id = ?').run(id);
}

/* --------------------------------- صف ----------------------------------- */

/**
 * یک ردیف را برای فرستادن برمی‌دارد.
 *
 * برداشتن و علامت‌زدن در یک UPDATE است، پس دو کارگر نمی‌توانند یک ردیف را
 * هم‌زمان بردارند و ایمیل دوبار نمی‌رود.
 */
export function claimNext(now = Date.now()) {
  const row = db
    .prepare(
      `UPDATE code_requests SET send_state = 'sending'
        WHERE id = (
          SELECT id FROM code_requests
           WHERE send_state = 'queued' AND next_attempt_at <= ?
             AND used_at IS NULL AND cancelled_at IS NULL
           ORDER BY id LIMIT 1
        )
        RETURNING *`
    )
    .get(now);
  return row || null;
}

export function markSent(id, at = Date.now(), response = '') {
  db.prepare(
    `UPDATE code_requests
        SET send_state = 'sent', sent_at = ?, send_error = NULL, send_response = ?
      WHERE id = ?`
  ).run(at, String(response || '').slice(0, 300), id);
}

/** وضعیتِ ارسالِ یک ردیف — برای وقتی می‌خواهیم منتظرِ نتیجهٔ واقعی بمانیم */
export function deliveryOf(id) {
  const row = db
    .prepare('SELECT send_state, send_error, send_response, send_tries, sent_at FROM code_requests WHERE id = ?')
    .get(id);
  if (!row) return null;
  return {
    state: row.send_state,
    error: row.send_error || null,
    response: row.send_response || null,
    tries: row.send_tries,
    sentAt: row.sent_at,
  };
}

/** ارسال نشد: یا دوباره در صف می‌نشیند، یا شکست‌خورده می‌ماند */
export function markSendFailed(id, error, { retryAt = null } = {}) {
  db.prepare(
    `UPDATE code_requests
        SET send_state = ?, send_tries = send_tries + 1,
            send_error = ?, next_attempt_at = ?
      WHERE id = ?`
  ).run(retryAt ? 'queued' : 'failed', String(error || '').slice(0, 500), retryAt || 0, id);
}

export function queueDepth(now = Date.now()) {
  return {
    /*
     *  «منتظر» یعنی چیزی که واقعاً قرار است برود.
     *
     *  ⚠️ همان شرطِ claimNext این‌جا هم هست: ردیفی که کدِ تازه باطلش کرده یا
     *  مصرف شده، هیچ‌وقت برداشته نمی‌شود. بدونِ این شرط، شمارنده عددی نشان
     *  می‌داد که هرگز صفر نمی‌شد و صفِ سالم «گیرکرده» به نظر می‌رسید.
     */
    waiting: db
      .prepare(
        `SELECT COUNT(*) AS n FROM code_requests
          WHERE send_state = 'queued' AND used_at IS NULL AND cancelled_at IS NULL`
      )
      .get().n,
    sending: db.prepare("SELECT COUNT(*) AS n FROM code_requests WHERE send_state = 'sending'").get().n,
    failed: db
      .prepare("SELECT COUNT(*) AS n FROM code_requests WHERE send_state = 'failed' AND created_at > ?")
      .get(now - 24 * 3600 * 1000).n,
    sentLastHour: db
      .prepare("SELECT COUNT(*) AS n FROM code_requests WHERE send_state = 'sent' AND sent_at > ?")
      .get(now - 3600 * 1000).n,
  };
}

/**
 * کدهایی که وقتش رسیده خودکار دوباره بروند: هنوز مصرف نشده‌اند، باطل
 * نشده‌اند، و از ساختشان به‌اندازهٔ کافی گذشته.
 */
export function dueForAutoResend({ afterMs, maxChain, now = Date.now(), limit = 50 }) {
  return db
    .prepare(
      `SELECT * FROM code_requests
        WHERE used_at IS NULL AND cancelled_at IS NULL
          AND send_state IN ('sent', 'failed')
          AND resend_chain < ?
          AND created_at <= ?
        ORDER BY id LIMIT ?`
    )
    .all(maxChain, now - afterMs, limit);
}

/** ردیف‌های کهنه می‌روند — چه مصرف شده باشند چه منقضی */
export function pruneRequests({ keepMs, now = Date.now() }) {
  return db
    .prepare(
      `DELETE FROM code_requests
        WHERE (used_at IS NOT NULL OR cancelled_at IS NOT NULL OR expires_at < ?)
          AND created_at < ?`
    )
    .run(now, now - keepMs).changes;
}

/** ردیف‌های «در حالِ ارسال» که وسطِ کار سرور خاموش شده — دوباره در صف */
export function requeueStuck(now = Date.now()) {
  return db
    .prepare(
      "UPDATE code_requests SET send_state = 'queued', next_attempt_at = ? WHERE send_state = 'sending'"
    )
    .run(now).changes;
}

/* ------------------------------- خواندن ---------------------------------- */

export function recentRequests({ app = null, limit = 60 } = {}) {
  const sql = app
    ? 'SELECT * FROM code_requests WHERE app = ? ORDER BY id DESC LIMIT ?'
    : 'SELECT * FROM code_requests ORDER BY id DESC LIMIT ?';
  return app ? db.prepare(sql).all(app, limit) : db.prepare(sql).all(limit);
}
