// ---------------------------------------------------------------------------
//  مانیتورینگ — بررسی‌های زمان‌بندی‌شده روی چیزهایی که واقعاً ثبت شده‌اند
//
//  هیچ هدفی دستی ساخته نمی‌شود: فهرستِ هدف‌ها از خودِ Endpointها، دامنه‌ها،
//  سرورها، تونل‌ها و پورت‌های ثبت‌شده بازسازی می‌شود. اگر چیزی حذف شد، هدفش
//  هم می‌رود.
// ---------------------------------------------------------------------------
import { EventEmitter } from 'node:events';
import { db, getSetting } from '../db.js';
import { probeUrl, probeTcp, probeTls, probeDns, probeDatabase } from './checks.js';
import { endpointUrl } from './models.js';
import { raiseAlert, clearAlert } from './alerts.js';
import { markStaleServers, AGENT_STALE_MS } from './agent.js';

export const monitorEvents = new EventEmitter();

const DEFAULT_INTERVAL = 300; // ثانیه
/** چند بار پشتِ‌هم خطا تا هشدار ساخته شود (جلوی هشدارِ الکی را می‌گیرد) */
const FAILS_BEFORE_ALERT = 2;
const HISTORY_KEEP = 200;

let timer = null;
let running = false;

/* ------------------------- ساختنِ فهرستِ هدف‌ها -------------------------- */

function upsertMonitor({ kind, refId, projectId, serverId, label, target, intervalSec = DEFAULT_INTERVAL }) {
  const ts = Date.now();
  const existing = db.prepare('SELECT * FROM cc_monitors WHERE kind = ? AND ref_id = ?').get(kind, refId);
  if (existing) {
    db.prepare('UPDATE cc_monitors SET label = ?, target = ?, project_id = ?, server_id = ?, updated_at = ? WHERE id = ?').run(
      label,
      target,
      projectId ?? null,
      serverId ?? null,
      ts,
      existing.id
    );
    return existing.id;
  }
  const info = db
    .prepare(
      'INSERT INTO cc_monitors(kind, ref_id, project_id, server_id, label, target, enabled, interval_sec, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
    )
    .run(kind, refId, projectId ?? null, serverId ?? null, label, target, 1, intervalSec, ts, ts);
  return Number(info.lastInsertRowid);
}

/** فهرستِ هدف‌ها را با وضعیتِ فعلیِ دیتابیس هماهنگ می‌کند */
export function syncMonitors() {
  const keep = new Set();

  // ۱) Endpointهایی که خواسته‌ایم پایش شوند
  for (const e of db.prepare('SELECT * FROM cc_endpoints WHERE monitored = 1').all()) {
    const url = endpointUrl(e);
    if (!url) continue;
    const project = db.prepare('SELECT name FROM cc_projects WHERE id = ?').get(e.project_id);
    const id = upsertMonitor({
      kind: 'endpoint',
      refId: e.id,
      projectId: e.project_id,
      serverId: e.server_id,
      label: `${project?.name || '?'} — ${e.name || e.environment} (${e.protocol})`,
      target: url,
    });
    keep.add(`endpoint:${e.id}`);
    void id;
  }

  // ۲) دامنه‌ها (DNS + گواهی + HTTP)
  for (const d of db.prepare('SELECT * FROM domains').all()) {
    upsertMonitor({
      kind: 'domain',
      refId: d.id,
      projectId: d.project_id ?? null,
      serverId: d.server_id ?? null,
      label: d.name,
      target: d.name,
      intervalSec: 3600,
    });
    keep.add(`domain:${d.id}`);
  }

  // ۳) سرورهایی که IP دارند (بدونِ Agent هم می‌شود پورت را سنجید)
  for (const s of db.prepare('SELECT * FROM cc_servers WHERE is_local = 0').all()) {
    const host = s.hostname || s.ip;
    if (!host) continue;
    upsertMonitor({
      kind: 'server',
      refId: s.id,
      serverId: s.id,
      projectId: null,
      label: s.name,
      target: `${host}:${s.ssh_port || 22}`,
      intervalSec: 600,
    });
    keep.add(`server:${s.id}`);
  }

  // ۴) تونل‌ها
  for (const t of db.prepare('SELECT * FROM cc_tunnels').all()) {
    const route = db.prepare('SELECT hostname FROM cc_tunnel_routes WHERE tunnel_id = ? LIMIT 1').get(t.id);
    if (!route?.hostname) continue;
    upsertMonitor({
      kind: 'tunnel',
      refId: t.id,
      projectId: t.project_id,
      serverId: t.server_id,
      label: t.name,
      target: `https://${route.hostname}`,
      intervalSec: 300,
    });
    keep.add(`tunnel:${t.id}`);
  }

  // ۵) دیتابیسِ پروژه‌ها
  for (const p of db.prepare("SELECT * FROM cc_projects WHERE db_kind IS NOT NULL AND db_kind != 'none' AND db_host IS NOT NULL").all()) {
    upsertMonitor({
      kind: 'database',
      refId: p.id,
      projectId: p.id,
      serverId: p.server_id,
      label: `${p.name} — ${p.db_kind}`,
      target: `${p.db_host}:${p.db_port || ''}|${p.db_kind}`,
      intervalSec: 600,
    });
    keep.add(`database:${p.id}`);
  }

  // هدف‌هایی که منبعشان رفته
  let removed = 0;
  for (const m of db.prepare('SELECT id, kind, ref_id FROM cc_monitors').all()) {
    if (!keep.has(`${m.kind}:${m.ref_id}`)) {
      db.prepare('DELETE FROM cc_monitors WHERE id = ?').run(m.id);
      removed++;
    }
  }

  return { total: keep.size, removed };
}

/* ------------------------------ اجرای یک بررسی -------------------------- */

async function runOne(monitor) {
  let result;

  if (monitor.kind === 'endpoint' || monitor.kind === 'tunnel') {
    result = await probeUrl(monitor.target);
  } else if (monitor.kind === 'server') {
    const [host, port] = String(monitor.target).split(':');
    result = await probeTcp(host, Number(port) || 22);
  } else if (monitor.kind === 'database') {
    const [hostPort, kind] = String(monitor.target).split('|');
    const [host, port] = hostPort.split(':');
    result = await probeDatabase({ kind, host, port: port ? Number(port) : null });
  } else if (monitor.kind === 'domain') {
    const dnsRes = await probeDns(monitor.target);
    if (dnsRes.status !== 'online') {
      result = dnsRes;
    } else {
      const tlsRes = await probeTls(monitor.target);
      const httpRes = await probeUrl(`https://${monitor.target}/`);
      result = {
        ...httpRes,
        status: httpRes.status === 'online' ? (tlsRes.status === 'online' ? 'online' : tlsRes.status) : httpRes.status,
        ssl: tlsRes.ssl,
        dns: dnsRes.records,
      };
      // نتیجهٔ گواهی روی خودِ دامنه هم ذخیره می‌شود
      if (tlsRes.ssl) {
        db.prepare('UPDATE domains SET ssl_status = ?, ssl_issuer = ?, ssl_expires = ?, checked_at = ? WHERE id = ?').run(
          tlsRes.ssl.status || null,
          tlsRes.ssl.issuer || null,
          tlsRes.ssl.expiresAt || null,
          Date.now(),
          monitor.ref_id
        );
      }
    }
  } else {
    result = { status: 'unknown', code: null, latencyMs: null, error: 'unsupported_kind', checkedAt: Date.now() };
  }

  return result;
}

function applyResult(monitor, result) {
  const ts = result.checkedAt || Date.now();
  const good = result.status === 'online';
  const fails = good ? 0 : (monitor.fails || 0) + 1;

  db.prepare(
    'UPDATE cc_monitors SET status = ?, status_code = ?, latency_ms = ?, error = ?, checked_at = ?, fails = ?, updated_at = ? WHERE id = ?'
  ).run(result.status, result.code ?? null, result.latencyMs ?? null, result.error ?? null, ts, fails, ts, monitor.id);

  db.prepare('INSERT INTO cc_monitor_results(monitor_id, status, code, latency_ms, error, at) VALUES(?,?,?,?,?,?)').run(
    monitor.id,
    result.status,
    result.code ?? null,
    result.latencyMs ?? null,
    result.error ?? null,
    ts
  );
  db.prepare(
    `DELETE FROM cc_monitor_results WHERE monitor_id = ? AND id NOT IN
       (SELECT id FROM cc_monitor_results WHERE monitor_id = ? ORDER BY id DESC LIMIT ${HISTORY_KEEP})`
  ).run(monitor.id, monitor.id);

  // وضعیت روی خودِ ردیفِ اصلی هم می‌نشیند تا صفحه‌ها تازه باشند
  if (monitor.kind === 'endpoint') {
    db.prepare('UPDATE cc_endpoints SET status = ?, status_code = ?, latency_ms = ?, error = ?, checked_at = ? WHERE id = ?').run(
      result.status,
      result.code ?? null,
      result.latencyMs ?? null,
      result.error ?? null,
      ts,
      monitor.ref_id
    );
  } else if (monitor.kind === 'tunnel') {
    db.prepare('UPDATE cc_tunnels SET status = ?, last_check = ?, last_error = ? WHERE id = ?').run(
      result.status,
      ts,
      result.error ?? null,
      monitor.ref_id
    );
  } else if (monitor.kind === 'server') {
    db.prepare('UPDATE cc_servers SET status = ?, checked_at = ? WHERE id = ? AND agent_key IS NULL').run(
      result.status,
      ts,
      monitor.ref_id
    );
  }

  // هشدار — فقط بعد از چند خطای پشتِ‌هم
  const key = `monitor:${monitor.kind}:${monitor.ref_id}`;
  if (!good && fails >= FAILS_BEFORE_ALERT) {
    raiseAlert({
      key,
      kind: `${monitor.kind}_offline`,
      severity: monitor.kind === 'server' || monitor.kind === 'database' ? 'critical' : 'warn',
      projectId: monitor.project_id,
      serverId: monitor.server_id,
      title: `${monitor.label} در دسترس نیست`,
      detail: `${result.status}${result.code ? ` (${result.code})` : ''}${result.error ? ` — ${result.error}` : ''} · ${monitor.target}`,
    });
  } else if (good) {
    clearAlert(key);
  }

  monitorEvents.emit('result', { monitor: { ...monitor, status: result.status }, result });
  return { ...result, fails };
}

/** یک هدف را همین حالا می‌سنجد (دکمهٔ «آزمایش») */
export async function checkMonitor(id) {
  const monitor = db.prepare('SELECT * FROM cc_monitors WHERE id = ?').get(Number(id));
  if (!monitor) return null;
  const result = await runOne(monitor);
  return applyResult(monitor, result);
}

/* ---------------------- گواهی و دامنه‌های رو به انقضا -------------------- */

const SSL_WARN_DAYS = 21;
const DOMAIN_WARN_DAYS = 30;

export function checkExpiries() {
  const now = Date.now();
  for (const d of db.prepare('SELECT * FROM domains').all()) {
    if (d.ssl_expires) {
      const days = Math.floor((d.ssl_expires - now) / 86400000);
      const key = `domain:${d.id}:ssl`;
      if (days <= SSL_WARN_DAYS) {
        raiseAlert({
          key,
          kind: 'ssl_expiring',
          severity: days <= 3 ? 'critical' : 'warn',
          projectId: d.project_id ?? null,
          title: days < 0 ? `گواهیِ ${d.name} منقضی شده` : `گواهیِ ${d.name} تا ${days} روز دیگر منقضی می‌شود`,
          detail: new Date(d.ssl_expires).toISOString(),
        });
      } else clearAlert(key);
    }
    if (d.reg_expires) {
      const days = Math.floor((d.reg_expires - now) / 86400000);
      const key = `domain:${d.id}:registration`;
      if (days <= DOMAIN_WARN_DAYS) {
        raiseAlert({
          key,
          kind: 'domain_expiring',
          severity: days <= 7 ? 'critical' : 'warn',
          projectId: d.project_id ?? null,
          title: days < 0 ? `ثبتِ دامنهٔ ${d.name} تمام شده` : `دامنهٔ ${d.name} تا ${days} روز دیگر تمدید می‌خواهد`,
          detail: new Date(d.reg_expires).toISOString(),
        });
      } else clearAlert(key);
    }
  }

  // اشتراک‌هایی که تاریخشان گذشته، خودکار «منقضی» می‌شوند
  db.prepare("UPDATE cc_subscriptions SET status = 'expired', updated_at = ? WHERE status = 'active' AND end_at < ?").run(
    now,
    now
  );

  // بکاپ‌های شکست‌خوردهٔ اخیر
  for (const b of db
    .prepare("SELECT b.*, p.name AS project_name FROM cc_backups b JOIN cc_projects p ON p.id = b.project_id WHERE b.status = 'failed' AND b.created_at > ?")
    .all(now - 24 * 3600 * 1000)) {
    raiseAlert({
      key: `backup:${b.id}:failed`,
      kind: 'backup_failed',
      severity: 'critical',
      projectId: b.project_id,
      title: `بکاپِ «${b.project_name}» ناموفق بود`,
      detail: b.error || b.filename,
    });
  }
}

/* ------------------------------- حلقهٔ اصلی ----------------------------- */

/** هدف‌هایی که وقتشان رسیده */
function dueMonitors(limit = 12) {
  const now = Date.now();
  return db
    .prepare('SELECT * FROM cc_monitors WHERE enabled = 1 ORDER BY IFNULL(checked_at, 0) ASC LIMIT ?')
    .all(limit)
    .filter((m) => !m.checked_at || now - m.checked_at >= m.interval_sec * 1000);
}

export async function tick() {
  if (running) return { skipped: true };
  running = true;
  try {
    markStaleServers();
    const due = dueMonitors();
    for (const monitor of due) {
      try {
        const result = await runOne(monitor);
        applyResult(monitor, result);
      } catch (e) {
        applyResult(monitor, { status: 'unknown', error: e.message, checkedAt: Date.now() });
      }
    }
    checkExpiries();
    return { checked: due.length };
  } finally {
    running = false;
  }
}

export function startMonitor({ intervalMs = 30000 } = {}) {
  if (timer) return;
  if (getSetting('cc_monitor_enabled', true) === false) return;
  syncMonitors();
  timer = setInterval(() => {
    tick().catch(() => { /* دورِ بعد دوباره تلاش می‌شود */ });
  }, intervalMs);
  timer.unref?.();
  // یک دورِ اول با کمی تأخیر تا بالا آمدنِ سرور کند نشود
  const kickoff = setTimeout(() => tick().catch(() => {}), 8000);
  kickoff.unref?.();
}

export function stopMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function monitorSummary() {
  const rows = db
    .prepare(
      `SELECT m.*, p.name AS project_name, p.project_id AS project_public_id, s.name AS server_name
         FROM cc_monitors m
    LEFT JOIN cc_projects p ON p.id = m.project_id
    LEFT JOIN cc_servers  s ON s.id = m.server_id
     ORDER BY m.kind, m.label COLLATE NOCASE`
    )
    .all();

  const byKind = {};
  for (const r of rows) {
    byKind[r.kind] = byKind[r.kind] || { total: 0, online: 0, offline: 0, unknown: 0 };
    byKind[r.kind].total++;
    if (r.status === 'online') byKind[r.kind].online++;
    else if (r.status === 'unknown') byKind[r.kind].unknown++;
    else byKind[r.kind].offline++;
  }

  return { monitors: rows, byKind, agentStaleMs: AGENT_STALE_MS };
}

export function monitorHistory(id, limit = 60) {
  return db
    .prepare('SELECT status, code, latency_ms, error, at FROM cc_monitor_results WHERE monitor_id = ? ORDER BY at DESC LIMIT ?')
    .all(Number(id), Math.min(200, Number(limit) || 60))
    .reverse();
}
