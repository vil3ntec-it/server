// ---------------------------------------------------------------------------
//  نگهبانِ مسیرها — فایل‌منیجر فقط داخلِ ریشه‌های مجاز کار می‌کند
//
//  «../» را path.resolve می‌گیرد، ولی به‌تنهایی کافی نیست: یک shortcut یا
//  junction یا symlink که *داخلِ* پوشهٔ مجاز ساخته شده باشد و به C:\Windows
//  اشاره کند، از فیلترِ متنی رد می‌شود و بعد سیستم‌عامل دنبالش می‌رود.
//
//  پس این‌جا مسیر تا «مسیرِ واقعی» باز می‌شود (realpath) و همان بررسی می‌شود.
//  چون ممکن است فایل هنوز ساخته نشده باشد (مثلاً «پوشهٔ تازه»)، نزدیک‌ترین
//  پوشهٔ موجود realpath می‌شود و باقیِ نام‌ها به آن چسبانده می‌شود.
// ---------------------------------------------------------------------------
import path from 'node:path';
import fs from 'node:fs';
import { paths } from '../config.js';
import { sitesRoot } from '../sites/root.js';
import { listSitesRaw } from '../sites/registry.js';
import { getSetting } from '../db.js';
import { libraryRoot, isConfigured } from '../storage/library.js';

export function allowedRoots() {
  const roots = new Set();
  roots.add(sitesRoot());
  roots.add(paths.sitesData);
  // کتابخانه هم جزوِ فضای مجاز است (اگر انتخاب شده باشد)
  if (isConfigured()) roots.add(libraryRoot());
  for (const s of listSitesRaw()) roots.add(s.root_path);
  for (const extra of getSetting('extra_file_roots', []) || []) {
    if (typeof extra === 'string' && extra.trim()) roots.add(path.resolve(extra.trim()));
  }
  return [...roots].map((r) => path.resolve(r));
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * مسیرِ واقعی. اگر خودِ مسیر هنوز وجود ندارد، نزدیک‌ترین جدِ موجودش را
 * واقعی می‌کند و بقیه را به آن می‌چسباند — تا «ساختنِ فایلِ تازه» هم بشود.
 */
export function realPath(input) {
  const wanted = path.resolve(String(input));
  const trailing = [];
  let current = wanted;

  for (let guard = 0; guard < 64; guard++) {
    try {
      const real = fs.realpathSync.native ? fs.realpathSync.native(current) : fs.realpathSync(current);
      return trailing.length ? path.join(real, ...trailing.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) break;   // به ریشهٔ درایو رسیدیم
      trailing.push(path.basename(current));
      current = parent;
    }
  }
  return wanted;
}

/**
 * مسیر را می‌سنجد. اگر بیرونِ ریشه‌های مجاز باشد — چه با ../ و چه با لینک —
 * رد می‌شود. مسیرِ برگشتی همیشه «واقعی» است تا کارِ بعدی هم امن بماند.
 */
export function resolveSafe(input) {
  const raw = String(input ?? '');
  if (!raw.trim()) return { ok: false, error: 'path_required' };
  // بایتِ صفر یعنی کسی دارد رشته را نصف می‌کند
  if (raw.includes('\0')) return { ok: false, error: 'bad_path' };

  const target = realPath(raw);
  for (const root of allowedRoots()) {
    const realRoot = realPath(root);
    if (isInside(target, realRoot)) return { ok: true, path: target, root: realRoot };
  }
  return { ok: false, error: 'path_not_allowed' };
}

/**
 * برای «تغییرِ نام»: نامِ تازه نباید مسیر داشته باشد و نباید به بیرون برود.
 */
export function safeName(value) {
  const name = String(value ?? '').trim();
  if (!name || name === '.' || name === '..') return null;
  if (name.includes('\0')) return null;
  // هیچ جداکنندهٔ مسیری مجاز نیست — نه / و نه \
  if (/[\\/]/.test(name)) return null;
  if (path.basename(name) !== name) return null;
  return name;
}

export function rootsWithMeta() {
  return allowedRoots().map((r) => ({
    path: r,
    exists: fs.existsSync(r),
    label: r === sitesRoot() ? 'sites-root' : r === paths.sitesData ? 'panel-data' : 'site',
  }));
}
