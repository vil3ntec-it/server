// ---------------------------------------------------------------------------
//  دیدبانِ سرورِ حساب — تورِ ایمنیِ گذرگاهِ زنده
//
//  کدها، پشتیبانی، مشتری‌ها و پول همه در دفترِ **سرورِ حساب** می‌نشینند،
//  نه این پنل. پس این پنل از خودش نمی‌داند کِی چیزی آن‌جا عوض شده.
//
//  راهِ اصلی pushِ خودِ سرورِ حساب است (`POST /api/live/bump` روی لوکال‌هاست،
//  با راز). این دیدبان راهِ دوم است — برای سرورِ حسابِ قدیمی، یا لحظه‌ای که
//  آن درخواست گم شود.
//
//  ⛔ **و فقط وقتی می‌دود که کسی واقعاً نگاه می‌کند.** پنلِ بسته یعنی صفرِ
//  مطلق. این همان خواستهٔ «روی کامپیوتر فشاری نیاره» است و بی آن، دیدبان
//  فقط جای شانزده `setInterval`ِ قدیمی را می‌گرفت.
//
//  ⚠️ و سنگینیِ خودش هم یک درخواست است، نه بیشتر: سرورِ حساب یک مسیرِ
//  «مهرها» دارد که بیشینهٔ زمانِ هر دفتر را می‌دهد. مقایسهٔ عدد، نه خواندنِ
//  داده — پس هرچند تب باز باشد، بارِ سرورِ حساب همان یکی است.
// ---------------------------------------------------------------------------
import { bump, liveStats } from './bus.js';

/** فاصلهٔ دیدبان — عمداً کند، چون راهِ اصلی pushِ خودِ سرورِ حساب است */
const EVERY_MS = 10_000;

/** مهرِ هر موضوع در آخرین دور — تغییرِ نکرده هیچ‌کس را بیدار نمی‌کند */
let seen = new Map();
let timer = null;
let busy = false;
let viewers = () => 0;
let fetchStamps = null;

/**
 * @param {object} opts
 * @param {() => number} opts.viewerCount  چند نفر همین حالا نگاه می‌کنند
 * @param {() => Promise<Record<string, number>>} opts.stamps  مهرهای سرورِ حساب
 */
export function startAccountWatch({ viewerCount, stamps, everyMs = EVERY_MS } = {}) {
  stopAccountWatch();
  viewers = typeof viewerCount === 'function' ? viewerCount : () => 0;
  fetchStamps = typeof stamps === 'function' ? stamps : null;
  if (!fetchStamps) return null;

  timer = setInterval(tick, everyMs);
  timer.unref?.();
  return timer;
}

export function stopAccountWatch() {
  if (timer) clearInterval(timer);
  timer = null;
  seen = new Map();
  busy = false;
}

/** فقط برای آزمون — یک دور، همین حالا */
export async function watchOnce() {
  return tick();
}

async function tick() {
  //  کسی نگاه نمی‌کند ⇒ هیچ کاری نمی‌کنیم
  if (!fetchStamps || busy) return 0;
  if (viewers() <= 0) return 0;

  busy = true;
  try {
    const fresh = await fetchStamps();
    if (!fresh || typeof fresh !== 'object') return 0;

    let woke = 0;
    for (const [topic, at] of Object.entries(fresh)) {
      const value = Number(at) || 0;
      /*
       *  ⚠️ دورِ **اول** هیچ‌کس را بیدار نمی‌کند.
       *
       *  بی این، باز کردنِ پنل همان لحظه همهٔ صفحه‌ها را به یک پرس‌وجوی
       *  بی‌دلیل می‌فرستاد — چون «قبلاً ندیده بودم» با «عوض شد» یکی
       *  گرفته می‌شد. خودِ صفحه سرِ باز شدن یک بار می‌خواند؛ این فقط
       *  برای **تغییرِ بعد از آن** است.
       */
      if (!seen.has(topic)) { seen.set(topic, value); continue; }
      if (seen.get(topic) === value) continue;
      seen.set(topic, value);
      try { bump(topic, { via: 'watch' }); woke++; } catch { /* موضوعِ ناشناسِ سرورِ تازه‌تر */ }
    }
    return woke;
  } catch {
    //  سرورِ حساب خاموش است — این دیدبان حق ندارد چیزی را بخواباند
    return 0;
  } finally {
    busy = false;
  }
}

export function watchStats() {
  return { running: Boolean(timer), watched: Object.fromEntries(seen), ...liveStats() };
}
