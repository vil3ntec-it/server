// ---------------------------------------------------------------------------
//  «پوسته فقط برای مالک» — S19 ِ ممیزی (۱.۵۰.۷۳)، پشتِ `HLP_SHELL_OWNER_ONLY=1`، پیش‌فرض **خاموش**
//
//  نقشِ `admin` ِ پنل هم‌ارزِ کامپیوتر است: ترمینال، «فرمانِ اجرا» و متغیرهای محیطیِ سایت (‎NODE_OPTIONS‎
//  = اجرای کد) و ریشه‌های فایل‌منیجر (ریشهٔ افزوده، پوشهٔ سایت‌ها، کتابخانه، ریشهٔ سایتِ بیرون از پوشهٔ
//  سایت‌ها) هر کدام به مدیرِ دوم پوسته می‌دهند؛ از همان‌جا `vill3n owner-reset` می‌زند یا `panel.db` و
//  بایگانیِ دفتر را عوض می‌کند. مرزهای «فقط مالک» ِ API در برابرِ پوسته نمی‌ایستند.
//
//  ⚠️ تصمیمِ صاحب محصول است، پس فقط **گزینه** است: خاموش ⇒ رفتارِ پیشین بی کم و زیاد (نقش‌های پیشین
//  سنجیده می‌شوند). روشن ⇒ همهٔ این درها فقط مالک (قدیمی‌ترین مدیرِ فعال، `control/roles.js`) و کلیدِ محلیِ
//  همین کامپیوتر — که خودش دسترسیِ ماشین است. ⛔ مالک هرگز بیرون نمی‌ماند: مالک همیشه وجود دارد تا مدیری
//  فعال هست، و هیچ‌کس نقش، بستن یا حذفِ او را عوض نمی‌کند.
//
//  ⚠️ آن‌چه این گزینه نمی‌بندد (تصمیمِ بعدیِ صاحب محصول): نوشتنِ پرونده در پوشهٔ سایت با فایل‌منیجر و
//  راه‌اندازیِ دوبارهٔ همان سایت — کدِ سایت با کاربرِ سیستم‌عاملِ پنل اجرا می‌شود.
// ---------------------------------------------------------------------------
import { isOwner } from '../control/roles.js';
import { audit } from './audit.js';

export const OWNER_ONLY_MESSAGE =
  'روی این سرور ترمینال، فرمانِ اجرا و متغیرهای محیطیِ سایت و ریشه‌های فایل‌منیجر فقط کارِ مالکِ پنل است (HLP_SHELL_OWNER_ONLY).';

export function shellOwnerOnly() {
  return process.env.HLP_SHELL_OWNER_ONLY === '1';
}

/** این کاربر کارِ «پوسته‌ای» می‌کند؟ گزینه خاموش ⇒ همیشه بله (نقش‌های پیشین جای خود). */
export function shellAllowed(user) {
  if (!shellOwnerOnly()) return true;
  if (user?.local) return true;
  return user?.id != null && isOwner(user.id);
}

/**
 * برای روترهای express: مجاز ⇒ true؛ وگرنه ۴۰۳ ِ `owner_only` + ردیفِ `panel.shell.owner_only` در دفتر و false.
 * @param {string} what نامِ کار، برای دفتر (terminal | site.command | site.env | site.root | file_roots | library)
 */
export function denyUnlessShellAllowed(req, res, what) {
  if (shellAllowed(req.user)) return true;
  audit(req, 'panel.shell.owner_only', { target: what, ok: false, detail: { path: String(req.originalUrl || '').split('?')[0] } });
  res.status(403).json({ ok: false, error: 'owner_only', message: OWNER_ONLY_MESSAGE });
  return false;
}
