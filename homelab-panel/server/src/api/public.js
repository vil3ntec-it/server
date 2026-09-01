// ---------------------------------------------------------------------------
//  APIِ عمومیِ سرور — تنها دری که از اینترنت باز است
//
//      📱 برنامهٔ موبایل
//          ↓
//      https://api.<دامنهٔ شما>
//          ↓
//      ☁️  Cloudflare (تونل)
//          ↓
//      🏠 سرورِ خانگی — همین پورتِ عمومی
//          ↓
//      🗄️  دیتابیس
//
//  چرا یک ماژولِ جدا و نه چند خط داخلِ index.js: تا امروز مسیرهای عمومی
//  یکی‌یکی و پراکنده سوار می‌شدند. نتیجه‌اش این بود که هیچ‌جا یک فهرستِ
//  واحد از «چه چیزی عمومی است» وجود نداشت؛ هر بار که کسی مسیرِ تازه‌ای
//  اضافه می‌کرد باید یادش می‌ماند کجا بگذارد، و یک بار همین باعث شد
//  برنامهٔ مشتری و مدیریت هر دو از راهِ تونل «not found» بگیرند.
//
//  حالا هرچه عمومی است این‌جاست و هرچه این‌جا نیست عمومی نیست. پنل،
//  فایل‌منیجر، ترمینال و /api/control هرگز به این روتر نمی‌آیند.
//
//  قراردادِ نسخه: تغییرِ شکسته → v2. افزودنِ مسیر یا فیلدِ تازه → همین v1.
// ---------------------------------------------------------------------------
import { Router } from 'express';

import appRoutes from '../routes/app.js';
import messengerRoutes from '../routes/messenger.js';
import notifyRoutes from '../routes/notify.js';
import tohidPublicRoutes from '../routes/tohid.js';
import tohidAdminApiRoutes from '../routes/tohid-admin.js';
import { readyPayload } from '../platform/health.js';
import { versionInfo } from '../version.js';
import { config } from '../config.js';

export const PUBLIC_API_VERSION = 'v1';

/*
 *  فهرستِ رسمیِ آنچه از اینترنت در دسترس است.
 *
 *  همین فهرست هم به کلاینت‌ها نشان داده می‌شود (GET /api) و هم آزمونِ
 *  مرزِ پورتِ عمومی رویش می‌ایستد. اگر مسیرِ تازه‌ای عمومی می‌شود، اسمش
 *  باید این‌جا بیاید — وگرنه ساخته شده ولی کسی نمی‌داند هست.
 */
const ENDPOINTS = [
  { path: '/api/v1/health', what: 'زنده بودنِ سرور' },
  { path: '/api/v1/ready', what: 'آمادگیِ واقعی — دیتابیس و دیسک' },
  { path: '/api/v1/auth', what: 'ثبت‌نام و ورودِ مشتری' },
  { path: '/api/v1/admin', what: 'مدیریت — پشتِ نام کاربری و رمز' },
  { path: '/api/v1/app', what: 'ورودِ برنامه‌ها با کد' },
  { path: '/api/v1/messenger', what: 'پیام‌رسان (HTTP و WebSocket)' },
  { path: '/api/v1/notify', what: 'اعلان‌ها' },
];

/**
 * آدرسی که کلاینت‌ها باید صدا بزنند.
 *
 * اگر دامنه تنظیم شده باشد همان `https://api.<دامنه>` است؛ وگرنه همان
 * میزبانی که درخواست از آن آمده — تا در شبکهٔ خانگی هم جوابِ درست بدهد
 * و نصبِ بدونِ دامنه از کار نیفتد.
 */
export function apiBaseUrl(req = null) {
  if (config.domains?.apiUrl) return config.domains.apiUrl;
  if (!req) return null;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers.host;
  return host ? `${proto}://${host}` : null;
}

/**
 * «زنده‌ام» برای اینترنت.
 *
 * عمداً کوتاه‌تر از healthPayload داخلی است: آن یکی مسیرِ نصب را هم
 * می‌گوید، که برای پنلِ خانگی مفید است و برای دنیای بیرون یک سرنخِ
 * رایگان. لبه و ناظرِ سرویس برای تصمیمِ سالم/ناسالم به بیشتر از این
 * نیاز ندارند.
 */
export function publicHealth() {
  return {
    ok: true,
    service: 'control-center',
    version: versionInfo.version,
    time: new Date().toISOString(),
  };
}

/** پاسخِ صفحهٔ اولِ API — «این‌جا چه خبر است و از کجا شروع کنم» */
export function apiIndex(req = null) {
  return {
    ok: true,
    service: 'control-center',
    version: PUBLIC_API_VERSION,
    baseUrl: apiBaseUrl(req),
    endpoints: ENDPOINTS,
    time: new Date().toISOString(),
  };
}

/**
 * روترِ APIِ عمومی — روی `/api` سوار می‌شود.
 *
 * مسیرهای بی‌نسخه (`/api/app`, `/api/messenger`, `/api/notify`) هم نگه
 * داشته می‌شوند: برنامه‌هایی که همین حالا بیرون‌اند آن‌ها را صدا می‌زنند و
 * با جابه‌جا کردنِ مسیر، همان لحظه می‌شکستند.
 */
export function createPublicApi() {
  const router = Router();

  // صفحهٔ اول — هم /api و هم /api/v1
  router.get(['/', `/${PUBLIC_API_VERSION}`], (req, res) => res.json(apiIndex(req)));

  const v1 = Router();
  v1.get('/health', (req, res) => res.json(publicHealth()));
  v1.get('/ready', (req, res) => {
    const payload = readyPayload();
    res.status(payload.ready ? 200 : 503).json(payload);
  });

  /*
   *  ترتیب مهم است: مسیرهای نام‌دار پیش از توحید می‌نشینند، چون روترِ
   *  توحید روی ریشهٔ v1 سوار است و اگر اول بیاید مسیرهای زیرش را
   *  می‌بلعد.
   */
  v1.use('/admin', tohidAdminApiRoutes);
  v1.use('/app', appRoutes);
  v1.use('/messenger', messengerRoutes);
  v1.use('/notify', notifyRoutes);
  // برنامهٔ مشتری: /api/v1/auth/login، /api/v1/sync و بقیه روی ریشهٔ v1
  v1.use(tohidPublicRoutes);

  router.use(`/${PUBLIC_API_VERSION}`, v1);

  // ── نام‌های قدیمی، برای برنامه‌هایی که همین حالا بیرون‌اند ────────────
  router.use('/app', appRoutes);
  router.use('/messenger', messengerRoutes);
  router.use('/notify', notifyRoutes);

  router.use((req, res) => res.status(404).json({ error: 'not_found' }));
  return router;
}
