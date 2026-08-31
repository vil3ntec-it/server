// ---------------------------------------------------------------------------
//  بکاپ و بازگردانی
//
//  چه چیزی بکاپ می‌شود: دیتابیسِ پنل (کاربران، سایت‌ها، دامنه‌ها، تنظیمات،
//  رویدادها). فایل‌های خودِ سایت‌ها این‌جا نیستند — آن‌ها گیگابایت‌اند و
//  جایشان یک ابزارِ همگام‌سازیِ فایل است، نه یک ستونِ دیتابیس.
//
//  چرا VACUUM INTO و نه کپیِ فایل: توضیحش در backup/sqlite.js است (خلاصه:
//  در حالتِ WAL کپیِ خام یک نسخهٔ نیمه‌کاره می‌دهد).
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { db, logEvent } from '../db.js';
import { config, paths } from '../config.js';
import { vacuumInto, backupFileName, verifyBackup } from './sqlite.js';

const REASONS = ['manual', 'scheduled', 'premigration', 'prerestore'];

function record(entry) {
  try {
    db.prepare(
      'INSERT INTO backups(file, reason, size_bytes, created_at, ok, note) VALUES(?, ?, ?, ?, ?, ?)'
    ).run(entry.file, entry.reason, entry.sizeBytes, entry.createdAt, entry.ok ? 1 : 0, entry.note ?? null);
  } catch { /* دفتر نباید جلوی خودِ بکاپ را بگیرد */ }
}

/** یک بکاپِ تازه می‌گیرد و در دفتر ثبت می‌کند */
export function createBackup({ reason = 'manual', note = null } = {}) {
  const safeReason = REASONS.includes(reason) ? reason : 'manual';
  const target = path.join(paths.backups, backupFileName(safeReason));
  const { file, sizeBytes } = vacuumInto(db, target);
  const entry = { file, reason: safeReason, sizeBytes, createdAt: Date.now(), ok: true, note };
  record(entry);
  pruneBackups();
  return entry;
}

/**
 * فهرستِ بکاپ‌ها — منبعِ حقیقت خودِ دیسک است، نه دفتر.
 * اگر کسی فایلی را دستی پاک کند، نباید در پنل «موجود» نشان داده شود.
 */
export function listBackups() {
  let files = [];
  try {
    files = fs.readdirSync(paths.backups).filter((f) => f.endsWith('.db'));
  } catch {
    return [];
  }

  const notes = new Map(
    db.prepare('SELECT file, reason, note, created_at FROM backups').all().map((r) => [r.file, r])
  );

  return files
    .map((file) => {
      const full = path.join(paths.backups, file);
      const stat = fs.statSync(full);
      const meta = notes.get(file);
      return {
        file,
        sizeBytes: stat.size,
        createdAt: meta?.created_at ?? stat.mtimeMs,
        reason: meta?.reason ?? guessReason(file),
        note: meta?.note ?? null,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function guessReason(file) {
  const m = file.match(/-([a-z]+)\.db$/);
  return m && REASONS.includes(m[1]) ? m[1] : 'manual';
}

/**
 * نگه‌داشتنِ N نسخهٔ آخر.
 *
 * بکاپ‌های «پیش از مهاجرت» عمداً از این قاعده مستثنا هستند: آن‌ها تنها راهِ
 * برگشت از یک مهاجرتِ بد هستند و ممکن است ماه‌ها بعد لازم شوند، وقتی که
 * ده‌ها بکاپِ روزانه از رویشان رد شده است.
 */
export function pruneBackups(keep = config.backupKeep) {
  const all = listBackups();
  const disposable = all.filter((b) => b.reason !== 'premigration');
  const extra = disposable.slice(Math.max(0, keep));

  const removed = [];
  for (const b of extra) {
    try {
      fs.rmSync(path.join(paths.backups, b.file), { force: true });
      db.prepare('DELETE FROM backups WHERE file = ?').run(b.file);
      removed.push(b.file);
    } catch { /* بعداً دوباره تلاش می‌شود */ }
  }
  return removed;
}

/**
 * بازگردانی.
 *
 * دیتابیسِ باز را نمی‌شود زیرِ پای خودمان عوض کرد، پس فایل کنارِ دیتابیسِ
 * فعلی گذاشته می‌شود و در راه‌اندازیِ بعدی جای آن را می‌گیرد. این عمدی است:
 * بازگردانیِ داغ یعنی نیمی از پروسه با دادهٔ قدیم کار کند و نیمی با جدید.
 *
 * پیش از هر بازگردانی یک بکاپِ «prerestore» گرفته می‌شود — اگر معلوم شد
 * بکاپِ اشتباهی را برگردانده‌ایم، راهِ برگشت باز است.
 */
export function restoreBackup(file) {
  const safe = path.basename(String(file || ''));
  if (!safe.endsWith('.db') || safe.includes('..')) {
    return { ok: false, error: 'invalid_file' };
  }
  const source = path.join(paths.backups, safe);
  if (!fs.existsSync(source)) return { ok: false, error: 'not_found' };

  // سالم بودنِ فایل پیش از هر کاری بررسی می‌شود
  const check = verifyBackup(source);
  if (!check.ok) return { ok: false, error: 'corrupt_backup', detail: check.error };

  let safetyCopy = null;
  try {
    safetyCopy = createBackup({ reason: 'prerestore', note: `پیش از بازگردانیِ ${safe}` });
  } catch (e) {
    return { ok: false, error: 'safety_backup_failed', detail: e.message };
  }

  // فایلِ در انتظار: در راه‌اندازیِ بعدی جایگزین می‌شود
  const pending = `${paths.db}.restore`;
  fs.copyFileSync(source, pending);

  logEvent('warn', 'panel', `بازگردانیِ بکاپ «${safe}» زمان‌بندی شد؛ با راه‌اندازیِ بعدی اعمال می‌شود`);
  return { ok: true, pending: true, file: safe, safetyCopy: safetyCopy.file };
}

export { verifyBackup, applyPendingRestore } from './sqlite.js';
