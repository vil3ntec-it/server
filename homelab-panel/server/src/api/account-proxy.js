// ---------------------------------------------------------------------------
//  درِ سرورِ حساب — یک نشانی برای همهٔ برنامه‌ها
//
//      📱 برنامهٔ دکان · 🖥️ برنامهٔ پمپ · 📲 اپِ کارمندان · 🌐 سایت
//          ↓  https://api.<دامنه>/api/auth/… · /api/pump/… · /api/shop/…
//      ☁️  Cloudflare (تونل)
//          ↓
//      🏠 همین پورتِ عمومی  ──▶  🪪 سرورِ حساب (shop/server، روی 127.0.0.1)
//
//  ── چرا هیچ لاگینی کار نمی‌کرد ────────────────────────────────────────
//  تونلِ اینترنتی «api.<دامنه>» را به همین پورتِ عمومی می‌آورد. ولی قراردادِ
//  حساب و اشتراکی که هر چهار برنامه با آن نوشته شده‌اند — ثبت‌نامِ
//  سه‌پله‌ای، ورود، بند شدنِ دستگاه، مجوزِ امضاشده، پلن‌ها، پنلِ مدیریت —
//  مالِ سرورِ `shop/server` است، نه این پنل. پس هر درخواستِ حساب که از
//  تونل می‌آمد، همین‌جا به «not found» می‌خورد: برنامه می‌گفت «سرور جواب
//  نداد (۴۰۴)»، مدیر نمی‌توانست اشتراک بدهد، و مرکز فرمان هم که خودش
//  به همان نشانی زنگ می‌زند (‎stations/cloud.js‎) دستش خالی می‌ماند.
//
//  این ماژول همان حلقهٔ گم‌شده است: هرچه مالِ سرورِ حساب است، از همین
//  در به آن سپرده می‌شود — بی نشانیِ تازه، بی پورتِ تازه، بی تغییری در
//  هیچ برنامه‌ای. همان کاری که هر سرویسِ حرفه‌ای با یک «درگاهِ API»
//  می‌کند: بیرون یک در، پشتش چند سرویس.
//
//  ── چه چیزی رد می‌شود و چه چیزی نه ────────────────────────────────────
//  فهرستِ سفید است، نه «هرچه ناشناخته بود». مسیرهای خودِ این سرور
//  (‎/api/app‎ · ‎/api/stations‎ · ‎/api/messenger‎ · ‎/api/notify‎ · ‎/api/v1/health‎ …)
//  هرگز به آن‌طرف نمی‌روند، و مسیرهای خصوصیِ پنل که روی این پورت اصلاً
//  سوار نیستند همان‌طور «نبوده» می‌مانند — آزمونِ مرزِ پورتِ عمومی همان
//  قاعده را نگه می‌دارد.
//
//  ⚠️ ‎/api/v1/auth‎ و ‎/api/v1/admin‎ هم به سرورِ حساب می‌روند: برنامهٔ
//  دکان و اپِ مدیرش با همین پیشوند حرف می‌زنند و «یک سرور، یک حساب» یعنی
//  همان دفتری که برنامهٔ پمپ هم می‌بیند. کپیِ کهنهٔ «توحید» داخلِ همین
//  پنل (‎routes/tohid.js‎) با روشن بودنِ این در، از بیرون دیده نمی‌شود؛
//  با ‎HLP_ACCOUNT_API=0‎ همان رفتارِ قدیم برمی‌گردد.
//
//  ⚠️ کوکی هرگز رد نمی‌شود. سرورِ حساب فقط Bearer می‌فهمد و نشستِ پنل
//  نباید یک بیت هم آن‌طرف را ببیند. سرآیندهای CORS از آن‌طرف هم دور
//  ریخته می‌شوند: همین پورت خودش CORS را می‌دهد و دو ‎Allow-Origin‎ روی
//  هم یعنی مرورگر هر دو را رد می‌کند.
//
//  عمداً بی کتابخانهٔ پراکسی — همان لولهٔ ‎http.request‎ی که ‎ai/proxy.js‎
//  دارد. یک وابستگیِ دیگر روی سرورِ خانگی نمی‌نشیند.
// ---------------------------------------------------------------------------
import http from 'node:http';
import https from 'node:https';
import { config } from '../config.js';
import { clientIp } from '../platform/security.js';

/**
 * پیشوندهای سطحِ اولِ سرورِ حساب — همان فهرستِ ‎apiRouter‎ در
 * ‎shop/server/src/app.js‎. اگر آن‌جا پیشوندِ تازه‌ای سوار شد، این‌جا هم
 * باید بیاید؛ وگرنه از تونل «not found» می‌گیرد و هیچ‌کس نمی‌فهمد چرا.
 *
 * ⛔ **دستی نگه داشته نمی‌شود.** بندِ ۹ی ‎test/pump-e2e.mjs‎ این فهرست را با
 * خودِ ‎shop/server/src/app.js‎ می‌سنجد — هم «جا افتاده» و هم «بی‌صاحب». یک
 * بار همین فهرست عقب افتاد و ‎/api/errors‎ از تونل ۴۰۴ می‌گرفت در حالی که
 * سرورِ حساب سالم بود و هیچ آزمونی در هیچ‌کدام از دو ریپو نمی‌دیدش.
 * ⚠️ ‎sales‎ همین‌طور آمده بود و هیچ‌وقت روی سرورِ حساب وجود نداشت.
 */
export const ACCOUNT_PREFIXES = Object.freeze([
  'health', 'ready', 'config', 'plans', 'terms',
  'auth', 'location', 'me', 'shop', 'pump', 'events', 'sync', 'errors',
  'admin', 'license', 'support', 'visit', 'vip', 'billing',
  'portal', 'downloads',
]);

/** زیرِ ‎/api/v1‎ این‌ها مالِ خودِ این سرورند و هرگز رد نمی‌شوند. */
const HOME_V1 = new Set(['health', 'ready', 'app', 'messenger', 'notify', 'stations', 'announce']);
/** زیرِ ‎/api‎ این‌ها مالِ خودِ این سرورند. */
const HOME_ANY = new Set(['v1', 'app', 'messenger', 'notify', 'stations', 'announce', 'admin-gate']);

/** آیا این مسیر مالِ سرورِ حساب است؟ (بی توجه به روشن/خاموش بودنِ در) */
export function accountRoute(urlPath) {
  const p = String(urlPath || '').split('?')[0];
  //  پنلِ مدیریتِ سرورِ حساب — همان‌جایی که اشتراک داده می‌شود
  if (p === '/admin' || p.startsWith('/admin/')) return true;
  let m = /^\/api\/v1\/([^/?#]+)/.exec(p);
  if (m) return !HOME_V1.has(m[1]) && ACCOUNT_PREFIXES.includes(m[1]);
  m = /^\/api\/([^/?#]+)/.exec(p);
  if (m) return !HOME_ANY.has(m[1]) && ACCOUNT_PREFIXES.includes(m[1]);
  return false;
}

/** نشانیِ سرورِ حساب، یا null اگر در خاموش است. */
export function accountApiUrl() {
  const { enabled, url } = config.accountApi || {};
  if (!enabled || !url) return null;
  try { return new URL(url); } catch { return null; }
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** سرآیندهایی که عبور می‌کنند — فهرستِ سفید. کوکی عمداً نیست. */
/*
 *  ⛔ این فهرست باید با `Access-Control-Allow-Headers`ِ پورتِ عمومی
 *  (`src/index.js`) **یکی** بماند. سرآیندی که آن‌جا به مرورگر اعلام شود و
 *  این‌جا نباشد، بی‌صدا دور ریخته می‌شود: درخواست ۲۰۰ می‌گیرد و سرورِ
 *  حساب هویتِ دستگاه را اصلاً نمی‌بیند — و هیچ خطایی هیچ‌جا نیست.
 *
 *  چهار تای آخر را خودِ سرورِ حساب می‌خواند:
 *    x-app · x-device · x-request-id ⇒ routes/app-auth.js (ورودِ کدِ ایمیلی)
 *    x-app · x-device               ⇒ routes/errors.js · lib/sync-v1-live.js
 *    x-app                          ⇒ lib/sync-v1-auth.js
 *    idempotency-key                ⇒ routes/data.js (شناسهٔ عملیات)
 */
const PASS_HEADERS = [
  'content-type', 'content-length', 'authorization', 'accept', 'accept-language',
  'accept-encoding', 'origin', 'user-agent', 'x-app-id', 'x-app-version',
  'x-app-platform', 'x-requested-with', 'if-none-match', 'if-modified-since',
  'cache-control', 'range',
  'x-app', 'x-device', 'x-request-id', 'idempotency-key',
];

/** سرآیندهای اتصال — مالِ همین یک پرش‌اند و رد نمی‌شوند. */
const HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade',
  'proxy-authenticate', 'proxy-authorization',
]);

/** پشتیبانِ حساب تا ۶۴ مگابایت می‌رود (‎BACKUP_ACCOUNT_MAX_MB‎)؛ کمی بالاتر. */
const MAX_BODY = 96 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

const DOWN = new Set(['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'EHOSTUNREACH', 'ENOTFOUND']);

/** پیامِ «روشن نیست» — به شکلِ خطای خودِ سرورِ حساب، تا برنامه‌ها همان را نشان بدهند. */
/**
 * جملهٔ «چه کار کنم» وقتی سرورِ حساب روشن نیست.
 *
 * ⚠️ تا ۱.۳۷.۰ این‌جا «docker compose up -d» نوشته می‌شد و همان روی برنامهٔ
 * پمپ، برنامهٔ دکان و اپِ مدیریتِ صاحب سامانه دیده شد — روی کامپیوترِ
 * ویندوزی که نه داکر دارد نه PostgreSQL. حالا پنل خودش سرورِ حساب را بالا
 * می‌آورد (account/supervisor.js) و آن ناظر این جمله را از حالِ واقعی‌اش
 * می‌سازد (نصب نیست / دارد بالا می‌آید / افتاده). پیش‌فرض برای وقتی که ناظر
 * وصل نشده (آزمون‌ها، HLP_ACCOUNT_AUTOSTART=0).
 */
let downHint = () => 'سرورِ حساب روی سرورِ خانگی روشن نیست — پنلِ سرورِ خانگی را به‌روز کنید تا خودش بالا بیاوردش.';
export function setDownHint(fn) { if (typeof fn === 'function') downHint = fn; }

export function downPayload() {
  let hint = '';
  try { hint = String(downHint() || ''); } catch { /* پیامِ پیش‌فرض */ }
  return {
    error: {
      code: 'account_server_down',
      message: hint || 'سرورِ حساب روی سرورِ خانگی روشن نیست.',
    },
  };
}

/**
 * میان‌افزارِ Express — روی پورتِ عمومی و **پیش از** express.json،
 * چون بدنه باید جریانی رد شود (پشتیبان‌ها چند ده مگابایت‌اند).
 */
export function accountProxy(req, res, next) {
  const target = accountApiUrl();
  if (!target) return next();
  if (!accountRoute(req.originalUrl)) return next();

  const method = req.method.toUpperCase();
  if (!METHODS.has(method)) {
    return res.status(405).json({ error: { code: 'method_not_allowed', message: 'متدِ پشتیبانی‌نشده' } });
  }

  const secure = target.protocol === 'https:';
  const headers = { host: target.host };
  for (const h of PASS_HEADERS) {
    if (req.headers[h] !== undefined) headers[h] = req.headers[h];
  }
  //  سرورِ حساب باید IP و پروتکلِ واقعیِ کاربر را بداند (سقفِ نرخ و لینک‌ها)
  headers['x-forwarded-for'] = clientIp(req);
  headers['x-forwarded-proto'] = String(req.headers['x-forwarded-proto'] || req.protocol || 'https');
  if (req.headers.host) headers['x-forwarded-host'] = req.headers.host;

  const upstream = (secure ? https : http).request({
    host: target.hostname,
    port: Number(target.port) || (secure ? 443 : 80),
    method,
    path: req.originalUrl,
    headers,
    timeout: TIMEOUT_MS,
  }, (up) => {
    res.status(up.statusCode || 502);
    for (const [k, v] of Object.entries(up.headers)) {
      if (HOP.has(k) || k.startsWith('access-control-')) continue;
      res.setHeader(k, v);
    }
    up.pipe(res);
  });

  upstream.on('timeout', () => {
    upstream.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: { code: 'account_server_timeout', message: 'سرورِ حساب به‌موقع جواب نداد' } });
    }
  });

  upstream.on('error', (e) => {
    if (res.headersSent) return;
    if (DOWN.has(e.code)) return res.status(503).json(downPayload());
    res.status(502).json({ error: { code: 'account_server_error', message: 'ارتباط با سرورِ حساب برقرار نشد' } });
  });

  //  بدنه‌ای که میان‌افزارِ JSON زودتر خورده باشد — نباید پیش بیاید، ولی
  //  همان پوششِ ‎ai/proxy.js‎ این‌جا هم هست تا یک جابه‌جاییِ ساده معلقش نکند
  if (req.body !== undefined && req.readableEnded) {
    let payload = '';
    try { payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}); } catch { payload = '{}'; }
    upstream.setHeader('content-length', Buffer.byteLength(payload));
    upstream.end(payload);
    return;
  }

  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      upstream.destroy();
      if (!res.headersSent) res.status(413).json({ error: { code: 'too_large', message: 'درخواست بیش از حد بزرگ است' } });
      return;
    }
    upstream.write(chunk);
  });
  req.on('end', () => upstream.end());
  req.on('error', () => upstream.destroy());
}

/**
 * یک بار سرِ بالا آمدن می‌پرسد سرورِ حساب هست یا نه — و در لاگ می‌گوید.
 * چیزی را نمی‌بندد؛ فقط تا صاحبِ سرور همان اول بفهمد چرا برنامه‌ها وصل
 * نمی‌شوند، نه بعد از یک ساعت گشتن.
 */
export async function probeAccountServer() {
  const target = accountApiUrl();
  if (!target) return { enabled: false };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(new URL('/api/health', target), { signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    return { enabled: true, up: res.ok && body?.ok === true, version: body?.version || '', url: target.origin };
  } catch {
    return { enabled: true, up: false, version: '', url: target.origin };
  } finally {
    clearTimeout(timer);
  }
}
