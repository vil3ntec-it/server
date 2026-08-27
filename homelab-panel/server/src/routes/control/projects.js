// ---------------------------------------------------------------------------
//  پروژه‌ها — هستهٔ مرکز فرمان
//  هر پروژه صفحهٔ خودش، پوشهٔ خودش و شناسهٔ ثابتِ خودش را دارد.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db } from '../../db.js';
import {
  listProjects,
  createProject,
  updateProject,
  projectBundle,
  PROJECT_TYPES,
  ips as ipModel,
  ports as portModel,
  endpoints as endpointModel,
  endpointUrl,
} from '../../control/models.js';
import { ensureProjectStorage, projectDir, dirStats, foldersFor } from '../../control/storage.js';
import { createBackup } from '../../control/backup.js';
import { auditFromReq } from '../../control/audit.js';
import { probeUrl, probeTcp, probeDatabase } from '../../control/checks.js';
import { syncMonitors } from '../../control/monitor.js';
import { guard, fail, withProject, actorOf, num, bool, str } from './_shared.js';

const router = Router();

/* ------------------------------ فهرست ---------------------------------- */

router.get(
  '/',
  guard(async (req, res) => {
    const rows = listProjects({
      type: req.query.type || null,
      status: req.query.status || null,
      q: req.query.q ? String(req.query.q).slice(0, 80) : null,
    });
    // شمارشِ سریعِ چیزهای هر پروژه، برای کارت‌های فهرست
    const enriched = rows.map((p) => ({
      ...p,
      endpoints: db.prepare('SELECT COUNT(*) AS n FROM cc_endpoints WHERE project_id = ?').get(p.id).n,
      online: db.prepare("SELECT COUNT(*) AS n FROM cc_endpoints WHERE project_id = ? AND status = 'online'").get(p.id).n,
      domains: db.prepare('SELECT COUNT(*) AS n FROM domains WHERE project_id = ?').get(p.id).n,
      openAlerts: db.prepare("SELECT COUNT(*) AS n FROM cc_alerts WHERE project_id = ? AND status = 'open'").get(p.id).n,
      lastBackup: db.prepare('SELECT created_at FROM cc_backups WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(p.id)?.created_at ?? null,
    }));
    res.json({ projects: enriched, types: PROJECT_TYPES });
  })
);

router.post(
  '/',
  guard(async (req, res) => {
    const project = createProject({
      name: str(req.body?.name, 120),
      type: req.body?.type,
      version: str(req.body?.version, 40),
      description: str(req.body?.description, 1000),
      server_id: num(req.body?.server_id),
      repo_url: str(req.body?.repo_url, 300),
      db_kind: str(req.body?.db_kind, 30),
      db_host: str(req.body?.db_host, 200),
      db_port: num(req.body?.db_port),
      db_name: str(req.body?.db_name, 120),
      slug: str(req.body?.slug, 60),
    });
    const storage = await ensureProjectStorage(project);
    auditFromReq(req, 'project.create', {
      entity: 'project',
      entityId: project.project_id,
      projectId: project.id,
      detail: { name: project.name, type: project.type, dir: storage.dir },
    });
    syncMonitors();
    res.status(201).json({ project, storage });
  })
);

/* ---------------------------- یک پروژه --------------------------------- */

router.get(
  '/:id',
  withProject,
  guard(async (req, res) => {
    const bundle = projectBundle(req.project);
    const dir = projectDir(req.project);
    const stats = await dirStats(dir);
    res.json({
      ...bundle,
      endpoints: bundle.endpoints.map((e) => ({ ...e, url: endpointUrl(e) })),
      storage: { dir, folders: foldersFor(req.project.type), ...stats },
    });
  })
);

router.patch(
  '/:id',
  withProject,
  guard(async (req, res) => {
    const before = { ...req.project };
    const project = updateProject(req.project.id, {
      name: str(req.body?.name, 120),
      type: req.body?.type,
      version: str(req.body?.version, 40),
      status: req.body?.status,
      description: str(req.body?.description, 1000),
      server_id: req.body?.server_id === null ? null : num(req.body?.server_id),
      repo_url: str(req.body?.repo_url, 300),
      db_kind: str(req.body?.db_kind, 30),
      db_host: str(req.body?.db_host, 200),
      db_port: num(req.body?.db_port),
      db_name: str(req.body?.db_name, 120),
    });
    auditFromReq(req, 'project.update', {
      entity: 'project',
      entityId: project.project_id,
      projectId: project.id,
      detail: { before: { name: before.name, type: before.type }, after: { name: project.name, type: project.type } },
    });
    syncMonitors();
    res.json({ project });
  })
);

/**
 * حذف — همیشه با بکاپ و تأیید.
 * فایل‌های روی دیسک فقط وقتی می‌روند که صریحاً خواسته شود؛ پیش‌فرض این است
 * که پوشهٔ پروژه دست‌نخورده بماند.
 */
router.delete(
  '/:id',
  withProject,
  guard(async (req, res) => {
    if (!bool(req.query.confirm ?? req.body?.confirm)) return fail(res, 400, 'confirmation_required');
    const project = req.project;

    let backup = null;
    try {
      backup = await createBackup(project, { kind: 'pre-delete', note: 'پیش از حذفِ پروژه', actor: actorOf(req) });
    } catch (e) {
      return fail(res, 500, 'backup_before_delete_failed', e.message);
    }

    db.prepare('DELETE FROM cc_projects WHERE id = ?').run(project.id);

    let removedDir = null;
    if (bool(req.query.deleteFiles ?? req.body?.deleteFiles)) {
      const fsp = await import('node:fs/promises');
      const dir = projectDir(project);
      await fsp.rm(dir, { recursive: true, force: true });
      removedDir = dir;
    }

    auditFromReq(req, 'project.delete', {
      entity: 'project',
      entityId: project.project_id,
      projectId: project.id,
      detail: { name: project.name, backup: backup?.filename, removedDir },
    });
    syncMonitors();
    res.json({ ok: true, backup, removedDir });
  })
);

/* --------------------------- پوشهٔ پروژه ------------------------------- */

router.post(
  '/:id/storage/ensure',
  withProject,
  guard(async (req, res) => {
    const storage = await ensureProjectStorage(req.project);
    auditFromReq(req, 'project.storage.ensure', { entity: 'project', entityId: req.project.project_id, projectId: req.project.id, detail: storage });
    res.json(storage);
  })
);

/* ------------------------------- IPها ---------------------------------- */

router.get(
  '/:id/ips',
  withProject,
  guard(async (req, res) => res.json({ ips: ipModel.list(req.project.id) }))
);

router.post(
  '/:id/ips',
  withProject,
  guard(async (req, res) => {
    const address = str(req.body?.address, 60);
    if (!address) return fail(res, 400, 'address_required');
    const family = address.includes(':') ? 'ipv6' : 'ipv4';
    const row = ipModel.create(req.project.id, {
      address,
      family: req.body?.family || family,
      kind: req.body?.kind || 'local',
      server_id: num(req.body?.server_id),
      port: num(req.body?.port),
      environment: req.body?.environment || 'production',
      description: str(req.body?.description, 300),
      status: 'unknown',
    });
    auditFromReq(req, 'ip.create', { entity: 'ip', entityId: row.id, projectId: req.project.id, detail: { address, kind: row.kind } });
    res.status(201).json({ ip: row });
  })
);

router.patch(
  '/:id/ips/:ipId',
  withProject,
  guard(async (req, res) => {
    const row = ipModel.update(req.params.ipId, req.body || {}, req.project.id);
    if (!row) return fail(res, 404, 'not_found');
    auditFromReq(req, 'ip.update', { entity: 'ip', entityId: row.id, projectId: req.project.id });
    res.json({ ip: row });
  })
);

router.delete(
  '/:id/ips/:ipId',
  withProject,
  guard(async (req, res) => {
    if (!ipModel.remove(req.params.ipId, req.project.id)) return fail(res, 404, 'not_found');
    auditFromReq(req, 'ip.delete', { entity: 'ip', entityId: req.params.ipId, projectId: req.project.id });
    res.json({ ok: true });
  })
);

/* ------------------------------ پورت‌ها -------------------------------- */

/** «هیچ پورتی بدون بررسی ثبت نشود» — تداخل و وضعیتِ واقعی هر دو سنجیده می‌شوند */
async function inspectPort({ port, protocol, serverId, host, excludeId = null }) {
  const conflicts = db
    .prepare(
      `SELECT p.*, pr.name AS project_name, pr.project_id AS project_public_id
         FROM cc_ports p LEFT JOIN cc_projects pr ON pr.id = p.project_id
        WHERE p.port = ? AND IFNULL(p.server_id, -1) = IFNULL(?, -1) AND p.id != IFNULL(?, -1)`
    )
    .all(Number(port), serverId ?? null, excludeId);
  const probe = host ? await probeTcp(host, port, 4000) : null;
  return {
    port: Number(port),
    protocol,
    conflicts,
    inUseByOther: conflicts.length > 0,
    probe,
    // اگر پورت باز است ولی مالِ هیچ پروژه‌ای ثبت نشده، خبر می‌دهیم
    listeningButUnregistered: Boolean(probe?.status === 'online' && conflicts.length === 0),
  };
}

router.post(
  '/:id/ports/inspect',
  withProject,
  guard(async (req, res) => {
    const port = num(req.body?.port);
    if (!port || port < 1 || port > 65535) return fail(res, 400, 'invalid_port');
    const serverId = num(req.body?.server_id) ?? req.project.server_id ?? null;
    const server = serverId ? db.prepare('SELECT * FROM cc_servers WHERE id = ?').get(serverId) : null;
    const host = str(req.body?.host, 200) || server?.ip || server?.hostname || '127.0.0.1';
    res.json(await inspectPort({ port, protocol: req.body?.protocol || 'tcp', serverId, host }));
  })
);

router.get(
  '/:id/ports',
  withProject,
  guard(async (req, res) => res.json({ ports: portModel.list(req.project.id) }))
);

router.post(
  '/:id/ports',
  withProject,
  guard(async (req, res) => {
    const port = num(req.body?.port);
    if (!port || port < 1 || port > 65535) return fail(res, 400, 'invalid_port');
    const serverId = num(req.body?.server_id) ?? req.project.server_id ?? null;
    const server = serverId ? db.prepare('SELECT * FROM cc_servers WHERE id = ?').get(serverId) : null;
    const host = str(req.body?.host, 200) || server?.ip || server?.hostname || '127.0.0.1';
    const inspection = await inspectPort({ port, protocol: req.body?.protocol || 'tcp', serverId, host });

    // ثبت فقط با آگاهی: یا تداخلی نیست، یا مدیر صریحاً تأیید کرده
    if (inspection.inUseByOther && !bool(req.body?.force)) {
      return res.status(409).json({ error: 'port_conflict', inspection });
    }

    const row = portModel.create(req.project.id, {
      port,
      protocol: req.body?.protocol || 'tcp',
      service: str(req.body?.service, 80),
      server_id: serverId,
      environment: req.body?.environment || 'production',
      note: str(req.body?.note, 300),
    });
    db.prepare('UPDATE cc_ports SET status = ?, checked_at = ? WHERE id = ?').run(
      inspection.probe?.status || 'unknown',
      Date.now(),
      row.id
    );
    auditFromReq(req, 'port.create', {
      entity: 'port',
      entityId: row.id,
      projectId: req.project.id,
      detail: { port, protocol: row.protocol, conflicts: inspection.conflicts.length },
    });
    res.status(201).json({ port: { ...row, status: inspection.probe?.status || 'unknown' }, inspection });
  })
);

router.delete(
  '/:id/ports/:portId',
  withProject,
  guard(async (req, res) => {
    if (!portModel.remove(req.params.portId, req.project.id)) return fail(res, 404, 'not_found');
    auditFromReq(req, 'port.delete', { entity: 'port', entityId: req.params.portId, projectId: req.project.id });
    res.json({ ok: true });
  })
);

/* ----------------------------- Endpointها ------------------------------ */

const PROTOCOLS = ['http', 'https', 'ws', 'wss'];

router.get(
  '/:id/endpoints',
  withProject,
  guard(async (req, res) => {
    const rows = endpointModel.list(req.project.id).map((e) => ({ ...e, url: endpointUrl(e) }));
    res.json({ endpoints: rows });
  })
);

router.post(
  '/:id/endpoints',
  withProject,
  guard(async (req, res) => {
    const protocol = String(req.body?.protocol || '').toLowerCase();
    if (!PROTOCOLS.includes(protocol)) return fail(res, 400, 'invalid_protocol');
    const host = str(req.body?.host, 200) || str(req.body?.ip, 60);
    if (!host) return fail(res, 400, 'host_required');

    const row = endpointModel.create(req.project.id, {
      protocol,
      host,
      ip: str(req.body?.ip, 60),
      port: num(req.body?.port),
      path: str(req.body?.path, 300) || '/',
      name: str(req.body?.name, 80),
      environment: req.body?.environment || 'production',
      server_id: num(req.body?.server_id) ?? req.project.server_id ?? null,
      is_primary: bool(req.body?.is_primary) ? 1 : 0,
      monitored: bool(req.body?.monitored, true) ? 1 : 0,
    });

    // فقط یک Endpoint در هر محیط می‌تواند «اصلی» باشد
    if (row.is_primary) {
      db.prepare('UPDATE cc_endpoints SET is_primary = 0 WHERE project_id = ? AND environment = ? AND id != ?').run(
        req.project.id,
        row.environment,
        row.id
      );
    }

    auditFromReq(req, 'endpoint.create', { entity: 'endpoint', entityId: row.id, projectId: req.project.id, detail: { url: endpointUrl(row) } });
    syncMonitors();
    res.status(201).json({ endpoint: { ...row, url: endpointUrl(row) } });
  })
);

router.patch(
  '/:id/endpoints/:epId',
  withProject,
  guard(async (req, res) => {
    const row = endpointModel.update(req.params.epId, req.body || {}, req.project.id);
    if (!row) return fail(res, 404, 'not_found');
    if (row.is_primary) {
      db.prepare('UPDATE cc_endpoints SET is_primary = 0 WHERE project_id = ? AND environment = ? AND id != ?').run(
        req.project.id,
        row.environment,
        row.id
      );
    }
    auditFromReq(req, 'endpoint.update', { entity: 'endpoint', entityId: row.id, projectId: req.project.id });
    syncMonitors();
    res.json({ endpoint: { ...row, url: endpointUrl(row) } });
  })
);

router.delete(
  '/:id/endpoints/:epId',
  withProject,
  guard(async (req, res) => {
    if (!endpointModel.remove(req.params.epId, req.project.id)) return fail(res, 404, 'not_found');
    auditFromReq(req, 'endpoint.delete', { entity: 'endpoint', entityId: req.params.epId, projectId: req.project.id });
    syncMonitors();
    res.json({ ok: true });
  })
);

/** آزمایشِ واقعیِ یک Endpoint — نتیجه همان لحظه ذخیره می‌شود */
router.post(
  '/:id/endpoints/:epId/test',
  withProject,
  guard(async (req, res) => {
    const row = endpointModel.get(req.params.epId, req.project.id);
    if (!row) return fail(res, 404, 'not_found');
    const url = endpointUrl(row);
    if (!url) return fail(res, 400, 'incomplete_endpoint');
    const result = await probeUrl(url, { timeout: 9000 });
    db.prepare('UPDATE cc_endpoints SET status = ?, status_code = ?, latency_ms = ?, error = ?, checked_at = ? WHERE id = ?').run(
      result.status,
      result.code ?? null,
      result.latencyMs ?? null,
      result.error ?? null,
      Date.now(),
      row.id
    );
    res.json({ url, result });
  })
);

/** آزمایشِ همهٔ چیزهای یک پروژه با هم */
router.post(
  '/:id/test',
  withProject,
  guard(async (req, res) => {
    const project = req.project;
    const endpoints = endpointModel.list(project.id);
    const results = [];

    for (const e of endpoints) {
      const url = endpointUrl(e);
      if (!url) continue;
      const result = await probeUrl(url, { timeout: 9000 });
      db.prepare('UPDATE cc_endpoints SET status = ?, status_code = ?, latency_ms = ?, error = ?, checked_at = ? WHERE id = ?').run(
        result.status,
        result.code ?? null,
        result.latencyMs ?? null,
        result.error ?? null,
        Date.now(),
        e.id
      );
      results.push({ kind: 'endpoint', id: e.id, label: e.name || e.environment, url, ...result });
    }

    for (const p of portModel.list(project.id)) {
      const server = p.server_id ? db.prepare('SELECT * FROM cc_servers WHERE id = ?').get(p.server_id) : null;
      const host = server?.ip || server?.hostname || '127.0.0.1';
      const result = await probeTcp(host, p.port, 5000);
      db.prepare('UPDATE cc_ports SET status = ?, checked_at = ? WHERE id = ?').run(result.status, Date.now(), p.id);
      results.push({ kind: 'port', id: p.id, label: `${p.service || p.protocol} :${p.port}`, url: `${host}:${p.port}`, ...result });
    }

    if (project.db_kind && project.db_kind !== 'none' && project.db_host) {
      const result = await probeDatabase({ kind: project.db_kind, host: project.db_host, port: project.db_port });
      results.push({ kind: 'database', id: project.id, label: `${project.db_kind} ${project.db_name || ''}`.trim(), url: `${project.db_host}:${result.port}`, ...result });
    }

    auditFromReq(req, 'project.test', { entity: 'project', entityId: project.project_id, projectId: project.id, detail: { checks: results.length } });
    res.json({ results, checkedAt: Date.now() });
  })
);

export default router;
