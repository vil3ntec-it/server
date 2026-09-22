// ---------------------------------------------------------------------------
//  شناختنِ یک پوشهٔ سرورِ حساب — بی هیچ وابستگی
//
//  ⛔ این سه تابع عمداً در ماژولِ **خودشان** نشسته‌اند و نه در ناظر یا در
//  به‌روزرسان: هر دو به آن‌ها نیاز دارند و اگر در یکی می‌بودند، آن دو
//  ماژول همدیگر را import می‌کردند (حلقه). و دو نسخهٔ جدا یعنی روزی ناظر
//  پوشه‌ای را سالم می‌داند که به‌روزرسان ناقص می‌شمارد.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

/** آیا این پوشه واقعاً یک سرورِ حسابِ قابلِ اجراست؟ */
export function usable(dir) {
  if (!dir) return false;
  try {
    return fs.existsSync(path.join(dir, 'src', 'index.js'))
        && fs.existsSync(path.join(dir, 'node_modules'));
  } catch { return false; }
}

/** نسخهٔ سرورِ حسابی که در این پوشه است — یا `''`. */
export function versionAt(dir) {
  if (!dir) return '';
  try {
    return String(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || '').trim();
  } catch { return ''; }
}

/**
 * `a` از `b` تازه‌تر است؟
 *
 * ⚠️ **رشته‌ای مقایسه نکنید**: «۲.۱۰.۰» از «۲.۹.۰» تازه‌تر است ولی در
 * الفبا کوچک‌تر — و همان یک اشتباه یعنی به‌روزرسانی‌ای که هیچ‌وقت
 * پیشنهاد نمی‌شود و کسی هم نمی‌فهمد چرا.
 */
export function newer(a, b) {
  const p = (v) => String(v || '').split('.').map((x) => Number.parseInt(x, 10) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

/**
 * ══ کدام پوشهٔ سرورِ حساب برنده است ════════════════════════════════════════
 *
 * سه جا ممکن است سرورِ حساب باشد و ترتیبشان یک تصمیم است، نه سلیقه:
 *
 *   1. `forced`     — مسیرِ صریحِ خودِ صاحبِ سرور. همیشه جلوتر.
 *   2. `bundled`    — آن‌چه با فایلِ نصب آمده.
 *   3. `downloaded` — آن‌چه خودِ پنل گرفته (`<dataDir>/account-server/app`).
 *
 * ⛔ **بینِ ۲ و ۳، تازه‌تر برنده است — نه پوشهٔ ثابت.** تا ۱.۵۰.۵ پوشهٔ
 * دانلودی آخرین گزینه بود و فقط وقتی به آن می‌رسیدیم که بسته‌ای در کار
 * نباشد، یعنی روی هر نصبِ واقعی **هیچ‌وقت**. نتیجه: کدِ سرورِ حساب در
 * لحظهٔ ساختِ نصاب یخ می‌زد.
 *
 * ⚠️ و نصبِ تازهٔ مرکز فرمان خودش از پوشهٔ دانلودی جلو می‌زند، چون نسخهٔ
 * بالاتری می‌آورد. پس هیچ‌کدام دیگری را قفل نمی‌کند.
 *
 * ⚠️ این تابع عمداً **مسیر** می‌گیرد و نه تنظیمات: همین است که
 * سنجیدنش را بی بالا آوردنِ پنل ممکن می‌کند.
 */
export function pickDir({ forced = '', bundled = [], downloaded = '' } = {}) {
  if (usable(forced)) return forced;
  const b = bundled.find(usable) || null;
  if (usable(downloaded)) {
    if (!b) return downloaded;
    return newer(versionAt(downloaded), versionAt(b)) ? downloaded : b;
  }
  return b;
}
