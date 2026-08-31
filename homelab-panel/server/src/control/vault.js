// ---------------------------------------------------------------------------
//  گاوصندوق — نگهداریِ رمزنگاری‌شدهٔ توکن‌ها و اعتبارنامه‌ها
//
//  الگوریتم: AES-256-GCM. کلید اصلی یک فایل ۳۲ بایتیِ تصادفی کنارِ دیتابیس
//  است (data/vault.key) که فقط کاربرِ خودِ سرور می‌تواند بخواند.
//
//  قانون‌ها:
//    • مقدارِ رمزگشایی‌شده هرگز از API بیرون نمی‌رود؛ فقط خودِ سرور موقعِ
//      صدا زدنِ Cloudflare یا اتصال به دیتابیس آن را باز می‌کند.
//    • در رابط کاربری فقط ماسک (••••••••) و چهار نویسهٔ آخر دیده می‌شود.
//    • رمزِ کاربرانِ عادی و کدهای یک‌بارمصرف اینجا ذخیره نمی‌شوند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db.js';
import { audit } from './audit.js';

const KEY_FILE = path.join(config.dataDir, 'vault.key');
const ALGO = 'aes-256-gcm';

export const SECRET_KINDS = ['cf_token', 'api_key', 'database', 'server', 'deploy', 'ssh', 'other'];

let cachedKey = null;

function masterKey() {
  if (cachedKey) return cachedKey;
  try {
    if (fs.existsSync(KEY_FILE)) {
      const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        cachedKey = Buffer.from(hex, 'hex');
        return cachedKey;
      }
    }
  } catch { /* پایین ساخته می‌شود */ }

  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(KEY_FILE, 0o600);
  } catch { /* ویندوز chmod ندارد */ }
  cachedKey = key;
  return cachedKey;
}

/** آیا کلیدِ گاوصندوق ساخته شده؟ (برای صفحهٔ وضعیت) */
export function vaultReady() {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return {
    ciphertext: enc.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt({ ciphertext, iv, tag }) {
  const decipher = crypto.createDecipheriv(ALGO, masterKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

function hintOf(value) {
  const s = String(value);
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}

/** ردیفِ امن برای رابط کاربری — بدون هیچ اثری از مقدارِ اصلی */
export function publicSecret(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    scope: row.scope,
    project_id: row.project_id,
    server_id: row.server_id,
    hint: row.hint,
    note: row.note,
    masked: '••••••••',
    last_used: row.last_used,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function listSecrets({ scope = null, projectId = null, serverId = null } = {}) {
  const where = [];
  const args = [];
  if (scope) {
    where.push('scope = ?');
    args.push(scope);
  }
  if (projectId != null) {
    where.push('project_id = ?');
    args.push(Number(projectId));
  }
  if (serverId != null) {
    where.push('server_id = ?');
    args.push(Number(serverId));
  }
  return db
    .prepare(`SELECT * FROM cc_secrets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY scope, name`)
    .all(...args)
    .map(publicSecret);
}

/**
 * ذخیره یا جایگزینیِ یک راز. اگر همان نام در همان دامنه بود، به‌روزرسانی می‌شود.
 * @returns ردیفِ امن (بدون مقدار)
 */
export function putSecret({ name, kind = 'other', scope = 'global', projectId = null, serverId = null, value, note = null, actor = 'admin' }) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('name_required');
  if (value == null || String(value) === '') throw new Error('value_required');
  if (!SECRET_KINDS.includes(kind)) throw new Error('invalid_kind');
  if (!['global', 'project', 'server'].includes(scope)) throw new Error('invalid_scope');
  if (scope === 'project' && !projectId) throw new Error('project_required');
  if (scope === 'server' && !serverId) throw new Error('server_required');

  const enc = encrypt(value);
  const ts = Date.now();
  const pid = scope === 'project' ? Number(projectId) : null;
  const sid = scope === 'server' ? Number(serverId) : null;

  const existing = db
    .prepare('SELECT id FROM cc_secrets WHERE scope = ? AND name = ? AND IFNULL(project_id, -1) = IFNULL(?, -1) AND IFNULL(server_id, -1) = IFNULL(?, -1)')
    .get(scope, clean, pid, sid);

  if (existing) {
    db.prepare(
      'UPDATE cc_secrets SET kind = ?, ciphertext = ?, iv = ?, tag = ?, hint = ?, note = ?, updated_at = ? WHERE id = ?'
    ).run(kind, enc.ciphertext, enc.iv, enc.tag, hintOf(value), note, ts, existing.id);
    audit({ actor, action: 'vault.update', entity: 'secret', entityId: existing.id, projectId: pid, detail: { name: clean, kind, scope } });
    return publicSecret(db.prepare('SELECT * FROM cc_secrets WHERE id = ?').get(existing.id));
  }

  const info = db
    .prepare(
      'INSERT INTO cc_secrets(name, kind, scope, project_id, server_id, ciphertext, iv, tag, hint, note, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(clean, kind, scope, pid, sid, enc.ciphertext, enc.iv, enc.tag, hintOf(value), note, ts, ts);
  const id = Number(info.lastInsertRowid);
  audit({ actor, action: 'vault.create', entity: 'secret', entityId: id, projectId: pid, detail: { name: clean, kind, scope } });
  return publicSecret(db.prepare('SELECT * FROM cc_secrets WHERE id = ?').get(id));
}

/**
 * مقدارِ اصلی — فقط برای استفادهٔ داخلیِ سرور (Cloudflare، دیتابیس، …).
 * هیچ مسیرِ API این تابع را مستقیم به کاربر برنمی‌گرداند.
 */
export function readSecret(id) {
  const row = db.prepare('SELECT * FROM cc_secrets WHERE id = ?').get(Number(id));
  if (!row) return null;
  try {
    const value = decrypt(row);
    db.prepare('UPDATE cc_secrets SET last_used = ? WHERE id = ?').run(Date.now(), row.id);
    return value;
  } catch {
    // کلیدِ گاوصندوق عوض شده یا فایل خراب است
    return null;
  }
}

export function deleteSecret(id, actor = 'admin') {
  const row = db.prepare('SELECT * FROM cc_secrets WHERE id = ?').get(Number(id));
  if (!row) return false;
  db.prepare('DELETE FROM cc_secrets WHERE id = ?').run(row.id);
  audit({ actor, action: 'vault.delete', entity: 'secret', entityId: row.id, projectId: row.project_id, detail: { name: row.name } });
  return true;
}

/** بررسی سلامتِ گاوصندوق: آیا همهٔ ردیف‌ها با کلیدِ فعلی باز می‌شوند؟ */
export function vaultHealth() {
  const rows = db.prepare('SELECT id, name FROM cc_secrets').all();
  let readable = 0;
  const broken = [];
  for (const r of rows) {
    const full = db.prepare('SELECT * FROM cc_secrets WHERE id = ?').get(r.id);
    try {
      decrypt(full);
      readable++;
    } catch {
      broken.push({ id: r.id, name: r.name });
    }
  }
  return { ready: vaultReady(), total: rows.length, readable, broken, keyFile: KEY_FILE };
}
