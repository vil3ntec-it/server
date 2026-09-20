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
//
//  ⚠️ این تنها پیادهٔ محدودیتِ نرخ در سرور است. تا امروز دو تا بود
//  (lib/ و platform/) با رفتارِ متفاوت، و هیچ‌کس نمی‌دانست کدام مسیر به
//  کدام‌یک وصل است. حالا lib/rate-limit.js فقط یک پوستهٔ نازک روی همین
//  است، تا امضای قدیمی‌اش نشکند.
//
//  ⚠️ و پنجره «کشویی» است نه «ثابت». با پنجرهٔ ثابت، مهاجم سقف را در
//  ثانیهٔ آخرِ یک پنجره و دوباره در ثانیهٔ اولِ پنجرهٔ بعد می‌زند — یعنی
//  عملاً دو برابرِ سقف در یک چشم‌به‌هم‌زدن. با کشویی این ممکن نیست.
// ---------------------------------------------------------------------------
import { clientIp } from './security.js';

/** کلید → آرایهٔ زمانِ درخواست‌ها (پنجرهٔ کشویی) */
const buckets = new Map();

/** زمان‌های بیرونِ پنجره را دور می‌ریزد و سطل را برمی‌گرداند */
function bucketOf(key, windowMs, now) {
  let hits = buckets.get(key);
  if (!hits) {
    hits = [];
    buckets.set(key, hits);
  }
  while (hits.length && hits[0] <= now - windowMs) hits.shift();
  return hits;
}

// سطل‌های خالی نباید بی‌نهایت جمع شوند
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of buckets) {
    while (hits.length && hits[0] <= now - 3600_000) hits.shift();
    if (hits.length === 0) buckets.delete(key);
  }
}, 60_000);
sweeper.unref?.();

/** فقط برای آزمون‌ها */
export function resetLimits() {
  buckets.clear();
}

export function rateLimitStats() {
  return { buckets: buckets.size };
}

/** نگهداریِ دوره‌ای — از بیرون هم صدا زده می‌شود */
export function pruneRateLimits(windowMs = 3600_000) {
  const cutoff = Date.now() - windowMs;
  for (const [key, hits] of buckets) {
    while (hits.length && hits[0] <= cutoff) hits.shift();
    if (hits.length === 0) buckets.delete(key);
  }
}

/**
 * @param {object} opts
 * @param {number} opts.max        سقفِ درخواست در پنجره (۰ = خاموش)
 * @param {number} opts.windowMs   طولِ پنجره
 * @param {string} opts.name       نامِ سطل تا محدودیت‌های مختلف قاطی نشوند
 * @param {(req)=>string} [opts.key] کلیدِ سفارشی (پیش‌فرض: IP)
 * @param {boolean} [opts.skipSuccess] فقط پاسخ‌های ناموفق شمرده شوند
 * @param {(req,res)=>boolean} [opts.countIf] جای قاعدهٔ پیش‌فرضِ skipSuccess —
 *   «این درخواست باید شمرده شود؟». فقط با skipSuccess معنی دارد.
 */
export function rateLimit(opts) {
  const { max, windowMs, name } = opts;
  const keyOf = opts.key || ((req) => clientIp(req));

  return function limiter(req, res, next) {
    if (!max || max <= 0) return next();

    const key = `${name}:${keyOf(req)}`;
    const now = Date.now();
    const hits = bucketOf(key, windowMs, now);

    if (hits.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('RateLimit-Limit', String(max));
      res.setHeader('RateLimit-Remaining', '0');
      res.setHeader('RateLimit-Reset', String(retryAfter));
      return res.status(429).json({
        ok: false,
        error: 'rate_limited',
        retryAfter,
        message: `درخواست‌ها زیاد شد. ${retryAfter} ثانیه صبر کنید.`,
      });
    }

    // در حالتِ skipSuccess فقط شکست‌ها شمرده می‌شوند: کاربری که رمزش را درست
    // می‌زند نباید به‌خاطر ورود و خروجِ مکرر قفل شود.
    /*
     *  ⚠️ و گاهی «شکست» هم حدس نیست.
     *
     *  countIf جای همین قاعده را می‌گیرد: برنامه‌ای که یک کلیدِ کهنه را هر
     *  شش ثانیه دوباره می‌زند صد شکست می‌سازد ولی *یک* حدس است، و شمردنِ
     *  هر کدام یعنی همان برنامه خودش را برای همیشه بیرون می‌گذارد — پنجره
     *  با نبضِ خودش پر می‌ماند و کلیدِ تازه هم دیگر رد نمی‌شود.
     *  (شرحِ کامل و سنجه‌اش: src/api/admin-gate.js و test/admin-gate.mjs)
     */
    if (opts.skipSuccess) {
      const countable = opts.countIf || ((_req, response) => response.statusCode >= 400);
      res.on('finish', () => {
        if (countable(req, res)) bucketOf(key, windowMs, Date.now()).push(Date.now());
      });
    } else {
      hits.push(now);
    }

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - hits.length)));
    next();
  };
}
