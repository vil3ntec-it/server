// ---------------------------------------------------------------------------
//  ایمیلِ کدِ شش‌رقمی — قالبِ VILL3N
//
//  ⚠️ این فایل «طراحی» نمی‌کند. قالبِ HTML عیناً همانی است که شما دادید؛
//  اینجا فقط پنج جای‌خالیِ آن پُر می‌شود:
//
//      {{NAME}}        نامِ خودِ همان شخص
//      {{CODE}}        کدِ شش‌رقمیِ خودِ همان شخص
//      {{MINUTES}}     چند دقیقه معتبر است
//      {{VERIFY_URL}}  لینکِ دکمهٔ «تأیید حساب کاربری»
//      {{SITE_URL}}    لینکِ VILL3N در پاورقی
//      {{YEAR}}        سالِ جاری
//
//  هیچ رنگ، فاصله، گرادیان یا نوشته‌ای دست‌کاری نشده است. اگر روزی قالب
//  عوض شد، فقط همین فایل را با فایلِ تازه جایگزین کنید و جای‌خالی‌ها را
//  سرِ جایشان بگذارید.
//
//  ⚠️ یک نکتهٔ بیرونی که باید بدانید: جیمیل `linear-gradient` را از ایمیل
//  دور می‌ریزد. یعنی همین قالب در مرورگر شیبِ نارنجی→بنفش دارد و در جیمیل
//  همان جاها تخت دیده می‌شود. این کارِ جیمیل است، نه تغییرِ ما.
// ---------------------------------------------------------------------------

/** نشانیِ سایت، وقتی صدازننده چیزی نداده باشد */
const DEFAULT_SITE = 'https://vill3n.top';

/** هر چیزی که به HTML می‌رود، اول بی‌خطر می‌شود */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * فقط http و https.
 *
 * ⚠️ بدونِ این، یک نشانیِ `javascript:...` می‌توانست از تنظیمات تا دکمهٔ
 * داخلِ ایمیل برود.
 */
function safeUrl(value, fallback = DEFAULT_SITE) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch { /* نشانی نبود */ }
  return fallback;
}

/**
 * ایمیلِ کدِ ورود.
 *
 * @param {object} o
 * @param {string|number} o.code   کدِ شش‌رقمیِ همین شخص
 * @param {number} [o.minutes]     چند دقیقه معتبر است
 * @param {string} [o.appName]     نامِ برنامه، فقط برای عنوانِ ایمیل
 * @param {string} [o.name]        نامِ همین شخص
 * @param {string} [o.actionUrl]   لینکِ دکمه
 * @param {string} [o.siteUrl]     لینکِ پاورقی
 * @returns {{subject:string, html:string, text:string}}
 */
export function otpEmail({
  code,
  minutes = 5,
  appName = 'VILL3N',
  name = '',
  actionUrl = '',
  siteUrl = '',
} = {}) {
  const safeCode = esc(code);
  const mins = Number.isFinite(Number(minutes)) && Number(minutes) > 0 ? Math.round(Number(minutes)) : 5;
  const who = esc(String(name || '').trim());
  const site = safeUrl(siteUrl, DEFAULT_SITE);
  const verify = safeUrl(actionUrl, site);
  const year = new Date().getFullYear();

  /*
   *  قالب می‌گوید «{{NAME}} عزیز، به VILL3N خوش آمدید».
   *  اگر نامی نداشته باشیم، جملهٔ «عزیز،» بی‌صاحب می‌ماند — پس همان
   *  تکه حذف می‌شود و بقیهٔ جمله دست‌نخورده می‌ماند.
   */
  const greeting = who ? `${who} عزیز، به VILL3N خوش آمدید` : 'به VILL3N خوش آمدید';

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>به VILL3N خوش آمدید</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:0;background:#f6e3d8;-webkit-text-size-adjust:100%;}
  table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
  a{text-decoration:none;}
  .otp{-webkit-user-select:all;user-select:all;cursor:text;}
  @media (max-width:620px){
    .wrap{width:100% !important;}
    .px{padding-left:20px !important;padding-right:20px !important;}
    .cardpad{padding:30px 20px 26px !important;}
    .otp{font-size:40px !important;letter-spacing:8px !important;padding:12px 18px 12px 26px !important;}
    .h1{font-size:25px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f6e3d8;">

<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f6e3d8;">
  کد تأیید حساب شما در VILL3N: ${safeCode}
  &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
</div>

<table role="presentation" width="100%" bgcolor="#f6e3d8" style="background:#f6e3d8;">
<tr><td align="center" style="padding:0;">

<table role="presentation" class="wrap" width="600" bgcolor="#f6e3d8" style="width:600px;max-width:600px;background:#f6e3d8;">

  <!-- هدر رنگی -->
  <tr><td class="px" align="center" bgcolor="#e8458b"
          style="padding:40px 40px 34px;background:#e8458b;background-image:linear-gradient(90deg,#ff7a59 0%,#e8458b 50%,#7b3fe4 100%);">
    <p dir="ltr" style="margin:0 0 20px;font-family:'Vazirmatn',Arial,sans-serif;font-size:26px;font-weight:900;letter-spacing:4px;color:#ffffff;">VILL3N</p>
    <table role="presentation" align="center"><tr>
      <td width="96" height="96" align="center" valign="middle"
          style="width:96px;height:96px;border-radius:28px;background:rgba(255,255,255,.2);box-shadow:0 12px 30px rgba(43,22,64,.25);">
        <!-- آیکون پاکت نامه با CSS (بدون تصویر و ایموجی) -->
        <div style="width:56px;height:40px;margin:0 auto;border:3px solid #ffffff;border-radius:9px;overflow:hidden;font-size:0;line-height:0;">
          <div style="width:0;height:0;margin:0 auto;border-left:28px solid transparent;border-right:28px solid transparent;border-top:22px solid #ffffff;"></div>
        </div>
      </td>
    </tr></table>
    <h1 class="h1" style="margin:20px 0 0;font-family:'Vazirmatn',Tahoma,Arial,sans-serif;font-size:30px;line-height:1.5;font-weight:900;color:#ffffff;">
      ${greeting}
    </h1>
  </td></tr>

  <!-- کارت کد (نیمه‌ی بالایی روی رنگ هدر) -->
  <tr><td class="px" bgcolor="#f6e3d8"
          style="padding:0 38px;background:#f6e3d8;background-image:linear-gradient(#f6e3d8,#f6e3d8),linear-gradient(90deg,#ff7a59 0%,#e8458b 50%,#7b3fe4 100%);background-size:100% 100%,100% 70px;background-position:0 70px,0 0;background-repeat:no-repeat;">
    <table role="presentation" width="100%">
      <tr><td class="cardpad" align="center" bgcolor="#ffffff"
              style="background:#ffffff;border-radius:28px;padding:36px 36px 32px;box-shadow:0 20px 50px rgba(123,63,228,.18);">
        <p style="margin:0 0 20px;font-family:'Vazirmatn',Tahoma,Arial,sans-serif;font-size:16px;line-height:2;color:#4a3b52;">
          برای فعال‌سازی حساب کاربری خود، کد زیر را وارد کنید:
        </p>
        <table role="presentation"><tr>
          <td bgcolor="#e8458b" style="padding:3px;border-radius:22px;background:#e8458b;background-image:linear-gradient(90deg,#ff7a59,#e8458b,#7b3fe4);">
            <div dir="ltr" class="otp"
                 style="background:#ffffff;border-radius:19px;padding:14px 30px 14px 44px;font-family:'SF Mono',Menlo,Consolas,'Courier New',monospace;font-size:54px;line-height:1.2;font-weight:700;letter-spacing:14px;color:#2b1640;-webkit-user-select:all;user-select:all;">${safeCode}</div>
          </td>
        </tr></table>
        <p style="margin:14px 0 0;font-family:'Vazirmatn',Tahoma,Arial,sans-serif;font-size:13px;line-height:1.9;color:#7a6a82;">
          برای کپی، روی کد بزنید. این کد تا ${mins} دقیقه معتبر است.
        </p>
        <table role="presentation" style="margin-top:22px;"><tr>
          <td align="center" bgcolor="#2b1640" style="border-radius:40px;background:#2b1640;">
            <a href="${esc(verify)}" target="_blank"
               style="display:inline-block;padding:15px 44px;font-family:'Vazirmatn',Tahoma,Arial,sans-serif;font-size:17px;font-weight:700;color:#ffffff;border-radius:40px;">
              تأیید حساب کاربری
            </a>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  <!-- پیام -->
  <tr><td class="px" style="padding:38px 58px 0;font-family:'Vazirmatn',Tahoma,Arial,sans-serif;text-align:right;">
    <p style="margin:0 0 14px;font-size:22px;font-weight:900;color:#2b1640;">سپاس از انتخاب شما</p>
    <p style="margin:0 0 14px;font-size:16px;line-height:2.1;color:#4a3b52;">
      از اینکه VILL3N را برای خریدهای خود انتخاب کرده‌اید، سپاسگزاریم.
      این انتخاب نشان می‌دهد که برای شما کیفیت و اطمینان اهمیت دارد؛
      همان اصولی که VILL3N بر پایه‌ی آن‌ها بنا شده است.
    </p>
    <p style="margin:0 0 14px;font-size:16px;line-height:2.1;color:#4a3b52;">
      VILL3N با اعتبار مشتریانش ساخته شده و با اعتبار شما مسیر خود را ادامه می‌دهد.
      به پشتوانه‌ی همین اعتماد، متعهدیم هر سفارش را با سرعت، امنیت کامل و دقتی حرفه‌ای انجام دهیم
      و هر روز استاندارد خدمات خود را بالاتر ببریم.
    </p>
    <p style="margin:0;font-size:15px;font-weight:700;color:#2b1640;">با احترام،<br>تیم VILL3N</p>
  </td></tr>

  <!-- ویژگی‌ها -->
  <tr><td class="px" style="padding:28px 38px 0;">
    <table role="presentation" width="100%">
      <tr><td style="padding:0 0 12px;">
        <table role="presentation" width="100%"><tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:18px;padding:14px 16px;">
          <table role="presentation" width="100%"><tr>
            <td width="44" valign="middle" style="width:44px;">
              <div style="width:44px;height:44px;border-radius:14px;background:#ffe9e1;text-align:center;line-height:44px;font-size:20px;">&#9889;</div>
            </td>
            <td valign="middle" style="padding-right:14px;font-family:'Vazirmatn',Tahoma,Arial,sans-serif;text-align:right;">
              <div style="font-size:15px;font-weight:700;color:#2b1640;">تحویل در چند ثانیه</div>
              <div style="font-size:13px;line-height:1.8;color:#7a6a82;">سفارش شما بلافاصله پس از پرداخت تحویل داده می‌شود.</div>
            </td>
          </tr></table>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0 0 12px;">
        <table role="presentation" width="100%"><tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:18px;padding:14px 16px;">
          <table role="presentation" width="100%"><tr>
            <td width="44" valign="middle" style="width:44px;">
              <div style="width:44px;height:44px;border-radius:14px;background:#fde4f0;text-align:center;line-height:44px;font-size:20px;">&#128737;</div>
            </td>
            <td valign="middle" style="padding-right:14px;font-family:'Vazirmatn',Tahoma,Arial,sans-serif;text-align:right;">
              <div style="font-size:15px;font-weight:700;color:#2b1640;">پرداخت امن</div>
              <div style="font-size:13px;line-height:1.8;color:#7a6a82;">تراکنش‌ها با استانداردهای امنیتی معتبر انجام می‌شوند.</div>
            </td>
          </tr></table>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0;">
        <table role="presentation" width="100%"><tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:18px;padding:14px 16px;">
          <table role="presentation" width="100%"><tr>
            <td width="44" valign="middle" style="width:44px;">
              <div style="width:44px;height:44px;border-radius:14px;background:#ece3fc;text-align:center;line-height:44px;font-size:20px;">&#128172;</div>
            </td>
            <td valign="middle" style="padding-right:14px;font-family:'Vazirmatn',Tahoma,Arial,sans-serif;text-align:right;">
              <div style="font-size:15px;font-weight:700;color:#2b1640;">پشتیبانی حرفه‌ای</div>
              <div style="font-size:13px;line-height:1.8;color:#7a6a82;">تیم پشتیبانی در تمام ساعات پاسخگوی شماست.</div>
            </td>
          </tr></table>
        </td></tr></table>
      </td></tr>
    </table>
  </td></tr>

  <!-- فوتر -->
  <tr><td class="px" align="center" style="padding:30px 40px 40px;font-family:'Vazirmatn',Tahoma,Arial,sans-serif;font-size:12px;line-height:2;color:#7a6a82;">
    این کد را در اختیار هیچ‌کس قرار ندهید؛ VILL3N هرگز کد تأیید را از شما درخواست نمی‌کند.
    اگر این درخواست از طرف شما نبوده است، این ایمیل را نادیده بگیرید.
    <div style="margin-top:10px;">
      <a href="${esc(site)}" style="color:#c2185b;font-weight:700;">VILL3N</a> &copy; ${year} | <a href="mailto:vil3ntec@gmail.com" style="color:#c2185b;">vil3ntec@gmail.com</a>
    </div>
  </td></tr>

</table>

</td></tr>
</table>
</body>
</html>`;

  /*
   *  نسخهٔ متنی — برای کلاینت‌هایی که HTML نشان نمی‌دهند و برای فیلترهای
   *  هرزنامه که ایمیلِ بی‌متن را بدگمان می‌بینند.
   */
  const text = [
    who ? `${who} عزیز، به VILL3N خوش آمدید` : 'به VILL3N خوش آمدید',
    '',
    `کد تأیید شما: ${code}`,
    `این کد تا ${mins} دقیقه معتبر است.`,
    '',
    'این کد را در اختیار هیچ‌کس قرار ندهید؛ VILL3N هرگز کد تأیید را از شما درخواست نمی‌کند.',
    'اگر این درخواست از طرف شما نبوده است، این ایمیل را نادیده بگیرید.',
  ].join('\n');

  return {
    subject: `کد تأیید ${appName || 'VILL3N'}: ${code}`,
    html,
    text,
  };
}

export default otpEmail;
