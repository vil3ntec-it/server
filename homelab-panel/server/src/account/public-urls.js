// ---------------------------------------------------------------------------
//  نشانی‌های عمومیِ سرورِ حساب (۱.۵۰.۹۹) — ‎PUBLIC_BASE_URLS‎ ِ پروسهٔ فرزند
//
//  برنامه‌های دکان (و ‎config/server‎ ِ سرورِ حساب) فهرستِ نشانی‌های همین سرورِ حساب را از این متغیر می‌خوانند ⇒ دامنهٔ
//  تازه بی ساختِ دوبارهٔ برنامه می‌رسد. ترتیب: نامِ اصلی، بعد نام‌های افزودهٔ صاحب‌کار (`app_hostnames`)، بعد ‎api.<دامنه>‎ ِ
//  خودکار (`tunnel.js` ⇐ `apiHostnames`). دامنهٔ قُرق هرگز نه.
//  ⛔ فقط نامِ میزبان — هیچ راز، توکن یا پورتی در این فهرست نیست (مقدارش به صفحهٔ مالک هم نشان داده می‌شود).
//  ⛔ import فقط db/config/tunnel/protected-hosts ⇒ ناظرِ سرورِ حساب (`supervisor.js`) بی چرخه می‌خواندش.
// ---------------------------------------------------------------------------
import { db } from '../db.js';
import { config } from '../config.js';
import { apiHostnames } from '../tunnel.js';
import { isProtectedHost } from '../protected-hosts.js';

export const ACCOUNT_APP = 'account-server';

/** ردیف‌های `app_hostnames` ِ یک برنامه (جدولِ نبوده ⇒ هیچ) */
export function aliasRows(appId) {
  try {
    return db.prepare('SELECT id, app_id, hostname, is_primary, move_id, created_at, created_by FROM app_hostnames WHERE app_id = ? ORDER BY is_primary DESC, created_at, id')
      .all(String(appId));
  } catch {
    return [];
  }
}

/** همهٔ نام‌های سرورِ حساب، نامِ اصلی اول: ‎[{ hostname, primary, auto }]‎ */
export function accountHostList() {
  const rows = aliasRows(ACCOUNT_APP);
  let auto = [];
  try { auto = apiHostnames(); } catch { auto = []; }
  const seen = new Set();
  const list = [];
  const push = (hostname, extra) => {
    const h = String(hostname || '').toLowerCase();
    if (!h || seen.has(h) || isProtectedHost(h)) return;
    seen.add(h);
    list.push({ hostname: h, ...extra });
  };
  const explicitPrimary = rows.find((r) => r.is_primary);
  //  نامِ اصلیِ پیش‌فرض: صریح ⇐ ‎HLP_API_DOMAIN/HLP_DOMAIN‎ ⇐ نخستین خودکار ⇐ نخستین افزوده
  const configured = config.domains?.configured ? config.domains.api : null;
  const autoSorted = configured && auto.includes(configured) ? [configured, ...auto.filter((h) => h !== configured)] : auto;
  if (explicitPrimary) push(explicitPrimary.hostname, { primary: true, auto: false });
  else if (autoSorted.length) push(autoSorted[0], { primary: true, auto: true });
  for (const r of rows) push(r.hostname, { primary: !list.length, auto: false });
  for (const h of autoSorted) push(h, { primary: !list.length, auto: true });
  return list;
}

/** ‎https://<نام>‎ ِ هر کدام، نامِ اصلی اول */
export function accountPublicBaseUrls() {
  return accountHostList().map((h) => `https://${h.hostname}`);
}
