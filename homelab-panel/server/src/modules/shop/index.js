// ---------------------------------------------------------------------------
//  🏪 بخشِ «فروشگاه» — سمتِ سرور: شناسنامه و سوار شدن روی پلِ ‎/api/account-admin‎ (شرح: ‎docs/SHOP-MODULE-fa.md‎)
//
//  پنل این را فقط از ‎src/modules/registry.js‎ می‌شناسد (یک ورود). هر چه ماژول از پنل می‌خواهد از ‎./host.js‎ است و
//  هر چه پنل به ماژول می‌دهد (نگهبان‌های همان روتر) در ‎deps‎ ِ ‎mount‎ — نه وارد کردنِ دوطرفه.
// ---------------------------------------------------------------------------
import { mountConsoleOps } from './routes/console-ops.js';
import { mountConsoleSupportAccess } from './routes/console-support-access.js';
import { mountConsoleShell } from './routes/console-shell.js';
import { MARKET_CAPABILITIES, mountConsoleMarket } from './routes/console-market.js';
import { mountConsoleStaff } from './routes/console-staff.js';
import { mountConsoleImageBank } from './routes/console-image-bank.js';
import { mountConsoleHolidays } from './routes/console-holidays.js';
import { mountConsoleImageChanges } from './routes/console-image-changes.js';
import { mountConsoleSynonyms } from './routes/console-synonyms.js';
import { mountConsoleParity } from './routes/console-parity.js';
import financeRoutes from './routes/account-finance.js';
import { CONSOLE_MODULES } from './console/modules.js';

/**
 *  سوار کردنِ همهٔ درهای ماژول روی روترِ پلِ سرورِ حساب — **همان ترتیبِ** پیش از ۱.۵۱.۰ (ترتیب در اکسپرس معنا دارد).
 *  ‎deps‎ نگهبان‌های همان روتر است: ‎guard‎ (شکلِ خطا)، ‎capabilities‎/‎capListed‎/‎unavailable‎/‎missingErr‎ (توانایی‌های سرورِ
 *  حساب)، ‎badInput‎، ‎stamped‎، ‎actorOf‎ («انجام‌دهنده»)، ‎isPanelOwner‎، ‎reauthLimit‎ + ‎reauth‎ (رمزِ پنل برای کارِ حساس).
 */
export function mount(router, deps) {
  const {
    guard, capabilities, unavailable, missingErr, badInput, stamped, actorOf, isPanelOwner, reauthLimit, reauth, capListed,
  } = deps;
  //  ۴.۸ · ۴.۹ · ۴.۱۰ · ۴.۱۱ · ۴.۱۳ — عملیات
  mountConsoleOps(router, { guard, capabilities, unavailable, missingErr, badInput, stamped, actorOf, isPanelOwner, reauthLimit, reauth });
  //  ۱.۵۰.۹۰ (۲-۹، G1): اجازهٔ موقتِ دسترسیِ پشتیبانی به دادهٔ یک دکان
  mountConsoleSupportAccess(router, { guard, badInput, actorOf, capListed, missingErr, unavailable, isPanelOwner, reauthLimit, reauth });
  //  پوسته: ماژول‌ها، داشبورد، جست‌وجو، کاربران و نقش‌ها، پرچم‌ها
  mountConsoleShell(router);
  //  ۴.۶ مدیریتِ بازار و ۴.۷ نظارت بر پیک
  mountConsoleMarket(router, { capListed });
  //  ممیزی §۳-۴ (۱.۵۰.۷۵): کارکنان/مجوز/دستگاهِ هر دکان و بانکِ عکسِ مرکزی
  mountConsoleStaff(router, { guard, badInput, actorOf, capListed, missingErr });
  mountConsoleImageBank(router, { guard, badInput, actorOf, capListed });
  //  ۱.۵۰.۷۸ (LOC-04): تعطیلاتِ رسمی · ۱.۵۰.۹۶ (IMG-PRO-17): تغییرهای عکس · ۱.۵۰.۸۹: مترادف‌ها
  mountConsoleHolidays(router, { guard, badInput, actorOf, capListed, missingErr, unavailable });
  mountConsoleImageChanges(router, { guard, badInput, actorOf, capListed, missingErr, unavailable });
  mountConsoleSynonyms(router, { guard, badInput, actorOf, capListed, missingErr, unavailable });
  //  ۱.۵۰.۸۰ (S11): کانالِ آزمایشی، نشانیِ دانلود، مصرفِ پیام، پشتیبان‌های هر حساب
  mountConsoleParity(router, { guard, badInput, actorOf, isPanelOwner, reauthLimit, reauth, stamped });
  //  ۴.۵ — مالیِ مرکزی
  router.use('/console/finance', financeRoutes);
}

const shop = Object.freeze({
  id: 'shop',
  /** پیشوندِ درها روی سرورِ پنل — همه زیرِ پلِ ‎/api/account-admin‎ (نقش، فهرستِ سفید، «انجام‌دهنده») */
  apiPrefix: '/api/account-admin/console',
  /** زیرماژول‌های پوسته (‎?tab=‎) با ‎minRole‎ ِ هر کدام — همان که ‎GET /console/modules‎ می‌دهد */
  modules: CONSOLE_MODULES,
  /** توانایی‌های سرورِ حساب که فقط این ماژول می‌خواهد ⇒ در ‎PHASE3‎ ِ پل و ‎GET /console/capabilities‎ */
  capabilities: MARKET_CAPABILITIES,
  mount,
});

export default shop;
