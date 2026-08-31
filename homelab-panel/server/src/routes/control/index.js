// ---------------------------------------------------------------------------
//  مرکز فرمان — نقطهٔ اتصالِ همهٔ مسیرها
//
//  سه دسته مسیر داریم و هرکدام درِ ورودیِ خودش را دارد:
//      /api/control/*        → فقط مدیرِ واردشده (requireAuth در index اصلی)
//      /api/control/agent/*  → Agentها با امضای HMAC
//      /api/app-config/*     → خودِ برنامه‌ها با توکنِ پروژه
// ---------------------------------------------------------------------------
import express, { Router } from 'express';
import os from 'node:os';
import { db, getSetting } from '../../db.js';
import { overviewCounts, listProjects, getProject } from '../../control/models.js';
import { listAlerts } from '../../control/alerts.js';
import { monitorSummary } from '../../control/monitor.js';
import { storageRoot, storageChosen, diskFree } from '../../control/storage.js';
import { vaultReady } from '../../control/vault.js';
import { verifyReport, storeReport } from '../../control/agent.js';
import { resolvedConfig, verifyConfigToken } from '../../control/config-store.js';
import { latestRelease } from '../../control/releases.js';
import { updateStatus } from '../../update/github.js';
import { versionInfo } from '../../version.js';
import { audit } from '../../control/audit.js';
import { guard, fail, str, rateLimit, clientIp } from './_shared.js';

import projectsRoutes from './projects.js';
import serversRoutes from './servers.js';
import networkRoutes from './network.js';
import accountsRoutes from './accounts.js';
import storageRoutes from './storage.js';
import opsRoutes from './ops.js';

/* ============================ مسیرهای مدیر ============================== */

const router = Router();

/** داشبوردِ مرکز فرمان — همان «مرکزِ فرمان» صفحهٔ اول */
router.get(
  '/overview',
  guard(async (req, res) => {
    const counts = overviewCounts();
    const monitors = monitorSummary();
    const root = storageRoot();

    const projects = listProjects().map((p) => ({
      id: p.id,
      project_id: p.project_id,
      name: p.name,
      type: p.type,
      status: p.status,
      server_name: p.server_name,
      endpoints: db.prepare('SELECT COUNT(*) AS n FROM cc_endpoints WHERE project_id = ?').get(p.id).n,
      online: db.prepare("SELECT COUNT(*) AS n FROM cc_endpoints WHERE project_id = ? AND status = 'online'").get(p.id).n,
      down: db.prepare("SELECT COUNT(*) AS n FROM cc_endpoints WHERE project_id = ? AND status NOT IN ('online','unknown')").get(p.id).n,
    }));

    const servers = db
      .prepare('SELECT id, server_id, name, kind, status, is_local, agent_seen, ip, hostname FROM cc_servers ORDER BY is_local DESC, name')
      .all();

    const ssl = db
      .prepare(
        `SELECT name, ssl_status, ssl_expires FROM domains
          WHERE ssl_expires IS NOT NULL ORDER BY ssl_expires ASC LIMIT 10`
      )
      .all();

    res.json({
      panel: { version: versionInfo.version, build: versionInfo.build, hostname: os.hostname(), startedAt: versionInfo.startedAt },
      counts,
      projects,
      servers,
      monitors: monitors.byKind,
      alerts: listAlerts({ status: 'open', limit: 20 }),
      ssl,
      storage: { root, chosen: storageChosen(), disk: await diskFree(root) },
      vault: { ready: vaultReady() },
      update: { ...updateStatus(), pending: getSetting('cc_update_pending', null) },
      lastBackups: db
        .prepare(
          `SELECT b.id, b.filename, b.size, b.status, b.created_at, p.name AS project_name, p.project_id AS project_public_id
             FROM cc_backups b JOIN cc_projects p ON p.id = b.project_id
         ORDER BY b.created_at DESC LIMIT 8`
        )
        .all(),
    });
  })
);

router.use('/projects', projectsRoutes);
router.use('/projects', accountsRoutes); // فروشگاه/کاربر/اشتراکِ هر پروژه
router.use('/servers', serversRoutes);
router.use('/network', networkRoutes);
router.use('/storage', storageRoutes);
router.use('/', opsRoutes); // مانیتورینگ، هشدار، رخداد، گاوصندوق، به‌روزرسانی

/* ============================ مسیرِ Agentها ============================= */

export const agentRouter = Router();

// بدنه باید خام بماند تا امضا قابلِ سنجش باشد
agentRouter.use(express.text({ type: '*/*', limit: '512kb' }));

agentRouter.post(
  '/report',
  rateLimit({ windowMs: 60000, max: 240, key: (req) => String(req.headers['x-agent-server'] || clientIp(req)) }),
  guard(async (req, res) => {
    const serverId = str(req.headers['x-agent-server'], 60);
    const timestamp = str(req.headers['x-agent-timestamp'], 20);
    const signature = str(req.headers['x-agent-signature'], 200);
    const rawBody = typeof req.body === 'string' ? req.body : '';

    const check = verifyReport({ serverId, timestamp, signature, rawBody });
    if (!check.ok) {
      audit({ actor: `agent:${serverId || '?'}`, action: 'agent.report', result: 'rejected', ip: clientIp(req), detail: { error: check.error } });
      return fail(res, 401, check.error);
    }

    let report;
    try {
      report = JSON.parse(rawBody);
    } catch {
      return fail(res, 400, 'invalid_json');
    }

    const stored = storeReport(check.server, report);
    res.json({ ok: true, at: stored.at, interval: Number(getSetting('cc_agent_interval', 30)) });
  })
);

/* ========================= پیکربندیِ خودِ برنامه‌ها ====================== */

export const appConfigRouter = Router();

function bearer(req) {
  const header = String(req.headers.authorization || '');
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return String(req.query.token || '') || null;
}

/**
 * چیزی که برنامهٔ اندروید/دسکتاپ/وب می‌خواند:
 *     GET /api/app-config/prj_1a2b3c4d?environment=production
 * با هدرِ Authorization: Bearer <توکنِ پروژه>
 */
appConfigRouter.get(
  '/:projectId',
  rateLimit({ windowMs: 60000, max: 120, key: (req) => `${req.params.projectId}:${clientIp(req)}` }),
  guard(async (req, res) => {
    const project = getProject(req.params.projectId);
    if (!project) return fail(res, 404, 'project_not_found');

    const token = bearer(req);
    if (!token || !verifyConfigToken(project, token)) {
      audit({ actor: 'app', action: 'config.read', result: 'unauthorized', projectId: project.id, ip: clientIp(req) });
      return fail(res, 401, 'unauthorized');
    }

    const environment = ['development', 'staging', 'production'].includes(req.query.environment)
      ? req.query.environment
      : 'production';
    const payload = resolvedConfig(project, environment);

    // اگر برنامه پلتفرمش را بگوید، آخرین نسخهٔ منتشرشده را هم می‌گیرد
    const platform = str(req.query.platform, 20);
    const release = platform ? latestRelease(project, { platform, channel: str(req.query.channel, 20) || 'stable' }) : null;

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ...payload,
      update: release
        ? {
            version: release.version,
            build: release.build,
            mandatory: Boolean(release.mandatory),
            min_version: release.min_version,
            notes: release.notes,
            released_at: release.released_at,
          }
        : null,
    });
  })
);

export default router;
