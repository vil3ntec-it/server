// ---------------------------------------------------------------------------
//  پراکسیِ دستیارِ پشتیبانی
//
//  چرا لازم است — و چرا بدونِ آن کلِ ماجرا از اینترنت کار نمی‌کرد:
//
//  سرویسِ ai-support روی پورتِ ۸۷۸۸ و فقط روی 127.0.0.1 گوش می‌دهد. تونلِ
//  اینترنتیِ خانه اما فقط **یک** پورت را بیرون می‌دهد: پورتِ همین پنل. یعنی
//  سایتی که روی yaqobipump.top باز شده، هیچ راهی به ۸۷۸۸ ندارد.
//
//  پس همان یک دری که از قبل باز است را استفاده می‌کنیم: هر چیزی که به
//  /ai/support/* برسد، این‌جا به سرویسِ محلی داده می‌شود. نتیجه:
//    • سایت به همان آدرسِ سرورِ همگام‌سازی وصل می‌شود، بدونِ پورتِ اضافه.
//    • هیچ پورتِ تازه‌ای لازم نیست بیرون داده شود — سطحِ حمله بزرگ‌تر نمی‌شود.
//    • با هر تونلی (Cloudflare یا هر چیزِ دیگر) خودکار کار می‌کند.
//
//  عمداً بدونِ کتابخانهٔ پراکسی نوشته شده: یک لولهٔ ساده روی http.request کافی
//  است و یک وابستگیِ دیگر روی سرورِ خانگی نمی‌نشیند.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { config } from '../config.js';

/** فقط همین پیشوند پراکسی می‌شود — نه چیزِ دیگری از آن سرویس */
export const AI_PREFIX = '/ai/support';

/** سقفِ بدنه — سؤالِ چت هیچ‌وقت بزرگ نیست */
const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 120_000;

/**
 * میان‌افزارِ Express.
 * چیزی از پنل (کوکی، توکن، نشستِ مدیر) به آن‌طرف نمی‌رود — سرویسِ دستیار
 * احرازِ هویتِ خودش را دارد و نباید اعتبارنامهٔ پنل را ببیند.
 */
export function aiProxy(req, res, next) {
  // ⚠️ اینجا باید originalUrl خوانده شود نه path: وقتی میان‌افزار با
  // app.use('/ai/support', …) نصب می‌شود، Express پیشوند را از req.path
  // برمی‌دارد و req.path می‌شود «/health». با بررسیِ req.path، شرط هیچ‌وقت
  // برقرار نمی‌شد و درخواست به ۴۰۴ می‌افتاد. originalUrl همیشه کاملِ مسیر است،
  // پس این تابع هم با پیشوند و هم بدونِ پیشوند درست کار می‌کند.
  if (!String(req.originalUrl || '').startsWith(AI_PREFIX)) return next();

  if (!config.aiEnabled) {
    return res.status(503).json({ error: 'دستیارِ پشتیبانی روی این سرور خاموش است' });
  }

  const method = req.method.toUpperCase();
  if (!['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD'].includes(method)) {
    return res.status(405).json({ error: 'متدِ پشتیبانی‌نشده' });
  }

  // هدرهایی که عبور می‌کنند — فهرستِ سفید، نه سیاه. هر چیزِ دیگری (کوکی،
  // هدرهای داخلیِ پنل) عمداً جا می‌ماند.
  const headers = { host: `127.0.0.1:${config.aiPort}` };
  for (const h of ['content-type', 'authorization', 'x-ai-session', 'accept', 'accept-language', 'origin']) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }

  const upstream = http.request({
    host: '127.0.0.1',
    port: config.aiPort,
    method,
    path: req.originalUrl,
    headers,
    timeout: TIMEOUT_MS,
  }, (up) => {
    res.status(up.statusCode || 502);
    for (const [k, v] of Object.entries(up.headers)) {
      // هدرهای اتصال را دست‌کاری نکن — express خودش مدیریتشان می‌کند
      if (['connection', 'transfer-encoding', 'keep-alive'].includes(k)) continue;
      res.setHeader(k, v);
    }
    up.pipe(res);
  });

  upstream.on('timeout', () => {
    upstream.destroy();
    if (!res.headersSent) res.status(504).json({ error: 'دستیار به‌موقع جواب نداد' });
  });

  /* خطاهایی که همه یک معنی دارند: «سرویس آن‌طرف نیست».
     ECONNREFUSED یعنی اصلاً بالا نیست. ECONNRESET/EPIPE معمولاً یعنی وسطِ کار
     رفت — که با ری‌استارتِ خودکارِ ناظر زیاد پیش می‌آید، چون Node سوکت‌ها را
     keep-alive نگه می‌دارد و سوکتِ کهنه به سرویسِ رفته می‌خورد. برای کاربر
     تفاوتی ندارد؛ هر دو یعنی «الان در دسترس نیست، کمی بعد دوباره». */
  const DOWN = ['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'EHOSTUNREACH', 'ENOTFOUND'];
  upstream.on('error', (e) => {
    if (res.headersSent) return;
    const down = DOWN.includes(e.code);
    res.status(down ? 503 : 502).json({
      error: down
        ? 'دستیارِ پشتیبانی روی سرور در دسترس نیست — چند لحظه بعد دوباره امتحان کنید یا از پنل روشنش کنید'
        : 'ارتباط با دستیار برقرار نشد',
    });
  });

  /* بدنه.
     ⚠️ اگر میان‌افزارِ express.json زودتر اجرا شده باشد، جریانِ req از قبل
        خوانده و تمام شده — آن‌وقت هیچ رویدادِ data/end نمی‌آید و درخواست تا
        وقتِ انقضا معلق می‌ماند. (دقیقاً همین اتفاق افتاد.)
        راهِ درست این است که این پراکسی **پیش از** express.json نصب شود؛ ولی
        برای اینکه یک جابه‌جاییِ ساده در آینده دوباره همه‌چیز را نشکند، حالتِ
        «بدنه از قبل خوانده شده» هم این‌جا پوشش داده شده. */
  if (req.body !== undefined && req.readableEnded) {
    let payload = '';
    try {
      payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
    } catch { payload = '{}'; }
    if (payload && payload !== '{}') upstream.setHeader?.('content-length', Buffer.byteLength(payload));
    upstream.end(payload);
    return;
  }

  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      upstream.destroy();
      if (!res.headersSent) res.status(413).json({ error: 'درخواست بیش از حد بزرگ است' });
      return;
    }
    upstream.write(chunk);
  });
  req.on('end', () => upstream.end());
  req.on('error', () => upstream.destroy());
}
