/* ---------------------------------------------------------------------------
 *  زنده بودنِ صفحه‌ها — «چه چیزی عوض شد»، نه نبضِ کور
 *
 *  گزارشِ صاحب ریپو: «توی همون بخش مد نظر استم و هیچی نمیاد؛ باید از اون
 *  بخش بیرون بشم یا از برنامه تا دوباره بیام و ببینم.»
 *
 *  ریشه: هر صفحه یا `setInterval`ِ خودش را داشت (۲٫۵ تا ۶۰ ثانیه) یا هیچ.
 *  صفحه‌ای که نداشت تا رفتن و برگشتن هیچ‌وقت تازه نمی‌شد.
 *
 *  ⛔ **و این کم‌فشارتر از قبل است، نه پرفشارتر.** پیش از این هر تبِ باز
 *  هر چند ثانیه یک درخواست می‌زد، چه چیزی عوض شده باشد چه نه. حالا تا
 *  سرور نگوید «عوض شد»، **هیچ** درخواستی زده نمی‌شود.
 * ------------------------------------------------------------------------- */
import { useEffect, useRef } from 'react';
import { useApp } from './app-context';

export type LiveTopic =
  | 'sites' | 'automation' | 'logs' | 'stations' | 'agent' | 'backups' | 'cron' | 'settings'
  | 'codes' | 'logins' | 'support' | 'customers' | 'plans' | 'notices' | 'sales' | 'sync';

/**
 *  «هر وقت این موضوع عوض شد، این را دوباره بخوان.»
 *
 *  @param topic  موضوعی که این صفحه به آن بند است
 *  @param reload کاری که باید دوباره انجام شود — معمولاً همان `load`ِ صفحه
 *  @param fallbackMs  تورِ ایمنی برای وقتی سوکت قطع است. `0` یعنی هیچ.
 */
export function useLive(topic: LiveTopic | LiveTopic[], reload: () => void, fallbackMs = 0) {
  const { socket } = useApp();

  /*
   *  ⚠️ `reload` در هر رندر یک تابعِ تازه است. اگر مستقیم در وابستگی‌ها
   *  بنشیند، این اثر با هر رندر شنونده را باز و بسته می‌کند — و یک بار
   *  همین الگو در این ریپو یک نشتِ واقعی ساخت. با ref، شنونده یک بار
   *  بسته می‌شود و همیشه تازه‌ترین تابع را صدا می‌زند.
   */
  const fn = useRef(reload);
  fn.current = reload;

  const topics = Array.isArray(topic) ? topic : [topic];
  const key = topics.join(',');

  useEffect(() => {
    //  بی موضوع، این هوک باید کاملاً بی‌اثر باشد — نه شنونده‌ای، نه تایمری
    if (!key) return;
    const want = new Set(key.split(','));

    const onChanged = (msg: { topic?: string }) => {
      if (msg && msg.topic && want.has(msg.topic)) fn.current();
    };
    socket?.on('changed', onChanged);

    /*
     *  ⚠️ سوکت که قطع شود، دوباره وصل می‌شود — ولی در همان فاصله ممکن
     *  است چیزی عوض شده باشد. پس سرِ **وصل شدنِ دوباره** یک بار خوانده
     *  می‌شود. بی این، یک قطعیِ دو ثانیه‌ای یعنی یک تغییرِ گم‌شده.
     */
    const onConnect = () => fn.current();
    socket?.on('connect', onConnect);

    //  تورِ ایمنیِ اختیاری — فقط برای صفحه‌هایی که دادهٔ بیرونی دارند
    const timer = fallbackMs > 0 ? setInterval(() => fn.current(), fallbackMs) : null;

    return () => {
      socket?.off('changed', onChanged);
      socket?.off('connect', onConnect);
      if (timer) clearInterval(timer);
    };
  }, [socket, key, fallbackMs]);
}
