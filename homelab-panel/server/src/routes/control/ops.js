// ---------------------------------------------------------------------------
//  عملیات — مانیتورینگ، هشدارها، دفترِ رخدادها، گاوصندوق، جابه‌جایی، به‌روزرسانی
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db } from '../../db.js';
import { listAlerts, ackAlert, resolveAlert } from '../../control/alerts.js';
import { listAudit } from '../../control/audit.js';
import { auditFromReq } from '../../control/audit.js';
import { monitorSummary, monitorHistory, checkMonitor, syncMonitors, tick } from '../../control/monitor.js';
import { listSecrets, putSecret, deleteSecret, vaultHealth, SECRET_KINDS } from '../../control/vault.js';
import { planMigration, migrateProject, listMigrations } from '../../control/migrate.js';
import * as updater from '../../update/github.js';
import { setSetting, getSetting } from '../../db.js';
import { guard, fail, withProject, actorOf, num, str, bool, rateLimit } from './_shared.js';

const router = Router();

/* ---------------------------- مانیتورینگ ------------------------------- */

router.get(
  '/monitoring',
  guard(async (req, res) => res.json(monitorSummary()))
);

router.post(
  '/monitoring/sync',
  guard(async (req, res) => {
    const result = syncMonitors();
    auditFromReq(req, 'monitor.sync', { entity: 'monitor', detail: result });
    res.json(result);
  })
);

router.post(
  '/monitoring/run',
  rateLimit({ windowMs: 60000, max: 6 }),
  guard(async (req, res) => res.json(await tick()))
);

router.get(
  '/monitoring/:id/history',
  guard(async (req, res) => res.json({ history: monitorHistory(req.params.id, num(req.query.limit, 60)) }))
);

router.post(
  '/monitoring/:id/check',
  rateLimit({ windowMs: 60000, max: 40 }),
  guard(async (req, res) => {
    const result = await checkMonitor(req.params.id);
    if (!result) return fail(res, 404, 'not_found');
    res.json({ result });
  })
);

router.patch(
  '/monitoring/:id',
  guard(async (req, res) => {
    const row = db.prepare('SELECT * FROM cc_monitors WHERE id = ?').get(num(req.params.id));
    if (!row) return fail(res, 404, 'not_found');
    const data = {};
    if (req.body?.enabled !== undefined) data.enabled = bool(req.body.enabled) ? 1 : 0;
    if (req.body?.interval_sec !== undefined) data.interval_sec = Math.max(30, Math.min(86400, num(req.body.interval_sec, 300)));
    if (Object.keys(data).length) {
      data.updated_at = Date.now();
      const cols = Object.keys(data);
      db.prepare(`UPDATE cc_monitors SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), row.id);
    }
    res.json({ monitor: db.prepare('SELECT * FROM cc_monitors WHERE id = ?').get(row.id) });
  })
);

/* ------------------------------ هشدارها -------------------------------- */

router.get(
  '/alerts',
  guard(async (req, res) => {
    res.json({
      alerts: listAlerts({
        status: req.query.status || 'open',
        limit: num(req.query.limit, 200),
        projectId: req.query.project_id ? num(req.query.project_id) : null,
      }),
      counts: Object.fromEntries(
        db.prepare('SELECT status, COUNT(*) AS n FROM cc_alerts GROUP BY status').all().map((r) => [r.status, r.n])
      ),
    });
  })
);

router.post(
  '/alerts/:id/ack',
  guard(async (req, res) => {
    if (!ackAlert(req.params.id)) return fail(res, 404, 'not_found');
    auditFromReq(req, 'alert.ack', { entity: 'alert', entityId: req.params.id });
    res.json({ ok: true });
  })
);

router.post(
  '/alerts/:id/resolve',
  guard(async (req, res) => {
    if (!resolveAlert(req.params.id)) return fail(res, 404, 'not_found');
    auditFromReq(req, 'alert.resolve', { entity: 'alert', entityId: req.params.id });
    res.json({ ok: true });
  })
);

/* --------------------------- دفترِ رخدادها ----------------------------- */

router.get(
  '/audit',
  guard(async (req, res) => {
    res.json(
      listAudit({
        limit: num(req.query.limit, 200),
        offset: num(req.query.offset, 0),
        projectId: req.query.project_id ? num(req.query.project_id) : null,
        action: req.query.action || null,
        q: req.query.q ? String(req.query.q).slice(0, 80) : null,
      })
    );
  })
);

/* ----------------------------- گاوصندوق -------------------------------- */

router.get(
  '/vault',
  guard(async (req, res) => {
    res.json({
      secrets: listSecrets({
        scope: req.query.scope || null,
        projectId: req.query.project_id ? num(req.query.project_id) : null,
        serverId: req.query.server_id ? num(req.query.server_id) : null,
      }),
      kinds: SECRET_KINDS,
      health: vaultHealth(),
    });
  })
);

router.post(
  '/vault',
  rateLimit({ windowMs: 60000, max: 20 }),
  guard(async (req, res) => {
    // ⚠️ مقدار فقط از این‌جا می‌رود داخل و دیگر هرگز بیرون نمی‌آید
    const secret = putSecret({
      name: str(req.body?.name, 120),
      kind: req.body?.kind || 'other',
      scope: req.body?.scope || 'global',
      projectId: num(req.body?.project_id),
      serverId: num(req.body?.server_id),
      value: req.body?.value,
      note: str(req.body?.note, 300),
      actor: actorOf(req),
    });
    res.status(201).json({ secret });
  })
);

router.delete(
  '/vault/:id',
  guard(async (req, res) => {
    if (!deleteSecret(req.params.id, actorOf(req))) return fail(res, 404, 'not_found');
    res.json({ ok: true });
  })
);

/* ---------------------------- جابه‌جایی -------------------------------- */

router.get(
  '/projects/:id/migrations',
  withProject,
  guard(async (req, res) => res.json({ migrations: listMigrations(req.project.id) }))
);

router.post(
  '/projects/:id/migrate/plan',
  withProject,
  guard(async (req, res) => res.json(planMigration(req.project, num(req.body?.to_server_id))))
);

router.post(
  '/projects/:id/migrate',
  withProject,
  rateLimit({ windowMs: 300000, max: 3 }),
  guard(async (req, res) => {
    const ssh = req.body?.ssh
      ? {
          host: str(req.body.ssh.host, 200),
          user: str(req.body.ssh.user, 60),
          port: num(req.body.ssh.port),
          targetDir: str(req.body.ssh.targetDir, 300),
        }
      : null;
    const result = await migrateProject(req.project, {
      toServerId: num(req.body?.to_server_id),
      actor: actorOf(req),
      ssh,
      confirm: bool(req.body?.confirm),
      updateEndpoints: bool(req.body?.updateEndpoints, true),
    });
    res.json(result);
  })
);

/* -------------------------- به‌روزرسانی از GitHub ---------------------- */

router.get(
  '/update',
  guard(async (req, res) => {
    res.json({ status: updater.updateStatus(), pending: getSetting('cc_update_pending', null) });
  })
);

router.post(
  '/update/check',
  rateLimit({ windowMs: 60000, max: 10 }),
  guard(async (req, res) => {
    const info = await updater.checkForUpdate({ force: bool(req.body?.force) });
    setSetting('cc_update_pending', info.available ? { latest: info.latest, at: Date.now() } : null);
    res.json(info);
  })
);

router.post(
  '/update/settings',
  guard(async (req, res) => {
    if (req.body?.repo !== undefined) {
      const repo = str(req.body.repo, 120);
      if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) return fail(res, 400, 'invalid_repo');
      setSetting('cc_update_repo', repo);
    }
    if (req.body?.channel !== undefined) setSetting('cc_update_channel', req.body.channel === 'branch' ? 'branch' : 'release');
    if (req.body?.branch !== undefined) setSetting('cc_update_branch', str(req.body.branch, 80) || 'main');
    if (req.body?.autoCheck !== undefined) setSetting('cc_update_autocheck', bool(req.body.autoCheck, true));
    if (req.body?.token) {
      putSecret({
        name: updater.GITHUB_TOKEN_SECRET,
        kind: 'deploy',
        scope: 'global',
        value: String(req.body.token),
        note: 'توکنِ GitHub برای به‌روزرسانی',
        actor: actorOf(req),
      });
    }
    auditFromReq(req, 'update.settings', { entity: 'panel', detail: { repo: req.body?.repo, channel: req.body?.channel, branch: req.body?.branch } });
    res.json({ status: updater.updateStatus() });
  })
);

/**
 * نصبِ نسخهٔ تازه. مراحل به ترتیب انجام می‌شوند و اگر هرکدام بخورد زمین،
 * نصبِ فعلی دست‌نخورده می‌ماند.
 */
router.post(
  '/update/install',
  rateLimit({ windowMs: 600000, max: 3 }),
  guard(async (req, res) => {
    if (!bool(req.body?.confirm)) return fail(res, 400, 'confirmation_required');
    const info = await updater.checkForUpdate({ force: bool(req.body?.force) });
    if (!info.available && !bool(req.body?.force)) return res.json({ ok: false, reason: 'already_up_to_date', info });
    if (info.error) return fail(res, 502, 'github_unreachable', info.error);

    const downloaded = await updater.downloadUpdate(info);
    try {
      const result = await updater.applyUpdate(info, downloaded, {
        actor: actorOf(req),
        restart: bool(req.body?.restart, true),
      });
      setSetting('cc_update_pending', null);
      res.json({ ok: true, info, downloaded: { size: downloaded.size, checksum: downloaded.checksum }, ...result });
    } catch (e) {
      return res.status(500).json({ error: 'update_failed', detail: e.message, steps: e.steps || [] });
    }
  })
);

router.post(
  '/update/rollback',
  rateLimit({ windowMs: 600000, max: 3 }),
  guard(async (req, res) => {
    if (!bool(req.body?.confirm)) return fail(res, 400, 'confirmation_required');
    res.json(await updater.rollback({ actor: actorOf(req) }));
  })
);

export default router;
