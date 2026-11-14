// مدیریت سایت‌ها: فهرست، افزودن با مسیر، کشف خودکار، Start/Stop/Restart، لاگ
import { Router } from 'express';
import { requireLocalOrAuth } from '../local-key.js';
import { requireWriteRole, userRole } from '../auth.js';
import path from 'node:path';
import fs from 'node:fs';
import { detectProject } from '../sites/detect.js';
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
  domainsForSite,
  ensureSiteDataFolder,
} from '../sites/registry.js';
import { startSite, stopSite, restartSite, tailLog, clearLog } from '../sites/process.js';
import { readSiteConfig, writeSiteConfig, workspacePaths } from '../sites/workspace.js';
import { startSiteTunnel, stopSiteTunnel, restartSiteTunnel, siteTunnelState } from '../site-tunnels.js';
import { syncTunnelRoutes } from '../tunnel.js';
import { getSiteSync } from '../state.js';
import { readInterfaces } from '../metrics/network.js';
import { q, db, logEvent } from '../db.js';
import { config } from '../config.js';
import { sitesRoot } from '../sites/root.js';
import { denyUnlessShellAllowed, shellAllowed } from '../lib/shell-owner.js';
import { domainOwnerGuard, sendDomainResult } from './app-domains.js';
import { addAppHostname, removeAppHostname, setPrimaryHostname, hostnamesOf, ownerOf } from '../app-hosts.js';
import { freshUntil } from '../auth.js';
import { parseHostname } from '../lib/hostname.js';

const router = Router();
// حسابِ مدیرِ پنل، یا کلیدِ محلیِ برنامهٔ رویِ همین کامپیوتر
router.use(requireLocalOrAuth);
// برنامهٔ محلی نقشِ پنل ندارد (کلیدِ همین کامپیوتر خودش مجوز است)؛ برای بقیه،
// نوشتن دستِ‌کم operator می‌خواهد.
const writeGuard = requireWriteRole('operator');
router.use((req, res, next) => (req.user?.local ? next() : writeGuard(req, res, next)));

router.get('/', async (req, res) => {
  res.json({ sites: await listSites(), sitesRoot: sitesRoot() });
});

/*
 *  ⛔ (۱.۵۰.۸۶، تصمیمِ ۲-۲۶ پرسشِ ۵ «الف») متغیرهای محیطیِ سایت اغلب رمزِ پایگاه‌داده یا کلیدِ سرویس دارند ⇒
 *  زیرِ admin (viewer و operator) فقط **نام**‌ها را می‌بینند؛ مقدار برای admin و کلیدِ محلی. همان قاعدهٔ رازهای
 *  دیگرِ پنل. ‎envMasked‎ به رابط می‌گوید کادر را فقط‌خواندنی کند و env را پس نفرستد.
 */
function siteConfigFor(req, slug) {
  const cfg = readSiteConfig(slug);
  if (req.user?.local || (req.user?.id != null && userRole(req.user.id) === 'admin')) return cfg;
  const names = Object.keys(cfg?.env && typeof cfg.env === 'object' ? cfg.env : {});
  return { ...cfg, env: Object.fromEntries(names.map((k) => [k, ''])), envMasked: true };
}

router.get('/:id', async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const info = await describeSite(site);
  res.json({ site: info, config: siteConfigFor(req, site.slug), workspace: workspacePaths(site.slug) });
});

/*
 *  ⛔ «فرمانِ اجرا» یعنی اجرای هر دستوری روی این کامپیوتر (با `shell`)، و
 *  ریشهٔ سایت بیرونِ پوشهٔ سایت‌ها یعنی دسترسیِ فایل‌منیجر به همان‌جا. پس هر
 *  دو فقط کارِ مدیرِ پنل است — تا ۱.۵۰.۸ یک «کارگزار» با سایتی به ریشهٔ ‎/‎ و
 *  یک فرمانِ دلخواه، کلِ کامپیوتر را داشت. و ریشه‌ای که خودِ پوشهٔ دادهٔ
 *  پنل یا بالاتر از آن باشد برای هیچ‌کس پذیرفته نمی‌شود.
 */
/*
 *  ⛔ (۱.۵۰.۸۳) «فرمانِ اجرا» فقط آنی نیست که در بدنه می‌آید: `addSite` فرمان را از
 *  `site.json`/`package.json` ِ خودِ پوشه هم درمی‌آورد (`detectProject`). پس operator با ساختِ سایتی
 *  که پوشه‌اش یک `npm start` دارد، بی آنکه فرمانی بفرستد، همان اجرای کد را می‌گرفت. این‌جا فرمانِ **مؤثر**
 *  (صریح، وگرنه از پوشه) سنجیده می‌شود — نه فقط فیلدِ درخواست.
 */
function effectiveStartCommand(body) {
  const explicit = body.startCommand ?? body.start_command;
  if (explicit !== undefined && String(explicit || '').trim()) return String(explicit).trim();
  const root = body.path ?? body.rootPath ?? body.root_path;
  if (root !== undefined && String(root || '').trim()) {
    try {
      const resolved = path.resolve(String(root).trim());
      if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
        const detected = detectProject(resolved).startCommand;
        if (detected && String(detected).trim()) return String(detected).trim();
      }
    } catch { /* پوشهٔ نخواندنی ⇒ addSite خودش رد می‌کند */ }
  }
  return '';
}

function sensitiveSiteChange(body, before = null) {
  if (before) {
    //  ویرایش: فقط اگر فرمانِ صریح عوض شد (پوشه عوض نمی‌شود)
    const cmd = body.startCommand ?? body.start_command;
    if (cmd !== undefined && String(cmd || '') !== String(before.start_command || '')) return true;
  } else if (effectiveStartCommand(body)) {
    //  ساخت/وارد کردن: هر فرمانِ مؤثرِ غیرخالی (صریح یا از پوشه) ⇒ حساس
    return true;
  }
  const root = body.path ?? body.rootPath ?? body.root_path;
  if (root !== undefined) {
    const rel = path.relative(path.resolve(sitesRoot()), path.resolve(String(root || '')));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return true;
  }
  return false;
}
function badSiteRoot(body) {
  const root = body.path ?? body.rootPath ?? body.root_path;
  if (root === undefined || root === null || root === '') return false;
  const abs = path.resolve(String(root));
  if (abs === path.parse(abs).root) return true;               //  ریشهٔ دیسک
  const rel = path.relative(abs, path.resolve(config.dataDir));
  return !rel.startsWith('..') && !path.isAbsolute(rel);       //  خودِ پوشهٔ دادهٔ پنل یا بالاترش
}
function guardSite(req, res, before = null, body = req.body || {}) {
  if (badSiteRoot(body)) {
    res.status(400).json({ ok: false, error: 'bad_root', message: 'این پوشه نمی‌تواند ریشهٔ سایت باشد' });
    return false;
  }
  if (!req.user?.local && sensitiveSiteChange(body, before)) {
    if (userRole(req.user.id) !== 'admin') {
      res.status(403).json({ ok: false, error: 'forbidden', needed: 'admin' });
      return false;
    }
    //  ⛔ S19 (۱.۵۰.۸۶: همیشه) ⇒ فرمانِ اجرا و ریشهٔ بیرونی فقط مالک
    const what = effectiveStartCommand(body) ? 'site.command' : 'site.root';
    if (!denyUnlessShellAllowed(req, res, what)) return false;
  }
  return true;
}

/*
 *  ⛔ (۱.۵۰.۹۹) دامنهٔ سایت (صریح در بدنه، یا از پروندهٔ خودِ پوشه هنگامِ ساخت) فقط مالک + احرازِ دوباره (یا کلیدِ محلی) —
 *  همان مرزِ ‎/api/app-domains‎. کارگزار/مدیرِ دوم سایت را می‌سازد ولی دامنه‌ای نمی‌گذارد (صریح ⇒ ۴۰۳، از پوشه ⇒ نادیده).
 */
const wantsDomain = (body) => body && 'domain' in body && String(body.domain ?? '').trim() !== '';
const domainFresh = (req) => Boolean(req.user?.local) || (shellAllowed(req.user) && Boolean(req.user?.sessionId) && freshUntil(req.user.sessionId) > Date.now());
const siteDomainGuard = domainOwnerGuard('site.domain', { local: true });
function guardDomainField(req, res, next) {
  if (!wantsDomain(req.body) && !(req.method === 'PUT' && req.body && 'domain' in req.body)) return next();
  return siteDomainGuard(req, res, next);
}

/**
 * دامنهٔ سایتِ تازه پس از ساختنِ ردیف، از همان راهِ اتمیِ ‎app-hosts.js‎ (نه ‎attachDomain‎ + هم‌گام‌سازیِ پس‌زمینه).
 * سنجش و «مالِ دیگری» **پیش از** ساختنِ سایت (رد ⇒ هیچ سایتی ساخته نمی‌شود).
 */
function precheckNewDomain(raw) {
  if (!raw) return null;
  const p = parseHostname(String(raw));
  if (!p.ok) return { status: 400, body: { ok: false, error: 'invalid_domain', reason: p.reason, message: p.message } };
  const owner = ownerOf(p.hostname);
  if (owner) return { status: 409, body: { ok: false, error: 'domain_taken', message: `نامِ ${p.display} مالِ ${owner.label} است.`, owner: { app: owner.app, label: owner.label } } };
  return null;
}
async function attachNewSiteDomain(req, result, raw) {
  if (!raw || !result?.ok || !result.site) return result;
  const app = `site:${result.site.slug}`;
  const r = await addAppHostname({ app, hostname: String(raw), primary: true, by: req.user?.username });
  sendDomainAudit(req, 'panel.domains.add', r, app, String(raw));
  const site = getSite(result.site.id);
  //  سایت ساخته شد ولی دامنه ننشست (مسیرِ تونل نوشته نشد ⇒ برگشت) — گفته می‌شود، پنهان نه
  return r.ok ? { ...result, site } : { ...result, site, domainError: { error: r.error, message: r.message } };
}

router.post('/', guardDomainField, async (req, res) => {
  if (!guardSite(req, res)) return;
  const { path: rootPath, name, domain, port, kind, startCommand, autostart } = req.body || {};
  //  دامنهٔ مؤثر: صریح، وگرنه از پروندهٔ خودِ پوشه — فقط برای مالکِ تازه‌احرازشده/کلیدِ محلی
  let want = String(domain ?? '').trim();
  if (!want && domainFresh(req) && rootPath) {
    try { want = String(detectProject(path.resolve(String(rootPath).trim())).domain || '').trim(); } catch { want = ''; }
  }
  const bad = precheckNewDomain(want);
  if (bad) return res.status(bad.status).json(bad.body);
  const result = await addSite({ rootPath, name, domain: undefined, port, kind, startCommand, autostart, domainAllowed: false });
  if (!result.ok) return res.status(400).json(result);
  res.json(await attachNewSiteDomain(req, result, want));
});

// ساخت سایت تازه با پوشهٔ کاملاً مستقل زیر ریشهٔ سایت‌ها
router.post('/create', guardDomainField, async (req, res) => {
  const { name, kind, domain, port } = req.body || {};
  const want = String(domain ?? '').trim();
  const bad = precheckNewDomain(want);
  if (bad) return res.status(bad.status).json(bad.body);
  const result = await createSiteFolder({ name, kind, domain: undefined, port });
  if (!result.ok) return res.status(400).json(result);
  res.json(await attachNewSiteDomain(req, result, want));
});

router.put('/:id', guardDomainField, async (req, res) => {
  const before = getSite(req.params.id);
  if (!guardSite(req, res, before)) return;
  //  (۱.۵۰.۹۹) فیلدِ ‎domain‎ = «نامِ اصلیِ سایت» از همان راهِ اتمیِ ‎app-hosts.js‎ (سنجش، یک صاحب، آخرین نام، برگشت)
  const body = { ...(req.body || {}) };
  let domainResult = null;
  if (before && 'domain' in body) {
    const raw = String(body.domain ?? '').trim();
    delete body.domain;
    const app = `site:${before.slug}`;
    if (!raw) {
      domainResult = before.domain ? await removeAppHostname({ app, hostname: before.domain }) : { ok: true };
      if (before.domain) sendDomainAudit(req, 'panel.domains.remove', domainResult, app, before.domain);
    } else {
      const own = (hostnamesOf(app)?.hostnames || []).map((h) => h.hostname);
      const parsed = parseHostname(raw);
      domainResult = parsed.ok && own.includes(parsed.hostname)
        ? await setPrimaryHostname({ app, hostname: raw })
        : await addAppHostname({ app, hostname: raw, primary: true, by: req.user?.username });
      sendDomainAudit(req, own.includes(parsed.hostname) ? 'panel.domains.primary' : 'panel.domains.add', domainResult, app, raw);
    }
    if (!domainResult.ok) {
      const { status, ...rest } = domainResult;
      const code = rest.error === 'invalid_hostname' ? 'invalid_domain' : rest.error === 'hostname_taken' ? 'domain_taken' : rest.error;
      return res.status(status || 400).json({ ...rest, ok: false, error: code, reason: rest.reason || rest.error });
    }
  }
  const result = updateSite(req.params.id, body);
  if (!result.ok) {
    return res.status(result.error === 'invalid_domain' ? 400 : result.error === 'domain_taken' ? 409 : 404).json(result);
  }
  if (domainResult) result.domainChanged = true;
  invalidateSizeCache(result.site.slug);

  // پورت یا دامنه عوض شده؟ مسیرهای اینترنتی هم باید همان‌جا برود
  if (before && before.port !== result.site.port) {
    if (siteTunnelState(result.site.slug).status !== 'stopped') {
      restartSiteTunnel(result.site).catch(() => {});
    }
  }
  if (before?.port !== result.site.port) {
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

/*
 *  ⛔ (۱.۵۰.۷۳) «وارد کردنِ پیداشده‌ها» همان «افزودنِ سایت» است با چند ردیف: هر ردیف از همان `guardSite` می‌گذرد،
 *  و یک ردیفِ ردشده کلِ درخواست را رد می‌کند (هیچ چیز نیمه‌کاره وارد نمی‌شود). تا ۱.۵۰.۷۲ این در بی نگهبان بود:
 *  کارگزار با `startCommand` ِ دلخواه پوسته می‌گرفت و با ریشهٔ `data/` ِ پنل، `panel.db` را در فایل‌منیجر می‌دید.
 */
router.post('/discover/import', async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
  for (const item of items) {
    const row = item && typeof item === 'object' ? item : {};
    if (!guardSite(req, res, null, { path: row.path, startCommand: row.startCommand })) return;
  }
  const result = await importDiscovered(items, { domainAllowed: domainFresh(req) });
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

/*
 *  ⛔ (۱.۵۰.۸۶، تصمیمِ ۲-۱۱ «الف») روشن و دوباره‌روشن کردنِ سایت یعنی اجرای کدِ پوشه‌اش روی همین کامپیوتر — همراهِ
 *  نوشتنِ فایل در آن پوشه (فایل‌منیجر) عملاً همان «فرمانِ اجرا» ⇒ فقط مالک (و کلیدِ محلی). خاموش کردن آزاد ماند.
 */
const ownerStart = (req, res, next) => (denyUnlessShellAllowed(req, res, 'site.start') ? next() : undefined);
router.post('/:id/start', ownerStart, (req, res) => action(req, res, startSite, 'اجرای'));
router.post('/:id/stop', (req, res) => action(req, res, stopSite, 'توقف'));
router.post('/:id/restart', ownerStart, (req, res) => action(req, res, restartSite, 'راه‌اندازی مجدد'));

router.get('/:id/logs', (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const limit = Math.min(2000, Number(req.query.limit) || 300);
  const lines = tailLog(site.slug, limit).map((line) => {
    const [at, level, ...rest] = line.split('\t');
    return { at, level: level || 'info', text: rest.join('\t') || line };
  });
  const events = q('SELECT * FROM events WHERE site_id = ? ORDER BY id DESC LIMIT 200')
    .all(site.id);
  res.json({ lines, events });
});

router.delete('/:id/logs', (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  clearLog(site.slug);
  q('DELETE FROM events WHERE site_id = ?').run(site.id);
  res.json({ ok: true });
});

// تنظیمات اختصاصی سایت (متغیرهای محیطی جدا برای هر سایت)
router.put('/:id/config', (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const current = readSiteConfig(site.slug);
  const env = req.body?.env && typeof req.body.env === 'object' ? req.body.env : current.env;
  //  ⛔ S19 (۱.۵۰.۸۳): متغیرِ محیطی همان «فرمانِ اجرا» است (‎NODE_OPTIONS=--import data:…‎، ‎PATH‎) ⇒ همان نقشِ
  //  فرمانِ اجرا: دستِ‌کم admin (نه operator)، و فقط مالک (۱.۵۰.۸۶: همیشه). تا ۱.۵۰.۸۳ فقط سوئیچ سنجیده
  //  می‌شد، پس operator با سوئیچِ خاموش ‎NODE_OPTIONS‎ می‌گذاشت و کد اجرا می‌کرد.
  if (!req.user?.local && JSON.stringify(env || {}) !== JSON.stringify(current.env || {})) {
    if (userRole(req.user.id) !== 'admin') return res.status(403).json({ ok: false, error: 'forbidden', needed: 'admin' });
    if (!denyUnlessShellAllowed(req, res, 'site.env')) return;
  }
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

//  ⛔ (۱.۵۰.۹۹) افزودن/برداشتن فقط مالک + احرازِ دوباره (یا کلیدِ محلی) و دفتر؛ از همان راهِ اتمیِ ‎app-hosts.js‎:
//  سنجشِ سخت (punycode، بی ستاره…)، «یک نام یک صاحب» (مالِ سایتِ دیگر ⇒ ۴۰۹، نه کندن)، آخرین نامِ سایتِ روشن ⇒ ۴۰۹،
//  نوشتنِ ناموفقِ مسیرِ تونل ⇒ همه برمی‌گردد (۵۰۲). جابه‌جاییِ عمدیِ دامنه به سایتِ دیگر: «دامنه‌ها» (‎PUT /api/domains/:id‎).
function sendDomainAudit(req, action, r, app, hostname) {
  //  همان ردیفِ دفترِ ‎sendDomainResult‎، بی فرستادنِ پاسخ
  sendDomainResult(req, { setHeader() {}, status() { return this; }, json() { return this; } }, action, r, { app, hostname });
}

router.post('/:id/domains', siteDomainGuard, async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const app = `site:${site.slug}`;
  const r = await addAppHostname({ app, hostname: req.body?.domain, primary: req.body?.primary === true, by: req.user?.username });
  if (!r.ok) {
    sendDomainAudit(req, 'panel.domains.add', r, app, String(req.body?.domain || ''));
    const { status, ...rest } = r;
    const code = rest.error === 'invalid_hostname' ? 'invalid_domain' : rest.error === 'hostname_taken' ? 'domain_taken' : rest.error;
    return res.status(status || 400).json({ ...rest, error: code, reason: rest.reason || rest.error });
  }
  sendDomainResult(req, res, 'panel.domains.add', { ...r, domain: r.hostname, domains: domainsForSite(site.id).map((d) => d.name) }, { app });
});

router.delete('/:id/domains', siteDomainGuard, async (req, res) => {
  const site = getSite(req.params.id);
  if (!site) return res.status(404).json({ error: 'not_found' });
  const app = `site:${site.slug}`;
  const r = await removeAppHostname({ app, hostname: req.query.domain ?? req.body?.domain });
  sendDomainResult(req, res, 'panel.domains.remove', r.ok ? { ...r, domains: domainsForSite(site.id).map((d) => d.name) } : r, { app, hostname: String(req.query.domain ?? '') });
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
