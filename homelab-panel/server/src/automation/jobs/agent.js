// ---------------------------------------------------------------------------
//  کارهای دستیار — گزارشِ صبحگاهی و خاموشیِ بی‌کاری
//
//  پیش از این دستیار دو شمارندهٔ خودش را داشت (reports.startScheduler هر
//  دقیقه، guard.startGuard هر ۳۰ ثانیه). حالا موتور صاحبِ زمان‌بندی است و
//  agent/index.js با ownTimers:false بالا می‌آید — همان توابع برای آزمون و برای
//  HLP_AUTOMATION=0 سرِ جایشان مانده‌اند.
// ---------------------------------------------------------------------------
import { defineJob } from '../engine.js';
import { getSetting } from '../../db.js';
import { config } from '../../config.js';
import * as guard from '../../agent/guard.js';
import * as memory from '../../agent/memory.js';
import { runDailyReport } from '../../agent/reports.js';

export const morningReport = defineJob({
  name: 'agent-morning-report',
  title: 'گزارشِ صبحگاهیِ دستیار',
  description: 'هر روز ۸:۰۰ (ساعتش در تنظیماتِ دستیار عوض می‌شود) — خلاصهٔ ۲۴ ساعتِ گذشته در پنل و ایمیل',
  // ساعت از تنظیماتِ دستیار می‌آید، پس الگو تابع است و هر بار تازه خوانده می‌شود
  schedule: () => `0 ${guard.settings().reportHour} * * *`,
  timeout: 10 * 60_000,
  async run(ctx) {
    if (!config.agent?.enabled) return { skipped: true, reason: 'دستیار با HLP_AGENT=0 برداشته شده' };
    if (!guard.settings().enabled) return { skipped: true, reason: 'دستیار خاموش است' };
    if (getSetting('agent_daily_report', '1') === '0') return { skipped: true, reason: 'گزارشِ روزانه در تنظیمات خاموش است' };
    if (ctx.trigger === 'scheduled') {
      const last = memory.lastReportAt('daily');
      if (last && new Date(last).toDateString() === new Date().toDateString()) return { skipped: true, reason: 'گزارشِ امروز از قبل ساخته شده' };
    }
    const r = await runDailyReport({ trigger: ctx.trigger === 'manual' ? 'automation:manual' : 'scheduled' });
    ctx.log(`${r.title} (#${r.id})`);
    return { id: r.id, title: r.title };
  },
  async onFail(ctx, err) {
    await ctx.notify('warn', `گزارشِ صبحگاهی ساخته نشد: ${err.message}`);
  },
});

export const agentIdleOff = defineJob({
  name: 'agent-idle-off',
  title: 'خاموشیِ دستیارِ بی‌کار',
  description: 'هر دقیقه — اگر مدل بار شده و ۳۰ دقیقه (تنظیم‌شدنی) کسی چیزی نپرسیده، از رَم بیرون می‌رود',
  every: 60_000,
  timeout: 30_000,
  quiet: true,
  async run(ctx) {
    if (!config.agent?.enabled) return { skipped: true, reason: 'دستیار با HLP_AGENT=0 برداشته شده' };
    const r = await guard.idleCheck();
    if (r.unloaded) ctx.log(`مدل بعد از ${r.idleMinutes} دقیقه بی‌کاری از حافظه بیرون رفت`);
    return r;
  },
});

export default [morningReport, agentIdleOff];
