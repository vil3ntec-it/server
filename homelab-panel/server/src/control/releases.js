// ---------------------------------------------------------------------------
//  انتشارها — هر نسخه‌ای که برای کاربر منتشر می‌کنید
//
//  فایلِ هر انتشار داخلِ پوشهٔ releases همان پروژه می‌نشیند و جمعِ کنترلی‌اش
//  گرفته می‌شود، پس همیشه معلوم است فایلِ روی دیسک همان چیزی است که ثبت شده.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { audit } from './audit.js';
import { projectDir, ensureProjectStorage } from './storage.js';

export const PLATFORMS = ['android', 'windows', 'linux', 'mac', 'web', 'backend'];
export const CHANNELS = ['stable', 'beta', 'alpha'];

/** «1.2.10» را طوری می‌شکند که مرتب‌سازی درست باشد */
export function compareVersions(a, b) {
  const pa = String(a || '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = String(b || '').split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x) > String(y) ? 1 : -1;
  }
  return 0;
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function releasesDirOf(project) {
  return path.join(projectDir(project), 'releases');
}

export function listReleases(project, { platform = null, channel = null } = {}) {
  const where = ['project_id = ?'];
  const args = [project.id];
  if (platform) {
    where.push('platform = ?');
    args.push(platform);
  }
  if (channel) {
    where.push('channel = ?');
    args.push(channel);
  }
  const rows = db.prepare(`SELECT * FROM cc_releases WHERE ${where.join(' AND ')}`).all(...args);
  return rows
    .map((r) => ({ ...r, file_exists: r.file_path ? fs.existsSync(r.file_path) : false }))
    .sort((a, b) => compareVersions(b.version, a.version) || b.created_at - a.created_at);
}

/** آخرین نسخهٔ منتشرشده — همان چیزی که برنامه برای «بروزرسانی موجود است» می‌پرسد */
export function latestRelease(project, { platform, channel = 'stable' } = {}) {
  const rows = listReleases(project, { platform, channel }).filter((r) => r.published);
  return rows[0] || null;
}

export async function createRelease(project, input, actor = 'admin') {
  const platform = String(input.platform || '').toLowerCase();
  if (!PLATFORMS.includes(platform)) throw new Error('invalid_platform');
  const channel = CHANNELS.includes(input.channel) ? input.channel : 'stable';
  const version = String(input.version || '').trim();
  if (!version) throw new Error('version_required');

  await ensureProjectStorage(project);

  let filePath = null;
  let fileSize = null;
  let checksum = null;

  if (input.file_path) {
    // فایل باید داخلِ پوشهٔ releases همین پروژه باشد — نه جای دیگر
    const dir = releasesDirOf(project);
    const resolved = path.resolve(String(input.file_path));
    const rel = path.relative(dir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('file_outside_project');
    if (!fs.existsSync(resolved)) throw new Error('file_not_found');
    const st = await fsp.stat(resolved);
    filePath = resolved;
    fileSize = st.size;
    checksum = await sha256(resolved);
  }

  const ts = Date.now();
  const info = db
    .prepare(
      `INSERT INTO cc_releases(project_id, platform, version, build, channel, file_path, file_size, checksum,
                               min_version, mandatory, notes, published, released_at, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      project.id,
      platform,
      version,
      input.build ? String(input.build) : null,
      channel,
      filePath,
      fileSize,
      checksum,
      input.min_version ? String(input.min_version) : null,
      input.mandatory ? 1 : 0,
      input.notes ? String(input.notes).slice(0, 4000) : null,
      input.published ? 1 : 0,
      input.published ? ts : null,
      ts
    );

  const id = Number(info.lastInsertRowid);
  audit({
    actor,
    action: 'release.create',
    entity: 'release',
    entityId: id,
    projectId: project.id,
    detail: { platform, version, channel, size: fileSize },
  });
  return db.prepare('SELECT * FROM cc_releases WHERE id = ?').get(id);
}

export function updateRelease(project, id, patch, actor = 'admin') {
  const row = db.prepare('SELECT * FROM cc_releases WHERE id = ? AND project_id = ?').get(Number(id), project.id);
  if (!row) return null;
  const allowed = ['notes', 'min_version', 'mandatory', 'published', 'build', 'channel'];
  const data = {};
  for (const key of allowed) {
    if (patch[key] !== undefined) data[key] = key === 'mandatory' || key === 'published' ? (patch[key] ? 1 : 0) : patch[key];
  }
  if (data.published === 1 && !row.released_at) data.released_at = Date.now();
  if (!Object.keys(data).length) return row;
  const cols = Object.keys(data);
  db.prepare(`UPDATE cc_releases SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
    ...cols.map((c) => data[c]),
    row.id
  );
  audit({ actor, action: 'release.update', entity: 'release', entityId: row.id, projectId: project.id, detail: data });
  return db.prepare('SELECT * FROM cc_releases WHERE id = ?').get(row.id);
}

export async function deleteRelease(project, id, { deleteFile = false, actor = 'admin' } = {}) {
  const row = db.prepare('SELECT * FROM cc_releases WHERE id = ? AND project_id = ?').get(Number(id), project.id);
  if (!row) return false;
  if (deleteFile && row.file_path) {
    try {
      await fsp.rm(row.file_path, { force: true });
    } catch { /* از قبل نبود */ }
  }
  db.prepare('DELETE FROM cc_releases WHERE id = ?').run(row.id);
  audit({
    actor,
    action: 'release.delete',
    entity: 'release',
    entityId: row.id,
    projectId: project.id,
    detail: { version: row.version, platform: row.platform, deleteFile },
  });
  return true;
}

/** فایل‌هایی که در پوشهٔ releases هستند ولی هنوز ثبت نشده‌اند */
export async function unregisteredFiles(project) {
  const dir = releasesDirOf(project);
  if (!fs.existsSync(dir)) return [];
  const known = new Set(
    db
      .prepare('SELECT file_path FROM cc_releases WHERE project_id = ? AND file_path IS NOT NULL')
      .all(project.id)
      .map((r) => path.resolve(r.file_path))
  );
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    if (known.has(path.resolve(full))) continue;
    const st = await fsp.stat(full);
    out.push({ name: entry.name, path: full, size: st.size, mtime: st.mtimeMs });
  }
  return out;
}

/** درستیِ فایلِ یک انتشار — جمعِ کنترلی دوباره حساب می‌شود */
export async function verifyRelease(project, id) {
  const row = db.prepare('SELECT * FROM cc_releases WHERE id = ? AND project_id = ?').get(Number(id), project.id);
  if (!row) return { ok: false, error: 'not_found' };
  if (!row.file_path) return { ok: false, error: 'no_file' };
  if (!fs.existsSync(row.file_path)) return { ok: false, error: 'file_missing' };
  const current = await sha256(row.file_path);
  const st = await fsp.stat(row.file_path);
  return {
    ok: row.checksum ? current === row.checksum : true,
    checksum: current,
    expected: row.checksum,
    size: st.size,
    expectedSize: row.file_size,
  };
}
