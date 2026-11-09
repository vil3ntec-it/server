// ---------------------------------------------------------------------------
//  💳 نشانیِ «اشتراک‌ها»ی هر برنامه — در بخشِ خودِ همان برنامه
//
//  دستورِ صاحب محصول (۱۴۰۵/۰۸/۰۹): «بخشِ جدای اشتراک‌ها حذف شود. اشتراکِ
//  تانک‌تیل (پمپ) در بخشِ پمپ، اشتراکِ فروشگاه در بخشِ فروشگاه. هیچ داده یا
//  قابلیتی از دست نرود؛ فقط جای نمایش و مدیریت عوض شود.»
//
//    پمپ      ⇒ `/stations?view=…&q=…#subs`        (زبانهٔ «💳 اشتراک‌ها»ی پمپ‌بنزین‌ها)
//    فروشگاه  ⇒ `/shop?tab=subs&view=…&q=…`        (زبانهٔ «اشتراک‌ها»ی فروشگاه‌ها)
//
//  ⛔ هر لینکِ داخلیِ اشتراک از همین‌جا ساخته می‌شود، نه با رشتهٔ دستی — و
//     نشانی‌های کهنه (`/subscriptions`، `/customers`، `/plans`، `/vip-codes`،
//     `/discounts`، `/visitors`، با `?app=`/`?tab=`/`?q=`) با `legacySubsTarget`
//     به همان‌جا می‌روند؛ هیچ نشانیِ ذخیره‌شده‌ای ۴۰۴ یا صفحهٔ خالی نمی‌شود.
//  ⚠️ این پرونده هیچ import و هیچ نحوِ غیرِ قابلِ‌حذفِ TypeScript ندارد:
//     `test/live-pages.mjs` همین فایل را مستقیم با Node اجرا و رفتارش را می‌سنجد.
// ---------------------------------------------------------------------------

export type SubsApp = 'pump' | 'shop';

/**
 *  زبانه‌های «اشتراک‌ها» در بخشِ هر برنامه. نام‌ها همان `?tab=`ِ بخشِ کهنه‌اند
 *  تا نشانیِ ذخیره‌شده به همان زبانه برسد.
 */
export const SUBS_VIEWS = ['subs', 'groups', 'plans', 'discounts', 'codes', 'requests', 'visitors', 'reps', 'sales'] as const;
export type SubsView = (typeof SUBS_VIEWS)[number];

/**
 *  زبانه‌هایی که فقط مالِ یک برنامه‌اند.
 *  ⛔ «درخواست‌های خرید» فقط دکان دارد: جدولِ `purchase_requests` ِ سرورِ حساب
 *     به `shops` بند است و پمپ چنین دری ندارد. «سه گروه» هم شمارشِ خودِ
 *     میزِ فروشگاه است (`/shop-desk/groups`).
 */
export function onlyAppOf(view: string): SubsApp | null {
  if (view === 'requests' || view === 'groups') return 'shop';
  return null;
}

function isView(view: string): boolean {
  return (SUBS_VIEWS as readonly string[]).includes(view);
}

/** زبانه‌های بخشِ یک برنامه، به همان ترتیبِ نمایش. */
export function viewsOf(app: SubsApp): SubsView[] {
  return SUBS_VIEWS.filter((v) => {
    const only = onlyAppOf(v);
    return !only || only === app;
  });
}

/** نشانیِ زبانهٔ «اشتراک‌ها» در بخشِ خودِ برنامه. زبانهٔ ناشناخته یا مالِ برنامهٔ دیگر ⇒ «اشتراک‌ها». */
export function subsPath(app: SubsApp, view = 'subs', q = ''): string {
  const only = onlyAppOf(view);
  const v = isView(view) && (!only || only === app) ? view : 'subs';
  const p = new URLSearchParams();
  if (app === 'shop') p.set('tab', 'subs');
  if (v !== 'subs') p.set('view', v);
  if (q) p.set('q', q);
  const qs = p.toString();
  return app === 'pump' ? `/stations${qs ? `?${qs}` : ''}#subs` : `/shop?${qs}`;
}

/**
 *  نشانیِ کهنهٔ بخشِ جدای اشتراک‌ها ⇒ نشانیِ تازه.
 *
 *  `defaultView` همان زبانه‌ای است که خودِ مسیرِ کهنه به آن می‌رفت
 *  (`/plans` ⇒ «plans»، `/vip-codes` ⇒ «codes»)؛ `?tab=` بر آن مقدم است.
 *  `null` یعنی برنامه معلوم نیست ⇒ صفحهٔ کوچکِ «کدام برنامه؟».
 */
export function legacySubsTarget(search: string, defaultView = 'subs'): string | null {
  const p = new URLSearchParams(search);
  const tab = p.get('tab') || '';
  const view = isView(tab) ? tab : isView(defaultView) ? defaultView : 'subs';
  const q = p.get('q') || '';
  const app = p.get('app');
  if (app === 'pump' || app === 'shop') return subsPath(app, view, q);
  const only = onlyAppOf(view);
  if (only) return subsPath(only, view, q);
  return null;
}
