// ---------------------------------------------------------------------------
//  کتابخانهٔ سرور — یک جای مرتب برای همه‌چیز
//
//  مسئله‌ای که حل می‌کند: تا حالا پوشه‌ها روی درایو پخش می‌شدند و آدم نمی‌دانست
//  دادهٔ کدام سایت کجاست. حالا یک ریشه انتخاب می‌شود و همه‌چیز زیرِ همان،
//  با نظمِ ثابت می‌نشیند:
//
//      <ریشه>/
//        Server/    config · database · logs · cache · system
//        Sites/     هر سایت یک پوشهٔ مستقل: app · data · logs · backup · config
//        Apps/      هر برنامه یک پوشهٔ مستقل: data · logs · config · backup
//        Backups/   Daily · Weekly · Manual
//        Downloads/
//        Temp/
//        Unsorted/  چیزهایی که معلوم نیست مالِ کدام پروژه‌اند
//
//  قانون‌ها:
//    • هیچ پوشه‌ای بیرونِ ریشه ساخته نمی‌شود
//    • هر پروژه پوشهٔ خودش را دارد؛ نامِ تکراری با ‑۲، ‑۳ جدا می‌شود
//    • هیچ فایلی بی‌اجازه پاک یا جابه‌جا نمی‌شود
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSetting, setSetting, logEvent } from '../db.js';

/** شاخه‌های ثابتِ کتابخانه */
export const TREE = {
  Server: ['config', 'database', 'logs', 'cache', 'system'],
  Sites: [],
  Apps: [],
  Backups: ['Daily', 'Weekly', 'Manual'],
  Downloads: [],
  Temp: [],
  Unsorted: [],
};

/** پوشه‌های داخلیِ هر سایت و هر برنامه */
export const SITE_FOLDERS = ['app', 'data', 'logs', 'backup', 'config'];
export const APP_FOLDERS = ['data', 'logs', 'config', 'backup'];

const SETTING_KEY = 'library_root';

/**
 * جای پیشنهادیِ کتابخانه وقتی هنوز چیزی انتخاب نشده.
 * روی ویندوز دنبالِ درایوی غیر از C می‌گردد (تا سیستم شلوغ نشود)،
 * وگرنه کنارِ پوشهٔ خانگیِ کاربر.
 */
export function suggestRoot() {
  if (process.platform === 'win32') {
    for (const letter of ['D', 'E', 'F', 'G']) {
      const drive = `${letter}:\\`;
      try {
        if (fs.existsSync(drive)) return path.join(drive, 'HomeServer');
      } catch { /* درایو در دسترس نیست */ }
    }
    return path.join(os.homedir(), 'HomeServer');
  }
  return path.join(os.homedir(), 'HomeServer');
}

/** ریشهٔ فعلی — از تنظیمات، یا از متغیرِ محیطی، یا پیشنهادی */
export function libraryRoot() {
  const saved = getSetting(SETTING_KEY, null);
  if (saved) return String(saved);
  if (process.env.HLP_LIBRARY_ROOT) return process.env.HLP_LIBRARY_ROOT;
  return suggestRoot();
}

export function isConfigured() {
  return Boolean(getSetting(SETTING_KEY, null));
}

/** مسیرِ یکی از شاخه‌های کتابخانه */
export function libraryPath(...parts) {
  return path.join(libraryRoot(), ...parts);
}

// ---------------------------------------------------------------------------
//  نامِ پوشه
// ---------------------------------------------------------------------------

/**
 * از نامِ پروژه یک نامِ پوشهٔ امن می‌سازد — بدونِ نویسه‌های ممنوعِ ویندوز،
 * بدونِ نقطه یا فاصلهٔ آخر، و نه یکی از نام‌های رزروشدهٔ ویندوز.
 */
export function safeFolderName(raw, fallback = 'project') {
  let name = String(raw || '').trim();
  name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/[. ]+$/, '');
  if (!name) name = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `${name}-1`;
  return name.slice(0, 60);
}

/**
 * اگر نام تکراری بود، ‑۲ و ‑۳ اضافه می‌کند تا هیچ دو پروژه‌ای روی هم نیفتند.
 */
export function uniqueFolderName(parentDir, wanted) {
  const base = safeFolderName(wanted);
  let candidate = base;
  let counter = 2;
  while (fs.existsSync(path.join(parentDir, candidate))) {
    candidate = `${base}-${counter}`;
    counter++;
    if (counter > 999) {
      candidate = `${base}-${Date.now().toString(36)}`;
      break;
    }
  }
  return candidate;
}

// ---------------------------------------------------------------------------
//  ساختنِ ساختار
// ---------------------------------------------------------------------------

/**
 * ساختارِ کتابخانه را می‌سازد (اگر نبود) و می‌گوید چه چیزی ساخته شد.
 * روی پوشهٔ موجود هم بی‌خطر است: چیزی پاک نمی‌شود.
 */
export async function ensureLibrary(root = libraryRoot()) {
  const created = [];
  const target = path.resolve(root);

  await fsp.mkdir(target, { recursive: true });
  for (const [branch, children] of Object.entries(TREE)) {
    const branchPath = path.join(target, branch);
    if (!fs.existsSync(branchPath)) created.push(path.join(branch));
    await fsp.mkdir(branchPath, { recursive: true });
    for (const child of children) {
      const childPath = path.join(branchPath, child);
      if (!fs.existsSync(childPath)) created.push(path.join(branch, child));
      await fsp.mkdir(childPath, { recursive: true });
    }
  }

  // یک یادداشت کنارِ ریشه تا اگر کسی پوشه را دید بداند چیست
  const readme = path.join(target, 'راهنمای-این-پوشه.txt');
  if (!fs.existsSync(readme)) {
    await fsp.writeFile(
      readme,
      [
        'این پوشه، کتابخانهٔ سرورِ خانگی است.',
        '',
        '  Server/     تنظیمات، دیتابیس و لاگِ خودِ سرور',
        '  Sites/      هر سایت یک پوشهٔ مستقل',
        '  Apps/       هر برنامه (اندروید/ویندوز) یک پوشهٔ مستقل',
        '  Backups/    نسخه‌های پشتیبان',
        '  Downloads/  فایل‌های دانلودشده',
        '  Temp/       فایل‌های موقت — بی‌خطر پاک می‌شوند',
        '  Unsorted/   چیزهایی که معلوم نبود مالِ کدام پروژه‌اند',
        '',
        'دستی چیزی را جابه‌جا نکنید؛ از خودِ برنامه انجامش دهید.',
        '',
      ].join('\r\n'),
      'utf8'
    );
  }

  return { root: target, created };
}

/** ریشه را ثبت می‌کند (و ساختارش را می‌سازد) */
export async function setLibraryRoot(root) {
  const target = path.resolve(String(root || '').trim());
  if (!target) return { ok: false, error: 'empty_path', message: 'مسیر خالی است' };

  const check = await canUse(target);
  if (!check.ok) return check;

  const result = await ensureLibrary(target);
  setSetting(SETTING_KEY, target);
  logEvent('info', 'panel', `کتابخانهٔ سرور روی ${target} تنظیم شد`);
  return { ok: true, ...result };
}

/** آیا می‌شود این‌جا نوشت؟ */
export async function canUse(root) {
  const target = path.resolve(root);
  try {
    await fsp.mkdir(target, { recursive: true });
    const probe = path.join(target, `.write-test-${Date.now().toString(36)}`);
    await fsp.writeFile(probe, 'ok', 'utf8');
    await fsp.rm(probe, { force: true });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: 'not_writable',
      message: `در «${target}» نمی‌شود نوشت (${e.code || e.message}). درایو وصل است؟ اجازهٔ نوشتن دارید؟`,
    };
  }
}

// ---------------------------------------------------------------------------
//  پوشهٔ پروژه‌ها
// ---------------------------------------------------------------------------

/** پوشهٔ مستقلِ یک سایت را می‌سازد و مسیرهایش را برمی‌گرداند */
export async function createSiteFolder(name, { slug = null } = {}) {
  await ensureLibrary();
  const parent = libraryPath('Sites');
  const folder = slug && fs.existsSync(path.join(parent, slug))
    ? slug
    : uniqueFolderName(parent, name || slug || 'site');
  const base = path.join(parent, folder);

  await fsp.mkdir(base, { recursive: true });
  for (const child of SITE_FOLDERS) await fsp.mkdir(path.join(base, child), { recursive: true });

  return {
    folder,
    base,
    app: path.join(base, 'app'),
    data: path.join(base, 'data'),
    logs: path.join(base, 'logs'),
    backup: path.join(base, 'backup'),
    config: path.join(base, 'config'),
  };
}

/** پوشهٔ مستقلِ یک برنامه (اپِ اندروید، برنامهٔ ویندوز، …) */
export async function createAppFolder(name, { slug = null } = {}) {
  await ensureLibrary();
  const parent = libraryPath('Apps');
  const folder = slug && fs.existsSync(path.join(parent, slug))
    ? slug
    : uniqueFolderName(parent, name || slug || 'app');
  const base = path.join(parent, folder);

  await fsp.mkdir(base, { recursive: true });
  for (const child of APP_FOLDERS) await fsp.mkdir(path.join(base, child), { recursive: true });

  return {
    folder,
    base,
    data: path.join(base, 'data'),
    logs: path.join(base, 'logs'),
    config: path.join(base, 'config'),
    backup: path.join(base, 'backup'),
  };
}

// ---------------------------------------------------------------------------
//  گزارش
// ---------------------------------------------------------------------------

/** اندازهٔ یک پوشه — با سقفِ زمانی تا روی پوشه‌های بزرگ برنامه را نخواباند */
export async function folderSize(dir, { maxEntries = 20000 } = {}) {
  let bytes = 0;
  let files = 0;
  let newest = 0;
  let truncated = false;

  async function walk(current) {
    if (files >= maxEntries) {
      truncated = true;
      return;
    }
    let entries = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files >= maxEntries) {
        truncated = true;
        return;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const stat = await fsp.stat(full);
          bytes += stat.size;
          files++;
          if (stat.mtimeMs > newest) newest = stat.mtimeMs;
        } catch { /* فایل همین لحظه پاک شد */ }
      }
    }
  }

  await walk(dir);
  return { bytes, files, newest: newest || null, truncated };
}

/** فضای دیسکِ کتابخانه */
export function diskInfo(root = libraryRoot()) {
  try {
    const stat = fs.statfsSync(root);
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    return { total, free, used: total - free, ok: true };
  } catch {
    return { total: null, free: null, used: null, ok: false };
  }
}

/** هشدارِ کمبودِ فضا — همان چیزی که در بخشِ «۱۹» خواسته شده */
export function diskWarning(info = diskInfo()) {
  if (!info.ok || !info.total) return null;
  const freeGb = info.free / (1024 ** 3);
  const percent = (info.free / info.total) * 100;
  if (freeGb < 1 || percent < 2) {
    return { level: 'critical', message: `فضای دیسک بسیار کم است (${freeGb.toFixed(1)} گیگ). پشتیبان‌گیری متوقف می‌شود تا داده خراب نشود.` };
  }
  if (freeGb < 5 || percent < 10) {
    return { level: 'warning', message: `فضای دیسک رو به اتمام است (${freeGb.toFixed(1)} گیگ آزاد).` };
  }
  return null;
}

/** فهرستِ پروژه‌های داخلِ یک شاخه، با اندازه و آخرین تغییر */
export async function listBranch(branch, { withSize = true } = {}) {
  const parent = libraryPath(branch);
  let entries = [];
  try {
    entries = await fsp.readdir(parent, { withFileTypes: true });
  } catch {
    return [];
  }

  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const base = path.join(parent, entry.name);
    const size = withSize ? await folderSize(base, { maxEntries: 4000 }) : null;
    rows.push({
      name: entry.name,
      path: base,
      bytes: size ? size.bytes : null,
      files: size ? size.files : null,
      lastModified: size ? size.newest : null,
      partial: size ? size.truncated : false,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** خلاصهٔ کلِ کتابخانه — همان چیزی که صفحهٔ «کتابخانه» نشان می‌دهد */
export async function overview({ withSize = true } = {}) {
  const root = libraryRoot();
  const exists = fs.existsSync(root);
  const disk = diskInfo(exists ? root : path.parse(path.resolve(root)).root);

  const branches = {};
  for (const branch of Object.keys(TREE)) {
    const branchPath = path.join(root, branch);
    branches[branch] = {
      path: branchPath,
      exists: fs.existsSync(branchPath),
      count: 0,
    };
    if (branches[branch].exists) {
      try {
        branches[branch].count = (await fsp.readdir(branchPath, { withFileTypes: true }))
          .filter((e) => e.isDirectory()).length;
      } catch { /* خوانده نشد */ }
    }
  }

  return {
    root,
    configured: isConfigured(),
    exists,
    healthy: exists && Object.values(branches).every((b) => b.exists),
    disk,
    warning: diskWarning(disk),
    branches,
    sites: exists ? await listBranch('Sites', { withSize }) : [],
    apps: exists ? await listBranch('Apps', { withSize }) : [],
  };
}

// ---------------------------------------------------------------------------
//  پاک کردنِ فایل‌های موقت
// ---------------------------------------------------------------------------

/** فایل‌های موقتِ قدیمی‌تر از چند ساعت را پاک می‌کند */
export async function cleanTemp({ olderThanHours = 24 } = {}) {
  const temp = libraryPath('Temp');
  if (!fs.existsSync(temp)) return { removed: 0 };
  const cutoff = Date.now() - olderThanHours * 3600 * 1000;
  let removed = 0;

  let entries = [];
  try {
    entries = await fsp.readdir(temp, { withFileTypes: true });
  } catch {
    return { removed: 0 };
  }
  for (const entry of entries) {
    const full = path.join(temp, entry.name);
    try {
      const stat = await fsp.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fsp.rm(full, { recursive: true, force: true });
        removed++;
      }
    } catch { /* بی‌خیال */ }
  }
  return { removed };
}
