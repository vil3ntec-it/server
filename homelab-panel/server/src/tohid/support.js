// ---------------------------------------------------------------------------
//  چت پشتیبانی — یک رشته برای هر نفر
//
//  ── چرا این‌طور و نه «تیکت» ────────────────────────────────────────────
//  تیکت یعنی کاربر باید موضوع بسازد، شماره بگیرد و پیگیری کند. کسی که
//  دکان دارد و وسطِ فروش گیر کرده این کار را نمی‌کند. پس یک رشتهٔ
//  همیشه‌باز: می‌نویسد، جواب می‌گیرد، تمام.
//
//  ── مهمانِ بی‌حساب ─────────────────────────────────────────────────────
//  رشته می‌تواند به شناسهٔ دستگاه بسته باشد، نه فقط به حساب. کسی که هنوز
//  ثبت‌نام نکرده و همان‌جا گیر کرده باید بتواند بپرسد — وگرنه پشتیبانی
//  فقط به دردِ کسی می‌خورد که مشکلی ندارد.
//
//  و اگر بعداً حساب ساخت، همان رشته به حسابش می‌چسبد؛ از اول توضیح
//  نمی‌دهد.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db } from '../db.js';

const MAX_BODY = 4000;
const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

const fail = (message, code) => {
  const e = new Error(message);
  e.code = code;
  return e;
};

export function shapeThread(row) {
  if (!row) return null;
  return {
    id: row.thread_id,
    app: row.app,
    userId: row.account_id || '',
    accountId: row.account_id || '',
    deviceUid: row.device_uid || '',
    who: row.who || '',
    contact: row.contact || '',
    status: row.status,
    unreadAdmin: Number(row.unread_admin) || 0,
    unreadUser: Number(row.unread_user) || 0,
    lastMessage: row.last_message || '',
    lastSender: row.last_sender || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    //  فقط در فهرستِ مدیر پر می‌شوند
    ...(row.account_name !== undefined ? { accountName: row.account_name || '' } : {}),
    ...(row.account_email !== undefined ? { accountEmail: row.account_email || '' } : {}),
    ...(row.shop_name !== undefined ? { shopName: row.shop_name || '' } : {}),
  };
}

export function shapeMessage(row) {
  return {
    id: row.message_id,
    threadId: row.thread_id,
    sender: row.sender,
    senderName: row.sender_name || '',
    body: row.body,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

const rowOf = (threadId) =>
  db.prepare('SELECT * FROM th_support_threads WHERE thread_id = ?').get(threadId) || null;

/**
 * رشتهٔ این نفر را می‌دهد و اگر نبود می‌سازد.
 *
 * کلیدِ شناسایی: اول حساب، بعد دستگاه. مهمانی که بعداً حساب می‌سازد،
 * همان رشتهٔ قبلی‌اش را دارد.
 */
export function threadFor({
  app = 'shop', accountId = '', deviceUid = '', who = '', contact = '',
} = {}) {
  if (!accountId && !deviceUid) {
    throw fail('برای پشتیبانی، شناسهٔ دستگاه یا حساب لازم است', 'identity_required');
  }

  let row = accountId
    ? db.prepare(`
        SELECT * FROM th_support_threads WHERE app = ? AND account_id = ?
         ORDER BY updated_at DESC LIMIT 1
      `).get(app, accountId)
    : null;

  if (!row && deviceUid) {
    row = db.prepare(`
      SELECT * FROM th_support_threads WHERE app = ? AND device_uid = ? AND account_id = ''
       ORDER BY updated_at DESC LIMIT 1
    `).get(app, deviceUid) || null;

    //  مهمانی که حالا حساب دارد: همان رشته به حسابش وصل می‌شود
    if (row && accountId) {
      db.prepare('UPDATE th_support_threads SET account_id = ?, updated_at = ? WHERE thread_id = ?')
        .run(accountId, Date.now(), row.thread_id);
      row = rowOf(row.thread_id);
    }
  }

  if (row) {
    //  نام و راهِ تماس ممکن است از دفعهٔ قبل عوض شده باشد
    if ((who && row.who !== who) || (contact && row.contact !== contact)) {
      db.prepare(`
        UPDATE th_support_threads
           SET who = CASE WHEN ? <> '' THEN ? ELSE who END,
               contact = CASE WHEN ? <> '' THEN ? ELSE contact END
         WHERE thread_id = ?
      `).run(who, who, contact, contact, row.thread_id);
      row = rowOf(row.thread_id);
    }
    return row;
  }

  const now = Date.now();
  const threadId = newId('thr');
  db.prepare(`
    INSERT INTO th_support_threads
      (thread_id, app, account_id, device_uid, who, contact, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?, 'open', ?, ?)
  `).run(threadId, app, accountId || '', deviceUid || '',
    String(who || '').slice(0, 80), String(contact || '').slice(0, 120), now, now);
  return rowOf(threadId);
}

/**
 * پیام تازه.
 *
 * شمارندهٔ خوانده‌نشدهٔ طرفِ مقابل یکی بالا می‌رود — همان چیزی که نقطهٔ
 * قرمز را می‌سازد. رشتهٔ بسته با پیامِ تازه دوباره باز می‌شود.
 */
export function postMessage(threadId, { sender = 'user', senderName = '', body = '', kind = 'text' } = {}) {
  const text = String(body ?? '').trim();
  if (!text) throw fail('پیام خالی است', 'empty_message');
  if (text.length > MAX_BODY) throw fail('پیام خیلی بلند است', 'message_too_long');

  const thread = rowOf(threadId);
  if (!thread) throw fail('این گفت‌وگو پیدا نشد', 'not_found');

  const now = Date.now();
  const messageId = newId('msg');
  db.prepare(`
    INSERT INTO th_support_messages
      (message_id, thread_id, sender, sender_name, body, kind, created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(messageId, threadId, sender, String(senderName || '').slice(0, 80), text, kind, now);

  db.prepare(`
    UPDATE th_support_threads
       SET unread_admin = unread_admin + ?,
           unread_user  = unread_user + ?,
           last_message = ?, last_sender = ?,
           status = CASE WHEN status = 'closed' THEN 'open' ELSE status END,
           updated_at = ?
     WHERE thread_id = ?
  `).run(sender === 'user' ? 1 : 0, sender === 'user' ? 0 : 1,
    text.slice(0, 200), sender, now, threadId);

  return shapeMessage(
    db.prepare('SELECT * FROM th_support_messages WHERE message_id = ?').get(messageId),
  );
}

/** پیام‌های یک رشته. `after` برای گرفتنِ فقط تازه‌ها. */
export function messagesOf(threadId, { after = 0, limit = 200 } = {}) {
  return db.prepare(`
    SELECT * FROM th_support_messages
     WHERE thread_id = ? AND created_at > ?
     ORDER BY created_at ASC LIMIT ?
  `).all(threadId, Number(after) || 0, Number(limit) || 200).map(shapeMessage);
}

/** «خواندم» — از طرفِ کاربر یا از طرفِ مدیر */
export function markRead(threadId, side) {
  const column = side === 'admin' ? 'unread_admin' : 'unread_user';
  db.prepare(`UPDATE th_support_threads SET ${column} = 0 WHERE thread_id = ?`).run(threadId);
}

/**
 * فهرست برای مدیر — خوانده‌نشده‌ها و تازه‌ترین‌ها بالا.
 *
 * نام و ایمیلِ حساب با همین یک کوئری می‌آید؛ صفحه‌ای که برای هر سطر یک
 * کوئریِ جدا بزند، روی صد گفت‌وگو می‌ایستد.
 */
export function listThreads({ status = '', q = '', limit = 100, offset = 0 } = {}) {
  const like = `%${String(q || '').toLowerCase()}%`;
  return db.prepare(`
    SELECT t.*, a.name AS account_name, a.email AS account_email, s.name AS shop_name
      FROM th_support_threads t
      LEFT JOIN th_accounts a ON a.account_id = t.account_id
      LEFT JOIN th_shops s ON s.owner_id = t.account_id
     WHERE (? = '' OR t.status = ?)
       AND (? = '' OR lower(t.who) LIKE ? OR lower(COALESCE(a.name,'')) LIKE ?
            OR lower(COALESCE(a.email,'')) LIKE ? OR lower(t.last_message) LIKE ?)
     ORDER BY (t.unread_admin > 0) DESC, t.updated_at DESC
     LIMIT ? OFFSET ?
  `).all(String(status), String(status), String(q || ''), like, like, like, like,
    Number(limit) || 100, Number(offset) || 0).map(shapeThread);
}

export function setThreadStatus(threadId, status) {
  const row = rowOf(threadId);
  if (!row) throw fail('این گفت‌وگو پیدا نشد', 'not_found');
  db.prepare('UPDATE th_support_threads SET status = ?, updated_at = ? WHERE thread_id = ?')
    .run(status, Date.now(), threadId);
  return shapeThread(rowOf(threadId));
}

/** چند پیامِ خوانده‌نشده در کل — برای نقطهٔ قرمزِ تبِ پشتیبانی */
export function unreadForAdmin() {
  return db.prepare(`
    SELECT COALESCE(SUM(unread_admin), 0) AS n FROM th_support_threads WHERE status <> 'closed'
  `).get().n;
}

/** چند پیامِ خوانده‌نشده برای این کاربر یا دستگاه */
export function unreadForUser({ accountId = '', deviceUid = '' } = {}) {
  const row = accountId
    ? db.prepare(`
        SELECT unread_user AS n FROM th_support_threads WHERE account_id = ?
         ORDER BY updated_at DESC LIMIT 1
      `).get(accountId)
    : db.prepare(`
        SELECT unread_user AS n FROM th_support_threads WHERE device_uid = ?
         ORDER BY updated_at DESC LIMIT 1
      `).get(deviceUid);
  return row ? Number(row.n) || 0 : 0;
}

/**
 * پیام خودکار از طرفِ سامانه — مثلاً «اشتراکت سه روز دیگر تمام می‌شود».
 *
 * در همان رشتهٔ همیشگیِ طرف می‌نشیند تا خبر جای دیگری گم نشود.
 */
export function systemMessage({ app = 'shop', accountId, who = '', body, kind = 'notice' }) {
  const thread = threadFor({ app, accountId, who });
  return postMessage(thread.thread_id, { sender: 'system', senderName: 'توحید', body, kind });
}

export { MAX_BODY };
