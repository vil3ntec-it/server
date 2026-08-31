// ---------------------------------------------------------------------------
//  مهاجرتِ اسکیمای دیتابیس — شماره‌دار، یک‌طرفه، در تراکنش
//
//  چرا لازم شد: تا دیروز اسکیما یک بلوکِ «CREATE TABLE IF NOT EXISTS» بود.
//  آن دستور روی دیتابیسی که جدول را از قبل دارد **هیچ کاری نمی‌کند** — پس
//  افزودنِ یک ستونِ تازه روی نصب‌های قدیمی اتفاق نمی‌افتاد و کدِ جدید با
//  ستونِ گم‌شده می‌شکست. حالا هر تغییر یک مهاجرتِ شماره‌دار است که یک‌بار
//  اجرا و ثبت می‌شود.
//
//  چرا down-migration نداریم: بازگرداندنِ خودکارِ اسکیما روی دادهٔ واقعی
//  بیشتر از آنکه نجات بدهد خرابی می‌سازد. راهِ برگشتِ ما بازگردانیِ بکاپ است
//  که درست پیش از اجرای مهاجرت‌ها گرفته می‌شود.
// ---------------------------------------------------------------------------
import { migrations } from './migrations/index.js';

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

export function appliedVersions(db) {
  ensureTable(db);
  return new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
}

export function currentVersion(db) {
  ensureTable(db);
  return db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
}

/** مهاجرت‌هایی که هنوز اجرا نشده‌اند، به ترتیبِ شماره */
export function pendingMigrations(db) {
  const done = appliedVersions(db);
  return migrations.filter((m) => !done.has(m.version)).sort((a, b) => a.version - b.version);
}

/**
 * همهٔ مهاجرت‌های باقی‌مانده را اجرا می‌کند.
 * @param {object} db دیتابیسِ باز
 * @param {object} [opts]
 * @param {(pending: object[]) => void} [opts.beforeAll] پیش از اولین مهاجرت — جای بکاپ
 * @param {(msg: string) => void} [opts.log]
 */
export function runMigrations(db, opts = {}) {
  const log = opts.log || (() => {});
  const pending = pendingMigrations(db);
  if (!pending.length) return { applied: [], version: currentVersion(db) };

  // بکاپِ «قبل از مهاجرت» — تنها راهِ برگشتِ ما. اگر نگرفت جلوی مهاجرت را
  // نمی‌گیریم (نصبِ تازه اصلاً چیزی برای بکاپ ندارد) ولی حتماً لاگ می‌شود.
  try {
    opts.beforeAll?.(pending);
  } catch (e) {
    log(`⚠️  بکاپِ پیش از مهاجرت گرفته نشد — ${e.message}`);
  }

  const applied = [];
  const record = db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES(?, ?, ?)');

  for (const m of pending) {
    // هر مهاجرت اتمی است: یا کامل اعمال می‌شود یا هیچ.
    db.exec('BEGIN');
    try {
      m.up(db);
      record.run(m.version, m.name, Date.now());
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch { /* تراکنش از قبل بسته شده */ }
      throw new Error(`مهاجرتِ ${String(m.version).padStart(3, '0')}_${m.name} ناموفق بود: ${e.message}`);
    }
    applied.push(m.version);
    log(`مهاجرتِ ${String(m.version).padStart(3, '0')} «${m.name}» اعمال شد`);
  }

  return { applied, version: currentVersion(db) };
}

/** آیا ستونی در جدول هست؟ — کمکیِ پرمصرف در مهاجرت‌ها */
export function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch {
    return false;
  }
}
