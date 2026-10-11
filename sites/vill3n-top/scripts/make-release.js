#!/usr/bin/env node
'use strict';
/*
  release.json را از روی فایل‌های همین پوشه می‌سازد — فهرستی که به‌روزرسانیِ خودکارِ سایت از GitHub می‌خواند.
    node scripts/make-release.js          ساختن/نوشتن
    node scripts/make-release.js --check  فقط سنجیدن (CI): اگر با فایل‌ها نخواند، خطا
  هر تغییری در کد ⇒ نسخهٔ package.json بالا برود و همین دستور زده شود؛ وگرنه سایت‌ها آن را نمی‌گیرند.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safePath } = require('../src/core/updater');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['data', 'runtime', 'node_modules', '.git']);

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (!rel && SKIP.has(e.name)) continue;
    if (r === 'public/assets/fonts') continue; // فونت را خودِ سایت می‌گیرد
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
    else if (e.isFile() && safePath(r) && !/\.(log|tmp|new)$/.test(e.name)) out.push(r);
  }
  return out;
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const files = walk(ROOT).sort().map((p) => {
  const buf = fs.readFileSync(path.join(ROOT, ...p.split('/')));
  return { path: p, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
});
const json = `${JSON.stringify({ version, files }, null, 1)}\n`;
const file = path.join(ROOT, 'release.json');

if (process.argv.includes('--check')) {
  let cur = '';
  try { cur = fs.readFileSync(file, 'utf8'); } catch (_) { /* نیست */ }
  if (cur !== json) {
    console.error('release.json با فایل‌ها نمی‌خواند. بزنید: node scripts/make-release.js (و اگر کد عوض شده، نسخهٔ package.json را هم بالا ببرید)');
    process.exit(1);
  }
  console.log(`release.json درست است (نسخهٔ ${version}، ${files.length} فایل)`);
} else {
  fs.writeFileSync(file, json);
  console.log(`release.json نوشته شد (نسخهٔ ${version}، ${files.length} فایل)`);
}
