// ---------------------------------------------------------------------------
//  سرویسِ اعلان — همان کاری که ntfy می‌کند، ولی روی سرور خانگیِ خودتان
//
//  هر برنامه‌ای که بتواند یک درخواست ساده بزند، می‌تواند خبر بدهد:
//
//      curl -d "تیل مخزن ۲ کم شد" https://<آدرس شما>/api/notify/pump
//
//  و آن خبر روی برنامهٔ تانک‌تیل یعقوبی ظاهر می‌شود — حتی وقتی برنامه بسته
//  یا گوشی قفل است.
//
//  «موضوع» (topic) جای حساب کاربری را می‌گیرد: هر کس نام موضوع را داشته باشد
//  دنبالش می‌کند. ثبت‌نام لازم نیست. اگر موضوعی خصوصی باشد، رمزِ نوشتن دارد.
//
//  برخلافِ نسخهٔ رایگانِ ntfy: نه سقفِ روزانه، نه اولویتِ پولی، و پیام‌ها روی
//  سرور کسِ دیگری نمی‌نشیند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocketServer } from 'ws';
import { db, q, logEvent, getSetting, setSetting } from '../db.js';
import { pushToDevices, vapidPublicKey } from '../messenger/push.js';

export const notifyEvents = new EventEmitter();

db.exec(`
CREATE TABLE IF NOT EXISTS ntf_topics (
  name        TEXT PRIMARY KEY,          -- مثل pump یا tank-2
  title       TEXT,
  write_token TEXT,                      -- اگر باشد، فقط با آن می‌شود پیام داد
  created_at  INTEGER NOT NULL,
  last_at     INTEGER
);

CREATE TABLE IF NOT EXISTS ntf_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic      TEXT NOT NULL,
  title      TEXT,
  body       TEXT NOT NULL,
  priority   INTEGER NOT NULL DEFAULT 3, -- ۱ کم‌ترین … ۵ فوری
  tags       TEXT,                       -- با کاما
  click      TEXT,                       -- لینکی که با زدنِ اعلان باز می‌شود
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ntf_messages ON ntf_messages(topic, id DESC);

CREATE TABLE IF NOT EXISTS ntf_devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  topic         TEXT NOT NULL,
  label         TEXT,
  push_endpoint TEXT NOT NULL,
  push_p256dh   TEXT,
  push_auth     TEXT,
  created_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ntf_devices ON ntf_devices(topic, push_endpoint);
`);

/* ── رمزِ خواندن (بعداً اضافه شد) ──────────────────────────────────────────
   تا پیش از این، هر کس نامِ موضوع را می‌دانست می‌توانست به آن وصل شود و همهٔ
   پیام‌ها را بخواند — یعنی «موضوع» فقط یک نام بود، نه یک در با قفل.
   حالا هر موضوع می‌تواند رمزِ خواندن داشته باشد. اگر نداشته باشد، دقیقاً مثل
   قبل باز است (پس هیچ دستگاهی با این تغییر اعلانش را از دست نمی‌دهد) و هر
   وقت صاحبِ سرور از پنل رمز بگذارد، از همان لحظه قفل می‌شود. */
try {
  const cols = q('PRAGMA table_info(ntf_topics)').all().map((c) => c.name);
  if (!cols.includes('read_token')) db.exec('ALTER TABLE ntf_topics ADD COLUMN read_token TEXT');
} catch { /* ستون از قبل هست */ }

/** نام موضوع: ساده، بدون فاصله، تا در آدرس هم بنشیند */
export function cleanTopic(value) {
  const t = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return t || null;
}

export function ensureTopic(name, { title = null } = {}) {
  const topic = cleanTopic(name);
  if (!topic) return null;
  const found = q('SELECT * FROM ntf_topics WHERE name = ?').get(topic);
  if (found) return found;
  q('INSERT INTO ntf_topics(name, title, created_at) VALUES(?, ?, ?)').run(topic, title, Date.now());
  return q('SELECT * FROM ntf_topics WHERE name = ?').get(topic);
}

export function getTopic(name) {
  const topic = cleanTopic(name);
  return topic ? q('SELECT * FROM ntf_topics WHERE name = ?').get(topic) : null;
}

export function listTopics() {
  return q(
      `SELECT t.*,
              (SELECT COUNT(*) FROM ntf_messages m WHERE m.topic = t.name) AS messages,
              (SELECT COUNT(*) FROM ntf_devices d WHERE d.topic = t.name)  AS devices
         FROM ntf_topics t ORDER BY COALESCE(t.last_at, t.created_at) DESC`
    )
    .all()
    .map((t) => ({
      name: t.name,
      title: t.title,
      hasToken: Boolean(t.write_token),
      hasReadToken: Boolean(t.read_token),
      messages: t.messages,
      devices: t.devices,
      createdAt: t.created_at,
      lastAt: t.last_at,
    }));
}

/** رمزِ نوشتن — تا هر کسی نتواند روی موضوع شما پیام بگذارد */
export function setWriteToken(name, token) {
  const topic = ensureTopic(name);
  if (!topic) return { ok: false, error: 'invalid_topic' };
  const value = token === null || token === '' ? null : String(token);
  q('UPDATE ntf_topics SET write_token = ? WHERE name = ?').run(value, topic.name);
  return { ok: true, hasToken: Boolean(value) };
}

export function newWriteToken(name) {
  const token = crypto.randomBytes(12).toString('base64url');
  const res = setWriteToken(name, token);
  return res.ok ? { ok: true, token } : res;
}

/** مقایسهٔ رمز بدون نشت دادنِ زمان — طولِ نابرابر خودش یعنی نادرست */
function tokenOk(want, provided) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(want));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function mayWrite(topicRow, provided) {
  if (!topicRow?.write_token) return true; // موضوع باز است
  return tokenOk(topicRow.write_token, provided);
}

/* یک «رمزِ خواندنِ همگانی» هم هست که روی همهٔ موضوع‌ها کار می‌کند. در عمل همین
   راحت‌تر است: صاحبِ سرور یک بار رمز می‌سازد و همان را در برنامه می‌گذارد، به‌جای
   اینکه برای mirza و staff و تک‌تکِ مشتری‌ها رمزِ جدا نگه دارد. رمزِ خودِ موضوع
   (اگر باشد) مقدم است. */
export const readKeyAll = () => getSetting('notify_read_key', '') || '';

export function setReadKeyAll(value) {
  setSetting('notify_read_key', value == null ? '' : String(value));
  return { ok: true, hasKey: Boolean(value) };
}

export function newReadKeyAll() {
  const key = crypto.randomBytes(15).toString('base64url');
  setReadKeyAll(key);
  return { ok: true, key };
}

/** خواندنِ پیام‌ها و ثبتِ دستگاه — اگر هیچ رمزی تنظیم نشده باشد، باز است */
export function mayRead(name, provided) {
  const row = getTopic(name);
  const want = row?.read_token || readKeyAll();
  if (!want) return true;
  return tokenOk(want, provided);
}

export function setReadToken(name, token) {
  const topic = ensureTopic(name);
  if (!topic) return { ok: false, error: 'invalid_topic' };
  const value = token === null || token === '' ? null : String(token);
  q('UPDATE ntf_topics SET read_token = ? WHERE name = ?').run(value, topic.name);
  return { ok: true, hasReadToken: Boolean(value) };
}

export function newReadToken(name) {
  const token = crypto.randomBytes(12).toString('base64url');
  const res = setReadToken(name, token);
  return res.ok ? { ok: true, token } : res;
}

// ------------------------------ دنبال‌کننده‌ها ------------------------------
/** topic → مجموعهٔ اتصال‌های باز */
const listeners = new Map();

function fanout(topic, event) {
  const set = listeners.get(topic);
  if (!set?.size) return 0;
  const data = JSON.stringify(event);
  let n = 0;
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(data);
        n++;
      } catch { /* همین یکی بسته شد */ }
    }
  }
  return n;
}

export const listenerCount = (topic) => listeners.get(cleanTopic(topic))?.size ?? 0;

/** چند دستگاه روی این موضوع ثبت‌نامِ نوتیفیکیشن دارند — یعنی «عضوِ» گروه‌اند،
    چه همین لحظه باز باشند چه نه (برخلافِ listenerCount که فقط اتصالِ زنده را می‌شمارد) */
export function deviceCount(name) {
  const topic = cleanTopic(name);
  if (!topic) return 0;
  const row = q('SELECT COUNT(*) AS n FROM ntf_devices WHERE topic = ?').get(topic);
  return row ? row.n : 0;
}

// -------------------------------- انتشار ----------------------------------
const RETAIN_DEFAULT = 500;
// چند پیامِ اضافه‌تر از سقف تحمل می‌کنیم تا پاک‌سازی هر بار اجرا نشود
const RETAIN_SLACK = 50;
/** موضوع → تعدادِ پیامی که همین حالا دارد (تخمینِ به‌روز، نه شمارشِ هر بار) */
const retained = new Map();

/**
 * یک اعلان می‌فرستد: ذخیره، پخشِ زنده، و نوتیفیکیشن برای دستگاه‌های ثبت‌شده.
 * همین یک تابع پشتِ همهٔ راه‌های فرستادن است.
 */
export async function publish(name, { title, body, priority, tags, click, token } = {}) {
  const topicRow = ensureTopic(name);
  if (!topicRow) return { ok: false, error: 'invalid_topic' };
  if (!mayWrite(topicRow, token)) return { ok: false, error: 'forbidden' };

  const text = String(body ?? '').trim();
  if (!text) return { ok: false, error: 'empty_message' };

  const now = Date.now();
  const prio = Math.min(5, Math.max(1, Number(priority) || 3));
  const tagList = Array.isArray(tags) ? tags.join(',') : tags ? String(tags) : null;

  q(
    'INSERT INTO ntf_messages(topic, title, body, priority, tags, click, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)'
  ).run(topicRow.name, title ? String(title).slice(0, 120) : null, text, prio, tagList, click || null, now);
  const row = q('SELECT * FROM ntf_messages WHERE id = last_insert_rowid()').get();
  q('UPDATE ntf_topics SET last_at = ? WHERE name = ?').run(now, topicRow.name);

  // پیام‌های خیلی قدیمی پاک می‌شوند تا دیسک پر نشود.
  // این پاک‌سازی با *هر* اعلان اجرا می‌شد؛ یعنی برای هر خبرِ کوچک، یک‌بار
  // شمردن و مرتب کردنِ کلِ پیام‌های آن موضوع. حالا فقط وقتی واقعاً از سقف
  // گذشته‌ایم اجرا می‌شود — نتیجه یکی است، کارِ بی‌جهت نه.
  const keep = Number(getSetting('notify_retain', RETAIN_DEFAULT)) || RETAIN_DEFAULT;
  const kept = (retained.get(topicRow.name) ?? Infinity) + 1;
  if (kept > keep + RETAIN_SLACK) {
    q(
      `DELETE FROM ntf_messages WHERE topic = ? AND id NOT IN
         (SELECT id FROM ntf_messages WHERE topic = ? ORDER BY id DESC LIMIT ?)`
    ).run(topicRow.name, topicRow.name, keep);
    retained.set(topicRow.name, q('SELECT COUNT(*) AS n FROM ntf_messages WHERE topic = ?').get(topicRow.name).n);
  } else {
    retained.set(topicRow.name, kept);
  }

  const message = publicMessage(row);
  const live = fanout(topicRow.name, { op: 'message', ...message });
  notifyEvents.emit('message', message);

  // دستگاه‌هایی که برنامه‌شان بسته است — نوتیفیکیشن
  const devices = q('SELECT * FROM ntf_devices WHERE topic = ?')
    .all(topicRow.name)
    .map((d) => ({ push_endpoint: d.push_endpoint, push_p256dh: d.push_p256dh, push_auth: d.push_auth }));

  const push = devices.length
    ? await pushToDevices(devices, {
      title: message.title || topicRow.title || topicRow.name,
      body: message.body.slice(0, 160),
      tag: `notify-${topicRow.name}`,
      url: message.click || './',
      chatId: null,
    })
    : { sent: 0, total: 0 };

  logEvent('info', 'panel', `اعلان روی «${topicRow.name}»: ${text.slice(0, 60)}`);
  return { ok: true, message, live, push };
}

export const publicMessage = (m) =>
  m && {
    id: m.id,
    topic: m.topic,
    title: m.title,
    body: m.body,
    priority: m.priority,
    tags: m.tags ? m.tags.split(',').filter(Boolean) : [],
    click: m.click,
    createdAt: m.created_at,
  };

export function history(name, { since = null, limit = 100 } = {}) {
  const topic = cleanTopic(name);
  if (!topic) return [];
  const rows = since
    ? q('SELECT * FROM ntf_messages WHERE topic = ? AND id > ? ORDER BY id DESC LIMIT ?')
      .all(topic, Number(since), Math.min(500, Number(limit) || 100))
    : q('SELECT * FROM ntf_messages WHERE topic = ? ORDER BY id DESC LIMIT ?')
      .all(topic, Math.min(500, Number(limit) || 100));
  return rows.reverse().map(publicMessage);
}

// -------------------------------- دستگاه‌ها --------------------------------
export function subscribeDevice(name, { label, endpoint, p256dh, auth }) {
  const topicRow = ensureTopic(name);
  if (!topicRow || !endpoint) return { ok: false, error: 'invalid' };
  q(
    `INSERT INTO ntf_devices(topic, label, push_endpoint, push_p256dh, push_auth, created_at)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(topic, push_endpoint) DO UPDATE SET
       push_p256dh = excluded.push_p256dh, push_auth = excluded.push_auth, label = excluded.label`
  ).run(topicRow.name, label ?? null, endpoint, p256dh ?? null, auth ?? null, Date.now());
  return { ok: true, topic: topicRow.name };
}

export function unsubscribeDevice(name, endpoint) {
  const topic = cleanTopic(name);
  if (!topic || !endpoint) return { ok: false };
  q('DELETE FROM ntf_devices WHERE topic = ? AND push_endpoint = ?').run(topic, String(endpoint));
  return { ok: true };
}

// -------------------------------- WebSocket --------------------------------
const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

export function handleUpgrade(req, socket, head) {
  wss.handleUpgrade(req, socket, head, (ws) => {
    let topic = null;
    let key = null;
    try {
      const q = new URL(req.url, 'http://x').searchParams;
      topic = cleanTopic(q.get('topic'));
      key = q.get('key');
    } catch { /* مسیر خراب */ }

    if (!topic) {
      try {
        ws.send(JSON.stringify({ op: 'error', msg: 'no_topic' }));
        ws.close();
      } catch { /* بسته شد */ }
      return;
    }

    // موضوعِ قفل‌دار بدونِ رمزِ درست، حتی یک پیام هم نمی‌بیند
    if (!mayRead(topic, key)) {
      try {
        ws.send(JSON.stringify({ op: 'error', msg: 'forbidden' }));
        ws.close();
      } catch { /* بسته شد */ }
      return;
    }

    ensureTopic(topic);
    if (!listeners.has(topic)) listeners.set(topic, new Set());
    listeners.get(topic).add(ws);

    // آخرین پیام‌ها را همان اول می‌فرستیم تا چیزی از قلم نیفتد
    ws.send(JSON.stringify({ op: 'ready', topic, messages: history(topic, { limit: 50 }) }));

    ws.on('close', () => {
      const set = listeners.get(topic);
      set?.delete(ws);
      if (set && !set.size) listeners.delete(topic);
    });
    ws.on('error', () => {});
  });
}

export function snapshot() {
  return {
    topics: listTopics().length,
    listeners: [...listeners.values()].reduce((n, s) => n + s.size, 0),
    vapidPublicKey: vapidPublicKey(),
  };
}
