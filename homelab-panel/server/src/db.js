// ---------------------------------------------------------------------------
// دیتابیس SQLite پنل (با SQLite داخلی خود Node — بدون کامپایل و بدون وابستگی)
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { paths } from './config.js';
import { runMigrations } from './db/migrate.js';
import { vacuumInto, backupFileName, applyPendingRestore } from './backup/sqlite.js';

// ماژول‌های ESM قبل از کد index اجرا می‌شوند، پس پوشه‌ها را همین‌جا می‌سازیم
fs.mkdirSync(path.dirname(paths.db), { recursive: true });
fs.mkdirSync(paths.backups, { recursive: true });

// بازگردانیِ در انتظار باید **پیش از** باز شدنِ دیتابیس اعمال شود؛ فایلِ
// بازِ در حالِ استفاده را نمی‌شود زیرِ پای خودمان عوض کرد.
const restored = applyPendingRestore(paths.db);
if (restored?.restored) console.log('[دیتابیس] بکاپ بازگردانده شد');
else if (restored?.error) console.error(`[دیتابیس] بازگردانی ناموفق بود: ${restored.error}`);

export const db = new DatabaseSync(paths.db);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ---------------------------------------------------------------------------
//  اسکیما از راهِ مهاجرت‌های شماره‌دار ساخته می‌شود، نه یک بلوکِ ثابت.
//  دلیلش در src/db/migrate.js نوشته شده. پیش از اولین مهاجرتِ اجرانشده یک
//  بکاپ گرفته می‌شود — تنها راهِ برگشت اگر مهاجرتی بد از آب درآمد.
// ---------------------------------------------------------------------------
/**
 * آیا این دیتابیس خالیِ خالی است؟
 *
 * شمارهٔ اسکیما برای این کار به درد نمی‌خورد: نصب‌های قدیمی هم شمارهٔ ۰
 * دارند، چون جدولِ schema_migrations تازه اضافه شده. اگر بر اساس شماره
 * تصمیم می‌گرفتیم، دقیقاً همان دیتابیس‌هایی که داده دارند بی‌بکاپ می‌ماندند.
 * پس به‌جای شماره، وجودِ جدولِ واقعی را می‌بینیم.
 */
function isFreshDatabase(handle) {
  const n = handle
    .prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'`
    )
    .get().n;
  return n === 0;
}

export const schemaVersion = (() => {
  const fresh = isFreshDatabase(db);

  const result = runMigrations(db, {
    log: (msg) => console.log(`[دیتابیس] ${msg}`),
    beforeAll: () => {
      // نصبِ تازه چیزی برای از دست دادن ندارد
      if (fresh) return;
      const target = path.join(paths.backups, backupFileName('premigration'));
      const { sizeBytes } = vacuumInto(db, target);
      console.log(
        `[دیتابیس] بکاپِ پیش از مهاجرت: ${path.basename(target)} (${Math.round(sizeBytes / 1024)} کیلوبایت)`
      );
    },
  });

  if (result.applied.length) {
    console.log(`[دیتابیس] اسکیما روی نسخهٔ ${result.version} است (${result.applied.length} مهاجرتِ تازه)`);
  }
  return result.version;
})();


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
