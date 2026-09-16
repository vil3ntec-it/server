// ---------------------------------------------------------------------------
//  ══ پشتیبانِ هر پمپ روی سرورِ خانگی ═════════════════════════════════════════
//
//  خواستهٔ صریحِ صاحب ریپو (۱۴۰۵/۰۶/۲۶): «هر روز بک‌آپ بگیرد و بفرستد به سرورِ
//  برنامه، هر ۶ ساعت، و تا سه روز در سرور بماند؛ یعنی روزِ چهارم که آمد، آن
//  آخرین نسخهٔ بک‌آپ حذف و جدید جایگزین شود. و اگر بک‌آپ گرفته نشده یک پیام
//  به مدیر بدهد که بک‌آپ بگیرد یا نتش را وصل کند.»
//
//  فایلِ بک‌آپ خودِ دیتابیسِ SQLite است — خام و باینری، نه JSON. پس در شاخه‌های
//  دفترِ پمپ (که JSON‌اند) نمی‌نشیند و پوشهٔ خودش را دارد:
//
//      data/stations/<کد پمپ>/backups/pump-1405-06-26-1200.db
//
//  ⚠️ «سه روز» یعنی سه **روزِ تقویمی**، نه سه فایل: با هر ۶ ساعت یک‌بار، هر
//  روز چهار فایل می‌آید. قاعده روی نامِ روز حساب می‌شود (‎dayOf‎) تا روزِ
//  چهارم، کلِ روزِ اول برود — دقیقاً همان چیزی که خواسته شده.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** چند روزِ تقویمی روی سرور می‌ماند. */
export const KEEP_DAYS = 3;

/** بزرگ‌ترین فایلی که پذیرفته می‌شود — دیتابیسِ پنج‌سالهٔ پمپ ده‌ها مگابایت است. */
export const MAX_BYTES = 256 * 1024 * 1024;

export function backupDir(dataDir, code) {
  return path.join(dataDir, code, 'backups');
}

/**
 * روزِ یک فایل از روی نامش — ‎pump-1405-06-26-1200.db‎ ⇒ ‎1405-06-26‎.
 * نامِ ناشناس روزِ خودش می‌شود تا هرگز گم نشود و هرگز روزِ دیگری را نبرد.
 */
export function dayOf(name) {
  const m = /^pump-(\d{4}-\d{2}-\d{2})/.exec(String(name || ''));
  return m ? m[1] : String(name || '');
}

/** نامِ امن — هیچ‌وقت ‎/‎ یا ‎..‎ نمی‌گیرد، وگرنه بیرونِ پوشه نوشته می‌شد. */
export function safeName(value) {
  const raw = String(value || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  const name = raw.replace(/^[.-]+/, '').slice(0, 96);
  return name.endsWith('.db') ? name : (name || 'pump') + '.db';
}

/** فهرستِ پشتیبان‌های یک پمپ، از تازه به کهنه. */
export function listBackups(dataDir, code) {
  const dir = backupDir(dataDir, code);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.db')) continue;
    let st;
    try { st = fs.statSync(path.join(dir, name)); } catch { continue; }
    out.push({ name, day: dayOf(name), bytes: st.size, at: st.mtime.toISOString() });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * کهنه‌ها را می‌برد: فقط <see cref="KEEP_DAYS"/> روزِ تازه می‌ماند.
 * برمی‌گرداند چند فایل رفت.
 */
export async function pruneBackups(dataDir, code, keepDays = KEEP_DAYS) {
  const list = listBackups(dataDir, code);
  const days = [...new Set(list.map((x) => x.day))].sort().reverse();
  const keep = new Set(days.slice(0, Math.max(1, keepDays)));
  let gone = 0;
  for (const item of list) {
    if (keep.has(item.day)) continue;
    try {
      await fsp.unlink(path.join(backupDir(dataDir, code), item.name));
      gone++;
    } catch { /* رفته بود */ }
  }
  return gone;
}

/**
 * نوشتنِ یک پشتیبانِ تازه و بردنِ کهنه‌ها.
 * ⚠️ اول در فایلِ موقت نوشته می‌شود و بعد جابه‌جا: اگر شبکه وسطِ کار قطع شود،
 * یک فایلِ نیمه‌کاره جای پشتیبانِ سالمِ همان روز را نمی‌گیرد.
 */
export async function saveBackup(dataDir, code, name, bytes) {
  const dir = backupDir(dataDir, code);
  await fsp.mkdir(dir, { recursive: true });
  const file = safeName(name);
  const tmp = path.join(dir, '.' + file + '.part');
  await fsp.writeFile(tmp, bytes);
  await fsp.rename(tmp, path.join(dir, file));
  const pruned = await pruneBackups(dataDir, code);
  return { name: file, day: dayOf(file), bytes: bytes.length, pruned };
}
