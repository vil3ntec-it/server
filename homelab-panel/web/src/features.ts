/**
 *  کلیدِ روشن/خاموشِ بخش‌های پنل.
 *
 *  هر کلیدی که اینجا false باشد، آن بخش نه در منو دیده می‌شود و نه آدرسش
 *  باز می‌شود — اگر کسی آدرس را دستی بزند، به صفحهٔ نخست برمی‌گردد.
 *
 *  چرا اینجا و نه پاک‌کردنِ کد: صفحه‌ها و APIهایشان دست‌نخورده سرِ جایشان
 *  می‌مانند، پس برگرداندنِ هر کدام فقط عوض‌کردنِ همین یک `false` است و
 *  هیچ چیزِ دیگری لازم نیست.
 */
export type FeatureKey =
  | 'commandCenter' // مرکز فرمان — صفحهٔ /control
  | 'settings'      // تنظیمات — صفحهٔ /settings
  | 'files'         // فایل‌ها — صفحهٔ /files
  | 'panelUsers';   // کاربران پنل — صفحهٔ /control/panel-users

export const FEATURES: Record<FeatureKey, boolean> = {
  commandCenter: false,
  settings: false,
  files: false,
  /*
   *  ⛔ روشن (۱۴۰۵/۰۸/۰۹، فاز ۱ ِ ممیزی، ۶-۲): پشتِ این صفحه فقط `/api/auth/users`
   *  است و هر قاعده‌اش در سرور (فقط admin، مالک دست‌نخوردنی، خودت نه، آخرین مدیر،
   *  احرازِ دوباره). پنهان کردنش امنیت نبود — API زنده بود؛ فقط مالک رابطی نداشت.
   */
  panelUsers: true,
};

/** آیا این بخش روشن است؟ */
export function featureOn(key: FeatureKey): boolean {
  return FEATURES[key];
}
