/**
 * «برنامهٔ این پمپ روشن است؟» — **یک** قاعده برای فهرستِ پمپ‌ها و پروفایلِ هر پمپ.
 *
 * ⛔ تا ۱.۵۰.۸ فهرست فقط `liveAt` (زمانِ آخرین عکسِ زنده) را می‌سنجید و پروفایل
 * اتصالِ زنده را. برنامهٔ پمپ عکسِ **بی‌تغییر** را دوباره نمی‌فرستد، پس پمپی که
 * وصل بود ولی دو دقیقه چیزی ننوشته بود در فهرست «خبری نیست» و در پروفایلش
 * «برنامه روشن است» می‌گرفت — دو حقیقت برای یک پمپ.
 *
 * دو دقیقه سکوت یعنی خاموش؛ حلقهٔ برنامه هر ۲۰ ثانیه است، پس این مرز شش برابرِ
 * آن است و یک قطعیِ کوتاه پمپ را «مرده» نشان نمی‌دهد.
 */
export const LIVE_WINDOW_MS = 2 * 60 * 1000;

export type StationLiveSignals = {
  liveConnections?: number | null;
  lastActivity?: number | null;
  liveAt?: number | null;
};

export function stationOnline(s: StationLiveSignals, now = Date.now()): boolean {
  if ((s.liveConnections ?? 0) > 0) return true;
  const recent = (t?: number | null) => Boolean(t && now - t < LIVE_WINDOW_MS);
  return recent(s.lastActivity) || recent(s.liveAt);
}
