// ---------------------------------------------------------------------------
// دیتابیس SQLite پنل (با SQLite داخلی خود Node — بدون کامپایل و بدون وابستگی)
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { paths } from './config.js';

// ماژول‌های ESM قبل از کد index اجرا می‌شوند، پس پوشه را همین‌جا می‌سازیم
fs.mkdirSync(path.dirname(paths.db), { recursive: true });

export const db = new DatabaseSync(paths.db);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT,
  ip         TEXT
);

CREATE TABLE IF NOT EXISTS sites (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL UNIQUE,
  domain        TEXT,
  port          INTEGER,
  kind          TEXT,               -- node / static / php / next / laravel ...
  start_command TEXT,               -- دستور اجرا (برای سایت‌های اجرایی)
  autostart     INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS domains (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  site_id    INTEGER REFERENCES sites(id) ON DELETE SET NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  -- آخرین نتیجهٔ بررسی واقعی (DNS/SSL/WHOIS) — کش می‌شود تا هر بار شبکه نزنیم
  checked_at    INTEGER,
  dns_status    TEXT,
  dns_records   TEXT,
  ssl_status    TEXT,
  ssl_issuer    TEXT,
  ssl_expires   INTEGER,
  reg_expires   INTEGER,
  http_status   INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  level      TEXT NOT NULL,         -- error / warn / info
  source     TEXT NOT NULL,         -- panel / site / process / network
  message    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_site ON events(site_id, created_at DESC);
`);

// ---------------------------------------------------------------------------
//  هر عبارتِ SQL فقط یک‌بار کامپایل می‌شود
//
//  `db.prepare()` هر بار که صدا زده شود، SQL را از نو کامپایل می‌کند. در جاهایی
//  که همان عبارت صدها بار در ثانیه اجرا می‌شود (اعلان‌ها، پیام‌رسان، بررسیِ
//  نشست در هر درخواست) همین کامپایلِ تکراری بیشتر از خودِ پرس‌وجو وقت می‌برد.
//  با این کمکی، عبارت یک‌بار ساخته و بعد فقط اجرا می‌شود.
// ---------------------------------------------------------------------------
const compiled = new Map();
// چند عبارت شکلِ متغیر دارند (مثلاً `IN (?,?,?)` به تعدادِ ورودی). سقف می‌گذاریم
// تا این حافظه در طولِ ماه‌ها بالا آمدنِ سرور بی‌سروصدا بزرگ نشود.
const MAX_COMPILED = 400;
export function q(sql) {
  let stmt = compiled.get(sql);
  if (!stmt) {
    if (compiled.size >= MAX_COMPILED) compiled.clear();
    stmt = db.prepare(sql);
    compiled.set(sql, stmt);
  }
  return stmt;
}

// ---------------------------------------------------------------------------
// کمکی‌های تنظیمات
// ---------------------------------------------------------------------------
const selSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const upSetting = db.prepare(
  'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export function getSetting(key, fallback = null) {
  const row = selSetting.get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  upSetting.run(key, JSON.stringify(value));
  return value;
}

export function allSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// ثبت رویداد/خطا — منبع بخش «آخرین خطاها» و لاگ‌ها
// ---------------------------------------------------------------------------
const insEvent = db.prepare(
  'INSERT INTO events(site_id, level, source, message, created_at) VALUES(?, ?, ?, ?, ?)'
);

export function logEvent(level, source, message, siteId = null) {
  try {
    insEvent.run(siteId, level, source, String(message).slice(0, 2000), Date.now());
  } catch { /* لاگ نباید برنامه را بخواباند */ }
}

// نگه‌داشتن حجم جدول رویدادها در حد معقول
export function pruneEvents(keep = 5000) {
  try {
    db.exec(
      `DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ${Number(keep)})`
    );
  } catch { /* بی‌خیال */ }
}
