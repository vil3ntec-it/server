// ---------------------------------------------------------------------------
//  «در نبودِ من هم همه‌کار را خودش بکند» — سه قاعدهٔ کارِ بی‌حضور
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۵): «آپدیتی که میاد درجا دانلود کنه و برنامه
//  رو دوباره اجرا کنه… وقتی کامپیوتر رو روشن می‌کنم خودش باز بشه… اگه نبودم
//  هم همه‌کار رو خودش بکنه.»
//
//      ۱) روشن شدن با ویندوز      ⇒ loginItemPlan
//      ۲) سرورِ افتاده برمی‌گردد   ⇒ restartDelay
//      ۳) به‌روزرسانیِ نشسته ⇒ برنامه خودش دوباره باز می‌شود (main-impl.js)
//
//  ⛔ هر سه تصمیم این‌جا **خالص**‌اند (بی Electron) تا آزمون بی پنجره بسنجدشان.
// ---------------------------------------------------------------------------

/** پرچمی که ویندوز هنگامِ ورود به برنامه می‌دهد — یعنی «کسی کلیک نکرده» */
export const AUTOSTART_ARG = '--autostart';

/**
 * روشن شدن با ویندوز: چه چیزی به `app.setLoginItemSettings` برود، یا ‎null‎.
 *
 * ⛔ پیش‌فرض **روشن** است (`autoStart !== false`) — خاموشش فقط با دکمهٔ
 *    «روشن با ویندوز» در نوارِ بالا.
 * ⛔ نسخهٔ قابل‌حمل از پوشهٔ موقت اجرا می‌شود و آن پوشه با هر اجرا عوض
 *    می‌شود؛ پس مسیرِ ثبت‌شده باید خودِ فایلِ ‎.exe‎ی قابل‌حمل باشد
 *    (`PORTABLE_EXECUTABLE_FILE`)، وگرنه ویندوز فردا صبح چیزی را اجرا می‌کند
 *    که دیگر نیست.
 * ⚠️ لینوکس `setLoginItemSettings` ندارد (کارِ systemd است)؛ و اجرای توسعه
 *    (`electron .`) هیچ‌وقت خودش را در ورودِ ویندوز نمی‌نویسد.
 */
export function loginItemPlan({ platform, isPackaged, settings = {}, execPath, portableFile = null }) {
  if (platform !== 'win32' && platform !== 'darwin') return null;
  if (!isPackaged) return null;
  const enabled = settings.autoStart !== false;
  const target = portableFile || execPath;
  if (!target) return null;
  return { openAtLogin: enabled, path: target, args: [AUTOSTART_ARG] };
}

/**
 * سرورِ افتاده چند ثانیهٔ دیگر دوباره بالا بیاید.
 *
 * ⛔ **هرگز دست نمی‌کشد** — کسی پای کامپیوتر نیست که دکمه بزند. فقط فاصله
 *    زیاد می‌شود (۲ ⇒ ۴ ⇒ ۸ ⇒ ۱۶ ⇒ ۳۲ ⇒ ۶۰ ثانیه) تا سرورِ خرابی که همان لحظه
 *    می‌افتد کامپیوتر را داغ نکند.
 */
export const RESTART_MAX_MS = 60_000;
export function restartDelay(attempt) {
  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  return Math.min(RESTART_MAX_MS, 1000 * 2 ** n);
}

/** سروری که این‌قدر سالم ماند، شمارندهٔ افتادن‌هایش از صفر شروع می‌شود */
export const HEALTHY_RESET_MS = 2 * 60_000;

/**
 * نشانهٔ «به‌روزرسانی نشست» تازه است و باید برنامه دوباره باز شود؟
 * ⛔ فقط وقتی `autoRelaunch !== false` و نشانه واقعاً **بعد از** آخرین دیده‌شده
 *    نوشته شده — وگرنه هر باز شدنِ برنامه با نشانهٔ کهنه، حلقهٔ بی‌پایانِ
 *    بسته و باز شدن می‌ساخت.
 */
export function shouldRelaunch(applied, seenAt, settings = {}) {
  if (settings.autoRelaunch === false) return false;
  const at = Number(applied?.at) || 0;
  return at > (Number(seenAt) || 0);
}
