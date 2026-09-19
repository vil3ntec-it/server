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
      /*
       *  بررسیِ گواهیِ TLS روشن است مگر اینکه خودِ صاحبِ سرور خاموشش کرده باشد.
       *
       *  ⚠️ NODE_TLS_REJECT_UNAUTHORIZED=0 یعنی «در کلِ این پروسه گواهی را
       *  نسنج» — قاعدهٔ خودِ Node. اگر این‌جا بی‌قید true می‌گذاشتیم، آن را
       *  فقط برای ایمیل دور می‌زدیم و کسی که روی سرورِ داخلیِ خودش با گواهیِ
       *  خودامضا کار می‌کند، بی‌هیچ توضیحی می‌دید که کدها نمی‌روند.
       */
      rejectUnauthorized: bool(
        process.env.OTP_EMAIL_TLS_STRICT,
        process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
      ),
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
     *  ── سقفِ ساعتی: نگهبانِ سهمیهٔ ایمیلِ شما ─────────────────────────────
     *
     *  ⚠️ این‌ها یک بار تعریف شده بودند (در appauth/settings.js) و موقعِ
     *  یکی کردنِ دو موتور از دست رفتند. اندازه‌اش گرفته شد:
     *
     *      ۱۲ درخواست برای *یک* ایمیل  → ۱ ساخته شد، ۱۱ رد شد   ✔
     *      ۶۰ ایمیلِ *متفاوت* از یک IP → ۶۰ تا در صفِ ارسال رفت  ❗
     *
     *  یعنی فاصلهٔ ۶۰ ثانیه فقط جلوی تکرارِ همان یک ایمیل را می‌گرفت. یک
     *  نفر با شصت ایمیلِ ساختگی می‌توانست در چند ثانیه سهمیهٔ روزانهٔ
     *  جیمیل را بسوزاند — یا بدتر، از سرورِ شما برای ایمیل‌بمبارانِ
     *  دیگران استفاده کند و آبروی دامنه‌تان را ببرد.
     *
     *  دو سقفِ جدا لازم است، چون دو حملهٔ متفاوت‌اند:
     *    • perEmailHour — یک نفر که یک ایمیل را می‌کوبد
     *    • perIpHour    — یک نفر که ایمیل‌های مختلف را می‌کوبد
     *
     *  اعداد سخاوتمندانه‌اند تا کاربرِ عادی هرگز به آن‌ها نخورد: کسی که
     *  کدش نرسیده و سه‌چهار بار دوباره می‌زند، به ۶ نمی‌رسد.
     *  صفر یعنی خاموش.
     */
    perEmailHour: clamp(num(process.env.CODES_MAX_PER_EMAIL_HOUR ?? process.env.OTP_MAX_PER_HOUR, 6), 0, 1000),
    perIpHour: clamp(num(process.env.CODES_MAX_PER_IP_HOUR ?? process.env.OTP_MAX_PER_HOUR_IP, 40), 0, 100000),

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
  const base = fromEnv();
  const saved = getSetting(SETTING_KEY, {}) || {};
  return merge(base, saved);
}

/**
 *  آدرس‌های SMTPِ سرویس‌های مشهور — برای وقتی کسی ایمیلش را جای آدرسِ
 *  سرور می‌گذارد.
 */
const SMTP_OF = {
  'gmail.com': 'smtp.gmail.com',
  'googlemail.com': 'smtp.gmail.com',
  'outlook.com': 'smtp-mail.outlook.com',
  'hotmail.com': 'smtp-mail.outlook.com',
  'live.com': 'smtp-mail.outlook.com',
  'yahoo.com': 'smtp.mail.yahoo.com',
  'zoho.com': 'smtp.zoho.com',
  'yandex.com': 'smtp.yandex.com',
  'icloud.com': 'smtp.mail.me.com',
};

/**
 *  ایراد گرفتن از تنظیماتِ ایمیل، پیش از ذخیره.
 *
 *  ⚠️ چرا لازم شد: در خانهٔ «آدرسِ سرور» ایمیل نوشته شده بود
 *  (vill3ntec@gmail.com به‌جای smtp.gmail.com). سرور همان را به DNS داد،
 *  DNS گفت «چنین نامی نیست» (EAI_FAIL) و تهِ صفحه یک خطای انگلیسیِ خام
 *  دیده می‌شد که هیچ نمی‌گفت چه کار باید کرد.
 *
 *  یک خانهٔ اشتباه، و کلِ کدهای شش‌رقمی از کار افتاده بود. حالا همان‌جا
 *  که ذخیره می‌شود جلویش گرفته می‌شود و گفته می‌شود چه بگذارد.
 *
 *  @returns {{ok: boolean, error?: string, message?: string, suggest?: object}}
 */
export function checkMailSettings(email = {}) {
  const host = String(email.host ?? '').trim();
  if (!host) return { ok: true };

  if (host.includes('@')) {
    const domain = host.split('@').pop().toLowerCase();
    const smtp = SMTP_OF[domain];
    return {
      ok: false,
      error: 'host_is_email',
      message: smtp
        ? `«${host}» ایمیل است، نه آدرسِ سرورِ ایمیل. در خانهٔ آدرس «${smtp}» بگذارید و همین ایمیل را در «نام کاربری».`
        : `«${host}» ایمیل است، نه آدرسِ سرورِ ایمیل. آدرسِ SMTPِ سرویس‌تان را بگذارید (معمولاً mail.${domain} یا smtp.${domain}).`,
      suggest: { host: smtp || `smtp.${domain}`, username: host, from: host },
    };
  }

  if (/^https?:\/\//i.test(host) || host.includes('/')) {
    return {
      ok: false,
      error: 'host_is_url',
      message: 'آدرسِ سرورِ ایمیل، آدرسِ سایت نیست. فقط نام را بگذارید، مثلِ smtp.gmail.com',
      suggest: { host: host.replace(/^https?:\/\//i, '').split('/')[0] },
    };
  }

  /*
   *  ⚠️ جیمیل رمزِ خودِ حساب را قبول نمی‌کند و خطایش هم گنگ است
   *  («Username and Password not accepted»). این را از قبل می‌گوییم.
   */
  const password = String(email.password ?? '');
  const gmail = /(^|\.)gmail\.com$|(^|\.)googlemail\.com$/i.test(host);
  if (gmail && password && !/^•+$/.test(password) && password.replace(/\s/g, '').length !== 16) {
    return {
      ok: false,
      error: 'gmail_needs_app_password',
      message:
        'جیمیل رمزِ خودِ حساب را قبول نمی‌کند. از حسابِ گوگل یک «App Password» بسازید ' +
        '(۱۶ حرف) و همان را این‌جا بگذارید.',
    };
  }

  /*
   *  ⚠️ جیمیل فقط از طرفِ «همان حسابی که وارد شده» ایمیل می‌فرستد.
   *
   *  اگر در خانهٔ «فرستنده» ایمیلِ دیگری بنویسید، جیمیل یا همان‌جا رد
   *  می‌کند یا — بدتر — قبول می‌کند، آدرس را با حسابِ خودش عوض می‌کند و
   *  گیرنده‌های سخت‌گیر پیام را دور می‌ریزند. آن‌وقت این‌طرف همه‌چیز سبز
   *  است و آن‌طرف هیچ ایمیلی نیامده.
   */
  const username = String(email.username ?? '').trim().toLowerCase();
  const from = String(email.from ?? '').trim().toLowerCase();
  if (gmail && username && from && username !== from) {
    /*
     *  ⚠️ این «هشدار» است نه «خطا»، عمداً: اگر آن آدرس را در خودِ گوگل
     *  به‌عنوانِ «Send mail as» تأیید کرده باشید، واقعاً کار می‌کند. پس
     *  جلویش را نمی‌گیریم، فقط می‌گوییم اگر ایمیل‌ها نرسیدند، اول این‌جا
     *  را نگاه کنید.
     */
    return {
      ok: true,
      warn: 'gmail_from_mismatch',
      message:
        `جیمیل فقط از طرفِ «${username}» ایمیل می‌فرستد. در خانهٔ «فرستنده» هم ` +
        `همین را بگذارید، وگرنه ممکن است ایمیل به دستِ بعضی‌ها نرسد.`,
      suggest: { from: username },
    };
  }

  return { ok: true };
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
