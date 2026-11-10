// ---------------------------------------------------------------------------
//  ══ پوشهٔ داده ‎700‎ و ‎panel.db‎ ‎600‎ (۱.۵۰.۸۵) — فقط لینوکس/مک ══
//
//  یافته (تصمیمِ ۱.۵۰.۸۴): پوشهٔ داده و `panel.db` با umask ِ پیش‌فرض ساخته می‌شدند
//  (معمولاً ۷۵۵/۶۴۴) ⇒ هر کاربرِ دیگرِ همان سیستم پایگاهِ پنل را می‌خواند: درهمِ رمزها،
//  نشست‌ها، دفتر، و رازِ امضای نشست (`jwt_secret`، وقتی ‎HLP_SECRET_KEY‎ نیست) — یعنی
//  جعلِ توکنِ مدیر. رازهای تکی خودشان ۶۰۰ بودند (`vault.key`، `local-admin.key`).
//
//  ⛔ قاعده:
//    • پوشهٔ داده با ‎700‎ ساخته می‌شود؛ پایگاه **پیش از** SQLite با ‎600‎ (پروندهٔ خالی همان
//      پایگاهِ تازه است) ⇒ SQLite پرونده‌های ‎-wal‎/‎-shm‎ را با همان دسترسیِ پایگاه می‌سازد.
//    • نصبِ موجود در هر بالا آمدن **فقط تنگ** می‌شود: بیت‌های گروه/دیگران برداشته می‌شوند
//      (پوشه ‎& 0700‎، پرونده ‎& 0600‎) و هیچ بیتی هرگز افزوده نمی‌شود — ‎500‎/‎400‎ همان می‌ماند.
//    • ویندوز: دست نمی‌زنیم (ACL ِ پوشهٔ کاربر؛ ‎chmod‎ آن‌جا معنای دیگری دارد).
//    • هیچ شکستی پنل را نمی‌خواباند: پوشه‌ای که مالِ کاربرِ دیگری است (‎EPERM‎، مثلاً volume ِ
//      داکر با مالکِ دیگر) فقط یک هشدار می‌گیرد — پنل همان‌طور که امروز کار می‌کرد کار می‌کند.
// ---------------------------------------------------------------------------
import fs from 'node:fs';

const DIR_MAX = 0o700;
const FILE_MAX = 0o600;

/** بیت‌هایی بیرون از سقف را برمی‌دارد؛ هرگز بیتی نمی‌افزاید. ‎null‎ یعنی «همان خوب است» یا «نیست». */
function tighten(file, max, report) {
  let st;
  try { st = fs.statSync(file); } catch { return; }
  const now = st.mode & 0o777;
  const next = now & max;
  if (next === now) return;
  try {
    fs.chmodSync(file, next);
    report.tightened.push({ file, from: now.toString(8), to: next.toString(8) });
  } catch (e) {
    report.failed.push({ file, code: e.code || 'error' });
  }
}

/**
 * @param {{ dataDir: string, dbFile: string, platform?: string }} o
 * @returns {{ skipped?: true, tightened: {file:string,from:string,to:string}[], failed: {file:string,code:string}[] }}
 */
export function tightenDataPerms({ dataDir, dbFile, platform = process.platform }) {
  const report = { tightened: [], failed: [] };
  if (platform === 'win32') return { skipped: true, ...report };
  fs.mkdirSync(dataDir, { recursive: true, mode: DIR_MAX });
  tighten(dataDir, DIR_MAX, report);
  //  پایگاهِ تازه با ‎600‎، پیش از آن‌که SQLite با umask بسازدش (‎wx‎: پروندهٔ موجود دست نمی‌خورد)
  try { fs.closeSync(fs.openSync(dbFile, 'wx', FILE_MAX)); } catch { /* هست، یا پوشه نوشتنی نیست — SQLite خودش می‌گوید */ }
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`, `${dbFile}-journal`]) tighten(f, FILE_MAX, report);
  return report;
}
