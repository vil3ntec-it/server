// ---------------------------------------------------------------------------
//  چراغِ روشن/خاموشِ سرور در رباتِ مالک (از ۱۴۰۵/۰۷/۲۰، نسخه 1.50.51)
//
//  خواستهٔ صاحب سامانه: «اگر سرور خاموش باشد یک نقطهٔ قرمز یا سبز باشد تا فهمیده شود.»
//
//  یک پیامِ سنجاق‌شده بالای گفت‌وگوی ربات:
//      🟢 روشن — هر دقیقه با ساعتِ تازه ویرایش می‌شود (ویرایش زنگ نمی‌زند)
//      🔴 خاموش شد — خاموش‌سازیِ عادی (آپدیت، ری‌استارت، بستنِ برنامه) همان لحظه
//      🟢 دوباره روشن شد — پیامِ تازه با زنگ، و این‌که چند دقیقه خاموش بود
//
//  ⚠️ قطعِ برق یا اینترنت را خودِ سرور نمی‌تواند خبر بدهد (کسی نمانده که بنویسد)؛
//     برای همین «آخرین تپش» در پیام است: ساعتِ کهنه‌تر از ۲ دقیقه ⇒ خاموش یا بی‌اینترنت.
//     و همین که برگشت، پیامِ «دوباره روشن شد» با مدتِ خاموشی می‌آید.
//  ⚠️ HLP_TG_HEARTBEAT_MS (پیش‌فرض ۶۰ ثانیه؛ ۰ = خاموش).
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';
import { versionInfo } from '../version.js';

const KEY = 'support_tg_beat';
const GAP_MS = 3 * 60e3;
const BOOT = Date.now();
let lastBeat = 0;
let booted = false;
let target = null; // { tg, tok, chatId } — برای markOffline هنگامِ خاموش‌سازی

const every = () => { const n = Number(process.env.HLP_TG_HEARTBEAT_MS); return Number.isFinite(n) && process.env.HLP_TG_HEARTBEAT_MS !== '' && process.env.HLP_TG_HEARTBEAT_MS !== undefined ? n : 60e3; };
const load = () => { const b = getSetting(KEY, null); return b && typeof b === 'object' ? b : {}; };
const save = (b) => setSetting(KEY, b);
const clock = (ms) => new Date(ms).toLocaleString('fa-IR', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' });
const fa = (n) => Number(n).toLocaleString('fa-IR');

function span(ms) {
  const m = Math.max(1, Math.round(ms / 60e3));
  if (m < 60) return `${fa(m)} دقیقه`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${fa(h)} ساعت${m % 60 ? ` و ${fa(m % 60)} دقیقه` : ''}`;
  return `${fa(Math.floor(h / 24))} روز`;
}

const greenText = (now) => [
  `🟢 کنترول سنتر روشن است — نسخهٔ ${versionInfo.version}`,
  `🕒 آخرین تپش: ${clock(now)}`,
  `⏱ روشن از ${span(now - BOOT)} پیش`,
  '',
  'این پیام هر دقیقه تازه می‌شود. اگر «آخرین تپش» بیش از ۲ دقیقه از ساعتِ گوشی عقب است ⇒ 🔴 سرور خاموش یا بی‌اینترنت است.',
].join('\n');

async function pinNew(tg, tok, chatId, b, text) {
  const out = await tg(tok, 'sendMessage', { chat_id: chatId, text, disable_notification: true });
  await tg(tok, 'pinChatMessage', { chat_id: chatId, message_id: out.message_id, disable_notification: true }).catch(() => {});
  if (b.msgId && b.msgId !== out.message_id) await tg(tok, 'deleteMessage', { chat_id: chatId, message_id: b.msgId }).catch(() => {});
  return out.message_id;
}

/** هر دورِ کارِ support-telegram صدا می‌زند؛ خودش هر دقیقه یک بار کار می‌کند. */
export async function beat(tg, tok, chatId) {
  target = { tg, tok, chatId };
  const ms = every();
  if (!ms) return;
  const now = Date.now();
  const b = load();
  if (b.chatId && b.chatId !== chatId) { b.msgId = 0; }
  if (!booted) {
    booted = true;
    // برگشت پس از خاموشی (عادی یا قطعِ برق): پیامِ زنگ‌دار با مدتِ خاموشی
    const since = b.offlineAt || (b.at && now - b.at > GAP_MS ? b.at : 0);
    if (since) {
      await tg(tok, 'sendMessage', { chat_id: chatId, text: `🟢 سرور دوباره روشن شد — نسخهٔ ${versionInfo.version}\n🔴 از ${clock(since)} حدودِ ${span(now - since)} خاموش${b.offlineAt ? '' : ' یا بی‌اینترنت'} بود.` }).catch(() => {});
    }
    const msgId = await pinNew(tg, tok, chatId, b, greenText(now));
    save({ chatId, msgId, at: now, offlineAt: 0 });
    lastBeat = now;
    return;
  }
  if (now - lastBeat < ms) return;
  lastBeat = now;
  let msgId = b.msgId;
  try {
    if (!msgId) throw new Error('none');
    await tg(tok, 'editMessageText', { chat_id: chatId, message_id: msgId, text: greenText(now) });
  } catch (e) {
    // پیام پاک شده یا هنوز نیست ⇒ تازه و سنجاق
    if (!/not modified/i.test(String(e.message))) msgId = await pinNew(tg, tok, chatId, { msgId: 0 }, greenText(now));
  }
  save({ chatId, msgId, at: now, offlineAt: 0 });
}

/** خاموش‌سازیِ عادی (index.js ⇒ shutdown): چراغ همان لحظه قرمز. حداکثر ۳ ثانیه. */
export async function markOffline(reason = '') {
  const b = load();
  if (!target || !b.msgId || !every()) return;
  const now = Date.now();
  const text = `🔴 کنترول سنتر خاموش شد — ${clock(now)}${reason ? `\n(${reason})` : ''}\n\nهمین که دوباره روشن شود این‌جا خبر می‌دهد.`;
  save({ ...b, offlineAt: now });
  await Promise.race([
    target.tg(target.tok, 'editMessageText', { chat_id: target.chatId, message_id: b.msgId, text }, 2500).catch(() => {}),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
}
