// ---------------------------------------------------------------------------
//  مرکز فرمان — لایهٔ دادهٔ مشترک
//
//  همهٔ خواندن/نوشتن‌ها از همین‌جا رد می‌شوند تا سه قانون همه‌جا رعایت شود:
//    ۱) هیچ ردیفی بدون project_id معتبر ساخته نشود،
//    ۲) هیچ پرس‌وجویی از مرزِ پروژه بیرون نزند،
//    ۳) هر تغییرِ مهم در دفترِ رخدادها بماند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db } from '../db.js';

const now = () => Date.now();

/** شناسهٔ عمومی و پایدار — مثل prj_9f2c1a7b */
export function newPublicId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

/** نامِ پوشه: فقط حرف و رقم و خط‌تیره، همیشه یکتا */
export function slugify(input, fallback = 'project') {
  const base =
    String(input || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || fallback;
  return base;
}

export function uniqueSlug(table, column, wanted) {
  let slug = slugify(wanted);
  let n = 1;
  const stmt = db.prepare(`SELECT 1 AS x FROM ${table} WHERE ${column} = ?`);
  while (stmt.get(slug)) slug = `${slugify(wanted)}-${++n}`;
  return slug;
}

/* ------------------------------ کمکی‌ها ---------------------------------- */

/** فقط کلیدهای مجاز از بدنهٔ درخواست برداشته می‌شوند */
export function pick(source, keys) {
  const out = {};
  for (const k of keys) {
    if (source != null && Object.prototype.hasOwnProperty.call(source, k) && source[k] !== undefined) {
      out[k] = source[k];
    }
  }
  return out;
}

export function insertRow(table, data) {
  const cols = Object.keys(data);
  if (!cols.length) throw new Error('empty_insert');
  const sql = `INSERT INTO ${table}(${cols.join(', ')}) VALUES(${cols.map(() => '?').join(', ')})`;
  const info = db.prepare(sql).run(...cols.map((c) => normalize(data[c])));
  return Number(info.lastInsertRowid);
}

export function updateRow(table, id, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
  const info = db.prepare(sql).run(...cols.map((c) => normalize(data[c])), Number(id));
  return Number(info.changes);
}

export function deleteRow(table, id) {
  return Number(db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(id)).changes);
}

/** SQLite فقط عدد/رشته/بولین‌واره می‌فهمد — بقیه را خودمان تبدیل می‌کنیم */
function normalize(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function parseJson(text, fallback = null) {
  if (text == null) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/* ------------------------------ پروژه‌ها -------------------------------- */

export const PROJECT_TYPES = [
  'android',
  'desktop',
  'website',
  'webapp',
  'backend',
  'api',
  'websocket',
  'database',
  'service',
];

const PROJECT_FIELDS = [
  'name',
  'type',
  'version',
  'status',
  'description',
  'server_id',
  'repo_url',
  'site_id',
  'db_kind',
  'db_host',
  'db_port',
  'db_name',
];

export function listProjects({ type = null, status = null, q = null } = {}) {
  const where = [];
  const args = [];
  if (type) {
    where.push('p.type = ?');
    args.push(type);
  }
  if (status) {
    where.push('p.status = ?');
    args.push(status);
  }
  if (q) {
    where.push('(p.name LIKE ? OR p.project_id LIKE ? OR p.slug LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  return db
    .prepare(
      `SELECT p.*, s.name AS server_name, s.kind AS server_kind
         FROM cc_projects p
    LEFT JOIN cc_servers s ON s.id = p.server_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY p.name COLLATE NOCASE`
    )
    .all(...args);
}

export function getProject(idOrPublicId) {
  const key = String(idOrPublicId);
  const byPublic = db.prepare('SELECT * FROM cc_projects WHERE project_id = ?').get(key);
  if (byPublic) return byPublic;
  if (/^\d+$/.test(key)) return db.prepare('SELECT * FROM cc_projects WHERE id = ?').get(Number(key)) || null;
  return db.prepare('SELECT * FROM cc_projects WHERE slug = ?').get(key) || null;
}

export function createProject(input) {
  const data = pick(input, PROJECT_FIELDS);
  if (!data.name || !String(data.name).trim()) throw new Error('name_required');
  if (!PROJECT_TYPES.includes(data.type)) throw new Error('invalid_type');
  const ts = now();
  const id = insertRow('cc_projects', {
    ...data,
    name: String(data.name).trim(),
    project_id: newPublicId('prj'),
    slug: uniqueSlug('cc_projects', 'slug', input.slug || data.name),
    status: data.status || 'active',
    created_at: ts,
    updated_at: ts,
  });
  return db.prepare('SELECT * FROM cc_projects WHERE id = ?').get(id);
}

export function updateProject(id, input) {
  const data = pick(input, PROJECT_FIELDS);
  if (data.type && !PROJECT_TYPES.includes(data.type)) throw new Error('invalid_type');
  updateRow('cc_projects', id, { ...data, updated_at: now() });
  return db.prepare('SELECT * FROM cc_projects WHERE id = ?').get(Number(id));
}

/** همهٔ چیزهایی که به این پروژه چسبیده‌اند — برای صفحهٔ اختصاصی */
export function projectBundle(project) {
  const pid = project.id;
  return {
    project,
    server: project.server_id
      ? db.prepare('SELECT * FROM cc_servers WHERE id = ?').get(project.server_id) || null
      : null,
    ips: db.prepare('SELECT * FROM cc_ips WHERE project_id = ? ORDER BY kind, address').all(pid),
    ports: db.prepare('SELECT * FROM cc_ports WHERE project_id = ? ORDER BY port').all(pid),
    endpoints: db
      .prepare('SELECT * FROM cc_endpoints WHERE project_id = ? ORDER BY is_primary DESC, environment, protocol')
      .all(pid),
    routes: db
      .prepare(
        `SELECT r.*, d.name AS domain_name, t.name AS tunnel_name
           FROM cc_routes r
      LEFT JOIN domains d   ON d.id = r.domain_id
      LEFT JOIN cc_tunnels t ON t.id = r.tunnel_id
          WHERE r.project_id = ? ORDER BY r.hostname`
      )
      .all(pid),
    domains: db.prepare('SELECT * FROM domains WHERE project_id = ? ORDER BY name').all(pid),
    tunnels: db.prepare('SELECT * FROM cc_tunnels WHERE project_id = ? ORDER BY name').all(pid),
    backups: db.prepare('SELECT * FROM cc_backups WHERE project_id = ? ORDER BY created_at DESC LIMIT 30').all(pid),
    releases: db
      .prepare('SELECT * FROM cc_releases WHERE project_id = ? ORDER BY created_at DESC LIMIT 30')
      .all(pid),
    configs: db
      .prepare('SELECT id, environment, version, active, note, created_by, created_at FROM cc_configs WHERE project_id = ? ORDER BY environment, version DESC')
      .all(pid),
    secrets: db
      .prepare('SELECT id, name, kind, scope, hint, note, last_used, created_at FROM cc_secrets WHERE project_id = ? ORDER BY name')
      .all(pid),
    shops: db.prepare('SELECT * FROM cc_shops WHERE project_id = ? ORDER BY name').all(pid),
    counts: {
      users: db.prepare('SELECT COUNT(*) AS n FROM cc_app_users WHERE project_id = ?').get(pid).n,
      shops: db.prepare('SELECT COUNT(*) AS n FROM cc_shops WHERE project_id = ?').get(pid).n,
      subscriptions: db
        .prepare("SELECT COUNT(*) AS n FROM cc_subscriptions WHERE project_id = ? AND status = 'active'")
        .get(pid).n,
      backups: db.prepare('SELECT COUNT(*) AS n FROM cc_backups WHERE project_id = ?').get(pid).n,
    },
    monitors: db.prepare('SELECT * FROM cc_monitors WHERE project_id = ? ORDER BY kind, label').all(pid),
    alerts: db
      .prepare("SELECT * FROM cc_alerts WHERE project_id = ? AND status != 'resolved' ORDER BY last_at DESC LIMIT 20")
      .all(pid),
  };
}

/* ------------------------------- سرورها --------------------------------- */

export const SERVER_KINDS = ['home', 'vps', 'dedicated', 'cloud', 'hosting'];

const SERVER_FIELDS = [
  'name',
  'kind',
  'hostname',
  'ip',
  'ipv6',
  'ssh_port',
  'os',
  'provider',
  'location',
  'note',
];

export function listServers() {
  const rows = db.prepare('SELECT * FROM cc_servers ORDER BY is_local DESC, name COLLATE NOCASE').all();
  return rows.map((r) => ({
    ...r,
    agent_key: undefined, // هرگز بیرون نمی‌رود
    agent_report: parseJson(r.agent_report),
    has_agent: Boolean(r.agent_key),
    projects: db.prepare('SELECT COUNT(*) AS n FROM cc_projects WHERE server_id = ?').get(r.id).n,
  }));
}

export function getServer(id) {
  const key = String(id);
  const row = /^\d+$/.test(key)
    ? db.prepare('SELECT * FROM cc_servers WHERE id = ?').get(Number(key))
    : db.prepare('SELECT * FROM cc_servers WHERE server_id = ?').get(key);
  return row || null;
}

export function createServer(input) {
  const data = pick(input, SERVER_FIELDS);
  if (!data.name || !String(data.name).trim()) throw new Error('name_required');
  if (data.kind && !SERVER_KINDS.includes(data.kind)) throw new Error('invalid_kind');
  const ts = now();
  const id = insertRow('cc_servers', {
    ...data,
    name: String(data.name).trim(),
    server_id: newPublicId('srv'),
    kind: data.kind || 'vps',
    is_local: input.is_local ? 1 : 0,
    created_at: ts,
    updated_at: ts,
  });
  return getServer(id);
}

export function updateServer(id, input) {
  const data = pick(input, SERVER_FIELDS);
  if (data.kind && !SERVER_KINDS.includes(data.kind)) throw new Error('invalid_kind');
  updateRow('cc_servers', id, { ...data, updated_at: now() });
  return getServer(id);
}

/* --------------------- ردیف‌های وابسته به پروژه -------------------------- */

/**
 * سازندهٔ عمومیِ «چیزی که مالِ یک پروژه است».
 * هر جدولی که از این‌جا رد شود، خودبه‌خود قانونِ جدا بودنِ پروژه‌ها را رعایت می‌کند.
 */
function projectScoped(table, fields, { requireProject = true } = {}) {
  return {
    list(projectId) {
      if (projectId == null) return db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all();
      return db.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY id DESC`).all(Number(projectId));
    },
    get(id, projectId = null) {
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
      if (!row) return null;
      // مرزِ پروژه — حتی اگر شناسهٔ درست باشد، پروژهٔ اشتباه چیزی نمی‌بیند
      if (projectId != null && Number(row.project_id) !== Number(projectId)) return null;
      return row;
    },
    create(projectId, input) {
      if (requireProject && !projectId) throw new Error('project_required');
      const ts = now();
      const id = insertRow(table, {
        ...pick(input, fields),
        project_id: projectId ? Number(projectId) : null,
        created_at: ts,
        updated_at: ts,
      });
      return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    },
    update(id, input, projectId = null) {
      const row = this.get(id, projectId);
      if (!row) return null;
      updateRow(table, id, { ...pick(input, fields), updated_at: now() });
      return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
    },
    remove(id, projectId = null) {
      const row = this.get(id, projectId);
      if (!row) return false;
      deleteRow(table, id);
      return true;
    },
  };
}

export const ips = projectScoped('cc_ips', [
  'server_id',
  'address',
  'family',
  'kind',
  'port',
  'environment',
  'status',
  'description',
], { requireProject: false });

export const ports = projectScoped('cc_ports', [
  'server_id',
  'port',
  'protocol',
  'service',
  'environment',
  'note',
], { requireProject: false });

export const endpoints = projectScoped('cc_endpoints', [
  'server_id',
  'name',
  'protocol',
  'host',
  'ip',
  'port',
  'path',
  'environment',
  'is_primary',
  'monitored',
]);

export const shops = projectScoped('cc_shops', [
  'shop_id',
  'name',
  'owner_name',
  'owner_phone',
  'manager',
  'address',
  'status',
  'note',
]);

export const appUsers = projectScoped('cc_app_users', [
  'user_uid',
  'shop_id',
  'name',
  'phone',
  'email',
  'role',
  'status',
  'registered_at',
  'last_login',
  'note',
]);

export const subscriptions = projectScoped('cc_subscriptions', [
  'shop_id',
  'user_id',
  'plan',
  'start_at',
  'end_at',
  'status',
  'price',
  'note',
]);

/* ------------------------- ساختِ URL از اجزا ---------------------------- */

export function endpointUrl(e) {
  const host = e.host || e.ip;
  if (!host) return null;
  const defaultPort = e.protocol === 'https' || e.protocol === 'wss' ? 443 : 80;
  const showPort = e.port && Number(e.port) !== defaultPort;
  const path = e.path && e.path !== '/' ? (e.path.startsWith('/') ? e.path : `/${e.path}`) : '';
  const bracket = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `${e.protocol}://${bracket}${showPort ? `:${e.port}` : ''}${path}`;
}

/* --------------------------- شمارشِ داشبورد ----------------------------- */

export function overviewCounts() {
  const one = (sql, ...args) => db.prepare(sql).get(...args)?.n ?? 0;
  const byStatus = (table, column = 'status') =>
    Object.fromEntries(
      db.prepare(`SELECT ${column} AS k, COUNT(*) AS n FROM ${table} GROUP BY ${column}`).all().map((r) => [r.k, r.n])
    );

  return {
    projects: {
      total: one('SELECT COUNT(*) AS n FROM cc_projects'),
      byType: Object.fromEntries(
        db.prepare('SELECT type AS k, COUNT(*) AS n FROM cc_projects GROUP BY type').all().map((r) => [r.k, r.n])
      ),
      byStatus: byStatus('cc_projects'),
    },
    servers: { total: one('SELECT COUNT(*) AS n FROM cc_servers'), byStatus: byStatus('cc_servers') },
    endpoints: { total: one('SELECT COUNT(*) AS n FROM cc_endpoints'), byStatus: byStatus('cc_endpoints') },
    domains: one('SELECT COUNT(*) AS n FROM domains'),
    routes: one('SELECT COUNT(*) AS n FROM cc_routes'),
    tunnels: { total: one('SELECT COUNT(*) AS n FROM cc_tunnels'), byStatus: byStatus('cc_tunnels') },
    ips: one('SELECT COUNT(*) AS n FROM cc_ips'),
    ports: one('SELECT COUNT(*) AS n FROM cc_ports'),
    users: one('SELECT COUNT(*) AS n FROM cc_app_users'),
    shops: one('SELECT COUNT(*) AS n FROM cc_shops'),
    subscriptions: byStatus('cc_subscriptions'),
    backups: one('SELECT COUNT(*) AS n FROM cc_backups'),
    releases: one('SELECT COUNT(*) AS n FROM cc_releases'),
    secrets: one('SELECT COUNT(*) AS n FROM cc_secrets'),
    alerts: {
      open: one("SELECT COUNT(*) AS n FROM cc_alerts WHERE status = 'open'"),
      critical: one("SELECT COUNT(*) AS n FROM cc_alerts WHERE status = 'open' AND severity = 'critical'"),
    },
    monitors: byStatus('cc_monitors'),
  };
}
