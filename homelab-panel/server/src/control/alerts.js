// ---------------------------------------------------------------------------
//  هشدارها — از نتیجهٔ واقعیِ بررسی‌ها ساخته می‌شوند، نه از حدس.
//  هر هشدار یک «کلید» دارد؛ تا وقتی مشکل باز است فقط شمارنده‌اش بالا می‌رود.
// ---------------------------------------------------------------------------
import { EventEmitter } from 'node:events';
import { db } from '../db.js';
import { audit } from './audit.js';

export const alertEvents = new EventEmitter();

export const SEVERITY = ['info', 'warn', 'critical'];

/**
 * هشدار را باز می‌کند یا اگر باز بود شمارنده‌اش را بالا می‌برد.
 * @returns {{id:number, created:boolean}}
 */
export function raiseAlert({ key, kind, severity = 'warn', title, detail = null, projectId = null, serverId = null }) {
  const ts = Date.now();
  const sev = SEVERITY.includes(severity) ? severity : 'warn';
  const existing = db.prepare("SELECT * FROM cc_alerts WHERE key = ? AND status != 'resolved'").get(key);
  if (existing) {
    db.prepare('UPDATE cc_alerts SET count = count + 1, last_at = ?, detail = ?, severity = ? WHERE id = ?').run(
      ts,
      detail ? String(detail).slice(0, 1000) : existing.detail,
      sev,
      existing.id
    );
    return { id: existing.id, created: false };
  }
  const info = db
    .prepare(
      'INSERT INTO cc_alerts(key, kind, severity, project_id, server_id, title, detail, status, count, first_at, last_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(
      key,
      kind,
      sev,
      projectId != null ? Number(projectId) : null,
      serverId != null ? Number(serverId) : null,
      String(title).slice(0, 200),
      detail ? String(detail).slice(0, 1000) : null,
      'open',
      1,
      ts,
      ts
    );
  const id = Number(info.lastInsertRowid);
  audit({ actor: 'monitor', action: 'alert.raised', entity: kind, entityId: id, projectId, detail: { title } });
  alertEvents.emit('alert', { id, key, kind, severity: sev, title, detail, projectId, serverId, at: ts });
  return { id, created: true };
}

/** مشکل برطرف شد — هشدار بسته می‌شود */
export function clearAlert(key) {
  const row = db.prepare("SELECT * FROM cc_alerts WHERE key = ? AND status != 'resolved'").get(key);
  if (!row) return false;
  db.prepare("UPDATE cc_alerts SET status = 'resolved', resolved_at = ? WHERE id = ?").run(Date.now(), row.id);
  alertEvents.emit('cleared', { id: row.id, key });
  return true;
}

export function ackAlert(id) {
  return Number(
    db.prepare("UPDATE cc_alerts SET status = 'ack' WHERE id = ? AND status = 'open'").run(Number(id)).changes
  );
}

export function resolveAlert(id) {
  return Number(
    db.prepare("UPDATE cc_alerts SET status = 'resolved', resolved_at = ? WHERE id = ?").run(Date.now(), Number(id))
      .changes
  );
}

export function listAlerts({ status = 'open', limit = 200, projectId = null } = {}) {
  const where = [];
  const args = [];
  if (status && status !== 'all') {
    where.push('a.status = ?');
    args.push(status);
  }
  if (projectId != null) {
    where.push('a.project_id = ?');
    args.push(Number(projectId));
  }
  return db
    .prepare(
      `SELECT a.*, p.name AS project_name, p.project_id AS project_public_id, s.name AS server_name
         FROM cc_alerts a
    LEFT JOIN cc_projects p ON p.id = a.project_id
    LEFT JOIN cc_servers  s ON s.id = a.server_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, a.last_at DESC
        LIMIT ?`
    )
    .all(...args, Math.min(1000, Number(limit) || 200));
}

export function pruneAlerts(days = 30) {
  const cutoff = Date.now() - days * 86400000;
  try {
    db.prepare("DELETE FROM cc_alerts WHERE status = 'resolved' AND resolved_at < ?").run(cutoff);
  } catch { /* بی‌خیال */ }
}
