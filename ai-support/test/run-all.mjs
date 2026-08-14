#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  اجرای همهٔ تست‌ها
//
//      npm test
//
//  هیچ چارچوبِ تستی لازم نیست — مثلِ خودِ سرویس، وابستگیِ صفر.
//  تست‌ها به Ollama نیاز ندارند: مدل با یک نمونهٔ ساختگی جایگزین می‌شود.
// ═══════════════════════════════════════════════════════════════════════════

import { summary, runQueued } from './helpers.mjs';

// پوشهٔ دادهٔ جدا برای تست تا فایل‌های واقعی دست نخورند
process.env.AI_DATA_DIR = process.env.AI_DATA_DIR || new URL('../data/test', import.meta.url).pathname;

const suites = [
  ['امنیت',            './security.test.mjs'],
  ['فقط‌خواندنی',       './readonly.test.mjs'],
  ['تزریقِ دستور',      './injection.test.mjs'],
  ['بازیابی و دانش',   './rag.test.mjs'],
  ['سرویس',            './service.test.mjs'],
  ['ایمنیِ ظاهر',      './ui-safety.test.mjs'],
];

console.log('\n🧪 تست‌های دستیارِ پشتیبانی');

for (const [name, file] of suites) {
  console.log(`\n${'═'.repeat(60)}\n  ${name}`);
  try {
    const mod = await import(file);
    await mod.default();
    await runQueued();   // ثبت‌شده‌ها را همین‌جا و به ترتیب اجرا کن
  } catch (e) {
    console.log(`  ❌ خودِ مجموعهٔ «${name}» اجرا نشد: ${e.message}`);
    console.log(e.stack?.split('\n').slice(1, 4).join('\n'));
    process.exitCode = 1;
  }
}

process.exit(summary() || process.exitCode || 0);
