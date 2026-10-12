// ---------------------------------------------------------------------------
//  پلِ تلگرامِ پشتیبانی — پیامِ کاربرانِ برنامهٔ پمپ و فروشگاه به تلگرامِ مالک،
//  و جوابِ مالک در تلگرام به خودِ همان کاربر.
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۲۰): «وقتی کاربری به پشتیبانیِ برنامه پیام می‌دهد هم
//  توی سرور بیاید هم توی تلگرام برای باتِ پشتیبانی‌ام، و آن‌جا جوابشان را بدهم و به
//  خودشان هم برسد.»
//
//      سرورِ حساب (گفت‌وگوها) ──(کارِ support-telegram، هر ۲۰ ثانیه)──▶ تلگرامِ مالک
//      مالک «Reply» می‌زند ──getUpdates──▶ همین پل ──▶ سرورِ حساب ──▶ برنامهٔ کاربر
//
//  ⛔ تنها خوانندهٔ getUpdatesِ این ربات همین پل است. سایت (VILL3N-WEB-) فقط
//     sendMessage می‌زند؛ پس یک ربات برای هر دو کافی است و دعوای ۴۰۹ پیش نمی‌آید.
//  ⛔ فقط پیامی که از همان chat idِ مالک بیاید جواب حساب می‌شود؛ هر کسِ دیگری که
//     ربات را پیدا کند هیچ راهی به گفت‌وگوها ندارد.
//  ⛔ جواب فقط وقتی به کاربر می‌رود که روی پیامِ خودِ او «Reply» شده باشد — نشانیِ
//     گفت‌وگو از نگاشتِ «پیامِ تلگرام ← گفت‌وگو» می‌آید، نه از متنی که بشود جعل کرد.
//  ⚠️ بارِ اول فقط پیام‌های از همان لحظه به بعد می‌رود، نه همهٔ تاریخچه.
//  ⚠️ توکن در گاوصندوق است («telegram:support-bot»)، نه در تنظیمات.
// ---------------------------------------------------------------------------
import { db, getSetting, setSetting } from '../db.js';
import { putSecret, readSecret } from '../control/vault.js';
import { cloudRaw } from '../stations/cloud.js';
import * as siteChats from './site-chats.js';
import { handleCommand, handleCallback, wizActive, keyCommand, COMMANDS } from './telegram-admin.js';
import { replyTo, compose, touchCompose, messageKeys, labelOf, sendIncomingMedia } from './telegram-inbox.js';
import { watch } from './telegram-watch.js';
import { beat } from './telegram-heartbeat.js';
import { sessionOf, handleLogin, resetAuth, authStatus, logout } from './telegram-auth.js';

export const TOKEN_SECRET = 'telegram:support-bot';
const CONFIG = 'support_tg';
const STATE = 'support_tg_state';
const MAP_MAX = 2000;
const TOKEN_RE = /^\d{5,12}:[A-Za-z0-9_-]{30,60}$/;
const APPS = { pump: '🛢 پمپ', shop: '🛒 فروشگاه', site: '🌐 سایت' };

//  ⚠️ HLP_TELEGRAM_API فقط برای آزمون است
const api = () => (process.env.HLP_TELEGRAM_API || 'https://api.telegram.org').replace(/\/+$/, '');

export function validToken(t) { return TOKEN_RE.test(String(t || '')); }
/** نشانیِ دانلودِ فایلی که getFile داد. */
export const fileUrl = (tok, filePath) => `${api()}/file/bot${tok}/${String(filePath).split('/').map(encodeURIComponent).join('/')}`;

export function config() {
  const c = getSetting(CONFIG, null) || {};
  return {
    enabled: c.enabled === true,
    chatId: String(c.chatId || ''),
    apps: appsOf(c),
  };
}
// «سایت» از ۱.۵۰.۴۸ آمد: تنظیمی که پیش از آن ذخیره شده، سایت را هم روشن می‌گیرد
function appsOf(c) {
  const list = Array.isArray(c.apps) && c.apps.length ? c.apps.filter((a) => APPS[a]) : ['pump', 'shop', 'site'];
  return c.v === 2 || list.includes('site') ? list : [...list, 'site'];
}

export function token() {
  try {
    const row = db.prepare("SELECT id FROM cc_secrets WHERE scope = 'global' AND name = ?").get(TOKEN_SECRET);
    return row ? readSecret(row.id) : null;
  } catch {
    return null;
  }
}

function state() {
  const s = getSetting(STATE, null) || {};
  return { seen: s.seen && typeof s.seen === 'object' ? s.seen : null, offset: Number(s.offset) || 0, startedAt: Number(s.startedAt) || 0, since: s.since && typeof s.since === 'object' ? s.since : {}, map: Array.isArray(s.map) ? s.map : [], last: s.last || null };
}
const saveState = (s) => setSetting(STATE, { ...s, map: s.map.slice(-MAP_MAX) });

export async function tg(tok, method, body = {}, timeoutMs = 15000) {
  if (!validToken(tok)) throw new Error('توکنِ ربات درست نیست (شکلِ 123456:ABC… از BotFather)');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${api()}/bot${tok}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal, redirect: 'error',
    });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description ? `تلگرام: ${String(j.description).slice(0, 160)}` : `تلگرام پاسخ نداد (${r.status})`);
    return j.result;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('تلگرام پاسخ نداد');
    throw e;
  } finally { clearTimeout(t); }
}

/** فرستادنِ فایل (sendDocument) — multipart، چون JSON فایل نمی‌برد. */
export async function tgFile(tok, method, fields, { field = 'document', name, data, type = 'application/octet-stream' }, timeoutMs = 30000) {
  if (!validToken(tok)) throw new Error('توکنِ ربات درست نیست');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  fd.append(field, new Blob([data], { type }), name);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${api()}/bot${tok}/${method}`, { method: 'POST', body: fd, signal: ac.signal, redirect: 'error' });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.description ? `تلگرام: ${String(j.description).slice(0, 160)}` : `تلگرام پاسخ نداد (${r.status})`);
    return j.result;
  } finally { clearTimeout(t); }
}

/**
 * ⛔ رباتِ مالک **جدا** از رباتِ پمپ بنزین است (خواستهٔ صاحب سامانه، ۱۴۰۵/۰۷/۲۰).
 * رباتِ پمپ روی سرورِ حساب (shop، `lib/telegram.js`) getUpdates می‌زند؛ همان توکن
 * این‌جا یعنی دعوای ۴۰۹ و از کار افتادنِ هر دو، و پیامِ صاحبانِ پمپ در دستِ دیگری.
 * پس نامِ ربات (getMe) با نامِ رباتِ پمپ (`/api/admin/telegram`) سنجیده می‌شود.
 * ⚠️ اگر سرورِ حساب در دسترس نباشد جلوی ذخیره گرفته نمی‌شود (فقط سنجه رد می‌شود).
 */
export async function assertNotPumpBot(tok) {
  const me = await tg(tok, 'getMe');
  let pump = '';
  try { pump = String(((await cloudRaw('GET', '/api/admin/telegram')).telegram || {}).username || ''); } catch { /* سرورِ حساب خاموش */ }
  if (pump && me && String(me.username || '').toLowerCase() === pump.toLowerCase()) {
    throw Object.assign(new Error(`این توکنِ رباتِ پمپ بنزین (‎@${pump}‎) است. رباتِ کنترول سنتر باید جدا باشد: در ‎@BotFather‎ با ‎/newbot‎ یک رباتِ تازه بسازید و توکنِ آن را بچسبانید.`), { status: 409, code: 'pump_bot' });
  }
  return me;
}

/** ذخیرهٔ تنظیمات. توکنِ خالی یعنی «همان قبلی». */
export function saveConfig({ enabled, chatId, apps, token: tok }, actor = 'admin') {
  const cur = config();
  let reset = false;
  if (tok !== undefined && String(tok).trim() !== '') {
    const t = String(tok).trim();
    if (!validToken(t)) throw Object.assign(new Error('invalid_token'), { status: 400 });
    reset = t !== token();
    putSecret({ name: TOKEN_SECRET, kind: 'api_key', value: t, note: 'رباتِ تلگرامِ پشتیبانی', actor });
  }
  const next = {
    enabled: enabled === undefined ? cur.enabled : enabled === true,
    chatId: chatId === undefined ? cur.chatId : String(chatId || '').replace(/[^\d-]/g, '').slice(0, 20),
    apps: Array.isArray(apps) ? apps.filter((a) => APPS[a]) : cur.apps,
  };
  // روشن شدنِ تازه: تاریخچهٔ قدیمی فرستاده نشود
  if (next.enabled && !cur.enabled) { const s = state(); s.startedAt = Date.now(); s.since = {}; saveState(s); }
  // ⛔ ربات یا گفت‌وگوی دیگر ⇒ نشستِ ورودِ ربات باطل (telegram-auth.js)
  if (reset || next.chatId !== cur.chatId) resetAuth();
  setSetting(CONFIG, { ...next, v: 2 });
  return status();
}

export function status() {
  const c = config();
  const t = token();
  const s = state();
  return { ...c, hasToken: !!t, tokenHint: t ? `••••${t.slice(-4)}` : '', last: s.last, linked: s.map.length, bot: c.chatId ? authStatus(c.chatId) : { loggedIn: false } };
}

/** آخرین گفت‌وگویی که به ربات پیام داده — برای پر کردنِ خودکارِ chat id. */
const chatTitle = (c) => c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '';

export async function findChat(tok = token()) {
  // ⚠️ شنوندهٔ همیشگی روشن ⇒ getUpdateِ دوم یعنی ۴۰۹؛ همان «seen»ِ او کافی است
  const ups = pollerActive() && tok === token() ? [] : await tg(tok, 'getUpdates', { limit: 20, timeout: 0, allowed_updates: ['message'] });
  for (let i = ups.length - 1; i >= 0; i--) {
    const c = ups[i].message && ups[i].message.chat;
    if (c && c.id) return { id: String(c.id), title: chatTitle(c) };
  }
  //  ⚠️ وقتی پل روشن است و chat id غلط (مثلاً همان 123456789) ذخیره شده، کارِ هر ۵ ثانیه
  //  پیامِ Start را پیش از «پیدا کردن» برمی‌دارد (offset). پس آخرین گفت‌وگوی ناآشنا که
  //  همان کار دیده (`state().seen`، ۲۴ ساعت) هم پیشنهاد می‌شود. ورود با رمز همچنان لازم است.
  const seen = state().seen;
  if (seen && seen.id && Date.now() - Number(seen.at) < 24 * 3600e3) return { id: String(seen.id), title: seen.title || '' };
  return null;
}

const whoOf = (t) => t.stationName || t.shopName || t.accountName || t.who || t.contact || 'کاربر';
const KIND = { image: '🖼 عکس', video: '🎬 ویدیو', audio: '🎤 پیامِ صوتی' };

function format(t, m, asCaption = false) {
  const head = `${APPS[t.app] || t.app} · ${whoOf(t)}${t.accountEmail ? ` · ${t.accountEmail}` : ''}${t.subject ? ` — ${t.subject}` : ''}`;
  const body = KIND[m.kind] && !asCaption ? `${KIND[m.kind]} (در پنلِ کنترول سنتر ببینید)${m.body ? `\n${m.body}` : ''}` : (m.body || '');
  return `${head}\n\n${body}`.slice(0, asCaption ? 900 : 3900);
}

async function syncSite(tok, c, s, map, site) {
  const floorKey = `site:${site.slug}`;
  const floor = Number(s.since[floorKey]) || s.startedAt;
  const { chats } = await siteChats.listChats(site, floor);
  let sent = 0;
  let top = floor;
  for (const ch of chats) {
    const key = `site:${site.slug}:${ch.id}`;
    const since = Math.max(Number(s.since[key]) || 0, s.startedAt);
    top = Math.max(top, Number(ch.updatedAt) || 0);
    if (!(Number(ch.updatedAt) > since) || ch.lastFrom === 'owner') { s.since[key] = Math.max(since, Number(ch.updatedAt) || 0); continue; }
    const conv = await siteChats.getChat(site.slug, ch.id);
    const fresh = ((conv && conv.messages) || []).filter((m) => m.from === 'visitor' && Number(m.at) > since);
    for (const m of fresh.slice(-10)) {
      const head = `🌐 ${site.name} · ${ch.name || 'بازدیدکننده'}${ch.contact ? ` (${ch.contact})` : ''}`;
      const text = `${head}\n\n${m.body}`.slice(0, 3900);
      const label = `🌐 ${site.name} · ${ch.name || 'بازدیدکننده'}`;
      const out = await tg(tok, 'sendMessage', { chat_id: c.chatId, text, disable_web_page_preview: true, reply_markup: messageKeys(key, null, label) });
      map.set(out.message_id, key);
      s.since[key] = Math.max(Number(s.since[key]) || 0, Number(m.at));
      sent++;
    }
    s.since[key] = Math.max(Number(s.since[key]) || 0, Number(ch.updatedAt) || 0);
  }
  s.since[floorKey] = top;
  return sent;
}

/**
 * یک دور: اول جواب‌های مالک (تلگرام ← کاربر)، بعد پیام‌های تازهٔ کاربران (کاربر ← تلگرام).
 * @returns {{ skipped?: string, sent?: number, replied?: number }}
 */
/**
 * پیام‌ها و دکمه‌های رسیده از تلگرام — از شنوندهٔ همیشگی یا از کارِ ۵ ثانیه‌ای.
 * ⛔ همیشه زیرِ `withLock` (هر دو مسیر)، چون `s` و نگاشت مشترک‌اند.
 * @returns {Promise<number>} تعدادِ جواب‌هایی که به کاربران رفت
 */
async function processUpdates(tok, c, ups, s, map, log) {
  let replied = 0;
  for (const u of ups) {
    s.offset = Math.max(s.offset, u.update_id + 1);
    // ⚠️ offset پیش از هر کار ذخیره می‌شود: اگر وسطِ دور چیزی شکست، همان جواب دو بار به کاربر نمی‌رود
    saveState({ ...s, map: [...map] });
    if (u.callback_query) {
      // ⛔ دکمه فقط با نشستِ ورود (نام و رمزِ پنل)
      if (!sessionOf(c.chatId)) { await tg(tok, 'answerCallbackQuery', { callback_query_id: u.callback_query.id, text: '🔒 اول ‎/login‎ بزنید' }).catch(() => {}); continue; }
      try { await handleCallback(tg, tok, c.chatId, u.callback_query); } catch (e) { log(`دکمهٔ تلگرام: ${e.message}`); }
      continue;
    }
    const m = u.message;
    if (!m) continue;
    if (String(m.chat && m.chat.id) !== c.chatId) {
      // ⛔ فقط مالک. گفت‌وگوی خصوصیِ دیگر: برای «پیدا کردن» به یاد می‌ماند، و یک بار
      //    (هر ساعت) شناسه‌اش را می‌گیرد تا اگر مالک است و chat id غلط ذخیره شده، بفهمد.
      if (m.chat && m.chat.type === 'private') {
        const id = String(m.chat.id);
        const prev = s.seen && String(s.seen.id) === id ? Number(s.seen.toldAt) || 0 : 0;
        s.seen = { id, title: chatTitle(m.chat), at: Date.now(), toldAt: prev };
        if (Date.now() - prev > 3600e3) {
          s.seen.toldAt = Date.now();
          await tg(tok, 'sendMessage', { chat_id: id, text: `🔒 این ربات خصوصی است.\nشناسهٔ این گفت‌وگو: ${id}\n(اگر صاحبِ کنترول سنتر هستید، همین عدد را در پنل ← پشتیبانی ← تلگرام بگذارید یا «پیدا کردن» را بزنید.)` }).catch(() => {});
        }
        saveState({ ...s, map: [...map] });
      }
      continue;
    }
    // ⛔ قفلِ دوم: بی ورود با نام و رمزِ پنل نه دستور، نه Reply به کاربر
    if (!sessionOf(c.chatId)) {
      try { await handleLogin(tg, tok, c.chatId, m); } catch (e) { log(`ورودِ تلگرام: ${e.message}`); }
      continue;
    }
    if (/^\/logout(@\w+)?$/i.test(String(m.text || '').trim())) {
      logout();
      await tg(tok, 'sendMessage', { chat_id: c.chatId, text: '🔒 خارج شدید. برای ورودِ دوباره ‎/login‎.', reply_markup: { remove_keyboard: true } }).catch(() => {});
      continue;
    }
    const text = String(m.text || m.caption || '').trim();
    const say = (t2, extra = {}) => tg(tok, 'sendMessage', { chat_id: c.chatId, reply_to_message_id: m.message_id, allow_sending_without_reply: true, text: t2, ...extra }).catch(() => {});
    // ⛔ دستور («/…») و دکمهٔ منو هرگز به کاربر نمی‌رود — حتی در حالِ نوشتن یا با Reply
    const isCommand = !!m.text && (/^\//.test(text) || !!keyCommand(text));
    const threadId = !isCommand && m.reply_to_message && map.get(m.reply_to_message.message_id);
    const writing = !isCommand && !threadId && !wizActive() && compose();
    const target = threadId || (writing && writing.ref);
    if (target) {
      try {
        const what = await replyTo(tok, target, m);
        if (writing) touchCompose();
        replied++;
        await say(writing ? `✅ ${what} به ${writing.label} رسید. (ادامه بدهید، یا ‎/done‎)` : `✅ ${what} رسید.`);
      } catch (e) {
        log(`جواب به گفت‌وگوی ${target} نرفت: ${e.message}`);
        await say(`⚠️ نرسید: ${e.message}`);
      }
      continue;
    }
    // پیامِ بی Reply = دستور، دکمه، پرسشِ نیمه‌کاره یا جست‌وجوی حساب (هیچ‌وقت به کاربری نمی‌رود)
    if (!m.text) { await say('برای فرستادنِ عکس، ویدیو یا صدا به کاربر، روی پیامِ خودِ او Reply بزنید یا «✍️ جواب» را بزنید.'); continue; }
    try {
      await handleCommand(tg, tok, c.chatId, m);
    } catch (e) {
      log(`دستورِ تلگرام: ${e.message}`);
      await say(`⚠️ نشد: ${String(e.message).slice(0, 200)}`);
    }
  }
  return replied;
}

const UPDATES = ['message', 'callback_query'];

//  ⛔ یک کار در هر لحظه روی وضعیتِ پل (offset، نگاشتِ پیام ⇒ گفت‌وگو)
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

// ── شنوندهٔ همیشگی (long-poll): جوابِ زیرِ یک ثانیه ─────────────────────────
//  خواستهٔ صاحب سامانه: «خیلی زود جواب بده و سریع باشه نه کند.»
//  به‌جای «هر ۵ ثانیه یک بار بپرس»، یک getUpdates با timeout=25 همیشه باز است و
//  تلگرام همان لحظه که پیامی برسد جوابش را برمی‌گرداند. کارِ ۵ ثانیه‌ای فقط
//  پیام‌های کاربران را به تلگرام می‌برد. HLP_TG_LONGPOLL=0 ⇒ خاموش (آزمون‌ها).
const poller = { started: false, stopped: false, active: false, abort: null };
export const pollerActive = () => poller.active;
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });

export function startPoller({ log = () => {} } = {}) {
  if (poller.started || process.env.HLP_TG_LONGPOLL === '0') return false;
  poller.started = true;
  (async () => {
    while (!poller.stopped) {
      const c = config();
      const tok = token();
      if (!c.enabled || !tok || !c.chatId) { poller.active = false; await sleep(3000); continue; }
      poller.active = true;
      const t0 = Date.now();
      let ups;
      try {
        ups = await tg(tok, 'getUpdates', { offset: state().offset, limit: 50, timeout: 25, allowed_updates: UPDATES }, 35000);
      } catch (e) {
        if (!poller.stopped) { log(`شنوندهٔ تلگرام: ${e.message}`); await sleep(3000); }
        continue;
      }
      if (poller.stopped) break;
      if (ups.length) {
        await withLock(async () => {
          const s = state();
          if (!s.startedAt) s.startedAt = Date.now();
          const map = new Map(s.map);
          // ⚠️ دوباره با config/token تازه — ممکن است در این ۲۵ ثانیه عوض شده باشند
          const cfg = config();
          const fresh = ups.filter((u) => u.update_id >= s.offset);
          if (!cfg.enabled || token() !== tok || cfg.chatId !== c.chatId) {
            // پل همین حالا خاموش یا عوض شد ⇒ این‌ها کنار می‌روند، نه اجرا (دکمهٔ «بله»ِ کهنه بعداً اجرا نشود)
            for (const u of fresh) s.offset = Math.max(s.offset, u.update_id + 1);
          } else {
            await processUpdates(tok, cfg, fresh, s, map, log);
          }
          s.map = [...map];
          saveState(s);
        }).catch((e) => log(`شنوندهٔ تلگرام: ${e.message}`));
      } else if (Date.now() - t0 < 1000) {
        await sleep(1000); // تلگرامی که بی‌درنگ خالی برگرداند (نباید)، حلقهٔ داغ نسازد
      }
    }
    poller.active = false;
  })();
  return true;
}
export function stopPoller() { poller.stopped = true; poller.active = false; }

let commandsFor = '';
export function syncOnce(opts = {}) { return withLock(() => syncInner(opts)); }

async function syncInner({ log = () => {} } = {}) {
  const c = config();
  const tok = token();
  if (!c.enabled) return { skipped: 'disabled' };
  if (!tok || !c.chatId) return { skipped: 'not_configured' };
  // 🟢/🔴 پیامِ سنجاق‌شدهٔ «سرور روشن است» (telegram-heartbeat.js)
  await beat(tg, tok, c.chatId).catch((e) => log(`چراغِ تلگرام: ${e.message}`));
  // پیشنهادِ دستورها («/») فقط در گفت‌وگوی مالک — یک بار برای هر ربات/گفت‌وگو در هر اجرا
  if (commandsFor !== `${tok}|${c.chatId}`) {
    try {
      await tg(tok, 'setMyCommands', { commands: COMMANDS, scope: { type: 'chat', chat_id: Number(c.chatId) || c.chatId } });
      await tg(tok, 'setChatMenuButton', { chat_id: Number(c.chatId) || c.chatId, menu_button: { type: 'commands' } }).catch(() => {});
      commandsFor = `${tok}|${c.chatId}`;
    } catch (e) { log(`دستورهای تلگرام: ${e.message}`); }
  }
  const s = state();
  if (!s.startedAt) s.startedAt = Date.now();
  const map = new Map(s.map);
  let replied = 0;
  let sent = 0;

  // ۱) جوابِ مالک — اگر شنوندهٔ همیشگی (long-poll) روشن است، کارِ اوست؛ وگرنه همین‌جا
  //  ⚠️ دو getUpdatesِ هم‌زمان روی یک ربات ⇒ ۴۰۹ از تلگرام. پس فقط یکی.
  if (!pollerActive()) {
    const ups = await tg(tok, 'getUpdates', { offset: s.offset, limit: 50, timeout: 0, allowed_updates: UPDATES });
    replied += await processUpdates(tok, c, ups, s, map, log);
  }

  // ۲) پیام‌های تازهٔ بازدیدکنندگانِ سایت‌ها (هر سایت جدا؛ خاموش بودنِ یکی بقیه را نمی‌خواباند)
  if (c.apps.includes('site')) {
    for (const site of siteChats.chatSites()) {
      try { sent += await syncSite(tok, c, s, map, site); } catch (e) { log(`گفت‌وگوهای سایتِ ${site.name}: ${e.message}`); }
    }
  }

  // ۳) پیام‌های تازهٔ کاربرانِ پمپ و فروشگاه
  const wantCloud = c.apps.some((a) => a === 'pump' || a === 'shop');
  //  ⚠️ سرورِ حساب خاموش نباید بقیهٔ دور (سایت‌ها، هشدارها) را بخواباند
  let list = null;
  if (wantCloud) {
    try { list = await cloudRaw('GET', '/api/admin/support/threads', { query: { limit: 100 } }); } catch (e) { log(`گفت‌وگوهای پمپ و فروشگاه: ${e.message}`); }
  }
  for (const t of (list && list.threads) || []) {
    if (!c.apps.includes(t.app)) continue;
    const since = Number(s.since[t.id]) || s.startedAt;
    if (!(Number(t.updatedAt) > since) || t.lastSender === 'admin') continue;
    const conv = await cloudRaw('GET', `/api/admin/support/threads/${encodeURIComponent(t.id)}`, { query: { after: 0 } });
    const fresh = ((conv && conv.messages) || []).filter((m) => m.sender !== 'admin' && Number(m.createdAt) > since).sort((a, b) => a.createdAt - b.createdAt);
    for (const m of fresh.slice(-10)) {
      const full = { ...t, ...(conv.thread || {}) };
      const keys = messageKeys(t.id, full, labelOf(full));
      // عکس/ویدیو/صدا خودش می‌آید؛ اگر نشد، همان متنِ «در پنل ببینید»
      let msgId = KIND[m.kind] ? await sendIncomingMedia(tok, c.chatId, m, format(full, m, true), keys) : null;
      if (!msgId) msgId = (await tg(tok, 'sendMessage', { chat_id: c.chatId, text: format(full, m), disable_web_page_preview: true, reply_markup: keys })).message_id;
      map.set(msgId, t.id);
      s.since[t.id] = Math.max(Number(s.since[t.id]) || 0, Number(m.createdAt));
      sent++;
    }
    if (!fresh.length) s.since[t.id] = Number(t.updatedAt);
  }

  // 🚨 هشدارها و 📊 گزارشِ روزانه (telegram-watch.js) — فقط برای مالکِ واردشده
  if (sessionOf(c.chatId)) await watch(tg, tok, c.chatId, log).catch((e) => log(`نگهبانِ تلگرام: ${e.message}`));

  s.map = [...map];
  s.last = { at: Date.now(), sent, replied };
  saveState(s);
  if (sent || replied) log(`تلگرام: ${sent} پیام به مالک، ${replied} جواب به کاربران`);
  return { sent, replied };
}
