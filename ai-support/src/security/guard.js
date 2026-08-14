// ═══════════════════════════════════════════════════════════════════════════
//  نگهبانِ مرزِ امنیتی
//
//  این فایل «قولِ» سندِ معماری را به کد تبدیل می‌کند. اگر مرز شکسته باشد،
//  سرویس **بالا نمی‌آید** — نه اینکه هشدار بدهد و ادامه بدهد.
//
//  فلسفه‌اش: امنیت نباید به «یادش باشد فلان‌جا را چک کند» تکیه کند. مسیرها از
//  یک در می‌گذرند و همان در بسته است.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR, KB_DIR } from '../config.js';

/** ریشهٔ کلِ ریپو — یک پله بالاتر از ai-support/ */
const REPO_ROOT = path.resolve(ROOT, '..');

/**
 * مسیرهایی که سرویسِ AI مطلقاً کاری با آن‌ها ندارد — نه خواندن، نه نوشتن.
 * دادهٔ واقعیِ برنامه، کدِ برنامه، پیکربندیِ سرورها و اسرار.
 */
export const FORBIDDEN_PATHS = [
  path.join(REPO_ROOT, 'server'),          // سرورِ خانگیِ اصلی + data/*.json + token.txt
  path.join(REPO_ROOT, 'homelab-panel'),   // پنلِ سرور
  path.join(REPO_ROOT, 'desktop'),
  path.join(REPO_ROOT, 'android'),
  path.join(REPO_ROOT, 'webvault-manager'),
  path.join(REPO_ROOT, '.git'),
  path.join(REPO_ROOT, '.github'),
  path.join(REPO_ROOT, 'index.html'),      // خودِ برنامه
  path.join(REPO_ROOT, 'sw.js'),
  path.join(REPO_ROOT, 'app.html'),
  path.join(REPO_ROOT, 'payam'),
];

/** تنها جایی که سرویس اجازهٔ **نوشتن** دارد */
export const WRITABLE_ROOTS = [DATA_DIR];

/** تنها جایی که سرویس اجازهٔ **خواندنِ محتوا** دارد */
export const READABLE_ROOTS = [KB_DIR, DATA_DIR, path.join(ROOT, 'src'), path.join(ROOT, 'web')];

/** آیا `child` داخلِ `parent` است؟ (مقاوم در برابرِ ../ و symlinkِ نام‌مشابه) */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function isForbidden(p) {
  const abs = path.resolve(p);
  return FORBIDDEN_PATHS.some(f => isInside(abs, f) || isInside(f, abs));
}

/**
 * مسیرِ خواندن را بررسی کن. هر جای سرویس که فایلی باز می‌کند باید از این رد شود.
 * @throws {Error} اگر بیرونِ ریشه‌های مجاز یا داخلِ ریشه‌های ممنوع باشد
 */
export function assertReadable(p) {
  const abs = path.resolve(p);
  if (isForbidden(abs)) {
    throw new Error(`مرزِ امنیتی: خواندنِ «${abs}» ممنوع است (مسیرِ برنامهٔ اصلی).`);
  }
  if (!READABLE_ROOTS.some(r => isInside(abs, r))) {
    throw new Error(`مرزِ امنیتی: «${abs}» بیرونِ ریشه‌های مجازِ خواندن است.`);
  }
  return abs;
}

/**
 * مسیرِ نوشتن را بررسی کن. سرویس فقط داخلِ پوشهٔ دادهٔ خودش می‌نویسد.
 * @throws {Error}
 */
export function assertWritable(p) {
  const abs = path.resolve(p);
  if (isForbidden(abs)) {
    throw new Error(`مرزِ امنیتی: نوشتن در «${abs}» ممنوع است.`);
  }
  if (!WRITABLE_ROOTS.some(r => isInside(abs, r))) {
    throw new Error(`مرزِ امنیتی: سرویس فقط داخلِ «${DATA_DIR}» می‌نویسد. «${abs}» مجاز نیست.`);
  }
  return abs;
}

/**
 * چسباندنِ امنِ نامِ فایل به یک ریشه — جلوی `../../etc/passwd` را می‌گیرد.
 * برای هر نامی که از سمتِ کاربر یا از مدل می‌آید باید همین استفاده شود.
 */
export function safeJoin(rootDir, ...parts) {
  const abs = path.resolve(rootDir, ...parts);
  if (!isInside(abs, rootDir)) {
    throw new Error('مرزِ امنیتی: مسیر از ریشهٔ مجاز بیرون زد.');
  }
  return abs;
}

// ───────────────────────────────────────────────────────────────────────────
//  خودآزماییِ لحظهٔ راه‌اندازی
// ───────────────────────────────────────────────────────────────────────────

/** ماژول‌هایی که وجودشان در کدِ سرویس یعنی مرز شکسته است */
const BANNED_SOURCE_PATTERNS = [
  { re: /\bfrom\s+['"]node:child_process['"]/, why: 'اجرای دستور سیستم‌عامل' },
  { re: /\brequire\(\s*['"]child_process['"]/, why: 'اجرای دستور سیستم‌عامل' },
  { re: /\bfrom\s+['"]node:worker_threads['"]/, why: 'اجرای کدِ جانبی' },
  { re: /\bfrom\s+['"]node:vm['"]/, why: 'اجرای کدِ دلخواه' },
  { re: /\beval\s*\(/, why: 'اجرای کدِ دلخواه' },
  { re: /\bnew\s+Function\s*\(/, why: 'اجرای کدِ دلخواه' },
  { re: /\bexecSync\b|\bspawnSync\b|\bexecFile\b/, why: 'اجرای دستور سیستم‌عامل' },
];

function walkJs(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJs(p, out);
    else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * کلِ `src/` را می‌گردد و اگر ردی از اجرای دستور یا کدِ دلخواه پیدا کرد،
 * فهرستش را برمی‌گرداند. تستِ `no-shell` هم از همین استفاده می‌کند تا قاعده
 * یک‌جا تعریف شده باشد، نه دو جا.
 */
export function scanSourceForBannedApis(dir = path.join(ROOT, 'src')) {
  const hits = [];
  for (const file of walkJs(dir)) {
    // خودِ همین فایل الگوها را به‌صورت متن دارد؛ طبیعی است و نباید خودش را بگیرد
    if (path.resolve(file) === path.resolve(new URL(import.meta.url).pathname)) continue;
    let src = '';
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    // خطوطِ توضیح را کنار می‌گذاریم تا کامنتِ فارسی باعثِ هشدارِ الکی نشود
    const code = src.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const { re, why } of BANNED_SOURCE_PATTERNS) {
      if (re.test(code)) hits.push({ file: path.relative(ROOT, file), pattern: String(re), why });
    }
  }
  return hits;
}

/**
 * همهٔ بررسی‌های مرز را انجام می‌دهد.
 * @returns {{ok: boolean, problems: string[], notes: string[]}}
 */
export function runBoundaryChecks() {
  const problems = [];
  const notes = [];

  // ۱) پوشهٔ داده نباید جایی بیرون از خودِ سرویس یا داخلِ مسیرهای ممنوع باشد
  if (isForbidden(DATA_DIR)) {
    problems.push(`AI_DATA_DIR روی مسیرِ ممنوع تنظیم شده: ${DATA_DIR}`);
  }
  if (!isInside(DATA_DIR, ROOT) && !process.env.AI_ALLOW_EXTERNAL_DATA_DIR) {
    problems.push(`پوشهٔ داده بیرونِ سرویس است (${DATA_DIR}). اگر عمدی است AI_ALLOW_EXTERNAL_DATA_DIR=1 بگذار.`);
  }

  // ۲) دادهٔ برنامهٔ اصلی نباید از این‌جا خواندنی باشد — بررسیِ عملی، نه فرضی
  const appData = path.join(REPO_ROOT, 'server', 'data');
  if (fs.existsSync(appData)) {
    notes.push('دادهٔ برنامهٔ اصلی روی همین دستگاه هست — مسیرش در فهرستِ ممنوع است و سرویس بازش نمی‌کند.');
  }
  let leaked = false;
  try { assertReadable(appData); leaked = true; } catch { /* درست است */ }
  if (leaked) problems.push('گاردِ مسیر نشتی دارد: دادهٔ برنامهٔ اصلی خواندنی تشخیص داده شد.');

  // ۳) هیچ ردی از اجرای دستور/کدِ دلخواه در کد نباشد
  const banned = scanSourceForBannedApis();
  for (const h of banned) problems.push(`${h.why} در ${h.file} (${h.pattern})`);

  // ۴) سرویس نباید هیچ‌چیزی را از bin/ وارد کند.
  //    اسکریپت‌های bin/ (مثلِ تشخیصِ سخت‌افزار) اجازهٔ اجرای دستور دارند چون
  //    صاحبِ سرور دستی اجرایشان می‌کند. اگر روزی کسی یکی از آن‌ها را داخلِ
  //    سرویس import کند، همان اجازه به سرویس نشت می‌کند — پس همین‌جا بسته است.
  for (const file of walkJs(path.join(ROOT, 'src'))) {
    let src = '';
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (/\bfrom\s+['"][^'"]*\/bin\//.test(src) || /\bimport\s*\(\s*['"][^'"]*\/bin\//.test(src)) {
      problems.push(`${path.relative(ROOT, file)} از پوشهٔ bin/ چیزی وارد می‌کند — اجازهٔ اجرای دستور نباید به سرویس برسد`);
    }
  }

  // ۵) Knowledge Base باید باشد، وگرنه دستیار چیزی برای گفتن ندارد
  if (!fs.existsSync(KB_DIR)) problems.push(`پوشهٔ دانش پیدا نشد: ${KB_DIR}`);

  return { ok: problems.length === 0, problems, notes };
}

/** اگر مرز شکسته باشد، پروسه را با پیامِ روشن می‌بندد. */
export function enforceBoundaryOrExit() {
  const { ok, problems, notes } = runBoundaryChecks();
  for (const n of notes) console.log('   ℹ️  ' + n);
  if (ok) {
    console.log('   ✅ مرزِ امنیتی سالم است (فقط‌خواندنی، جدا از برنامهٔ اصلی، بدونِ اجرای دستور)');
    return;
  }
  console.error('\n❌ سرویس بالا نیامد — مرزِ امنیتی شکسته است:\n');
  for (const p of problems) console.error('   • ' + p);
  console.error('\n   توضیحِ هر قاعده در ai-support/ARCHITECTURE-fa.md بخشِ ۲.\n');
  process.exit(1);
}
