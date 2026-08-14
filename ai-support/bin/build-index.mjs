#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  ساختِ ایندکسِ دانش
//
//      node bin/build-index.mjs            ← با بردار (اگر مدلِ امبدینگ باشد)
//      node bin/build-index.mjs --no-vec   ← فقط واژگانی، سریع
//
//  بعد از هر تغییر در پوشهٔ knowledge/ این را اجرا کنید. اگر یادتان رفت هم
//  سرویس بالا می‌آید و ایندکس را در حافظه می‌سازد — فقط بردارها را نخواهد داشت.
// ═══════════════════════════════════════════════════════════════════════════

import { buildIndex } from '../src/rag/store.js';
import { enforceBoundaryOrExit } from '../src/security/guard.js';

console.log('\n🔧 ساختِ ایندکسِ دانش\n');
enforceBoundaryOrExit();

const withVectors = !process.argv.includes('--no-vec');

try {
  await buildIndex({ withVectors });
  console.log('\n✅ تمام شد.\n');
} catch (e) {
  console.error('\n❌ ساختِ ایندکس شکست خورد:', e.message, '\n');
  process.exit(1);
}
