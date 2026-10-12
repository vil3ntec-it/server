// ---------------------------------------------------------------------------
//  🔐 کدهای شش‌رقمی در «صندوق» — هر کدی که ساخته شد، با ایمیلِ گیرنده و حالِ ارسال
//  (از ۱۴۰۵/۰۷/۲۰، نسخه 1.50.53)
//
//  خواستهٔ صاحب سامانه: «کدهای شش‌رقمی هم این‌جا توی یک باکس بیاید، و برای ایمیلِ
//  طرف هم می‌رود؛ توی این هم نشان بده.»
//
//  ⛔ همان خوانندهٔ صفحهٔ «کدهای زنده» (`liveCodes` در routes/codes.js): سه دفتر، آینهٔ
//     یک‌بارپرس، ممیزی (`actor: telegram`). کد فقط تا وقتی زنده است دیده می‌شود.
//  ⛔ فقط وقتی مالک وارد است، و فقط به «صندوق» (گروهِ دو نفره، تاپیکِ «🔐 کدها»)؛
//     بی گروه ⇒ گفت‌وگوی خصوصی. خاموش‌شدنی از ⚙️ تنظیمات.
//  ⛔ هر کد یک پیام؛ تغییرِ حالش (رفت/استفاده شد/منقضی) همان پیام را ویرایش می‌کند.
//  ⚠️ بارِ اولِ روشن شدن فقط کدهای از همان لحظه، نه تاریخچه.
// ---------------------------------------------------------------------------
import { getSetting, setSetting } from '../db.js';
import { liveCodes } from '../routes/codes.js';
import { deliver, CODES_REF } from './telegram-topics.js';

const STATE = 'support_tg_codes';
const KEEP_MS = 24 * 3600e3;
const MIN_GAP = 2500;
let last = 0;

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const time = (ms) => (ms ? new Date(ms).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '');

function sendLine(r) {
  if (r.logOnly) return '📝 فقط در لاگ چاپ شد (ایمیلِ ارسال تنظیم نیست)';
  if (r.sendState === 'sent') return `📤 به ایمیل رفت ✅${r.sentAt ? ` ${time(r.sentAt)}` : ''}`;
  if (r.sendState === 'failed' || r.sendError) return `❌ ایمیل نرفت: ${esc(String(r.sendError || '').slice(0, 120))}`;
  return '⏳ در صفِ ارسال به ایمیل';
}
function stateLine(r) {
  return {
    used: '✅ استفاده شد', replaced: '↩️ کدِ تازه‌تر جایش آمد', expired: '⌛ منقضی شد',
  }[r.status] || `⏱ زنده تا ${time(r.expiresAt)}`;
}
export function codeText(r) {
  const code = r.code && r.status === 'live' ? `<code>${esc(r.code)}</code>` : '••••••';
  return [
    `🔐 ${code}`,
    `${esc(r.appName || r.app || '—')}${r.purpose ? ` · ${esc(r.purpose)}` : ''}`,
    `✉️ ${esc(r.email || r.emailMasked || '—')}`,
    sendLine(r),
    stateLine(r),
  ].join('\n');
}
const sig = (r) => `${r.status}|${r.sendState}|${r.logOnly ? 1 : 0}|${r.code ? 1 : 0}|${r.sendError || ''}`;

/** هر دورِ کار؛ خودش حداکثر هر ۲٫۵ ثانیه یک بار. */
export async function syncCodes(tg, tok, privateChat, { enabled = true, log = () => {} } = {}) {
  if (!enabled || Date.now() - last < MIN_GAP) return 0;
  last = Date.now();
  const st = getSetting(STATE, null) || {};
  const since = Number(st.since) || Date.now();
  const seen = st.seen && typeof st.seen === 'object' ? st.seen : {};
  let out;
  try { out = await liveCodes({ limit: 40, reveal: true, actor: 'telegram' }); } catch (e) { log(`کدها: ${e.message}`); return 0; }
  let n = 0;
  for (const r of [...(out.items || [])].reverse()) {
    const key = `${r.source || 'panel'}:${r.id}`;
    const old = seen[key];
    if (!old) {
      if (!(Number(r.createdAt) >= since)) continue; // تاریخچه نه
      const text = codeText(r);
      try {
        const d = await deliver(tg, tok, privateChat, CODES_REF, '🔐 کدهای شش‌رقمی', 'codes',
          async (where) => (await tg(tok, 'sendMessage', { ...where, text, parse_mode: 'HTML', disable_web_page_preview: true })).message_id);
        seen[key] = { chat: d.chatId, msg: d.messageId, sig: sig(r), at: Date.now() };
        n++;
      } catch (e) { log(`کدها: ${e.message}`); }
    } else if (old.sig !== sig(r)) {
      await tg(tok, 'editMessageText', { chat_id: old.chat, message_id: old.msg, text: codeText(r), parse_mode: 'HTML' }).catch(() => {});
      old.sig = sig(r);
    }
  }
  for (const [k, v] of Object.entries(seen)) if (Date.now() - Number(v.at) > KEEP_MS) delete seen[k];
  setSetting(STATE, { since, seen });
  return n;
}
