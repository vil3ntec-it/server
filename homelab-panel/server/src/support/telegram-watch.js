// ---------------------------------------------------------------------------
//  نگهبانِ رباتِ مالک — هشدارها و گزارشِ روزانه (از ۱۴۰۵/۰۷/۲۰، نسخه 1.50.53)
//
//  هشدار (هر کدام یک بار، و «برگشت» وقتی درست شد):
//      💽 دیسکِ ≥ ۹۰٪            🗄 سرورِ حساب ۳ دور پشتِ هم بی‌جواب
//      🌐 سایتی که روشن بود و خاموش شد (با دکمهٔ «▶ روشن کن»)
//  گزارشِ روزانه در ساعتِ دلخواه (پیش‌فرض ۹ صبح): گفت‌وگوهای منتظر، اشتراک‌های رو به
//  پایان، حساب‌های تازه، سلامتِ سرور. ‎/report‎ همان را همین حالا می‌دهد.
//
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

const SETTINGS = 'support_tg_prefs';
const STATE = 'support_tg_watch';
const DAY = 24 * 3600e3;
const HOURS = [7, 8, 9, 10, 12, 18, 21];
let lastRun = 0;

const every = () => { const v = process.env.HLP_TG_WATCH_MS; return v === undefined || v === '' ? 60e3 : Number(v) || 0; };

export function prefs() {
  const p = getSetting(SETTINGS, null) || {};
  return { alerts: p.alerts !== false, report: p.report !== false, hour: HOURS.includes(Number(p.hour)) ? Number(p.hour) : 9 };
}
export function setPrefs(patch) { setSetting(SETTINGS, { ...prefs(), ...patch }); return prefs(); }

export function settingsMessage() {
  const p = prefs();
  return {
    text: ['⚙️ تنظیماتِ ربات', '', `🚨 هشدارها (دیسک، سرورِ حساب، سایت‌ها): ${p.alerts ? '✅ روشن' : '⛔ خاموش'}`, `📊 گزارشِ روزانه: ${p.report ? `✅ ساعتِ ${fa(p.hour)}` : '⛔ خاموش'}`].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [btn(p.alerts ? '🔕 خاموش کردنِ هشدارها' : '🔔 روشن کردنِ هشدارها', { k: 'pref', patch: { alerts: !p.alerts } })],
        [btn(p.report ? '🔕 خاموش کردنِ گزارشِ روزانه' : '🔔 روشن کردنِ گزارشِ روزانه', { k: 'pref', patch: { report: !p.report } })],
        HOURS.map((h) => btn(`${h === p.hour ? '• ' : ''}${fa(h)}`, { k: 'pref', patch: { hour: h, report: true } })),
        [btn('⚡ جواب‌های آماده', { k: 'quickManage' })],
      ],
    },
  };
}

export async function reportText() {
  const now = Date.now();
  const lines = ['📊 گزارشِ کنترول سنتر', ''];
  try {
    const w = await waiting();
    lines.push(w.length ? `📬 ${fa(w.length)} گفت‌وگو منتظرِ جوابِ شماست` : '📭 گفت‌وگوی بی‌جواب نیست');
  } catch { lines.push('📬 گفت‌وگوها: ⚠️ خوانده نشد'); }
  let soon = 0; let fresh = 0; let bad = false;
  for (const app of ['pump', 'shop']) {
    try {
      const all = await search(app, '', 200);
      soon += all.filter((a) => ['active', 'trial'].includes(a.status) && a.endsAt && a.endsAt <= now + 7 * DAY).length;
      fresh += all.filter((a) => a.createdAt && now - a.createdAt < DAY).length;
    } catch { bad = true; }
  }
  lines.push(`⏳ ${fa(soon)} اشتراک تا ۷ روزِ دیگر تمام می‌شود${soon ? ' (‎/expiring‎)' : ''}`);
  lines.push(`🆕 ${fa(fresh)} حسابِ تازه در ۲۴ ساعتِ گذشته${bad ? ' (⚠️ سرورِ حساب کامل جواب نداد)' : ''}`);
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
  const send = (text, extra = {}) => tg(tok, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra }).catch((e) => log(`هشدارِ تلگرام: ${e.message}`));

  if (p.alerts) {
    // 💽 دیسک
    s.disk = s.disk || {};
    const disks = ((await readDisks().catch(() => null)) || {}).disks || [];
    for (const d of disks) {
      const was = s.disk[d.mount];
      if (d.usage >= 90 && !was) { s.disk[d.mount] = now; await send(`🚨 دیسکِ ${d.mount} پر شده: ${fa(d.usage)}٪ (${(d.free / 1024 ** 3).toFixed(1)}GB خالی). پشتیبان‌ها و لاگ‌ها ممکن است بایستند.`); }
      else if (d.usage < 85 && was) { delete s.disk[d.mount]; await send(`🟢 دیسکِ ${d.mount} دوباره جا دارد: ${fa(d.usage)}٪`); }
    }
    // 🗄 سرورِ حساب
    try {
      await cloudRaw('GET', '/api/admin/support/threads', { query: { limit: 1 } });
      if (s.cloudDownAt) await send(`🟢 سرورِ حساب برگشت (حدودِ ${fa(Math.max(1, Math.round((now - s.cloudDownAt) / 60e3)))} دقیقه بی‌جواب بود).`);
      s.cloudFails = 0; s.cloudDownAt = 0;
    } catch (e) {
      s.cloudFails = (Number(s.cloudFails) || 0) + 1;
      if (s.cloudFails === 3) { s.cloudDownAt = now; await send(`🚨 سرورِ حساب جواب نمی‌دهد — برنامه‌های پمپ و فروشگاه نمی‌توانند وارد شوند یا همگام شوند.\n${String(e.message).slice(0, 200)}`); }
    }
    // 🌐 سایت‌ها: فقط سایتی که روشن بود و خاموش شد (دو دورِ پشتِ هم)
    s.sites = s.sites || {};
    for (const site of listSitesRaw()) {
      const on = isRunning(site.slug);
      const st = s.sites[site.slug] || { on, off: 0, told: false };
      if (on) {
        if (st.told) await send(`🟢 سایتِ «${site.name}» دوباره روشن است.`);
        s.sites[site.slug] = { on: true, off: 0, told: false };
        continue;
      }
      if (!st.on && !st.off) { s.sites[site.slug] = st; continue; } // از اول خاموش بوده
      st.off = (Number(st.off) || 0) + 1;
      st.on = false;
      if (st.off === 2 && !st.told) {
        st.told = true;
        await send(`🚨 سایتِ «${site.name}» خاموش شد.`, { reply_markup: { inline_keyboard: [[btn('▶ روشن کن', { k: 'site', id: site.id, op: 'start' })]] } });
      }
      s.sites[site.slug] = st;
    }
  }

  // 📊 گزارشِ روزانه — یک بار در روز، از ساعتِ برگزیده به بعد
  if (p.report) {
    const d = new Date(now);
    const today = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (d.getHours() >= p.hour && s.reportDay !== today) {
      s.reportDay = today;
      setSetting(STATE, s);
      await send(await reportText());
    }
  }
  setSetting(STATE, s);
}
