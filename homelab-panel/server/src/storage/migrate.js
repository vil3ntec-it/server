// ---------------------------------------------------------------------------
//  مرتب کردنِ پوشه‌های پراکنده
//
//  اگر پیش از کتابخانه، پوشه‌ها این‌ور و آن‌ور ساخته شده‌اند، این‌جا پیدا و
//  (فقط با اجازهٔ کاربر) به کتابخانه منتقل می‌شوند.
//
//  سه قانونِ سفت‌وسخت:
//    ۱) هیچ‌چیز پاک نمی‌شود — فقط جابه‌جا، آن هم بعد از کپیِ موفق
//    ۲) اگر معلوم نباشد مالِ کدام پروژه است → Unsorted/، نه حدس‌زدن
//    ۳) اول «پیش‌نمایش» داده می‌شود؛ جابه‌جایی درخواستِ جداگانه است
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { logEvent } from '../db.js';
import { libraryRoot, libraryPath, ensureLibrary, uniqueFolderName, folderSize } from './library.js';

/** آیا مسیرِ الف داخلِ مسیرِ ب است؟ (برای اینکه کتابخانه خودش را جابه‌جا نکند) */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** یک پوشه شبیهِ پروژه است؟ (نه یک پوشهٔ خالی یا سیستمی) */
async function looksLikeProject(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    if (entries.length === 0) return { project: false, reason: 'empty' };
    const names = entries.map((e) => e.name.toLowerCase());
    if (names.includes('package.json')) return { project: true, kind: 'node' };
    if (names.includes('index.html')) return { project: true, kind: 'static' };
    if (names.includes('index.php')) return { project: true, kind: 'php' };
    if (names.some((n) => n.endsWith('.db') || n.endsWith('.sqlite'))) return { project: true, kind: 'data' };
    if (entries.some((e) => e.isDirectory())) return { project: true, kind: 'unknown' };
    return { project: true, kind: 'files' };
  } catch {
    return { project: false, reason: 'unreadable' };
  }
}

/**
 * جاهایی که ممکن است پوشهٔ پراکنده باشد را می‌گردد و فهرست می‌دهد.
 * هیچ‌چیز را دست نمی‌زند.
 */
export async function scanStray({ extraRoots = [] } = {}) {
  const library = path.resolve(libraryRoot());
  const candidates = new Set();

  for (const root of extraRoots) {
    if (root) candidates.add(path.resolve(root));
  }

  const found = [];
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    // خودِ کتابخانه هرگز «پراکنده» نیست
    if (isInside(root, library)) continue;

    let entries = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(root, entry.name);
      if (isInside(full, library)) continue;

      const guess = await looksLikeProject(full);
      if (!guess.project) continue;
      const size = await folderSize(full, { maxEntries: 2000 });
      found.push({
        name: entry.name,
        path: full,
        kind: guess.kind,
        bytes: size.bytes,
        files: size.files,
        lastModified: size.newest,
        // اگر مطمئن نباشیم، به Unsorted می‌رود — نه حدسِ اشتباه
        suggestedBranch: guess.kind === 'unknown' || guess.kind === 'files' ? 'Unsorted' : 'Sites',
      });
    }
  }
  return found;
}

/**
 * پیش‌نمایشِ جابه‌جایی: چه چیزی کجا می‌رود، چقدر جا لازم است.
 */
export async function planMove(items = []) {
  await ensureLibrary();
  const plan = [];
  let totalBytes = 0;

  for (const item of items) {
    const source = path.resolve(String(item.path || ''));
    if (!source || !fs.existsSync(source)) {
      plan.push({ source, ok: false, reason: 'not_found' });
      continue;
    }
    if (isInside(source, libraryRoot())) {
      plan.push({ source, ok: false, reason: 'already_in_library' });
      continue;
    }
    const branch = ['Sites', 'Apps', 'Unsorted'].includes(item.branch) ? item.branch : 'Unsorted';
    const parent = libraryPath(branch);
    await fsp.mkdir(parent, { recursive: true });
    const folder = uniqueFolderName(parent, item.name || path.basename(source));
    const size = await folderSize(source, { maxEntries: 5000 });
    totalBytes += size.bytes;
    plan.push({
      source,
      target: path.join(parent, folder),
      branch,
      bytes: size.bytes,
      files: size.files,
      ok: true,
    });
  }
  return { plan, totalBytes };
}

/**
 * جابه‌جاییِ واقعی. اول کپی، بعد بررسی، و تنها آن‌وقت منبع پاک می‌شود —
 * و اگر کاربر نخواهد، منبع اصلاً پاک نمی‌شود.
 */
export async function applyMove(items = [], { removeSource = false } = {}) {
  const { plan } = await planMove(items);
  const done = [];

  for (const step of plan) {
    if (!step.ok) {
      done.push(step);
      continue;
    }
    try {
      await copyTree(step.source, step.target);
      const after = await folderSize(step.target, { maxEntries: 5000 });
      const verified = after.files >= step.files;

      if (verified && removeSource) {
        await fsp.rm(step.source, { recursive: true, force: true });
      }
      done.push({ ...step, moved: true, verified, sourceRemoved: verified && removeSource });
      logEvent('info', 'panel', `پوشهٔ «${path.basename(step.source)}» به کتابخانه منتقل شد`);
    } catch (e) {
      done.push({ ...step, moved: false, error: e.message });
      logEvent('error', 'panel', `انتقالِ «${step.source}» ناموفق بود: ${e.message}`);
    }
  }
  return { done };
}

/** کپیِ درختِ پوشه (بدونِ دنبال کردنِ لینک‌ها) */
async function copyTree(source, target) {
  await fsp.mkdir(target, { recursive: true });
  const entries = await fsp.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isSymbolicLink()) continue;      // لینک‌ها دنبال نمی‌شوند
    if (entry.isDirectory()) await copyTree(from, to);
    else if (entry.isFile()) await fsp.copyFile(from, to);
  }
}
