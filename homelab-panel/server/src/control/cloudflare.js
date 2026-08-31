// ---------------------------------------------------------------------------
//  Cloudflare — با API رسمیِ خودشان، نه چیزِ ساختگی
//
//  توکن در گاوصندوق (رمزنگاری‌شده) می‌ماند و فقط همین‌جا لحظه‌ای باز می‌شود.
//  هرچه اینجا خوانده می‌شود، همان چیزی است که در پنلِ Cloudflare هم می‌بینید؛
//  اگر توکن دسترسیِ لازم را نداشته باشد، همان خطای خودشان برگردانده می‌شود.
// ---------------------------------------------------------------------------
import { db } from '../db.js';
import { readSecret, putSecret } from './vault.js';
import { audit } from './audit.js';

const API = 'https://api.cloudflare.com/client/v4';

class CloudflareError extends Error {
  constructor(message, { status = 0, errors = [] } = {}) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status;
    this.errors = errors;
  }
}

async function cfFetch(token, path, { method = 'GET', body = null, timeout = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok || (json && json.success === false)) {
      const errors = json?.errors || [];
      const message = errors[0]?.message || `cloudflare_http_${res.status}`;
      throw new CloudflareError(message, { status: res.status, errors });
    }
    return json?.result ?? json;
  } catch (e) {
    if (e.name === 'AbortError') throw new CloudflareError('cloudflare_timeout', { status: 0 });
    if (e instanceof CloudflareError) throw e;
    throw new CloudflareError(e.message || 'cloudflare_unreachable', { status: 0 });
  } finally {
    clearTimeout(timer);
  }
}

/* ----------------------------- حساب‌ها ---------------------------------- */

export function listAccounts() {
  return db
    .prepare(
      `SELECT a.id, a.name, a.account_id, a.email, a.status, a.verified_at, a.last_error,
              a.created_at, a.updated_at, s.hint AS token_hint
         FROM cc_cf_accounts a
    LEFT JOIN cc_secrets s ON s.id = a.secret_id
     ORDER BY a.name COLLATE NOCASE`
    )
    .all();
}

export function getAccount(id) {
  return db.prepare('SELECT * FROM cc_cf_accounts WHERE id = ?').get(Number(id)) || null;
}

function tokenOf(account) {
  if (!account?.secret_id) return null;
  return readSecret(account.secret_id);
}

/** توکن را می‌سنجد و همان لحظه حساب را ذخیره/به‌روز می‌کند */
export async function saveAccount({ id = null, name, token = null, accountId = null, email = null, actor = 'admin' }) {
  const ts = Date.now();
  const clean = String(name || '').trim();
  if (!clean) throw new Error('name_required');

  let row = id ? getAccount(id) : null;
  if (!row) {
    const info = db
      .prepare('INSERT INTO cc_cf_accounts(name, account_id, email, status, created_at, updated_at) VALUES(?,?,?,?,?,?)')
      .run(clean, accountId, email, 'unverified', ts, ts);
    row = getAccount(Number(info.lastInsertRowid));
  } else {
    db.prepare('UPDATE cc_cf_accounts SET name = ?, account_id = ?, email = ?, updated_at = ? WHERE id = ?').run(
      clean,
      accountId ?? row.account_id,
      email ?? row.email,
      ts,
      row.id
    );
    row = getAccount(row.id);
  }

  if (token) {
    const secret = putSecret({
      name: `cloudflare:${clean}`,
      kind: 'cf_token',
      scope: 'global',
      value: token,
      note: 'Cloudflare API Token',
      actor,
    });
    db.prepare('UPDATE cc_cf_accounts SET secret_id = ?, updated_at = ? WHERE id = ?').run(secret.id, ts, row.id);
    row = getAccount(row.id);
  }

  audit({ actor, action: 'cloudflare.account.save', entity: 'cf_account', entityId: row.id, detail: { name: clean } });
  const verified = await verifyAccount(row.id);
  return { ...listAccounts().find((a) => a.id === row.id), verify: verified };
}

/** آیا توکن زنده است و چه دسترسی‌هایی دارد */
export async function verifyAccount(id) {
  const row = getAccount(id);
  if (!row) return { ok: false, error: 'not_found' };
  const token = tokenOf(row);
  if (!token) return { ok: false, error: 'no_token' };
  try {
    const result = await cfFetch(token, '/user/tokens/verify');
    // اگر شناسهٔ حساب را نداده‌اند، خودمان از فهرستِ حساب‌ها برمی‌داریم
    let accountId = row.account_id;
    if (!accountId) {
      try {
        const accounts = await cfFetch(token, '/accounts?per_page=5');
        accountId = accounts?.[0]?.id || null;
      } catch { /* توکن شاید دسترسیِ حساب نداشته باشد */ }
    }
    db.prepare('UPDATE cc_cf_accounts SET status = ?, verified_at = ?, last_error = NULL, account_id = ?, updated_at = ? WHERE id = ?').run(
      'active',
      Date.now(),
      accountId,
      Date.now(),
      row.id
    );
    return { ok: true, status: result?.status || 'active', accountId };
  } catch (e) {
    db.prepare('UPDATE cc_cf_accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(
      'error',
      String(e.message).slice(0, 300),
      Date.now(),
      row.id
    );
    return { ok: false, error: e.message, status: e.status };
  }
}

export function deleteAccount(id, actor = 'admin') {
  const row = getAccount(id);
  if (!row) return false;
  db.prepare('DELETE FROM cc_cf_accounts WHERE id = ?').run(row.id);
  audit({ actor, action: 'cloudflare.account.delete', entity: 'cf_account', entityId: row.id, detail: { name: row.name } });
  return true;
}

/* ------------------------------- Zoneها --------------------------------- */

export async function listZones(accountRef) {
  const row = getAccount(accountRef);
  const token = tokenOf(row);
  if (!token) throw new CloudflareError('no_token');
  const zones = await cfFetch(token, '/zones?per_page=50');
  return (zones || []).map((z) => ({
    id: z.id,
    name: z.name,
    status: z.status,
    paused: z.paused,
    type: z.type,
    nameServers: z.name_servers || [],
    accountId: z.account?.id || null,
    accountName: z.account?.name || null,
    createdAt: z.created_on ? Date.parse(z.created_on) : null,
  }));
}

export async function zoneSsl(accountRef, zoneId) {
  const token = tokenOf(getAccount(accountRef));
  if (!token) throw new CloudflareError('no_token');
  const [mode, universal] = await Promise.all([
    cfFetch(token, `/zones/${zoneId}/settings/ssl`).catch(() => null),
    cfFetch(token, `/zones/${zoneId}/ssl/universal/settings`).catch(() => null),
  ]);
  return {
    mode: mode?.value || null,
    modifiedAt: mode?.modified_on ? Date.parse(mode.modified_on) : null,
    universalEnabled: universal?.enabled ?? null,
  };
}

/* ----------------------------- رکوردهای DNS ----------------------------- */

export async function listDnsRecords(accountRef, zoneId) {
  const token = tokenOf(getAccount(accountRef));
  if (!token) throw new CloudflareError('no_token');
  const records = await cfFetch(token, `/zones/${zoneId}/dns_records?per_page=200`);
  return (records || []).map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    content: r.content,
    proxied: r.proxied,
    ttl: r.ttl,
    comment: r.comment || null,
    modifiedAt: r.modified_on ? Date.parse(r.modified_on) : null,
  }));
}

export async function createDnsRecord(accountRef, zoneId, { type, name, content, ttl = 1, proxied = true, comment = null }, actor = 'admin') {
  const token = tokenOf(getAccount(accountRef));
  if (!token) throw new CloudflareError('no_token');
  const result = await cfFetch(token, `/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: { type, name, content, ttl, proxied, comment },
  });
  audit({ actor, action: 'cloudflare.dns.create', entity: 'dns_record', entityId: result?.id, detail: { type, name, content, proxied } });
  return result;
}

export async function updateDnsRecord(accountRef, zoneId, recordId, patch, actor = 'admin') {
  const token = tokenOf(getAccount(accountRef));
  if (!token) throw new CloudflareError('no_token');
  const result = await cfFetch(token, `/zones/${zoneId}/dns_records/${recordId}`, { method: 'PATCH', body: patch });
  audit({ actor, action: 'cloudflare.dns.update', entity: 'dns_record', entityId: recordId, detail: patch });
  return result;
}

export async function deleteDnsRecord(accountRef, zoneId, recordId, actor = 'admin') {
  const token = tokenOf(getAccount(accountRef));
  if (!token) throw new CloudflareError('no_token');
  const result = await cfFetch(token, `/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
  audit({ actor, action: 'cloudflare.dns.delete', entity: 'dns_record', entityId: recordId });
  return result;
}

/* ------------------------------- تونل‌ها -------------------------------- */

async function accountIdOf(row, token) {
  if (row.account_id) return row.account_id;
  const accounts = await cfFetch(token, '/accounts?per_page=5');
  const id = accounts?.[0]?.id || null;
  if (id) db.prepare('UPDATE cc_cf_accounts SET account_id = ? WHERE id = ?').run(id, row.id);
  return id;
}

export async function listCfTunnels(accountRef) {
  const row = getAccount(accountRef);
  const token = tokenOf(row);
  if (!token) throw new CloudflareError('no_token');
  const accountId = await accountIdOf(row, token);
  if (!accountId) throw new CloudflareError('no_account_id');
  const tunnels = await cfFetch(token, `/accounts/${accountId}/cfd_tunnel?is_deleted=false&per_page=100`);
  return (tunnels || []).map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status, // healthy | degraded | down | inactive
    connections: (t.connections || []).length,
    createdAt: t.created_at ? Date.parse(t.created_at) : null,
    deletedAt: t.deleted_at ? Date.parse(t.deleted_at) : null,
  }));
}

/** پیکربندیِ واقعیِ یک تونل: کدام hostname به کدام سرویسِ محلی می‌رود */
export async function tunnelConfiguration(accountRef, tunnelId) {
  const row = getAccount(accountRef);
  const token = tokenOf(row);
  if (!token) throw new CloudflareError('no_token');
  const accountId = await accountIdOf(row, token);
  const cfg = await cfFetch(token, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`);
  const ingress = cfg?.config?.ingress || [];
  return {
    ingress: ingress.map((i) => ({ hostname: i.hostname || null, service: i.service || null, path: i.path || null })),
    raw: cfg?.config || null,
  };
}

export async function tunnelConnections(accountRef, tunnelId) {
  const row = getAccount(accountRef);
  const token = tokenOf(row);
  if (!token) throw new CloudflareError('no_token');
  const accountId = await accountIdOf(row, token);
  const conns = await cfFetch(token, `/accounts/${accountId}/cfd_tunnel/${tunnelId}/connections`);
  return (conns || []).map((c) => ({
    id: c.id,
    colo: c.colo_name || null,
    origin: c.origin_ip || null,
    openedAt: c.opened_at ? Date.parse(c.opened_at) : null,
    clientVersion: c.client_version || null,
  }));
}

export { CloudflareError };
