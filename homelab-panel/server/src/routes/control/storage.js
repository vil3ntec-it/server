// ---------------------------------------------------------------------------
//  انبار — پوشه‌ها، بکاپ‌ها، انتشارها و پیکربندی
// ---------------------------------------------------------------------------
import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import { listProjects } from '../../control/models.js';
import {
  storageOverview,
  setStorageRoot,
  storageRoot,
  storageChosen,
  ensureProjectStorage,
  projectDir,
  orphanFolders,
  dirStats,
  diskFree,
} from '../../control/storage.js';
import {
  createBackup,
  listBackups,
  getBackup,
  validateBackup,
  previewRestore,
  restoreBackup,
  deleteBackup,
  pruneBackups,
} from '../../control/backup.js';
import * as releases from '../../control/releases.js';
import * as configStore from '../../control/config-store.js';
import { listProjectLogs, tailProjectLog, pruneProjectLogs, CATEGORIES as LOG_CATEGORIES, logsDirOf } from '../../control/project-log.js';
import { auditFromReq } from '../../control/audit.js';
import { guard, fail, withProject, actorOf, num, str, bool, rateLimit } from './_shared.js';
import { requireRole } from '../../control/roles.js';

const router = Router();

/* ---------------------------- نمای انبار ------------------------------- */

router.get(
  '/overview',
  guard(async (req, res) => {
    const projects = listProjects();
    res.json(await storageOverview(projects));
  })
);

/** انتخابِ محلِ انبار — «D:\\Projects» یا «E:\\ServerData» */
router.post(
  '/root',
  requireRole('admin'),
  guard(async (req, res) => {
    const target = str(req.body?.path, 400);
    if (!target) return fail(res, 400, 'path_required');
    const result = await setStorageRoot(target, actorOf(req));

    // پوشهٔ همهٔ پروژه‌ها در محلِ تازه ساخته می‌شود (فایل‌های قبلی جابه‌جا نمی‌شوند)
    const created = [];
    for (const project of listProjects()) {
      const info = await ensureProjectStorage(project);
      created.push({ project: project.project_id, dir: info.dir, folders: info.created });
    }
    res.json({ ...result, projects: created, warning: result.previous !== result.root ? 'فایل‌های محلِ قبلی خودکار منتقل نشدند.' : null });
  })
);

router.get(
  '/root',
  guard(async (req, res) => {
    const root = storageRoot();
    const [stats, disk] = await Promise.all([dirStats(root), diskFree(root)]);
    res.json({ root, chosen: storageChosen(), exists: fs.existsSync(root), stats, disk, orphans: await orphanFolders(listProjects()) });
  })
);

/* ------------------------------ بکاپ‌ها -------------------------------- */

router.get(
  '/backups',
  guard(async (req, res) => res.json({ backups: listBackups(req.query.project_id ? num(req.query.project_id) : null) }))
);

router.get(
  '/projects/:id/backups',
  withProject,
  guard(async (req, res) => {
    const rows = listBackups(req.project.id).map((b) => ({ ...b, file_exists: fs.existsSync(b.path) }));
    res.json({ backups: rows, dir: path.join(projectDir(req.project), 'backups') });
  })
);

router.post(
  '/projects/:id/backups',
  withProject,
  rateLimit({ windowMs: 60000, max: 6 }),
  guard(async (req, res) => {
    const backup = await createBackup(req.project, {
      kind: 'manual',
      note: str(req.body?.note, 300),
      actor: actorOf(req),
      includeFiles: bool(req.body?.includeFiles, true),
    });
    res.status(201).json({ backup });
  })
);

router.post(
  '/projects/:id/backups/:backupId/validate',
  withProject,
  guard(async (req, res) => {
    const backup = getBackup(req.params.backupId);
    res.json(await validateBackup(backup, req.project));
  })
);

router.post(
  '/projects/:id/backups/:backupId/preview',
  withProject,
  guard(async (req, res) => {
    const backup = getBackup(req.params.backupId);
    if (!backup) return fail(res, 404, 'not_found');
    res.json(await previewRestore(backup, req.project));
  })
);

/** بازگردانی — فقط با confirm، و همیشه بعد از یک بکاپِ ایمنی */
router.post(
  '/projects/:id/backups/:backupId/restore',
  requireRole('admin'),
  withProject,
  rateLimit({ windowMs: 300000, max: 5 }),
  guard(async (req, res) => {
    const backup = getBackup(req.params.backupId);
    if (!backup) return fail(res, 404, 'not_found');
    try {
      const result = await restoreBackup(backup, req.project, {
        actor: actorOf(req),
        confirm: bool(req.body?.confirm),
        restoreFiles: bool(req.body?.restoreFiles, true),
        restoreData: bool(req.body?.restoreData, true),
      });
      res.json(result);
    } catch (e) {
      if (e.message === 'validation_failed') return res.status(400).json({ error: 'validation_failed', detail: e.detail });
      throw e;
    }
  })
);

router.delete(
  '/projects/:id/backups/:backupId',
  requireRole('admin'),
  withProject,
  guard(async (req, res) => {
    const backup = getBackup(req.params.backupId);
    if (!backup) return fail(res, 404, 'not_found');
    if (!(await deleteBackup(backup, req.project, actorOf(req)))) return fail(res, 404, 'not_found');
    res.json({ ok: true });
  })
);

router.post(
  '/projects/:id/backups/prune',
  withProject,
  guard(async (req, res) => {
    const removed = await pruneBackups(req.project, Math.max(1, num(req.body?.keep, 10)));
    auditFromReq(req, 'backup.prune', { entity: 'project', entityId: req.project.project_id, projectId: req.project.id, detail: { removed } });
    res.json({ removed });
  })
);

/** دانلودِ فایلِ بکاپ — فقط از پوشهٔ بکاپِ همان پروژه */
router.get(
  '/projects/:id/backups/:backupId/download',
  withProject,
  guard(async (req, res) => {
    const backup = getBackup(req.params.backupId);
    if (!backup || Number(backup.project_id) !== Number(req.project.id)) return fail(res, 404, 'not_found');
    if (!fs.existsSync(backup.path)) return fail(res, 404, 'file_missing');
    auditFromReq(req, 'backup.download', { entity: 'backup', entityId: backup.id, projectId: req.project.id, detail: { filename: backup.filename } });
    res.download(backup.path, backup.filename);
  })
);

/* ----------------------------- انتشارها -------------------------------- */

router.get(
  '/projects/:id/releases',
  withProject,
  guard(async (req, res) => {
    res.json({
      releases: releases.listReleases(req.project, { platform: req.query.platform || null, channel: req.query.channel || null }),
      platforms: releases.PLATFORMS,
      channels: releases.CHANNELS,
      dir: releases.releasesDirOf(req.project),
      unregistered: await releases.unregisteredFiles(req.project),
    });
  })
);

router.post(
  '/projects/:id/releases',
  withProject,
  guard(async (req, res) => {
    const row = await releases.createRelease(req.project, req.body || {}, actorOf(req));
    res.status(201).json({ release: row });
  })
);

router.patch(
  '/projects/:id/releases/:releaseId',
  withProject,
  guard(async (req, res) => {
    const row = releases.updateRelease(req.project, req.params.releaseId, req.body || {}, actorOf(req));
    if (!row) return fail(res, 404, 'not_found');
    res.json({ release: row });
  })
);

router.delete(
  '/projects/:id/releases/:releaseId',
  withProject,
  guard(async (req, res) => {
    const ok = await releases.deleteRelease(req.project, req.params.releaseId, {
      deleteFile: bool(req.query.deleteFile),
      actor: actorOf(req),
    });
    if (!ok) return fail(res, 404, 'not_found');
    res.json({ ok: true });
  })
);

router.post(
  '/projects/:id/releases/:releaseId/verify',
  withProject,
  guard(async (req, res) => res.json(await releases.verifyRelease(req.project, req.params.releaseId)))
);

/* ---------------------------- پیکربندی --------------------------------- */

router.get(
  '/projects/:id/config',
  withProject,
  guard(async (req, res) => {
    const environment = configStore.ENVIRONMENTS.includes(req.query.environment) ? req.query.environment : 'production';
    res.json({
      environments: configStore.ENVIRONMENTS,
      environment,
      versions: configStore.listVersions(req.project),
      active: configStore.activeConfig(req.project, environment),
      resolved: configStore.resolvedConfig(req.project, environment),
      hasToken: configStore.configTokenExists(req.project),
    });
  })
);

router.post(
  '/projects/:id/config',
  withProject,
  guard(async (req, res) => {
    const result = configStore.saveVersion(req.project, {
      environment: req.body?.environment || 'production',
      data: req.body?.data,
      note: str(req.body?.note, 300),
      actor: actorOf(req),
      activate: bool(req.body?.activate, true),
    });
    res.status(201).json(result);
  })
);

router.get(
  '/projects/:id/config/:versionId',
  withProject,
  guard(async (req, res) => {
    const row = configStore.getVersion(req.project, req.params.versionId);
    if (!row) return fail(res, 404, 'not_found');
    res.json({ version: row });
  })
);

/** بازگشت به یک نسخهٔ قبلی */
router.post(
  '/projects/:id/config/:versionId/activate',
  withProject,
  guard(async (req, res) => res.json({ version: configStore.activateVersion(req.project, req.params.versionId, actorOf(req)) }))
);

/** توکنِ خواندنِ پیکربندی برای خودِ برنامه — فقط همین یک‌بار دیده می‌شود */
router.post(
  '/projects/:id/config/token',
  withProject,
  rateLimit({ windowMs: 60000, max: 5 }),
  guard(async (req, res) => {
    const token = configStore.issueConfigToken(req.project, actorOf(req));
    res.json({
      token,
      warning: 'این توکن دیگر نشان داده نمی‌شود.',
      example: `curl -H "Authorization: Bearer ${token}" ${req.protocol}://${req.headers.host}/api/app-config/${req.project.project_id}`,
    });
  })
);

/* ------------------------------ لاگ‌ها --------------------------------- */

router.get(
  '/projects/:id/logs',
  withProject,
  guard(async (req, res) => {
    res.json({
      files: await listProjectLogs(req.project),
      categories: LOG_CATEGORIES,
      dir: logsDirOf(req.project),
    });
  })
);

router.get(
  '/projects/:id/logs/:file',
  withProject,
  guard(async (req, res) => {
    const result = await tailProjectLog(req.project, req.params.file, {
      lines: num(req.query.lines, 300),
      level: req.query.level || null,
      q: req.query.q ? String(req.query.q).slice(0, 80) : null,
    });
    if (result.error) return fail(res, result.error === 'not_found' ? 404 : 400, result.error);
    res.json(result);
  })
);

router.post(
  '/projects/:id/logs/prune',
  withProject,
  requireRole('admin'),
  guard(async (req, res) => {
    const removed = await pruneProjectLogs(req.project, Math.max(1, num(req.body?.keepDays, 30)));
    auditFromReq(req, 'logs.prune', { entity: 'project', entityId: req.project.project_id, projectId: req.project.id, detail: { removed } });
    res.json({ removed });
  })
);

export default router;
