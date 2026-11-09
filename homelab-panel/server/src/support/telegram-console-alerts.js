// ---------------------------------------------------------------------------
//  🛎 هشدارهای کنسولِ فروشگاه با رباتِ تلگرامِ مالک (پنلِ مرکزی ۴.۱۱، از ۱۴۰۵/۰۸/۱۰)
//
//  دستورِ صاحب محصول (۱۴۰۵/۰۸/۱۰): کانالِ موبایلِ مالک همان رباتِ تلگرامِ موجود است؛ هشدارهای مهم
//  آن‌جا هم برسد — **فقط نوع‌هایی که خودش برگزیده** (opt-in)، بی سیل و بی راز.
//
//  ⛔ فقط از ‎watch()‎ ِ ‎telegram-watch.js‎ صدا زده می‌شود ⇒ فقط وقتی مالک در ربات وارد است و هر
//     دقیقه یک بار. چیزی را عوض نمی‌کند؛ فقط خبر می‌دهد (تأیید/بستن در پنل است).
//  ⛔ یکی شدنِ تکرار: هر هشدار با (شناسه، ‎liveSince‎) یک بار؛ همان هشدار که در سرورِ حساب «تکرار» یا
//     «چشمک» شد ‎liveSince‎ ِ تازه نمی‌گیرد ⇒ پیامِ دوم نمی‌رود. سرورِ حساب خودش هم یکی می‌کند.
//  ⛔ سقف: حداکثر ‎MAX_PER_RUN‎ پیام در هر دور؛ بیشتر ⇒ یک پیامِ «و N هشدارِ دیگر».
//  ⛔ روشن کردن از «حالا» به بعد است — هشدارهای کهنهٔ زنده یک‌جا سرازیر نمی‌شوند.
//  ⛔ پیام فقط عنوان، اهمیت و نوع؛ عنوان را خودِ سرورِ حساب از داده ساخته (نامِ دکان، شمار) و هیچ
//     کلید، توکن، ایمیل یا شماره‌ای در آن نیست.
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';
import { cloudRaw } from '../stations/cloud.js';

const PREFS = 'console_alerts_tg';
const STATE = 'console_alerts_tg_state';
export const MAX_PER_RUN = 5;
const KEEP = 500;

/** همان نام‌های قاعده در سرورِ حساب (‎lib/ops-alerts.js‎ ِ shop). */
export const CONSOLE_ALERT_RULES = Object.freeze([
  'subscription_expiring', 'shop_disconnected', 'repeated_errors', 'service_down', 'payment_failed',
  'order_stuck', 'settlement_mismatch', 'version_incompatible', 'admin_suspicious',
]);

const RULE_FA = {
  subscription_expiring: 'اشتراکِ رو به پایان', shop_disconnected: 'دکانِ قطع', repeated_errors: 'خطای تکراری',
  service_down: 'سرویسِ از کار افتاده', payment_failed: 'پرداختِ ناموفق', order_stuck: 'سفارشِ گیرکرده',
  settlement_mismatch: 'مغایرتِ تسویه', version_incompatible: 'نسخهٔ ناسازگار', admin_suspicious: 'کارِ مشکوکِ مدیر',
};
const SEVERITY_FA = { critical: '🔴 بحرانی', high: '🟠 مهم', medium: '🟡 متوسط', low: '⚪ کم' };

export function consoleAlertPrefs() {
  const p = getSetting(PREFS, null) || {};
  const types = Array.isArray(p.types) ? p.types.filter((t) => CONSOLE_ALERT_RULES.includes(t)) : [];
  return { types, enabledAt: Number(p.enabledAt) || null };
}

export function setConsoleAlertPrefs(types) {
  const clean = [...new Set(types.filter((t) => CONSOLE_ALERT_RULES.includes(t)))];
  const prev = consoleAlertPrefs();
  const enabledAt = clean.length ? (prev.enabledAt || Date.now()) : null;
  setSetting(PREFS, { types: clean, enabledAt });
  //  روشن شدن (از هیچ ⇒ چیزی): از همین لحظه، نه از هشدارهای زندهٔ کهنه
  if (clean.length && !prev.types.length) setSetting(STATE, { since: Date.now(), sent: {} });
  return consoleAlertPrefs();
}

function loadState() {
  const s = getSetting(STATE, null);
  return s && typeof s === 'object' ? { since: Number(s.since) || 0, sent: s.sent && typeof s.sent === 'object' ? s.sent : {} } : { since: 0, sent: {} };
}

export function formatAlert(a) {
  const title = String(a.title || '').replace(/\s+/g, ' ').slice(0, 300);
  return [
    `🛎 هشدارِ فروشگاه — ${RULE_FA[a.rule] || a.rule} · ${SEVERITY_FA[a.severity] || a.severity}`,
    title,
    '',
    'پنل ⇒ فروشگاه ⇒ هشدارها (تأیید یا بستن)',
  ].join('\n');
}

/**
 * یک دور: هشدارهای زندهٔ تازه از سرورِ حساب ⇒ پیام برای نوع‌های برگزیده.
 * @param {(text:string)=>Promise<unknown>} send
 * @returns {Promise<{sent:number, skipped:number, more:number}|null>}
 */
export async function deliverConsoleAlerts(send, log = () => {}) {
  const prefs = consoleAlertPrefs();
  if (!prefs.types.length) return null;
  const state = loadState();
  if (!state.since) state.since = Date.now();
  let page;
  try {
    page = await cloudRaw('GET', '/api/admin/ops/alerts', { query: { status: 'live', since: String(state.since - 1), limit: '100' } });
  } catch (err) {
    //  سرورِ حسابِ کهنه (بی ‎ops.v1‎) یا خاموش ⇒ این دور هیچ؛ «سرورِ حساب جواب نمی‌دهد» را خودِ نگهبان می‌گوید
    log(`هشدارهای کنسول: ${err.code || err.message}`);
    setSetting(STATE, state);
    return null;
  }
  const alerts = (Array.isArray(page?.alerts) ? page.alerts : [])
    .filter((a) => a && typeof a.id === 'string' && Number(a.liveSince) > 0)
    .sort((x, y) => Number(x.liveSince) - Number(y.liveSince));
  const wanted = alerts.filter((a) => prefs.types.includes(a.rule) && state.sent[a.id] !== Number(a.liveSince));
  let sent = 0;
  for (const a of wanted.slice(0, MAX_PER_RUN)) {
    try {
      await send(formatAlert(a));
      state.sent[a.id] = Number(a.liveSince);
      sent += 1;
    } catch (err) {
      log(`هشدارِ کنسول به تلگرام نرفت: ${err.message}`);
      break;
    }
  }
  const more = Math.max(0, wanted.length - MAX_PER_RUN);
  if (more > 0) {
    //  بقیه «دیده‌شده» حساب می‌شوند تا دورِ بعد دوباره سیل نشود — همان یک پیامِ جمعی بس است
    for (const a of wanted.slice(MAX_PER_RUN)) state.sent[a.id] = Number(a.liveSince);
    await send(`🛎 و ${more} هشدارِ دیگرِ فروشگاه — پنل ⇒ فروشگاه ⇒ هشدارها`).catch(() => {});
  }
  //  جلو بردنِ «از کی» فقط تا جایی که همه رسیدگی شد
  const handled = alerts.filter((a) => !prefs.types.includes(a.rule) || state.sent[a.id] === Number(a.liveSince));
  if (handled.length === alerts.length && alerts.length) state.since = Math.max(state.since, ...alerts.map((a) => Number(a.liveSince)));
  const ids = Object.keys(state.sent);
  if (ids.length > KEEP) for (const id of ids.slice(0, ids.length - KEEP)) delete state.sent[id];
  setSetting(STATE, state);
  return { sent, skipped: alerts.length - wanted.length, more };
}
