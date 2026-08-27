// ---------------------------------------------------------------------------
//  پیکربندیِ مرکزیِ برنامه‌ها — نسخه‌دار، قابلِ بازگشت، با ردِ پا
//
//  برنامهٔ اندروید/دسکتاپ/وب به‌جای اینکه آدرس‌ها را داخل خودش هاردکد کند،
//  از این‌جا می‌خواند:
//
//      API_BASE_URL = https://api.example.com/api
//      WS_URL       = wss://socket.example.com/socket
//
//  پس اگر روزی پروژه به VPS رفت یا دامنه عوض شد، فقط یک نسخهٔ تازه فعال
//  می‌شود و همهٔ برنامه‌ها آدرسِ درست را می‌گیرند.
//
//  هیچ رمزی این‌جا نمی‌آید: کلیدهای حساس رد می‌شوند و در گاوصندوق می‌مانند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db } from '../db.js';
import { audit } from './audit.js';
import { putSecret, readSecret } from './vault.js';

export const ENVIRONMENTS = ['development', 'staging', 'production'];

/** کلیدهایی که اجازه ندارند در پیکربندیِ عمومی باشند */
const FORBIDDEN_KEY = /(password|secret|token|api[_-]?key|private[_-]?key|credential|passphrase)/i;

export function validateConfigData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('config_must_be_object');
  const keys = Object.keys(data);
  if (keys.length > 200) throw new Error('too_many_keys');
  const rejected = [];
  const clean = {};
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key)) {
      rejected.push({ key, reason: 'invalid_key' });
      continue;
    }
    if (FORBIDDEN_KEY.test(key)) {
      rejected.push({ key, reason: 'looks_like_secret' });
      continue;
    }
    const value = data[key];
    const type = typeof value;
    if (value !== null && type !== 'string' && type !== 'number' && type !== 'boolean') {
      rejected.push({ key, reason: 'unsupported_type' });
      continue;
    }
    if (type === 'string' && value.length > 2000) {
      rejected.push({ key, reason: 'too_long' });
      continue;
    }
    clean[key] = value;
  }
  return { clean, rejected };
}

export function listVersions(project, environment = null) {
  const args = [project.id];
  let sql =
    'SELECT id, environment, version, active, note, created_by, created_at FROM cc_configs WHERE project_id = ?';
  if (environment) {
    sql += ' AND environment = ?';
    args.push(environment);
  }
  sql += ' ORDER BY environment, version DESC';
  return db.prepare(sql).all(...args);
}

export function getVersion(project, id) {
  const row = db.prepare('SELECT * FROM cc_configs WHERE id = ? AND project_id = ?').get(Number(id), project.id);
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data) };
}

export function activeConfig(project, environment = 'production') {
  const row = db
    .prepare('SELECT * FROM cc_configs WHERE project_id = ? AND environment = ? AND active = 1 ORDER BY version DESC LIMIT 1')
    .get(project.id, environment);
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data) };
}

/** نسخهٔ تازه می‌سازد و (به‌صورت پیش‌فرض) فعالش می‌کند */
export function saveVersion(project, { environment = 'production', data, note = null, actor = 'admin', activate = true }) {
  if (!ENVIRONMENTS.includes(environment)) throw new Error('invalid_environment');
  const { clean, rejected } = validateConfigData(data);

  const last = db
    .prepare('SELECT MAX(version) AS v FROM cc_configs WHERE project_id = ? AND environment = ?')
    .get(project.id, environment);
  const version = (last?.v || 0) + 1;
  const ts = Date.now();

  const info = db
    .prepare('INSERT INTO cc_configs(project_id, environment, version, data, active, note, created_by, created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(project.id, environment, version, JSON.stringify(clean), 0, note, actor, ts);
  const id = Number(info.lastInsertRowid);

  if (activate) activateVersion(project, id, actor);

  audit({
    actor,
    action: 'config.save',
    entity: 'config',
    entityId: id,
    projectId: project.id,
    detail: { environment, version, keys: Object.keys(clean), rejected },
  });

  return { id, version, environment, rejected, data: clean };
}

/** فعال کردنِ یک نسخه — همین است «بازگشت به نسخهٔ قبلی» */
export function activateVersion(project, id, actor = 'admin') {
  const row = db.prepare('SELECT * FROM cc_configs WHERE id = ? AND project_id = ?').get(Number(id), project.id);
  if (!row) throw new Error('not_found');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE cc_configs SET active = 0 WHERE project_id = ? AND environment = ?').run(project.id, row.environment);
    db.prepare('UPDATE cc_configs SET active = 1 WHERE id = ?').run(row.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  audit({
    actor,
    action: 'config.activate',
    entity: 'config',
    entityId: row.id,
    projectId: project.id,
    detail: { environment: row.environment, version: row.version },
  });
  return { ...row, data: JSON.parse(row.data), active: 1 };
}

/* -------------------- توکنِ خواندنِ پیکربندی از سمتِ برنامه ---------------- */

function tokenSecretName(project) {
  return `config-token:${project.project_id}`;
}

/** توکنِ تازه — فقط همین یک‌بار دیده می‌شود */
export function issueConfigToken(project, actor = 'admin') {
  const token = `cfg_${project.project_id}_${crypto.randomBytes(24).toString('hex')}`;
  putSecret({
    name: tokenSecretName(project),
    kind: 'api_key',
    scope: 'project',
    projectId: project.id,
    value: token,
    note: 'توکنِ خواندنِ پیکربندی توسطِ خودِ برنامه',
    actor,
  });
  audit({ actor, action: 'config.token.issue', entity: 'project', entityId: project.project_id, projectId: project.id });
  return token;
}

export function configTokenExists(project) {
  return Boolean(
    db
      .prepare("SELECT 1 AS x FROM cc_secrets WHERE scope = 'project' AND project_id = ? AND name = ?")
      .get(project.id, tokenSecretName(project))
  );
}

/** توکنِ ارائه‌شده را می‌سنجد — با مقایسهٔ زمان‌ثابت */
export function verifyConfigToken(project, provided) {
  const row = db
    .prepare("SELECT id FROM cc_secrets WHERE scope = 'project' AND project_id = ? AND name = ?")
    .get(project.id, tokenSecretName(project));
  if (!row) return false;
  const real = readSecret(row.id);
  if (!real) return false;
  const a = Buffer.from(real, 'utf8');
  const b = Buffer.from(String(provided || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * همان چیزی که برنامه می‌گیرد: مقادیرِ نسخهٔ فعال + آدرس‌های اصلی که خودِ
 * Control Center از Endpointهای ثبت‌شده می‌سازد (پس دستی وارد کردنشان لازم نیست).
 */
export function resolvedConfig(project, environment = 'production') {
  const version = activeConfig(project, environment);
  const derived = {};

  const endpoints = db
    .prepare('SELECT * FROM cc_endpoints WHERE project_id = ? AND environment = ? ORDER BY is_primary DESC, id')
    .all(project.id, environment);

  for (const e of endpoints) {
    const host = e.host || e.ip;
    if (!host) continue;
    const defaultPort = e.protocol === 'https' || e.protocol === 'wss' ? 443 : 80;
    const portPart = e.port && Number(e.port) !== defaultPort ? `:${e.port}` : '';
    const pathPart = e.path && e.path !== '/' ? (e.path.startsWith('/') ? e.path : `/${e.path}`) : '';
    const url = `${e.protocol}://${host}${portPart}${pathPart}`;
    if ((e.protocol === 'https' || e.protocol === 'http') && !derived.API_BASE_URL) derived.API_BASE_URL = url;
    if ((e.protocol === 'wss' || e.protocol === 'ws') && !derived.WS_URL) derived.WS_URL = url;
  }

  derived.ENVIRONMENT = environment;
  derived.PROJECT_ID = project.project_id;
  if (project.version) derived.APP_VERSION = project.version;

  return {
    project_id: project.project_id,
    environment,
    version: version?.version ?? 0,
    updated_at: version?.created_at ?? project.updated_at,
    // مقادیرِ دستی بر مقادیرِ ساخته‌شده مقدم‌اند
    config: { ...derived, ...(version?.data || {}) },
  };
}
