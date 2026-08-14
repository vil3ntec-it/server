// ---------------------------------------------------------------------------
//  «ریشهٔ سایت‌ها» — کجای درایو، پوشهٔ هر سایت ساخته شود
//
//  پیش‌فرض: کنار پوشهٔ سرور نیست، بلکه جای استانداردِ سیستم‌عامل است
//  (ویندوز: C:\Users\<شما>\sites — لینوکس: /sites).
//  ولی خیلی‌ها می‌خواهند همه‌چیز کنارِ خودِ سرور و روی همان درایو باشد؛
//  برای همین از داخل پنل (تنظیمات) قابل تغییر است و لازم نیست کسی فایل
//  .env دست بزند.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, SERVER_ROOT } from '../config.js';
import { getSetting, setSetting, logEvent } from '../db.js';

/** پیشنهادِ «کنارِ خودِ سرور» — همان درایوی که پنل رویش است */
export const NEXT_TO_SERVER = path.join(SERVER_ROOT, 'sites');

/** ریشهٔ فعلی: اگر در پنل تنظیم شده باشد همان، وگرنه پیش‌فرض */
export function sitesRoot() {
  const custom = getSetting('sites_root', null);
  if (custom && typeof custom === 'string' && custom.trim()) {
    return path.resolve(custom.trim());
  }
  return config.sitesRoot;
}

/**
 * ریشه را عوض می‌کند و مطمئن می‌شود واقعاً ساخته می‌شود.
 *
 * عمداً async و با mkdir غیرمسدودکننده: اگر کسی مسیری بدهد که سیستم‌فایل
 * رویش کند یا قفل باشد (مثلاً جایی زیر /proc یا یک درایو شبکهٔ قطع‌شده)،
 * نسخهٔ sync کلِ سرور را می‌خواباند — چون Node تک‌رشته‌ای است.
 */
export async function setSitesRoot(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    setSetting('sites_root', null);
    return { ok: true, sitesRoot: sitesRoot() };
  }

  const resolved = path.resolve(raw);
  try {
    await withTimeout(fsp.mkdir(resolved, { recursive: true }), 'mkdir');
    const stat = await withTimeout(fsp.stat(resolved), 'stat');
    if (!stat.isDirectory()) return { ok: false, error: 'not_a_directory' };
  } catch (e) {
    return { ok: false, error: 'cannot_create', detail: `${resolved} ساخته نشد (${e.code || e.message})` };
  }

  setSetting('sites_root', resolved);
  logEvent('info', 'panel', `ریشهٔ سایت‌ها به ${resolved} تغییر کرد`);
  return { ok: true, sitesRoot: resolved };
}

/** مسیرِ خراب نباید تا ابد منتظر بماند */
function withTimeout(promise, what, ms = 5000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error(`${what}_timeout`), { code: 'ETIMEDOUT' })), ms).unref?.()
    ),
  ]);
}

/** بار اول: ریشه باید وجود داشته باشد تا «افزودن سایت» از همان ابتدا کار کند */
export function ensureSitesRoot() {
  const dir = sitesRoot();
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}
