// ---------------------------------------------------------------------------
//  «سرورهای من» — گزارشِ همین نصب (۱.۵۰.۹۴): همان که گره در هر تپش می‌فرستد و مرکز برای ردیفِ خودش می‌سازد.
//
//  ⛔ از همان منبع‌هایی که پنل برای خودش دارد — هیچ سنجشِ دومی ساخته نشد:
//     CPU/حافظه/دیسک `metrics/system.js` (و آخرین نمونهٔ `metrics/index.js` اگر تازه است)، سایت‌ها `sites/registry.js` +
//     `sites/process.js`، سرورِ حساب `account/supervisor.js`، پمپ‌ها فقط خواندنِ «چند پمپ ثبت است» (`state.js`)،
//     تونل `tunnel.js`، نسخه `version.js`، گونه از نمایهٔ استقرار (`deploy.js`).
//  ⛔ هیچ راز، نشانیِ پوشه یا دامنه‌ای در گزارش نیست: فقط نام، گونه، روشن/خاموش و درصدها.
// ---------------------------------------------------------------------------
import os from 'node:os';
import { getSetting } from '../db.js';
import { deploy } from '../config.js';
import { versionInfo } from '../version.js';
import { maintenanceState } from './maintenance.js';

export const NODE_KINDS = Object.freeze(['home', 'vps', 'foreign', 'hosting']);

/** گونهٔ پیش‌فرضِ همین نصب: ‎HLP_NODE_KIND‎، وگرنه از نمایهٔ استقرار (home ⇒ خانه، vps/docker ⇒ VPS، paas ⇒ هاست) */
export function defaultKind() {
  const env = String(process.env.HLP_NODE_KIND || '').trim().toLowerCase();
  if (NODE_KINDS.includes(env)) return env;
  return { home: 'home', vps: 'vps', docker: 'vps', paas: 'hosting' }[deploy.profile] || 'home';
}

export function defaultName() {
  return String(getSetting('server_name', null) || os.hostname() || 'server').slice(0, 80);
}

const pct = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

async function readMetrics() {
  const { readCpu, readMemory, readDisks } = await import('../metrics/system.js');
  const { getLatest } = await import('../metrics/index.js');
  const latest = getLatest();
  //  نمونهٔ نمودارِ زنده اگر تازه است — readCpu ِ دوباره بازهٔ همان نمودار را کوتاه می‌کرد
  const fresh = latest && Date.now() - latest.at < 10_000;
  const cpu = fresh ? latest.cpu : readCpu();
  const [memory, disk] = fresh ? [latest.memory, latest.disk] : await Promise.all([readMemory(), readDisks()]);
  return {
    cpu: pct(cpu?.usage),
    cores: cpu?.count ?? os.cpus().length,
    memory: { usage: pct(memory?.usage), total: memory?.total ?? null, used: memory?.used ?? null },
    disk: { usage: pct(disk?.usage), total: disk?.total ?? null, used: disk?.used ?? null },
  };
}

/** برنامه‌ها و سایت‌های همین نصب. `dataful`: دیتابیس دارد ⇒ روشن بودنش روی دو گره یعنی «دو دفتر». */
async function readApps() {
  const apps = [];
  //  ⛔ (۱.۵۰.۹۵) برنامه‌ای که از این نصب رفته و کنار گذاشته شده («سرورهای من») این‌جا دیگر نیست
  const { holdOf } = await import('./hold.js');
  const gone = (id) => holdOf(id)?.reason === 'aside';
  const { accountStatus } = await import('../account/supervisor.js');
  const acct = accountStatus();
  if ((acct.installed || acct.running) && !gone('account-server')) {
    apps.push({ id: 'account-server', type: 'account', name: 'سرورِ حساب', dataful: true, running: Boolean(acct.running) });
  }
  //  ⛔ پمپ: فقط خواندنِ «چند پمپ ثبت است» — کدِ پمپ دست نمی‌خورد و ایستاندنش در نگه‌داری نیست
  const { getStations } = await import('../state.js');
  const st = getStations();
  if (st) {
    let count = 0;
    try { count = st.list().length; } catch { count = 0; }
    if (count > 0) apps.push({ id: 'stations', type: 'pump', name: 'پمپ‌ها (تانک‌تیل)', dataful: true, running: true, count });
  }
  const { listSitesRaw, mainSiteId } = await import('../sites/registry.js');
  const { isRunning } = await import('../sites/process.js');
  const mainId = mainSiteId();
  for (const s of listSitesRaw()) {
    if (s.kind === 'external') continue; //  روی این کامپیوتر نیست
    if (gone(`site:${s.slug}`)) continue;
    apps.push({
      id: `site:${s.slug}`,
      type: 'site',
      name: String(s.name || s.slug).slice(0, 80),
      kind: s.kind || 'static',
      dataful: (s.kind || 'static') !== 'static',
      running: isRunning(s.slug),
      //  سایتِ اصلی دفترِ اصلیِ سرورِ سایت را دارد ⇒ جدا جابه‌جا نمی‌شود (گامِ ۳)
      ...(mainId === s.id ? { main: true } : {}),
    });
  }
  return apps;
}

/** گزارشِ کامل. `link`: ردیفِ وصلِ همین گره (نام و گونه‌ای که هنگامِ وصل شدن داده شد) */
export async function buildReport(link = null) {
  const { tunnelRunning, publicState } = await import('../tunnel.js');
  let route = { mode: null, auto: false };
  try { route = (await import('./route.js')).routeInfo(); } catch { /* تونل نیست */ }
  const m = maintenanceState();
  let metrics = null;
  try { metrics = await readMetrics(); } catch { metrics = null; }
  let apps = [];
  try { apps = await readApps(); } catch { apps = []; }
  return {
    name: String(link?.name || defaultName()).slice(0, 80),
    kind: NODE_KINDS.includes(link?.kind) ? link.kind : defaultKind(),
    version: versionInfo.version || null,
    platform: process.platform,
    metrics,
    apps,
    //  ‎mode/auto‎ (۱.۵۰.۹۵): «عوض شدنِ مسیر» خودکار است یا دستی — بی نامِ تونل و بی هیچ راز
    tunnel: { running: tunnelRunning(), status: publicState().status, mode: route.mode, auto: Boolean(route.auto) },
    maintenance: { active: m.active, source: m.source, since: m.since, pumpsKeepRunning: m.active && apps.some((a) => a.type === 'pump') },
    at: Date.now(),
  };
}

/* ───────────── پاک‌سازیِ گزارشِ رسیده (مرکز) — امضا یعنی «از همان گره»، نه «درست‌شکل» ───────────── */

const str = (v, n = 80) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, n) : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const usage = (v) => { const n = num(v); return n == null ? null : Math.max(0, Math.min(100, n)); };

export function sanitizeReport(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const m = r.metrics && typeof r.metrics === 'object' ? r.metrics : null;
  const apps = Array.isArray(r.apps) ? r.apps.slice(0, 200) : [];
  return {
    name: str(r.name) || 'server',
    kind: NODE_KINDS.includes(r.kind) ? r.kind : 'home',
    version: str(r.version, 40),
    platform: str(r.platform, 20),
    metrics: m ? {
      cpu: usage(m.cpu),
      cores: num(m.cores),
      memory: { usage: usage(m.memory?.usage), total: num(m.memory?.total), used: num(m.memory?.used) },
      disk: { usage: usage(m.disk?.usage), total: num(m.disk?.total), used: num(m.disk?.used) },
    } : null,
    apps: apps.filter((a) => a && typeof a === 'object' && typeof a.id === 'string').map((a) => ({
      id: str(a.id, 120),
      type: ['account', 'pump', 'site'].includes(a.type) ? a.type : 'site',
      name: str(a.name) || str(a.id, 80),
      kind: str(a.kind, 20),
      dataful: a.dataful === true,
      running: a.running === true,
      ...(a.main === true ? { main: true } : {}),
      ...(num(a.count) != null ? { count: num(a.count) } : {}),
    })),
    tunnel: {
      running: r.tunnel?.running === true, status: str(r.tunnel?.status, 20),
      mode: ['named', 'token', 'quick', 'none'].includes(r.tunnel?.mode) ? r.tunnel.mode : null, auto: r.tunnel?.auto === true,
    },
    maintenance: {
      active: r.maintenance?.active === true,
      source: ['center', 'self'].includes(r.maintenance?.source) ? r.maintenance.source : null,
      since: num(r.maintenance?.since),
      pumpsKeepRunning: r.maintenance?.pumpsKeepRunning === true,
    },
  };
}
