// ---------------------------------------------------------------------------
//  گزارشِ صبحگاهی و تحلیلِ رخداد
//
//  بخشِ ۹.۳ پرامپت:
//    ۱) گزارشِ صبحگاهی (خودکار، ۸ صبح): خلاصهٔ ۲۴ ساعتِ گذشته — سرویس‌ها،
//       پشتیبان‌ها، خطاها، ورودها، دما و دیسک. در پنل و (اگر تنظیم باشد) ایمیل.
//    ۲/۳) خطای تکراری یا سرویسِ افتاده: علتِ احتمالی + پیشنهادِ رفع + پیشنهادِ
//       ری‌استارت با تأیید.
//
//  ستونِ فقراتِ گزارش **بی مدل** ساخته می‌شود (حقیقی و همیشه)؛ اگر مدل بالا
//  بود، یک بندِ «جمع‌بندی و توصیه» بالایش می‌نشیند. یعنی صبحِ بی Ollama هم
//  گزارش می‌آید.
// ---------------------------------------------------------------------------
import { db, logEvent, getSetting } from '../db.js';
import { runTool } from './tools.js';
import { compose } from './agent.js';
import * as memory from './memory.js';
import * as guard from './guard.js';
import { getIo } from '../state.js';

const DAY = 24 * 3600e3;
const fa = (n) => (n == null ? '—' : Number(n).toLocaleString('fa-IR'));
const when = (t) => (t ? new Date(t).toLocaleString('fa-IR') : '—');
const fmtBytes = (n) => {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let v = Number(n); let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

/** داده‌های ۲۴ ساعتِ گذشته — همان چیزی که گزارش رویش می‌ایستد */
export async function collectDaily({ since = Date.now() - DAY } = {}) {
  const get = async (name, args) => (await runTool(name, args, { requestedBy: 'report' })).result || null;
  const [metrics, uptime, sites, backups, disk, stations, account] = await Promise.all([
    get('get_metrics'), get('check_uptime'), get('list_sites'), get('list_backups'), get('disk_usage'), get('list_stations'), get('account_server_status'),
  ]);
  const counts = db.prepare('SELECT level, COUNT(*) AS n FROM events WHERE created_at >= ? GROUP BY level').all(since)
    .reduce((o, r) => ({ ...o, [r.level]: r.n }), {});
  const topErrors = db.prepare(`SELECT source, substr(message, 1, 140) AS message, COUNT(*) AS n, MAX(created_at) AS last_at
      FROM events WHERE created_at >= ? AND level = 'error' GROUP BY source, substr(message, 1, 140) ORDER BY n DESC LIMIT 8`).all(since);
  const logins = db.prepare(`SELECT actor, action, result, ip, at FROM cc_audit WHERE at >= ? AND (action LIKE 'auth.%' OR action LIKE '%login%') ORDER BY at DESC LIMIT 30`).all(since);
  const alertsRaised = db.prepare('SELECT COUNT(*) AS n FROM cc_alerts WHERE first_at >= ?').get(since)?.n || 0;
  const alertsResolved = db.prepare("SELECT COUNT(*) AS n FROM cc_alerts WHERE status = 'resolved' AND last_at >= ?").get(since)?.n || 0;
  return { since, metrics, uptime, sites, backups, disk, stations, account, counts, topErrors, logins, alertsRaised, alertsResolved };
}

/** متنِ گزارش — بی مدل، همیشه */
export function renderDaily(d) {
  const L = [];
  const m = d.metrics || {};
  L.push(`# گزارشِ صبحگاهیِ سرور — ${new Date().toLocaleDateString('fa-IR')}`);
  L.push('');
  L.push(`**همین حالا:** پردازنده ${fa(m.cpuPercent)}٪ · حافظه ${fa(m.memory?.percent)}٪ · دیسک ${fa(m.disk?.percent)}٪${m.temperatureC != null ? ` · دما ${fa(m.temperatureC)}°C` : ''} · روشن از ${fa(Math.round((m.host?.uptimeSeconds || 0) / 3600))} ساعت پیش · پنل ${m.panelVersion || ''}`);
  L.push('');
  L.push('## سرویس‌ها و سایت‌ها');
  const sites = d.sites || [];
  const down = sites.filter((s) => s.enabled && !s.online);
  L.push(`- ${fa(sites.length)} سایت ثبت شده؛ ${fa(sites.filter((s) => s.online).length)} بالا${down.length ? `، **${fa(down.length)} پایین:** ${down.map((s) => s.name || s.slug).join('، ')}` : ''}`);
  const kinds = Object.entries(d.uptime?.byKind || {});
  if (kinds.length) L.push(`- پایش: ${kinds.map(([k, v]) => `${k} ${fa(v.online)}/${fa(v.total)}`).join(' · ')}`);
  L.push(`- هشدارها: ${fa(d.alertsRaised)} تازه، ${fa(d.alertsResolved)} حل‌شده، ${fa(d.uptime?.openAlerts?.length || 0)} باز${d.uptime?.openAlerts?.length ? ' — ' + d.uptime.openAlerts.slice(0, 4).map((a) => a.title).join('؛ ') : ''}`);
  if (d.uptime?.tunnel) L.push(`- تونلِ اینترنت: ${d.uptime.tunnel.status || '—'}${d.uptime.tunnel.url ? ` (${d.uptime.tunnel.url})` : ''}`);
  L.push('');
  L.push('## خطاها و رویدادها (۲۴ ساعت)');
  L.push(`- ${fa(d.counts.error || 0)} خطا · ${fa(d.counts.warn || 0)} هشدار · ${fa(d.counts.info || 0)} رویدادِ عادی`);
  for (const e of d.topErrors || []) L.push(`- ${fa(e.n)}× [${e.source}] ${e.message} (آخرین: ${when(e.last_at)})`);
  L.push('');
  L.push('## پشتیبان‌ها');
  const b = d.backups?.backups?.[0];
  L.push(b ? `- آخرین پشتیبانِ پنل: ${when(b.createdAt)} — ${fmtBytes(b.sizeBytes)} (${b.reason})${Date.now() - b.createdAt > 2 * DAY ? ' ⚠️ بیش از دو روز گذشته' : ''}` : '- ⚠️ هیچ پشتیبانی از دیتابیسِ پنل نیست');
  L.push('');
  L.push('## دیسک');
  for (const x of d.disk?.disks || []) L.push(`- ${x.mount}: ${fa(x.usage)}٪ پر، ${fmtBytes(x.free)} آزاد${x.usage >= 80 ? ' ⚠️' : ''}`);
  if (d.disk?.storage?.biggest?.length) L.push(`- بزرگ‌ترین پروژه‌ها: ${d.disk.storage.biggest.slice(0, 4).map((i) => `${i.name} ${fmtBytes(i.bytes)}`).join(' · ')}`);
  L.push('');
  L.push('## ورودها');
  L.push(d.logins?.length ? `- ${fa(d.logins.length)} رویدادِ ورود/احراز؛ ناموفق: ${fa(d.logins.filter((x) => x.result !== 'ok').length)}` : '- رویدادِ ورودی ثبت نشده');
  if (d.stations?.enabled) {
    L.push('');
    L.push('## پمپ‌ها');
    const st = d.stations.stations || [];
    const stale = st.filter((s) => !s.liveAt || Date.now() - s.liveAt > DAY);
    L.push(`- ${fa(st.length)} پمپ؛ ${stale.length ? `**${fa(stale.length)} بی‌تپش در ۲۴ ساعت:** ${stale.map((s) => s.name || s.code).join('، ')}` : 'همه در ۲۴ ساعتِ اخیر تپش داشته‌اند'}`);
  }
  if (d.account) {
    L.push('');
    L.push('## سرورِ حساب');
    L.push(`- ${d.account.server?.up ? `بالا (نسخهٔ ${d.account.server.version || '?'})` : '⚠️ پایین'}${d.account.expiring?.length ? ` · ${fa(d.account.expiring.length)} اشتراکِ رو به پایان در هفتهٔ آینده` : ''}`);
  }
  return L.join('\n');
}

/** ساختن و ثبتِ گزارش — با جمع‌بندیِ مدل اگر بود */
export async function runDailyReport({ trigger = 'scheduled' } = {}) {
  const data = await collectDaily();
  let body = renderDaily(data);
  const summary = await compose(`این گزارشِ خامِ ۲۴ ساعتِ گذشتهٔ سرور است. در حداکثر پنج جمله جمع‌بندی کن: چه چیزی خوب است، چه چیزی نگران‌کننده است، و دقیقاً چه کاری امروز باید انجام شود. اگر همه‌چیز عادی است همان را بگو.\n<<<DATA report\n${body.slice(0, 6000)}\n>>>`, { maxTokens: 400 });
  if (summary) body = `## جمع‌بندیِ دستیار\n${summary}\n\n${body}`;
  const title = `گزارشِ صبحگاهی ${new Date().toLocaleDateString('fa-IR')}`;
  const id = memory.addReport({ kind: 'daily', title, body });
  logEvent('info', 'agent', `${title} ساخته شد (${trigger})`);
  getIo()?.emit('agent:report', { id, title, kind: 'daily', at: Date.now() });
  await emailReport({ title, body }).catch(() => {});
  return { id, title, body };
}

/** ایمیلِ گزارش — فقط اگر مدیر نشانی داده و رباتِ ایمیل تنظیم است */
async function emailReport({ title, body }) {
  const to = guard.settings().reportEmail;
  if (!to) return false;
  const { mailReady, mailerOptions } = await import('../codes/mail.js');
  const { codeSettings } = await import('../codes/settings.js');
  const { sendMail } = await import('../appauth/smtp.js');
  const settings = codeSettings();
  if (!mailReady(settings)) return false;
  await sendMail({ ...mailerOptions(settings), from: settings.email.from, fromName: settings.email.fromName || 'دستیارِ سرور', to, subject: title, text: body, html: `<pre style="font-family:inherit;white-space:pre-wrap;direction:rtl">${body.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>` });
  return true;
}

/**
 * تحلیلِ یک هشدارِ تازه — رخداد ثبت می‌شود، اگر مدل بود علت و راه، و برای
 * سایتِ افتاده پیشنهادِ ری‌استارت (منتظرِ تأیید).
 */
export async function analyzeAlert(alert) {
  if (!alert?.title) return null;
  const similar = memory.similarIncidents(alert.title, 3);
  const id = memory.addIncident({ kind: alert.kind || 'alert', title: alert.title, detail: alert.detail || '' });
  let analysis = '';
  const logs = (await runTool('read_logs', { level: 'error', limit: 12, sinceMinutes: 120 }, { requestedBy: 'analysis' })).result;
  analysis = await compose(`این هشدار روی سرور ثبت شد. علتِ احتمالی را از روی لاگ‌ها بگو و در دو تا چهار جمله راهِ رفع را پیشنهاد بده.${similar.length ? ` رخدادهای مشابهِ قبلی: ${similar.map((s) => `«${s.title}» → ${s.solution}`).join('؛ ')}` : ''}\n<<<DATA alert\n${JSON.stringify({ alert: { kind: alert.kind, severity: alert.severity, title: alert.title, detail: alert.detail }, recentErrors: logs?.events?.slice(0, 12) }).slice(0, 5000)}\n>>>`, { maxTokens: 300 });
  if (!analysis && similar.length) analysis = `قبلاً مشابهش پیش آمده: ${similar.map((s) => `«${s.title}» → ${s.solution}`).join('؛ ')}`;
  memory.updateIncident(id, { analysis });

  // سایت/سرویسِ افتاده ⇒ پیشنهادِ ری‌استارت، منتظرِ تأیید
  let proposal = null;
  const slug = alert.slug || alert.site || null;
  if (slug && /down|offline|افتاد|پایین/i.test(`${alert.kind} ${alert.title}`)) {
    const r = await runTool('restart_site', { slug }, { requestedBy: 'agent', onProposal: (a) => { proposal = a; } });
    if (!r.ok) proposal = null;
  }
  getIo()?.emit('agent:incident', { id, title: alert.title, analysis, proposal });
  return { id, analysis, proposal };
}

let timer = null;
/** هر دقیقه: اگر ساعتِ گزارش رسیده و امروز نساخته‌ایم، بساز */
export function startScheduler() {
  stopScheduler();
  timer = setInterval(async () => {
    try {
      const cfg = guard.settings();
      if (!cfg.enabled) return;
      const now = new Date();
      if (now.getHours() !== cfg.reportHour) return;
      const last = memory.lastReportAt('daily');
      if (last && new Date(last).toDateString() === now.toDateString()) return;
      if (getSetting('agent_daily_report', '1') === '0') return;
      await runDailyReport({ trigger: 'scheduled' });
    } catch (e) {
      logEvent('warn', 'agent', `گزارشِ صبحگاهی ساخته نشد: ${e.message}`);
    }
  }, 60_000);
  timer.unref?.();
}
export function stopScheduler() { if (timer) clearInterval(timer); timer = null; }
