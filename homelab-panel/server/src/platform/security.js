// ---------------------------------------------------------------------------
//  لایهٔ امنیت: هدرهای امن، CORS با فهرستِ سفید، و IP واقعیِ کاربر
// ---------------------------------------------------------------------------
import { config } from '../config.js';

// ---------------------------------------------------------------------------
//  IP واقعیِ درخواست
//
//  پشتِ reverse proxy، req.socket.remoteAddress همیشه خودِ پراکسی است؛ اگر
//  همان را مبنا بگیریم، محدودیتِ نرخ برای *همهٔ دنیا* یک سطل می‌شود و یک
//  مهاجم می‌تواند کلِ سرور را قفل کند.
//
//  ولی X-Forwarded-For را هم نمی‌شود همیشه باور کرد: اگر پراکسی‌ای در کار
//  نباشد، هر کسی می‌تواند آن هدر را جعل کند و با هر درخواست یک IPِ تازه
//  بسازد تا محدودیتِ نرخ را دور بزند. پس فقط وقتی باورش می‌کنیم که
//  HLP_TRUST_PROXY=1 گفته باشد پراکسی واقعاً جلو هست.
// ---------------------------------------------------------------------------
export function clientIp(req) {
  if (config.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return normalizeIp(xff);
    const real = String(req.headers['x-real-ip'] || '').trim();
    if (real) return normalizeIp(real);
  }
  return normalizeIp(req.socket?.remoteAddress || '');
}

function normalizeIp(ip) {
  // ::ffff:192.168.1.5 → 192.168.1.5
  return String(ip).replace(/^::ffff:/i, '') || 'unknown';
}

// ---------------------------------------------------------------------------
//  CORS
//
//  کدِ قبلی هر مبدأیی را که می‌آمد بازتاب می‌داد و کنارش
//  Access-Control-Allow-Credentials: true هم می‌گذاشت. یعنی هر سایتی در
//  اینترنت که کاربرِ واردشدهٔ پنل بازش می‌کرد، می‌توانست از طرفِ او به پنل
//  درخواست بزند. این دیگر بسته است.
//
//  فهرستِ سفید:
//    • زیردامنه‌های HLP_DOMAIN
//    • لوکال‌هاست (هر پورتی) — چون خودِ پنل از همان‌جا باز می‌شود
//    • IPهای شبکهٔ خصوصی — چون پنل با http://192.168.x.x:4700 باز می‌شود و
//      اگر این نباشد، به‌روزرسانی پنلِ کاربر را از کار می‌اندازد
//    • هر چه در HLP_CORS_ORIGINS اضافه شود
// ---------------------------------------------------------------------------

const PRIVATE_HOST = new RegExp(
  '^(' +
    'localhost|' +
    '127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|' +
    '10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|' +
    '192\\.168\\.\\d{1,3}\\.\\d{1,3}|' +
    '172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|' +
    '169\\.254\\.\\d{1,3}\\.\\d{1,3}|' +   // link-local
    '\\[?::1\\]?' +
  ')$'
);

/** آیا این مبدأ اجازهٔ صدا زدنِ API را دارد؟ */
export function isAllowedOrigin(origin, cfg = config) {
  if (!origin) return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();

  // شبکهٔ خانگی و خودِ دستگاه
  if (PRIVATE_HOST.test(host)) return true;

  // دامنهٔ مرکزی و زیردامنه‌هایش
  const root = cfg.domains?.root;
  if (root && (host === root || host.endsWith(`.${root}`))) return true;

  // مبدأهای دستیِ اضافه‌شده — تطابقِ کاملِ مبدأ، نه فقط میزبان
  const origins = cfg.corsOrigins || [];
  const self = `${url.protocol}//${url.host}`;
  return origins.some((o) => o === '*' || o === self || o === host);
}

/**
 * میان‌افزارِ CORS.
 * درخواستِ بدونِ مبدأ (curl، اپِ موبایل، سرور به سرور) دست‌نخورده رد می‌شود:
 * CORS یک سازوکارِ مرورگری است و آن‌جا اصلاً معنا ندارد.
 */
export function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  if (origin) {
    if (isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      // پاسخ بسته به مبدأ فرق می‌کند، پس کش نباید قاطی کند
      res.setHeader('Vary', 'Origin');
    } else if (req.method === 'OPTIONS') {
      // preflightِ رد شده: بدونِ هدرِ اجازه، مرورگر خودش جلویش را می‌گیرد
      return res.status(403).end();
    }
  }

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');

  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

// ---------------------------------------------------------------------------
//  هدرهای امن
//
//  ارزان، بدونِ ریسک، و جلوگیر از یک خانوادهٔ کاملِ حملاتِ مرورگری.
//  CSP اینجا نمی‌گذاریم: رابط کاربریِ ساخته‌شده استایلِ درون‌خطی دارد و یک
//  CSPِ سخت‌گیرانه پنل را سفید می‌کند. CSP جای درستش لبه است، کنارِ همان
//  جایی که فایل‌های ایستا سرو می‌شوند.
// ---------------------------------------------------------------------------
export function secureHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  // HSTS فقط وقتی که واقعاً پشتِ TLS هستیم. گذاشتنِ آن روی http یعنی
  // مرورگر برای همیشه https را اجبار می‌کند و پنلِ داخلِ شبکهٔ خانگی
  // (که TLS ندارد) از دسترس خارج می‌شود — خرابیِ سختی برای برگرداندن.
  const proto = config.trustProxy ? req.headers['x-forwarded-proto'] : null;
  if (proto === 'https' || req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}
