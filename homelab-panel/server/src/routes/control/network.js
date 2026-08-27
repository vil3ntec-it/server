// ---------------------------------------------------------------------------
//  شبکه — IPها، پورت‌ها، Endpointها، دامنه‌ها، مسیرها، تونل‌ها و Cloudflare
//
//  دامنه، ساب‌دامین و تونل این‌جا به هم گره می‌خورند:
//      api.example.com → تونل ۱ → سرور خانگی → localhost:3000
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { db } from '../../db.js';
import { endpointUrl } from '../../control/models.js';
import { auditFromReq } from '../../control/audit.js';
import { probeUrl, probeDns, probeTls } from '../../control/checks.js';
import { checkDomain } from '../../lib/domain-check.js';
import * as cf from '../../control/cloudflare.js';
import { syncMonitors } from '../../control/monitor.js';
import { guard, fail, actorOf, num, str, bool, rateLimit } from './_shared.js';

const router = Router();

/* ------------------------- نمای کلیِ شبکه ------------------------------ */

router.get(
  '/overview',
  guard(async (req, res) => {
    const ips = db
      .prepare(
        `SELECT i.*, p.name AS project_name, p.project_id AS project_public_id, s.name AS server_name
           FROM cc_ips i
      LEFT JOIN cc_projects p ON p.id = i.project_id
      LEFT JOIN cc_servers  s ON s.id = i.server_id
       ORDER BY i.kind, i.address`
      )
      .all();
    const ports = db
      .prepare(
        `SELECT pt.*, p.name AS project_name, p.project_id AS project_public_id, s.name AS server_name
           FROM cc_ports pt
      LEFT JOIN cc_projects p ON p.id = pt.project_id
      LEFT JOIN cc_servers  s ON s.id = pt.server_id
       ORDER BY pt.port`
      )
      .all();
    const endpoints = db
      .prepare(
        `SELECT e.*, p.name AS project_name, p.project_id AS project_public_id, s.name AS server_name
           FROM cc_endpoints e
           JOIN cc_projects p ON p.id = e.project_id
      LEFT JOIN cc_servers s ON s.id = e.server_id
       ORDER BY p.name, e.environment`
      )
      .all()
      .map((e) => ({ ...e, url: endpointUrl(e) }));

    // پورت‌هایی که روی یک سرور دوبار ثبت شده‌اند
    const duplicates = db
      .prepare(
        `SELECT port, server_id, COUNT(*) AS n FROM cc_ports
          GROUP BY port, IFNULL(server_id, -1) HAVING n > 1`
      )
      .all();

    res.json({ ips, ports, endpoints, duplicates });
  })
);

/* ------------------------------ دامنه‌ها -------------------------------- */

router.get(
  '/domains',
  guard(async (req, res) => {
    const domains = db
      .prepare(
        `SELECT d.*, p.name AS project_name, p.project_id AS project_public_id, s.name AS server_name,
                (SELECT COUNT(*) FROM cc_routes r WHERE r.domain_id = d.id) AS route_count
           FROM domains d
      LEFT JOIN cc_projects p ON p.id = d.project_id
      LEFT JOIN cc_servers  s ON s.id = d.server_id
       ORDER BY d.name`
      )
      .all();
    res.json({ domains });
  })
);

router.post(
  '/domains',
  guard(async (req, res) => {
    const name = String(req.body?.name || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name)) return fail(res, 400, 'invalid_domain');
    const exists = db.prepare('SELECT id FROM domains WHERE name = ?').get(name);
    if (exists) return fail(res, 409, 'domain_exists');
    const ts = Date.now();
    const info = db
      .prepare('INSERT INTO domains(name, project_id, server_id, note, registrar, purchased_at, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(
        name,
        num(req.body?.project_id),
        num(req.body?.server_id),
        str(req.body?.note, 500),
        str(req.body?.registrar, 120),
        num(req.body?.purchased_at),
        ts,
        ts
      );
    auditFromReq(req, 'domain.create', { entity: 'domain', entityId: name, projectId: num(req.body?.project_id), detail: { name } });
    syncMonitors();
    res.status(201).json({ domain: db.prepare('SELECT * FROM domains WHERE id = ?').get(Number(info.lastInsertRowid)) });
  })
);

router.patch(
  '/domains/:id',
  guard(async (req, res) => {
    const row = db.prepare('SELECT * FROM domains WHERE id = ?').get(num(req.params.id));
    if (!row) return fail(res, 404, 'not_found');
    const fields = { project_id: 'number', server_id: 'number', note: 'string', registrar: 'string', purchased_at: 'number', cf_zone_id: 'string', cf_account_ref: 'number' };
    const data = {};
    for (const [key, kind] of Object.entries(fields)) {
      if (req.body?.[key] === undefined) continue;
      data[key] = req.body[key] === null ? null : kind === 'number' ? num(req.body[key]) : str(req.body[key], 300);
    }
    if (Object.keys(data).length) {
      data.updated_at = Date.now();
      const cols = Object.keys(data);
      db.prepare(`UPDATE domains SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), row.id);
    }
    auditFromReq(req, 'domain.update', { entity: 'domain', entityId: row.name, detail: data });
    res.json({ domain: db.prepare('SELECT * FROM domains WHERE id = ?').get(row.id) });
  })
);

router.delete(
  '/domains/:id',
  guard(async (req, res) => {
    const row = db.prepare('SELECT * FROM domains WHERE id = ?').get(num(req.params.id));
    if (!row) return fail(res, 404, 'not_found');
    const routes = db.prepare('SELECT COUNT(*) AS n FROM cc_routes WHERE domain_id = ?').get(row.id).n;
    if (routes && !bool(req.query.confirm)) return res.status(409).json({ error: 'domain_has_routes', detail: { routes } });
    db.prepare('DELETE FROM domains WHERE id = ?').run(row.id);
    auditFromReq(req, 'domain.delete', { entity: 'domain', entityId: row.name, detail: { routes } });
    syncMonitors();
    res.json({ ok: true });
  })
);

/** بررسیِ واقعیِ دامنه: DNS، گواهی، انقضای ثبت و پاسخِ HTTP */
router.post(
  '/domains/:id/check',
  rateLimit({ windowMs: 60000, max: 20 }),
  guard(async (req, res) => {
    const row = db.prepare('SELECT * FROM domains WHERE id = ?').get(num(req.params.id));
    if (!row) return fail(res, 404, 'not_found');
    const result = await checkDomain(row.name, { whois: bool(req.body?.whois, true) });
    db.prepare(
      `UPDATE domains SET checked_at = ?, dns_status = ?, dns_records = ?, ssl_status = ?, ssl_issuer = ?,
                          ssl_expires = ?, reg_expires = ?, http_status = ?, registrar = IFNULL(?, registrar) WHERE id = ?`
    ).run(
      result.checkedAt,
      result.dns.status,
      JSON.stringify({ a: result.dns.a, cname: result.dns.cname, ns: result.dns.ns }),
      result.ssl.status,
      result.ssl.issuer,
      result.ssl.expiresAt,
      result.whois.expiresAt,
      result.http?.status ?? null,
      result.whois.registrar || null,
      row.id
    );
    res.json({ domain: db.prepare('SELECT * FROM domains WHERE id = ?').get(row.id), result });
  })
);

/* ------------------------- مسیرِ دامنه → سرویس ------------------------- */

router.get(
  '/routes',
  guard(async (req, res) => {
    const routes = db
      .prepare(
        `SELECT r.*, d.name AS domain_name, p.name AS project_name, p.project_id AS project_public_id,
                s.name AS server_name, t.name AS tunnel_name, t.status AS tunnel_status
           FROM cc_routes r
      LEFT JOIN domains     d ON d.id = r.domain_id
      LEFT JOIN cc_projects p ON p.id = r.project_id
      LEFT JOIN cc_servers  s ON s.id = r.server_id
      LEFT JOIN cc_tunnels  t ON t.id = r.tunnel_id
       ORDER BY d.name, r.hostname`
      )
      .all();
    res.json({ routes });
  })
);

router.post(
  '/routes',
  guard(async (req, res) => {
    const hostname = String(req.body?.hostname || '').trim().toLowerCase();
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(hostname)) return fail(res, 400, 'invalid_hostname');
    if (db.prepare('SELECT id FROM cc_routes WHERE hostname = ?').get(hostname)) return fail(res, 409, 'hostname_taken');

    // اگر دامنهٔ ریشه ثبت شده باشد، خودکار به آن وصل می‌شود
    let domainId = num(req.body?.domain_id);
    if (!domainId) {
      const parts = hostname.split('.');
      for (let i = 0; i < parts.length - 1; i++) {
        const candidate = parts.slice(i).join('.');
        const found = db.prepare('SELECT id FROM domains WHERE name = ?').get(candidate);
        if (found) {
          domainId = found.id;
          break;
        }
      }
    }

    const ts = Date.now();
    const info = db
      .prepare(
        'INSERT INTO cc_routes(domain_id, hostname, project_id, server_id, tunnel_id, kind, service, label, note, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
      )
      .run(
        domainId,
        hostname,
        num(req.body?.project_id),
        num(req.body?.server_id),
        num(req.body?.tunnel_id),
        req.body?.kind || 'tunnel',
        str(req.body?.service, 300),
        str(req.body?.label, 120),
        str(req.body?.note, 300),
        ts,
        ts
      );
    auditFromReq(req, 'route.create', {
      entity: 'route',
      entityId: hostname,
      projectId: num(req.body?.project_id),
      detail: { hostname, service: req.body?.service, kind: req.body?.kind },
    });
    res.status(201).json({ route: db.prepare('SELECT * FROM cc_routes WHERE id = ?').get(Number(info.lastInsertRowid)) });
  })
);

router.patch(
  '/routes/:id',
  guard(async (req, res) => {
    const row = db.prepare('SELECT * FROM cc_routes WHERE id = ?').get(num(req.params.id));
    if (!row) return fail(res, 404, 'not_found');
    const data = {};
    for (const key of ['project_id', 'server_id', 'tunnel_id', 'domain_id']) {
      if (req.body?.[key] !== undefined) data[key] = req.body[key] === null ? null : num(req.body[key]);
    }
    for (const key of ['kind', 'service', 'label', 'note']) {
      if (req.body?.[key] !== undefined) data[key] = str(req.body[key], 300);
    }
    if (Object.keys(data).length) {
      data.updated_at = Date.now();
      const cols = Object.keys(data);
      db.prepare(`UPDATE cc_routes SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), row.id);
    }
    auditFromReq(req, 'route.update', { entity: 'route', entityId: row.hostname, detail: data });
    res.json({ route: db.prepare('SELECT * FROM cc_routes WHERE id = ?').get(row.id) });
  })
);

router.delete(
  '/routes/:id',
  guard(async (req, res) => {
    const row = db.prepare('SELECT * FROM cc_routes WHERE id = ?').get(num(req.params.id));
    if (!row) return fail(res, 404, 'not_found');
    db.prepare('DELETE FROM cc_routes WHERE id = ?').run(row.id);
    auditFromReq(req, 'route.delete', { entity: 'route', entityId: row.hostname });
    res.json({ ok: true });
  })
);

/** آدرسِ عمومیِ مسیر واقعاً جواب می‌دهد؟ */
router.post(
  '/routes/:id/test',
  rateLimit({ windowMs: 60000, max: 30 }),
  guard(async (req, res) => {
    const row = db.prepare('SELECT * FROM cc_routes WHERE id = ?').get(num(req.params.id));
    if (!row) return fail(res, 404, 'not_found');
    const dns = await probeDns(row.hostname);
    const tls = dns.status === 'online' ? await probeTls(row.hostname) : null;
    const http = dns.status === 'online' ? await probeUrl(`https://${row.hostname}/`) : null;
    const status = dns.status !== 'online' ? dns.status : http?.status || 'unknown';
    db.prepare('UPDATE cc_routes SET status = ?, checked_at = ? WHERE id = ?').run(status, Date.now(), row.id);
    res.json({ hostname: row.hostname, status, dns, tls, http });
  })
);

/* ------------------------------ تونل‌ها -------------------------------- */

router.get(
  '/tunnels',
  guard(async (req, res) => {
    const tunnels = db
      .prepare(
        `SELECT t.*, s.name AS server_name, p.name AS project_name, p.project_id AS project_public_id, a.name AS account_name
           FROM cc_tunnels t
      LEFT JOIN cc_servers     s ON s.id = t.server_id
      LEFT JOIN cc_projects    p ON p.id = t.project_id
      LEFT JOIN cc_cf_accounts a ON a.id = t.account_ref
       ORDER BY t.name`
      )
      .all()
      .map((t) => ({
        ...t,
        routes: db.prepare('SELECT * FROM cc_tunnel_routes WHERE tunnel_id = ? ORDER BY hostname').all(t.id),
      }));
    res.json({ tunnels });
  })
);

router.post(
  '/tunnels',
  guard(async (req, res) => {
    const name = str(req.body?.name, 120);
    if (!name) return fail(res, 400, 'name_required');
    const ts = Date.now();
    const info = db
      .prepare(
        'INSERT INTO cc_tunnels(name, tunnel_uuid, account_ref, server_id, project_id, managed_by, note, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
      )
      .run(
        name,
        str(req.body?.tunnel_uuid, 80),
        num(req.body?.account_ref),
        num(req.body?.server_id),
        num(req.body?.project_id),
        req.body?.managed_by === 'panel' ? 'panel' : 'external',
        str(req.body?.note, 500),
        ts,
        ts
      );
    const id = Number(info.lastInsertRowid);
    for (const route of Array.isArray(req.body?.routes) ? req.body.routes.slice(0, 50) : []) {
      const hostname = str(route?.hostname, 200);
      const service = str(route?.service, 300);
      if (!hostname || !service) continue;
      db.prepare('INSERT OR IGNORE INTO cc_tunnel_routes(tunnel_id, hostname, service, project_id, created_at) VALUES(?,?,?,?,?)').run(
        id,
        hostname.toLowerCase(),
        service,
        num(route?.project_id) ?? num(req.body?.project_id),
        ts
      );
    }
    auditFromReq(req, 'tunnel.create', { entity: 'tunnel', entityId: id, projectId: num(req.body?.project_id), detail: { name } });
    syncMonitors();
    res.status(201).json({ tunnel: db.prepare('SELECT * FROM cc_tunnels WHERE id = ?').get(id) });
  })
);

router.patch(
  '/tunnels/:id',
  guard(async (req, res) => {
    const row = db.prepare('SELECT * FROM cc_tunnels WHERE id = ?').get(num(req.params.id));
    if (!row) return fail(res, 404, 'not_found');
    const data = {};
    for (const key of ['name', 'tunnel_uuid', 'note']) if (req.body?.[key] !== undefined) data[key] = str(req.body[key], 300);
    for (const key of ['account_ref', 'server_id', 'project_id']) {
      if (req.body?.[key] !== undefined) data[key] = req.body[key] === null ? null : num(req.body[key]);
    }
    if (Object.keys(data).length) {
      data.updated_at = Date.now();
      const cols = Object.keys(data);
      db.prepare(`UPDATE cc_tunnels SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => data[c]), row.id);
    }
    auditFromReq(req, 'tunnel.update', { entity: 'tunnel', entityId: row.id, detail: data });
    res.json({ tunnel: db.prepare('SELECT * FROM cc_tunnels WHERE id = ?').get(row.id) });
  })
);

router.delete(
  '/tunnels/:id',
  guard(async (req, res) => {
    const row = db.prepare('SELECT * FROM cc_tunnels WHERE id = ?').get(num(req.params.id));
    if (!row) return fail(res, 404, 'not_found');
    db.prepare('DELETE FROM cc_tunnels WHERE id = ?').run(row.id);
    auditFromReq(req, 'tunnel.delete', { entity: 'tunnel', entityId: row.id, detail: { name: row.name } });
    syncMonitors();
    res.json({ ok: true });
  })
);

router.post(
  '/tunnels/:id/routes',
  guard(async (req, res) => {
    const tunnel = db.prepare('SELECT * FROM cc_tunnels WHERE id = ?').get(num(req.params.id));
    if (!tunnel) return fail(res, 404, 'not_found');
    const hostname = String(req.body?.hostname || '').trim().toLowerCase();
    const service = str(req.body?.service, 300);
    if (!hostname || !service) return fail(res, 400, 'hostname_and_service_required');
    db.prepare('INSERT OR REPLACE INTO cc_tunnel_routes(tunnel_id, hostname, service, project_id, created_at) VALUES(?,?,?,?,?)').run(
      tunnel.id,
      hostname,
      service,
      num(req.body?.project_id) ?? tunnel.project_id,
      Date.now()
    );
    auditFromReq(req, 'tunnel.route.add', { entity: 'tunnel', entityId: tunnel.id, detail: { hostname, service } });
    syncMonitors();
    res.status(201).json({ routes: db.prepare('SELECT * FROM cc_tunnel_routes WHERE tunnel_id = ?').all(tunnel.id) });
  })
);

router.delete(
  '/tunnels/:id/routes/:routeId',
  guard(async (req, res) => {
    const row = db.prepare('SELECT * FROM cc_tunnel_routes WHERE id = ? AND tunnel_id = ?').get(num(req.params.routeId), num(req.params.id));
    if (!row) return fail(res, 404, 'not_found');
    db.prepare('DELETE FROM cc_tunnel_routes WHERE id = ?').run(row.id);
    auditFromReq(req, 'tunnel.route.remove', { entity: 'tunnel', entityId: row.tunnel_id, detail: { hostname: row.hostname } });
    res.json({ ok: true });
  })
);

/** وضعیتِ واقعیِ تونل: اگر حسابِ Cloudflare وصل باشد از API خودشان، وگرنه از آدرسِ عمومی */
router.post(
  '/tunnels/:id/test',
  rateLimit({ windowMs: 60000, max: 30 }),
  guard(async (req, res) => {
    const tunnel = db.prepare('SELECT * FROM cc_tunnels WHERE id = ?').get(num(req.params.id));
    if (!tunnel) return fail(res, 404, 'not_found');

    let cloudflare = null;
    if (tunnel.account_ref && tunnel.tunnel_uuid) {
      try {
        const list = await cf.listCfTunnels(tunnel.account_ref);
        const found = list.find((t) => t.id === tunnel.tunnel_uuid);
        if (found) {
          cloudflare = found;
          db.prepare('UPDATE cc_tunnels SET status = ?, conns = ?, last_check = ?, last_error = NULL WHERE id = ?').run(
            found.status === 'healthy' ? 'online' : found.status === 'inactive' ? 'offline' : found.status,
            found.connections,
            Date.now(),
            tunnel.id
          );
        }
      } catch (e) {
        db.prepare('UPDATE cc_tunnels SET last_error = ?, last_check = ? WHERE id = ?').run(String(e.message).slice(0, 300), Date.now(), tunnel.id);
        cloudflare = { error: e.message };
      }
    }

    const routes = db.prepare('SELECT * FROM cc_tunnel_routes WHERE tunnel_id = ?').all(tunnel.id);
    const probes = [];
    for (const route of routes.slice(0, 10)) {
      const result = await probeUrl(`https://${route.hostname}/`, { timeout: 9000 });
      probes.push({ hostname: route.hostname, service: route.service, ...result });
    }
    if (!cloudflare && probes.length) {
      const anyOnline = probes.some((p) => p.status === 'online');
      db.prepare('UPDATE cc_tunnels SET status = ?, last_check = ? WHERE id = ?').run(anyOnline ? 'online' : 'offline', Date.now(), tunnel.id);
    }

    res.json({ tunnel: db.prepare('SELECT * FROM cc_tunnels WHERE id = ?').get(tunnel.id), cloudflare, probes });
  })
);

/* ----------------------------- Cloudflare ------------------------------ */

router.get(
  '/cloudflare/accounts',
  guard(async (req, res) => res.json({ accounts: cf.listAccounts() }))
);

router.post(
  '/cloudflare/accounts',
  rateLimit({ windowMs: 60000, max: 10 }),
  guard(async (req, res) => {
    const account = await cf.saveAccount({
      id: num(req.body?.id),
      name: str(req.body?.name, 120),
      token: req.body?.token ? String(req.body.token) : null,
      accountId: str(req.body?.account_id, 60),
      email: str(req.body?.email, 200),
      actor: actorOf(req),
    });
    // توکن هرگز برنمی‌گردد — فقط نتیجهٔ سنجش
    res.json({ account });
  })
);

router.post(
  '/cloudflare/accounts/:id/verify',
  rateLimit({ windowMs: 60000, max: 20 }),
  guard(async (req, res) => res.json(await cf.verifyAccount(num(req.params.id))))
);

router.delete(
  '/cloudflare/accounts/:id',
  guard(async (req, res) => {
    if (!cf.deleteAccount(num(req.params.id), actorOf(req))) return fail(res, 404, 'not_found');
    res.json({ ok: true });
  })
);

const cfGuard = (handler) =>
  guard(async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (e.name === 'CloudflareError') return res.status(e.status && e.status >= 400 ? e.status : 502).json({ error: 'cloudflare_error', detail: e.message });
      throw e;
    }
  });

router.get('/cloudflare/:id/zones', cfGuard(async (req, res) => res.json({ zones: await cf.listZones(num(req.params.id)) })));

router.get(
  '/cloudflare/:id/zones/:zoneId/dns',
  cfGuard(async (req, res) => {
    const [records, ssl] = await Promise.all([
      cf.listDnsRecords(num(req.params.id), req.params.zoneId),
      cf.zoneSsl(num(req.params.id), req.params.zoneId).catch(() => null),
    ]);
    res.json({ records, ssl });
  })
);

router.post(
  '/cloudflare/:id/zones/:zoneId/dns',
  cfGuard(async (req, res) => {
    const record = await cf.createDnsRecord(
      num(req.params.id),
      req.params.zoneId,
      {
        type: str(req.body?.type, 12),
        name: str(req.body?.name, 200),
        content: str(req.body?.content, 500),
        ttl: num(req.body?.ttl, 1),
        proxied: bool(req.body?.proxied, true),
        comment: str(req.body?.comment, 200),
      },
      actorOf(req)
    );
    res.status(201).json({ record });
  })
);

router.patch(
  '/cloudflare/:id/zones/:zoneId/dns/:recordId',
  cfGuard(async (req, res) => {
    const patch = {};
    for (const key of ['type', 'name', 'content', 'comment']) if (req.body?.[key] !== undefined) patch[key] = str(req.body[key], 500);
    if (req.body?.ttl !== undefined) patch.ttl = num(req.body.ttl, 1);
    if (req.body?.proxied !== undefined) patch.proxied = bool(req.body.proxied, true);
    res.json({ record: await cf.updateDnsRecord(num(req.params.id), req.params.zoneId, req.params.recordId, patch, actorOf(req)) });
  })
);

router.delete(
  '/cloudflare/:id/zones/:zoneId/dns/:recordId',
  cfGuard(async (req, res) => {
    await cf.deleteDnsRecord(num(req.params.id), req.params.zoneId, req.params.recordId, actorOf(req));
    res.json({ ok: true });
  })
);

router.get('/cloudflare/:id/tunnels', cfGuard(async (req, res) => res.json({ tunnels: await cf.listCfTunnels(num(req.params.id)) })));

router.get(
  '/cloudflare/:id/tunnels/:tunnelId',
  cfGuard(async (req, res) => {
    const [configuration, connections] = await Promise.all([
      cf.tunnelConfiguration(num(req.params.id), req.params.tunnelId).catch((e) => ({ error: e.message })),
      cf.tunnelConnections(num(req.params.id), req.params.tunnelId).catch(() => []),
    ]);
    res.json({ configuration, connections });
  })
);

/** تونل‌های واقعیِ Cloudflare را با فهرستِ داخلی هماهنگ می‌کند */
router.post(
  '/cloudflare/:id/tunnels/import',
  cfGuard(async (req, res) => {
    const accountRef = num(req.params.id);
    const remote = await cf.listCfTunnels(accountRef);
    const ts = Date.now();
    let created = 0;
    let updated = 0;
    for (const t of remote) {
      const existing = db.prepare('SELECT * FROM cc_tunnels WHERE tunnel_uuid = ?').get(t.id);
      const status = t.status === 'healthy' ? 'online' : t.status === 'inactive' ? 'offline' : t.status || 'unknown';
      if (existing) {
        db.prepare('UPDATE cc_tunnels SET name = ?, status = ?, conns = ?, account_ref = ?, last_check = ?, updated_at = ? WHERE id = ?').run(
          t.name,
          status,
          t.connections,
          accountRef,
          ts,
          ts,
          existing.id
        );
        updated++;
      } else {
        const info = db
          .prepare(
            'INSERT INTO cc_tunnels(name, tunnel_uuid, account_ref, managed_by, status, conns, last_check, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)'
          )
          .run(t.name, t.id, accountRef, 'external', status, t.connections, ts, ts, ts);
        created++;
        // مسیرهای واقعیِ همان تونل هم می‌آیند
        try {
          const cfg = await cf.tunnelConfiguration(accountRef, t.id);
          for (const ing of cfg.ingress || []) {
            if (!ing.hostname || !ing.service) continue;
            db.prepare('INSERT OR IGNORE INTO cc_tunnel_routes(tunnel_id, hostname, service, created_at) VALUES(?,?,?,?)').run(
              Number(info.lastInsertRowid),
              String(ing.hostname).toLowerCase(),
              ing.service,
              ts
            );
          }
        } catch { /* توکن دسترسیِ پیکربندی ندارد */ }
      }
    }
    auditFromReq(req, 'cloudflare.tunnels.import', { entity: 'cf_account', entityId: accountRef, detail: { created, updated, total: remote.length } });
    syncMonitors();
    res.json({ created, updated, total: remote.length });
  })
);

export default router;
