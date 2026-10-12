// ---------------------------------------------------------------------------
//  ورودِ رباتِ مالک — نام و رمزِ پنلِ کنترول سنتر (و کدِ دوعاملی اگر روشن است)
//  (از ۱۴۰۵/۰۷/۲۰، نسخه 1.50.51)
//
//  خواستهٔ صاحب سامانه: «رمز و نامِ سرور را بخواهد تا کسی جز من نتواند به سرور وصل شود.»
//
//  ⛔ دو قفل، هر دو لازم: (۱) chat idِ مالک، (۲) نشستِ ورود با کاربرِ «admin»ِ پنل.
//     گوشیِ گم‌شده یا تلگرامِ دزدیده‌شده بی رمز هیچ دستوری، دکمه‌ای یا Replyی نمی‌زند.
//  ⛔ پیامِ رمز و کدِ دوعاملی همان لحظه از تلگرام پاک می‌شود (deleteMessage).
//  ⛔ ۵ بار غلط ⇒ ۱۵ دقیقه قفل. هر ورود و شکست در لاگِ پنل.
//  ⛔ نشست به «اثرِ انگشتِ» رمز بسته است: عوض کردنِ رمزِ پنل، بستنِ کاربر، پایین آوردنِ
//     نقش یا عوض کردنِ chat id/توکنِ ربات ⇒ نشستِ ربات همان لحظه باطل.
//  ⚠️ نشست ۷ روز (HLP_TG_SESSION_DAYS). ‎/logout‎ همان لحظه می‌بندد.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db, getSetting, setSetting, logEvent } from '../db.js';
import { findUser, verifyPassword } from '../auth.js';
import { verifyTotp, useRecoveryCode } from '../lib/totp.js';
import { audit } from '../control/audit.js';
import { KEYBOARD } from './telegram-admin.js';

const KEY = 'support_tg_auth';
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60e3;
const STEP_MS = 5 * 60e3;
const sessionMs = () => Math.max(1, Number(process.env.HLP_TG_SESSION_DAYS) || 7) * 24 * 3600e3;

const fpOf = (user) => crypto.createHash('sha256').update(String(user.password_hash || '')).digest('hex').slice(0, 24);
function load() { const a = getSetting(KEY, null); return a && typeof a === 'object' ? a : {}; }
const save = (a) => setSetting(KEY, a);

/** هر عوض شدنِ chat id یا توکن ⇒ نشست و مرحلهٔ ورود پاک. */
export function resetAuth() { save({}); }

/** نشستِ زنده برای همین chat — یا null. */
export function sessionOf(chatId) {
  const a = load();
  const s = a.session;
  if (!s || String(s.chatId) !== String(chatId) || !(s.until > Date.now())) return null;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(s.uid));
  if (!user || user.disabled || (user.role || 'admin') !== 'admin' || fpOf(user) !== s.fp) {
    save({ ...a, session: null });
    return null;
  }
  return { username: user.username, until: s.until };
}

export function authStatus(chatId) {
  const s = sessionOf(chatId);
  return s ? { loggedIn: true, username: s.username, until: s.until } : { loggedIn: false };
}

export function logout() { const a = load(); save({ ...a, session: null, stage: null }); }

/**
 * پیامِ مالکی که هنوز وارد نشده. همیشه خودش جواب می‌دهد.
 * @returns {Promise<void>}
 */
export async function handleLogin(tg, tok, chatId, m) {
  const a = load();
  const send = (text, extra = {}) => tg(tok, 'sendMessage', { chat_id: chatId, reply_to_message_id: m.message_id, allow_sending_without_reply: true, text, ...extra }).catch(() => {});
  const wipe = () => tg(tok, 'deleteMessage', { chat_id: chatId, message_id: m.message_id }).catch(() => {});
  const text = String(m.text || '').trim();
  const now = Date.now();

  if (a.lockUntil > now) {
    // ⚠️ در قفل هر متنِ غیرِدستور ممکن است رمز باشد ⇒ پاک
    if (text && !text.startsWith('/')) await wipe();
    await send(`🔒 به‌خاطرِ چند رمزِ غلط، ورود تا ${Math.ceil((a.lockUntil - now) / 60e3)} دقیقهٔ دیگر بسته است.`);
    return;
  }
  if (/^\/login(@\w+)?$/i.test(text)) {
    save({ ...a, stage: { step: 'username', at: now } });
    await send('🔐 ورود به رباتِ کنترول سنتر\n\nنامِ کاربریِ پنلِ کنترول سنتر را بفرستید.\n(‎/cancel‎ برای انصراف)');
    return;
  }
  if (/^\/cancel/i.test(text)) { save({ ...a, stage: null }); await send('لغو شد. برای ورود ‎/login‎ بزنید.'); return; }

  // ⚠️ دستورِ دیگر (/start، /status…) هرگز «نامِ کاربری» یا «رمز» حساب نمی‌شود
  const st = a.stage && now - a.stage.at < STEP_MS && !text.startsWith('/') ? a.stage : null;
  if (!st || !text) {
    if (st === null && a.stage) save({ ...a, stage: null });
    await send('🔒 این ربات قفل است. برای ورود ‎/login‎ بزنید و نام و رمزِ پنلِ کنترول سنتر را بدهید.');
    return;
  }

  const fail = async (why) => {
    const fails = (Number(a.fails) || 0) + 1;
    const locked = fails >= MAX_FAILS;
    save({ ...a, stage: null, fails: locked ? 0 : fails, lockUntil: locked ? now + LOCK_MS : 0 });
    logEvent('warn', 'telegram', `ورودِ ناموفق به رباتِ تلگرام (${why})${locked ? ' — ۱۵ دقیقه قفل شد' : ''}`);
    audit({ actor: 'telegram', action: 'telegram.login', detail: { step: why }, result: 'fail' });
    await send(locked ? '⛔ ۵ بار غلط. ورود ۱۵ دقیقه بسته شد.' : `❌ نام یا رمز یا کد درست نیست (${MAX_FAILS - fails} بارِ دیگر). دوباره ‎/login‎ بزنید.`);
  };
  const ok = async (user) => {
    save({ session: { chatId: String(chatId), uid: user.id, fp: fpOf(user), until: now + sessionMs() }, stage: null, fails: 0, lockUntil: 0 });
    logEvent('info', 'telegram', `«${user.username}» وارد رباتِ تلگرام شد`);
    audit({ actor: user.username, action: 'telegram.login', entity: 'user', entityId: String(user.id) });
    await send(`✅ خوش آمدید ${user.username}. این ورود ${Math.round(sessionMs() / 864e5)} روز می‌ماند؛ ‎/logout‎ برای خروج.\n\nدکمه‌های پایینِ صفحه منوی شماست؛ ‎/start‎ راهنما.`, { reply_markup: KEYBOARD });
  };

  if (st.step === 'username') {
    save({ ...a, stage: { step: 'password', username: text.slice(0, 60), at: now } });
    await send('رمزِ پنل را بفرستید. (پیامِ رمز همان لحظه پاک می‌شود)');
    return;
  }
  if (st.step === 'password') {
    await wipe();
    const user = findUser(st.username);
    if (!user || user.disabled || (user.role || 'admin') !== 'admin' || !verifyPassword(text, user.password_hash)) return fail('password');
    if (user.totp_enabled) {
      save({ ...a, stage: { step: 'totp', uid: user.id, at: now } });
      await send('کدِ ۶ رقمیِ دوعاملی (یا کدِ بازیابی) را بفرستید.');
      return;
    }
    return ok(user);
  }
  if (st.step === 'totp') {
    await wipe();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(st.uid));
    if (!user || user.disabled || !user.totp_enabled) return fail('totp');
    if (verifyTotp(user.totp_secret, text)) return ok(user);
    const rec = useRecoveryCode(JSON.parse(user.totp_recovery || '[]'), text);
    if (rec.ok) {
      db.prepare('UPDATE users SET totp_recovery = ? WHERE id = ?').run(JSON.stringify(rec.remaining), user.id);
      return ok(user);
    }
    return fail('totp');
  }
  save({ ...a, stage: null });
  await send('برای ورود ‎/login‎ بزنید.');
}
