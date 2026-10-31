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
  panelUsers: false,
};

/** آیا این بخش روشن است؟ */
export function featureOn(key: FeatureKey): boolean {
  return FEATURES[key];
}

/**
 *  قابلیت‌هایی که **سرور** می‌گوید روی این میزبان هستند یا نه
 *  (‎homelab-panel/server/src/deploy.js‎ — نمایهٔ استقرار، از ‎/api/auth/me‎).
 *
 *  روی کامپیوترِ خانه همه روشن‌اند؛ روی VPS/داکر درهای «کنترلِ کاملِ همین
 *  کامپیوتر» (ترمینال، فایل، دیتابیس، اجرای سایت‌ها) خاموش‌اند. خاموش یعنی
 *  نه در منو، نه با نشانیِ دستی — همان قاعدهٔ `FEATURES` بالا.
 *
 *  ⚠️ سرورِ قدیمی که این را نمی‌فرستد ⇒ همه روشن (همان رفتارِ پیشین).
 */
export type ServerFeature =
  | 'terminal' | 'files' | 'databases' | 'sites' | 'docker'
  | 'agent' | 'update' | 'discovery' | 'tunnel';

export type ServerFeatures = Partial<Record<ServerFeature, boolean>>;

export function serverFeatureOn(map: ServerFeatures | null, key: ServerFeature): boolean {
  return !map || map[key] !== false;
}
