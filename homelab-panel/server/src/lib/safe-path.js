// ---------------------------------------------------------------------------
// نگهبان مسیرها: فایل‌منیجر فقط اجازه دارد داخل ریشه‌های مجاز کار کند
// (ریشهٔ سایت‌ها، پوشهٔ هر سایت، و فضای کاری پنل). جلوی ../ گرفته می‌شود.
// ---------------------------------------------------------------------------
import path from 'node:path';
import fs from 'node:fs';
import { config, paths } from '../config.js';
import { sitesRoot } from '../sites/root.js';
import { listSitesRaw } from '../sites/registry.js';
import { getSetting } from '../db.js';

export function allowedRoots() {
  const roots = new Set();
  roots.add(sitesRoot());
  roots.add(paths.sitesData);
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

/** مسیر را نرمال می‌کند و بررسی می‌کند داخل یکی از ریشه‌های مجاز باشد */
export function resolveSafe(input) {
  const target = path.resolve(String(input || ''));
  const roots = allowedRoots();
  for (const root of roots) {
    if (isInside(target, root)) return { ok: true, path: target, root };
  }
  return { ok: false, error: 'path_not_allowed', roots };
}

export function rootsWithMeta() {
  return allowedRoots().map((r) => ({
    path: r,
    exists: fs.existsSync(r),
    label: r === sitesRoot() ? 'sites-root' : r === paths.sitesData ? 'panel-data' : 'site',
  }));
}
