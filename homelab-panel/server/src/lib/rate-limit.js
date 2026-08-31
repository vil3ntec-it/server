// ---------------------------------------------------------------------------
//  محدودیتِ نرخ — تا کسی با تکرارِ درخواست، سرور را از پا در نیاورد
//
//  ساده و بدونِ وابستگی: یک پنجرهٔ زمانیِ کشویی در حافظه. برای سرورِ خانگی
//  دقیقاً همین لازم است؛ چیزی برای نصب و تنظیم ندارد.
// ---------------------------------------------------------------------------
const buckets = new Map();

/** IP درخواست — پشتِ تونل، هدرِ x-forwarded-for را هم می‌بینیم */
export function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {string} name     نامِ سطل (تا مسیرهای مختلف روی هم اثر نگذارند)
 * @param {number} max      چند درخواست
 * @param {number} windowMs در چه بازه‌ای
 */
export function rateLimit(name, max, windowMs, { keyOf = clientIp } = {}) {
  return function limiter(req, res, next) {
    const key = `${name}:${keyOf(req)}`;
    const now = Date.now();

    let hits = buckets.get(key);
    if (!hits) {
      hits = [];
      buckets.set(key, hits);
    }
    // فقط درخواست‌های داخلِ پنجره می‌مانند
    while (hits.length && hits[0] <= now - windowMs) hits.shift();

    if (hits.length >= max) {
      const retryAfter = Math.ceil((hits[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        retryAfter,
        message: `درخواست‌ها زیاد شد. ${retryAfter} ثانیه صبر کنید.`,
      });
    }

    hits.push(now);
    next();
  };
}

/** هر چند دقیقه، سطل‌های خالی را دور می‌ریزیم تا حافظه بالا نرود */
export function pruneRateLimits(windowMs = 3600 * 1000) {
  const cutoff = Date.now() - windowMs;
  for (const [key, hits] of buckets) {
    while (hits.length && hits[0] <= cutoff) hits.shift();
    if (hits.length === 0) buckets.delete(key);
  }
}

export function rateLimitStats() {
  return { buckets: buckets.size };
}
