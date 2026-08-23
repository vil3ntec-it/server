// ---------------------------------------------------------------------------
//  تنظیماتِ «ورود با کدِ شش‌رقمی»
//
//  دو جا خوانده می‌شود و ساده است:
//    ۱) فایل .env  → برای وقتی که می‌خواهید یک‌بار بگذارید و تمام
//    ۲) پنل        → هر چه در پنل ذخیره شود، روی .env را می‌پوشاند
//
//  هیچ‌چیز اجباری نیست: اگر هیچ سرویسِ پیامکی یا ایمیلی نگذارید، سرور باز هم
//  کار می‌کند و کد را در «پنل ← لاگ‌ها» نشان می‌دهد تا خودتان ببینید.
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';

const SETTING_KEY = 'otp_settings';

const num = (v, d) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => {
  if (v === undefined || v === null || v === '') return d;
  return !['0', 'false', 'no', 'off', 'خیر'].includes(String(v).trim().toLowerCase());
};

/** آن‌چه از فایل .env می‌آید (مقدارهای پیش‌فرضِ کارخانه) */
function fromEnv() {
  return {
    // ── پیامک ──────────────────────────────────────────────────────────────
    sms: {
      // none | kavenegar | smsir | melipayamak | ghasedak | webhook
      provider: (process.env.OTP_SMS_PROVIDER || 'none').trim().toLowerCase(),
      apiKey: process.env.OTP_SMS_KEY || '',
      username: process.env.OTP_SMS_USER || '',
      password: process.env.OTP_SMS_PASS || '',
      sender: process.env.OTP_SMS_SENDER || '',
      template: process.env.OTP_SMS_TEMPLATE || '',
      // فقط برای provider=webhook (هر سرویسِ دیگری در دنیا)
      url: process.env.OTP_SMS_URL || '',
      method: (process.env.OTP_SMS_METHOD || 'POST').toUpperCase(),
      headers: process.env.OTP_SMS_HEADERS || '',
      body: process.env.OTP_SMS_BODY || '',
    },

    // ── ایمیل (SMTP — جی‌میل هم همین است) ──────────────────────────────────
    email: {
      provider: (process.env.OTP_EMAIL_PROVIDER || (process.env.OTP_EMAIL_HOST ? 'smtp' : 'none'))
        .trim()
        .toLowerCase(),
      host: process.env.OTP_EMAIL_HOST || '',
      port: num(process.env.OTP_EMAIL_PORT, 465),
      // 465 رمزنگاری‌شده از ابتدا، 587 با STARTTLS
      secure: bool(process.env.OTP_EMAIL_SECURE, num(process.env.OTP_EMAIL_PORT, 465) === 465),
      username: process.env.OTP_EMAIL_USER || '',
      password: process.env.OTP_EMAIL_PASS || '',
      from: process.env.OTP_EMAIL_FROM || process.env.OTP_EMAIL_USER || '',
      fromName: process.env.OTP_EMAIL_FROM_NAME || '',
      rejectUnauthorized: bool(process.env.OTP_EMAIL_TLS_STRICT, true),
    },

    // ── رفتارِ خودِ کد ──────────────────────────────────────────────────────
    codeLength: Math.min(8, Math.max(4, num(process.env.OTP_CODE_LENGTH, 6))),
    codeTtlSeconds: num(process.env.OTP_CODE_TTL, 120),      // اعتبارِ کد
    resendSeconds: num(process.env.OTP_RESEND_SECONDS, 60),  // فاصلهٔ دو درخواست
    maxTries: num(process.env.OTP_MAX_TRIES, 5),             // چند بار غلط زدن
    maxPerHour: num(process.env.OTP_MAX_PER_HOUR, 5),        // سقفِ کد برای هر شماره
    maxPerHourIp: num(process.env.OTP_MAX_PER_HOUR_IP, 30),  // سقفِ کد برای هر IP
    tokenTtlSeconds: num(process.env.OTP_TOKEN_TTL, 30 * 24 * 3600), // اعتبارِ ورود

    // متنِ پیامک و ایمیل — {code} جای کد و {app} جای نامِ برنامه می‌نشیند
    smsText: process.env.OTP_SMS_TEXT || 'کد ورود شما: {code}',
    emailSubject: process.env.OTP_EMAIL_SUBJECT || 'کد ورود: {code}',
    appName: process.env.OTP_APP_NAME || '',

    // پیش‌شمارهٔ کشور برای شماره‌های بدون + (ایران)
    defaultCountry: process.env.OTP_DEFAULT_COUNTRY || '+98',

    // ⚠️ فقط برای آزمایش: کد را در پاسخِ خودِ درخواست هم برمی‌گرداند.
    //    روی سرورِ واقعی هرگز روشنش نکنید.
    echoCode: bool(process.env.OTP_ECHO, false),
  };
}

/** ادغامِ ساده: هر کلیدی که در پنل ذخیره شده، روی .env می‌نشیند */
function merge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = merge(base[key] || {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function otpSettings() {
  return merge(fromEnv(), getSetting(SETTING_KEY, {}) || {});
}

/** ذخیرهٔ تنظیمات از پنل (فقط همان کلیدهایی که فرستاده شده) */
export function saveOtpSettings(patch) {
  const saved = merge(getSetting(SETTING_KEY, {}) || {}, patch || {});
  setSetting(SETTING_KEY, saved);
  return otpSettings();
}

/** نمایش برای پنل — رمزها هرگز بیرون نمی‌روند، فقط «گذاشته شده یا نه» */
export function safeOtpSettings() {
  const s = otpSettings();
  const mask = (v) => (v ? '••••••' : '');
  return {
    ...s,
    sms: { ...s.sms, apiKey: mask(s.sms.apiKey), password: mask(s.sms.password) },
    email: { ...s.email, password: mask(s.email.password) },
    ready: { sms: s.sms.provider !== 'none', email: s.email.provider !== 'none' },
  };
}
