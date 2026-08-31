// ---------------------------------------------------------------------------
//  گرفتنِ نسخهٔ سازگار از دیتابیس SQLite
//
//  چرا کپیِ سادهٔ فایل کافی نیست: دیتابیس در حالتِ WAL کار می‌کند، یعنی
//  تراکنش‌های تازه هنوز در panel.db نیستند و در فایلِ panel.db-wal منتظرند.
//  کپیِ خامِ panel.db یک دیتابیسِ **نیمه‌کاره** می‌دهد که ممکن است ساعت‌ها
//  دادهٔ آخر را نداشته باشد — و بدترین نوعِ بکاپ همان است که فکر می‌کنی داری.
//
//  «VACUUM INTO» یک نسخهٔ کامل، سازگار و فشرده می‌سازد بدونِ اینکه نویسنده‌ها
//  را قفل کند.
//
//  ⚠️ این ماژول عمداً db.js را import نمی‌کند و دیتابیس را به‌صورت پارامتر
//     می‌گیرد: خودِ db.js برای بکاپِ پیش از مهاجرت به آن نیاز دارد و اگر
//     دو طرف همدیگر را import کنند، حلقهٔ وابستگی درست می‌شود.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

/** نامِ فایلِ بکاپ: مرتب‌شونده بر اساس زمان، بدونِ کاراکترِ ممنوعِ ویندوز */
export function backupFileName(reason = 'manual', at = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  const safe = String(reason).replace(/[^a-z0-9-]/gi, '') || 'manual';
  return `panel-${stamp}-${safe}.db`;
}

/**
 * یک نسخهٔ سازگار از دیتابیس در مسیرِ داده‌شده می‌سازد.
 * @returns {{ file: string, sizeBytes: number }}
 */
export function vacuumInto(db, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  // اگر فایلی با همین نام باشد VACUUM INTO خطا می‌دهد — پس اول پاکش می‌کنیم
  fs.rmSync(targetPath, { force: true });

  // مسیر داخلِ رشتهٔ SQL می‌رود، پس تک‌کوتیشن باید escape شود
  db.exec(`VACUUM INTO '${String(targetPath).replace(/'/g, "''")}'`);

  const sizeBytes = fs.statSync(targetPath).size;
  return { file: path.basename(targetPath), path: targetPath, sizeBytes };
}
