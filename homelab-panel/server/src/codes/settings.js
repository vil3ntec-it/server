// ---------------------------------------------------------------------------
//  تنظیماتِ «کدهای شش‌رقمی»
//
//  دو جا خوانده می‌شود: فایل .env (یک‌بار می‌گذارید و تمام) و پنل (هر چه در
//  پنل ذخیره شود روی .env می‌نشیند). نام‌های OTP_EMAIL_* و MAIL_* عمداً همان
//  نام‌های قبلی‌اند تا هر کسی که از قبل ایمیلش را تنظیم کرده، دوباره کار نکند.
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';

const SETTING_KEY = 'codes_settings';

const num = (v, d) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};
const bool = (v, d) => {
  if (v === undefined || v === null || v === '') return d;
  return !['0', 'false', 'no', 'off', 'خیر'].includes(String(v).trim().toLowerCase());
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function fromEnv() {
  const port = num(process.env.OTP_EMAIL_PORT ?? process.env.MAIL_PORT, 465);
  return {
    // ── سرورِ ایمیل ────────────────────────────────────────────────────────
    email: {
      host: process.env.OTP_EMAIL_HOST || process.env.MAIL_HOST || '',
      port,
      // ۴۶۵ از ابتدا رمزنگاری‌شده، ۵۸۷ با STARTTLS
      secure: bool(process.env.OTP_EMAIL_SECURE ?? process.env.MAIL_SECURE, port === 465),
      username: process.env.OTP_EMAIL_USER || process.env.MAIL_USER || '',
      password: process.env.OTP_EMAIL_PASS || process.env.MAIL_PASS || '',
      from:
        process.env.OTP_EMAIL_FROM
        || process.env.MAIL_FROM_ADDRESS
        || process.env.OTP_EMAIL_USER
        || process.env.MAIL_USER
        || '',
      fromName: process.env.OTP_EMAIL_FROM_NAME || process.env.MAIL_FROM_NAME || '',
      rejectUnauthorized: bool(process.env.OTP_EMAIL_TLS_STRICT, true),
    },

    // ── خودِ کد ────────────────────────────────────────────────────────────
    codeLength: clamp(num(process.env.CODES_LENGTH ?? process.env.OTP_CODE_LENGTH, 6), 4, 8),
    ttlSeconds: clamp(num(process.env.CODES_TTL ?? process.env.OTP_CODE_TTL, 120), 30, 3600),
    maxTries: clamp(num(process.env.CODES_MAX_TRIES ?? process.env.OTP_MAX_TRIES, 5), 1, 20),

    /*
     *  فاصلهٔ اجباریِ دو درخواستِ *یک نفر*.
     *
     *  ⚠️ این سقفِ کلی نیست: هزار نفرِ جداگانه هم‌زمان کد می‌گیرند و هیچ‌کدام
     *  پشتِ دیگری نمی‌ماند. این فقط جلوی همان یک نفری را می‌گیرد که دکمه را
     *  پشتِ هم می‌کوبد — وگرنه اعتبارِ ایمیل و آبروی دامنه‌تان می‌رود.
     */
    resendSeconds: clamp(num(process.env.CODES_RESEND_SECONDS, 60), 0, 3600),

    /*
     *  «کدش را نگرفت» — پس از این چند ثانیه، کدِ تازه خودکار ساخته و فرستاده
     *  می‌شود. صفر یعنی خاموش.
     */
    autoResendSeconds: clamp(num(process.env.CODES_AUTO_RESEND_SECONDS, 60), 0, 3600),
    /** هر درخواست حداکثر چند بار خودکار تکرار شود */
    autoResendMax: clamp(num(process.env.CODES_AUTO_RESEND_MAX, 1), 0, 5),

    // ── صف ────────────────────────────────────────────────────────────────
    /** چند ایمیل هم‌زمان برود. سرورهای ایمیل معمولاً بالاتر از ۸ را نمی‌پسندند. */
    workers: clamp(num(process.env.CODES_WORKERS, 4), 1, 32),
    /** هر ارسالِ ناموفق چند بار دوباره تلاش شود */
    sendRetries: clamp(num(process.env.CODES_SEND_RETRIES, 3), 0, 10),

    // ── نگهداری ───────────────────────────────────────────────────────────
    /** ردیفِ مصرف‌شده/منقضی چند دقیقه در فهرست بماند تا در پنل دیده شود */
    keepMinutes: clamp(num(process.env.CODES_KEEP_MINUTES, 60), 1, 24 * 60),

    // ── متن ───────────────────────────────────────────────────────────────
    subject: process.env.CODES_EMAIL_SUBJECT || process.env.OTP_EMAIL_SUBJECT || 'کد ورود: {code}',
    appName: process.env.CODES_APP_NAME || process.env.OTP_APP_NAME || '',
  };
}

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

export function codeSettings() {
  return merge(fromEnv(), getSetting(SETTING_KEY, {}) || {});
}

export function saveCodeSettings(patch) {
  const current = getSetting(SETTING_KEY, {}) || {};
  setSetting(SETTING_KEY, merge(current, patch || {}));
  return codeSettings();
}

/** همان تنظیمات، بدونِ رمزِ ایمیل — چیزی که می‌شود به پنل داد */
export function safeCodeSettings() {
  const s = codeSettings();
  return {
    ...s,
    email: { ...s.email, password: s.email.password ? '••••••••' : '' },
    mailReady: Boolean(s.email.host && s.email.from),
  };
}
