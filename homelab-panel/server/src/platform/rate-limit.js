// ---------------------------------------------------------------------------
//  محدودیتِ نرخ — سطلِ شمارشیِ پنجره‌ایِ در حافظه
//
//  چرا در حافظه و نه Redis: یک سرور، یک پروسه. Redis یک سرویسِ تازه است که
//  باید بالا بماند، بکاپ شود و خراب شدنش کلِ پنل را می‌خواباند — در ازای
//  مزیتی که فقط وقتی چند نمونهٔ هم‌زمان داشته باشیم معنا دارد. اگر روزی آن
//  روز رسید، فقط همین فایل عوض می‌شود.
//
//  چرا سخت‌گیریِ جداگانه روی ورود: بقیهٔ مسیرها توکن می‌خواهند، پس مهاجم
//  اول باید از ورود رد شود. تنها درِ باز همان است، و brute-forceِ رمز دقیقاً
//  از همان‌جا می‌آید. سقفِ عمومی برای اسکنرهاست، سقفِ ورود برای حدسِ رمز.
// ---------------------------------------------------------------------------
import { clientIp } from './security.js';

/** کلید → { count, resetAt } */
const buckets = new Map();

// سطل‌های منقضی نباید بی‌نهایت جمع شوند
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
}, 60_000);
sweeper.unref?.();

/** فقط برای آزمون‌ها */
export function resetLimits() {
  buckets.clear();
}

/**
 * @param {object} opts
 * @param {number} opts.max        سقفِ درخواست در پنجره (۰ = خاموش)
 * @param {number} opts.windowMs   طولِ پنجره
 * @param {string} opts.name       نامِ سطل تا محدودیت‌های مختلف قاطی نشوند
 * @param {(req)=>string} [opts.key] کلیدِ سفارشی (پیش‌فرض: IP)
 * @param {boolean} [opts.skipSuccess] فقط پاسخ‌های ناموفق شمرده شوند
 */
export function rateLimit(opts) {
  const { max, windowMs, name } = opts;
  const keyOf = opts.key || ((req) => clientIp(req));

  return function limiter(req, res, next) {
    if (!max || max <= 0) return next();

    const key = `${name}:${keyOf(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', '0');
      res.setHeader('RateLimit-Reset', String(retryAfter));
      return res.status(429).json({ error: 'rate_limited', retryAfter });
    }

    // در حالتِ skipSuccess فقط شکست‌ها شمرده می‌شوند: کاربری که رمزش را درست
    // می‌زند نباید به‌خاطر ورود و خروجِ مکرر قفل شود.
    if (opts.skipSuccess) {
      res.on('finish', () => {
        if (res.statusCode >= 400) bucket.count++;
      });
    } else {
      bucket.count++;
    }

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    next();
  };
}
