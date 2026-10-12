// ---------------------------------------------------------------------------
//  صندوقِ پیام‌های رباتِ مالک — گفت‌وگو، جوابِ آماده، رسانه، بستن، پیامِ همگانی
//  (از ۱۴۰۵/۰۷/۲۰، نسخه 1.50.53)
//
//  خواستهٔ صاحب سامانه: «همه چیز داشته باشد عینِ یک برنامهٔ کامل… منو، پیشنهاد…
//  تمامِ برنامه‌ها و سایت‌هایم را ساپورت می‌کند؛ باید حرفه‌ای و دقیق و بی‌نقص باشد.»
//
//  نشانیِ هر گفت‌وگو («ref») همان نگاشتِ `telegram.js` است:
//      <id>                   گفت‌وگوی پمپ/فروشگاه روی سرورِ حساب
//      site:<slug>:<id>       گفت‌وگوی بازدیدکنندهٔ سایت (خودِ سایت نگهش می‌دارد)
//
//  ⛔ جواب فقط از `replyTo` می‌رود — Reply، «✍️ جواب»، «⚡ جوابِ آماده» همه همین.
//  ⛔ رسانه (عکس، ویدیو، صدا) فقط در پشتیبانیِ پمپ — همان قاعدهٔ سرورِ حساب. فروشگاه و
//     سایت فقط متن؛ پیغامِ روشن، نه گم شدنِ بی‌صدا.
//  ⛔ رسانهٔ کاربر با `fetchOnce` (همان کشِ دیسکِ پنل) گرفته می‌شود ⇒ پنل هم همان را
//     دارد؛ «فقط در عبور»ِ سرورِ حساب سرِ جایش است.
//  ⛔ حالتِ «✍️ در حالِ نوشتن به …» ۱۰ دقیقه بی‌کاری تمام می‌شود، و هیچ دستور یا
//     دکمهٔ منویی هرگز به کاربر نمی‌رود (`telegram.js` پیش از این‌جا جدایشان می‌کند).
// ---------------------------------------------------------------------------
import fsp from 'node:fs/promises';
import { getSetting, setSetting } from '../db.js';
import { cloudRaw, cloudRawBytes } from '../stations/cloud.js';
import { fetchOnce, writeCached } from '../support-media-cache.js';
import { audit } from '../control/audit.js';
import * as siteChats from './site-chats.js';
import { tg as tgCall, tgFile, fileUrl } from './telegram.js';
import { btn, fa } from './telegram-admin.js';

const COMPOSE = 'support_tg_compose';
const COMPOSE_MS = 10 * 60e3;
const QUICK = 'support_tg_quick';
const QUICK_MAX = 30;
const TG_FILE_MAX = 20 * 1024 * 1024; // سقفِ getFileِ تلگرام
const APP = { pump: '🛢 پمپ', shop: '🛒 فروشگاه', site: '🌐 سایت' };
const KIND = { image: '🖼 عکس', video: '🎬 ویدیو', audio: '🎤 پیامِ صوتی' };
const ACTOR = 'telegram';

export const DEFAULT_QUICK = [
  'سلام، پیامتان رسید؛ همین حالا بررسی می‌کنم و خبر می‌دهم.',
  'لطفاً برنامه را یک بار کامل ببندید و دوباره باز کنید، بعد خبر بدهید.',
  'لطفاً برنامه را به آخرین نسخه به‌روز کنید؛ مشکل در نسخهٔ تازه درست شده است.',
  'اشتراکتان تمدید شد ✅ برنامه را یک بار ببندید و باز کنید تا فعال شود.',
  'لطفاً «کدِ کامپیوتر» را از پروفایل ← اشتراک و پلن‌ها بفرستید تا کدِ اشتراک را بسازم.',
  'لطفاً یک عکس از صفحه (اسکرین‌شات) بفرستید تا دقیق ببینم.',
  'مشکل درست شد ✅ اگر باز چیزی بود همین‌جا بنویسید.',
];

const clock = (ms) => new Date(ms).toLocaleString('fa-IR', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' });
const isSite = (ref) => /^site:[^:]+:[^:]+$/.test(String(ref));
const siteParts = (ref) => { const m = /^site:([^:]+):([^:]+)$/.exec(String(ref)); return m ? { slug: m[1], id: m[2] } : null; };
const whoOf = (t) => t.stationName || t.shopName || t.accountName || t.who || t.contact || 'کاربر';

// ── جوابِ آماده ─────────────────────────────────────────────────────────
export function quickList() {
  const q = getSetting(QUICK, null);
  return Array.isArray(q) ? q.filter((x) => typeof x === 'string' && x.trim()) : [...DEFAULT_QUICK];
}
export function addQuick(text) {
  const t = String(text || '').trim().slice(0, 1000);
  if (!t) throw new Error('متن خالی است');
  const list = quickList();
  if (list.length >= QUICK_MAX) throw new Error(`حداکثر ${fa(QUICK_MAX)} جوابِ آماده`);
  if (!list.includes(t)) list.push(t);
  setSetting(QUICK, list);
  return list;
}
export function removeQuick(i) {
  const list = quickList();
  if (!(i >= 0 && i < list.length)) throw new Error('این جوابِ آماده دیگر نیست');
  list.splice(i, 1);
  setSetting(QUICK, list);
  return list;
}

export function quickManage() {
  const list = quickList();
  return {
    text: ['⚡ جواب‌های آماده', '', ...list.map((q, i) => `${fa(i + 1)}. ${q}`), '', 'برای افزودن: «➕ افزودن» را بزنید و متن را بفرستید.'].join('\n').slice(0, 4000),
    reply_markup: { inline_keyboard: [[btn('➕ افزودن', { k: 'quickAdd' })], ...list.map((q, i) => [btn(`🗑 ${fa(i + 1)}. ${q}`.slice(0, 60), { k: 'quickDel', i, text: q })])] },
  };
}

/** فهرستِ جواب‌های آماده برای یک گفت‌وگو — زدن ⇒ پیش‌نمایش و «📤 بفرست». */
export function quickPick(ref, label) {
  const list = quickList();
  return {
    text: `⚡ جوابِ آماده برای ${label}:`,
    reply_markup: { inline_keyboard: list.map((q, i) => [btn(`${fa(i + 1)}. ${q}`.slice(0, 60), { k: 'quickSend', ref, label, text: q })]) },
  };
}

// ── حالتِ «✍️ در حالِ نوشتن» ────────────────────────────────────────────
export function compose() {
  const c = getSetting(COMPOSE, null);
  return c && c.ref && Date.now() - Number(c.at) < COMPOSE_MS ? c : null;
}
export function setCompose(ref, label) { setSetting(COMPOSE, ref ? { ref, label, at: Date.now() } : null); }
export const touchCompose = () => { const c = compose(); if (c) setSetting(COMPOSE, { ...c, at: Date.now() }); };

// ── رسانه ───────────────────────────────────────────────────────────────
/** رسانهٔ پیامِ تلگرامِ مالک ⇒ { fileId, size, mime, kind } یا null. */
function mediaOf(m) {
  if (Array.isArray(m.photo) && m.photo.length) { const p = m.photo[m.photo.length - 1]; return { fileId: p.file_id, size: p.file_size, mime: 'image/jpeg', kind: 'image' }; }
  if (m.video) return { fileId: m.video.file_id, size: m.video.file_size, mime: m.video.mime_type || 'video/mp4', kind: 'video' };
  if (m.video_note) return { fileId: m.video_note.file_id, size: m.video_note.file_size, mime: 'video/mp4', kind: 'video' };
  if (m.voice) return { fileId: m.voice.file_id, size: m.voice.file_size, mime: m.voice.mime_type || 'audio/ogg', kind: 'audio' };
  if (m.audio) return { fileId: m.audio.file_id, size: m.audio.file_size, mime: m.audio.mime_type || 'audio/mpeg', kind: 'audio' };
  if (m.document) {
    const mime = String(m.document.mime_type || '');
    const kind = /^image\//.test(mime) && !/svg/.test(mime) ? 'image' : /^video\//.test(mime) ? 'video' : /^audio\//.test(mime) ? 'audio' : null;
    return { fileId: m.document.file_id, size: m.document.file_size, mime, kind, unsupported: !kind };
  }
  if (m.sticker || m.animation || m.contact || m.location) return { unsupported: true };
  return null;
}

async function downloadTg(tok, fileId) {
  const f = await tgCall(tok, 'getFile', { file_id: fileId });
  if (!f || !f.file_path) throw new Error('تلگرام فایل را نداد');
  if (Number(f.file_size) > TG_FILE_MAX) throw new Error('فایل بزرگ‌تر از ۲۰ مگابایت است؛ از پنل بفرستید');
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 60000);
  try {
    const r = await fetch(fileUrl(tok, f.file_path), { signal: ac.signal, redirect: 'error' });
    if (!r.ok) throw new Error(`دانلود از تلگرام نشد (${r.status})`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > TG_FILE_MAX) throw new Error('فایل بزرگ‌تر از ۲۰ مگابایت است');
    return buf;
  } finally { clearTimeout(t); }
}

/**
 * ⛔ تنها راهِ جوابِ مالک به یک گفت‌وگو (متن یا رسانه).
 * @returns {Promise<string>} شرحِ کوتاهِ آن‌چه رفت
 */
export async function replyTo(tok, ref, m) {
  const text = String(m.text || m.caption || '').trim();
  const media = mediaOf(m);
  if (media && media.unsupported) throw new Error('فقط متن، عکس، ویدیو و پیامِ صوتی می‌رود');
  const site = siteParts(ref);
  if (site) {
    if (media) throw new Error('به سایت فقط متن می‌رود');
    if (!text) throw new Error('متن خالی است');
    await siteChats.reply(site.slug, site.id, text.slice(0, 4000), 'telegram');
    return 'متن';
  }
  const id = String(ref);
  if (!media) {
    if (!text) throw new Error('متن خالی است');
    await cloudRaw('POST', `/api/admin/support/threads/${encodeURIComponent(id)}/messages`, { body: { body: text.slice(0, 4000) } });
    return 'متن';
  }
  const buf = await downloadTg(tok, media.fileId);
  let up;
  try {
    up = await cloudRawBytes('POST', `/api/admin/support/threads/${encodeURIComponent(id)}/media`, { body: buf, contentType: media.mime });
  } catch (e) {
    if (/media_not_supported|فقط در پشتیبانیِ پمپ/.test(`${e.code} ${e.message}`)) throw new Error('رسانه فقط در پشتیبانیِ پمپ می‌رود؛ برای فروشگاه متن بفرستید');
    throw e;
  }
  if (up && up.mediaId) await writeCached(String(up.mediaId), buf, up.mime || media.mime).catch(() => {});
  await cloudRaw('POST', `/api/admin/support/threads/${encodeURIComponent(id)}/messages`, { body: { kind: up.kind || media.kind, mediaId: up.mediaId, body: text.slice(0, 4000) } });
  return KIND[media.kind] || 'رسانه';
}

/**
 * پیامِ رسانه‌ایِ کاربر ⇒ خودِ عکس/ویدیو/صدا در تلگرام (با همان سرخط به‌عنوانِ caption).
 * @returns {Promise<number|null>} message_id یا null اگر نشد (آن‌وقت متن می‌رود)
 */
export async function sendIncomingMedia(tok, chatId, m, caption, reply_markup) {
  if (!m || !KIND[m.kind] || !m.mediaId) return null;
  try {
    const hit = await fetchOnce(String(m.mediaId), (mid) => cloudRawBytes('GET', `/api/admin/support/media/${mid}`));
    if (!hit || !hit.file || hit.size > 49 * 1024 * 1024) return null;
    const data = await fsp.readFile(hit.file);
    const mime = String(hit.mime || '');
    const [method, field, ext] = m.kind === 'image' ? ['sendPhoto', 'photo', 'jpg']
      : m.kind === 'video' ? ['sendVideo', 'video', 'mp4']
        : /ogg|opus/.test(mime) ? ['sendVoice', 'voice', 'ogg'] : ['sendAudio', 'audio', 'mp3'];
    const out = await tgFile(tok, method, { chat_id: chatId, caption: caption.slice(0, 1000), reply_markup }, { field, name: `${m.kind}.${ext}`, data, type: mime || 'application/octet-stream' });
    return out && out.message_id;
  } catch {
    return null;
  }
}

// ── دکمه‌های زیرِ هر پیامِ کاربر ────────────────────────────────────────
export function messageKeys(ref, t, label) {
  const row1 = [btn('✍️ جواب', { k: 'compose', ref, label }), btn('⚡ آماده', { k: 'quick', ref, label }), btn('💬 گفت‌وگو', { k: 'conv', ref })];
  const row2 = [];
  if (!isSite(ref)) {
    const tenantId = t && (t.app === 'pump' ? t.stationId : t.shopId);
    if (tenantId) row2.push(btn('👤 حساب', { k: 'card', app: t.app, tenantId }));
    row2.push(btn('✅ بستن', { k: 'close', ref, label }));
  }
  return { inline_keyboard: row2.length ? [row1, row2] : [row1] };
}

export function labelOf(t) {
  return `${APP[t.app] || t.app} · ${whoOf(t)}`;
}

// ── یک گفت‌وگو ──────────────────────────────────────────────────────────
export async function conversation(ref) {
  const site = siteParts(ref);
  let head;
  let lines;
  let t = null;
  if (site) {
    const s = siteChats.chatSites().find((x) => x.slug === site.slug);
    const conv = await siteChats.getChat(site.slug, site.id);
    if (!conv) throw new Error('این گفت‌وگو دیگر نیست');
    head = `🌐 ${s ? s.name : site.slug} · ${conv.name || 'بازدیدکننده'}${conv.contact ? ` (${conv.contact})` : ''}`;
    lines = (conv.messages || []).slice(-12).map((m) => `${m.from === 'owner' ? '🧑‍💼 شما' : '👤'} ${clock(m.at)}\n${m.body}`);
  } else {
    const conv = await cloudRaw('GET', `/api/admin/support/threads/${encodeURIComponent(ref)}`, { query: { after: 0 } });
    t = conv.thread || {};
    head = `${labelOf(t)}${t.accountEmail ? ` · ${t.accountEmail}` : ''}${t.subject ? ` — ${t.subject}` : ''}${t.status === 'closed' ? ' · ✅ بسته' : ''}`;
    lines = (conv.messages || []).slice(-12).map((m) => `${m.sender === 'admin' ? '🧑‍💼 شما' : '👤'} ${clock(m.createdAt)}\n${KIND[m.kind] ? `${KIND[m.kind]}${m.body ? ` — ${m.body}` : ''}` : m.body}`);
  }
  const label = head.split(' · ').slice(0, 2).join(' · ');
  const keys = messageKeys(ref, t, label);
  if (t && t.status === 'closed') keys.inline_keyboard[keys.inline_keyboard.length - 1] = keys.inline_keyboard.at(-1).filter((b) => !/بستن/.test(b.text)).concat([btn('↩️ باز کن', { k: 'reopen', ref, label })]);
  let text = `💬 ${head}\n\n${lines.join('\n\n') || '(پیامی نیست)'}`;
  if (text.length > 4000) text = `💬 ${head}\n\n…${text.slice(-(3990 - head.length))}`;
  return { text, reply_markup: keys };
}

/** گفت‌وگوهایی که منتظرِ جوابِ شما هستند — پمپ، فروشگاه و سایت‌ها. */
export async function waiting() {
  const out = [];
  try {
    const list = await cloudRaw('GET', '/api/admin/support/threads', { query: { status: 'open', limit: 100 } });
    for (const t of list.threads || []) {
      if (t.lastSender === 'admin' || !t.lastSender) continue;
      out.push({ ref: t.id, label: labelOf(t), at: Number(t.updatedAt) || 0, last: t.lastMessage || '', unread: Number(t.unreadAdmin) || 0 });
    }
  } catch (e) { out.error = e.message; }
  for (const s of siteChats.chatSites()) {
    try {
      const { chats } = await siteChats.listChats(s, 0);
      for (const c of chats) {
        if (c.lastFrom === 'owner') continue;
        out.push({ ref: `site:${s.slug}:${c.id}`, label: `🌐 ${s.name} · ${c.name || 'بازدیدکننده'}`, at: Number(c.updatedAt) || 0, last: c.last || c.lastMessage || '', unread: Number(c.unread) || 0 });
      }
    } catch { /* سایتِ خاموش */ }
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

export async function inboxMessage() {
  const list = await waiting();
  if (!list.length) return { text: `📭 هیچ گفت‌وگویی منتظرِ جواب نیست.${list.error ? `\n⚠️ سرورِ حساب: ${list.error}` : ''}` };
  return {
    text: [`📬 ${fa(list.length)} گفت‌وگو منتظرِ جوابِ شماست${list.error ? `\n⚠️ سرورِ حساب: ${list.error}` : ''}`, '', ...list.slice(0, 15).map((w, i) => `${fa(i + 1)}. ${w.label} — ${clock(w.at)}${w.last ? `\n    «${String(w.last).slice(0, 70)}»` : ''}`)].join('\n').slice(0, 4000),
    reply_markup: { inline_keyboard: list.slice(0, 15).map((w, i) => [btn(`${fa(i + 1)}. ${w.label}`.slice(0, 60), { k: 'conv', ref: w.ref })]) },
  };
}

export async function setThreadStatus(ref, status) {
  if (isSite(ref)) throw new Error('گفت‌وگوی سایت بستن ندارد');
  await cloudRaw('POST', `/api/admin/support/threads/${encodeURIComponent(ref)}/status`, { body: { status } });
}

// ── پیامِ همگانی ────────────────────────────────────────────────────────
export const BC_APPS = { pump: '🛢 پمپ‌ها', shop: '🛒 فروشگاه‌ها', both: '🛢🛒 هر دو' };
export const BC_TARGETS = { expiring: '⏳ اشتراکِ رو به پایان (۷ روز)', active: '✅ اشتراکِ فعال', all: '👥 همه' };

export function broadcastStart() {
  return {
    text: '📣 پیامِ همگانی — به پشتیبانیِ همهٔ حساب‌های برگزیده می‌رسد (مثلِ پیامِ خودتان در برنامه‌شان).\n\nبه کدام برنامه؟',
    reply_markup: { inline_keyboard: [Object.entries(BC_APPS).map(([app, t]) => btn(t, { k: 'bcApp', app }))] },
  };
}
export function broadcastTargets(app) {
  return {
    text: `📣 ${BC_APPS[app]} — به چه کسانی؟`,
    reply_markup: { inline_keyboard: Object.entries(BC_TARGETS).map(([target, t]) => [btn(t, { k: 'bcTarget', app, target })]) },
  };
}
export async function broadcastSend(app, target, body) {
  const out = await cloudRaw('POST', '/api/admin/support/broadcast', { body: { body: String(body).slice(0, 4000), target, app, limit: 500 } });
  audit({ actor: ACTOR, action: 'account.broadcast', detail: { target, app, sent: out.sent } });
  return out;
}
