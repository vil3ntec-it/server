// ---------------------------------------------------------------------------
//  پیام‌رسان — جدول‌ها و همهٔ دسترسی به دیتابیس
//
//  همه‌چیز روی همین سرور خانگی می‌ماند: هیچ پیامی به سرور کسِ دیگری نمی‌رود.
//  ساختار عمداً ساده و مثل واتساپ است:
//
//      msg_users        هر کاربر با شمارهٔ موبایل
//      msg_devices      دستگاه‌های هر کاربر (برای نوتیفیکیشن)
//      msg_chats        گفت‌وگو: دونفره یا گروهی
//      msg_members      چه کسی در چه گفت‌وگویی است
//      msg_messages     خودِ پیام‌ها
//      msg_receipts     رسیده / خوانده‌شده (تیک‌ها)
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { q, db } from '../db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS msg_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  phone         TEXT NOT NULL UNIQUE,     -- همیشه به شکل بین‌المللی: +93…
  name          TEXT NOT NULL,
  about         TEXT,
  avatar        TEXT,
  password_hash TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

CREATE TABLE IF NOT EXISTS msg_devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES msg_users(id) ON DELETE CASCADE,
  label         TEXT,
  push_endpoint TEXT,                     -- اشتراکِ Web Push
  push_p256dh   TEXT,
  push_auth     TEXT,
  created_at    INTEGER NOT NULL,
  seen_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_msg_devices_user ON msg_devices(user_id);
-- در SQLite چند NULL با هم تداخل ندارند، پس این ایندکس برای دستگاه‌های بدون
-- اشتراکِ پوش هم مشکلی نمی‌سازد — و برخلافِ ایندکسِ شرطی، در ON CONFLICT کار می‌کند.
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_devices_endpoint ON msg_devices(push_endpoint);

CREATE TABLE IF NOT EXISTS msg_chats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'direct',  -- direct | group
  title      TEXT,
  avatar     TEXT,
  created_by INTEGER REFERENCES msg_users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  -- برای گفت‌وگوی دونفره: کلیدِ یکتا از دو شناسه، تا تکراری ساخته نشود
  pair_key   TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS msg_members (
  chat_id   INTEGER NOT NULL REFERENCES msg_chats(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES msg_users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member', -- member | admin
  joined_at INTEGER NOT NULL,
  muted     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS msg_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id    INTEGER NOT NULL REFERENCES msg_chats(id) ON DELETE CASCADE,
  sender_id  INTEGER REFERENCES msg_users(id) ON DELETE SET NULL,
  body       TEXT,
  kind       TEXT NOT NULL DEFAULT 'text',  -- text | image | file | system
  file_name  TEXT,
  file_size  INTEGER,
  reply_to   INTEGER REFERENCES msg_messages(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  edited_at  INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_msg_messages_chat ON msg_messages(chat_id, id DESC);

CREATE TABLE IF NOT EXISTS msg_receipts (
  message_id   INTEGER NOT NULL REFERENCES msg_messages(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES msg_users(id) ON DELETE CASCADE,
  delivered_at INTEGER,
  read_at      INTEGER,
  PRIMARY KEY (message_id, user_id)
);

-- شمردنِ نخوانده‌ها و «چه کسانی در گفت‌وگوهای من هستند» بدونِ این دو ایندکس
-- مجبور بود کلِ جدول را بخواند؛ روی گوشی همان می‌شد چند ثانیه انتظار.
CREATE INDEX IF NOT EXISTS idx_msg_messages_sender ON msg_messages(chat_id, sender_id);
CREATE INDEX IF NOT EXISTS idx_msg_members_user ON msg_members(user_id);
`);

// همهٔ پرس‌وجوهای این فایل از راهِ `q()` می‌روند: هر عبارت فقط یک‌بار کامپایل
// می‌شود و بعد هر بار فقط اجرا. در مسیرهای داغ — «در حال نوشتن…» که با هر حرف
// صدا زده می‌شود، یا فهرستِ گفت‌وگوها که برای هر گفت‌وگو سه پرس‌وجو دارد — همین
// کامپایلِ تکراری بیشتر از خودِ پرس‌وجو وقت می‌گرفت.

// --------------------------------- کاربران ---------------------------------
/** شماره را به یک شکلِ واحد در می‌آورد تا «۰۷۰۰…» و «+93700…» یکی حساب شوند */
export function normalizePhone(input, defaultCountry = '+93') {
  let raw = String(input || '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\d+]/g, '');
  if (!raw) return null;

  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`;
  else if (raw.startsWith('0')) raw = `${defaultCountry}${raw.slice(1)}`;
  else if (!raw.startsWith('+')) raw = `${defaultCountry}${raw}`;

  return /^\+\d{8,15}$/.test(raw) ? raw : null;
}

const hash = (password, salt) =>
  crypto.scryptSync(String(password), salt, 32).toString('hex');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${hash(password, salt)}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = hash(password, salt);
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function findUserByPhone(phone) {
  return q('SELECT * FROM msg_users WHERE phone = ?').get(String(phone));
}

export function getUser(id) {
  return q('SELECT * FROM msg_users WHERE id = ?').get(Number(id));
}

export function createUser({ phone, name, password }) {
  const now = Date.now();
  q(
    'INSERT INTO msg_users(phone, name, password_hash, created_at, last_seen_at) VALUES(?, ?, ?, ?, ?)'
  ).run(phone, name, password ? hashPassword(password) : null, now, now);
  return findUserByPhone(phone);
}

export function touchUser(id) {
  q('UPDATE msg_users SET last_seen_at = ? WHERE id = ?').run(Date.now(), Number(id));
}

export function updateUser(id, { name, about }) {
  const fields = [];
  const values = [];
  if (typeof name === 'string' && name.trim()) {
    fields.push('name = ?');
    values.push(name.trim().slice(0, 60));
  }
  if (typeof about === 'string') {
    fields.push('about = ?');
    values.push(about.trim().slice(0, 200) || null);
  }
  if (!fields.length) return getUser(id);
  values.push(Number(id));
  q(`UPDATE msg_users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getUser(id);
}

export const publicUser = (u) =>
  u && {
    id: u.id,
    phone: u.phone,
    name: u.name,
    about: u.about ?? null,
    lastSeenAt: u.last_seen_at ?? null,
  };

/** کدام‌یک از این شماره‌ها در پیام‌رسان حساب دارند — همان «مخاطبین» واتساپ */
export function findUsersByPhones(phones) {
  const clean = [...new Set(phones.map((p) => normalizePhone(p)).filter(Boolean))];
  if (!clean.length) return [];
  const marks = clean.map(() => '?').join(',');
  return q(`SELECT * FROM msg_users WHERE phone IN (${marks})`).all(...clean);
}

// -------------------------------- گفت‌وگوها --------------------------------
const pairKey = (a, b) => [Number(a), Number(b)].sort((x, y) => x - y).join(':');

/** گفت‌وگوی دونفره را پیدا می‌کند یا می‌سازد — هرگز دوتا ساخته نمی‌شود */
export function directChat(userA, userB) {
  const key = pairKey(userA, userB);
  const found = q('SELECT * FROM msg_chats WHERE pair_key = ?').get(key);
  if (found) return found;

  const now = Date.now();
  q('INSERT INTO msg_chats(kind, created_by, created_at, pair_key) VALUES(?, ?, ?, ?)').run(
    'direct',
    Number(userA),
    now,
    key
  );
  const chat = q('SELECT * FROM msg_chats WHERE pair_key = ?').get(key);
  const addMember = q('INSERT OR IGNORE INTO msg_members(chat_id, user_id, joined_at) VALUES(?, ?, ?)');
  addMember.run(chat.id, Number(userA), now);
  addMember.run(chat.id, Number(userB), now);
  return chat;
}

export function createGroup({ title, createdBy, memberIds }) {
  const now = Date.now();
  q('INSERT INTO msg_chats(kind, title, created_by, created_at) VALUES(?, ?, ?, ?)').run(
    'group',
    String(title || '').trim().slice(0, 80) || 'گروه',
    Number(createdBy),
    now
  );
  const chat = q('SELECT * FROM msg_chats WHERE id = last_insert_rowid()').get();
  const addMember = q(
    'INSERT OR IGNORE INTO msg_members(chat_id, user_id, role, joined_at) VALUES(?, ?, ?, ?)'
  );
  addMember.run(chat.id, Number(createdBy), 'admin', now);
  for (const id of new Set(memberIds || [])) {
    if (Number(id) !== Number(createdBy)) addMember.run(chat.id, Number(id), 'member', now);
  }
  return chat;
}

export function getChat(id) {
  return q('SELECT * FROM msg_chats WHERE id = ?').get(Number(id));
}

export function isMember(chatId, userId) {
  return Boolean(
    q('SELECT 1 FROM msg_members WHERE chat_id = ? AND user_id = ?').get(Number(chatId), Number(userId))
  );
}

export function chatMembers(chatId) {
  return q(
      `SELECT u.*, m.role, m.muted FROM msg_members m
         JOIN msg_users u ON u.id = m.user_id
        WHERE m.chat_id = ?`
    )
    .all(Number(chatId));
}

/**
 * فقط شناسهٔ اعضا — بدون JOIN و بدون کشیدنِ کلِ ردیفِ کاربر.
 * «در حال نوشتن…» و تیکِ آبی با هر حرف صدا زده می‌شوند؛ آنجا به نام و عکس و
 * بقیهٔ ستون‌ها نیازی نیست.
 */
export function chatMemberIds(chatId) {
  return q('SELECT user_id FROM msg_members WHERE chat_id = ?').all(Number(chatId)).map((r) => r.user_id);
}

/** هرکسی که با این کاربر در یک گفت‌وگوست — برای خبرِ آنلاین/آفلاین */
export function peerIds(userId) {
  return q(
    `SELECT DISTINCT other.user_id FROM msg_members mine
       JOIN msg_members other ON other.chat_id = mine.chat_id
      WHERE mine.user_id = ? AND other.user_id <> ?`
  )
    .all(Number(userId), Number(userId))
    .map((r) => r.user_id);
}

export function addMembers(chatId, memberIds) {
  const now = Date.now();
  const stmt = q('INSERT OR IGNORE INTO msg_members(chat_id, user_id, joined_at) VALUES(?, ?, ?)');
  for (const id of new Set(memberIds || [])) stmt.run(Number(chatId), Number(id), now);
  return chatMembers(chatId);
}

export function leaveChat(chatId, userId) {
  q('DELETE FROM msg_members WHERE chat_id = ? AND user_id = ?').run(Number(chatId), Number(userId));
}

/** فهرست گفت‌وگوهای یک کاربر با آخرین پیام و تعداد نخوانده — همان صفحهٔ اولِ واتساپ */
export function listChats(userId) {
  const rows = q(
      `SELECT c.* FROM msg_chats c
         JOIN msg_members m ON m.chat_id = c.id
        WHERE m.user_id = ?`
    )
    .all(Number(userId));

  const out = rows.map((chat) => {
    const last = q('SELECT * FROM msg_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
      .get(chat.id);
    const unread = q(
        `SELECT COUNT(*) AS n FROM msg_messages m
          WHERE m.chat_id = ? AND m.sender_id <> ?
            AND NOT EXISTS (
              SELECT 1 FROM msg_receipts r
               WHERE r.message_id = m.id AND r.user_id = ? AND r.read_at IS NOT NULL)`
      )
      .get(chat.id, Number(userId), Number(userId)).n;

    const members = chatMembers(chat.id).map(publicUser);
    const other = chat.kind === 'direct' ? members.find((m) => m.id !== Number(userId)) : null;

    return {
      id: chat.id,
      kind: chat.kind,
      title: chat.kind === 'direct' ? other?.name ?? '—' : chat.title,
      peer: other ?? null,
      members,
      unread,
      lastMessage: last ? publicMessage(last) : null,
      updatedAt: last?.created_at ?? chat.created_at,
    };
  });

  return out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

// --------------------------------- پیام‌ها ---------------------------------
export const publicMessage = (m) =>
  m && {
    id: m.id,
    chatId: m.chat_id,
    senderId: m.sender_id,
    body: m.deleted_at ? null : m.body,
    kind: m.kind,
    fileName: m.file_name ?? null,
    fileSize: m.file_size ?? null,
    replyTo: m.reply_to ?? null,
    createdAt: m.created_at,
    editedAt: m.edited_at ?? null,
    deleted: Boolean(m.deleted_at),
  };

export function addMessage({ chatId, senderId, body, kind = 'text', fileName, fileSize, replyTo }) {
  const now = Date.now();
  q(
    `INSERT INTO msg_messages(chat_id, sender_id, body, kind, file_name, file_size, reply_to, created_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    Number(chatId),
    Number(senderId),
    body ?? null,
    kind,
    fileName ?? null,
    fileSize ?? null,
    replyTo ? Number(replyTo) : null,
    now
  );
  return q('SELECT * FROM msg_messages WHERE id = last_insert_rowid()').get();
}

export function getMessage(id) {
  return q('SELECT * FROM msg_messages WHERE id = ?').get(Number(id));
}

export function history(chatId, { before = null, limit = 50 } = {}) {
  const rows = before
    ? q('SELECT * FROM msg_messages WHERE chat_id = ? AND id < ? ORDER BY id DESC LIMIT ?')
      .all(Number(chatId), Number(before), Math.min(200, Number(limit) || 50))
    : q('SELECT * FROM msg_messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?')
      .all(Number(chatId), Math.min(200, Number(limit) || 50));
  return rows.reverse().map(publicMessage);
}

export function editMessage(id, senderId, body) {
  const m = getMessage(id);
  if (!m || m.sender_id !== Number(senderId) || m.deleted_at) return null;
  q('UPDATE msg_messages SET body = ?, edited_at = ? WHERE id = ?').run(String(body), Date.now(), Number(id));
  return getMessage(id);
}

export function deleteMessage(id, senderId) {
  const m = getMessage(id);
  if (!m || m.sender_id !== Number(senderId)) return null;
  q('UPDATE msg_messages SET deleted_at = ?, body = NULL WHERE id = ?').run(Date.now(), Number(id));
  return getMessage(id);
}

// ---------------------------- تیک‌ها (رسید/خوانده) --------------------------
export function markDelivered(messageId, userId) {
  q(
    `INSERT INTO msg_receipts(message_id, user_id, delivered_at) VALUES(?, ?, ?)
     ON CONFLICT(message_id, user_id) DO UPDATE SET delivered_at = COALESCE(delivered_at, excluded.delivered_at)`
  ).run(Number(messageId), Number(userId), Date.now());
}

/**
 * همهٔ پیام‌های این گفت‌وگو تا این شناسه، خوانده شدند.
 *
 * قبلاً شناسهٔ *همهٔ* پیام‌ها خوانده می‌شد و برای هرکدام یک INSERT جدا می‌رفت —
 * هر کدام هم یک تراکنشِ مستقل. باز کردنِ یک گفت‌وگوی چندهزار پیامی یعنی چند هزار
 * نوشتن روی دیسک و چند ثانیه قفلِ کامل. حالا یک عبارتِ SQL همه را با هم می‌نویسد،
 * و فقط آن‌هایی را که هنوز خوانده‌نشده‌اند.
 */
export function markRead(chatId, userId, upToId = null) {
  const now = Date.now();
  const sql =
    `INSERT INTO msg_receipts(message_id, user_id, delivered_at, read_at)
     SELECT m.id, ?, ?, ? FROM msg_messages m
      WHERE m.chat_id = ? AND m.sender_id <> ?` +
    (upToId ? ' AND m.id <= ?' : '') +
    `\n     ON CONFLICT(message_id, user_id) DO UPDATE SET
       delivered_at = COALESCE(delivered_at, excluded.delivered_at),
       read_at      = COALESCE(read_at, excluded.read_at)
     WHERE msg_receipts.read_at IS NULL`;

  const args = [Number(userId), now, now, Number(chatId), Number(userId)];
  if (upToId) args.push(Number(upToId));
  return q(sql).run(...args).changes ?? 0;
}

/** وضعیت تیک برای فرستنده: به چند نفر رسیده و چند نفر خوانده‌اند */
export function receiptSummary(messageId) {
  const row = q(
      `SELECT COUNT(delivered_at) AS delivered, COUNT(read_at) AS read
         FROM msg_receipts WHERE message_id = ?`
    )
    .get(Number(messageId));
  return { delivered: row?.delivered ?? 0, read: row?.read ?? 0 };
}

// -------------------------------- دستگاه‌ها --------------------------------
export function saveDevice(userId, { label, endpoint, p256dh, auth }) {
  const now = Date.now();
  if (endpoint) {
    q(
      `INSERT INTO msg_devices(user_id, label, push_endpoint, push_p256dh, push_auth, created_at, seen_at)
       VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(push_endpoint) DO UPDATE SET
         user_id = excluded.user_id, push_p256dh = excluded.push_p256dh,
         push_auth = excluded.push_auth, seen_at = excluded.seen_at`
    ).run(Number(userId), label ?? null, endpoint, p256dh ?? null, auth ?? null, now, now);
  }
  return q('SELECT * FROM msg_devices WHERE user_id = ?').all(Number(userId));
}

export function removeDevice(endpoint) {
  q('DELETE FROM msg_devices WHERE push_endpoint = ?').run(String(endpoint));
}

export function devicesFor(userIds) {
  const ids = [...new Set((userIds || []).map(Number))].filter(Boolean);
  if (!ids.length) return [];
  const marks = ids.map(() => '?').join(',');
  return q(`SELECT * FROM msg_devices WHERE user_id IN (${marks}) AND push_endpoint IS NOT NULL`)
    .all(...ids);
}
