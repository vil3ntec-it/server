// ---------------------------------------------------------------------------
//  رساندنِ کد به ایمیل — «ربات»
//
//  یک کار می‌کند و همان را درست: ایمیلِ کد را می‌سازد و می‌فرستد. اگر سرورِ
//  ایمیل هنوز تنظیم نشده باشد، صریح می‌گوید — چون کدی که فرستاده نشده باید
//  در پنل دیده شود، نه اینکه کاربر پشتِ صفحهٔ «کد را وارد کنید» بماند.
// ---------------------------------------------------------------------------
import { sendMail } from '../appauth/smtp.js';
import { otpEmail } from '../emails/otp.js';
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
export async function sendCodeEmail({ to, code, appName, subject, minutes, settings = codeSettings() }) {
  if (!mailReady(settings)) {
    throw Object.assign(new Error('سرورِ ایمیل تنظیم نشده است'), { code: 'mail_not_configured' });
  }

  const name = appName || settings.appName || 'مرکز فرمان';
  const built = otpEmail({ code, minutes, appName: name });
  const line = fill(subject || settings.subject, { code, app: name }) || built.subject;

  await sendMail({
    host: settings.email.host,
    port: settings.email.port,
    secure: settings.email.secure,
    username: settings.email.username,
    password: settings.email.password,
    from: settings.email.from,
    fromName: settings.email.fromName || name,
    rejectUnauthorized: settings.email.rejectUnauthorized !== false,
    to,
    subject: line,
    text: built.text,
    html: built.html,
  });

  return { sent: true };
}
