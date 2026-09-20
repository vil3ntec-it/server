// ---------------------------------------------------------------------------
//  سلامت و پایش — و کارهایی که با رویداد می‌دوند
//
//    health-check     هر دقیقه: سایتی که باید بالا باشد و نیست ⇒ service.down
//    uptime           هر دو دقیقه: همان تیکِ control/monitor.js (Endpoint، دامنه،
//                     سرور، تونل، دیتابیس) — موتور صاحبِ زمان‌بندی‌اش است
//    metrics          هر ۳۰ ثانیه: جمع‌آورنده (metrics/index.js) خودش می‌گیرد؛
//                     این کار همان عکسِ آخر را می‌خواند، دو بار نمی‌سنجد، و
//                     دیسکِ پُر را به رویداد تبدیل می‌کند
//    thermal-guard    هر ۳۰ ثانیه: تیکِ نگهبانِ حرارتیِ دستیار (agent/guard.js)
//    restart-on-down  رویدادِ service.down ⇒ ری‌استارت، تا سه بار، بعد هشدارِ بحرانی
//    disk-alert       رویدادِ disk.high ⇒ هشدار
//    suspicious-login-alert  رویدادِ login.suspicious ⇒ هشدار
// ---------------------------------------------------------------------------
import { defineJob } from '../engine.js';
import { getSetting } from '../../db.js';
import { getSiteBySlug, listSitesRaw } from '../../sites/registry.js';
import { isRunning, restartSite } from '../../sites/process.js';
import { tick as monitorTick, syncMonitors } from '../../control/monitor.js';
import { getLatest as latestMetrics, collectorStatus } from '../../metrics/index.js';
import * as guard from '../../agent/guard.js';
import { raiseAlert, clearAlert } from '../../control/alerts.js';
import { getIo } from '../../state.js';

/** آستانهٔ دیسک (درصد) — HLP_DISK_HIGH */
export const DISK_HIGH_PERCENT = Math.min(99, Math.max(50, Number(process.env.HLP_DISK_HIGH) || 80));
const DISK_REMIND_MS = 6 * 3600e3;
const RESTART_MAX = 3;
const RESTART_WINDOW_MS = 30 * 60e3;

/* ------------------------------ health-check ---------------------------- */

export const healthCheck = defineJob({
  name: 'health-check',
  title: 'بررسیِ سلامتِ سرویس‌ها',
  description: 'هر دقیقه — سایت/برنامه‌ای که «اجرای خودکار» دارد و پروسه‌اش نیست، رویدادِ service.down می‌گیرد',
  schedule: '* * * * *',
  timeout: 30_000,
  quiet: true,
  catchUp: false,
  async run(ctx) {
    const should = listSitesRaw().filter((s) => s.autostart && s.enabled);
    const down = should.filter((s) => !isRunning(s.slug));
    for (const s of down) {
      ctx.emit('service.down', { slug: s.slug, name: s.name, siteId: s.id, port: s.port, source: 'health-check' });
    }
    return { checked: should.length, down: down.map((s) => s.slug) };
  },
});

/* --------------------------------- uptime ------------------------------- */

export const uptime = defineJob({
  name: 'uptime',
  title: 'بررسیِ Uptime',
  description: 'هر دو دقیقه — Endpointها، دامنه‌ها، سرورها، تونل‌ها و دیتابیس‌های ثبت‌شده (control/monitor.js)',
  schedule: '*/2 * * * *',
  timeout: 110_000,
  quiet: true,
  catchUp: false,
  runOnStart: 8000,
  async run(ctx) {
    if (getSetting('cc_monitor_enabled', true) === false) return { skipped: true, reason: 'پایش در تنظیماتِ مرکز فرمان خاموش است' };
    if (ctx.trigger !== 'scheduled') syncMonitors();
    const r = await monitorTick();
    if (r?.skipped) return { skipped: true, reason: 'یک بررسیِ قبلی هنوز در جریان است' };
    return { checked: r?.checked ?? 0 };
  },
});

/* -------------------------------- metrics ------------------------------- */

let diskHighSince = 0;
let diskLastEmit = 0;

export const metricsJob = defineJob({
  name: 'metrics',
  title: 'جمع‌آوریِ متریک',
  description: 'هر ۳۰ ثانیه — عکسِ آخرِ جمع‌آورنده (که خودش هر ۲ تا ۳۰ ثانیه می‌گیرد) خوانده می‌شود؛ دیسکِ بالای آستانه ⇒ disk.high',
  every: 30_000,
  timeout: 10_000,
  quiet: true,
  async run(ctx) {
    const snap = latestMetrics();
    if (!snap) return { skipped: true, reason: 'جمع‌آورنده هنوز نمونه‌ای نگرفته' };
    const usage = Number(snap.disk?.usage);
    const line = `cpu ${snap.cpu?.usage ?? '—'}٪ · حافظه ${snap.memory?.usage ?? '—'}٪ · دیسک ${Number.isFinite(usage) ? usage : '—'}٪${snap.temperature?.max != null ? ` · دما ${snap.temperature.max}°C` : ''}`;
    ctx.log(line);
    const now = Date.now();
    if (Number.isFinite(usage) && usage >= DISK_HIGH_PERCENT) {
      if (!diskHighSince) diskHighSince = now;
      // بارِ اول همان لحظه، بعد هر شش ساعت تا وقتی پُر است
      if (!diskLastEmit || now - diskLastEmit >= DISK_REMIND_MS) {
        diskLastEmit = now;
        const worst = (snap.disk?.disks || []).slice().sort((a, b) => (b.usage || 0) - (a.usage || 0))[0] || null;
        ctx.emit('disk.high', { usage, threshold: DISK_HIGH_PERCENT, free: snap.disk?.free ?? null, worst: worst ? { mount: worst.mount, usage: worst.usage, free: worst.free } : null, since: diskHighSince });
      }
    } else if (diskHighSince) {
      diskHighSince = 0;
      diskLastEmit = 0;
      clearAlert('disk:high');
    }
    return { sampledAt: snap.at, collector: collectorStatus(), disk: Number.isFinite(usage) ? usage : null };
  },
});

/* ----------------------------- thermal-guard ---------------------------- */

let tempHigh = false;

export const thermalGuard = defineJob({
  name: 'thermal-guard',
  title: 'نگهبانِ حرارتی',
  description: 'هر ۳۰ ثانیه — دمای پردازنده؛ بالای آستانهٔ مکث ⇒ temp.high، و تصمیمِ نگهبانِ دستیار (مکث/خاموشی/برگشت)',
  every: 30_000,
  timeout: 15_000,
  quiet: true,
  async run(ctx) {
    const st = await guard.tick({
      idle: false,
      notify: (n) => {
        try { getIo()?.emit('agent:notice', { ...n, at: Date.now() }); } catch { /* هنوز کسی وصل نیست */ }
      },
    });
    const t = st.lastTempC;
    if (t != null && Number.isFinite(t)) {
      ctx.log(`دما ${t}°C${st.paused ? ' · دستیار در مکث' : ''}${st.stoppedByHeat ? ' · دستیار به‌خاطرِ گرما خاموش' : ''}`);
      if (t > st.pauseAtC && !tempHigh) {
        tempHigh = true;
        ctx.emit('temp.high', { tempC: t, pauseAtC: st.pauseAtC, stopAtC: st.stopAtC });
        raiseAlert({ key: 'temp:high', kind: 'temp_high', severity: t > st.stopAtC ? 'critical' : 'warn', title: `دمای پردازنده ${t}°C است`, detail: `آستانهٔ مکث ${st.pauseAtC}°C، خاموشی ${st.stopAtC}°C` });
      } else if (tempHigh && t < st.resumeBelowC) {
        tempHigh = false;
        clearAlert('temp:high');
      }
    } else {
      ctx.log('سنسورِ دما در دسترس نیست');
    }
    return { tempC: t, paused: st.paused, stoppedByHeat: st.stoppedByHeat };
  },
});

/* ----------------------------- restart-on-down -------------------------- */

/** slug → { count, firstAt } — تلاش‌های اخیر برای هر سایت */
const restartAttempts = new Map();

export const restartOnDown = defineJob({
  name: 'restart-on-down',
  title: 'ری‌استارتِ سرویسِ افتاده',
  description: 'رویدادِ service.down — سایت دوباره اجرا می‌شود؛ بعد از سه بار در نیم ساعت، هشدارِ بحرانی و دیگر دست نمی‌زند',
  event: 'service.down',
  timeout: 60_000,
  attempts: 1,
  async run(ctx) {
    const slug = ctx.payload?.slug;
    if (!slug) return { skipped: true, reason: `چیزی برای ری‌استارت نیست (${ctx.payload?.kind || ctx.payload?.key || 'هدفِ پایش'})` };
    const site = getSiteBySlug(slug);
    if (!site) return { skipped: true, reason: `سایتِ «${slug}» دیگر ثبت نیست` };
    if (isRunning(slug)) {
      restartAttempts.delete(slug);
      clearAlert(`service:${slug}:down`);
      return { skipped: true, reason: 'همین حالا بالاست' };
    }

    const now = Date.now();
    let rec = restartAttempts.get(slug);
    if (!rec || now - rec.firstAt > RESTART_WINDOW_MS) rec = { count: 0, firstAt: now };
    if (rec.count >= RESTART_MAX) {
      return { skipped: true, reason: `${RESTART_MAX} بار در نیم ساعت تلاش شد — هشدار داده شده، منتظرِ دستِ آدم` };
    }
    rec.count++;
    restartAttempts.set(slug, rec);

    ctx.log(`تلاشِ ${rec.count} از ${RESTART_MAX}: ری‌استارتِ «${site.name}» روی پورتِ ${site.port}`);
    const res = await restartSite(site);
    if (!res.ok) throw Object.assign(new Error(`ری‌استارت نشد: ${res.error}`), { restartResult: res });
    // پروسه‌ای که همان لحظه می‌میرد «بالا» نیست؛ کمی صبر و دوباره نگاه
    await new Promise((r) => setTimeout(r, 2500));
    if (!isRunning(slug)) {
      if (rec.count >= RESTART_MAX) {
        raiseAlert({ key: `service:${slug}:down`, kind: 'service_down', severity: 'critical', title: `«${site.name}» بعد از ${RESTART_MAX} بار ری‌استارت هم بالا نماند`, detail: `پورت ${site.port} · لاگِ خودِ سایت را ببینید` });
        await ctx.notify('critical', `«${site.name}» بعد از ${RESTART_MAX} بار ری‌استارت هم بالا نماند`);
      }
      throw new Error(`«${site.name}» بعد از ری‌استارت دوباره افتاد`);
    }
    restartAttempts.delete(slug);
    clearAlert(`service:${slug}:down`);
    await ctx.notify('info', `«${site.name}» دوباره بالا آمد`);
    return { slug, pid: res.pid ?? null, attempt: rec.count };
  },
});

/* -------------------------------- disk-alert ---------------------------- */

export const diskAlert = defineJob({
  name: 'disk-alert',
  title: 'هشدارِ دیسک',
  description: 'رویدادِ disk.high — هشدار در مرکز فرمان و اعلان',
  event: 'disk.high',
  timeout: 10_000,
  attempts: 1,
  async run(ctx) {
    const p = ctx.payload || {};
    const usage = Number(p.usage);
    const sev = usage >= 90 ? 'critical' : 'warn';
    const gb = p.free != null ? ` · ${(Number(p.free) / 1024 ** 3).toFixed(1)} گیگ آزاد` : '';
    raiseAlert({ key: 'disk:high', kind: 'disk_high', severity: sev, title: `دیسک ${usage}٪ پر است`, detail: `آستانه ${p.threshold}٪${gb}${p.worst ? ` · پُرترین: ${p.worst.mount} ${p.worst.usage}٪` : ''}` });
    await ctx.notify(sev, `دیسک ${usage}٪ پر است${gb}`);
    return { usage, severity: sev };
  },
});

/* -------------------------- suspicious-login-alert ---------------------- */

export const suspiciousLoginAlert = defineJob({
  name: 'suspicious-login-alert',
  title: 'هشدارِ ورودِ مشکوک',
  description: 'رویدادِ login.suspicious — رگبارِ ورودِ ناموفق یا ورودِ موفق از IPِ تازه',
  event: 'login.suspicious',
  timeout: 10_000,
  attempts: 1,
  async run(ctx) {
    const p = ctx.payload || {};
    const what = p.reason === 'burst'
      ? `${p.failures} ورودِ ناموفق از ${p.ip || '?'} در ${Math.round((p.windowMs || 0) / 60000)} دقیقه${p.username ? ` (نامِ «${p.username}»)` : ''}`
      : `ورودِ «${p.username}» از IPِ تازه: ${p.ip || '?'}`;
    raiseAlert({ key: `login:suspicious:${p.ip || 'unknown'}`, kind: 'login_suspicious', severity: p.reason === 'burst' ? 'critical' : 'warn', title: what, detail: p.userAgent ? String(p.userAgent).slice(0, 200) : null });
    await ctx.notify(p.reason === 'burst' ? 'critical' : 'warn', what);
    return { reason: p.reason, ip: p.ip };
  },
});

export default [healthCheck, uptime, metricsJob, thermalGuard, restartOnDown, diskAlert, suspiciousLoginAlert];
