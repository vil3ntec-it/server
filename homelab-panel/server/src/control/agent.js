// ---------------------------------------------------------------------------
//  Agent سرور — گزارشِ واقعیِ سخت‌افزار و سرویس‌ها از سرورهای دیگر
//
//  چطور امن است:
//    • هر سرور یک کلید دارد که فقط یک‌بار نشان داده می‌شود و رمزنگاری‌شده در
//      گاوصندوق می‌ماند.
//    • Agent هر گزارش را با HMAC-SHA256 امضا می‌کند؛ خودِ کلید هرگز فرستاده نمی‌شود.
//    • مهرِ زمانیِ هر گزارش بررسی می‌شود، پس گزارشِ قدیمی دوباره پذیرفته نمی‌شود.
//
//  چه کاری *نمی‌کند*: هیچ راهی برای اجرای دستور از راه دور وجود ندارد. Agent
//  فقط گزارش می‌دهد؛ Control Center چیزی به آن دستور نمی‌دهد.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db } from '../db.js';
import { putSecret, readSecret, deleteSecret } from './vault.js';
import { audit } from './audit.js';
import { raiseAlert, clearAlert } from './alerts.js';
import { getServer } from './models.js';

/** پنجرهٔ پذیرشِ مهرِ زمانی (ثانیه) — جلوی پخشِ دوبارهٔ گزارشِ کهنه را می‌گیرد */
const MAX_SKEW_SEC = 300;
/** اگر این‌قدر خبری نشد، سرور آفلاین حساب می‌شود */
export const AGENT_STALE_MS = 3 * 60 * 1000;

function secretName(server) {
  return `agent:${server.server_id}`;
}

/** کلیدِ تازه می‌سازد؛ مقدارِ برگشتی فقط همین یک‌بار در دسترس است */
export function issueAgentKey(server, actor = 'admin') {
  const key = crypto.randomBytes(32).toString('hex');
  const secret = putSecret({
    name: secretName(server),
    kind: 'server',
    scope: 'server',
    serverId: server.id,
    value: key,
    note: 'کلیدِ Agent',
    actor,
  });
  db.prepare('UPDATE cc_servers SET agent_key = ?, updated_at = ? WHERE id = ?').run(
    `vault:${secret.id}`,
    Date.now(),
    server.id
  );
  audit({ actor, action: 'agent.key.issue', entity: 'server', entityId: server.server_id, detail: { server: server.name } });
  return key;
}

export function revokeAgentKey(server, actor = 'admin') {
  const ref = String(server.agent_key || '');
  if (ref.startsWith('vault:')) deleteSecret(Number(ref.slice(6)), actor);
  db.prepare('UPDATE cc_servers SET agent_key = NULL, updated_at = ? WHERE id = ?').run(Date.now(), server.id);
  audit({ actor, action: 'agent.key.revoke', entity: 'server', entityId: server.server_id });
  return true;
}

function keyOf(server) {
  const ref = String(server.agent_key || '');
  if (!ref.startsWith('vault:')) return null;
  return readSecret(Number(ref.slice(6)));
}

export function signPayload(key, timestamp, rawBody) {
  return crypto.createHmac('sha256', key).update(`${timestamp}.${rawBody}`).digest('hex');
}

/**
 * امضا را می‌سنجد.
 * @returns {{ok:boolean, server?:object, error?:string}}
 */
export function verifyReport({ serverId, timestamp, signature, rawBody }) {
  const server = serverId ? getServer(serverId) : null;
  if (!server) return { ok: false, error: 'unknown_server' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, error: 'bad_timestamp' };
  const skew = Math.abs(Date.now() / 1000 - ts);
  if (skew > MAX_SKEW_SEC) return { ok: false, error: 'timestamp_out_of_range' };

  const key = keyOf(server);
  if (!key) return { ok: false, error: 'no_agent_key' };

  const expected = signPayload(key, timestamp, rawBody);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature || ''), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'bad_signature' };

  return { ok: true, server };
}

/** آستانه‌هایی که هشدار می‌سازند */
const THRESHOLDS = { cpu: 92, memory: 92, disk: 92 };

/** گزارشِ پذیرفته‌شده را ذخیره و در صورت لزوم هشدار می‌سازد */
export function storeReport(server, report) {
  const now = Date.now();
  const clean = {
    at: now,
    os: report.os ?? null,
    uptime: report.uptime ?? null,
    cpu: report.cpu ?? null,
    memory: report.memory ?? null,
    storage: Array.isArray(report.storage) ? report.storage.slice(0, 12) : report.storage ?? null,
    network: report.network ?? null,
    runtimes: report.runtimes ?? null,
    services: Array.isArray(report.services) ? report.services.slice(0, 40) : [],
    health: report.health ?? null,
    agent: report.agent ?? null,
  };

  db.prepare('UPDATE cc_servers SET agent_seen = ?, agent_report = ?, status = ?, checked_at = ?, updated_at = ? WHERE id = ?').run(
    now,
    JSON.stringify(clean),
    'online',
    now,
    now,
    server.id
  );

  clearAlert(`server:${server.server_id}:offline`);

  const cpuUsage = Number(clean.cpu?.usage);
  if (Number.isFinite(cpuUsage)) {
    const key = `server:${server.server_id}:cpu`;
    if (cpuUsage >= THRESHOLDS.cpu) {
      raiseAlert({ key, kind: 'high_cpu', severity: 'warn', serverId: server.id, title: `پردازندهٔ «${server.name}» ${cpuUsage}٪ است`, detail: `آستانه: ${THRESHOLDS.cpu}٪` });
    } else clearAlert(key);
  }

  const memUsage = Number(clean.memory?.usage);
  if (Number.isFinite(memUsage)) {
    const key = `server:${server.server_id}:memory`;
    if (memUsage >= THRESHOLDS.memory) {
      raiseAlert({ key, kind: 'high_ram', severity: 'warn', serverId: server.id, title: `حافظهٔ «${server.name}» ${memUsage}٪ پر است`, detail: `آستانه: ${THRESHOLDS.memory}٪` });
    } else clearAlert(key);
  }

  const disks = Array.isArray(clean.storage) ? clean.storage : [];
  for (const disk of disks) {
    const usage = Number(disk?.usage);
    if (!Number.isFinite(usage)) continue;
    const key = `server:${server.server_id}:disk:${disk.mount || disk.name || '?'}`;
    if (usage >= THRESHOLDS.disk) {
      raiseAlert({ key, kind: 'storage_low', severity: 'warn', serverId: server.id, title: `فضای «${disk.mount || disk.name}» روی ${server.name} کم است (${usage}٪)`, detail: `آزاد: ${disk.free ?? '?'} بایت` });
    } else clearAlert(key);
  }

  return clean;
}

/** سرورهایی که مدتی است خبری از Agentشان نیست */
export function markStaleServers() {
  const cutoff = Date.now() - AGENT_STALE_MS;
  const stale = db
    .prepare("SELECT * FROM cc_servers WHERE agent_key IS NOT NULL AND agent_seen IS NOT NULL AND agent_seen < ? AND status = 'online'")
    .all(cutoff);
  for (const server of stale) {
    db.prepare("UPDATE cc_servers SET status = 'offline', updated_at = ? WHERE id = ?").run(Date.now(), server.id);
    raiseAlert({
      key: `server:${server.server_id}:offline`,
      kind: 'server_offline',
      severity: 'critical',
      serverId: server.id,
      title: `سرور «${server.name}» گزارش نمی‌دهد`,
      detail: `آخرین گزارش: ${new Date(server.agent_seen).toISOString()}`,
    });
  }
  return stale.length;
}

/** متن آماده برای راه‌اندازیِ Agent روی آن سرور */
export function agentInstructions(server, key, panelUrl) {
  const base = panelUrl || 'https://panel.example.com';
  return {
    serverId: server.server_id,
    panelUrl: base,
    env: {
      CC_PANEL_URL: base,
      CC_SERVER_ID: server.server_id,
      CC_AGENT_KEY: key || '••••••••',
    },
    linux: [
      `export CC_PANEL_URL="${base}"`,
      `export CC_SERVER_ID="${server.server_id}"`,
      `export CC_AGENT_KEY="${key || '<کلید>'}"`,
      'node agent/agent.mjs',
    ].join('\n'),
    windows: [
      `set CC_PANEL_URL=${base}`,
      `set CC_SERVER_ID=${server.server_id}`,
      `set CC_AGENT_KEY=${key || '<کلید>'}`,
      'node agent\\agent.mjs',
    ].join('\r\n'),
  };
}
