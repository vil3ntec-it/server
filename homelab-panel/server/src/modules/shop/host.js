// ---------------------------------------------------------------------------
//  🏪 میزبانِ سمتِ سرورِ بخشِ «فروشگاه» — **تنها** درِ این ماژول به پنل (شرح: ‎docs/SHOP-MODULE-fa.md‎)
//
//  ⛔ هیچ فایلی در ‎src/modules/shop/‎ جز همین فایل چیزی از پنل وارد نمی‌کند؛ فقط از ‎./‎ ِ خودِ ماژول، از همین
//     ‎host.js‎، از ‎node:*‎ و از بسته‌های npm. سنجه: ‎test/module-boundary.mjs‎ (در ‎npm test‎).
//  ⛔ قراردادِ سرورِ حساب همان است: ماژول خودش به سرورِ حساب وصل نمی‌شود — از همان پلِ پنل (کلیدِ سرویس، فهرستِ سفید،
//     «انجام‌دهنده») می‌رود. جدا کردنِ ماژول یعنی دادنِ همین چند نام از جای دیگر.
// ---------------------------------------------------------------------------

/* ── ۱) دفتر و تنظیمات (‎SQLite‎ ِ پنل) ─────────────────────────────────────────────────────────── */
export { db, getSetting, setSetting } from '../../db.js';

/* ── ۲) کاربر و نقشِ همین نشست، و «احرازِ دوباره» ِ کارِ حساس ──────────────────────────────────── */
export * as panelRoles from '../../control/roles.js';
export { requireRole, roleOf } from '../../control/roles.js';
export * as panelAuth from '../../auth.js';

/* ── ۳) دفترِ رخدادِ پنل ─────────────────────────────────────────────────────────────────────── */
export { audit } from '../../control/audit.js';

/* ── ۴) پلِ سرورِ حساب (کلیدِ سرویس، مهلت‌ها، شکلِ خطا) — همان پلی که پمپ هم دارد ───────────────── */
export {
  bridgeTimeouts, cloudCall, cloudRaw, cloudRawBytes, cloudRawText, cloudStatus, legacyAvailable, serviceKeyStatus,
} from '../../stations/cloud.js';
export { bridgeFail } from '../../account/bridge-fail.js';
export { ACCOUNT_PREFIXES, accountApiUrl } from '../../api/account-proxy.js';

/* ── ۵) نگهبان‌های نوشتن: سقفِ نرخ و کلیدِ یکتایی ───────────────────────────────────────────────── */
export { rateLimit } from '../../platform/rate-limit.js';
export { checkIdemKey, makeIdemOnce, makeUpstreamOnce, serverPathFor, upstreamKey } from '../../account/idem-once.js';

/* ── ۶) نسخهٔ پنل و هشدارِ تلگرامِ مالک (رباتِ تلگرامِ پنل مشترک است) ─────────────────────────────── */
export { versionInfo } from '../../version.js';
export { CONSOLE_ALERT_RULES, consoleAlertPrefs, setConsoleAlertPrefs } from '../../support/telegram-console-alerts.js';
