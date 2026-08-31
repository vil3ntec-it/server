// ---------------------------------------------------------------------------
//  سلامت: دو سؤالِ متفاوت، دو جواب
//
//    /health  «پروسه زنده است؟»          → اگر نه: سرویس را ری‌استارت کن
//    /ready   «الان می‌تواند کار کند؟»    → اگر نه: ترافیک نفرست، ولی نکُش
//
//  چرا جدا: اگر /health به دیتابیس دست بزند و دیتابیس کند شود، health-check
//  تایم‌اوت می‌خورد و ناظر پروسهٔ **سالم** را می‌کشد — دقیقاً وقتی که نباید.
//  پس /health عمداً هیچ وابستگی‌ای را نمی‌زند.
//
//  هیچ‌کدام احراز هویت نمی‌خواهند (لبه باید بتواند بخواندشان) و به همین دلیل
//  هیچ چیزِ حساسی هم نمی‌دهند: نه مسیرِ فایل، نه نامِ میزبان، نه نسخهٔ
//  وابستگی‌ها. همان‌قدر که برای تصمیمِ «سالم/ناسالم» لازم است.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';
import { versionInfo } from '../version.js';

/** جوابِ سبک — بدونِ هیچ وابستگی */
export function healthPayload() {
  return {
    ok: true,
    service: 'pump-yaqobi-server',
    panel: 'homelab-panel',
    version: versionInfo.version,
    build: versionInfo.build,
    root: versionInfo.root,
    time: new Date().toISOString(),
  };
}

function check(name, fn) {
  const started = Date.now();
  try {
    const detail = fn();
    return { name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) };
  } catch (e) {
    // پیامِ خطا می‌تواند مسیرِ فایل داشته باشد؛ فقط نوعش را بیرون می‌دهیم
    return { name, ok: false, ms: Date.now() - started, error: e.code || 'failed' };
  }
}

/**
 * جوابِ عمیق — وابستگی‌ها واقعاً زده می‌شوند.
 * @returns {{ ready: boolean, checks: object[] }}
 */
export function readyPayload() {
  const checks = [
    // خواندن از دیتابیس: اگر فایل قفل یا خراب باشد همین‌جا معلوم می‌شود
    check('database', () => {
      const n = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
      return { migrations: n };
    }),

    // نوشتن روی دیسک: پُر شدنِ دیسک شایع‌ترین خرابیِ یک سرورِ خانگی است و
    // خواندن از دیتابیس آن را نشان نمی‌دهد.
    check('storage', () => {
      const probe = path.join(config.dataDir, '.ready-probe');
      fs.writeFileSync(probe, String(Date.now()));
      fs.rmSync(probe, { force: true });
      return { writable: true };
    }),
  ];

  return { ready: checks.every((c) => c.ok), checks };
}
