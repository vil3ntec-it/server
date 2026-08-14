// داشبورد: خلاصهٔ کامل وضعیت سرور — همه از سیستم‌عامل و دیتابیس واقعی
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { db, getSetting } from '../db.js';
import { collect, getLatest, getHistory } from '../metrics/index.js';
import { readNetwork } from '../metrics/network.js';
import { listSites } from '../sites/registry.js';
import { getSiteSync } from '../state.js';
import { config } from '../config.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  const metrics = getLatest() || (await collect());
  const [network, sites] = await Promise.all([readNetwork(), listSites({ withSize: false })]);

  const domainCount = db.prepare('SELECT COUNT(*) AS n FROM domains').get().n;
  const errors = db
    .prepare("SELECT id, site_id, level, source, message, created_at FROM events WHERE level IN ('error','warn') ORDER BY id DESC LIMIT 12")
    .all();

  const siteSync = getSiteSync();

  res.json({
    server: {
      name: getSetting('server_name', metrics.host.hostname),
      hostname: metrics.host.hostname,
      online: true, // این پاسخ از خودِ سرور می‌آید؛ پس سرور بالا است
      internalIp: network.internalIp,
      publicIp: network.publicIp,
      mac: network.mac,
      gateway: network.gateway,
      uptimeSeconds: metrics.host.uptimeSeconds,
      panelUptimeSeconds: metrics.host.processUptimeSeconds,
      platform: metrics.host.platform,
      release: metrics.host.release,
      arch: metrics.host.arch,
      port: config.port,
    },
    cpu: metrics.cpu,
    memory: metrics.memory,
    disk: metrics.disk,
    temperature: metrics.temperature,
    network: {
      ...metrics.network,
      ping: network.ping,
    },
    counts: {
      sites: sites.length,
      sitesOnline: sites.filter((s) => s.online).length,
      domains: domainCount,
      running: sites.filter((s) => s.managed).length,
    },
    sites: sites.slice(0, 8),
    errors,
    siteSync: siteSync
      ? { ...siteSync.snapshot(), enabled: true }
      : { enabled: false },
    history: getHistory(),
    at: metrics.at,
  });
});

router.get('/history', (req, res) => {
  res.json({ history: getHistory() });
});

export default router;
