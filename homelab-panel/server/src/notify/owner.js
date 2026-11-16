// ---------------------------------------------------------------------------
//  دروازهٔ پیام به مالک — «سیلِ پیام» بسته شد، هیچ چیزی گم نشد (۱.۵۳.۰)
//
//  خواستهٔ صاحب سامانه: «تو یک روز ۲۰۰ تا پیام میده برای هر چی، یا حافظه یا نمی‌دونم این یا اون.
//  نمی‌خوام انقدر پیامِ بی‌خود برای من بیاد مثلِ سیل، اینو درست کن.»
//
//  ⛔ **هر هشدار و خبری که به تلگرامِ مالک می‌رود از همین‌جا می‌گذرد** (نگهبانِ ربات، هشدارهای مرکز فرمان،
//     کارهای خودکار، هشدارهای فروشگاه، «سرور دوباره روشن شد»). پیامِ کاربران و کدها هشدار نیستند و
//     این‌جا فقط **شمرده** می‌شوند (`count`).
//
//  قاعده‌ها — همان کاری که ابزارهای پایشِ حرفه‌ای (Grafana، UptimeRobot، PagerDuty) می‌کنند:
//   ۱) **فقط تغییرِ حال**: «خوب ⇐ مشکل» یک پیام، «مشکل ⇐ خوب» یک «✅ برطرف شد» — نه هر دور که هنوز بد است.
//      یادآوری فقط وقتی مهلتِ تکرار (`cooldownH`، بحرانی `criticalCooldownH`) گذشت و هنوز برقرار است.
//      «برطرف شد» فقط اگر خودِ مشکل واقعاً به مالک رسیده بود.
//   ۲) **تکرار و رفت‌وبرگشت**: همان کلید که زودتر از مهلت دوباره باز شد ⇒ «تکراری» (فقط پنل و خلاصه).
//   ۳) **سقفِ روزانه** (`dailyCap`، پیش‌فرض ۲۰): بعدش هشدارِ معمولی نمی‌رود؛ یک پیامِ «🔕 سقف پر شد» و
//      در خلاصهٔ شب «و n هشدارِ دیگر». ⛔ بحرانی همیشه می‌رود.
//   ۴) **اهمیت**: بحرانی (سرور یا سرورِ حساب خاموش، دیسکِ تقریباً پر، پشتیبانِ ناموفق، امنیت) ⇒ همان دم؛
//      هشدار ⇒ یک بار و بعد مهلت؛ خبر (پشتیبانِ موفق، آپدیت، کارهای روزمره) ⇒ **فقط در خلاصهٔ روزانه**.
//   ۵) **ساعتِ آرام** (پیش‌فرض ۲۳ تا ۷ به وقتِ کابل): فقط بحرانی؛ بقیه صبح در **یک** پیام.
//   ۶) هر نوع روشن/خاموش (خاموش = فقط پنل) و اهمیتِ دلخواه — جز «امنیت» که ⛔ همیشه روشن و بحرانی است.
//   ۷) **هیچ چیزی گم نمی‌شود**: هر رخداد با تصمیمش (`decision`) در `owner_alerts` می‌ماند ⇒ صفحهٔ «اعلان‌ها».
//   ۸) در هر دور حداکثر `MAX_PER_FLUSH` پیامِ جدا؛ بقیه یک پیامِ جمعیِ «و n هشدارِ دیگر».
//
//  ⛔ این ماژول خودش به تلگرام وصل نیست: صف می‌سازد و `flush(send)` ِ نگهبانِ ربات می‌فرستد.
//  ⛔ هرگز استثنا به سازنده‌ها پس نمی‌دهد — هشدار نباید کارِ اصلی را بخواباند.
// ---------------------------------------------------------------------------
import { q, getSetting, setSetting, logEvent } from '../db.js';
import { alertEvents } from '../control/alerts.js';

export const SEVERITIES = Object.freeze(['critical', 'warn', 'info']);
const RANK = { info: 0, warn: 1, critical: 2 };

/**
 * نوع‌های هشدار. `defaultSeverity` یعنی «اهمیتِ پیش‌فرضِ این نوع، هر چه سازنده گفت» (کاربر عوضش می‌کند)؛
 * بی آن اهمیت همان است که سازنده گفت (دیسکِ ۹۰٪ هشدار، ۹۵٪ بحرانی).
 */
export const TYPES = Object.freeze({
  server_down: { label: 'سرورِ خاموش یا بی‌گزارش', hint: 'سرورِ ثبت‌شده یا سرورِ دیگرِ «سرورهای من» جواب نمی‌دهد' },
  cloud_down: { label: 'سرورِ حساب جواب نمی‌دهد', hint: 'برنامه‌های پمپ و فروشگاه نمی‌توانند وارد یا همگام شوند' },
  service_down: { label: 'سرویسی که بالا نماند', hint: 'سایت یا برنامه‌ای که با ری‌استارت هم بالا نیامد' },
  site_down: { label: 'سایتِ خاموش‌شده', hint: 'سایتی که روشن بود و خاموش شد' },
  monitor_down: { label: 'هدفِ پایش', hint: 'نشانی، دامنه، تونل یا دیتابیسی که جواب نمی‌دهد' },
  disk: { label: 'دیسک', hint: 'از ۹۰٪ هشدار، از ۹۵٪ بحرانی؛ زیرِ ۸۵٪ «برطرف شد»' },
  memory: { label: 'حافظه', hint: 'بالای ۹۰٪ و ۱۰ دقیقه پیوسته؛ زیرِ ۸۰٪ «برطرف شد»' },
  cpu: { label: 'پردازنده', hint: 'بالای ۹۲٪ و ۱۵ دقیقه پیوسته؛ زیرِ ۸۰٪ «برطرف شد»' },
  temp: { label: 'دمای پردازنده', hint: 'بالای آستانهٔ مکثِ دستیار' },
  backup: { label: 'پشتیبان', hint: 'ناموفق ⇒ بحرانی؛ موفق ⇒ فقط در خلاصه' },
  security: { label: 'امنیت', hint: 'ورودِ مشکوک و مانندِ آن — همیشه روشن و بحرانی', locked: true },
  expiring: { label: 'گواهی و دامنه', hint: 'گواهی یا ثبتِ دامنهٔ رو به پایان' },
  code_mail: { label: 'کدی که با ایمیل نرفت', hint: 'کدِ شش‌رقمی که با چند تلاش هم نرفت — خودتان بفرستید' },
  restart: { label: 'روشن شدنِ دوبارهٔ سرور', hint: '«سرور دوباره روشن شد» و مدتِ خاموشی' },
  shop: { label: 'هشدارهای فروشگاه', hint: 'بحرانی ⇒ همان دم، مهم ⇒ هشدار، بقیه ⇒ خلاصه (نوع‌ها: فروشگاه ⇒ هشدارها)' },
  automation: { label: 'کارهای خودکار', hint: 'رباتِ پمپ/فروشگاه/ورود و کارهای روزمره', defaultSeverity: 'info' },
  update: { label: 'به‌روزرسانی', hint: 'نسخهٔ تازه، نصبِ خودکار، به‌روزرسانیِ امنیتیِ سیستم', defaultSeverity: 'info' },
  selfheal: { label: 'خودترمیمی', hint: 'وابستگی‌هایی که پنل خودش درست کرد', defaultSeverity: 'info' },
  other: { label: 'دیگر', hint: 'هر هشدارِ دیگرِ مرکز فرمان' },
});

/** شمرده می‌شوند، ولی دروازه‌ای ندارند (پیامِ آدم‌ها و کدها، و پیام‌های جمعیِ خودِ دروازه). */
export const COUNT_ONLY = Object.freeze({ inbox: 'پیامِ کاربران', codes: 'کدهای شش‌رقمی', summary: 'پیامِ جمعی', digest: 'خلاصهٔ روزانه' });
/** این‌ها در سقفِ روزانهٔ هشدارها شمرده نمی‌شوند. */
const NOT_CAPPED = ['inbox', 'codes', 'digest'];

export const DEFAULTS = Object.freeze({
  cooldownH: 6,
  criticalCooldownH: 2,
  dailyCap: 20,
  digestHour: 21,
  quiet: true,
  quietFrom: 23,
  quietTo: 7,
  tz: 'Asia/Kabul',
  codesSilent: true,
  types: {},
});
const LIMITS = { cooldownH: [1, 72], criticalCooldownH: [1, 24], dailyCap: [5, 200], digestHour: [0, 23], quietFrom: [0, 23], quietTo: [0, 23] };
export const MAX_PER_FLUSH = 5;
/** پیامی که این‌قدر در صف ماند (تلگرام قطع، مالک بیرون از ربات) دیگر جدا نمی‌رود — در خلاصه می‌آید. */
const STALE_MS = 2 * 3600e3;
const KEEP_MS = 30 * 24 * 3600e3;
const SETTINGS_KEY = 'owner_alerts';
const STATE_KEY = 'owner_alerts_state';

const fa = (n) => Number(n).toLocaleString('fa-IR');
const clip = (s, n) => String(s ?? '').replace(/\s+$/g, '').slice(0, n);
const safe = (fn, fallback = null) => { try { return fn(); } catch (e) { try { logEvent('warn', 'owner-alerts', e.message); } catch { /* */ } return fallback; } };

/* ------------------------------- تنظیمات -------------------------------- */

function validTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); return true; } catch { return false; }
}

function cleanTypes(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [t, v] of Object.entries(raw)) {
    if (!TYPES[t] || !v || typeof v !== 'object') continue;
    //  ⛔ امنیت خاموش یا کم‌اهمیت نمی‌شود — نه از پنل، نه از دیتابیسِ دست‌کاری‌شده
    if (TYPES[t].locked) continue;
    const o = {};
    if (v.on === false) o.on = false;
    if (SEVERITIES.includes(v.severity)) o.severity = v.severity;
    if (Object.keys(o).length) out[t] = o;
  }
  return out;
}

function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = { ...DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    const n = Number(r[k]);
    if (r[k] !== undefined && r[k] !== null && r[k] !== '' && Number.isInteger(n) && n >= lo && n <= hi) s[k] = n;
  }
  if (typeof r.quiet === 'boolean') s.quiet = r.quiet;
  if (typeof r.codesSilent === 'boolean') s.codesSilent = r.codesSilent;
  if (typeof r.tz === 'string' && validTz(r.tz)) s.tz = r.tz;
  s.types = cleanTypes(r.types);
  return s;
}

export function settings() {
  return clean(safe(() => getSetting(SETTINGS_KEY, null), null));
}

/**
 * نوشتنِ تنظیمات. مقدارِ نادرست ⇒ خطای ۴۰۰ با نامِ فیلد (نه بی‌صدا نادیده گرفتن).
 * `types` یکجا جایگزین نمی‌شود: هر نوعی که آمد همان عوض می‌شود.
 */
export function setSettings(patch = {}) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const cur = settings();
  const next = { ...cur, types: { ...cur.types } };
  const bad = (field) => Object.assign(new Error(`مقدارِ «${field}» درست نیست`), { status: 400, field });
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (p[k] === undefined) continue;
    const n = Number(p[k]);
    if (!Number.isInteger(n) || n < lo || n > hi) throw bad(k);
    next[k] = n;
  }
  for (const k of ['quiet', 'codesSilent']) {
    if (p[k] === undefined) continue;
    if (typeof p[k] !== 'boolean') throw bad(k);
    next[k] = p[k];
  }
  if (p.tz !== undefined) {
    if (typeof p.tz !== 'string' || !validTz(p.tz)) throw bad('tz');
    next.tz = p.tz;
  }
  if (p.types !== undefined) {
    if (!p.types || typeof p.types !== 'object') throw bad('types');
    for (const [t, v] of Object.entries(p.types)) {
      if (!TYPES[t]) throw bad(`types.${t}`);
      if (TYPES[t].locked) {
        //  ⛔ هشدارِ امنیتی بی‌صدا خاموش نمی‌شود: درخواستِ خاموش کردن یا پایین آوردنش رد می‌شود، نه نادیده
        if (v?.on === false || (v?.severity && v.severity !== 'critical')) throw Object.assign(new Error('هشدارهای امنیتی همیشه روشن و بحرانی می‌مانند'), { status: 400, field: `types.${t}` });
        continue;
      }
      if (!v || typeof v !== 'object') throw bad(`types.${t}`);
      const o = { ...(next.types[t] || {}) };
      if (v.on !== undefined) { if (typeof v.on !== 'boolean') throw bad(`types.${t}.on`); if (v.on) delete o.on; else o.on = false; }
      if (v.severity !== undefined) {
        if (v.severity === null || v.severity === '' || v.severity === 'auto') delete o.severity;
        else if (SEVERITIES.includes(v.severity)) o.severity = v.severity;
        else throw bad(`types.${t}.severity`);
      }
      if (Object.keys(o).length) next.types[t] = o; else delete next.types[t];
    }
  }
  setSetting(SETTINGS_KEY, next);
  return settings();
}

/* -------------------------------- زمان ---------------------------------- */

const formatters = new Map();
function fmt(tz, locale, opts) {
  const key = `${tz}|${locale}|${JSON.stringify(opts)}`;
  let f = formatters.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }); formatters.set(key, f); }
  return f;
}

/** روز و ساعت به وقتِ منطقهٔ تنظیم‌شده (کابل). */
export function clock(ms, tz = DEFAULTS.tz) {
  const parts = Object.fromEntries(fmt(tz, 'en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour, minute, second, startOfDay: ms - (((hour * 60 + minute) * 60 + second) * 1000) - (ms % 1000) };
}
const hhmm = (ms, tz) => fmt(tz, 'fa-IR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));

export function inQuiet(ms, s = settings()) {
  if (!s.quiet || s.quietFrom === s.quietTo) return false;
  const h = clock(ms, s.tz).hour;
  return s.quietFrom < s.quietTo ? h >= s.quietFrom && h < s.quietTo : h >= s.quietFrom || h < s.quietTo;
}

/* ------------------------------ شمارنده‌ها ------------------------------ */

function bump(day, type, n = 1) {
  q('INSERT INTO owner_alert_counts(day, type, n) VALUES(?, ?, ?) ON CONFLICT(day, type) DO UPDATE SET n = n + excluded.n').run(day, type, n);
}

/** یک پیامِ واقعاً فرستاده‌شده که از دروازه نگذشت (پیامِ کاربر، کد). */
export function count(type, { now = Date.now() } = {}) {
  safe(() => bump(clock(now, settings().tz).day, String(type).slice(0, 40)));
}

function sentAlertsToday(day) {
  const marks = NOT_CAPPED.map(() => '?').join(',');
  return Number(q(`SELECT COALESCE(SUM(n), 0) AS n FROM owner_alert_counts WHERE day = ? AND type NOT IN (${marks})`).get(day, ...NOT_CAPPED).n) || 0;
}

function capReached(now, s) {
  const pending = Number(q("SELECT COUNT(*) AS n FROM owner_alerts WHERE decision = 'pending'").get().n) || 0;
  return sentAlertsToday(clock(now, s.tz).day) + pending >= s.dailyCap;
}

/* --------------------------------- منطق --------------------------------- */

export function effectiveSeverity(type, severity, s = settings()) {
  const t = TYPES[type] ? type : 'other';
  if (TYPES[t].locked) return 'critical';
  const o = s.types[t]?.severity;
  if (SEVERITIES.includes(o)) return o;
  if (TYPES[t].defaultSeverity) return TYPES[t].defaultSeverity;
  return SEVERITIES.includes(severity) ? severity : 'warn';
}
export const typeOn = (type, s = settings()) => Boolean(TYPES[type]?.locked) || s.types[type]?.on !== false;
const cooldownMs = (sev, s) => (sev === 'critical' ? s.criticalCooldownH : s.cooldownH) * 3600e3;

/**
 * تصمیمِ یک پیام — **خالص**، تا آزمون بی تلگرام بسنجدش.
 * ⇒ pending (برود) · digest (فقط خلاصه) · suppressed (تکراری) · held (ساعتِ آرام) · capped (سقف) · panel (نوعِ خاموش)
 */
export function decide({ type, severity, phase, now, s, lastSentAt = null, capped = null }) {
  if (!typeOn(type, s)) return 'panel';
  if (phase !== 'recovery' && severity === 'info') return 'digest';
  if ((phase === 'problem' || phase === 'event') && lastSentAt && now - lastSentAt < cooldownMs(severity, s)) return 'suppressed';
  if (severity !== 'critical' && inQuiet(now, s)) return 'held';
  //  «برطرف شد» ِ مشکلی که رفته بود سقف نمی‌شناسد (یکی در برابرِ یکی)؛ بحرانی هرگز
  if (severity !== 'critical' && phase !== 'recovery' && (capped ?? capReached(now, s))) return 'capped';
  return 'pending';
}

const ICON = { critical: '🚨', warn: '⚠️', info: 'ℹ️' };
const getState = (key) => q('SELECT * FROM owner_alert_state WHERE key = ?').get(key);

function record({ at, type, key, severity, phase, title, body, extra, decision, dueAt = null }) {
  const info = q('INSERT INTO owner_alerts(at, type, key, severity, phase, title, body, extra, decision, due_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(at, type, key, severity, phase, clip(title, 200) || '—', body ? clip(body, 3500) : null, extra ? JSON.stringify(extra).slice(0, 4000) : null, decision, dueAt);
  return Number(info.lastInsertRowid);
}

function capNotice(now, s) {
  const st = getSetting(STATE_KEY, {}) || {};
  const day = clock(now, s.tz).day;
  if (st.capNoticeDay === day) return;
  setSetting(STATE_KEY, { ...st, capNoticeDay: day });
  record({ at: now, type: 'summary', key: 'cap-notice', severity: 'warn', phase: 'notice', title: 'سقفِ روزانه پر شد',
    body: `🔕 امروز ${fa(s.dailyCap)} هشدار فرستاده شد (سقفِ روزانه). بقیهٔ هشدارهای معمولی تا فردا فقط در پنل ⇒ اعلان‌ها و خلاصهٔ شب می‌آیند. بحرانی‌ها همچنان می‌رسند.`,
    decision: 'pending' });
}

/**
 * گزارشِ یک مشکل (یا رخدادِ یک‌باره با `event: true`).
 * سازندهٔ دوره‌ای (هر دقیقه) می‌تواند تا وقتی مشکل هست هر دور همین را صدا بزند: پیامِ تازه فقط برای
 * مشکلِ تازه، بالا رفتنِ اهمیت، یا یادآوری پس از مهلت.
 * @returns {{ id?: number, decision: string, severity: string }}
 */
export function report({ type = 'other', key, severity = 'warn', title, text = null, extra = null, event = false, sustainMs = 0, now = Date.now() } = {}) {
  return safe(() => {
    const s = settings();
    const t = TYPES[type] ? type : 'other';
    const k = clip(key || `${t}:${title}`, 200);
    const sev = effectiveSeverity(t, severity, s);
    const ttl = clip(String(title || '').replace(/\s+/g, ' '), 200) || TYPES[t].label;
    const body = text ? String(text) : `${ICON[sev]} ${ttl}`;
    const st = getState(k);

    if (!event && st?.active) {
      //  ⛔ اهمیت تا پایانِ همین دوره پایین نمی‌آید: دیسکی که میانِ ۹۴ و ۹۶ می‌لرزد فقط یک بار «بحرانی» می‌شود
      const escalated = RANK[sev] > RANK[st.severity];
      const keep = escalated ? sev : st.severity;
      q('UPDATE owner_alert_state SET last_seen_at = ?, severity = ?, title = ? WHERE key = ?').run(now, keep, ttl, k);
      if (escalated) {
        const decision = decide({ type: t, severity: sev, phase: 'problem', now, s });
        const id = record({ at: now, type: t, key: k, severity: sev, phase: 'problem', title: ttl, body, extra, decision });
        if (decision === 'capped') capNotice(now, s);
        return { id, decision, severity: sev };
      }
      const wait = cooldownMs(keep, s);
      //  دوره‌ای که «تکراری» یا «سقف» خورد و هنوز برقرار است: پس از مهلت یک بار خودِ مشکل می‌رود (نه هر دقیقه یک ردیف)
      if (!st.notified && keep !== 'info' && typeOn(t, s) && now - (st.last_sent_at || st.since || now) >= wait && !inQuiet(now, s) && (keep === 'critical' || !capReached(now, s))) {
        const last = q("SELECT decision FROM owner_alerts WHERE key = ? AND phase = 'problem' ORDER BY id DESC LIMIT 1").get(k);
        if (last && (last.decision === 'suppressed' || last.decision === 'capped')) {
          const id = record({ at: now, type: t, key: k, severity: keep, phase: 'problem', title: ttl, body, extra, decision: 'pending' });
          return { id, decision: 'pending', severity: keep };
        }
      }
      if (st.notified && wait > 0 && st.last_sent_at && now - st.last_sent_at >= wait && keep !== 'info') {
        const since = hhmm(st.since || now, s.tz);
        const decision = decide({ type: t, severity: keep, phase: 'reminder', now, s });
        const id = record({ at: now, type: t, key: k, severity: keep, phase: 'reminder', title: ttl, body: `⏰ هنوز برقرار است (از ساعتِ ${since}):\n${body}`, extra, decision });
        //  یادآوریِ نرفته (ساعتِ آرام، سقف) یعنی «تا مهلتِ بعد دوباره نپرس»
        if (decision !== 'pending') q('UPDATE owner_alert_state SET last_sent_at = ? WHERE key = ?').run(now, k);
        return { id, decision, severity: keep };
      }
      return { decision: 'ongoing', severity: keep };
    }

    let decision = decide({ type: t, severity: sev, phase: event ? 'event' : 'problem', now, s, lastSentAt: st?.last_sent_at || null });
    //  «پیوسته N دقیقه»: تصمیمِ واقعی وقتی گرفته می‌شود که مهلت گذشت و هنوز برقرار بود (`flush`)؛ زودتر درست شد ⇒ هیچ پیامی
    const wait = !event && sustainMs > 0 && decision !== 'panel' && decision !== 'digest';
    if (wait) decision = 'waiting';
    const id = record({ at: now, type: t, key: k, severity: sev, phase: event ? 'event' : 'problem', title: ttl, body, extra, decision, dueAt: wait ? now + sustainMs : null });
    q(`INSERT INTO owner_alert_state(key, type, severity, title, active, since, notified, last_seen_at, episodes)
       VALUES(?, ?, ?, ?, ?, ?, 0, ?, 1)
       ON CONFLICT(key) DO UPDATE SET type = excluded.type, severity = excluded.severity, title = excluded.title,
         active = excluded.active, since = excluded.since, notified = 0, last_seen_at = excluded.last_seen_at, episodes = episodes + 1`)
      .run(k, t, sev, ttl, event ? 0 : 1, now, now);
    if (decision === 'capped') capNotice(now, s);
    return { id, decision, severity: sev };
  }, { decision: 'error', severity: severity });
}

/** ردیف‌هایی که «پیوسته N دقیقه» می‌خواستند و مهلتشان رسید ⇒ تصمیمِ واقعی، فقط اگر هنوز برقرارند. */
function promoteWaiting(now, s) {
  for (const r of q("SELECT * FROM owner_alerts WHERE decision = 'waiting' AND due_at <= ? ORDER BY id").all(now)) {
    const st = getState(r.key);
    const still = st?.active && (st.since || 0) <= r.at;
    let decision = 'dropped';
    if (still) {
      const prev = q("SELECT MAX(sent_at) AS t FROM owner_alerts WHERE key = ? AND id < ? AND decision IN ('sent', 'summarized')").get(r.key, r.id);
      decision = decide({ type: r.type, severity: st.severity, phase: 'problem', now, s, lastSentAt: prev?.t || null });
      if (decision === 'waiting') decision = 'pending';
    }
    q('UPDATE owner_alerts SET decision = ?, severity = ? WHERE id = ?').run(decision, still ? st.severity : r.severity, r.id);
    if (decision === 'capped') capNotice(now, s);
  }
}

/**
 * مشکل برطرف شد. «✅ برطرف شد» فقط یک بار، و فقط اگر خودِ مشکل به مالک رسیده بود.
 * مشکلی که هنوز در صف بود (پیش از رفتن درست شد) اصلاً نمی‌رود.
 */
export function resolve(key, { text = null, now = Date.now() } = {}) {
  return safe(() => {
    const k = clip(key, 200);
    const st = getState(k);
    if (!st || !st.active) return { decision: 'none' };
    const s = settings();
    const dropped = Number(q("UPDATE owner_alerts SET decision = 'dropped' WHERE key = ? AND decision IN ('pending', 'waiting') AND phase IN ('problem', 'reminder')").run(k).changes) || 0;
    const told = st.notified && !dropped;
    const decision = told ? decide({ type: st.type, severity: st.severity, phase: 'recovery', now, s }) : 'panel';
    const mins = Math.max(1, Math.round((now - (st.since || now)) / 60e3));
    const body = text ? String(text) : `✅ برطرف شد: ${st.title} (حدودِ ${mins < 60 ? `${fa(mins)} دقیقه` : `${fa(Math.round(mins / 60))} ساعت`})`;
    const id = record({ at: now, type: st.type, key: k, severity: st.severity, phase: 'recovery', title: st.title, body, decision });
    q('UPDATE owner_alert_state SET active = 0, notified = 0, last_seen_at = ? WHERE key = ?').run(now, k);
    return { id, decision };
  }, { decision: 'error' });
}

/* -------------------------------- ارسال -------------------------------- */

function markSent(r, now, s) {
  q("UPDATE owner_alerts SET decision = 'sent', sent_at = ?, attempts = attempts + 1 WHERE id = ?").run(now, r.id);
  if (r.phase === 'problem' || r.phase === 'reminder' || r.phase === 'event') {
    q('UPDATE owner_alert_state SET notified = 1, last_sent_at = ? WHERE key = ?').run(now, r.key);
  }
  bump(clock(now, s.tz).day, TYPES[r.type] || COUNT_ONLY[r.type] ? r.type : 'other');
}

/** هشدارهای ساعتِ آرام ⇒ **یک** پیام، همین که ساعتِ آرام تمام شد. */
async function sendHeld(send, now, s) {
  const rows = q("SELECT * FROM owner_alerts WHERE decision = 'held' ORDER BY id LIMIT 300").all();
  if (!rows.length) return 0;
  const lines = rows.slice(0, 12).map((r) => {
    if (r.phase === 'recovery') return `• ✅ برطرف شد: ${r.title}`;
    const st = getState(r.key);
    const open = st?.active && (st.since || 0) <= r.at;
    return `• ${ICON[r.severity] || '•'} ${r.title} — ${hhmm(r.at, s.tz)}${open ? '' : ' (برطرف شد ✅)'}`;
  });
  if (rows.length > 12) lines.push(`و ${fa(rows.length - 12)} موردِ دیگر — پنل ⇒ اعلان‌ها`);
  const text = [`🌙 در ساعتِ آرام (${fa(s.quietFrom)} تا ${fa(s.quietTo)}) ${fa(rows.length)} هشدار آمد:`, ...lines].join('\n').slice(0, 4000);
  await send(text, { disable_notification: true });
  const ids = rows.map((r) => r.id);
  q(`UPDATE owner_alerts SET decision = 'summarized', sent_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(now, ...ids);
  for (const r of rows) {
    if (r.phase !== 'recovery') q('UPDATE owner_alert_state SET notified = 1, last_sent_at = ? WHERE key = ? AND active = 1').run(now, r.key);
  }
  bump(clock(now, s.tz).day, 'summary');
  return rows.length;
}

/**
 * صفِ پیام‌ها را می‌فرستد. `send(text, extra)` باید خطای تلگرام را **بالا بدهد** تا پیامِ نرفته «رفته» ثبت نشود.
 * @returns {Promise<{sent:number, more:number, held:number, failed:boolean}>}
 */
export async function flush(send, { now = Date.now(), max = MAX_PER_FLUSH } = {}) {
  const s = settings();
  const out = { sent: 0, more: 0, held: 0, failed: false };
  try {
    promoteWaiting(now, s);
    q("UPDATE owner_alerts SET decision = 'expired' WHERE decision = 'pending' AND COALESCE(due_at, at) < ?").run(now - STALE_MS);
    if (!inQuiet(now, s)) out.held = await sendHeld(send, now, s);
    //  بحرانی‌ها اول؛ هم‌اهمیت‌ها به ترتیبِ آمدن
    const rows = q("SELECT * FROM owner_alerts WHERE decision = 'pending' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, id LIMIT 200").all();
    for (const r of rows.slice(0, max)) {
      try {
        await send(r.body || r.title, { ...(r.extra ? JSON.parse(r.extra) : {}), ...(r.severity === 'info' || r.phase === 'recovery' ? { disable_notification: true } : {}) });
      } catch (e) {
        //  همین یکی سه بار نرفت (مثلاً تلگرام متنش را نمی‌پذیرد) ⇒ کنار، تا صف را برای همیشه نبندد
        q("UPDATE owner_alerts SET attempts = attempts + 1, decision = CASE WHEN attempts + 1 >= 3 THEN 'failed' ELSE decision END WHERE id = ?").run(r.id);
        throw e;
      }
      markSent(r, now, s);
      out.sent += 1;
    }
    const rest = rows.slice(max);
    if (rest.length) {
      const sample = rest.slice(0, 5).map((r) => `• ${r.title}`);
      await send([`و ${fa(rest.length)} هشدارِ دیگر — پنل ⇒ اعلان‌ها`, ...sample].join('\n').slice(0, 4000), {});
      const ids = rest.map((r) => r.id);
      q(`UPDATE owner_alerts SET decision = 'summarized', sent_at = ? WHERE id IN (${ids.map(() => '?').join(',')})`).run(now, ...ids);
      for (const r of rest) if (r.phase !== 'recovery') q('UPDATE owner_alert_state SET notified = 1, last_sent_at = ? WHERE key = ?').run(now, r.key);
      bump(clock(now, s.tz).day, 'summary');
      out.more = rest.length;
    }
  } catch (e) {
    //  تلگرام نرسید ⇒ همان‌ها در صف می‌مانند (دورِ بعد، به ترتیب)
    out.failed = true;
    try { logEvent('warn', 'owner-alerts', `پیام به مالک نرفت: ${e.message}`); } catch { /* */ }
  }
  return out;
}

/** یک پیامِ صف را همین حالا با کانالِ خودِ سازنده می‌فرستد (چراغِ ربات که بی نشستِ ورود هم کار می‌کند). */
export async function deliver(id, send, { now = Date.now() } = {}) {
  const r = id ? q("SELECT * FROM owner_alerts WHERE id = ? AND decision = 'pending'").get(Number(id)) : null;
  if (!r) return false;
  await send(r.body || r.title, r.extra ? JSON.parse(r.extra) : {});
  markSent(r, now, settings());
  return true;
}

/* -------------------------------- خلاصه -------------------------------- */

const DECISION_FA = { suppressed: 'تکراری', digest: 'فقط خلاصه', capped: 'سقف', held: 'ساعتِ آرام', panel: 'فقط پنل', expired: 'دیر', dropped: 'پیش از رفتن درست شد' };

export function digestText({ now = Date.now(), since = now - 24 * 3600e3 } = {}) {
  const s = settings();
  const rows = q("SELECT * FROM owner_alerts WHERE at >= ? AND at <= ? AND type NOT IN ('summary', 'digest') ORDER BY id").all(since, now);
  const day = clock(now, s.tz).day;
  const counts = Object.fromEntries(q('SELECT type, n FROM owner_alert_counts WHERE day = ?').all(day).map((r) => [r.type, r.n]));
  const sentToday = Object.values(counts).reduce((a, n) => a + n, 0);
  const people = (counts.inbox || 0) + (counts.codes || 0);
  const notSent = rows.filter((r) => DECISION_FA[r.decision] && r.phase !== 'recovery');
  const byDecision = {};
  for (const r of notSent) byDecision[r.decision] = (byDecision[r.decision] || 0) + 1;
  const L = ['📋 خلاصهٔ امروزِ اعلان‌ها'];
  L.push(`📨 امروز ${fa(sentToday)} پیام فرستاده شد${people ? ` (${fa(sentToday - people)} هشدار، ${fa(counts.inbox || 0)} پیامِ کاربر، ${fa(counts.codes || 0)} کد)` : ''}`);
  if (notSent.length) L.push(`🔕 ${fa(notSent.length)} تا را نفرستادم: ${Object.entries(byDecision).map(([d, n]) => `${DECISION_FA[d]} ${fa(n)}`).join(' · ')}`);
  const active = q("SELECT * FROM owner_alert_state WHERE active = 1 AND severity != 'info' ORDER BY since").all();
  if (active.length) {
    L.push('', '🔴 هنوز برقرار:');
    for (const a of active.slice(0, 8)) L.push(`• ${a.title} — از ${hhmm(a.since || now, s.tz)}`);
    if (active.length > 8) L.push(`و ${fa(active.length - 8)} موردِ دیگر`);
  }
  const news = rows.filter((r) => r.decision === 'digest');
  if (news.length) {
    const groups = new Map();
    for (const r of news) { const g = groups.get(r.type) || []; g.push(r); groups.set(r.type, g); }
    L.push('', 'ℹ️ خبرها:');
    for (const [t, g] of groups) L.push(`• ${TYPES[t]?.label || t}${g.length > 1 ? ` ×${fa(g.length)}` : ''} — ${g.at(-1).title}`);
  }
  const capped = byDecision.capped || 0;
  if (capped) L.push('', `🔕 و ${fa(capped)} هشدارِ دیگر به خاطرِ سقفِ روزانه فقط در پنل ماند.`);
  const noisy = [...rows.filter((r) => r.phase !== 'recovery').reduce((m, r) => m.set(r.type, (m.get(r.type) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).filter(([, n]) => n >= 3).slice(0, 3);
  if (noisy.length) L.push('', `📈 پرسروصداترین: ${noisy.map(([t, n]) => `${TYPES[t]?.label || t} ${fa(n)}`).join(' · ')}`);
  if (!rows.length && !active.length) L.push('✅ امروز هشدارِ تازه‌ای نبود؛ همه‌چیز آرام بود.');
  L.push('', 'همه در پنل ⇒ اعلان‌ها');
  return { text: L.join('\n'), quiet: !rows.length && !active.length };
}

/**
 * خلاصهٔ روزانه — یک بار در روز، از ساعتِ `digestHour` (به وقتِ کابل) به بعد. همان پیامِ «📊 گزارشِ روزانه» ِ
 * ربات هم بالای همین می‌نشیند (`report`)، پس روزی **یک** پیام، نه دو تا.
 * @param {(text:string, extra?:object)=>Promise<unknown>} send
 * @param {{ now?: number, report?: (()=>Promise<string>)|null }} opts
 */
export async function maybeDigest(send, { now = Date.now(), report = null } = {}) {
  const s = settings();
  const c = clock(now, s.tz);
  const st = getSetting(STATE_KEY, {}) || {};
  if (c.hour < s.digestHour || st.digestDay === c.day) return null;
  const since = Number(st.lastDigestAt) || now - 24 * 3600e3;
  const d = digestText({ now, since });
  //  گزارش خاموش و روزِ آرام ⇒ هیچ پیامی؛ «همه‌چیز خوب است» به‌تنهایی ارزشِ یک زنگ ندارد
  const head = report ? await report().catch(() => null) : null;
  setSetting(STATE_KEY, { ...st, digestDay: c.day });
  if (!head && d.quiet) { setSetting(STATE_KEY, { ...st, digestDay: c.day, lastDigestAt: now }); return { sent: false, quiet: true }; }
  const text = [head, d.text].filter(Boolean).join('\n\n').slice(0, 4000);
  try {
    await send(text, { disable_notification: true });
  } catch (e) {
    setSetting(STATE_KEY, st); // دورِ بعد دوباره
    throw e;
  }
  setSetting(STATE_KEY, { ...st, digestDay: c.day, lastDigestAt: now });
  bump(c.day, 'digest');
  record({ at: now, type: 'digest', key: `digest:${c.day}`, severity: 'info', phase: 'digest', title: 'خلاصهٔ روزانه', body: text, decision: 'sent' });
  prune(now);
  return { sent: true, text };
}

export function prune(now = Date.now()) {
  safe(() => {
    q('DELETE FROM owner_alerts WHERE at < ?').run(now - KEEP_MS);
    q("DELETE FROM owner_alert_state WHERE active = 0 AND COALESCE(last_seen_at, 0) < ?").run(now - KEEP_MS);
    const cutoff = clock(now - KEEP_MS, settings().tz).day;
    q('DELETE FROM owner_alert_counts WHERE day < ?').run(cutoff);
  });
}

/* ------------------------------ برای پنل ------------------------------- */

export function history({ limit = 100, type = null } = {}) {
  const n = Math.min(500, Math.max(1, Number(limit) || 100));
  const rows = type && (TYPES[type] || COUNT_ONLY[type])
    ? q('SELECT * FROM owner_alerts WHERE type = ? ORDER BY id DESC LIMIT ?').all(type, n)
    : q('SELECT * FROM owner_alerts ORDER BY id DESC LIMIT ?').all(n);
  return rows.map((r) => ({ id: r.id, at: r.at, type: r.type, key: r.key, severity: r.severity, phase: r.phase, title: r.title, body: r.body, decision: r.decision, sentAt: r.sent_at }));
}

export function stats({ now = Date.now() } = {}) {
  const s = settings();
  const c = clock(now, s.tz);
  const counts = q('SELECT type, n FROM owner_alert_counts WHERE day = ?').all(c.day);
  const sentByType = Object.fromEntries(counts.map((r) => [r.type, r.n]));
  const total = counts.reduce((a, r) => a + r.n, 0);
  const alerts = counts.filter((r) => !NOT_CAPPED.includes(r.type)).reduce((a, r) => a + r.n, 0);
  //  «برطرف شد» رخدادِ تازه نیست: پرسروصداترین و «نفرستادم» فقط مشکل‌ها و رخدادها را می‌شمارند
  const recorded = q("SELECT type, decision, COUNT(*) AS n FROM owner_alerts WHERE at >= ? AND type NOT IN ('summary', 'digest') AND phase != 'recovery' GROUP BY type, decision").all(c.startOfDay);
  const byType = {};
  const byDecision = {};
  for (const r of recorded) {
    byType[r.type] = (byType[r.type] || 0) + r.n;
    byDecision[r.decision] = (byDecision[r.decision] || 0) + r.n;
  }
  const top = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([type, n]) => ({ type, label: TYPES[type]?.label || type, n }));
  const active = q("SELECT key, type, severity, title, since, notified FROM owner_alert_state WHERE active = 1 ORDER BY since DESC LIMIT 50").all();
  const st = getSetting(STATE_KEY, {}) || {};
  return {
    day: c.day, now, total, alerts, cap: s.dailyCap, sentByType, byType, byDecision, top,
    active: active.map((a) => ({ key: a.key, type: a.type, severity: a.severity, title: a.title, since: a.since, notified: Boolean(a.notified) })),
    quietNow: inQuiet(now, s), lastDigestAt: Number(st.lastDigestAt) || null,
    pending: Number(q("SELECT COUNT(*) AS n FROM owner_alerts WHERE decision IN ('pending', 'held')").get().n) || 0,
  };
}

export function catalog() {
  return Object.entries(TYPES).map(([id, t]) => ({ id, label: t.label, hint: t.hint, locked: Boolean(t.locked), defaultSeverity: t.defaultSeverity || null }));
}

/* ------------------------ پل از هشدارهای مرکز فرمان ------------------------ */

/** نوعِ هر هشدارِ `cc_alerts`. `null` ⇒ از راهِ دیگری می‌آید و دوباره نمی‌رود. */
export function typeOfKind(kind) {
  const k = String(kind || '');
  //  ⛔ دیسکِ همین سرور را نگهبانِ ربات برای هر پارتیشن می‌سنجد (۹۰/۹۵/۸۵)؛ «کارِ خودکار» از `fromJob` می‌آید
  if (k === 'disk_high' || k === 'automation') return null;
  const map = {
    server_offline: 'server_down', high_cpu: 'cpu', high_ram: 'memory', storage_low: 'disk', temp_high: 'temp',
    service_down: 'service_down', backup: 'backup', backup_failed: 'backup', login_suspicious: 'security',
    ssl_expiring: 'expiring', domain_expiring: 'expiring', selfheal: 'selfheal',
  };
  if (map[k]) return map[k];
  if (/_offline$/.test(k)) return 'monitor_down';
  return 'other';
}
const EVENT_KINDS = new Set(['login_suspicious', 'backup_failed', 'selfheal']);
/** «پیوسته N دقیقه» پیش از هر پیامی: یک جهشِ کوتاهِ حافظه یا پردازنده مشکل نیست. */
export const SUSTAIN_MS = Object.freeze({ memory: 10 * 60e3, cpu: 15 * 60e3 });

let bridge = null;
export function attachAlertBridge() {
  if (bridge) return;
  bridge = {
    alert: (a) => {
      const type = typeOfKind(a?.kind);
      if (!type) return;
      const title = String(a.title || '').slice(0, 200);
      const sev = a.severity === 'critical' ? 'critical' : a.severity === 'info' ? 'info' : 'warn';
      report({ type, key: `cc:${a.key}`, severity: sev, title, text: `${ICON[effectiveSeverity(type, sev)]} ${title}${a.detail ? `\n${String(a.detail).slice(0, 400)}` : ''}`, event: EVENT_KINDS.has(a.kind), sustainMs: SUSTAIN_MS[type] || 0 });
    },
    cleared: (a) => { if (a?.key) resolve(`cc:${a.key}`); },
  };
  alertEvents.on('alert', bridge.alert);
  alertEvents.on('cleared', bridge.cleared);
}
export function detachAlertBridge() {
  if (!bridge) return;
  alertEvents.off('alert', bridge.alert);
  alertEvents.off('cleared', bridge.cleared);
  bridge = null;
}

/* ------------------------- پل از کارهای خودکار ------------------------- */

const JOB_TYPE = {
  'backup-daily': 'backup', 'backup-weekly': 'backup', 'backup-monthly': 'backup', 'offsite-push': 'backup',
  'security-updates': 'update', 'panel-update': 'update', 'account-server-update': 'update', 'pump-update-mirror': 'update', 'site-update-mirror': 'update',
  'restart-on-down': 'service_down', 'code-rescue': 'code_mail',
};

/**
 * اعلانِ یک کارِ خودکار (`ctx.notify`). ⛔ آن‌چه از راهِ دیگری می‌رسد دوباره نمی‌رود:
 * «هشدارِ دیسک» (نگهبانِ ربات)، «ورودِ مشکوک» (هشدارِ امنیتیِ مرکز فرمان) و «بالا نماند» ِ ری‌استارت (هشدارِ سرویس).
 */
export function fromJob(name, level, text) {
  if (name === 'disk-alert' || name === 'suspicious-login-alert') return null;
  if (name === 'restart-on-down' && level === 'critical') return null;
  const type = JOB_TYPE[name] || 'automation';
  const sev = level === 'critical' ? 'critical' : level === 'warn' ? 'warn' : 'info';
  const t = String(text || '').replace(/\s+/g, ' ').slice(0, 300);
  //  کدِ هر کس جداست (دو کاربر، دو پیام)؛ بقیه یک کلید برای هر کار ⇒ تکرارش در مهلت نمی‌رود
  const key = name === 'code-rescue' ? `job:${name}:${t.slice(0, 120)}` : `job:${name}:${sev}`;
  return report({ type, key, severity: sev, title: t, event: true });
}
