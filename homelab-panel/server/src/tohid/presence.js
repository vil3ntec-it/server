// ---------------------------------------------------------------------------
//  چه کسی، از کی، وصل است
//
//  برای اینکه در پنل یک عددِ واقعی دیده شود، نه حدس: هر تماسِ برنامه با سرور
//  ثبت می‌شود و «آنلاین» یعنی در چند دقیقهٔ گذشته خبری از او بوده.
// ---------------------------------------------------------------------------
import { db } from '../db.js';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export function noteActivity({ accountId = null, deviceUid = null, kind = 'api', ip = null }) {
  const now = Date.now();
  const open = db.prepare(`
    SELECT * FROM th_connections
    WHERE account_id IS ? AND device_uid IS ? AND kind = ? AND ended_at IS NULL
    ORDER BY id DESC LIMIT 1
  `).get(accountId, deviceUid, kind);

  // اگر بیش از پنجرهٔ آنلاین ساکت بوده، این یک اتصالِ تازه است
  if (open && now - open.last_seen <= ONLINE_WINDOW_MS) {
    db.prepare('UPDATE th_connections SET last_seen = ? WHERE id = ?').run(now, open.id);
    return open.id;
  }
  if (open) {
    db.prepare('UPDATE th_connections SET ended_at = last_seen WHERE id = ?').run(open.id);
  }

  const res = db.prepare(`
    INSERT INTO th_connections (account_id, device_uid, kind, ip, started_at, last_seen)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(accountId, deviceUid, kind, ip, now, now);

  if (accountId) {
    db.prepare('UPDATE th_accounts SET last_seen_at = ? WHERE account_id = ?').run(now, accountId);
  }
  return Number(res.lastInsertRowid);
}

/** کسانی که همین حالا وصل‌اند، با مدتِ اتصال */
export function onlineNow() {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  return db.prepare(`
    SELECT c.*, a.name, a.email, a.phone
    FROM th_connections c
    LEFT JOIN th_accounts a ON a.account_id = c.account_id
    WHERE c.last_seen >= ? AND c.ended_at IS NULL
    ORDER BY c.started_at
  `).all(cutoff).map((r) => ({
    accountId: r.account_id,
    name: r.name || '',
    contact: r.email || r.phone || '',
    deviceUid: r.device_uid,
    kind: r.kind,
    ip: r.ip,
    startedAt: r.started_at,
    lastSeen: r.last_seen,
    connectedMs: r.last_seen - r.started_at,
  }));
}

export function connectionStats() {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  const online = db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(account_id, device_uid)) AS n
    FROM th_connections WHERE last_seen >= ? AND ended_at IS NULL
  `).get(cutoff).n;
  const today = db.prepare(`
    SELECT COUNT(DISTINCT account_id) AS n FROM th_connections WHERE last_seen >= ?
  `).get(Date.now() - 24 * 60 * 60 * 1000).n;
  return { online, activeToday: today };
}

export function pruneConnections() {
  db.prepare('DELETE FROM th_connections WHERE last_seen < ?').run(Date.now() - KEEP_MS);
}
