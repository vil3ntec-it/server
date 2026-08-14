// ---------------------------------------------------------------------------
//  دامنه‌های قُرق — هرگز رکورد DNS‌شان با تونل بازنویسی نمی‌شود
//
//  چرا لازم است: پنل برای هر دامنه‌ای که به یک سایت وصل شود، دستور
//      cloudflared tunnel route dns --overwrite-dns <tunnel> <host>
//  را می‌زند. سوئیچ ‎--overwrite-dns رکوردِ موجود را بی‌سوال بازنویسی می‌کند.
//  اگر آن رکورد، رکوردِ سایتِ عمومیِ خودمان باشد (yaqobipump.top که روی
//  GitHub Pages به 185.199.x.x اشاره می‌کند) دو اتفاق می‌افتد:
//    ۱) سایت عمومی از دسترس خارج می‌شود،
//    ۲) گیت‌هاب می‌بیند دامنه دیگر به Pages اشاره نمی‌کند و گواهی https آن را
//       برمی‌دارد؛ بعد از آن حتی با برگرداندنِ DNS هم مرورگر خطای
//       NET::ERR_CERT_COMMON_NAME_INVALID می‌دهد تا وقتی دامنه در
//       Settings → Pages دوباره ثبت و گواهی دوباره صادر شود.
//
//  پس این دامنه‌ها در پنل ثبت و بررسی می‌شوند ولی هیچ‌وقت به تونل نمی‌روند.
//  فقط خودِ دامنه قُرق است، نه زیردامنه‌هایش: shop.yaqobipump.top آزاد است.
//
//  قابل تغییر:
//    • تنظیمِ protected_domains  (آرایه‌ای از نام‌ها؛ [] یعنی هیچ قُرقی)
//    • متغیرِ محیطیِ HLP_PROTECTED_DOMAINS (با کاما جدا؛ خالی یعنی هیچ قُرقی)
//  اولویت با متغیرِ محیطی است، بعد تنظیم، بعد فهرستِ پیش‌فرض.
// ---------------------------------------------------------------------------
import { getSetting } from './db.js';

/** دامنهٔ سایتِ عمومیِ پمپ یعقوبی (همان چیزی که در فایل CNAME ریپو هست) */
const DEFAULT_PROTECTED = ['yaqobipump.top'];

function clean(list) {
  return [...new Set(
    (Array.isArray(list) ? list : String(list).split(','))
      .map((x) => String(x || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, ''))
      .filter(Boolean)
  )];
}

/** فهرستِ دامنه‌های قُرق — به ترتیبِ اولویت: محیط ← تنظیم ← پیش‌فرض */
export function protectedHosts() {
  if (process.env.HLP_PROTECTED_DOMAINS != null) return clean(process.env.HLP_PROTECTED_DOMAINS);
  const setting = getSetting('protected_domains', null);
  if (Array.isArray(setting)) return clean(setting);
  return clean(DEFAULT_PROTECTED);
}

/** آیا این دامنه قُرق است؟ (فقط تطابقِ دقیق — زیردامنه‌ها آزادند) */
export function isProtectedHost(host) {
  const name = String(host || '').trim().toLowerCase();
  if (!name) return false;
  return protectedHosts().includes(name);
}
