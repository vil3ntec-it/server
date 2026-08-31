// مدیریت سایت‌ها: فهرست، افزودن با مسیر، کشف خودکار، Start/Stop/Restart، لاگ
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import {
  listSites,
  getSite,
  addSite,
  updateSite,
  removeSite,
  discoverSites,
  importDiscovered,
  createSiteFolder,
  describeSite,
  siteSize,
  invalidateSizeCache,
  attachDomain,
  detachDomain,
  domainsForSite,
  ensureSiteDataFolder,
} from '../sites/registry.js';
import { startSite, stopSite, restartSite, tailLog, clearLog } from '../sites/process.js';
import { readSiteConfig, writeSiteConfig, workspacePaths } from '../sites/workspace.js';
import { startSiteTunnel, stopSiteTunnel, restartSiteTunnel, siteTunnelState } from '../site-tunnels.js';
import { syncTunnelRoutes } from '../tunnel.js';
import { getSiteSync } from '../state.js';
import { readInterfaces } from '../metrics/network.js';
import { db, logEvent } from '../db.js';
import { config } from '../config.js';
import { sitesRoot } from '../sites/root.js';

const router = Router();
router.use(requireAuth, requireWriteRole('operator'));

router.get('/', async (req, res) => {
  res.json({ sites: await listSites(), sitesRoot: sitesRoot() });
});

router.get('/:id', async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const info = await describeSite(site);
  res.json({ site: info, config: readSiteConfig(site.slug), workspace: workspacePaths(site.slug) });
});

router.post('/', async (req, res) => {
  const { path: rootPath, name, domain, port, kind, startCommand, autostart } = req.body || {};
  const result = await addSite({ rootPath, name, domain, port, kind, startCommand, autostart });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// ساخت سایت تازه با پوشهٔ کاملاً مستقل زیر ریشهٔ سایت‌ها
router.post('/create', async (req, res) => {
  const { name, kind, domain, port } = req.body || {};
  const result = await createSiteFolder({ name, kind, domain, port });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.put('/:id', async (req, res) => {
  const before = getSite(req.params.id);
  const result = updateSite(req.params.id, req.body || {});
  if (!result.ok) {
    return res.status(result.error === 'invalid_domain' ? 400 : 404).json(result);
  }
  invalidateSizeCache(result.site.slug);

  // پورت یا دامنه عوض شده؟ مسیرهای اینترنتی هم باید همان‌جا برود
  if (before && before.port !== result.site.port) {
    if (siteTunnelState(result.site.slug).status !== 'stopped') {
      restartSiteTunnel(result.site).catch(() => {});
    }
  }
  if (result.domainChanged || before?.port !== result.site.port) {
    syncTunnelRoutes().catch(() => {});
  }
  res.json(result);
});

router.delete('/:id', async (req, res) => {
  const result = await removeSite(req.params.id, { deleteWorkspace: req.query.keepData !== '1' });
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

// ------------------------------ کشف خودکار --------------------------------
router.post('/discover', async (req, res) => {
  const roots = Array.isArray(req.body?.roots) ? req.body.roots.filter(Boolean) : null;
  res.json(await discoverSites({ roots }));
});

router.post('/discover/import', async (req, res) => {
  const result = await importDiscovered(req.body?.items || []);
  res.json(result);
});

// -------------------------------- عملیات ----------------------------------
async function action(req, res, fn, label) {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  try {
    const result = await fn(site);
    if (!result.ok) return res.status(400).json(result);
    res.json({ ...result, site: await describeSite(site, { withSize: false }) });
  } catch (e) {
    logEvent('error', 'process', `${label} سایت ${site.name} ناموفق بود: ${e.message}`, site.id);
    res.status(500).json({ error: e.message });
  }
}

router.post('/:id/start', (req, res) => action(req, res, startSite, 'اجرای'));
router.post('/:id/stop', (req, res) => action(req, res, stopSite, 'توقف'));
router.post('/:id/restart', (req, res) => action(req, res, restartSite, 'راه‌اندازی مجدد'));

router.get('/:id/logs', (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const limit = Math.min(2000, Number(req.query.limit) || 300);
  const lines = tailLog(site.slug, limit).map((line) => {
    const [at, level, ...rest] = line.split('\t');
    return { at, level: level || 'info', text: rest.join('\t') || line };
  });
  const events = db
    .prepare('SELECT * FROM events WHERE site_id = ? ORDER BY id DESC LIMIT 200')
    .all(site.id);
  res.json({ lines, events });
});

router.delete('/:id/logs', (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  clearLog(site.slug);
  db.prepare('DELETE FROM events WHERE site_id = ?').run(site.id);
  res.json({ ok: true });
});

// تنظیمات اختصاصی سایت (متغیرهای محیطی جدا برای هر سایت)
router.put('/:id/config', (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const current = readSiteConfig(site.slug);
  const env = req.body?.env && typeof req.body.env === 'object' ? req.body.env : current.env;
  const next = { ...current, ...req.body, env, updatedAt: Date.now() };
  writeSiteConfig(site.slug, next);
  res.json({ ok: true, config: next });
});

// ------------------------------- دامنه‌ها ----------------------------------
// یک سایت می‌تواند چند دامنه داشته باشد، و هر دامنه هر وقت بخواهید به سایت
// دیگری منتقل می‌شود — بدون این که چیزی دستی در فایل‌ها عوض شود.
router.get('/:id/domains', (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  res.json({ domains: domainsForSite(site.id).map((d) => d.name), primary: site.domain });
});

router.post('/:id/domains', async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const result = attachDomain(site.id, req.body?.domain);
  if (!result.ok) return res.status(400).json(result);
  syncTunnelRoutes().catch(() => {});
  res.json({ ...result, domains: domainsForSite(site.id).map((d) => d.name) });
});

router.delete('/:id/domains', async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const result = detachDomain(site.id, req.query.domain);
  if (!result.ok) return res.status(404).json(result);
  syncTunnelRoutes().catch(() => {});
  res.json({ ...result, domains: domainsForSite(site.id).map((d) => d.name) });
});

// --------------------- سرورِ اختصاصیِ داده برای هر سایت ---------------------
// هر سایت پوشه و رمزِ خودش را دارد؛ این‌ها همان چیزهایی است که باید در خودِ
// سایت وارد شود تا دادهٔ آن سایت جدا از بقیه ذخیره شود.
function siteServerAddresses(slug) {
  const port = config.siteSync.port || config.port;
  const query = `?site=${encodeURIComponent(slug)}`;
  const list = [{ label: 'همین کامپیوتر', ws: `ws://localhost:${port}${query}` }];
  for (const iface of readInterfaces()) {
    list.push({ label: `شبکهٔ خانگی (${iface.name})`, ws: `ws://${iface.address}:${port}${query}` });
  }
  return list;
}

router.get('/:id/server', async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const store = await ensureSiteDataFolder(site);
  if (!store) return res.status(404).json({ error: 'disabled' });

  const token = store.getToken();
  res.json({
    slug: site.slug,
    dataDir: store.dataDir,
    tokenPreview: token
      ? `${token.slice(0, 4)}${'•'.repeat(Math.max(0, token.length - 8))}${token.slice(-4)}`
      : null,
    addresses: siteServerAddresses(site.slug),
    branches: store.branches(),
    stats: store.snapshot(),
  });
});

router.get('/:id/server/token', async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const store = await ensureSiteDataFolder(site);
  if (!store) return res.status(404).json({ error: 'disabled' });
  logEvent('warn', 'panel', `رمز دادهٔ سایت «${site.name}» توسط «${req.user.username}» دیده شد`, site.id);
  res.json({ token: store.getToken() });
});

router.post('/:id/server/rotate-token', async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const store = await ensureSiteDataFolder(site);
  if (!store) return res.status(404).json({ error: 'disabled' });
  const token = await store.rotateToken();
  logEvent('warn', 'panel', `رمز دادهٔ سایت «${site.name}» عوض شد`, site.id);
  res.json({ ok: true, token });
});

// ----------------------- آدرس اینترنتیِ اختصاصیِ سایت -----------------------
router.post('/:id/tunnel/start', async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const result = await startSiteTunnel(site);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.post('/:id/tunnel/stop', (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  res.json(stopSiteTunnel(site.slug));
});

router.get('/:id/tunnel', (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  res.json(siteTunnelState(site.slug));
});

// محاسبهٔ دوبارهٔ حجم فایل‌ها (واقعی، با پیمایش پوشه)
router.post('/:id/recalc-size', async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const size = await siteSize(site, { force: true });
  res.json({ ok: true, size });
});

export default router;
