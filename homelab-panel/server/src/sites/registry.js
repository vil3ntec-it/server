// ---------------------------------------------------------------------------
// دفترچهٔ سایت‌ها: افزودن با «مسیر پروژه»، کشف خودکار، وضعیت واقعی، حجم و تاریخ
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { q, db, logEvent, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { sitesRoot } from './root.js';
import { detectProject, defaultScanRoots } from './detect.js';
import { ensureWorkspace, removeWorkspace, slugify, workspacePaths } from './workspace.js';
import { isRunning, processInfo, probePort, stopSite } from './process.js';
import { checkSiteOnline } from './health.js';
import { dirSize } from '../metrics/system.js';
import { getSiteSync } from '../state.js';
import { siteTunnelState, siteTunnelWanted, stopSiteTunnel } from '../site-tunnels.js';

const PORT_RANGE_START = 8100;
const PORT_RANGE_END = 8999;

export function listSitesRaw() {
  return q('SELECT * FROM sites ORDER BY name COLLATE NOCASE').all();
}

export function getSite(id) {
  return q('SELECT * FROM sites WHERE id = ?').get(Number(id));
}

export function getSiteBySlug(slug) {
  return q('SELECT * FROM sites WHERE slug = ?').get(String(slug));
}

function uniqueSlug(base) {
  let slug = slugify(base);
  let n = 2;
  while (getSiteBySlug(slug)) {
    slug = `${slugify(base)}-${n++}`;
  }
  return slug;
}

// پورت آزاد: هم با سایت‌های ثبت‌شده تداخل نداشته باشد، هم واقعاً روی سیستم آزاد باشد
export async function allocatePort(preferred) {
  const used = new Set(
    q('SELECT port FROM sites WHERE port IS NOT NULL')
      .all()
      .map((r) => r.port)
  );
  used.add(config.port);
  if (preferred && !used.has(Number(preferred))) return Number(preferred);
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (used.has(p)) continue;
    if (await probePort(p)) continue; // چیز دیگری روی این پورت گوش می‌دهد
    return p;
  }
  return null;
}

// -------------------------------- دامنه‌ها ---------------------------------
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeDomain(value) {
  const clean = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
  return DOMAIN_RE.test(clean) ? clean : null;
}

/** همهٔ دامنه‌هایی که به این سایت وصل‌اند — یک سایت می‌تواند چند دامنه داشته باشد */
export function domainsForSite(siteId) {
  return q('SELECT id, name FROM domains WHERE site_id = ? ORDER BY name COLLATE NOCASE')
    .all(Number(siteId));
}

/**
 * دامنه را به یک سایت وصل می‌کند. اگر دامنه از قبل جای دیگری بوده،
 * از آنجا کنده و به اینجا وصل می‌شود — یعنی «همین دامنه، سایتِ دیگر».
 */
export function attachDomain(siteId, domainName) {
  const name = normalizeDomain(domainName);
  if (!name) return { ok: false, error: 'invalid_domain' };
  const site = getSite(siteId);
  if (!site) return { ok: false, error: 'not_found' };

  const existing = q('SELECT * FROM domains WHERE name = ?').get(name);
  if (existing) {
    if (existing.site_id !== site.id) {
      q('UPDATE domains SET site_id = ? WHERE id = ?').run(site.id, existing.id);
      logEvent('info', 'panel', `دامنهٔ ${name} از این پس به سایت «${site.name}» می‌رود`, site.id);
    }
  } else {
    q('INSERT INTO domains(name, site_id, created_at) VALUES(?, ?, ?)').run(name, site.id, Date.now());
    logEvent('info', 'panel', `دامنهٔ ${name} به سایت «${site.name}» وصل شد`, site.id);
  }

  // دامنهٔ اصلیِ سایت: اگر نداشت، همین تازه را اصلی می‌کنیم
  if (!site.domain) {
    q('UPDATE sites SET domain = ?, updated_at = ? WHERE id = ?').run(name, Date.now(), site.id);
  }
  return { ok: true, domain: name };
}

/** دامنه را از سایت جدا می‌کند (خودِ دامنه در فهرست دامنه‌ها می‌ماند) */
export function detachDomain(siteId, domainName) {
  const name = normalizeDomain(domainName);
  const site = getSite(siteId);
  if (!site || !name) return { ok: false, error: 'not_found' };
  q('UPDATE domains SET site_id = NULL WHERE name = ? AND site_id = ?').run(name, site.id);
  if (site.domain === name) {
    const next = domainsForSite(site.id)[0]?.name ?? null;
    q('UPDATE sites SET domain = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), site.id);
  }
  logEvent('info', 'panel', `دامنهٔ ${name} از سایت «${site.name}» جدا شد`, site.id);
  return { ok: true };
}

// -------------------------------- افزودن ----------------------------------
export async function addSite({ rootPath, name, domain, port, kind, startCommand, autostart = false }) {
  const resolved = path.resolve(String(rootPath || '').trim());
  if (!resolved || !fs.existsSync(resolved)) return { ok: false, error: 'path_not_found' };
  if (!fs.statSync(resolved).isDirectory()) return { ok: false, error: 'not_a_directory' };

  const existing = q('SELECT * FROM sites WHERE root_path = ?').get(resolved);
  if (existing) return { ok: false, error: 'already_exists', site: existing };

  const detected = detectProject(resolved);
  const finalName = (name || detected.name || path.basename(resolved)).trim();
  const slug = uniqueSlug(finalName);
  const now = Date.now();

  const row = {
    slug,
    name: finalName,
    root_path: resolved,
    domain: normalizeDomain(domain),
    port: await allocatePort(port || detected.port),
    kind: kind || detected.kind || 'static',
    start_command: startCommand ?? detected.startCommand ?? null,
    autostart: autostart ? 1 : 0,
  };

  q(
    `INSERT INTO sites(slug, name, root_path, domain, port, kind, start_command, autostart, enabled, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    row.slug,
    row.name,
    row.root_path,
    row.domain,
    row.port,
    row.kind,
    row.start_command,
    row.autostart,
    now,
    now
  );

  ensureWorkspace(slug);
  const site = getSiteBySlug(slug);
  if (site.domain) attachDomain(site.id, site.domain);

  // پوشهٔ داده، رمز، دامنه و آدرس اینترنتی — همه خودکار، از همان لحظهٔ افزودن
  const provisioned = await provisionSite(site);

  logEvent('info', 'panel', `سایت «${site.name}» از مسیر ${resolved} اضافه شد`, site.id);
  return { ok: true, site: getSite(site.id), provisioned };
}

// --------------------------- راه‌اندازیِ خودکار -----------------------------
//  با افزودن یک سایت، خودش همه‌چیزش را می‌گیرد: پوشهٔ داده، رمز، پورت، دامنه و
//  آدرس اینترنتی. کاربر نباید هیچ‌کدام را دستی تنظیم کند.
// ---------------------------------------------------------------------------

/** برچسبِ امن برای DNS از روی نام سایت (حروف فارسی در دامنه کار نمی‌کند) */
function dnsLabel(site) {
  const label = String(site.slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return label || `site-${site.id}`;
}

/**
 * دامنهٔ پایه‌ای که زیردامنهٔ هر سایت از آن ساخته می‌شود.
 * یا خودتان در تنظیمات می‌گذارید، یا از روی آدرس ثابتِ تونل حدس زده می‌شود
 * (مثلاً sync.yaqobipump.top ← yaqobipump.top).
 */
export function baseDomain() {
  const explicit = normalizeDomain(getSetting('sites_base_domain', null));
  if (explicit) return explicit;
  const host = normalizeDomain(getSetting('tunnel_hostname', null));
  if (!host) return null;
  const parts = host.split('.');
  return parts.length > 2 ? parts.slice(1).join('.') : host;
}

/** زیردامنه‌ای که هنوز مالِ سایت دیگری نیست */
function freeSubdomain(site, zone) {
  const label = dnsLabel(site);
  for (let n = 1; n <= 20; n++) {
    const candidate = normalizeDomain(`${n === 1 ? label : `${label}-${n}`}.${zone}`);
    if (!candidate) return null;
    const owner = q('SELECT site_id FROM domains WHERE name = ?').get(candidate);
    if (!owner || owner.site_id === site.id || owner.site_id == null) return candidate;
  }
  return null;
}

/** آیا اجازه داریم تونل بالا بیاوریم؟ (در آزمون‌ها و حالت آفلاین خاموش است) */
function tunnelAllowed() {
  return (process.env.HLP_TUNNEL ?? '1') !== '0';
}

/**
 * همهٔ کارهای راه‌اندازیِ یک سایتِ تازه — خودکار.
 * اگر دامنهٔ پایه دارید، زیردامنهٔ خودِ سایت ساخته و وصل می‌شود؛ اگر نه، یک
 * آدرس اینترنتیِ مستقل برایش بالا می‌آید تا از همان لحظه در دسترس باشد.
 */
export async function provisionSite(site, { auto } = {}) {
  const enabled = auto ?? getSetting('site_autosetup', true) !== false;
  const report = { domain: null, tunnel: null, dataDir: null };

  const store = await ensureSiteDataFolder(site);
  report.dataDir = store?.dataDir ?? null;
  if (!enabled) return report;

  const zone = baseDomain();
  if (!site.domain && zone) {
    const candidate = freeSubdomain(site, zone);
    if (candidate) {
      const attached = attachDomain(site.id, candidate);
      if (attached.ok) {
        report.domain = candidate;
        logEvent('info', 'panel', `دامنهٔ ${candidate} خودکار برای سایت «${site.name}» ساخته شد`, site.id);
        const { syncTunnelRoutes } = await import('../tunnel.js');
        syncTunnelRoutes().catch(() => {});
      }
    }
  }

  // بدون دامنهٔ پایه، آدرس اینترنتیِ مستقلِ خودِ سایت
  if (!report.domain && !site.domain && site.port && tunnelAllowed()) {
    const { startSiteTunnel } = await import('../site-tunnels.js');
    startSiteTunnel(site).catch((e) =>
      logEvent('error', 'panel', `آدرس اینترنتی سایت ${site.name} بالا نیامد: ${e.message}`, site.id)
    );
    report.tunnel = 'starting';
  }

  return report;
}

/**
 * پوشهٔ اختصاصیِ دادهٔ یک سایت داخل پوشهٔ سرور:
 *     data/site-sync/sites/<slug>/
 * با رمزِ جداگانهٔ خودش، تا دادهٔ سایت‌ها هرگز قاطی یا گم نشود.
 */
export async function ensureSiteDataFolder(site) {
  const sync = getSiteSync();
  if (!sync?.ensureTenant) return null;
  // سایتِ اصلی دادهٔ خودش را در دفترِ اصلی دارد؛ دفترِ دوم برایش ساخته نمی‌شود
  if (mainSiteId() === site.id) return sync.tenant?.('main') ?? null;
  return sync.ensureTenant(site.slug, { label: site.name });
}

// ------------------- ثبتِ خودکارِ سایتِ اصلی (پمپ یعقوبی) -------------------
//  وقتی سرور را به سایت می‌دهید، خودِ آن سایت و دامنه‌اش هم باید در پنل دیده
//  شوند — نه اینکه دستی اضافه‌شان کنید. این کار همین را انجام می‌دهد:
//      • یک سایت برای خودِ برنامهٔ پمپ ساخته می‌شود
//      • دامنهٔ سایت و زیردامنهٔ تونل در بخش «دامنه‌ها» ثبت می‌شوند
//      • پوشه‌اش زیر ریشهٔ سایت‌ها ساخته می‌شود تا در فایل‌منیجر هم باشد
//  دادهٔ این سایت همان دفترِ اصلی است، پس پوشهٔ تازه‌ای برایش ساخته نمی‌شود.
// ---------------------------------------------------------------------------
export const MAIN_SITE_SETTING = 'main_site_id';

export function mainSiteId() {
  const raw = getSetting(MAIN_SITE_SETTING, null);
  return raw ? Number(raw) : null;
}

export async function ensureMainSite({ siteUrl, tunnelHostname } = {}) {
  const url = String(siteUrl || getSetting('site_url', '') || '').trim();
  const primary = normalizeDomain(url);
  const extra = normalizeDomain(tunnelHostname || getSetting('tunnel_hostname', null));
  if (!primary && !extra) return { ok: false, error: 'no_domain' };

  let site = mainSiteId() ? getSite(mainSiteId()) : null;

  if (!site) {
    // شاید از قبل با همین دامنه ساخته شده باشد
    if (primary) {
      const owner = q('SELECT site_id FROM domains WHERE name = ?').get(primary);
      if (owner?.site_id) site = getSite(owner.site_id);
    }
  }

  if (!site) {
    const label = primary || extra;
    const dir = path.join(sitesRoot(), slugify(label.split('.')[0]) || 'main-site');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch { /* اگر نشد، سایت بدون پوشه ثبت می‌شود */ }

    const added = await addSite({
      rootPath: fs.existsSync(dir) ? dir : sitesRoot(),
      name: label,
      kind: 'external', // روی هاست دیگری بالاست، نه روی این کامپیوتر
      domain: primary || extra,
    });
    if (!added.ok) return added;
    site = added.site;
    // پورتِ محلی ندارد؛ آنلاین بودنش از روی خودِ دامنه فهمیده می‌شود
    q('UPDATE sites SET port = NULL, updated_at = ? WHERE id = ?').run(Date.now(), site.id);
    setSetting(MAIN_SITE_SETTING, site.id);
    logEvent('info', 'panel', `سایت «${label}» خودکار در پنل ثبت شد`, site.id);
  }

  setSetting(MAIN_SITE_SETTING, site.id);
  // هر دو دامنه به همین سایت وصل می‌شوند
  for (const name of [primary, extra]) {
    if (name) attachDomain(site.id, name);
  }

  return { ok: true, site: getSite(site.id), domains: domainsForSite(site.id).map((d) => d.name) };
}

/** هنگام بالا آمدن سرور: هر سایتِ ثبت‌شده پوشه و رمزِ خودش را داشته باشد */
export async function ensureAllSiteWorkspaces() {
  const done = [];
  for (const site of listSitesRaw()) {
    try {
      ensureWorkspace(site.slug);
      await ensureSiteDataFolder(site);
      done.push(site.slug);
    } catch (e) {
      logEvent('error', 'panel', `پوشهٔ سایت ${site.name} آماده نشد: ${e.message}`, site.id);
    }
  }
  return done;
}

export function updateSite(id, patch) {
  const site = getSite(id);
  if (!site) return { ok: false, error: 'not_found' };

  const fields = [];
  const values = [];
  const allowed = {
    name: 'name',
    domain: 'domain',
    port: 'port',
    kind: 'kind',
    startCommand: 'start_command',
    autostart: 'autostart',
    enabled: 'enabled',
  };

  // دامنه جداگانه رسیدگی می‌شود: هم باید درست باشد، هم در جدول دامنه‌ها بنشیند
  let nextDomain;
  if ('domain' in patch) {
    const raw = String(patch.domain ?? '').trim();
    if (!raw) {
      nextDomain = null;
    } else {
      nextDomain = normalizeDomain(raw);
      if (!nextDomain) return { ok: false, error: 'invalid_domain' };
    }
  }

  for (const [key, column] of Object.entries(allowed)) {
    if (!(key in patch)) continue;
    let v = patch[key];
    if (column === 'domain') v = nextDomain;
    else {
      if (column === 'autostart' || column === 'enabled') v = v ? 1 : 0;
      if (column === 'port') v = v ? Number(v) : null;
      if (typeof v === 'string') v = v.trim() || null;
    }
    fields.push(`${column} = ?`);
    values.push(v);
  }
  if (!fields.length) return { ok: true, site };

  fields.push('updated_at = ?');
  values.push(Date.now(), site.id);
  q(`UPDATE sites SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  // دامنهٔ تازه باید واقعاً به همین سایت وصل شود، نه فقط یک برچسب باشد
  if (nextDomain && nextDomain !== site.domain) attachDomain(site.id, nextDomain);
  if (nextDomain === null && site.domain) detachDomain(site.id, site.domain);

  logEvent('info', 'panel', `تنظیمات سایت «${site.name}» تغییر کرد`, site.id);
  return { ok: true, site: getSite(site.id), domainChanged: 'domain' in patch };
}

export async function removeSite(id, { deleteWorkspace = true } = {}) {
  const site = getSite(id);
  if (!site) return { ok: false, error: 'not_found' };
  await stopSite(site);
  stopSiteTunnel(site.slug);
  q('DELETE FROM sites WHERE id = ?').run(site.id);
  if (deleteWorkspace) {
    await removeWorkspace(site.slug);
    // دادهٔ اختصاصی همین سایت هم می‌رود؛ با «نگه‌داشتن داده» دست‌نخورده می‌ماند
    await getSiteSync()?.removeTenant?.(site.slug);
  }
  logEvent('warn', 'panel', `سایت «${site.name}» از پنل حذف شد (فایل‌های خود سایت دست‌نخورده است)`);
  return { ok: true };
}

// ------------------------- ساخت سایت جدید با پوشهٔ مستقل -------------------
export async function createSiteFolder({ name, kind = 'static', domain, port }) {
  const clean = slugify(name);
  if (!clean) return { ok: false, error: 'bad_name' };
  const dir = path.join(sitesRoot(), clean);
  if (fs.existsSync(dir)) return { ok: false, error: 'folder_exists' };

  fs.mkdirSync(dir, { recursive: true });
  if (kind === 'static') {
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      `<!doctype html>\n<html lang="fa" dir="rtl">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>${name}</title>\n</head>\n<body>\n  <h1>${name}</h1>\n</body>\n</html>\n`,
      'utf8'
    );
  }
  return addSite({ rootPath: dir, name, kind, domain, port });
}

// ------------------------------ کشف خودکار --------------------------------
export async function discoverSites({ roots } = {}) {
  const scanRoots = (roots?.length ? roots : getSetting('scan_roots', null) || defaultScanRoots(sitesRoot()))
    .map((r) => path.resolve(r))
    .filter((r, i, arr) => arr.indexOf(r) === i);

  const known = new Set(listSitesRaw().map((s) => s.root_path));
  const found = [];

  for (const root of scanRoots) {
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue; // این ریشه وجود ندارد — رد شو
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      const dir = path.join(root, e.name);
      const detected = detectProject(dir);
      if (!detected.kind) continue; // پوشهٔ پروژهٔ وب نیست
      found.push({
        path: dir,
        name: detected.name,
        kind: detected.kind,
        port: detected.port,
        startCommand: detected.startCommand,
        alreadyAdded: known.has(dir),
      });
    }
    // خودِ ریشه هم ممکن است یک سایت باشد
    const rootDetected = detectProject(root);
    if (rootDetected.kind && !found.some((f) => f.path === root)) {
      const isEmptyRoot = !entries.length;
      if (!isEmptyRoot && (rootDetected.kind !== 'static' || fs.existsSync(path.join(root, 'index.html')))) {
        found.push({
          path: root,
          name: rootDetected.name,
          kind: rootDetected.kind,
          port: rootDetected.port,
          startCommand: rootDetected.startCommand,
          alreadyAdded: known.has(root),
        });
      }
    }
  }

  return { roots: scanRoots, found };
}

export async function importDiscovered(items) {
  const added = [];
  const skipped = [];
  for (const item of items || []) {
    const res = await addSite({
      rootPath: item.path,
      name: item.name,
      kind: item.kind,
      port: item.port,
      startCommand: item.startCommand,
    });
    if (res.ok) added.push(res.site);
    else skipped.push({ path: item.path, error: res.error });
  }
  return { added, skipped };
}

// --------------------------- وضعیت کامل هر سایت ----------------------------
const sizeCache = new Map(); // slug -> { at, value }

export async function siteSize(site, { force = false } = {}) {
  const cached = sizeCache.get(site.slug);
  if (!force && cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;
  const value = fs.existsSync(site.root_path)
    ? await dirSize(site.root_path)
    : { bytes: 0, files: 0, newest: 0, truncated: false };
  sizeCache.set(site.slug, { at: Date.now(), value });
  return value;
}

export function invalidateSizeCache(slug) {
  if (slug) sizeCache.delete(slug);
  else sizeCache.clear();
}

export async function describeSite(site, { withSize = true } = {}) {
  const managed = processInfo(site.slug);
  const size = withSize ? await siteSize(site) : null;
  const ws = workspacePaths(site.slug);

  // آدرس‌های عمومیِ این سایت: دامنه‌های وصل‌شده + تونل اختصاصی خودش
  const domains = domainsForSite(site.id);
  const tunnel = siteTunnelState(site.slug);
  const publicUrls = [
    ...domains.map((d) => `https://${d.name}`),
    ...(tunnel.url ? [tunnel.url] : []),
  ];
  const health = await checkSiteOnline(site, { urls: publicUrls });

  // پوشهٔ دادهٔ اختصاصی همین سایت داخل پوشهٔ سرور.
  // سایتِ اصلی (خودِ برنامهٔ پمپ) از همان دفترِ اصلی استفاده می‌کند.
  const sync = getSiteSync();
  const isMain = mainSiteId() === site.id;
  const store = sync?.tenant?.(isMain ? 'main' : site.slug);
  const ownStore = isMain ? store : store && store.key === site.slug ? store : null;

  let lastModified = size?.newest || null;
  if (!lastModified) {
    try {
      lastModified = fs.statSync(site.root_path).mtimeMs;
    } catch {
      lastModified = null;
    }
  }

  const errors = q("SELECT COUNT(*) AS n FROM events WHERE site_id = ? AND level = 'error'")
    .get(site.id).n;

  return {
    id: site.id,
    slug: site.slug,
    name: site.name,
    domain: site.domain,
    domains: domains.map((d) => d.name),
    path: site.root_path,
    pathExists: fs.existsSync(site.root_path),
    port: site.port,
    kind: site.kind,
    startCommand: site.start_command,
    autostart: Boolean(site.autostart),
    enabled: Boolean(site.enabled),
    online: health.online,
    onlineVia: health.via, // process | port | public
    httpStatus: health.httpStatus,
    managed: Boolean(managed),
    process: managed,
    sizeBytes: size?.bytes ?? null,
    fileCount: size?.files ?? null,
    lastModified,
    errorCount: errors,
    workspace: ws.base,
    // پوشهٔ دادهٔ اختصاصیِ همین سایت داخل پوشهٔ سرور
    isMainSite: isMain,
    dataDir: ownStore?.dataDir ?? (sync?.dirFor ? sync.dirFor(site.slug) : null),
    dataBytes: ownStore ? ownStore.diskBytes() : null,
    dataBranches: ownStore ? ownStore.branches().length : null,
    liveConnections: ownStore ? ownStore.snapshot().liveConnections : null,
    publicUrls,
    tunnel: { ...tunnel, wanted: siteTunnelWanted(site.slug) },
    url: site.port ? `http://${'{host}'}:${site.port}` : site.domain ? `https://${site.domain}` : null,
    createdAt: site.created_at,
    updatedAt: site.updated_at,
  };
}

export async function listSites(options = {}) {
  const rows = listSitesRaw();
  return Promise.all(rows.map((s) => describeSite(s, options)));
}

export async function autostartAll() {
  const rows = listSitesRaw().filter((s) => s.autostart && s.enabled);
  const { startSite } = await import('./process.js');
  for (const site of rows) {
    if (isRunning(site.slug)) continue;
    try {
      await startSite(site);
    } catch (e) {
      logEvent('error', 'process', `اجرای خودکار سایت ${site.name} ناموفق بود: ${e.message}`, site.id);
    }
  }

  // تونلِ سایت‌هایی که آدرس اینترنتی داشتند دوباره بالا می‌آید
  const { autostartSiteTunnels } = await import('../site-tunnels.js');
  await autostartSiteTunnels(listSitesRaw().filter((s) => s.enabled));
}
