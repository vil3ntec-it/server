// ---------------------------------------------------------------------------
//  🏪 فهرستِ ماژول‌های بخشِ «فروشگاه» (پوستهٔ کنسولِ مالک) — سمتِ سرورِ پنل، **تنها** جای «کدام ماژول، برای کدام نقش»
//
//  ⛔ این‌جا قاعده است، نه تزئین: پوستهٔ وب (‎web/src/pages/account/console/‎) فقط ماژولی را نشان می‌دهد که
//     ‎GET /api/account-admin/console/modules‎ برای همین نشست برگردانده؛ و همان `minRole` در سرور با
//     `requireModule(id)` روی درهای خودِ ماژول سنجیده می‌شود. آزمونِ ‎test/console-shell.mjs‎ برای هر ماژول
//     دری را که در `probe` آمده با سه نقش می‌زند: زیرِ `minRole` ⇒ ۴۰۳، از `minRole` به بالا ⇒ نه ۴۰۳.
//     یعنی «پنهان» هرگز فقط پنهان نیست — سرور هم نمی‌دهد.
//
//  ── افزودنِ ماژولِ تازه (نقطهٔ گسترش؛ شرحِ کامل: ‎docs/CONSOLE-SHELL-fa.md‎) ─────────────────────────────
//   ۱) یک ردیف این‌جا (یا اگر شناسه‌اش از پیش رزرو شده، همان ردیف را کامل کنید): `id` = ‎?tab=‎ ِ وب، `group`،
//      `order`، `spec` (بندِ پرامپتِ مالک)، `minRole`، `label` سه‌زبانه، `probe` (یک GET ِ واقعیِ خودِ ماژول).
//   ۲) اگر کارتِ داشبورد عدد دارد: `summary(ctx)` — فقط دادهٔ واقعی، با `source`؛ نبود ⇒ پرتاب کنید (کارت «—» می‌شود).
//   ۳) سمتِ وب یک فایل: ‎web/src/pages/account/console/modules/<id>.tsx‎ با `defineModule({ id, … })` — همین.
//   ⛔ شناسه و `minRole` را عوض نکنید مگر آزمونِ نقش را هم؛ ماژولِ بی درِ واقعی (`probe: null`) در وب دیده
//      نمی‌شود تا ساخته شود — هیچ زبانهٔ خالی یا «به‌زودی» ساخته نمی‌شود.
// ---------------------------------------------------------------------------
import { db } from '../db.js';
import * as panelRoles from '../control/roles.js';

/** گروه‌های منوی بخش — به همین ترتیب. */
export const CONSOLE_GROUPS = Object.freeze([
  { id: 'overview', label: { fa: 'نمای کلی', en: 'Overview', ps: 'عمومي کتنه' } },
  { id: 'shops', label: { fa: 'دکان‌ها و مشتری‌ها', en: 'Shops & customers', ps: 'هټۍ او پېرودونکي' } },
  { id: 'money', label: { fa: 'پول', en: 'Money', ps: 'پیسې' } },
  { id: 'market', label: { fa: 'بازار و پیک', en: 'Market & couriers', ps: 'بازار او پېک' } },
  { id: 'ops', label: { fa: 'فنی و عملیات', en: 'Technical & operations', ps: 'تخنیکي او عملیات' } },
  { id: 'control', label: { fa: 'دسترسی و تنظیمات', en: 'Access & settings', ps: 'لاسرسی او تنظیمات' } },
]);

const L = (fa, en, ps) => Object.freeze({ fa, en, ps });

/*
 *  ⚠️ `minRole` = کم‌ترین نقشی که درِ **خواندنیِ** همان ماژول را امروز در سرور می‌گیرد (نه حدس). کارِ نوشتنی
 *  درونِ ماژول نگهبانِ خودش را دارد (admin، و برای کارهای حساس «مالک + احرازِ دوباره»).
 *  نقش‌های پنل امروز سه‌تاست (`control/roles.js`): viewer ≈ «فقط‌خواندن/محدود»، operator ≈ «پشتیبانی/فنی»،
 *  admin ≈ «مدیرِ سیستم»؛ «مالک» = قدیمی‌ترین admin ِ فعال. نقشِ «مالی» فقط در سرورِ حساب هست.
 */
export const CONSOLE_MODULES = Object.freeze([
  { id: 'dash', spec: '4.1', group: 'overview', order: 10, minRole: 'viewer',
    label: L('داشبورد', 'Dashboard', 'ډشبورډ'), probe: '/api/account-admin/console/summary' },

  { id: 'shops', spec: '4.2', group: 'shops', order: 10, minRole: 'viewer',
    label: L('فروشگاه‌های عضو', 'Member shops', 'غړي هټۍ'), probe: '/api/account-admin/shops?limit=1' },
  { id: 'subs', spec: '4.4', group: 'shops', order: 20, minRole: 'viewer',
    label: L('اشتراک و مجوز', 'Subscriptions & licences', 'ګډون او جواز'), probe: '/api/account-admin/shop-desk/groups' },
  { id: 'codes', spec: '', group: 'shops', order: 30, minRole: 'viewer',
    label: L('کدِ شاگرد', 'Staff codes', 'د شاګرد کوډ'), probe: '/api/account-admin/shop-desk/groups' },

  { id: 'finance', spec: '4.5', group: 'money', order: 10, minRole: 'viewer',
    label: L('مالیِ مرکزی', 'Central finance', 'مرکزي مالي'), probe: '/api/account-admin/sales/summary' },

  //  رزرو برای ماژول‌های در دستِ ساخت (۴.۶ و ۴.۷) — بی `probe` در وب دیده نمی‌شوند
  { id: 'market', spec: '4.6', group: 'market', order: 10, minRole: 'viewer',
    label: L('مدیریتِ بازار', 'Marketplace management', 'د بازار مدیریت'), probe: null },
  { id: 'courier', spec: '4.7', group: 'market', order: 20, minRole: 'viewer',
    label: L('نظارتِ پیک', 'Courier monitoring', 'د پېک څارنه'), probe: null },

  { id: 'versions', spec: '4.8', group: 'ops', order: 10, minRole: 'viewer',
    label: L('نسخه‌ها و انتشار', 'Versions & releases', 'نسخې او خپرونه'), probe: '/api/account-admin/console/system/versions' },
  { id: 'health', spec: '4.9 · 4.10', group: 'ops', order: 20, minRole: 'viewer',
    label: L('سلامت و خطاها', 'Health & errors', 'روغتیا او تېروتنې'), probe: '/api/account-admin/console/system/health' },
  //  رزرو (۴.۱۰ جدا و ۴.۱۱) — تا ساخته نشده‌اند، «سلامت و خطاها» خطاها را دارد
  { id: 'errors', spec: '4.10', group: 'ops', order: 30, minRole: 'viewer',
    label: L('خطاها، رخدادها و پشتیبانی', 'Errors, incidents & support', 'تېروتنې، پېښې او ملاتړ'), probe: null },
  { id: 'alerts', spec: '4.11', group: 'ops', order: 40, minRole: 'viewer',
    label: L('هشدارها', 'Alerts', 'خبرتیاوې'), probe: null },

  { id: 'users', spec: '4.3', group: 'control', order: 10, minRole: 'admin',
    label: L('کاربران و نقش‌ها', 'Users & roles', 'کاروونکي او رولونه'), probe: '/api/account-admin/console/admins' },
  { id: 'settings', spec: '4.12', group: 'control', order: 20, minRole: 'viewer',
    label: L('تنظیماتِ مرکزی و پرچم‌ها', 'Central settings & flags', 'مرکزي تنظیمات او بیرغونه'), probe: '/api/account-admin/console/flags' },
  { id: 'integrations', spec: '4.13', group: 'control', order: 30, minRole: 'viewer',
    label: L('یکپارچه‌سازی و API', 'Integrations & APIs', 'یوځای کول او API'), probe: '/api/account-admin/console/system/providers' },
  { id: 'audit', spec: '', group: 'control', order: 40, minRole: 'viewer',
    label: L('دفترِ رخداد', 'Audit log', 'د پېښو دفتر'), probe: '/api/account-admin/account-audit?limit=1' },
]);

const BY_ID = new Map(CONSOLE_MODULES.map((m) => [m.id, m]));
export const moduleById = (id) => BY_ID.get(String(id || '')) || null;

/** مالکِ پنل = قدیمی‌ترین admin ِ فعال — همان قاعدهٔ `ownerId` ِ فاز ۱ (اگر در پایه باشد، از خودش). */
export function panelOwnerId() {
  if (typeof panelRoles.ownerId === 'function') return panelRoles.ownerId();
  return db.prepare("SELECT MIN(id) AS id FROM users WHERE role = 'admin' AND disabled = 0").get()?.id ?? null;
}
export function isPanelOwner(req) {
  const owner = panelOwnerId();
  return owner != null && req?.user?.id != null && Number(req.user.id) === Number(owner);
}

/** ماژول‌هایی که این نقش می‌بیند — به ترتیبِ گروه و `order`. */
export function modulesFor(role) {
  const gi = (g) => CONSOLE_GROUPS.findIndex((x) => x.id === g);
  return CONSOLE_MODULES
    .filter((m) => panelRoles.atLeast(role, m.minRole))
    .sort((a, b) => gi(a.group) - gi(b.group) || a.order - b.order);
}

/**
 * میان‌افزار: درِ این ماژول فقط برای نقشِ دستِ‌کم `minRole` ِ همان ماژول — همان قاعده‌ای که منو را می‌سازد.
 *     router.get('/console/admins', requireModule('users'), …)
 */
export function requireModule(id) {
  const mod = moduleById(id);
  if (!mod) throw new Error(`ماژولِ ناشناخته: ${id}`);
  return panelRoles.requireRole(mod.minRole);
}
