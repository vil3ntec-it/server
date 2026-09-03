// ---------------------------------------------------------------------------
//  فرستادنِ دستیِ کدِ ورود
//
//  ⚠️ چرا لازم شد: تا وقتی سرویسِ ایمیل تنظیم نشده، مشتری کد را نمی‌گیرد و
//  پشتِ صفحهٔ ورود می‌ماند. تنها راهِ قبلی این بود که صاحبِ سرور کد را از لاگ
//  پیدا کند — کاری که وسطِ کارِ دکان شدنی نیست.
//
//  این‌جا کد ساخته می‌شود و همراهش یک لینکِ آماده برمی‌گردد: با یک کلیک،
//  Gmail یا هر برنامهٔ ایمیلی باز می‌شود، گیرنده و موضوع و متن پر است، و فقط
//  «فرستادن» مانده.
//
//  کد در دیتابیس مثلِ همیشه فقط hash می‌شود؛ خودش هیچ‌جا نوشته و لاگ نمی‌شود
//  و تنها در همان یک پاسخِ API به مدیر برمی‌گردد.
// ---------------------------------------------------------------------------
import { sendCode } from './otp.js';
import { otpEmail } from '../emails/otp.js';
import { mailSettings } from './settings.js';

/** متنِ کوتاه برای پیامک یا واتس‌اپ — جایی که HTML معنی ندارد */
function shortText({ code, minutes, appName }) {
  return `${appName}\nکد ورود شما: ${code}\nتا ${minutes} دقیقه معتبر است.`;
}

/**
 * کد را می‌سازد و راه‌های فرستادنِ دستی را برمی‌گرداند.
 *
 * @returns {{code, minutes, to, subject, body, mailto, gmail, whatsapp}}
 */
export async function makeManualCode({ method, value, name }) {
  const made = await sendCode({ method, value, name, deliver: false });
  const appName = mailSettings().fromName || 'توحید';
  const { subject, text } = otpEmail({ code: made.code, minutes: made.minutes, appName });

  const to = made.contact;
  const body = method === 'email' ? text : shortText({ code: made.code, minutes: made.minutes, appName });

  return {
    code: made.code,
    minutes: made.minutes,
    to,
    subject,
    body,
    // برنامهٔ ایمیلِ خودِ کامپیوتر
    mailto: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    // جیمیل در مرورگر — برای کسی که Outlook نصب ندارد
    gmail:
      'https://mail.google.com/mail/?view=cm&fs=1'
      + `&to=${encodeURIComponent(to)}`
      + `&su=${encodeURIComponent(subject)}`
      + `&body=${encodeURIComponent(body)}`,
    // واتس‌اپ — وقتی نشانی شماره است
    whatsapp: method === 'phone'
      ? `https://wa.me/${String(to).replace(/\D/g, '')}?text=${encodeURIComponent(body)}`
      : null,
  };
}
