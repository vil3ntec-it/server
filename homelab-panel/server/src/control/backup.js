// ---------------------------------------------------------------------------
//  بکاپ و بازگردانی — هر پروژه جدا، با مانیفست و بررسیِ درستی
//
//  فایلِ بکاپ یک ZIP است با این ساختار:
//      manifest.json      → شناسنامه (project_id، نسخه، تاریخ، شمارش‌ها)
//      database.json      → ردیف‌های دیتابیسِ همان پروژه
//      files/…            → محتوای پوشهٔ پروژه (به‌جز backups و cache)
//
//  ترتیبِ بازگردانی هرگز عوض نمی‌شود:
//      Backup → Validate → Preview → Confirmation → Restore
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from '../db.js';
import { audit } from './audit.js';
import { createZip, walk, verifyZip, readZipEntry, extractZip, readZipIndex } from './zip.js';
import { projectDir, ensureProjectStorage } from './storage.js';
import { exportProjectData, importProjectData } from './dataset.js';
import { versionInfo } from '../version.js';
import { writeProjectLog } from './project-log.js';

export const BACKUP_KINDS = ['manual', 'auto', 'pre-restore', 'pre-migrate', 'pre-delete', 'pre-change'];

/** پوشه‌هایی که داخلِ بکاپ نمی‌روند (وگرنه بکاپِ بکاپ می‌گیریم) */
const SKIP_TOP = new Set(['backups', 'cache', 'node_modules', '.git']);

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export function backupsDirOf(project) {
  return path.join(projectDir(project), 'backups');
}

/**
 * بکاپِ کاملِ یک پروژه.
 * @returns ردیفِ cc_backups
 */
export async function createBackup(project, { kind = 'manual', note = null, actor = 'admin', includeFiles = true } = {}) {
  if (!BACKUP_KINDS.includes(kind)) kind = 'manual';
  await ensureProjectStorage(project);

  const dir = projectDir(project);
  const target = backupsDirOf(project);
  await fsp.mkdir(target, { recursive: true });

  const filename = `${project.slug}-${stamp()}-${kind}.zip`;
  const filePath = path.join(target, filename);

  const rowId = Number(
    db
      .prepare(
        'INSERT INTO cc_backups(project_id, filename, path, size, kind, version, status, note, created_at) VALUES(?,?,?,?,?,?,?,?,?)'
      )
      .run(project.id, filename, filePath, 0, kind, project.version || null, 'running', note, Date.now()).lastInsertRowid
  );

  try {
    const dataset = exportProjectData(project);
    const files = includeFiles
      ? await walk(dir, { skip: (name) => SKIP_TOP.has(name.split('/')[0].replace(/\/$/, '')) })
      : [];

    const manifest = {
      format: 'control-center-backup/1',
      project_id: project.project_id,
      project_name: project.name,
      slug: project.slug,
      type: project.type,
      version: project.version || null,
      kind,
      note,
      panel_version: versionInfo.version,
      created_at: Date.now(),
      created_by: actor,
      counts: { ...dataset.counts, files: files.filter((f) => !f.dir).length },
      folders: files.filter((f) => f.dir).map((f) => f.name),
    };

    const entries = [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
      { name: 'database.json', data: Buffer.from(JSON.stringify(dataset, null, 2), 'utf8') },
      ...files.map((f) => ({ ...f, name: `files/${f.name}` })),
    ];

    const result = await createZip(filePath, entries);
    const checksum = await sha256(filePath);

    db.prepare('UPDATE cc_backups SET size = ?, checksum = ?, status = ?, entries = ? WHERE id = ?').run(
      result.size,
      checksum,
      'ok',
      result.files,
      rowId
    );
    audit({
      actor,
      action: 'backup.create',
      entity: 'backup',
      entityId: rowId,
      projectId: project.id,
      detail: { filename, kind, size: result.size, files: result.files },
    });
    writeProjectLog(project, {
      category: 'backup',
      message: `بکاپ گرفته شد: ${filename}`,
      detail: { kind, size: result.size, files: result.files, actor },
    });
  } catch (e) {
    db.prepare('UPDATE cc_backups SET status = ?, error = ? WHERE id = ?').run('failed', String(e.message).slice(0, 500), rowId);
    audit({
      actor,
      action: 'backup.create',
      entity: 'backup',
      entityId: rowId,
      projectId: project.id,
      result: 'failed',
      detail: { error: e.message },
    });
    writeProjectLog(project, { category: 'backup', level: 'error', message: `بکاپ ناموفق بود: ${e.message}`, detail: { filename, kind } });
    try {
      await fsp.rm(filePath, { force: true });
    } catch { /* نبود */ }
    throw e;
  }

  return getBackup(rowId);
}

export function getBackup(id) {
  return db.prepare('SELECT * FROM cc_backups WHERE id = ?').get(Number(id)) || null;
}

export function listBackups(projectId = null) {
  if (projectId == null) {
    return db
      .prepare(
        `SELECT b.*, p.name AS project_name, p.project_id AS project_public_id
           FROM cc_backups b JOIN cc_projects p ON p.id = b.project_id
       ORDER BY b.created_at DESC LIMIT 500`
      )
      .all();
  }
  return db.prepare('SELECT * FROM cc_backups WHERE project_id = ? ORDER BY created_at DESC').all(Number(projectId));
}

/** گامِ Validate — فایل واقعاً هست، سالم است و مالِ همین پروژه است */
export async function validateBackup(backup, project) {
  const out = { ok: false, exists: false, checksum: null, checksumOk: null, zip: null, manifest: null, errors: [] };
  if (!backup) {
    out.errors.push('backup_not_found');
    return out;
  }
  if (Number(backup.project_id) !== Number(project.id)) {
    out.errors.push('wrong_project');
    return out;
  }
  if (!fs.existsSync(backup.path)) {
    out.errors.push('file_missing');
    return out;
  }
  out.exists = true;

  try {
    out.checksum = await sha256(backup.path);
    out.checksumOk = backup.checksum ? out.checksum === backup.checksum : null;
    if (out.checksumOk === false) out.errors.push('checksum_mismatch');
  } catch (e) {
    out.errors.push(`checksum_failed:${e.message}`);
  }

  try {
    out.zip = await verifyZip(backup.path);
    if (!out.zip.ok) out.errors.push('archive_corrupt');
  } catch (e) {
    out.errors.push(`archive_unreadable:${e.message}`);
    return out;
  }

  try {
    const raw = await readZipEntry(backup.path, 'manifest.json');
    out.manifest = raw ? JSON.parse(raw.toString('utf8')) : null;
  } catch {
    out.manifest = null;
  }
  if (!out.manifest) out.errors.push('manifest_missing');
  else if (out.manifest.project_id !== project.project_id) out.errors.push('manifest_project_mismatch');

  out.ok = out.errors.length === 0;
  return out;
}

/** گامِ Preview — قبل از تأیید، دقیقاً می‌گوید چه چیزی برمی‌گردد */
export async function previewRestore(backup, project) {
  const validation = await validateBackup(backup, project);
  if (!validation.exists) return { validation, preview: null };

  const index = await readZipIndex(backup.path);
  const files = index.entries.filter((e) => !e.dir && e.name.startsWith('files/'));
  const byTop = {};
  for (const f of files) {
    const top = f.name.slice('files/'.length).split('/')[0] || '(ریشه)';
    byTop[top] = byTop[top] || { files: 0, bytes: 0 };
    byTop[top].files++;
    byTop[top].bytes += f.size;
  }

  let dataset = null;
  try {
    const raw = await readZipEntry(backup.path, 'database.json');
    const parsed = raw ? JSON.parse(raw.toString('utf8')) : null;
    if (parsed) dataset = { counts: parsed.counts || {}, secrets: (parsed.secrets || []).map((s) => s.name) };
  } catch { /* بدونِ بخشِ دیتابیس */ }

  const current = db
    .prepare('SELECT COUNT(*) AS n FROM cc_app_users WHERE project_id = ?')
    .get(project.id).n;

  return {
    validation,
    preview: {
      manifest: validation.manifest,
      folders: byTop,
      totalFiles: files.length,
      totalBytes: files.reduce((s, f) => s + f.size, 0),
      dataset,
      willReplace: {
        directory: projectDir(project),
        databaseRows: dataset?.counts || {},
        currentUsers: current,
      },
    },
  };
}

/**
 * گامِ Restore — فقط با confirm انجام می‌شود و همیشه اول یک بکاپِ ایمنی می‌گیرد.
 * هیچ پروژهٔ دیگری لمس نمی‌شود.
 */
export async function restoreBackup(backup, project, { actor = 'admin', confirm = false, restoreFiles = true, restoreData = true } = {}) {
  if (!confirm) throw new Error('confirmation_required');
  const validation = await validateBackup(backup, project);
  if (!validation.ok) {
    audit({ actor, action: 'backup.restore', entity: 'backup', entityId: backup?.id, projectId: project.id, result: 'rejected', detail: { errors: validation.errors } });
    const err = new Error('validation_failed');
    err.detail = validation;
    throw err;
  }

  // بکاپِ ایمنی از وضعیتِ فعلی — اگر بازگردانی بد از آب درآمد، راهِ برگشت هست
  let safety = null;
  try {
    safety = await createBackup(project, { kind: 'pre-restore', note: `پیش از بازگردانیِ ${backup.filename}`, actor });
  } catch (e) {
    audit({ actor, action: 'backup.restore', projectId: project.id, result: 'failed', detail: { stage: 'safety_backup', error: e.message } });
    throw new Error(`safety_backup_failed: ${e.message}`);
  }

  const report = { safetyBackupId: safety?.id || null, files: null, data: null };
  const dir = projectDir(project);

  if (restoreFiles) {
    await ensureProjectStorage(project);
    // فقط شاخهٔ files/ باز می‌شود و دقیقاً داخل پوشهٔ همین پروژه
    report.files = await extractZip(backup.path, dir, {
      filter: (entry) => entry.name.startsWith('files/'),
    });
    // نامِ ورودی‌ها با پیشوندِ files/ باز شده‌اند؛ محتوا را یک سطح بالا می‌بریم
    const staged = path.join(dir, 'files');
    if (fs.existsSync(staged)) {
      await mergeTree(staged, dir);
      await fsp.rm(staged, { recursive: true, force: true });
    }
  }

  if (restoreData) {
    const raw = await readZipEntry(backup.path, 'database.json');
    if (raw) {
      const dataset = JSON.parse(raw.toString('utf8'));
      report.data = importProjectData(project, dataset, { replace: true });
    }
  }

  audit({
    actor,
    action: 'backup.restore',
    entity: 'backup',
    entityId: backup.id,
    projectId: project.id,
    detail: { filename: backup.filename, ...report },
  });
  writeProjectLog(project, {
    category: 'backup',
    level: 'warn',
    message: `بازگردانی از ${backup.filename} انجام شد`,
    detail: { actor, safetyBackupId: report.safetyBackupId, files: report.files, data: report.data },
  });
  return { ok: true, ...report, validation };
}

/** محتوای یک پوشه را روی پوشهٔ دیگر می‌ریزد (فایل‌های هم‌نام جایگزین می‌شوند) */
async function mergeTree(from, to) {
  for (const entry of await fsp.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await fsp.mkdir(dst, { recursive: true });
      await mergeTree(src, dst);
    } else if (entry.isFile()) {
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.copyFile(src, dst);
    }
  }
}

export async function deleteBackup(backup, project, actor = 'admin') {
  if (!backup || Number(backup.project_id) !== Number(project.id)) return false;
  try {
    await fsp.rm(backup.path, { force: true });
  } catch { /* فایل از قبل نبود */ }
  db.prepare('DELETE FROM cc_backups WHERE id = ?').run(backup.id);
  audit({ actor, action: 'backup.delete', entity: 'backup', entityId: backup.id, projectId: project.id, detail: { filename: backup.filename } });
  return true;
}

/** بکاپ‌های قدیمی را کم می‌کند — همیشه چند تای آخر می‌مانند */
export async function pruneBackups(project, keep = 10) {
  const rows = db
    .prepare("SELECT * FROM cc_backups WHERE project_id = ? AND kind IN ('auto','manual') ORDER BY created_at DESC")
    .all(project.id);
  const extra = rows.slice(keep);
  let removed = 0;
  for (const row of extra) {
    if (await deleteBackup(row, project, 'system')) removed++;
  }
  return removed;
}
