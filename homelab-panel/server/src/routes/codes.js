// ---------------------------------------------------------------------------
//  مسیرهای «کدهای شش‌رقمی»
//
//  دو دسته و کاملاً جدا:
//
//    /api/codes         برنامه‌ها و سایت‌ها این‌جا را صدا می‌زنند (با کلیدِ خودشان)
//    /api/codes-admin   خودِ پنل — فهرست، خودِ کد، دفترِ برنامه‌ها، تنظیمات
//
//  ⚠️ خودِ کدِ شش‌رقمی فقط از مسیرِ admin بیرون می‌آید و آن هم پشتِ ورودِ
//  مدیر است. مسیرِ عمومی هیچ‌وقت کد را برنمی‌گرداند — وگرنه هر کسی که آدرس
//  را بلد باشد می‌تواند برای ایمیلِ دیگری کد بگیرد و خودش بخواندش.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { logEvent } from '../db.js';
import { clientIp } from '../platform/security.js';
import { sameSecret } from '../lib/secret-compare.js';
import { allowAutoRegister } from '../lib/auto-register.js';
import { linkApp } from '../appauth/registry-link.js';
import { checkMailSettings, codeSettings, safeCodeSettings, saveCodeSettings } from '../codes/settings.js';
import { onPanelMailChanged } from '../account/supervisor.js';
import { cloudRaw } from '../stations/cloud.js';
import { issueCode, maskEmail, revealCode, verifyCode } from '../codes/service.js';
import { awaitDelivery, drainQueue, queueStatus } from '../codes/queue.js';
import { mailReady, sendCodeEmail } from '../codes/mail.js';
import {
  KIND_LABELS,
  cleanSlug,
  deleteApp,
  ensureApp,
  getApp,
  listApps,
  recentRequests,
  rotateKey,
  saveApp,
} from '../codes/store.js';

export const router = Router();
export const adminRouter = Router();

// IP از تنها جای محاسبه‌اش می‌آید (platform/security.js)

/* ========================================================================= */
/*  مسیرِ برنامه‌ها                                                            */
/* ========================================================================= */

/** شناسهٔ برنامه از هر جایی که برنامه‌ها عادت دارند بگذارند */
function appOf(req) {
  return cleanSlug(
    req.params?.app
      || req.body?.app
      || req.query?.app
      || req.headers['x-app-id']
      || req.headers['x-app']
      || 'main'
  );
}

/*
 *  کلیدِ برنامه از کجا خوانده می‌شود.
 *
 *  ⚠️ «Authorization: Bearer» عمداً آخر است و عمداً مانده:
 *
 *    • آخر است چون آن خانه مالِ *توکنِ کاربر* است، نه کلیدِ برنامه. اگر
 *      اول بود، برنامه‌ای که هر دو را دارد ممکن بود اشتباهی توکنِ کاربر
 *      را به‌عنوان کلید بفرستد و نفهمد چرا ۴۰۱ می‌گیرد.
 *    • مانده چون برنامه‌های موجود از همان‌جا می‌فرستند و برداشتنش
 *      همه‌شان را می‌شکست.
 *
 *  یعنی x-api-key راهِ درست است و Bearer راهِ سازگاریِ عقب‌رو.
 */
const keyOf = (req) =>
  String(
    req.headers['x-api-key']
      || req.headers['x-app-key']
      || req.body?.apiKey
      || (String(req.headers.authorization || '').startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : '')
      || ''
  ).trim();

/**
 * برنامه اجازه دارد؟
 *
 * برنامه‌ای که ثبت نشده، همین‌جا ثبت می‌شود — ولی با کلیدِ اجباری. یعنی در
 * پنل دیده می‌شود و تا کلیدش را برنداری و داخلِ برنامه نگذاری، کاری نمی‌کند.
 * این همان «هیچ برنامه‌ای پشتِ در نماند» است، بدونِ اینکه در باز بماند.
 */
function checkApp(slug, req) {
  /*
   *  ⚠️ این‌جا تا امروز `getApp(slug) || ensureApp(slug, …)` بود — یعنی
   *  *پیش از* هر بررسیِ کلید، هر نامی که می‌آمد در دفتر ثبت می‌شد.
   *  اندازه‌اش گرفته شد: ۲۰ درخواستِ بی‌کلید با نامِ ساختگی → ۲۰ ردیفِ
   *  تازه. یعنی هر کسی از اینترنت می‌توانست جدولِ برنامه‌ها را پر کند و
   *  فهرستِ پنل را غیرِقابلِ استفاده کند.
   *
   *  «هیچ برنامه‌ای پشتِ در نماند» هنوز برقرار است — ولی از راهِ درست:
   *  برنامهٔ تازه را صاحبِ سرور در پنل ثبت می‌کند و کلیدش را برمی‌دارد.
   */
  //  اگر فقط در دفترِ ورود ثبت شده، همین‌جا در دفترِ کدها هم ساخته می‌شود
  linkApp(slug);
  let row = getApp(slug);
  if (!row) {
    if (!allowAutoRegister(slug)) {
      return {
        ok: false,
        status: 404,
        error: 'unknown_app',
        message: 'این برنامه ثبت نشده است — در پنل ← کدهای شش‌رقمی اضافه‌اش کنید',
      };
    }
    row = ensureApp(slug, { name: slug });
    linkApp(slug);
  }
  if (!row.enabled) {
    return { ok: false, status: 403, error: 'app_disabled', message: 'این برنامه خاموش است' };
  }
  if (row.require_key) {
    // مقایسهٔ ثابت‌زمان — `!==` مدتِ پاسخ را به تعدادِ بایتِ درست گره می‌زد
    if (!sameSecret(keyOf(req), row.api_key)) {
      return {
        ok: false,
        status: 401,
        error: 'bad_key',
        message: 'کلیدِ این برنامه درست نیست — در پنل ← کدهای شش‌رقمی ببینیدش',
      };
    }
  }
  return { ok: true, row };
}

/**
 * درخواستِ کد.
 *
 *   POST /api/codes/request
 *   { "app": "app-fuel", "email": "a@b.c", "userId": "...", "purpose": "login" }
 *
 * جواب همان لحظه برمی‌گردد؛ ایمیل پشتِ سر از صف می‌رود.
 */
async function handleRequest(req, res) {
  const app = appOf(req);
  const access = checkApp(app, req);
  if (!access.ok) return res.status(access.status).json({ ok: false, ...access });

  const result = issueCode({
    app,
    email: req.body?.email ?? req.body?.mail ?? req.body?.address,
    subjectId: req.body?.userId ?? req.body?.deviceId ?? req.body?.subjectId ?? null,
    // نامِ خودِ شخص — تا ایمیل «احمد عزیز» بگوید. نبودنش مشکلی نیست.
    subjectName: req.body?.name ?? req.body?.fullName ?? req.body?.userName ?? null,
    purpose: req.body?.purpose ?? req.body?.type ?? 'login',
    ip: clientIp(req),
  });

  if (!result.ok) {
    // «زیاد شد» یعنی ۴۲۹، نه ۴۰۰ — کلاینت باید بتواند فرقشان را بفهمد
    const busy = result.error === 'too_soon' || result.error === 'too_many_requests';
    if (busy && result.retryAfter) res.setHeader('Retry-After', String(result.retryAfter));
    return res.status(busy ? 429 : 400).json(result);
  }

  // صف را هل می‌دهیم تا در بارِ کم، ایمیل منتظرِ تیکِ بعدی نماند
  drainQueue().catch(() => { /* خطا روی ردیفِ خودش ثبت می‌شود */ });

  res.json(result);
}

router.post(['/request', '/send', '/request-code', '/send-code'], handleRequest);
router.post('/:app/request', handleRequest);

/**
 * سنجیدنِ کد.
 *
 *   POST /api/codes/verify
 *   { "app": "app-fuel", "email": "a@b.c", "code": "583214" }
 */
function handleVerify(req, res) {
  const app = appOf(req);
  const access = checkApp(app, req);
  if (!access.ok) return res.status(access.status).json({ ok: false, ...access });

  const result = verifyCode({
    app,
    email: req.body?.email ?? req.body?.mail ?? req.body?.address,
    code: req.body?.code ?? req.body?.otp ?? req.body?.token,
  });

  if (!result.ok) return res.status(400).json(result);
  res.json(result);
}

router.post(['/verify', '/check', '/verify-code', '/check-code'], handleVerify);
router.post('/:app/verify', handleVerify);

/* ========================================================================= */
/*  مسیرِ پنل                                                                 */
/* ========================================================================= */

adminRouter.use(requireAuth, requireWriteRole('admin'));

const publicApp = (row) => ({
  slug: row.slug,
  name: row.name,
  kind: row.kind,
  kindLabel: KIND_LABELS[row.kind] || row.kind,
  apiKey: row.api_key,
  requireKey: Boolean(row.require_key),
  enabled: Boolean(row.enabled),
  codeTtl: row.code_ttl,
  subject: row.subject,
  note: row.note,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
});

/**
 * فهرستِ زنده — همان چیزی که در صفحه دیده می‌شود.
 *
 * خودِ کد این‌جا برمی‌گردد و همین عمدی است: صاحبِ سرور خواسته بتواند کد را
 * ببیند و کپی کند. ولی فقط تا وقتی کد زنده است؛ کدِ مصرف‌شده یا منقضی دیگر
 * نشان داده نمی‌شود، چون به درد نمی‌خورد و ماندنش فقط ریسک است.
 */
/*
 *  کدهای ورودِ **سرورِ حساب**، به همان شکلِ کدهای خودِ پنل.
 *
 *  ⛔ دو دفترِ کد هست و این یک بار کاربر را کاملاً گیج کرد: کدی که برنامهٔ
 *  دکان یا پمپ می‌خواهد در دفترِ **سرورِ حساب** می‌نشیند (`login_requests`)،
 *  نه در دفترِ این پنل. پس صفحهٔ «کدهای زنده» می‌گفت «هنوز کسی کد نخواسته»
 *  در حالی که روی گوشی نوشته بود «کد شش‌رقمی فرستاده شد». همان درسِ همیشگیِ
 *  این ریپو: دو دفتر یعنی دو حقیقت.
 *
 *  ⛔ **دفترِ دومی ساخته نشد** — این فقط می‌خواند و نگه نمی‌دارد.
 *
 *  ⚠️ و کد این‌جا **نمی‌آید**: خودِ سرورِ حساب هم در فهرست کد نمی‌دهد. نمایشِ
 *  کد یک کارِ جدا و ثبت‌شده است (`POST /api/account-admin/logins/:id/reveal`).
 *
 *  ⚠️ نرسیدن به سرورِ حساب صفحه را نمی‌شکند: کدهای خودِ پنل سرِ جایشان
 *  می‌مانند و `accountError` می‌گوید چرا آن یکی نیامد.
 */
async function accountCodes(app, limit) {
  const out = await cloudRaw('GET', '/api/admin/logins', {
    query: { app: app || '', limit },
  });
  const rows = Array.isArray(out?.requests) ? out.requests : [];
  return rows.map((r) => ({
    id: r.request_id,
    //  ⚠️ نشانِ سرچشمه — صفحه باید بگوید این ردیف مالِ کدام دفتر است
    source: 'account',
    app: r.app,
    appName: r.app === 'pump' ? 'پمپ‌بنزین' : 'فروشگاه',
    email: r.email,
    emailMasked: r.masked_email,
    subjectId: r.device_id || '',
    purpose: 'login',
    //  فهرست هیچ‌وقت کد نمی‌دهد؛ «نمایشِ کد» مسیرِ جداست
    code: null,
    canReveal: Boolean(r.active),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    expiresIn: r.active ? Math.max(0, Math.round((r.expires_at - Date.now()) / 1000)) : 0,
    usedAt: r.consumed_at,
    cancelledAt: r.superseded_at,
    tries: r.code_attempts,
    status: r.consumed_at ? 'used' : r.superseded_at ? 'replaced' : r.active ? 'live' : 'expired',
    sendState: r.state,
    /*
     *  ⛔ «رفت» با «در لاگ چاپ شد» یکی نیست و این یک بار کاربر را ساعت‌ها
     *  دنبالِ ایمیلی فرستاد که هیچ‌وقت فرستاده نشده بود: با راهِ ارسالِ
     *  «log» ردیف `sent` مهر می‌خورد و میز سبزِ پررنگ نشان می‌داد.
     *  سرورِ حساب از ۲.۷.۳ دلیلش را `log_only` می‌گذارد و این‌جا هم
     *  دیده می‌شود.
     */
    logOnly: r.reason === 'log_only',
    sendError: r.last_error || '',
    sendResponse: r.reason || null,
    sentAt: r.sent_at,
    autoResend: Number(r.send_attempts || 0) > 1,
    locked: Boolean(r.locked),
  }));
}

adminRouter.get('/live', async (req, res) => {
  const now = Date.now();
  const rows = recentRequests({
    app: req.query.app ? cleanSlug(req.query.app) : null,
    limit: Math.min(200, Number(req.query.limit) || 60),
  });

  const apps = new Map(listApps().map((a) => [a.slug, a]));
  const items = rows.map((row) => {
    const live = !row.used_at && !row.cancelled_at && row.expires_at > now;
    return {
      id: row.id,
      app: row.app,
      appName: apps.get(row.app)?.name || row.app,
      email: row.email,
      emailMasked: maskEmail(row.email),
      subjectId: row.subject_id,
      purpose: row.purpose,
      // کد فقط تا وقتی زنده است دیده می‌شود
      code: live ? revealCode(row) : null,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      expiresIn: live ? Math.max(0, Math.round((row.expires_at - now) / 1000)) : 0,
      usedAt: row.used_at,
      cancelledAt: row.cancelled_at,
      tries: row.tries,
      status: row.used_at ? 'used' : row.cancelled_at ? 'replaced' : live ? 'live' : 'expired',
      sendState: row.send_state,
      sendError: row.send_error,
      // رسیدِ خودِ سرورِ ایمیل — «فرستادم» را از ادعا به سند تبدیل می‌کند
      sendResponse: row.send_response || null,
      sentAt: row.sent_at,
      autoResend: row.resend_chain > 0,
    };
  });

  /*
   *  کدهای سرورِ حساب کنارِ کدهای خودِ پنل، مرتب‌شده بر اساسِ زمان — چون از
   *  دیدِ صاحبِ سامانه اینها یک چیزند: «کسی کد خواست».
   */
  const wanted = req.query.app ? cleanSlug(req.query.app) : null;
  let account = [];
  let accountError = '';
  //  بخشِ سرورِ حساب فقط دو نام دارد؛ فیلترِ برنامهٔ خودِ پنل به آن نمی‌خورد
  const accountApp = wanted === 'shop' || wanted === 'pump' ? wanted : null;
  if (!wanted || accountApp) {
    try {
      account = await accountCodes(accountApp, Math.min(200, Number(req.query.limit) || 60));
    } catch (err) {
      accountError = err?.message || 'به سرورِ حساب نرسیدیم';
    }
  }

  const all = [...items.map((r) => ({ ...r, source: 'panel' })), ...account]
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

  res.json({ ok: true, items: all, queue: queueStatus(), accountError, now });
});

/**
 *  فرستادنِ کد از خودِ پنل — «ربات، برای این ایمیل کد بفرست».
 *
 *  ⚠️ چرا لازم شد: تا امروز کد فقط وقتی ساخته می‌شد که *برنامه‌ای* با
 *  کلیدِ خودش بخواهد. یعنی صاحبِ سرور که می‌خواست برای یک حساب دستی کد
 *  بفرستد — چون طرف گیر کرده بود، یا تازه ثبت‌نام کرده — هیچ راهی نداشت
 *  جز اینکه از آن طرف وارد شود.
 *
 *  ⚠️ و این‌جا کلیدِ برنامه نمی‌خواهد، چون پشتِ ورودِ مدیر است. همان
 *  موتور، همان صف، همان قالبِ ایمیل — فقط دستِ دیگری دکمه را می‌زند.
 */
adminRouter.post('/send', async (req, res) => {
  const app = cleanSlug(req.body?.app || 'main');
  const row = getApp(app) || ensureApp(app, { name: req.body?.appName || app, kind: req.body?.kind });

  const result = issueCode({
    app: row.slug,
    email: req.body?.email,
    subjectId: req.body?.userId ?? req.body?.subjectId ?? null,
    subjectName: req.body?.name ?? req.body?.fullName ?? null,
    purpose: req.body?.purpose ?? 'login',
    ip: clientIp(req),
    // دستِ مدیر است؛ فاصلهٔ اجباری برای جلوگیری از کوبیدنِ دکمه توسطِ
    // کاربر است، نه برای خودِ صاحبِ سرور
    force: req.body?.force !== false,
  });

  if (!result.ok) return res.status(400).json(result);

  drainQueue().catch(() => { /* خطا روی ردیفِ خودش ثبت می‌شود */ });

  /*
   *  ⚠️ این‌جا منتظر می‌مانیم، برخلافِ مسیرِ برنامه‌ها.
   *
   *  گزارشِ واقعی: «۵ تا تست زدم، ۲ ایمیل رفت و سه تای دیگر نیامد، در
   *  حالی که می‌گوید فرستادم.» علتش همین بود — پاسخ پیش از خودِ ارسال
   *  برمی‌گشت و «نه»ی سرورِ ایمیل هیچ‌جا دیده نمی‌شد.
   *
   *  دکمه‌ای که خودِ صاحبِ سرور می‌زند یکی‌یکی است، پس چند ثانیه صبر
   *  اشکالی ندارد و در عوض جواب راست می‌شود. مسیرِ برنامه‌ها دست‌نخورده
   *  ماند، چون آن‌جا ممکن است صدها نفر هم‌زمان باشند.
   */
  const delivery = await awaitDelivery(result.id, { timeoutMs: 12_000 });

  const message = delivery.state === 'sent'
    ? 'ایمیل تحویلِ سرورِ ایمیل شد'
    : delivery.state === 'failed'
      ? `ایمیل نرفت — ${delivery.error || 'سرورِ ایمیل دلیلی نگفت'}`
      : 'هنوز در صفِ ارسال است؛ وضعیتش در همین فهرست به‌روز می‌شود';

  logEvent(
    delivery.state === 'failed' ? 'warn' : 'info',
    'panel',
    `کد برای ${result.email} از پنل: ${delivery.state === 'sent' ? 'رفت' : message}`,
  );

  res.json({ ...result, ok: delivery.state !== 'failed', delivery, message });
});

/* ── دفترِ برنامه‌ها ─────────────────────────────────────────────────────── */

adminRouter.get('/apps', (req, res) => {
  res.json({ ok: true, apps: listApps().map(publicApp) });
});

adminRouter.post('/apps', (req, res) => {
  const slug = cleanSlug(req.body?.slug || req.body?.name);
  if (getApp(slug)) return res.status(409).json({ ok: false, error: 'exists' });
  const row = ensureApp(slug, { name: req.body?.name || slug, kind: req.body?.kind });
  //  یک بار ثبت، هر دو مسیرِ ورود — وگرنه نصفِ سرور این برنامه را نمی‌شناسد
  linkApp(slug, { name: req.body?.name || slug, kind: req.body?.kind });
  const saved = saveApp(slug, req.body || {});
  logEvent('info', 'panel', `برنامهٔ «${row.slug}» به بخشِ کدهای شش‌رقمی اضافه شد`);
  res.json({ ok: true, app: publicApp(saved || row) });
});

adminRouter.put('/apps/:slug', (req, res) => {
  const row = saveApp(req.params.slug, req.body || {});
  if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, app: publicApp(row) });
});

adminRouter.post('/apps/:slug/key', (req, res) => {
  const row = rotateKey(req.params.slug);
  if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
  logEvent('warn', 'panel', `کلیدِ برنامهٔ «${row.slug}» عوض شد — برنامه تا گرفتنِ کلیدِ تازه کار نمی‌کند`);
  res.json({ ok: true, app: publicApp(row) });
});

adminRouter.delete('/apps/:slug', (req, res) => {
  res.json({ ok: deleteApp(req.params.slug) });
});

/* ── تنظیمات و ربات ─────────────────────────────────────────────────────── */

adminRouter.get('/settings', (req, res) => {
  res.json({ ok: true, settings: safeCodeSettings(), queue: queueStatus() });
});

adminRouter.put('/settings', (req, res) => {
  const patch = { ...(req.body || {}) };
  // رمزِ ماسک‌شده نباید جای رمزِ واقعی بنشیند
  if (patch.email && /^•+$/.test(String(patch.email.password || ''))) delete patch.email.password;

  /*
   *  ⚠️ جلوی تنظیماتِ غلط همین‌جا گرفته می‌شود، نه وقتی اولین کد نرفت.
   *
   *  یک بار در خانهٔ «آدرسِ سرور» ایمیل نوشته شده بود و نتیجه‌اش این بود
   *  که کدها ساخته می‌شدند ولی هیچ‌کدام نمی‌رفت، و تنها نشانه‌اش یک خطای
   *  انگلیسیِ خام (EAI_FAIL) تهِ صفحه بود.
   */
  let warning = null;
  if (patch.email) {
    const verdict = checkMailSettings({ ...codeSettings().email, ...patch.email });
    if (!verdict.ok) return res.status(400).json({ ok: false, ...verdict });
    // هشدار جلوی ذخیره را نمی‌گیرد، ولی باید دیده شود
    if (verdict.warn) warning = { code: verdict.warn, message: verdict.message, suggest: verdict.suggest };
  }

  saveCodeSettings(patch);
  //  سرورِ حساب همین SMTP را برای کدِ ثبت‌نامِ برنامه‌ها می‌گیرد — با
  //  محیطِ تازه دوباره بالا می‌آید (فقط اگر خودِ پنل روشنش کرده باشد).
  if (patch.email) { try { onPanelMailChanged(); } catch { /* ناظر خاموش */ } }
  res.json({ ok: true, settings: safeCodeSettings(), warning });
});

/** آزمایشِ سرورِ ایمیل — یک ایمیلِ واقعی با کدِ نمونه */
adminRouter.post('/test-email', async (req, res) => {
  const settings = codeSettings();
  if (!mailReady(settings)) {
    return res.status(400).json({ ok: false, error: 'mail_not_configured', message: 'سرورِ ایمیل تنظیم نشده' });
  }
  const verdict = checkMailSettings(settings.email);
  if (!verdict.ok) return res.status(400).json({ ok: false, ...verdict });
  try {
    await sendCodeEmail({
      to: String(req.body?.to || settings.email.from),
      code: '123456',
      appName: settings.appName || 'مرکز فرمان',
      minutes: 2,
      settings,
    });
    res.json({ ok: true, message: 'ایمیلِ آزمایشی رفت' });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'send_failed', message: e.message });
  }
});

export default router;
