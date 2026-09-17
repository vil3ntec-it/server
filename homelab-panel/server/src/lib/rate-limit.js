// ---------------------------------------------------------------------------
//  پوستهٔ نازک روی تنها پیادهٔ محدودیتِ نرخ
//
//  ⚠️ این‌جا زمانی پیادهٔ دومی بود، با رفتاری متفاوت از platform/rate-limit.js
//  و با محاسبهٔ IPِ خودش که هدرِ جعلی را باور می‌کرد. یعنی سقفِ ورود و سقفِ
//  کد با یک هدر بی‌اثر می‌شدند و هیچ‌کس نمی‌دانست کدام مسیر به کدام پیاده
//  وصل است.
//
//  حالا فقط یک پیاده هست. این فایل مانده تا امضای موقعیتی‌اش
//  (`rateLimit(name, max, windowMs)`) که در index.js استفاده می‌شود نشکند.
// ---------------------------------------------------------------------------
import { rateLimit as limiter, pruneRateLimits, rateLimitStats, resetLimits } from '../platform/rate-limit.js';
import { clientIp } from '../platform/security.js';

export { clientIp, pruneRateLimits, rateLimitStats, resetLimits };

/**
 * @param {string} name     نامِ سطل (تا مسیرهای مختلف روی هم اثر نگذارند)
 * @param {number} max      چند درخواست
 * @param {number} windowMs در چه بازه‌ای
 */
export function rateLimit(name, max, windowMs, { keyOf } = {}) {
  return limiter({ name, max, windowMs, ...(keyOf ? { key: keyOf } : {}) });
}
