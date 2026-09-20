// ---------------------------------------------------------------------------
//  فهرستِ کارها — همان جدولِ ۱۰.۲ پرامپت، یک‌به‌یک
//
//  «تمدید SSL» این‌جا نیست: کارِ Caddy/Cloudflare است و پنل فقط انقضایش را
//  پایش می‌کند (control/monitor.js → checkExpiries).
//
//  با HLP_AUTOMATION_TEST_JOBS=1 چهار کارِ آزمایشی هم ثبت می‌شوند — فقط برای
//  test/automation.mjs؛ در نصبِ واقعی دیده نمی‌شوند.
// ---------------------------------------------------------------------------
import { defineJob } from '../engine.js';
import backupJobs from './backup.js';
import healthJobs from './health.js';
import maintenanceJobs from './maintenance.js';
import agentJobs from './agent.js';

export const jobs = [...backupJobs, ...healthJobs, ...maintenanceJobs, ...agentJobs];

/** نام‌های جدولِ ۱۰.۲ — آزمون همین فهرست را با ثبت‌شده‌ها می‌سنجد */
export const REQUIRED_JOBS = Object.freeze([
  'backup-daily', 'backup-weekly', 'backup-monthly', 'offsite-push',
  'health-check', 'uptime', 'metrics', 'thermal-guard',
  'log-rotate', 'temp-cleanup', 'db-vacuum', 'security-updates',
  'agent-morning-report', 'restart-on-down', 'disk-alert', 'suspicious-login-alert', 'agent-idle-off',
]);

export function testJobs() {
  if (process.env.HLP_AUTOMATION_TEST_JOBS !== '1') return [];
  const sleepMs = Math.max(200, Number(process.env.HLP_AUTOMATION_TEST_SLEEP_MS) || 3000);
  return [
    defineJob({
      name: 'test-sleep',
      title: 'آزمایشی — خواب',
      description: 'فقط برای آزمون: چند ثانیه می‌خوابد تا قفلِ هم‌زمانی سنجیده شود',
      timeout: 60_000,
      attempts: 1,
      async run(ctx) {
        ctx.log(`می‌خوابم ${sleepMs}ms`);
        await new Promise((r) => setTimeout(r, sleepMs));
        return { slept: sleepMs };
      },
    }),
    defineJob({
      name: 'test-fail',
      title: 'آزمایشی — همیشه خطا',
      description: 'فقط برای آزمون: هر بار خطا می‌دهد تا تلاشِ دوباره و onFail سنجیده شود',
      timeout: 60_000,
      async run(ctx) {
        ctx.log(`تلاشِ ${ctx.attempt}`);
        throw new Error(`خطای عمدی در تلاشِ ${ctx.attempt}`);
      },
      async onFail(ctx, err) {
        ctx.log(`onFail: ${err.message}`);
        ctx.emit('test.failed', { attempt: ctx.attempt });
      },
    }),
    defineJob({
      name: 'test-timeout',
      title: 'آزمایشی — مهلت',
      description: 'فقط برای آزمون: از مهلتش می‌گذرد',
      timeout: 1000,
      attempts: 1,
      async run() {
        await new Promise((r) => setTimeout(r, 5000));
      },
    }),
    defineJob({
      name: 'test-minutely',
      title: 'آزمایشی — هر دقیقه',
      description: 'فقط برای آزمون: زمان‌بند و روشن/خاموش',
      schedule: '* * * * *',
      timeout: 10_000,
      attempts: 1,
      catchUp: false,
      async run() {
        return { tick: Date.now() };
      },
    }),
  ];
}
