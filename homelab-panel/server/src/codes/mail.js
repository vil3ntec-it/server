// ---------------------------------------------------------------------------
//  رساندنِ کد به ایمیل — «ربات»
//
//  یک کار می‌کند و همان را درست: ایمیلِ کد را می‌سازد و می‌فرستد. اگر سرورِ
//  ایمیل هنوز تنظیم نشده باشد، صریح می‌گوید — چون کدی که فرستاده نشده باید
//  در پنل دیده شود، نه اینکه کاربر پشتِ صفحهٔ «کد را وارد کنید» بماند.
// ---------------------------------------------------------------------------
import { openMailer, sendMail } from '../appauth/smtp.js';
import { otpEmail } from '../emails/otp.js';
import { brandOf, codeHtml, titleOf } from '../emails/app-templates.js';
import { codeSettings } from './settings.js';

/** {code} و {app} در عنوان جای‌گذاری می‌شوند */
function fill(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, key) =>
    values[key] === undefined || values[key] === null ? m : String(values[key])
  );
}

/** آیا اصلاً می‌شود ایمیل فرستاد؟ */
export function mailReady(settings = codeSettings()) {
  return Boolean(settings.email?.host && settings.email?.from);
}

/**
 * ایمیلِ کد را می‌فرستد.
 *
 * خطا را بالا می‌دهد (نه اینکه بخورد) تا صف بداند باید دوباره تلاش کند و
 * پنل بتواند بگوید دقیقاً چه شد.
 */
/** تنظیماتِ اتصال — جدا شده تا صف بتواند یک اتصال را برای همهٔ ایمیل‌ها نگه دارد */
export function mailerOptions(settings = codeSettings()) {
  return {
    host: settings.email.host,
    port: settings.email.port,
    secure: settings.email.secure,
    username: settings.email.username,
    password: settings.email.password,
    rejectUnauthorized: settings.email.rejectUnauthorized !== false,
  };
}

/**
 * یک اتصالِ بازِ SMTP.
 *
 * ⚠️ صف از این استفاده می‌کند تا برای ده ایمیل، ده بار در نزند. جیمیل
 * روی تعدادِ اتصالِ هم‌زمان سخت‌گیر است و همان بود که باعث می‌شد بعضی
 * کدها بروند و بعضی نه.
 */
export function openCodeMailer(settings = codeSettings()) {
  if (!mailReady(settings)) {
    throw Object.assign(new Error('سرورِ ایمیل تنظیم نشده است'), { code: 'mail_not_configured' });
  }
  return openMailer(mailerOptions(settings));
}

/**
 * خودِ نامه — بدونِ هیچ کاری با شبکه.
 *
 * ⛔ **قالبِ صاحبِ سامانه، نه قالبِ قدیمی** (۱۴۰۵/۰۷/۱۳): ویلن برای پمپ و
 * مرکز فرمان، VILL3N Shop برای فروشگاه (`emails/app-templates.js`). قالبِ
 * `otp.js` فقط وقتی است که فایلِ قالب پیدا نشود — ایمیل نرفتن بدتر از
 * ایمیلِ قدیمی است.
 *
 * ⛔ **کد نه در عنوان است، نه در خطِ پیش‌نمایش، نه در خطِ نخستِ متن**:
 * «توی اعلانات کدی نباشد؛ روی ایمیل که کلیک کند، کد آن‌جا نشان داده شود.»
 * عنوانی که در تنظیمات `{code}` دارد، بی کد فرستاده می‌شود.
 */
export function buildCodeMail({ to, code, name = '', app = '', appName, subject, minutes, settings = codeSettings() }) {
  const label = appName || settings.appName || 'مرکز فرمان';
  const key = app || label;
  const styled = codeHtml({ app: key, code });
  const built = styled ? null : otpEmail({ code, minutes, appName: label, name });
  const custom = fill(String(subject || settings.subject || '').replace(/[:：\-–—]?\s*\{code\}\s*/g, ' '), { app: label })
    .replace(/\s+/g, ' ').trim();
  const line = (custom && custom !== 'کد ورود') ? custom : (titleOf(key) || `کد ورود ${label}`);
  const mins = Number(minutes) > 0 ? Math.round(Number(minutes)) : 10;
  return {
    from: settings.email.from,
    fromName: settings.email.fromName || brandOf(key) || label,
    to,
    subject: line,
    text: `کدِ ورودِ شما در ادامه است.\n\n${code}\n\nاین کد ${mins} دقیقه اعتبار دارد و فقط یک بار کار می‌کند. اگر شما درخواستش نکرده‌اید، این ایمیل را نادیده بگیرید.`,
    html: styled || built.html,
  };
}

export async function sendCodeEmail({
  to, code, name = '', app = '', appName, subject, minutes, settings = codeSettings(), mailer = null,
}) {
  if (!mailReady(settings)) {
    throw Object.assign(new Error('سرورِ ایمیل تنظیم نشده است'), { code: 'mail_not_configured' });
  }

  const letter = buildCodeMail({ to, code, name, app, appName, subject, minutes, settings });

  // اتصالِ آماده داده‌اند؟ از همان برو. وگرنه یکی باز و بسته کن.
  const receipt = mailer
    ? await mailer.send(letter)
    : await sendMail({ ...mailerOptions(settings), ...letter });

  /*
   *  رسیدِ سرورِ ایمیل را بالا می‌دهیم، نه یک true خشک.
   *
   *  ⚠️ چرا مهم است: «فرستادم» بدونِ رسید، حرف است. با رسید معلوم می‌شود
   *  که طرفِ مقابل واقعاً پیام را گرفته — و اگر باز هم به دستِ کاربر
   *  نرسیده، دنبالِ اسپم و برگشت بگردیم، نه دنبالِ این سرور.
   */
  return { sent: true, response: receipt?.response || '' };
}
