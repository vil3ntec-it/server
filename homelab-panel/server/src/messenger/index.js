// ---------------------------------------------------------------------------
//  پیام‌رسان — قلبِ کار
//
//  دو راهِ رساندنِ پیام، دقیقاً مثل واتساپ:
//    ۱) اگر طرف برنامه را باز دارد → از راه WebSocket، فوری
//    ۲) اگر برنامه بسته است       → نوتیفیکیشن Web Push
//
//  پیام در هر دو حالت روی همین سرور ذخیره می‌شود، پس هر وقت برنامه را باز کند
//  همه‌چیز سرِ جایش است — حتی اگر گوشی‌اش خاموش بوده باشد.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { config } from '../config.js';
import { logEvent, getSetting, setSetting } from '../db.js';
import * as store from './store.js';
import { pushToDevices, vapidPublicKey } from './push.js';

// userId → مجموعهٔ اتصال‌های باز (یک نفر می‌تواند چند دستگاه داشته باشد)
const online = new Map();

// ------------------------------- نشست‌ها -----------------------------------
function secret() {
  let s = getSetting('messenger_secret', null);
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('messenger_secret', s);
  }
  return s;
}

const sign = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

/** توکنِ ساده و امضاشده — بدون وابستگی بیرونی */
export function issueToken(userId, days = 180) {
  const body = Buffer.from(JSON.stringify({ u: Number(userId), e: Date.now() + days * 86400000 })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readToken(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = sign(body);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data?.u || !data?.e || data.e < Date.now()) return null;
    return store.getUser(data.u) || null;
  } catch {
    return null;
  }
}

// ------------------------------ ثبت‌نام/ورود -------------------------------
/**
 * ثبت‌نام یا ورود با شمارهٔ موبایل.
 * چون سرور خانگی راهی برای فرستادنِ پیامک ندارد، کدِ تایید در خودِ پنل دیده
 * می‌شود (بخش لاگ‌ها) — صاحبِ سرور کد را به کاربر می‌دهد. اگر رمز گذاشته باشد،
 * دفعه‌های بعد با همان رمز وارد می‌شود.
 */
const codes = new Map(); // phone → { code, at, tries }

/** کدهای منتظرِ تایید — فقط صاحبِ سرور در پنل می‌بیندشان */
export function pendingCodes() {
  const now = Date.now();
  return [...codes.entries()]
    .filter(([, v]) => now - v.at < 600000)
    .map(([phone, v]) => ({
      phone,
      code: v.code,
      requestedAt: v.at,
      expiresAt: v.at + 600000,
      isNewUser: !store.findUserByPhone(phone),
    }));
}

export function requestCode(phoneInput) {
  const phone = store.normalizePhone(phoneInput);
  if (!phone) return { ok: false, error: 'invalid_phone' };

  const code = String(crypto.randomInt(100000, 999999));
  codes.set(phone, { code, at: Date.now(), tries: 0 });
  logEvent('warn', 'panel', `کد ورودِ پیام‌رسان برای ${phone}: ${code}`);
  return { ok: true, phone, expiresInSeconds: 600 };
}

export function verifyCode({ phone: phoneInput, code, name, password }) {
  const phone = store.normalizePhone(phoneInput);
  if (!phone) return { ok: false, error: 'invalid_phone' };

  const entry = codes.get(phone);
  if (!entry) return { ok: false, error: 'no_code' };
  if (Date.now() - entry.at > 600000) {
    codes.delete(phone);
    return { ok: false, error: 'code_expired' };
  }
  if (++entry.tries > 5) {
    codes.delete(phone);
    return { ok: false, error: 'too_many_tries' };
  }
  if (String(code) !== entry.code) return { ok: false, error: 'wrong_code' };

  codes.delete(phone);
  let user = store.findUserByPhone(phone);
  if (!user) user = store.createUser({ phone, name: name || phone, password });
  store.touchUser(user.id);
  return { ok: true, token: issueToken(user.id), user: store.publicUser(user) };
}

export function loginWithPassword({ phone: phoneInput, password }) {
  const phone = store.normalizePhone(phoneInput);
  if (!phone) return { ok: false, error: 'invalid_phone' };
  const user = store.findUserByPhone(phone);
  if (!user || !user.password_hash || !store.verifyPassword(password, user.password_hash)) {
    return { ok: false, error: 'wrong_credentials' };
  }
  store.touchUser(user.id);
  return { ok: true, token: issueToken(user.id), user: store.publicUser(user) };
}

// ------------------------------- رساندنِ پیام ------------------------------
function deliverLive(userId, event) {
  const sockets = online.get(Number(userId));
  if (!sockets?.size) return false;
  const data = JSON.stringify(event);
  let delivered = false;
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(data);
        delivered = true;
      } catch { /* همین یکی بسته شد */ }
    }
  }
  return delivered;
}

export const isOnline = (userId) => Boolean(online.get(Number(userId))?.size);

/**
 * پیام تازه: ذخیره، پخشِ زنده، و نوتیفیکیشن برای هر کسی که آنلاین نیست.
 */
export async function sendMessage({ chatId, senderId, body, kind, fileName, fileSize, replyTo }) {
  if (!store.isMember(chatId, senderId)) return { ok: false, error: 'not_a_member' };

  const row = store.addMessage({ chatId, senderId, body, kind, fileName, fileSize, replyTo });
  const message = store.publicMessage(row);
  const sender = store.publicUser(store.getUser(senderId));
  const members = store.chatMembers(chatId);

  const offline = [];
  for (const m of members) {
    if (m.id === Number(senderId)) continue;
    if (deliverLive(m.id, { op: 'message', message, sender })) {
      store.markDelivered(row.id, m.id); // رسید، ولی هنوز خوانده نشده
    } else {
      offline.push(m);
    }
  }
  deliverLive(senderId, { op: 'message', message, sender, own: true });

  // برنامه‌بسته‌ها: نوتیفیکیشن
  let push = { sent: 0, total: 0 };
  const wantPush = offline.filter((m) => !m.muted);
  if (wantPush.length) {
    const devices = store.devicesFor(wantPush.map((m) => m.id));
    const chat = store.getChat(chatId);
    push = await pushToDevices(devices, {
      title: chat?.kind === 'group' ? `${sender.name} — ${chat.title}` : sender.name,
      body: row.kind === 'text' ? String(row.body || '').slice(0, 140) : '📎 پیوست',
      chatId: Number(chatId),
      messageId: row.id,
      tag: `chat-${chatId}`,
    });
  }

  return { ok: true, message, push };
}

export function readChat(chatId, userId, upToId = null) {
  if (!store.isMember(chatId, userId)) return { ok: false, error: 'not_a_member' };
  const n = store.markRead(chatId, userId, upToId);
  // به بقیه بگو تیک آبی شد
  for (const m of store.chatMembers(chatId)) {
    if (m.id !== Number(userId)) deliverLive(m.id, { op: 'read', chatId: Number(chatId), by: Number(userId), upToId });
  }
  return { ok: true, marked: n };
}

export function typing(chatId, userId, isTyping) {
  if (!store.isMember(chatId, userId)) return;
  for (const m of store.chatMembers(chatId)) {
    if (m.id !== Number(userId)) {
      deliverLive(m.id, { op: 'typing', chatId: Number(chatId), userId: Number(userId), typing: Boolean(isTyping) });
    }
  }
}

function announcePresence(userId, isOnlineNow) {
  // فقط به کسانی که با او گفت‌وگو دارند
  for (const chat of store.listChats(userId)) {
    for (const m of chat.members) {
      if (m.id !== Number(userId)) {
        deliverLive(m.id, { op: 'presence', userId: Number(userId), online: isOnlineNow, at: Date.now() });
      }
    }
  }
}

// -------------------------------- WebSocket --------------------------------
// سقف را از تنظیمات می‌گیرد تا پیام‌های بلند و پیوست‌ها بدون محدودیت برسند
const wss = new WebSocketServer({ noServer: true, maxPayload: config.messengerMaxBytes });

export function handleUpgrade(req, socket, head) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    let token = null;
    try {
      token = new URL(req.url, 'http://x').searchParams.get('token');
    } catch { /* مسیر خراب */ }

    const user = readToken(token);
    if (!user) {
      try {
        ws.send(JSON.stringify({ op: 'error', msg: 'unauthorized' }));
        ws.close();
      } catch { /* بسته شد */ }
      return;
    }

    if (!online.has(user.id)) online.set(user.id, new Set());
    online.get(user.id).add(ws);
    store.touchUser(user.id);
    if (online.get(user.id).size === 1) announcePresence(user.id, true);

    ws.send(JSON.stringify({ op: 'ready', user: store.publicUser(user), chats: store.listChats(user.id) }));

    ws.on('message', async (raw) => {
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!m || typeof m !== 'object') return;

      try {
        if (m.op === 'send') {
          const res = await sendMessage({ ...m, senderId: user.id });
          ws.send(JSON.stringify({ op: 'ack', id: m.id, ...res }));
        } else if (m.op === 'read') {
          readChat(m.chatId, user.id, m.upToId);
        } else if (m.op === 'typing') {
          typing(m.chatId, user.id, m.typing);
        } else if (m.op === 'chats') {
          ws.send(JSON.stringify({ op: 'chats', chats: store.listChats(user.id) }));
        } else if (m.op === 'history') {
          if (store.isMember(m.chatId, user.id)) {
            ws.send(
              JSON.stringify({
                op: 'history',
                chatId: m.chatId,
                messages: store.history(m.chatId, { before: m.before, limit: m.limit }),
              })
            );
          }
        } else if (m.op === 'ping') {
          ws.send(JSON.stringify({ op: 'pong' }));
        }
      } catch (e) {
        logEvent('error', 'panel', `پیام‌رسان: ${e.message}`);
      }
    });

    ws.on('close', () => {
      const set = online.get(user.id);
      set?.delete(ws);
      if (set && !set.size) {
        online.delete(user.id);
        store.touchUser(user.id);
        announcePresence(user.id, false);
      }
    });
    ws.on('error', () => {});
  });
}

export function snapshot() {
  return {
    onlineUsers: online.size,
    connections: [...online.values()].reduce((n, s) => n + s.size, 0),
    vapidPublicKey: vapidPublicKey(),
  };
}

export { store };
