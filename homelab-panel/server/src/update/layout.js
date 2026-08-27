// ---------------------------------------------------------------------------
//  چیدمانِ نصب — به‌روزرسانی باید بداند فایل‌ها واقعاً کجا می‌نشینند
//
//  دو چیدمان وجود دارد:
//
//  repo (پیش‌فرض)   نصبِ معمولی از روی خودِ مخزن. درختِ بستهٔ GitHub همان‌طور
//                   که هست روی ریشهٔ نصب می‌نشیند.
//
//  packaged         برنامهٔ ویندوز. سرور داخلِ resources/server است، نه
//                   homelab-panel/server، و پوستهٔ برنامه اصلاً جای دیگری
//                   است. بدونِ این نگاشت، به‌روزرسانی فایل‌ها را کنارِ
//                   برنامه می‌ریخت و چیزی که واقعاً اجرا می‌شود عوض نمی‌شد.
// ---------------------------------------------------------------------------
import path from 'node:path';
import { SERVER_ROOT as REAL_SERVER_ROOT } from '../config.js';

export const LAYOUT = process.env.HLP_APP_LAYOUT === 'packaged' ? 'packaged' : 'repo';

/**
 * ریشهٔ سرور برای به‌روزرسانی. در عمل همان جایی است که سرور از آن اجرا می‌شود؛
 * HLP_SERVER_ROOT فقط برای آزمون است تا نصبِ ساختگی روی سورسِ واقعی ننشیند.
 */
export const SERVER_ROOT = path.resolve(process.env.HLP_SERVER_ROOT || REAL_SERVER_ROOT);

/** پوشهٔ پوستهٔ برنامهٔ ویندوز — برنامه خودش این را می‌دهد */
export const SHELL_DIR = process.env.HLP_SHELL_DIR ? path.resolve(process.env.HLP_SHELL_DIR) : null;

/** ریشهٔ نصب در چیدمانِ معمولی */
export const INSTALL_ROOT = path.resolve(
  process.env.HLP_INSTALL_ROOT || path.resolve(SERVER_ROOT, '..', '..'),
);

const SERVER_PREFIX = 'homelab-panel/server/';
const SHELL_PREFIX = 'homelab-panel/desktop/app/';

/** نسبت به ریشهٔ مخزن — چیزهایی که به‌روزرسانی هرگز لمسشان نمی‌کند */
const PROTECTED = [
  'homelab-panel/server/data',
  'homelab-panel/server/.env',
  'homelab-panel/server/node_modules',
  'homelab-panel/web/node_modules',
  'ai-support/node_modules',
  'ai-support/.env',
  'ai-support/data',
  '.git',
];

/** نسبت به ریشهٔ سرور — همان‌ها، برای چیدمانِ بسته‌بندی‌شده */
const SERVER_PROTECTED = ['data', '.env', 'node_modules'];

const under = (value, list) =>
  list.some((p) => value === p || value.startsWith(`${p}/`));

export function isProtected(relPath) {
  return under(String(relPath).replace(/\\/g, '/').replace(/\/$/, ''), PROTECTED);
}

/**
 * مقصدِ یک مسیرِ نسبی از بستهٔ GitHub.
 * @returns مسیرِ مطلق، یا null اگر این فایل به این نصب ربطی ندارد.
 */
export function destinationFor(relPath) {
  const rel = String(relPath).replace(/\\/g, '/').replace(/\/$/, '');
  if (!rel) return null;

  if (LAYOUT === 'repo') {
    return isProtected(rel) ? null : path.join(INSTALL_ROOT, rel);
  }

  // ── چیدمانِ برنامهٔ ویندوز ──
  if (rel.startsWith(SERVER_PREFIX)) {
    const sub = rel.slice(SERVER_PREFIX.length);
    if (!sub || under(sub, SERVER_PROTECTED)) return null;
    return path.join(SERVER_ROOT, sub);
  }

  if (SHELL_DIR && rel.startsWith(SHELL_PREFIX)) {
    const sub = rel.slice(SHELL_PREFIX.length);
    if (!sub) return null;
    return path.join(SHELL_DIR, sub);
  }

  // بقیهٔ مخزن (سورسِ رابط کاربری، دستیار، نصب‌کننده‌ها، مستندات) داخلِ
  // برنامهٔ بسته‌بندی‌شده وجود ندارد و کپی کردنشان فقط آشغال می‌سازد.
  return null;
}

/**
 * چیزهایی که باید از آن‌ها بکاپ گرفته شود، با همان نامِ نسبیِ مخزن تا
 * برگرداندن دقیقاً از همان نگاشت رد شود.
 */
export function backupSources() {
  if (LAYOUT === 'repo') {
    return [{ root: INSTALL_ROOT, prefix: '', skip: (name) => isProtected(name) || name.startsWith('.git/') }];
  }
  const sources = [
    {
      root: SERVER_ROOT,
      prefix: SERVER_PREFIX,
      skip: (name) => under(name.replace(/\/$/, ''), SERVER_PROTECTED),
    },
  ];
  if (SHELL_DIR) sources.push({ root: SHELL_DIR, prefix: SHELL_PREFIX, skip: () => false });
  return sources;
}

/**
 * ریشهٔ سرورِ *نصب‌شده* — همان چیزی که به‌روزرسانی رویش می‌نشیند.
 * در چیدمانِ معمولی زیرِ ریشهٔ نصب است، در برنامهٔ ویندوز خودِ resources/server.
 */
export function installedServerRoot() {
  return LAYOUT === 'packaged' ? SERVER_ROOT : path.join(INSTALL_ROOT, 'homelab-panel', 'server');
}

/** برای نمایش در پنل */
export function layoutInfo() {
  return {
    layout: LAYOUT,
    installRoot: LAYOUT === 'packaged' ? SERVER_ROOT : INSTALL_ROOT,
    shellDir: SHELL_DIR,
  };
}
