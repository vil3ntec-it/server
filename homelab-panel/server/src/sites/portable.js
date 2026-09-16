// ---------------------------------------------------------------------------
//  «پوشه را بردار و ببر»
//
//  وعدهٔ برنامه این است: یک پوشه، هر کامپیوتری، همان سرور. دیتابیس، حساب‌ها،
//  بکاپ‌ها، کلیدِ گاوصندوق و کلیدهای امضا از قبل داخلِ پوشهٔ داده بودند — ولی
//  خودِ سایت‌ها نه. ردیفِ هر سایت در دیتابیس یک مسیرِ مطلق است؛ پوشه که به
//  کامپیوترِ تازه می‌رفت، آن مسیر آن‌جا وجود نداشت و سایت بالا نمی‌آمد.
//
//  این فایل سه کار می‌کند:
//
//    ۱) pinSitesRoot()      نصبِ قدیمی را همان‌جا که هست نگه می‌دارد، تا
//                           عوض‌شدنِ پیش‌فرض چیزی را زیرِ پای کسی نکشد.
//    ۲) folderReport()      می‌گوید چه چیزی با پوشه می‌رود و چه چیزی جا می‌ماند.
//    ۳) moveSitesIntoFolder() سایت‌ها را واقعاً می‌آورد داخل و مسیرها را در
//                           دیتابیس درست می‌کند — نه اینکه فقط تنظیم را عوض کند.
//
//  ⚠️ هیچ‌کدامِ این‌ها خودکار اجرا نمی‌شوند جز اولی. جابه‌جاییِ فایل‌های کسی
//  بدونِ اینکه خواسته باشد، بدتر از جا ماندنشان است.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config, paths } from '../config.js';
import { db, getSetting, setSetting, logEvent } from '../db.js';
import { storageRoot, storageChosen } from '../control/storage.js';
import { sitesRoot } from './root.js';
import { isRunning, startSite, stopSite } from './process.js';

/** مسیرِ پیش‌فرضِ قدیمی — همان جایی که نصب‌های تا امروز سایت‌هایشان آن‌جاست */
export function legacySitesRoot() {
  return process.platform === 'win32' ? path.join(os.homedir(), 'sites') : '/sites';
}

/** آیا `child` واقعاً داخلِ `parent` است؟ (نه فقط شبیهِ آن) */
export function isInside(parent, child) {
  const from = path.resolve(parent);
  const to = path.resolve(child);
  if (from === to) return true;
  const rel = path.relative(from, to);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function hasContent(dir) {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * نصبِ قدیمی نباید با عوض‌شدنِ پیش‌فرض تکان بخورد.
 *
 * تا امروز ریشهٔ سایت‌ها پیش‌فرضِ سیستم‌عامل بود و در تنظیمات چیزی ذخیره
 * نمی‌شد. حالا که پیش‌فرض رفته داخلِ پوشهٔ داده، اگر ساکت بگذاریم، سرورِ
 * کسی که سایت‌هایش در مسیرِ قبلی است یک‌باره به پوشه‌ای خالی نگاه می‌کند.
 * پس بارِ اول همان مسیرِ قبلی صریح ثبت می‌شود: هیچ چیز عوض نمی‌شود و
 * جابه‌جایی وقتی انجام می‌شود که خودِ صاحبِ سرور بخواهد.
 */
export function pinSitesRoot() {
  if (getSetting('sites_root', null)) return { pinned: false, reason: 'already_set' };

  const legacy = legacySitesRoot();
  if (path.resolve(legacy) === path.resolve(config.sitesRoot)) return { pinned: false, reason: 'same' };
  if (!hasContent(legacy)) return { pinned: false, reason: 'legacy_empty' };

  setSetting('sites_root', path.resolve(legacy));
  logEvent(
    'warn',
    'panel',
    `سایت‌ها بیرونِ پوشهٔ داده‌اند (${legacy}) و همان‌جا ماندند. برای بردنِ پوشه به کامپیوترِ دیگر، اول آن‌ها را به داخلِ پوشه بیاورید.`,
  );
  return { pinned: true, root: path.resolve(legacy) };
}

/* -------------------------- گزارشِ سلامتِ پوشه ---------------------------- */

/**
 * چه چیزی با پوشه می‌رود و چه چیزی جا می‌ماند.
 *
 * هر ردیف `inside` دارد: اگر false باشد، آن تکه روی کامپیوترِ تازه نخواهد بود.
 */
export function folderReport() {
  const dataDir = path.resolve(config.dataDir);
  const items = [];
  const add = (key, label, target, { fixable = false } = {}) => {
    items.push({
      key,
      label,
      path: target,
      inside: isInside(dataDir, target),
      exists: fs.existsSync(target),
      fixable,
    });
  };

  add('db', 'دیتابیسِ پنل — حساب‌ها، تنظیمات، پمپ‌ها و فروشگاه', paths.db);
  add('vault', 'کلیدِ گاوصندوق — بدونِ آن رمزهای ذخیره‌شده باز نمی‌شوند', path.join(dataDir, 'vault.key'));
  add('backups', 'بکاپ‌ها', paths.backups);
  add('uploads', 'لوگو و فایل‌های پنل', paths.uploads);
  add('siteData', 'فضای کاری سایت‌ها — لاگ و بکاپ و دیتابیسِ هر سایت', paths.sitesData);
  add('sitesRoot', 'پوشهٔ خودِ سایت‌ها', sitesRoot(), { fixable: true });
  add('storage', 'انبارِ پروژه‌ها', storageRoot(), { fixable: storageChosen() });
  add('stations', 'دادهٔ پمپ‌ها', config.stations.dataDir);

  // هر سایتی که مسیرش بیرون افتاده، جدا شمرده می‌شود — چون ممکن است ریشه
  // داخل باشد ولی یک سایت دستی از جای دیگری اضافه شده باشد.
  const strays = db
    .prepare('SELECT id, slug, name, root_path FROM sites')
    .all()
    .filter((row) => row.root_path && !isInside(dataDir, row.root_path));

  const outside = items.filter((i) => !i.inside && i.exists);
  return {
    dataDir,
    portable: outside.length === 0 && strays.length === 0,
    items,
    strays,
    summary: outside.length === 0 && strays.length === 0
      ? 'همه‌چیز داخلِ پوشه است — پوشه را هر جا ببرید، سرور همان است.'
      : `${outside.length + strays.length} مورد بیرونِ پوشه مانده و با جابه‌جاییِ پوشه نمی‌آید.`,
  };
}

/* ------------------------ آوردنِ سایت‌ها به داخل -------------------------- */

/**
 * جابه‌جاییِ یک پوشه — اول rename، و اگر دو طرف روی دو درایو بودند، کپی.
 *
 * ⚠️ rename بینِ دو درایو EXDEV می‌دهد و همان جایی است که آدم‌ها روی ویندوز
 * گیر می‌کنند (پوشهٔ داده روی D: و سایت‌ها روی C:).
 */
async function movePath(from, to) {
  await fsp.mkdir(path.dirname(to), { recursive: true });
  try {
    await fsp.rename(from, to);
    return 'rename';
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
  }
  await fsp.cp(from, to, { recursive: true, errorOnExist: true, force: false });
  await fsp.rm(from, { recursive: true, force: true });
  return 'copy';
}

/**
 * هر سایتی که بیرونِ پوشهٔ داده است را می‌آورد داخل و مسیرش را در دیتابیس
 * درست می‌کند. سایتی که در حالِ اجراست، خاموش و دوباره روشن می‌شود.
 *
 * هر سایت جداگانه انجام می‌شود: اگر یکی نشد، بقیه انجام شده‌اند و گزارش
 * می‌گوید کدام و چرا. هیچ‌وقت روی پوشه‌ای که از قبل هست نمی‌نویسد.
 */
export async function moveSitesIntoFolder({ actor = 'admin' } = {}) {
  const dataDir = path.resolve(config.dataDir);
  const target = path.join(dataDir, 'websites');
  await fsp.mkdir(target, { recursive: true });

  const rows = db.prepare('SELECT * FROM sites').all();
  const moved = [];
  const skipped = [];
  const failed = [];

  for (const site of rows) {
    if (!site.root_path) {
      skipped.push({ slug: site.slug, reason: 'no_path' });
      continue;
    }
    if (isInside(dataDir, site.root_path)) {
      skipped.push({ slug: site.slug, reason: 'already_inside' });
      continue;
    }
    if (!fs.existsSync(site.root_path)) {
      skipped.push({ slug: site.slug, reason: 'missing', path: site.root_path });
      continue;
    }

    const destination = path.join(target, site.slug);
    if (fs.existsSync(destination)) {
      failed.push({ slug: site.slug, error: 'destination_exists', path: destination });
      continue;
    }

    const wasRunning = isRunning(site.slug);
    try {
      if (wasRunning) await stopSite(site);
      const how = await movePath(site.root_path, destination);
      db.prepare('UPDATE sites SET root_path = ?, updated_at = ? WHERE id = ?').run(
        destination,
        Date.now(),
        site.id,
      );
      moved.push({ slug: site.slug, from: site.root_path, to: destination, how });
      logEvent('info', 'panel', `سایتِ «${site.slug}» به داخلِ پوشهٔ داده آمد`);
    } catch (e) {
      failed.push({ slug: site.slug, error: e.code || e.message, path: site.root_path });
    } finally {
      // سایتی که بالا بود باید بالا برگردد — چه جابه‌جایی گرفته باشد چه نه
      if (wasRunning) {
        try {
          await startSite(db.prepare('SELECT * FROM sites WHERE id = ?').get(site.id));
        } catch { /* در گزارشِ خودِ سایت دیده می‌شود */ }
      }
    }
  }

  // ریشه وقتی داخل می‌نشیند که واقعاً چیزی بیرون نمانده باشد
  if (!failed.length) setSetting('sites_root', target);

  logEvent(
    'info',
    'panel',
    `آوردنِ سایت‌ها به داخلِ پوشه توسط ${actor}: ${moved.length} جابه‌جا، ${skipped.length} بی‌نیاز، ${failed.length} نشد`,
  );

  return { ok: failed.length === 0, root: target, moved, skipped, failed };
}
