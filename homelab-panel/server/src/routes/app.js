// ---------------------------------------------------------------------------
//  API برنامه‌ها — همان چیزی که اپِ اندروید، برنامهٔ ویندوز و سایت‌ها صدا می‌زنند
//
//  همه‌چیز در چهار آدرس خلاصه می‌شود:
//
//    GET  /api/app/config                 سرور کیست و چه چیزی روشن است
//    POST /api/app/auth/request-code      {"phone":"09121234567"}  یا  {"email":"a@b.com"}
//    POST /api/app/auth/verify-code       {"phone":"...","code":"123456"}  →  توکن
//    GET  /api/app/me                     با هدرِ Authorization: Bearer <توکن>
//
//  نه رمز عبوری، نه ثبت‌نامِ جدا. هر کس کد را داشته باشد، وارد است.
// ---------------------------------------------------------------------------
import express, { Router } from 'express';
import { requireAuth } from '../auth.js';
import { versionInfo } from '../version.js';
import { config } from '../config.js';
import { publicState as tunnelState } from '../tunnel.js';
import { otpSettings, saveOtpSettings, safeOtpSettings } from '../appauth/settings.js';
import { smsProviders } from '../appauth/send.js';
import {
  cleanApp,
  pickTarget,
  requestCode,
  verifyCode,
  requireAppUser,
  logoutApp,
  logoutAllDevices,
  publicUser,
  listApps,
  listUsers,
  setBlocked,
  deleteUser,
  recentCodes,
  stats,
} from '../appauth/index.js';
import { db } from '../db.js';

const router = Router();

/* بعضی برنامه‌ها (به‌ویژه اپ‌های قدیمیِ اندروید و فرم‌های ساده) به‌جای JSON،
   فرمِ معمولی می‌فرستند. هر دو را می‌پذیریم تا کسی پشتِ در نماند. */
router.use(express.urlencoded({ extended: false, limit: '1mb' }));

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';

const appOf = (req) => cleanApp(req.body?.app || req.query?.app || req.headers['x-app'] || 'main');

// ---------------------------------------------------------------------------
//  ۱) شناسنامهٔ سرور — برنامه با همین می‌فهمد «وصل شدم»
// ---------------------------------------------------------------------------
router.get('/config', (req, res) => {
  const s = otpSettings();
  res.json({
    ok: true,
    service: 'pump-yaqobi-server',
    version: versionInfo.version,
    time: new Date().toISOString(),
    login: {
      // برنامه از روی همین دو تا تصمیم می‌گیرد کدام دکمه را نشان بدهد
      phone: true,
      email: true,
      codeLength: s.codeLength,
      expiresIn: s.codeTtlSeconds,
      resendIn: s.resendSeconds,
      // آیا واقعاً پیامک/ایمیل می‌رود یا هنوز تنظیم نشده
      smsReady: s.sms.provider !== 'none',
      emailReady: s.email.provider !== 'none' && Boolean(s.email.host),
    },
    // آدرس‌هایی که برنامه می‌تواند با آن‌ها وصل شود — آدرسِ اینترنتی (تونل)
    // همان چیزی است که باید در اپِ روی گوشیِ بیرون از خانه گذاشته شود
    server: {
      port: config.port,
      publicPort: config.siteSync.port || null,
      internet: (() => {
        try {
          return tunnelState().url || null;
        } catch {
          return null;
        }
      })(),
    },
    endpoints: {
      requestCode: '/api/app/auth/request-code',
      verifyCode: '/api/app/auth/verify-code',
      me: '/api/app/me',
      logout: '/api/app/auth/logout',
    },
  });
});

// آزمونِ سریعِ اتصال از داخلِ خودِ برنامه: GET /api/app/ping
router.get('/ping', (req, res) => res.json({ ok: true, pong: Date.now() }));

// ---------------------------------------------------------------------------
//  ۲) درخواستِ کد
// ---------------------------------------------------------------------------
async function handleRequestCode(req, res) {
  const settings = otpSettings();
  const picked = pickTarget(req.body || {}, settings);
  if (picked.error) {
    const message =
      picked.error === 'empty'
        ? 'شمارهٔ موبایل یا ایمیل را بفرستید'
        : picked.error === 'bad_email'
          ? 'ایمیل درست نیست'
          : 'شمارهٔ موبایل درست نیست';
    return res.status(400).json({ ok: false, error: picked.error, message });
  }

  const result = await requestCode({
    app: appOf(req),
    channel: picked.channel,
    target: picked.target,
    ip: clientIp(req),
    settings,
  });

  if (!result.ok) {
    return res.status(result.error === 'too_soon' || result.error === 'rate_limited' ? 429 : 400).json(result);
  }

  /* سرویسِ پیامک/ایمیل تنظیم شده ولی کد نرفت (کلیدِ اشتباه، اعتبارِ تمام‌شده،
     قطعیِ اینترنت…) — به برنامه دروغ نمی‌گوییم: خطا برمی‌گردانیم تا کاربر پشتِ
     صفحهٔ «کد را وارد کنید» بی‌خود منتظر نماند.
     اگر اصلاً سرویسی تنظیم نشده باشد (needsSetup) داستان فرق دارد: آن‌جا کد در
     لاگِ پنل هست و صاحبِ سرور دارد تست می‌کند، پس مسیر باز می‌ماند. */
  if (!result.sent && !result.needsSetup) {
    return res.status(502).json({ ...result, ok: false, error: 'not_sent' });
  }
  res.json(result);
}

// یک کار، چند اسم — هر برنامه‌ای اسمِ رایجِ خودش را صدا بزند، همین کار انجام می‌شود
router.post(
  ['/auth/request-code', '/auth/send-code', '/auth/otp', '/login/request', '/send-code'],
  handleRequestCode
);

// ---------------------------------------------------------------------------
//  ۳) بررسیِ کد → توکن
// ---------------------------------------------------------------------------
function handleVerifyCode(req, res) {
  const settings = otpSettings();
  const picked = pickTarget(req.body || {}, settings);
  if (picked.error) {
    return res.status(400).json({ ok: false, error: picked.error, message: 'شماره یا ایمیل درست نیست' });
  }

  const result = verifyCode({
    app: appOf(req),
    target: picked.target,
    code: req.body?.code ?? req.body?.otp ?? req.body?.token,
    name: req.body?.name,
    device: req.body?.device || req.headers['user-agent'],
    ip: clientIp(req),
    settings,
  });

  if (!result.ok) return res.status(result.error === 'blocked' ? 403 : 400).json(result);
  res.json(result);
}

router.post(
  ['/auth/verify-code', '/auth/check-code', '/auth/login', '/login/verify', '/verify-code'],
  handleVerifyCode
);

// ---------------------------------------------------------------------------
//  ۴) کاربرِ واردشده
// ---------------------------------------------------------------------------
router.get('/me', requireAppUser, (req, res) => {
  res.json({ ok: true, user: publicUser(req.appUser) });
});

router.put('/me', requireAppUser, (req, res) => {
  const name = req.body?.name === undefined ? null : String(req.body.name).slice(0, 80);
  if (name !== null) db.prepare('UPDATE app_users SET name = ? WHERE id = ?').run(name, req.appUser.id);
  const user = db.prepare('SELECT * FROM app_users WHERE id = ?').get(req.appUser.id);
  res.json({ ok: true, user: publicUser(user) });
});

router.post('/auth/logout', requireAppUser, (req, res) => {
  res.json(req.body?.allDevices ? logoutAllDevices(req.appUser.id) : logoutApp(req.appSessionId));
});

export default router;

// ---------------------------------------------------------------------------
//  مسیرهای مدیریتی — فقط از پنل و با حسابِ مدیر
// ---------------------------------------------------------------------------
export const adminRouter = Router();
adminRouter.use(requireAuth);

adminRouter.get('/', (req, res) => {
  res.json({
    stats: stats(),
    apps: listApps(),
    settings: safeOtpSettings(),
    smsProviders,
  });
});

adminRouter.get('/users', (req, res) => {
  res.json({
    users: listUsers({
      app: req.query.app ? cleanApp(req.query.app) : null,
      search: req.query.q || '',
      limit: req.query.limit,
      offset: req.query.offset,
    }),
  });
});

adminRouter.post('/users/:id/block', (req, res) => res.json(setBlocked(req.params.id, req.body?.blocked !== false)));
adminRouter.delete('/users/:id', (req, res) => res.json(deleteUser(req.params.id)));

/* آخرین کدها — بدونِ خودِ کد (کد اصلاً ذخیره نمی‌شود). برای وقتی که می‌خواهید
   ببینید درخواست‌ها می‌رسند و از چه راهی فرستاده شده‌اند. */
adminRouter.get('/codes', (req, res) => res.json({ codes: recentCodes(req.query.limit) }));

adminRouter.get('/settings', (req, res) => res.json(safeOtpSettings()));

adminRouter.put('/settings', (req, res) => {
  // مقدارهای ماسک‌شده («••••••») یعنی «دست نزن»
  const body = JSON.parse(JSON.stringify(req.body || {}));
  for (const section of ['sms', 'email']) {
    for (const key of ['apiKey', 'password']) {
      if (body[section]?.[key] && /^•+$/.test(body[section][key])) delete body[section][key];
    }
  }
  res.json(saveOtpSettings(body));
});

/* آزمونِ واقعی: یک کد به شماره/ایمیلِ خودتان می‌فرستد و می‌گوید کجا گیر کرده */
adminRouter.post('/test', async (req, res) => {
  const settings = otpSettings();
  const picked = pickTarget(req.body || {}, settings);
  if (picked.error) return res.status(400).json({ ok: false, error: picked.error });
  const result = await requestCode({
    app: cleanApp(req.body?.app || 'main'),
    channel: picked.channel,
    target: picked.target,
    ip: clientIp(req),
    settings,
  });
  res.json(result);
});
