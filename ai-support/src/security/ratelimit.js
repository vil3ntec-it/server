// ═══════════════════════════════════════════════════════════════════════════
//  محدودیت نرخ — دو سطلِ جدا
//
//  چرا دو تا: درخواستِ «جست‌وجو» ارزان است (چند میلی‌ثانیه) ولی درخواستی که به
//  مدل می‌رسد گران است (چند ثانیه CPU/GPU). اگر یک سطل داشته باشیم، مجبوریم
//  سقف را برای گران‌ترین حالت تنظیم کنیم و کارهای ارزان بی‌دلیل بسته می‌شوند.
// ═══════════════════════════════════════════════════════════════════════════

import config from '../config.js';

const buckets = new Map();   // key → { count, llm, resetAt }
let lastSweep = Date.now();

function sweep(now) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/**
 * @param {string} key شناسهٔ دستگاه/نشست
 * @param {{llm?: boolean}} opts آیا این درخواست قرار است به مدل برسد
 * @returns {{ok: boolean, retryAfterSec: number, remaining: number, reason?: string}}
 */
export function checkRate(key, { llm = false } = {}) {
  const now = Date.now();
  sweep(now);
  const { windowMs, maxRequests, maxLlmRequests } = config.rateLimit;

  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, llm: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }

  const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));

  if (b.count >= maxRequests) {
    return { ok: false, retryAfterSec, remaining: 0, reason: 'تعدادِ درخواست در دقیقه پر شد' };
  }
  if (llm && b.llm >= maxLlmRequests) {
    // نمی‌گوییم «رد شد» — می‌گوییم «بدونِ مدل جواب بده». تجربهٔ کاربر نمی‌شکند.
    return { ok: false, retryAfterSec, remaining: maxRequests - b.count, reason: 'سهمیهٔ مدل در این دقیقه پر شد', degrade: true };
  }

  b.count++;
  if (llm) b.llm++;
  return { ok: true, retryAfterSec, remaining: maxRequests - b.count };
}

/** برای تست‌ها */
export function resetRateLimits() { buckets.clear(); }
