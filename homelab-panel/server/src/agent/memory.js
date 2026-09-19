// ---------------------------------------------------------------------------
//  حافظهٔ دستیار — گفت‌وگوها، دانسته‌ها، رخدادها و راه‌حل‌ها، گزارش‌ها، اقدام‌ها
//
//  همه در همان SQLiteِ پنل (panel.db). قاعدهٔ پرامپت: «ایجنت حافظه دارد تا
//  با گذرِ زمان هوشمندتر شود» — رخدادی که یک بار حل شد، دفعهٔ بعد با راه‌حلش
//  می‌آید.
//
//  ⛔ هیچ رازی این‌جا نمی‌نشیند: هر چه نوشته می‌شود از redact.js رد شده.
// ---------------------------------------------------------------------------
import { db } from '../db.js';
import { redactText } from './redact.js';

export function ensureAgentSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
      role            TEXT NOT NULL,
      content         TEXT NOT NULL DEFAULT '',
      tool_name       TEXT,
      tool_args       TEXT,
      at              INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_conv ON agent_messages(conversation_id, at);
    CREATE TABLE IF NOT EXISTS agent_facts (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_incidents (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      kind     TEXT NOT NULL,
      title    TEXT NOT NULL,
      detail   TEXT,
      analysis TEXT,
      solution TEXT,
      status   TEXT NOT NULL DEFAULT 'open',
      at       INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_reports (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      kind  TEXT NOT NULL,
      title TEXT NOT NULL,
      body  TEXT NOT NULL,
      at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_actions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER,
      tool            TEXT NOT NULL,
      args            TEXT NOT NULL DEFAULT '{}',
      summary         TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      requested_by    TEXT NOT NULL DEFAULT 'agent',
      decided_by      TEXT,
      result          TEXT,
      at              INTEGER NOT NULL,
      decided_at      INTEGER
    );
  `);
}

const now = () => Date.now();

// ── گفت‌وگوها ────────────────────────────────────────────────────────────────
export function createConversation(title = '') {
  const t = now();
  const r = db.prepare('INSERT INTO agent_conversations (title, created_at, updated_at) VALUES (?, ?, ?)').run(String(title).slice(0, 120), t, t);
  return Number(r.lastInsertRowid);
}

export function listConversations(limit = 50) {
  return db.prepare('SELECT * FROM agent_conversations ORDER BY updated_at DESC LIMIT ?').all(Math.min(200, limit));
}

export function getConversation(id) {
  const row = db.prepare('SELECT * FROM agent_conversations WHERE id = ?').get(Number(id));
  if (!row) return null;
  const messages = db.prepare('SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY at, id').all(row.id)
    .map((m) => ({ ...m, tool_args: m.tool_args ? JSON.parse(m.tool_args) : null }));
  return { ...row, messages };
}

export function touchConversation(id, title = null) {
  if (title) db.prepare('UPDATE agent_conversations SET title = ?, updated_at = ? WHERE id = ?').run(String(title).slice(0, 120), now(), Number(id));
  else db.prepare('UPDATE agent_conversations SET updated_at = ? WHERE id = ?').run(now(), Number(id));
}

export function addMessage(conversationId, { role, content = '', toolName = null, toolArgs = null }) {
  const r = db.prepare('INSERT INTO agent_messages (conversation_id, role, content, tool_name, tool_args, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(Number(conversationId), role, redactText(content).slice(0, 20000), toolName, toolArgs ? JSON.stringify(toolArgs).slice(0, 4000) : null, now());
  touchConversation(conversationId);
  return Number(r.lastInsertRowid);
}

export function deleteConversation(id) {
  db.prepare('DELETE FROM agent_messages WHERE conversation_id = ?').run(Number(id));
  return db.prepare('DELETE FROM agent_conversations WHERE id = ?').run(Number(id)).changes > 0;
}

/** آخرین چند پیامِ متنی (نه ابزارها) برای بردن به مدل */
export function recentTurns(conversationId, limit = 12) {
  return db.prepare(`SELECT role, content FROM agent_messages WHERE conversation_id = ? AND role IN ('user','assistant') AND content <> '' ORDER BY at DESC, id DESC LIMIT ?`)
    .all(Number(conversationId), limit).reverse();
}

// ── دانسته‌ها ────────────────────────────────────────────────────────────────
export function setFact(key, value) {
  const k = String(key).trim().slice(0, 80);
  if (!k) return false;
  db.prepare('INSERT INTO agent_facts (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .run(k, redactText(String(value)).slice(0, 1000), now());
  return true;
}
export const listFacts = () => db.prepare('SELECT * FROM agent_facts ORDER BY updated_at DESC LIMIT 100').all();
export const deleteFact = (key) => db.prepare('DELETE FROM agent_facts WHERE key = ?').run(String(key)).changes > 0;

// ── رخدادها و راه‌حل‌ها ───────────────────────────────────────────────────────
export function addIncident({ kind, title, detail = '', analysis = '', solution = '' }) {
  const r = db.prepare('INSERT INTO agent_incidents (kind, title, detail, analysis, solution, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(String(kind).slice(0, 40), redactText(title).slice(0, 200), redactText(detail).slice(0, 4000), redactText(analysis).slice(0, 4000), redactText(solution).slice(0, 2000), now());
  return Number(r.lastInsertRowid);
}
export function updateIncident(id, patch = {}) {
  const cur = db.prepare('SELECT * FROM agent_incidents WHERE id = ?').get(Number(id));
  if (!cur) return null;
  const next = { ...cur, ...patch };
  db.prepare('UPDATE agent_incidents SET analysis = ?, solution = ?, status = ? WHERE id = ?')
    .run(redactText(next.analysis || '').slice(0, 4000), redactText(next.solution || '').slice(0, 2000), next.status || 'open', cur.id);
  return db.prepare('SELECT * FROM agent_incidents WHERE id = ?').get(cur.id);
}
export const listIncidents = (limit = 50) => db.prepare('SELECT * FROM agent_incidents ORDER BY at DESC LIMIT ?').all(Math.min(300, limit));
export function similarIncidents(title, limit = 3) {
  const words = String(title || '').split(/\s+/).filter((w) => w.length > 3).slice(0, 4);
  if (!words.length) return [];
  const where = words.map(() => '(title LIKE ? OR detail LIKE ?)').join(' OR ');
  const args = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
  return db.prepare(`SELECT * FROM agent_incidents WHERE solution <> '' AND (${where}) ORDER BY at DESC LIMIT ?`).all(...args, limit);
}

// ── گزارش‌ها ────────────────────────────────────────────────────────────────
export function addReport({ kind, title, body }) {
  const r = db.prepare('INSERT INTO agent_reports (kind, title, body, at) VALUES (?, ?, ?, ?)')
    .run(String(kind).slice(0, 40), redactText(title).slice(0, 200), redactText(body).slice(0, 30000), now());
  return Number(r.lastInsertRowid);
}
export const listReports = (limit = 30) => db.prepare('SELECT id, kind, title, at, substr(body, 1, 400) AS preview FROM agent_reports ORDER BY at DESC LIMIT ?').all(Math.min(200, limit));
export const getReport = (id) => db.prepare('SELECT * FROM agent_reports WHERE id = ?').get(Number(id)) || null;
export function lastReportAt(kind) {
  return db.prepare('SELECT MAX(at) AS at FROM agent_reports WHERE kind = ?').get(String(kind))?.at || 0;
}

// ── اقدام‌های منتظرِ تأیید ───────────────────────────────────────────────────
export function createAction({ conversationId = null, tool, args = {}, summary, requestedBy = 'agent' }) {
  const r = db.prepare('INSERT INTO agent_actions (conversation_id, tool, args, summary, requested_by, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(conversationId ? Number(conversationId) : null, String(tool), JSON.stringify(args).slice(0, 4000), redactText(summary).slice(0, 500), String(requestedBy).slice(0, 60), now());
  return getAction(Number(r.lastInsertRowid));
}
export function getAction(id) {
  const row = db.prepare('SELECT * FROM agent_actions WHERE id = ?').get(Number(id));
  return row ? { ...row, args: JSON.parse(row.args || '{}') } : null;
}
export function listActions({ status = 'pending', limit = 50 } = {}) {
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM agent_actions ORDER BY at DESC LIMIT ?').all(Math.min(200, limit))
    : db.prepare('SELECT * FROM agent_actions WHERE status = ? ORDER BY at DESC LIMIT ?').all(status, Math.min(200, limit));
  return rows.map((r) => ({ ...r, args: JSON.parse(r.args || '{}') }));
}
export function decideAction(id, { status, decidedBy, result = null }) {
  db.prepare('UPDATE agent_actions SET status = ?, decided_by = ?, result = ?, decided_at = ? WHERE id = ?')
    .run(status, String(decidedBy || '').slice(0, 60), result == null ? null : redactText(typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 4000), now(), Number(id));
  return getAction(id);
}
/** اقدامِ تأییدنشده‌ای که یک روز مانده، دیگر معتبر نیست */
export function expireActions(maxAgeMs = 24 * 3600e3) {
  db.prepare("UPDATE agent_actions SET status = 'expired', decided_at = ? WHERE status = 'pending' AND at < ?").run(now(), now() - maxAgeMs);
}
