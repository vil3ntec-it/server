// ---------------------------------------------------------------------------
//  سرورها — خانگی، VPS، اختصاصی، ابری و هاست
// ---------------------------------------------------------------------------
import os from 'node:os';
import { Router } from 'express';
import { db, getSetting } from '../../db.js';
import { config } from '../../config.js';
import { listServers, getServer, createServer, updateServer, SERVER_KINDS, parseJson } from '../../control/models.js';
import { issueAgentKey, revokeAgentKey, agentInstructions } from '../../control/agent.js';
import { auditFromReq } from '../../control/audit.js';
import { probeTcp } from '../../control/checks.js';
import { readInterfaces } from '../../metrics/network.js';
import { syncMonitors } from '../../control/monitor.js';
import { guard, fail, actorOf, num, str, bool } from './_shared.js';
import { requireRole } from '../../control/roles.js';

const router = Router();

/** سرورِ خانگی — همین کامپیوتری که پنل رویش است — یک‌بار خودش ثبت می‌شود */
export function ensureLocalServer() {
  const existing = db.prepare('SELECT * FROM cc_servers WHERE is_local = 1').get();
  const ips = readInterfaces().map((i) => i.address);
  const ts = Date.now();
  if (existing) {
    db.prepare('UPDATE cc_servers SET ip = ?, hostname = ?, os = ?, status = ?, checked_at = ?, updated_at = ? WHERE id = ?').run(
      ips[0] || existing.ip,
      os.hostname(),
      `${os.type()} ${os.release()}`,
      'online',
      ts,
      ts,
      existing.id
    );
    return getServer(existing.id);
  }
  const server = createServer({
    name: getSetting('server_name', null) || os.hostname() || 'Home Server',
    kind: 'home',
    hostname: os.hostname(),
    ip: ips[0] || null,
    os: `${os.type()} ${os.release()}`,
    note: 'همین کامپیوتری که پنل رویش اجرا می‌شود',
    is_local: true,
  });
  db.prepare("UPDATE cc_servers SET is_local = 1, status = 'online', checked_at = ? WHERE id = ?").run(ts, server.id);
  return getServer(server.id);
}

router.get(
  '/',
  guard(async (req, res) => {
    const servers = listServers().map((s) => ({
      ...s,
      // سرورِ محلی معیارهایش را از خودِ پنل می‌گیرد، نه از Agent
      local_metrics: s.is_local
        ? { cpuCores: os.cpus().length, totalMem: os.totalmem(), uptime: Math.round(os.uptime()), platform: process.platform }
        : null,
    }));
    res.json({ servers, kinds: SERVER_KINDS });
  })
);

router.post(
  '/',
  guard(async (req, res) => {
    const server = createServer({
      name: str(req.body?.name, 120),
      kind: req.body?.kind || 'vps',
      hostname: str(req.body?.hostname, 200),
      ip: str(req.body?.ip, 60),
      ipv6: str(req.body?.ipv6, 60),
      ssh_port: num(req.body?.ssh_port),
      os: str(req.body?.os, 120),
      provider: str(req.body?.provider, 120),
      location: str(req.body?.location, 120),
      note: str(req.body?.note, 500),
    });
    auditFromReq(req, 'server.create', { entity: 'server', entityId: server.server_id, detail: { name: server.name, kind: server.kind } });
    syncMonitors();
    res.status(201).json({ server: { ...server, agent_key: undefined } });
  })
);

router.get(
  '/:id',
  guard(async (req, res) => {
    const server = getServer(req.params.id);
    if (!server) return fail(res, 404, 'not_found');
    const projects = db.prepare('SELECT id, project_id, name, type, status FROM cc_projects WHERE server_id = ?').all(server.id);
    const ports = db
      .prepare(
        `SELECT p.*, pr.name AS project_name FROM cc_ports p
      LEFT JOIN cc_projects pr ON pr.id = p.project_id WHERE p.server_id = ? ORDER BY p.port`
      )
      .all(server.id);
    const ips = db.prepare('SELECT * FROM cc_ips WHERE server_id = ?').all(server.id);
    res.json({
      server: { ...server, agent_key: undefined, has_agent: Boolean(server.agent_key), agent_report: parseJson(server.agent_report) },
      projects,
      ports,
      ips,
      alerts: db.prepare("SELECT * FROM cc_alerts WHERE server_id = ? AND status != 'resolved' ORDER BY last_at DESC LIMIT 20").all(server.id),
    });
  })
);

router.patch(
  '/:id',
  guard(async (req, res) => {
    const server = getServer(req.params.id);
    if (!server) return fail(res, 404, 'not_found');
    const updated = updateServer(server.id, {
      name: str(req.body?.name, 120),
      kind: req.body?.kind,
      hostname: str(req.body?.hostname, 200),
      ip: str(req.body?.ip, 60),
      ipv6: str(req.body?.ipv6, 60),
      ssh_port: num(req.body?.ssh_port),
      os: str(req.body?.os, 120),
      provider: str(req.body?.provider, 120),
      location: str(req.body?.location, 120),
      note: str(req.body?.note, 500),
    });
    auditFromReq(req, 'server.update', { entity: 'server', entityId: server.server_id });
    syncMonitors();
    res.json({ server: { ...updated, agent_key: undefined } });
  })
);

router.delete(
  '/:id',
  requireRole('admin'),
  guard(async (req, res) => {
    const server = getServer(req.params.id);
    if (!server) return fail(res, 404, 'not_found');
    if (server.is_local) return fail(res, 400, 'cannot_delete_local_server');
    const attached = db.prepare('SELECT COUNT(*) AS n FROM cc_projects WHERE server_id = ?').get(server.id).n;
    if (attached > 0 && !bool(req.query.confirm)) {
      return res.status(409).json({ error: 'server_has_projects', detail: { projects: attached } });
    }
    db.prepare('DELETE FROM cc_servers WHERE id = ?').run(server.id);
    auditFromReq(req, 'server.delete', { entity: 'server', entityId: server.server_id, detail: { name: server.name, projects: attached } });
    syncMonitors();
    res.json({ ok: true });
  })
);

/** آیا سرور از این‌جا در دسترس است؟ (پورتِ SSH یا پورتِ داده‌شده) */
router.post(
  '/:id/test',
  guard(async (req, res) => {
    const server = getServer(req.params.id);
    if (!server) return fail(res, 404, 'not_found');
    const host = str(req.body?.host, 200) || server.hostname || server.ip;
    if (!host) return fail(res, 400, 'no_address');
    const port = num(req.body?.port) || server.ssh_port || 22;
    const result = await probeTcp(host, port, 8000);
    db.prepare('UPDATE cc_servers SET status = ?, checked_at = ? WHERE id = ? AND agent_key IS NULL').run(
      result.status,
      Date.now(),
      server.id
    );
    res.json({ host, port, result });
  })
);

/* ------------------------------- Agent --------------------------------- */

/** کلیدِ تازه — همین یک‌بار در پاسخ می‌آید و بعد دیگر هرگز */
router.post(
  '/:id/agent/key',
  requireRole('admin'),
  guard(async (req, res) => {
    const server = getServer(req.params.id);
    if (!server) return fail(res, 404, 'not_found');
    const key = issueAgentKey(server, actorOf(req));
    const panelUrl = str(req.body?.panelUrl, 300) || `http://${req.headers.host || `localhost:${config.port}`}`;
    res.json({
      key, // ← فقط همین یک‌بار
      warning: 'این کلید دیگر نشان داده نمی‌شود. همین حالا آن را روی سرورِ مقصد بگذارید.',
      instructions: agentInstructions(server, key, panelUrl),
    });
  })
);

router.delete(
  '/:id/agent/key',
  requireRole('admin'),
  guard(async (req, res) => {
    const server = getServer(req.params.id);
    if (!server) return fail(res, 404, 'not_found');
    revokeAgentKey(server, actorOf(req));
    res.json({ ok: true });
  })
);

router.get(
  '/:id/agent',
  guard(async (req, res) => {
    const server = getServer(req.params.id);
    if (!server) return fail(res, 404, 'not_found');
    const panelUrl = `http://${req.headers.host || `localhost:${config.port}`}`;
    res.json({
      hasKey: Boolean(server.agent_key),
      lastSeen: server.agent_seen,
      report: parseJson(server.agent_report),
      instructions: agentInstructions(server, null, panelUrl),
    });
  })
);

export default router;
