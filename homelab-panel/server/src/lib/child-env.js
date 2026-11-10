// ---------------------------------------------------------------------------
//  محیطِ پایهٔ پروسه‌های فرزند — بی رازهای پنل (۱.۵۰.۸۳، S4/۶-۶)
//
//  سایت‌ها (`sites/workspace.js`) و ترمینال (`system/terminal.js`) تا امروز کلِ `process.env` را به فرزند
//  می‌دادند — از جمله رازهای خودِ پنل: کلیدِ امضای نشست (`HLP_SECRET_KEY`)، رمزِ مدیرِ اولیه، رمزِ مدیرِ سرورِ
//  حساب، توکنِ آینه و رمزِ SMTP. کدِ سایت با کاربرِ سیستم‌عاملِ پنل اجرا می‌شود؛ با این کلید می‌شد توکنِ پنل جعل
//  کرد. سرورِ حساب از ۱.۵۰ همهٔ `HLP_*` را از فرزندش می‌انداخت (`account/supervisor.js`) — این همان درس برای
//  سایت و ترمینال، با فهرستِ صریحِ رازها تا متغیرهای بی‌خطرِ محیط (PATH، HOME، …) دست‌نخورده بمانند.
// ---------------------------------------------------------------------------

/** نامِ متغیرهای محیطی که رازند و نباید به هیچ فرزندی برسند. */
export const PANEL_SECRET_ENV = Object.freeze([
  'HLP_SECRET_KEY',
  'HLP_ADMIN_PASSWORD',
  'HLP_ACCOUNT_ADMIN_PASSWORD',
  'HLP_SITESYNC_TOKEN',
  'HLP_LEGACY_TOKEN',
  'HLP_TLS_KEY',
  'OTP_EMAIL_PASS',
  'OTP_SMS_PASS',
  'OTP_SMS_KEY',
  'MAIL_PASS',
]);

const SECRET_SET = new Set(PANEL_SECRET_ENV);

/**
 * `process.env` بی رازهای پنل، به‌علاوهٔ مقدارهای `extra` (که جلوتر می‌نشینند).
 * @param {Record<string,string>} [extra]
 */
export function childBaseEnv(extra = {}) {
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!SECRET_SET.has(k)) out[k] = v;
  }
  return { ...out, ...extra };
}
