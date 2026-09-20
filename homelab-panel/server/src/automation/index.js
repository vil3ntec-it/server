// ---------------------------------------------------------------------------
//  موتورِ اتوماسیون — نقطهٔ راه‌اندازی (بخشِ ۱۰ پرامپت)
//
//  index.js فقط همین دو تابع را می‌شناسد. HLP_AUTOMATION=0 کلِ موتور را
//  برمی‌دارد و پنل با شمارنده‌های قدیمیِ خودش (پشتیبانِ ۲۴ساعته، پایشِ
//  ۳۰ثانیه‌ای، نگهبان و گزارشِ دستیار) کار می‌کند — همان رفتارِ پیش از ۱.۴۴.
// ---------------------------------------------------------------------------
import { logEvent } from '../db.js';
import * as engine from './engine.js';
import { jobs, testJobs, REQUIRED_JOBS } from './jobs/index.js';
import { attachAlertSource, detachAlertSource } from './sources.js';

export const automationEnabled = (process.env.HLP_AUTOMATION ?? '1') !== '0';

let registered = false;

/** ثبتِ همهٔ کارها — یک بار؛ برای آزمون‌ها بی راه‌اندازیِ زمان‌بند هم صدا زدنی است */
export function registerAll() {
  if (registered) return engine.jobNames();
  for (const job of [...jobs, ...testJobs()]) engine.register(job);
  registered = true;
  const missing = REQUIRED_JOBS.filter((n) => !engine.getJob(n));
  if (missing.length) throw new Error(`automation: کارهای ${missing.join('، ')} ثبت نشده‌اند`);
  return engine.jobNames();
}

export function startAutomation() {
  if (!automationEnabled) return false;
  registerAll();
  attachAlertSource();
  engine.start();
  logEvent('info', 'automation', `موتورِ اتوماسیون با ${engine.jobNames().length} کار بالا آمد`);
  return true;
}

export function stopAutomation() {
  detachAlertSource();
  engine.stop();
}

export { engine, REQUIRED_JOBS };
export { noteLogin } from './sources.js';
