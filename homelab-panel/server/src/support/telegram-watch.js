// ---------------------------------------------------------------------------
//  نگهبانِ رباتِ مالک — هشدارها و گزارشِ روزانه (از ۱۴۰۵/۰۷/۲۰، نسخه 1.50.53)
//
//  هشدار (هر کدام یک بار، و «برگشت» وقتی درست شد):
//      💽 دیسکِ ≥ ۹۰٪ (≥ ۹۵٪ بحرانی؛ زیرِ ۸۵٪ برگشت)   🗄 سرورِ حساب ۳ دور پشتِ هم بی‌جواب
//      🌐 سایتی که روشن بود و خاموش شد (با دکمهٔ «▶ روشن کن»)
//  گزارشِ روزانه همراهِ «خلاصهٔ روزانه» ِ دروازه در ساعتِ دلخواه (پیش‌فرض ۲۱ به وقتِ کابل) — روزی **یک** پیام:
//  گفت‌وگوهای منتظر، اشتراک‌های رو به پایان، حساب‌های تازه، سلامتِ سرور + خبرها و هشدارهای نرفتهٔ امروز.
//  ‎/report‎ همان گزارش را همین حالا می‌دهد.
//
//  ⛔ (۱.۵۳.۰) هیچ پیامِ هشداری مستقیم نمی‌رود: همه از دروازهٔ `notify/owner.js` (تکرار، مهلت، سقفِ روزانه،
//     ساعتِ آرام، اهمیت) و در پایانِ همین دور با `flush` — همان صفی که هشدارهای مرکز فرمان و کارهای خودکار هم دارند.
//  ⛔ نگهبان چیزی را عوض نمی‌کند؛ فقط خبر می‌دهد. کار با دکمه و تأییدِ مالک است.
//  ⚠️ هر دقیقه یک بار (HLP_TG_WATCH_MS؛ ۰ = خاموش).
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';
import { cloudRaw } from '../stations/cloud.js';
import { readDisks } from '../metrics/system.js';
import { listSitesRaw } from '../sites/registry.js';
import { isRunning } from '../sites/process.js';
import { btn, fa, statusText, search, daysLeft, APP } from './telegram-admin.js';
import { waiting } from './telegram-inbox.js';
import { deliverConsoleAlerts, consoleAlertPrefs } from './telegram-console-alerts.js';
import * as owner from '../notify/owner.js';

const SETTINGS = 'support_tg_prefs';
const STATE = 'support_tg_watch';
const DAY = 24 * 3600e3;
const HOURS = [7, 8, 9, 10, 12, 18, 21];
let lastRun = 0;

const every = () => { const v = process.env.HLP_TG_WATCH_MS; return v === undefined || v === '' ? 60e3 : Number(v) || 0; };

/** ⚠️ ساعتِ گزارش همان ساعتِ خلاصهٔ دروازه است (یک تنظیم، نه دو) — پنل ⇒ اعلان‌ها هم همین را عوض می‌کند. */
export function prefs() {
  const p = getSetting(SETTINGS, null) || {};
  return { alerts: p.alerts !== false, report: p.report !== false, codes: p.codes !== false, replyOnly: p.replyOnly === true, hour: owner.settings().digestHour };
}
export function setPrefs(patch) {
  const { hour, ...rest } = patch || {};
  if (hour !== undefined && HOURS.includes(Number(hour))) owner.setSettings({ digestHour: Number(hour) });
  const { hour: _old, ...cur } = prefs();
  setSetting(SETTINGS, { ...cur, ...rest });
  return prefs();
}

export function settingsMessage() {
  const p = prefs();
  return {
    text: ['⚙️ تنظیماتِ ربات', '', `🚨 هشدارها (دیسک، سرورِ حساب، سایت‌ها): ${p.alerts ? '✅ روشن' : '⛔ خاموش'}`, `📊 گزارشِ روزانه: ${p.report ? `✅ ساعتِ ${fa(p.hour)}` : '⛔ خاموش'}`, `🔐 کدهای شش‌رقمی در صندوق: ${p.codes ? '✅ روشن' : '⛔ خاموش'}`, `🛎 هشدارهای فروشگاه: ${consoleAlertPrefs().types.length ? `✅ ${fa(consoleAlertPrefs().types.length)} نوع` : '⛔ هیچ'} (انتخاب در پنل ⇒ فروشگاه ⇒ هشدارها)`, `↩️ جواب در تاپیکِ صندوق: ${p.replyOnly ? 'فقط با Reply (بقیه یادداشتِ خودتان است)' : 'هر پیام، یا با Reply'}`, '', '📥 صندوقِ جدا برای پیام‌ها و کدها: یک گروهِ تلگرام بسازید، Topics را روشن کنید، ربات را ادمین با «Manage Topics» کنید و در همان گروه ‎/link‎ بزنید.'].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [btn(p.alerts ? '🔕 خاموش کردنِ هشدارها' : '🔔 روشن کردنِ هشدارها', { k: 'pref', patch: { alerts: !p.alerts } })],
        [btn(p.report ? '🔕 خاموش کردنِ گزارشِ روزانه' : '🔔 روشن کردنِ گزارشِ روزانه', { k: 'pref', patch: { report: !p.report } })],
        [btn(p.codes ? '🔕 کدها را نفرست' : '🔔 کدها را بفرست', { k: 'pref', patch: { codes: !p.codes } })],
        [btn(p.replyOnly ? '↩️ جواب: هر پیام در تاپیک' : '↩️ جواب: فقط با Reply', { k: 'pref', patch: { replyOnly: !p.replyOnly } })],
        HOURS.map((h) => btn(`${h === p.hour ? '• ' : ''}${fa(h)}`, { k: 'pref', patch: { hour: h, report: true } })),
        [btn('⚡ جواب‌های آماده', { k: 'quickManage' })],
      ],
    },
  };
}

export async function reportText(only = null) {
  const now = Date.now();
  const lines = only ? [] : ['📊 گزارشِ کنترول سنتر', ''];
  try {
    const w = await waiting(only ? { app: only } : {});
    lines.push(w.length ? `📬 ${fa(w.length)} گفت‌وگو منتظرِ جوابِ شماست` : '📭 گفت‌وگوی بی‌جواب نیست');
  } catch { lines.push('📬 گفت‌وگوها: ⚠️ خوانده نشد'); }
  let soon = 0; let fresh = 0; let bad = false;
  for (const app of only ? [only] : ['pump', 'shop']) {
    try {
      const all = await search(app, '', 200);
      soon += all.filter((a) => ['active', 'trial'].includes(a.status) && a.endsAt && a.endsAt <= now + 7 * DAY).length;
      fresh += all.filter((a) => a.createdAt && now - a.createdAt < DAY).length;
    } catch { bad = true; }
  }
  lines.push(`⏳ ${fa(soon)} اشتراک تا ۷ روزِ دیگر تمام می‌شود${soon ? ' (‎/expiring‎)' : ''}`);
  lines.push(`🆕 ${fa(fresh)} حسابِ تازه در ۲۴ ساعتِ گذشته${bad ? ' (⚠️ سرورِ حساب کامل جواب نداد)' : ''}`);
  if (only) return lines.join('\n');
  const sites = listSitesRaw();
  const down = sites.filter((s) => !isRunning(s.slug));
  lines.push(`🌐 سایت‌ها: ${fa(sites.length - down.length)} روشن از ${fa(sites.length)}${down.length ? ` — خاموش: ${down.map((s) => s.name).join('، ')}` : ''}`);
  lines.push('', await statusText());
  return lines.join('\n').slice(0, 4000);
}

function load() { const s = getSetting(STATE, null); return s && typeof s === 'object' ? s : {}; }

/** هر دورِ کارِ support-telegram؛ خودش هر دقیقه یک بار کار می‌کند. */
export async function watch(tg, tok, chatId, log = () => {}) {
  const ms = every();
  const now = Date.now();
  if (!ms || now - lastRun < ms) return;
  lastRun = now;
  const p = prefs();
  const s = load();
  //  ⛔ خطا را بالا می‌دهد (نه بلعیدن) تا دروازه پیامِ نرفته را «رفته» ثبت نکند و دورِ بعد دوباره بفرستد
  const send = (text, extra = {}) => tg(tok, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra });

  if (p.alerts) {
    // 💽 دیسک — ≥۹۰٪ هشدار، ≥۹۵٪ بحرانی، فقط زیرِ ۸۵٪ «برگشت» (نه لرزیدن روی ۹۰)
    const disks = ((await readDisks().catch(() => null)) || {}).disks || [];
    for (const d of disks) {
      const key = `disk:${d.mount}`;
      if (d.usage >= 90) {
        owner.report({ type: 'disk', key, severity: d.usage >= 95 ? 'critical' : 'warn', title: `دیسکِ ${d.mount} پر شده: ${fa(d.usage)}٪`,
          text: `🚨 دیسکِ ${d.mount} پر شده: ${fa(d.usage)}٪ (${(d.free / 1024 ** 3).toFixed(1)}GB خالی). پشتیبان‌ها و لاگ‌ها ممکن است بایستند.` });
      } else if (d.usage < 85) {
        owner.resolve(key, { text: `🟢 دیسکِ ${d.mount} دوباره جا دارد: ${fa(d.usage)}٪` });
      }
    }
    // 🗄 سرورِ حساب — سه دورِ پشتِ هم بی‌جواب ⇒ بحرانی (یک بار؛ یادآوری فقط پس از مهلت)
    try {
      await cloudRaw('GET', '/api/admin/support/threads', { query: { limit: 1 } });
      if (s.cloudDownAt) owner.resolve('cloud', { text: `🟢 سرورِ حساب برگشت (حدودِ ${fa(Math.max(1, Math.round((now - s.cloudDownAt) / 60e3)))} دقیقه بی‌جواب بود).` });
      s.cloudFails = 0; s.cloudDownAt = 0;
    } catch (e) {
      s.cloudFails = (Number(s.cloudFails) || 0) + 1;
      if (s.cloudFails === 3) s.cloudDownAt = now;
      if (s.cloudFails >= 3) {
        owner.report({ type: 'cloud_down', key: 'cloud', severity: 'critical', title: 'سرورِ حساب جواب نمی‌دهد',
          text: `🚨 سرورِ حساب جواب نمی‌دهد — برنامه‌های پمپ و فروشگاه نمی‌توانند وارد شوند یا همگام شوند.\n${String(e.message).slice(0, 200)}` });
      }
    }
    // 🌐 سایت‌ها: فقط سایتی که روشن بود و خاموش شد (دو دورِ پشتِ هم)
    s.sites = s.sites || {};
    for (const site of listSitesRaw()) {
      const on = isRunning(site.slug);
      const st = s.sites[site.slug] || { on, off: 0, told: false };
      if (on) {
        if (st.told) owner.resolve(`site:${site.slug}`, { text: `🟢 سایتِ «${site.name}» دوباره روشن است.` });
        s.sites[site.slug] = { on: true, off: 0, told: false };
        continue;
      }
      if (!st.on && !st.off) { s.sites[site.slug] = st; continue; } // از اول خاموش بوده
      st.off = (Number(st.off) || 0) + 1;
      st.on = false;
      if (st.off >= 2) {
        st.told = true;
        owner.report({ type: 'site_down', key: `site:${site.slug}`, severity: 'warn', title: `سایتِ «${site.name}» خاموش شد`,
          text: `🚨 سایتِ «${site.name}» خاموش شد.`, extra: { reply_markup: { inline_keyboard: [[btn('▶ روشن کن', { k: 'site', id: site.id, op: 'start' })]] } } });
      }
      s.sites[site.slug] = st;
    }
  }
  setSetting(STATE, s);

  // 🛎 هشدارهای کنسولِ فروشگاه (پنلِ مرکزی ۴.۱۱) — فقط نوع‌هایی که مالک در پنل برگزیده؛ اهمیت و سقف در دروازه
  await deliverConsoleAlerts(send, log).catch((e) => log(`هشدارهای کنسول: ${e.message}`));

  // 📨 صفِ دروازه: هشدارهای همین دور، مرکز فرمان، کارهای خودکار، و خلاصهٔ صبحِ ساعتِ آرام
  const out = await owner.flush(send);
  if (out.failed) log('هشدارِ تلگرام: تلگرام نرسید — دورِ بعد دوباره');

  // 📊 گزارش + 📋 خلاصهٔ روزانه — یک پیام در روز، از ساعتِ برگزیده (به وقتِ کابل) به بعد
  await owner.maybeDigest(send, { report: p.report ? () => reportText() : null }).catch((e) => log(`خلاصهٔ روزانه: ${e.message}`));
}
