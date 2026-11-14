// ---------------------------------------------------------------------------
//  «چند دامنه برای هر برنامه» (۱.۵۰.۹۹) — تنها جای «این نام مالِ کدام برنامه است» و تغییرِ نام‌های یک برنامه
//
//  برنامه‌ها همان شناسه‌های «سرورهای من»اند: ‎site:<نامک>‎ · ‎account-server‎ · ‎stations‎ (پمپ‌ها — فقط داده؛ کدِ پمپ دست
//  نمی‌خورد). هر برنامه یک نامِ اصلی و هر چند نامِ دیگر دارد:
//    • سایت: جدولِ `domains` (‎site_id‎)، اصلی = `sites.domain` — همان که تا امروز بود.
//    • سرورِ حساب: ‎api.<دامنه>‎ ِ خودکار (`tunnel.js`) + نام‌های افزوده در `app_hostnames` (مهاجرتِ ۰۱۲).
//    • پمپ‌ها: نام‌های افزوده در `app_hostnames`.
//  نام‌های افزودهٔ سرورِ حساب/پمپ‌ها در ingress ِ تونل به پورتِ عمومی می‌روند (همان که ‎api.‎ رویش است).
//
//  ⛔ قاعده‌ها:
//    • هر نام از `lib/hostname.js` می‌گذرد (punycode، بی ستاره، بی پورت/IP/نامِ درونی، بی نامِ هم‌شکل).
//    • یک نام، یک صاحب: نامی که مالِ برنامهٔ دیگر است (سایت، سرورِ حساب، ‎admin.‎ ِ خودکار، نشانیِ اصلیِ تونل، زیردامنهٔ
//      دستیِ تونل) رد — نه «کندن و آوردن». نگهبانِ SQLite هم همین را می‌گوید (مهاجرتِ ۰۱۲).
//    • برداشتنِ آخرین نامِ برنامهٔ روشن رد (‎last_hostname_running‎) — برای هر راهی که نام کم می‌کند، در همان تراکنش.
//    • اتمی: تغییرِ دیتابیس ⇒ ingress (فایلِ کناری + rename) ⇒ DNS ِ نامِ تازه ⇒ راه‌اندازیِ تونل. نوشتنِ ناموفقِ ingress یا
//      DNS ِ ناموفقِ همان نام ⇒ دیتابیس، تنظیم‌های مسیر و ‎config.yml‎ همه برمی‌گردند (‎route_write_failed‎، ‎rolledBack‎).
//    • یکی‌یکی: همهٔ تغییرها پشتِ سرِ هم (`serial`) — دو درخواستِ هم‌زمان برای یک نام هرگز دو صاحب نمی‌سازند.
//    • نام‌های سرورِ حساب که عوض شد ⇒ ‎PUBLIC_BASE_URLS‎ ِ فرزند (`supervisor.onAccountHostsChanged`).
//  «فقط مالک + احرازِ دوباره» و دفتر (‎panel.domains.*‎) کارِ درهاست (`routes/app-domains.js`، `routes/sites.js`،
//  `routes/domains.js`) — این ماژول هرگز چیزی را بی آن‌ها صدا نمی‌زند جز کارهای خودِ سامانه (جابه‌جایی، سایتِ اصلی).
// ---------------------------------------------------------------------------
import { domainToUnicode } from 'node:url';
import { db, q, getSetting, logEvent } from './db.js';
import { parseHostname } from './lib/hostname.js';
import { isProtectedHost } from './protected-hosts.js';
import { adminHostnames, apiHostnames, syncTunnelRoutes, ingressSnapshot, restoreIngress, namedConfig, DEFAULT_TUNNEL_NAME } from './tunnel.js';
import { getSiteBySlug, listSitesRaw, domainsForSite } from './sites/registry.js';
import { isRunning } from './sites/process.js';
import { accountStatus, onAccountHostsChanged } from './account/supervisor.js';
import { ACCOUNT_APP, accountHostList, accountPublicBaseUrls, aliasRows } from './account/public-urls.js';
import { getStations } from './state.js';
import { planRoute } from './fleet/route-plan.js';
import { bumpSoon } from './live/bus.js';
import { config, deploy } from './config.js';

export const STATIONS_APP = 'stations';
export const MAX_HOSTNAMES_PER_APP = 20;
export { ACCOUNT_APP, accountPublicBaseUrls };

const coded = (status, error, message, extra = {}) => ({ ok: false, status, error, message, ...extra });

/** ‎site:<نامک>‎ | ‎account-server‎ | ‎stations‎ ⇒ شکلِ خوانده؛ هر چیزِ دیگر null */
export function parseAppId(appId) {
  const id = String(appId || '').trim();
  if (id === ACCOUNT_APP) return { id, kind: 'account' };
  if (id === STATIONS_APP) return { id, kind: 'stations' };
  const m = /^site:([a-z0-9][a-z0-9-]{0,80})$/.exec(id);
  if (m) {
    const site = getSiteBySlug(m[1]);
    return site ? { id, kind: 'site', slug: m[1], site } : null;
  }
  return null;
}

const show = (h) => domainToUnicode(h) || h;

function appLabel(appId) {
  if (appId === ACCOUNT_APP) return 'سرورِ حساب';
  if (appId === STATIONS_APP) return 'پمپ‌ها (تانک‌تیل)';
  if (appId === 'admin') return 'برنامهٔ مدیر (admin.)';
  if (appId === 'panel') return 'نشانیِ اصلیِ این سرور (تونل)';
  if (appId === 'manual') return 'زیردامنهٔ دستیِ تونل';
  const m = /^site:(.+)$/.exec(appId || '');
  if (m) {
    const s = getSiteBySlug(m[1]);
    return s ? `سایتِ «${s.name}»` : `سایتِ «${m[1]}»`;
  }
  return String(appId || '');
}

function stationsCount() {
  try { return getStations()?.list?.().length || 0; } catch { return 0; }
}

/** این برنامه روشن است؟ (پمپ‌ها داخلِ پروسهٔ پنل‌اند ⇒ با دستِ‌کم یک پمپِ ثبت‌شده همیشه روشن — همان تعریفِ «سرورهای من») */
function appRunning(app) {
  if (app.kind === 'site') return isRunning(app.slug);
  if (app.kind === 'account') { try { return Boolean(accountStatus().running); } catch { return false; } }
  return stationsCount() > 0;
}

/** همهٔ نام‌های یک برنامه، نامِ اصلی اول: ‎[{ hostname, display, primary, auto }]‎ */
function hostsOf(app) {
  if (app.kind === 'site') {
    const site = getSiteBySlug(app.slug) || app.site;
    const names = domainsForSite(site.id).map((d) => d.name);
    const primary = names.includes(site.domain) ? site.domain : names[0] || null;
    return [primary, ...names.filter((n) => n !== primary)].filter(Boolean).map((h) => ({ hostname: h, display: show(h), primary: h === primary, auto: false }));
  }
  if (app.kind === 'account') return accountHostList().map((h) => ({ ...h, display: show(h.hostname) }));
  const rows = aliasRows(STATIONS_APP);
  const primary = rows.find((r) => r.is_primary)?.hostname || rows[0]?.hostname || null;
  return rows.map((r) => ({ hostname: r.hostname, display: show(r.hostname), primary: r.hostname === primary, auto: false }));
}

/** نمای یک برنامه برای صفحه — بی هیچ راز */
export function hostnamesOf(appId) {
  const app = parseAppId(appId);
  if (!app) return null;
  const hostnames = hostsOf(app);
  return {
    app: app.id,
    kind: app.kind,
    label: appLabel(app.id),
    running: appRunning(app),
    primary: hostnames.find((h) => h.primary)?.hostname || null,
    hostnames,
    ...(app.kind === 'stations' ? { dataOnly: true, count: stationsCount() } : {}),
    ...(app.kind === 'site' ? { siteId: app.site.id, siteKind: app.site.kind || 'static', enabled: Boolean(app.site.enabled), port: app.site.port ?? null } : {}),
  };
}

/** همهٔ برنامه‌های همین نصب با نام‌هایشان */
export function listAppHostnames() {
  const out = [];
  let acct = { installed: false, running: false };
  try { acct = accountStatus(); } catch { /* نیست */ }
  const a = hostnamesOf(ACCOUNT_APP);
  if (acct.installed || acct.running || a.hostnames.length) out.push(a);
  for (const s of listSitesRaw()) {
    const v = hostnamesOf(`site:${s.slug}`);
    if (v) out.push(v);
  }
  out.push(hostnamesOf(STATIONS_APP));
  return out;
}

/** صاحبِ یک نام روی همین نصب: ‎{ app, label, source: site|alias|auto|main|manual }‎ یا null */
export function ownerOf(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return null;
  const d = q('SELECT d.site_id, s.slug FROM domains d LEFT JOIN sites s ON s.id = d.site_id WHERE d.name = ?').get(h);
  if (d?.site_id && d.slug) return { app: `site:${d.slug}`, label: appLabel(`site:${d.slug}`), source: 'site' };
  let row = null;
  try { row = q('SELECT app_id FROM app_hostnames WHERE hostname = ?').get(h); } catch { row = null; }
  if (row) return { app: row.app_id, label: appLabel(row.app_id), source: 'alias' };
  if (apiHostnames().includes(h)) return { app: ACCOUNT_APP, label: appLabel(ACCOUNT_APP), source: 'auto' };
  if (adminHostnames().includes(h)) return { app: 'admin', label: appLabel('admin'), source: 'auto' };
  if (getSetting('tunnel_hostname', null) === h) return { app: 'panel', label: appLabel('panel'), source: 'main' };
  if ((getSetting('tunnel_hostnames', []) || []).some((x) => String(x?.hostname || '').toLowerCase() === h)) {
    return { app: 'manual', label: appLabel('manual'), source: 'manual' };
  }
  return null;
}

/** شمارِ نام‌های هر برنامهٔ **روشن** (برای «آخرین نام») */
function runningCounts() {
  const out = new Map();
  const apps = [parseAppId(ACCOUNT_APP), parseAppId(STATIONS_APP), ...listSitesRaw().map((s) => parseAppId(`site:${s.slug}`))].filter(Boolean);
  for (const app of apps) if (appRunning(app)) out.set(app.id, hostsOf(app).length);
  return out;
}

/* ─────────────────────────────── مسیر (تونل) ─────────────────────────────── */

/** ‎{ mode: named|token|quick|none, tunnelName, auto }‎ — همان `fleet/route.js#routeInfo` (بی راز) */
export function routeMode() {
  const n = namedConfig();
  const mode = n.mode === 'named' || n.mode === 'token' ? n.mode : (deploy.features.tunnel ? 'quick' : 'none');
  return { mode, tunnelName: mode === 'named' ? (n.tunnelName || DEFAULT_TUNNEL_NAME) : null, auto: mode === 'named' && Boolean(n.loggedIn) && Boolean(n.configured) };
}

/** گامِ دستی/خودکارِ هر نامِ تازه روی همین سرور (همان قراردادِ `route-plan.js`) */
function routeGuide(hostnames, applied) {
  const info = routeMode();
  const port = config.siteSync.port || config.port;
  return { ...info, ...planRoute({ hostnames, from: { name: null, route: info }, to: { name: null, route: info }, claim: { applied, port } }) };
}

/* ─────────────────────────────── یکی‌یکی و اتمی ─────────────────────────────── */

let chain = Promise.resolve();
/** همهٔ تغییرهای نام پشتِ سرِ هم (درها، جابه‌جایی، سایتِ اصلی) */
export function serial(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

function inTx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* بسته */ }
    throw e;
  }
}

//  صفحه‌های «سرورهای من» (کارتِ دامنه‌ها) و «سایت‌ها» زنده می‌مانند — موضوعِ تازه‌ای لازم نشد
function bumpDomains() {
  try { bumpSoon('fleet', 200); bumpSoon('sites', 200); } catch { /* گذرگاه نباید کسی را بخواباند */ }
}

/**
 * یک تغییرِ نام، همه یا هیچ. `mutate()` (هم‌گام، در تراکنش) کار را می‌کند و تابعِ برگرداندن می‌دهد.
 * @returns ‎{ ok, route, accountRestarted, publicBaseUrls }‎ یا ‎{ ok:false, status, error, message, ... }‎
 */
async function applyAtomic({ mutate, verify = [], routes = true }) {
  const before = runningCounts();
  const urlsBefore = accountPublicBaseUrls().join(',');
  const snap = routes ? ingressSnapshot() : null;
  let undo;
  try {
    undo = inTx(() => {
      const u = mutate();
      const after = runningCounts();
      for (const [app, n] of before) {
        if (n > 0 && (after.get(app) || 0) === 0) {
          throw Object.assign(new Error('last_hostname_running'), { code: 'last_hostname_running', app });
        }
      }
      return u;
    });
  } catch (e) {
    if (e?.code === 'last_hostname_running') {
      return coded(409, 'last_hostname_running', `${appLabel(e.app)} روشن است و این آخرین نامِ آن است — اول نامِ دیگری بیفزایید یا برنامه را خاموش کنید.`, { app: e.app });
    }
    if (/hostname_taken/.test(String(e?.message))) return coded(409, 'hostname_taken', 'این نام مالِ برنامهٔ دیگری است.');
    if (e?.status) return e;
    throw e;
  }

  let sync = { ok: true, applied: false };
  if (routes) {
    try {
      sync = await syncTunnelRoutes({ restart: true, strict: { verify } });
    } catch (e) {
      sync = { ok: false, applied: true, ingressError: String(e?.message || e).slice(0, 200), restarted: false };
    }
    if (sync.applied && (sync.ingressError || (sync.verifyFailed || []).length)) {
      try { inTx(() => undo()); } catch (e) { logEvent('error', 'panel', `برگرداندنِ دیتابیسِ دامنه‌ها نشد: ${e?.message || e}`); }
      await restoreIngress(snap, { restart: Boolean(sync.restarted) }).catch(() => {});
      const failures = sync.ingressError ? [{ hostname: '*', detail: `ingress_write_failed: ${sync.ingressError}` }] : sync.verifyFailed;
      logEvent('warn', 'panel', `تغییرِ دامنه برگشت خورد — مسیرِ تونل نوشته نشد (${failures.map((f) => f.hostname).join('، ')})؛ همه به حالِ قبل`);
      bumpDomains();
      return coded(502, 'route_write_failed', 'مسیرِ تونل نوشته نشد — هیچ چیزی عوض نشد (همه به حالِ قبل برگشت).', { failures, rolledBack: true });
    }
  }
  const urls = accountPublicBaseUrls();
  let accountRestarted = false;
  if (urls.join(',') !== urlsBefore) {
    try { accountRestarted = Boolean(onAccountHostsChanged()?.ok); } catch { accountRestarted = false; }
  }
  bumpDomains();
  return { ok: true, sync: { applied: Boolean(sync.applied), dnsUnavailable: sync.dnsUnavailable || null, failures: sync.failures || [] }, accountRestarted, publicBaseUrls: urls };
}

/* ─────────────────────────────── تغییرها ─────────────────────────────── */

function siteDomainUndo(names, siteId) {
  //  عکسِ ردیف‌های همان نام‌ها و دامنهٔ اصلیِ سایت
  const rows = names.map((n) => ({ name: n, row: q('SELECT id, site_id FROM domains WHERE name = ?').get(n) || null }));
  const site = q('SELECT id, domain FROM sites WHERE id = ?').get(siteId);
  return () => {
    for (const { name, row } of rows) {
      if (!row) q('DELETE FROM domains WHERE name = ?').run(name);
      else q('UPDATE domains SET site_id = ? WHERE id = ?').run(row.site_id, row.id);
    }
    if (site) q('UPDATE sites SET domain = ? WHERE id = ?').run(site.domain, site.id);
  };
}

function aliasUndo(appId) {
  const rows = aliasRows(appId);
  return () => {
    q('DELETE FROM app_hostnames WHERE app_id = ?').run(appId);
    for (const r of rows) {
      q('INSERT INTO app_hostnames(id, app_id, hostname, is_primary, move_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(r.id, r.app_id, r.hostname, r.is_primary, r.move_id, r.created_at, r.created_by);
    }
  };
}

function refreshSitePrimary(siteId, prefer = null) {
  const site = q('SELECT id, domain FROM sites WHERE id = ?').get(siteId);
  if (!site) return;
  const own = domainsForSite(site.id).map((d) => d.name);
  const next = prefer && own.includes(prefer) ? prefer : own.includes(site.domain) ? site.domain : own[0] ?? null;
  if (next !== site.domain) q('UPDATE sites SET domain = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), site.id);
}

/**
 * نامی به یک برنامه. ‎{ app, hostname, primary, by }‎ ⇒ ‎{ ok, hostname, display, app: نمای تازه, route }‎
 * خطاها: ‎invalid_hostname (400)‎ · ‎app_not_found (404)‎ · ‎protected_hostname | already_attached | hostname_taken |
 * too_many_hostnames | last_hostname_running (409)‎ · ‎route_write_failed (502)‎.
 */
export function addAppHostname({ app: appId, hostname, primary = false, by = null } = {}) {
  const p = parseHostname(hostname);
  if (!p.ok) return Promise.resolve({ ...p, status: 400 });
  const h = p.hostname;
  return serial(async () => {
    const app = parseAppId(appId);
    if (!app) return coded(404, 'app_not_found', 'این برنامه روی این سرور نیست.');
    //  دامنهٔ قُرق (سایتِ عمومی روی GitHub Pages): همان رفتارِ امروز — ثبت می‌شود ولی هرگز به تونل/‎PUBLIC_BASE_URLS‎ نمی‌رود
    const isProtected = isProtectedHost(h);
    const owner = ownerOf(h);
    if (owner?.app === app.id) return coded(409, 'already_attached', `نامِ ${p.display} همین حالا مالِ همین برنامه است.`);
    if (owner) return coded(409, 'hostname_taken', `نامِ ${p.display} مالِ ${owner.label} است — یک نام فقط یک صاحب دارد.`, { owner: { app: owner.app, label: owner.label, source: owner.source } });
    if (hostsOf(app).length >= MAX_HOSTNAMES_PER_APP) return coded(409, 'too_many_hostnames', `هر برنامه حداکثر ${MAX_HOSTNAMES_PER_APP} نام.`);
    const r = await applyAtomic({
      verify: [h],
      mutate: () => {
        if (app.kind === 'site') {
          const undo = siteDomainUndo([h], app.site.id);
          const row = q('SELECT id FROM domains WHERE name = ?').get(h);
          if (row) q('UPDATE domains SET site_id = ? WHERE id = ?').run(app.site.id, row.id);
          else q('INSERT INTO domains(name, site_id, created_at) VALUES (?, ?, ?)').run(h, app.site.id, Date.now());
          refreshSitePrimary(app.site.id, primary ? h : null);
          return undo;
        }
        const undo = aliasUndo(app.id);
        if (primary) q('UPDATE app_hostnames SET is_primary = 0 WHERE app_id = ?').run(app.id);
        const first = !aliasRows(app.id).length && app.kind === 'stations';
        q('INSERT INTO app_hostnames(app_id, hostname, is_primary, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
          .run(app.id, h, primary || first ? 1 : 0, Date.now(), by ? String(by).slice(0, 80) : null);
        return undo;
      },
    });
    if (!r.ok) return r;
    logEvent('info', 'panel', `نامِ ${p.display} به ${appLabel(app.id)} وصل شد${primary ? ' (نامِ اصلی)' : ''}`, app.kind === 'site' ? app.site.id : null);
    return { ok: true, hostname: h, display: p.display, idn: p.idn, ...(isProtected ? { protected: true } : {}), app: hostnamesOf(app.id), route: routeGuide([h], r.sync.applied && !r.sync.dnsUnavailable && routeMode().auto ? [h] : []), accountRestarted: r.accountRestarted, publicBaseUrls: r.publicBaseUrls };
  });
}

/** نامی را از یک برنامه برمی‌دارد (رکوردِ DNS پاک نمی‌شود — پنل DNS پاک نمی‌کند). */
export function removeAppHostname({ app: appId, hostname } = {}) {
  const p = parseHostname(hostname);
  const h = p.ok ? p.hostname : String(hostname || '').trim().toLowerCase();
  return serial(async () => {
    const app = parseAppId(appId);
    if (!app) return coded(404, 'app_not_found', 'این برنامه روی این سرور نیست.');
    const owner = ownerOf(h);
    if (!owner || owner.app !== app.id) return coded(404, 'not_found', 'این نام مالِ این برنامه نیست.');
    if (owner.source === 'auto') return coded(409, 'auto_hostname', `نامِ ${show(h)} خودکار از دامنهٔ ریشه ساخته می‌شود — برای برداشتنش همان دامنهٔ ریشه را بردارید.`);
    const r = await applyAtomic({
      verify: [],
      mutate: () => {
        if (app.kind === 'site') {
          const undo = siteDomainUndo([h], app.site.id);
          //  خودِ دامنه در فهرستِ دامنه‌ها می‌ماند (همان رفتارِ `detachDomain`)
          q('UPDATE domains SET site_id = NULL WHERE name = ? AND site_id = ?').run(h, app.site.id);
          refreshSitePrimary(app.site.id);
          return undo;
        }
        const undo = aliasUndo(app.id);
        const was = q('SELECT is_primary FROM app_hostnames WHERE hostname = ?').get(h);
        q('DELETE FROM app_hostnames WHERE hostname = ? AND app_id = ?').run(h, app.id);
        if (was?.is_primary && app.kind === 'stations') {
          const next = aliasRows(app.id)[0];
          if (next) q('UPDATE app_hostnames SET is_primary = 1 WHERE id = ?').run(next.id);
        }
        return undo;
      },
    });
    if (!r.ok) return r;
    logEvent('warn', 'panel', `نامِ ${show(h)} از ${appLabel(app.id)} برداشته شد`, app.kind === 'site' ? app.site.id : null);
    return { ok: true, hostname: h, app: hostnamesOf(app.id), accountRestarted: r.accountRestarted, publicBaseUrls: r.publicBaseUrls };
  });
}

/** نامِ اصلیِ یک برنامه (باید همین حالا مالِ همان باشد) — ingress عوض نمی‌شود، ترتیبِ ‎PUBLIC_BASE_URLS‎ چرا */
export function setPrimaryHostname({ app: appId, hostname } = {}) {
  const p = parseHostname(hostname);
  if (!p.ok) return Promise.resolve({ ...p, status: 400 });
  const h = p.hostname;
  return serial(async () => {
    const app = parseAppId(appId);
    if (!app) return coded(404, 'app_not_found', 'این برنامه روی این سرور نیست.');
    const owner = ownerOf(h);
    if (!owner || owner.app !== app.id) return coded(404, 'not_found', 'این نام مالِ این برنامه نیست.');
    const r = await applyAtomic({
      routes: false,
      mutate: () => {
        if (app.kind === 'site') {
          const undo = siteDomainUndo([], app.site.id);
          q('UPDATE sites SET domain = ?, updated_at = ? WHERE id = ?').run(h, Date.now(), app.site.id);
          return undo;
        }
        const undo = aliasUndo(app.id);
        q('UPDATE app_hostnames SET is_primary = 0 WHERE app_id = ?').run(app.id);
        //  نامِ خودکار (‎api.‎) اصلی ⇒ هیچ ردیفِ افزوده‌ای اصلی نیست
        if (owner.source === 'alias') q('UPDATE app_hostnames SET is_primary = 1 WHERE hostname = ? AND app_id = ?').run(h, app.id);
        return undo;
      },
    });
    if (!r.ok) return r;
    logEvent('info', 'panel', `نامِ اصلیِ ${appLabel(app.id)}: ${show(h)}`, app.kind === 'site' ? app.site.id : null);
    return { ok: true, hostname: h, app: hostnamesOf(app.id), accountRestarted: r.accountRestarted, publicBaseUrls: r.publicBaseUrls };
  });
}

/* ─────────────────────────────── درهای قدیمیِ «دامنه‌ها» ─────────────────────────────── */

/**
 * `‎/api/domains‎` (فهرستِ دامنه‌ها): ثبتِ نام (با سایت یا بی سایت)، عوض کردنِ نام/سایتِ یک ردیف، برداشتن — همه با همان
 * سنجش، «یک نام یک صاحب»، «آخرین نامِ برنامهٔ روشن» و برگشت. جابه‌جاییِ صریحِ یک دامنه از سایتی به سایتِ دیگر (‎siteId‎) کارِ
 * عمدیِ مالک است و می‌ماند.
 */
export function registerDomain({ name, siteId = null, note = null } = {}) {
  const p = parseHostname(name);
  if (!p.ok) return Promise.resolve({ ...p, status: 400 });
  const h = p.hostname;
  return serial(async () => {
    if (q('SELECT id FROM domains WHERE name = ?').get(h)) return coded(409, 'already_exists', 'این دامنه از پیش ثبت است.');
    const site = siteId ? q('SELECT id, slug FROM sites WHERE id = ?').get(Number(siteId)) : null;
    if (siteId && !site) return coded(404, 'site_not_found', 'این سایت نیست.');
    const owner = ownerOf(h);
    if (owner && (!site || owner.app !== `site:${site.slug}`)) return coded(409, 'hostname_taken', `نامِ ${p.display} مالِ ${owner.label} است.`, { owner: { app: owner.app, label: owner.label, source: owner.source } });
    if (site && isProtectedHost(h)) { /* قُرق: ثبت می‌شود ولی به تونل نمی‌رود — همان رفتارِ امروز */ }
    const r = await applyAtomic({
      verify: [h],
      mutate: () => {
        const undo = site ? siteDomainUndo([h], site.id) : () => q('DELETE FROM domains WHERE name = ?').run(h);
        q('INSERT INTO domains(name, site_id, note, created_at) VALUES (?, ?, ?, ?)').run(h, site?.id ?? null, note ? String(note).slice(0, 300) : null, Date.now());
        if (site) refreshSitePrimary(site.id);
        return undo;
      },
    });
    if (!r.ok) return r;
    return { ok: true, name: h, accountRestarted: r.accountRestarted };
  });
}

export function editDomain(id, { name, siteId, note } = {}) {
  return serial(async () => {
    const row = q('SELECT * FROM domains WHERE id = ?').get(Number(id));
    if (!row) return coded(404, 'not_found', 'این دامنه نیست.');
    let h = row.name;
    if (name !== undefined) {
      const p = parseHostname(name);
      if (!p.ok) return { ...p, status: 400 };
      h = p.hostname;
      if (h !== row.name && q('SELECT id FROM domains WHERE name = ? AND id <> ?').get(h, row.id)) return coded(409, 'already_exists', 'این دامنه از پیش ثبت است.');
      if (h !== row.name) {
        const owner = ownerOf(h);
        if (owner) return coded(409, 'hostname_taken', `نامِ ${show(h)} مالِ ${owner.label} است.`, { owner: { app: owner.app, label: owner.label, source: owner.source } });
      }
    }
    const nextSite = siteId === undefined ? row.site_id : siteId ? Number(siteId) : null;
    if (nextSite && !q('SELECT id FROM sites WHERE id = ?').get(nextSite)) return coded(404, 'site_not_found', 'این سایت نیست.');
    if (h === row.name && nextSite === row.site_id && (note === undefined || note === row.note)) return { ok: true, name: h, unchanged: true };
    const r = await applyAtomic({
      verify: h !== row.name || nextSite !== row.site_id ? [h] : [],
      mutate: () => {
        const sites = [...new Set([row.site_id, nextSite].filter(Boolean))].map((sid) => q('SELECT id, domain FROM sites WHERE id = ?').get(sid)).filter(Boolean);
        const undo = () => {
          q('UPDATE domains SET name = ?, site_id = ?, note = ? WHERE id = ?').run(row.name, row.site_id, row.note, row.id);
          for (const s of sites) q('UPDATE sites SET domain = ? WHERE id = ?').run(s.domain, s.id);
        };
        q('UPDATE domains SET name = ?, site_id = ?, note = ? WHERE id = ?').run(h, nextSite, note === undefined ? row.note : (note ? String(note).slice(0, 300) : null), row.id);
        for (const s of sites) refreshSitePrimary(s.id);
        return undo;
      },
    });
    if (!r.ok) return r;
    if (h !== row.name || nextSite !== row.site_id) {
      const to = nextSite ? q('SELECT name FROM sites WHERE id = ?').get(nextSite)?.name : null;
      logEvent('info', 'panel', to ? `دامنهٔ ${h} از این پس به سایت «${to}» می‌رود` : `دامنهٔ ${h} به هیچ سایتی وصل نیست`, nextSite);
    }
    return { ok: true, name: h, accountRestarted: r.accountRestarted };
  });
}

export function deleteDomain(id) {
  return serial(async () => {
    const row = q('SELECT * FROM domains WHERE id = ?').get(Number(id));
    if (!row) return coded(404, 'not_found', 'این دامنه نیست.');
    const r = await applyAtomic({
      verify: [],
      mutate: () => {
        const site = row.site_id ? q('SELECT id, domain FROM sites WHERE id = ?').get(row.site_id) : null;
        q('DELETE FROM domains WHERE id = ?').run(row.id);
        if (site) refreshSitePrimary(site.id);
        return () => {
          q(`INSERT INTO domains(id, name, site_id, note, created_at, checked_at, dns_status, dns_records, ssl_status, ssl_issuer, ssl_expires, reg_expires, http_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(row.id, row.name, row.site_id, row.note, row.created_at, row.checked_at, row.dns_status, row.dns_records, row.ssl_status, row.ssl_issuer, row.ssl_expires, row.reg_expires, row.http_status);
          if (site) q('UPDATE sites SET domain = ? WHERE id = ?').run(site.domain, site.id);
        };
      },
    });
    if (!r.ok) return r;
    logEvent('warn', 'panel', `دامنهٔ ${row.name} حذف شد`);
    return { ok: true, name: row.name, accountRestarted: r.accountRestarted };
  });
}

/* ─────────────────────────────── جابه‌جایی («سرورهای من») ─────────────────────────────── */

/**
 * مقصدِ جابه‌جاییِ سرورِ حساب: نام‌های آمده از مبدأ (نامِ اصلی اول) ردیفِ همین برنامه می‌شوند (‎move_id‎ = همین کار).
 * نامی که این‌جا مالِ برنامهٔ دیگری است ⇒ هیچ ردیفی و خطا (کار برمی‌گردد). هم‌گام، در تراکنش.
 */
export function registerMovedHostnames(appId, hostnames, moveId) {
  const hosts = [...new Set((hostnames || []).map((x) => String(x || '').toLowerCase()).filter(Boolean))];
  const clash = [];
  const fresh = [];
  for (const h of hosts) {
    if (!parseHostname(h).ok || isProtectedHost(h)) continue;
    const o = ownerOf(h);
    if (!o) fresh.push(h);
    else if (o.app !== appId && o.source !== 'manual') clash.push(`${h} (${o.label})`);
  }
  if (clash.length) {
    throw Object.assign(new Error(`این نام‌ها روی این سرور مالِ برنامهٔ دیگری‌اند: ${clash.join('، ')} — هیچ چیزی جابه‌جا نشد.`), { code: 'hostname_taken' });
  }
  if (!fresh.length) return [];
  inTx(() => {
    const hasPrimary = aliasRows(appId).some((r) => r.is_primary);
    fresh.forEach((h, i) => {
      q('INSERT INTO app_hostnames(app_id, hostname, is_primary, move_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(appId, h, !hasPrimary && i === 0 && h === hosts[0] ? 1 : 0, String(moveId), Date.now(), 'fleet-move');
    });
  });
  bumpDomains();
  return fresh;
}

/** برگشتِ همان کار روی مقصد: ردیف‌هایی که همین کار آورد */
export function dropMovedHostnames(moveId) {
  try {
    const rows = q('SELECT hostname FROM app_hostnames WHERE move_id = ?').all(String(moveId)).map((r) => r.hostname);
    q('DELETE FROM app_hostnames WHERE move_id = ?').run(String(moveId));
    if (rows.length) bumpDomains();
    return rows;
  } catch { return []; }
}

/** مبدأ پس از رفتنِ برنامه: ردیف‌های افزوده‌اش (برای یادداشتِ «کنار» — پاک نه، در ‎fleet_aside.saved‎ می‌ماند) */
export function takeAppAliases(appId) {
  const rows = aliasRows(appId);
  try { q('DELETE FROM app_hostnames WHERE app_id = ?').run(appId); } catch { /* جدول نیست */ }
  if (rows.length) bumpDomains();
  return rows;
}
