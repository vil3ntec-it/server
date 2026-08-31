// ---------------------------------------------------------------------------
//  لاگِ اختصاصیِ هر پروژه
//
//  هر پروژه پوشهٔ logs/ خودش را دارد و لاگِ پروژهٔ الف هرگز داخل پوشهٔ ب
//  نمی‌رود. هر رده فایلِ روزانهٔ خودش را دارد:
//
//      Projects/ShopApp/logs/
//      ├── backup-2026-08-27.log
//      ├── deployment-2026-08-27.log
//      └── error-2026-08-27.log
//
//  قانونِ مطلق: رمز، کدِ یک‌بارمصرف، توکن و راز هرگز نوشته نمی‌شوند.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { projectDir } from './storage.js';
import { scrub } from './audit.js';

export const CATEGORIES = ['server', 'api', 'authentication', 'sync', 'backup', 'deployment', 'error'];
export const LEVELS = ['debug', 'info', 'warn', 'error'];

/** هر فایل تا این اندازه؛ بعد از آن روزِ بعد یا پسوندِ تازه */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** فایل‌های قدیمی‌تر از این، پاک می‌شوند */
const KEEP_DAYS = 30;

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function logsDirOf(project) {
  return path.join(projectDir(project), 'logs');
}

/** متن‌هایی که شبیهِ راز هستند، حتی وسطِ یک جمله، پوشانده می‌شوند */
const SECRET_PATTERN =
  /((?:token|secret|password|passwd|pwd|otp|api[_-]?key|authorization|bearer)\s*[:=]\s*)(\S+)/gi;

export function maskLine(text) {
  return String(text).replace(SECRET_PATTERN, (_m, key) => `${key}••••••••`);
}

/**
 * یک سطر در لاگِ پروژه می‌نویسد. اگر نوشتن نشد (دیسک پر، دسترسی نبود)
 * سکوت می‌کند — لاگ نباید کارِ اصلی را بخواباند.
 */
export function writeProjectLog(project, { category = 'server', level = 'info', message, detail = null } = {}) {
  try {
    if (!project?.slug) return false;
    const cat = CATEGORIES.includes(category) ? category : 'server';
    const lvl = LEVELS.includes(level) ? level : 'info';
    const dir = logsDirOf(project);
    fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, `${cat}-${today()}.log`);
    // اگر فایلِ امروز بزرگ شد، ادامه در فایلِ بعدی
    let target = file;
    try {
      const st = fs.statSync(file);
      if (st.size > MAX_FILE_BYTES) {
        let n = 2;
        while (fs.existsSync(path.join(dir, `${cat}-${today()}.${n}.log`))) n++;
        target = path.join(dir, `${cat}-${today()}.${n}.log`);
      }
    } catch { /* فایل هنوز نیست */ }

    const row = {
      at: new Date().toISOString(),
      level: lvl,
      category: cat,
      project: project.project_id,
      message: maskLine(String(message ?? '')).slice(0, 2000),
      ...(detail != null ? { detail: scrub(detail) } : {}),
    };
    fs.appendFileSync(target, `${JSON.stringify(row)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** فهرستِ فایل‌های لاگِ یک پروژه */
export async function listProjectLogs(project) {
  const dir = logsDirOf(project);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
    const full = path.join(dir, entry.name);
    const st = await fsp.stat(full);
    const category = entry.name.split('-')[0];
    out.push({
      name: entry.name,
      category: CATEGORIES.includes(category) ? category : 'other',
      size: st.size,
      modified: st.mtimeMs,
    });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

/**
 * آخرین سطرهای یک فایلِ لاگ.
 * نامِ فایل بررسی می‌شود تا از پوشهٔ همین پروژه بیرون نزند.
 */
export async function tailProjectLog(project, filename, { lines = 300, level = null, q = null } = {}) {
  const dir = logsDirOf(project);
  const safe = path.basename(String(filename || ''));
  if (!safe.endsWith('.log')) return { rows: [], error: 'invalid_file' };
  const full = path.join(dir, safe);
  // حتی با نامِ دست‌کاری‌شده، مسیر باید داخلِ همین پوشه بماند
  const rel = path.relative(dir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { rows: [], error: 'path_not_allowed' };
  if (!fs.existsSync(full)) return { rows: [], error: 'not_found' };

  const text = await fsp.readFile(full, 'utf8');
  const all = text.split('\n').filter(Boolean);
  const rows = [];
  for (let i = all.length - 1; i >= 0 && rows.length < Math.min(2000, Number(lines) || 300); i--) {
    let row;
    try {
      row = JSON.parse(all[i]);
    } catch {
      row = { at: null, level: 'info', message: all[i] };
    }
    if (level && row.level !== level) continue;
    if (q && !JSON.stringify(row).toLowerCase().includes(String(q).toLowerCase())) continue;
    rows.push(row);
  }
  return { rows: rows.reverse(), total: all.length, file: safe };
}

/** لاگ‌های کهنه پاک می‌شوند تا دیسک پر نشود */
export async function pruneProjectLogs(project, keepDays = KEEP_DAYS) {
  const dir = logsDirOf(project);
  if (!fs.existsSync(dir)) return 0;
  const cutoff = Date.now() - keepDays * 86400000;
  let removed = 0;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.log')) continue;
    const full = path.join(dir, entry.name);
    try {
      const st = await fsp.stat(full);
      if (st.mtimeMs < cutoff) {
        await fsp.rm(full, { force: true });
        removed++;
      }
    } catch { /* همین حالا رفت */ }
  }
  return removed;
}
