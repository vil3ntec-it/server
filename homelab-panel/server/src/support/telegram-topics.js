// ---------------------------------------------------------------------------
//  📥 صندوقِ پیام‌ها — گروهِ تلگرامِ جدا با «تاپیک» برای هر گفت‌وگو
//  (از ۱۴۰۵/۰۷/۲۰، نسخه 1.50.53)
//
//  خواستهٔ صاحب سامانه: «پیامِ کاربر و کنترلِ سرور در یک بات گیج‌کننده و شلوغ
//  می‌شود؛ پیام‌ها در یک باکس باشند که همه را یک‌جا ببینم و همان‌جا جواب بدهم، و
//  با پیام‌های سرور قاطی نشود.» و «کدهای شش‌رقمی هم توی همین باکس بیاید.»
//
//      گفت‌وگوی خصوصی با ربات  ⇒  فقط کنترلِ سرور (منوها، هشدار، گزارش)
//      گروهِ «صندوق» (Topics روشن) ⇒ یک تاپیک برای هر کاربر + تاپیکِ «🔐 کدها»
//                                   هر چه مالک در تاپیک بنویسد ⇒ همان کاربر (بی Reply)
//
//  ⛔ گروه فقط با `/link`ِ خودِ مالک (همان کسی که وارد شده) در همان گروه وصل می‌شود.
//  ⛔ در گروه جز مالک و ربات کسی نباید باشد: هنگامِ وصل سنجیده می‌شود و هر ۱۰ دقیقه
//     دوباره؛ عضوِ سوم ⇒ هیچ پیام و کدی به گروه نمی‌رود (برمی‌گردد به گفت‌وگوی
//     خصوصی) و هشدار می‌آید، تا او بیرون برود.
//  ⛔ در گروه فقط پیامِ خودِ مالک (from.id) جواب حساب می‌شود؛ ربات‌ها و دیگران نه.
//  ⚠️ گروه وصل نیست ⇒ همه‌چیز مثلِ قبل در گفت‌وگوی خصوصی.
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';

const GROUP = 'support_tg_group';
const TOPICS = 'support_tg_topics';
const guardMs = () => Number(process.env.HLP_TG_GUARD_MS) || 10 * 60e3; // ⚠️ متغیر فقط برای آزمون
export const CODES_REF = 'codes';
const COLORS = { pump: 0xFFD67E, shop: 0x6FB9F0, site: 0x8EEE98, codes: 0xFF93B2 };
let botId = null;
let lastGuard = 0;

export function group() { const g = getSetting(GROUP, null); return g && g.id ? g : null; }
/** گروه وصل است و امن (فقط مالک و ربات)؟ */
export function groupOk() { const g = group(); return !!(g && !g.blocked); }
export function unlinkGroup() { setSetting(GROUP, null); setSetting(TOPICS, {}); }
function topics() { const t = getSetting(TOPICS, null); return t && typeof t === 'object' ? t : {}; }
function saveTopic(ref, v) { const t = topics(); if (v) t[ref] = v; else delete t[ref]; setSetting(TOPICS, t); }
export function topicOf(ref) { return topics()[ref] || null; }
export function refOfThread(threadId) {
  const t = topics();
  for (const [ref, v] of Object.entries(t)) if (Number(v.id) === Number(threadId)) return ref;
  return null;
}
/** نشانیِ باز کردنِ یک تاپیک در تلگرام (برای دکمهٔ صندوقِ خصوصی). */
export function topicUrl(ref) {
  const g = group(); const t = topicOf(ref);
  if (!g || !t) return null;
  return `https://t.me/c/${String(g.id).replace(/^-100/, '')}/${t.id}`;
}

async function myId(tg, tok) {
  if (!botId) botId = (await tg(tok, 'getMe')).id;
  return botId;
}

/**
 * `/link` در گروه، از خودِ مالک. ⇒ { ok, text }
 */
export async function linkGroup(tg, tok, chat) {
  if (!chat || chat.type !== 'supergroup' || !chat.is_forum) {
    return { ok: false, text: '⚠️ این گروه «Topics» ندارد.\nدر تلگرام: تنظیماتِ گروه ← Topics را روشن کنید، بعد دوباره ‎/link‎ بزنید.' };
  }
  const me = await tg(tok, 'getChatMember', { chat_id: chat.id, user_id: await myId(tg, tok) });
  if (!me || me.status !== 'administrator' || !me.can_manage_topics) {
    return { ok: false, text: '⚠️ ربات باید «ادمین» با اجازهٔ «Manage Topics» باشد.\nگروه ← اعضا ← ربات ← Promote ← Manage Topics، بعد دوباره ‎/link‎.' };
  }
  const n = await tg(tok, 'getChatMemberCount', { chat_id: chat.id });
  if (Number(n) > 2) {
    return { ok: false, text: `⛔ در این گروه ${n} عضو هست. صندوقِ پیام‌ها و کدها فقط باید دستِ شما باشد: جز شما و ربات همه را بیرون کنید، بعد دوباره ‎/link‎.` };
  }
  setSetting(GROUP, { id: String(chat.id), title: chat.title || '', linkedAt: Date.now(), blocked: false });
  setSetting(TOPICS, {});
  return { ok: true, text: '✅ این گروه «صندوقِ پیام‌ها» شد.\n\nاز این به بعد پیامِ هر کاربر (پمپ، فروشگاه، سایت‌ها) در تاپیکِ خودش می‌آید و کدهای شش‌رقمی در تاپیکِ «🔐 کدها».\nهر چه در تاپیکِ یک کاربر بنویسید (متن، عکس، صدا) مستقیم به همان کاربر می‌رود — Reply لازم نیست.\nکنترلِ سرور در گفت‌وگوی خصوصی با ربات می‌ماند.' };
}

/** هر ۱۰ دقیقه: جز مالک و ربات کسی در گروه نباشد. ⇒ پیامِ هشدار یا null */
export async function guardGroup(tg, tok, { force = false } = {}) {
  const g = group();
  if (!g) return null;
  if (!force && Date.now() - lastGuard < guardMs()) return null;
  lastGuard = Date.now();
  let n;
  try { n = Number(await tg(tok, 'getChatMemberCount', { chat_id: g.id })); } catch (e) {
    if (/chat not found|kicked|not a member|forbidden/i.test(String(e.message))) { unlinkGroup(); return '⚠️ ربات دیگر در گروهِ «صندوقِ پیام‌ها» نیست؛ پیام‌ها دوباره همین‌جا می‌آیند. برای گروهِ تازه: ‎/link‎ در همان گروه.'; }
    return null;
  }
  if (n > 2 && !g.blocked) { setSetting(GROUP, { ...g, blocked: true }); return `⛔ در گروهِ «صندوقِ پیام‌ها» ${n} عضو هست — کسی جز شما و ربات آمده. تا او بیرون نرود، پیام‌ها و کدها همین‌جا (خصوصی) می‌آیند.`; }
  if (n <= 2 && g.blocked) { setSetting(GROUP, { ...g, blocked: false }); return '✅ گروهِ «صندوقِ پیام‌ها» دوباره فقط مالِ شماست؛ پیام‌ها و کدها به آن‌جا برمی‌گردند.'; }
  return null;
}

/** تاپیکِ یک گفت‌وگو — اگر نیست ساخته، اگر بسته است باز می‌شود. ⇒ message_thread_id */
export async function ensureTopic(tg, tok, ref, name, app) {
  const g = group();
  let t = topicOf(ref);
  if (t && t.closed) {
    await tg(tok, 'reopenForumTopic', { chat_id: g.id, message_thread_id: t.id }).catch(() => {});
    t = { ...t, closed: false }; saveTopic(ref, t);
  }
  if (t) return t.id;
  const out = await tg(tok, 'createForumTopic', { chat_id: g.id, name: String(name).slice(0, 120), icon_color: COLORS[app] || COLORS.pump });
  saveTopic(ref, { id: out.message_thread_id, name: String(name).slice(0, 120), closed: false });
  return out.message_thread_id;
}

/**
 * فرستادن به «صندوق» — تاپیکِ همان گفت‌وگو در گروه، یا گفت‌وگوی خصوصی اگر گروه نیست.
 * `send(where)` پیام را با chat_id و message_thread_id می‌فرستد و message_id برمی‌گرداند.
 * ⚠️ تاپیکی که دستی پاک شده ⇒ یک بار تاپیکِ تازه.
 * @returns {Promise<{chatId: string, messageId: number, inGroup: boolean}>}
 */
export async function deliver(tg, tok, privateChat, ref, name, app, send) {
  if (!groupOk()) return { chatId: privateChat, messageId: await send({ chat_id: privateChat }), inGroup: false };
  const g = group();
  for (let attempt = 0; attempt < 2; attempt++) {
    const thread = await ensureTopic(tg, tok, ref, name, app);
    try {
      return { chatId: g.id, messageId: await send({ chat_id: g.id, message_thread_id: thread }), inGroup: true };
    } catch (e) {
      if (attempt === 0 && /thread not found|TOPIC_DELETED|TOPIC_CLOSED|message thread/i.test(String(e.message))) { saveTopic(ref, null); continue; }
      throw e;
    }
  }
  throw new Error('تاپیک ساخته نشد');
}

export async function closeTopic(tg, tok, ref) {
  const g = group(); const t = topicOf(ref);
  if (!g || !t || t.closed) return;
  await tg(tok, 'closeForumTopic', { chat_id: g.id, message_thread_id: t.id }).catch(() => {});
  saveTopic(ref, { ...t, closed: true });
}
export async function reopenTopic(tg, tok, ref) {
  const g = group(); const t = topicOf(ref);
  if (!g || !t || !t.closed) return;
  await tg(tok, 'reopenForumTopic', { chat_id: g.id, message_thread_id: t.id }).catch(() => {});
  saveTopic(ref, { ...t, closed: false });
}
