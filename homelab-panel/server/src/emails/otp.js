// ---------------------------------------------------------------------------
//  ایمیلِ کدِ ورود
//
//  این فایل فقط متن می‌سازد — نه چیزی می‌فرستد و نه به دیتابیس دست می‌زند.
//  همین جدا بودن باعث می‌شود بشود بدونِ سرورِ ایمیل آزمونش کرد.
//
//  ⚠️ چرا این‌قدر ساده و قدیمی نوشته شده:
//
//    • همهٔ CSS داخلِ style="" هر تگ است. Gmail و Outlook تگِ <style> را
//      از بدنه برمی‌دارند، پس هر چیزی که آن‌جا باشد دور ریخته می‌شود.
//    • چیدمان با <table> است، نه flex و نه grid. Outlook روی ویندوز با
//      موتورِ Word رندر می‌کند و آن دو را اصلاً نمی‌فهمد.
//    • عرضِ ۶۰۰ پیکسل — همان چیزی که در همهٔ کلاینت‌ها بدونِ اسکرولِ افقی
//      جا می‌شود.
//    • هیچ جاوااسکریپتی نیست. هیچ کلاینتِ ایمیلی اجازه‌اش را نمی‌دهد، پس
//      دکمهٔ «کپی» با onclick یک دکمهٔ مرده است. به‌جایش کد در کادری نشسته
//      که با یک لمس انتخاب می‌شود و کنارش نوشته چه کار کند.
//    • هیچ تصویری از بیرون بار نمی‌شود؛ بیشترِ کلاینت‌ها تصویرها را تا
//      اجازهٔ کاربر نمی‌آورند و ایمیل نصفه دیده می‌شود.
// ---------------------------------------------------------------------------

/** رنگ‌ها همان‌هایی که در خودِ برنامه هست */
const C = {
  brand: '#0F62B4',
  brandDark: '#0B4C8C',
  page: '#F2F5FA',
  card: '#FFFFFF',
  ink: '#101A2B',
  inkSoft: '#4A5568',
  inkMuted: '#77839A',
  line: '#DCE3ED',
  codeBg: '#EEF3FB',
};

const FONT = "Tahoma, 'Iranian Sans', 'Segoe UI', Arial, sans-serif";
const MONO = "'Courier New', Consolas, monospace";

/** متنی که کاربر نوشته نباید بتواند از تگ بیرون بزند */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * ایمیلِ کدِ ورود.
 *
 * @param {object} o
 * @param {string|number} o.code     کدِ شش‌رقمی
 * @param {number} [o.minutes]       چند دقیقه معتبر است
 * @param {string} [o.appName]       نامی که در هدر و عنوان می‌نشیند
 * @param {string} [o.actionUrl]     مقصدِ دکمه — اگر ندهی، دکمه نمی‌آید
 * @returns {{subject: string, html: string, text: string}}
 */
export function otpEmail({ code, minutes = 5, appName = 'توحید', actionUrl = '' } = {}) {
  const safeCode = esc(code);
  const safeApp = esc(appName);
  const mins = Number(minutes) > 0 ? Math.round(Number(minutes)) : 5;

  const subject = `کد ورود شما: ${String(code ?? '')} — ${appName}`;

  const button = actionUrl
    ? `
              <tr>
                <td align="center" style="padding: 4px 0 26px 0;">
                  <a href="${esc(actionUrl)}"
                     style="display: inline-block; background: ${C.brand}; color: #FFFFFF;
                            font-family: ${FONT}; font-size: 15px; font-weight: bold;
                            text-decoration: none; padding: 13px 34px; border-radius: 8px;">
                    باز کردن ${safeApp}
                  </a>
                </td>
              </tr>`
    : '';

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${C.page};">

<!-- خطِ پیش‌نمایش: چیزی که در فهرستِ صندوق کنارِ عنوان دیده می‌شود -->
<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">
  کد ورود شما ${safeCode} است و تا ${mins} دقیقه اعتبار دارد.
</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background: ${C.page}; padding: 24px 12px;">
  <tr>
    <td align="center">

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width: 600px; max-width: 100%; background: ${C.card};
                    border-radius: 14px; overflow: hidden;
                    border: 1px solid ${C.line};">

        <!-- هدر -->
        <tr>
          <td align="center"
              style="background: ${C.brand}; padding: 26px 20px;">
            <div style="font-family: ${FONT}; font-size: 21px; font-weight: bold;
                        color: #FFFFFF; direction: rtl;">
              ${safeApp}
            </div>
          </td>
        </tr>

        <!-- بدنه -->
        <tr>
          <td style="padding: 30px 32px 8px 32px; direction: rtl; text-align: right;">
            <div style="font-family: ${FONT}; font-size: 19px; font-weight: bold;
                        color: ${C.ink}; padding-bottom: 10px;">
              کدِ ورود شما
            </div>
            <div style="font-family: ${FONT}; font-size: 14px; line-height: 1.9;
                        color: ${C.inkSoft};">
              این کد را در برنامه بنویسید تا وارد شوید.
            </div>
          </td>
        </tr>

        <!-- کد -->
        <tr>
          <td align="center" style="padding: 22px 32px 10px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="width: 100%; background: ${C.codeBg};
                          border: 1px solid ${C.line}; border-radius: 12px;">
              <tr>
                <td align="center" style="padding: 22px 12px;">
                  <span style="font-family: ${MONO}; font-size: 38px; font-weight: bold;
                               letter-spacing: 10px; color: ${C.brandDark};
                               direction: ltr; unicode-bidi: bidi-override;
                               display: inline-block;">${safeCode}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- راهنمای کپی: جای دکمهٔ جاوااسکریپتی که در ایمیل کار نمی‌کند -->
        <tr>
          <td align="center" style="padding: 0 32px 18px 32px;">
            <div style="font-family: ${FONT}; font-size: 12.5px; color: ${C.inkMuted};
                        direction: rtl;">
              برای کپی، کد را لمس کنید و نگه دارید
            </div>
          </td>
        </tr>
${button}
        <!-- اعتبار -->
        <tr>
          <td style="padding: 0 32px 26px 32px; direction: rtl; text-align: right;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="border-top: 1px solid ${C.line};">
              <tr>
                <td style="padding-top: 18px; font-family: ${FONT}; font-size: 13.5px;
                           line-height: 1.9; color: ${C.inkSoft};">
                  این کد تا <strong style="color: ${C.ink};">${mins} دقیقه</strong> معتبر است.
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- پانویس -->
        <tr>
          <td style="background: ${C.page}; padding: 18px 32px;
                     direction: rtl; text-align: right;
                     border-top: 1px solid ${C.line};">
            <div style="font-family: ${FONT}; font-size: 12px; line-height: 1.9;
                        color: ${C.inkMuted};">
              اگر شما این کد را نخواسته‌اید، این پیام را نادیده بگیرید.
              کسی بدونِ این کد نمی‌تواند وارد شود.
            </div>
          </td>
        </tr>

      </table>

      <div style="font-family: ${FONT}; font-size: 11.5px; color: ${C.inkMuted};
                  padding-top: 14px; direction: rtl;">
        ${safeApp}
      </div>

    </td>
  </tr>
</table>

</body>
</html>`;

  // نسخهٔ متنی — بعضی کلاینت‌ها HTML را نشان نمی‌دهند و بعضی کاربران هم
  // عمداً خاموشش می‌کنند. این باید به‌تنهایی کامل باشد.
  const text = [
    appName,
    '',
    'کدِ ورود شما:',
    String(code ?? ''),
    '',
    `این کد تا ${mins} دقیقه معتبر است.`,
    '',
    'اگر شما این کد را نخواسته‌اید، این پیام را نادیده بگیرید.',
  ].join('\n');

  return { subject, html, text };
}
