// ---------------------------------------------------------------------------
//  نسخه‌بندیِ دیتابیس
//
//  تا حالا هر ماژول جدولِ خودش را با CREATE TABLE IF NOT EXISTS می‌ساخت و
//  ستونِ تازه را با ALTER TABLE اضافه می‌کرد. برای شروع خوب بود، ولی:
//    • معلوم نبود این دیتابیس کدام نسخه است
//    • اگر دو تغییر پشتِ سر هم لازم بود، ترتیبش تضمین نداشت
//    • اگر وسطِ کار برق می‌رفت، نصفه می‌ماند
//
//  حالا یک شمارهٔ نسخه در دیتابیس هست و هر تغییر، یک قدمِ شماره‌دار که
//  داخلِ یک تراکنش اجرا می‌شود: یا کامل انجام می‌شود یا اصلاً.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { paths } from '../config.js';

/**
 * قدم‌های مهاجرت. هرگز شمارهٔ قدیمی را عوض نکنید و قدمِ تازه را ته‌ِ فهرست
 * اضافه کنید — دیتابیس‌هایی که از قبل هستند فقط قدم‌های نرفته را می‌روند.
 */
const STEPS = [
  {
    id: 1,
    name: 'پایه — جدول‌هایی که ماژول‌ها خودشان می‌سازند',
    up() {
      // جدول‌های پایه در db.js و ماژول‌ها ساخته می‌شوند؛ این قدم فقط
      // نقطهٔ شروع را ثبت می‌کند تا نصب‌های قدیمی از این‌جا جلو بروند.
    },
  },
  {
    id: 2,
    name: 'دفترِ کارهای حساس (audit log)',
    up() {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          at         INTEGER NOT NULL,
          actor      TEXT NOT NULL,     -- panel:mirza · local-app · app:shop
          action     TEXT NOT NULL,     -- login · file.delete · client.key …
          target     TEXT,
          ip         TEXT,
          ok         INTEGER NOT NULL DEFAULT 1,
          detail     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, at DESC);
      `);
    },
  },
];

export const LATEST = STEPS[STEPS.length - 1].id;

function currentVersion() {
  try {
    return Number(db.prepare('PRAGMA user_version').get().user_version) || 0;
  } catch {
    return 0;
  }
}

function setVersion(version) {
  db.exec(`PRAGMA user_version = ${Number(version)}`);
}

/** یک کپیِ سالم پیش از اولین تغییر — تا اگر چیزی شد، برگشتی باشد */
function backupBefore(version) {
  try {
    const source = paths.db;
    if (!fs.existsSync(source)) return null;
    const dir = path.join(path.dirname(source), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `panel-v${version}-${Date.now()}.db`);
    fs.copyFileSync(source, target);

    // فقط پنج کپیِ آخر می‌ماند
    const old = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('panel-v') && f.endsWith('.db'))
      .sort()
      .reverse()
      .slice(5);
    for (const name of old) {
      try {
        fs.rmSync(path.join(dir, name), { force: true });
      } catch { /* بی‌خیال */ }
    }
    return target;
  } catch {
    return null;
  }
}

/**
 * قدم‌های نرفته را می‌رود. اگر قدمی خطا داد، همان قدم برمی‌گردد و نسخه
 * جلو نمی‌رود — پس دفعهٔ بعد دوباره تلاش می‌شود.
 */
export function runMigrations() {
  const from = currentVersion();
  const pending = STEPS.filter((s) => s.id > from);
  if (pending.length === 0) return { from, to: from, ran: [] };

  const backup = from > 0 ? backupBefore(from) : null;
  const ran = [];

  for (const step of pending) {
    try {
      db.exec('BEGIN');
      step.up();
      setVersion(step.id);
      db.exec('COMMIT');
      ran.push({ id: step.id, name: step.name });
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch { /* تراکنش باز نبود */ }
      return { from, to: currentVersion(), ran, failed: { id: step.id, error: e.message }, backup };
    }
  }
  return { from, to: currentVersion(), ran, backup };
}

export function dbVersion() {
  return { current: currentVersion(), latest: LATEST };
}
