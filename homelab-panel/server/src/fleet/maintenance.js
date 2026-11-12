// ---------------------------------------------------------------------------
//  «سرورهای من» — حالتِ نگه‌داریِ همین کامپیوتر (۱.۵۰.۹۴)
//
//  «غیرفعال» = برنامه‌ها، سایت‌ها و تونلِ همین نصب می‌ایستند؛ کامپیوتر خاموش نمی‌شود و **هیچ داده‌ای پاک نمی‌شود**.
//  «فعال» = همان‌هایی که پیش از نگه‌داری روشن بودند دوباره روشن می‌شوند (نه بیشتر، نه کمتر).
//
//  ⛔ فقط با تابع‌هایی که پنل امروز برای ایستاندن/روشن کردن دارد — هیچ راهِ دومی ساخته نشد:
//     سایت‌ها `sites/process.js` (stopSite/startSite)، تونلِ هر سایت `site-tunnels.js` (stopAllSiteTunnels با
//     forget:false ⇒ فهرستِ «روشن بماند» دست نمی‌خورد / autostartSiteTunnels)، تونلِ خانه `tunnel.js`
//     (stopTunnel/startTunnel — تنظیمِ `tunnel_autostart` ِ مالک عوض نمی‌شود)، سرورِ حساب `account/supervisor.js`.
//  ⛔ پمپ‌ها (`stations`، داخلِ پروسهٔ پنل) تابعِ ایستاندن ندارند و کدِ پمپ دست نمی‌خورد ⇒ در نگه‌داری روی شبکهٔ
//     خانه روشن می‌مانند؛ با ایستادنِ تونل از اینترنت نمی‌رسند. گزارش همین را می‌گوید (`pumpsKeepRunning`).
//  ⛔ حالت در `fleet_local` می‌ماند: پنلی که در نگه‌داری دوباره بالا بیاید سایت/سرورِ حساب/تونل را خودکار روشن
//     نمی‌کند (index.js)، و «سلامتِ سرویس‌ها» سایتِ ایستاده را «افتاده» نمی‌شمارد (automation/jobs/health.js).
// ---------------------------------------------------------------------------
import { db, logEvent } from '../db.js';
import { bumpSoon } from '../live/bus.js';

const row = () => db.prepare('SELECT * FROM fleet_local WHERE id = 1').get();

function persist(fields) {
  const cur = row();
  const next = { maintenance: 0, source: null, since: null, saved: null, ...(cur || {}), ...fields };
  db.prepare(`INSERT INTO fleet_local(id, maintenance, source, since, saved) VALUES (1, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET maintenance = excluded.maintenance, source = excluded.source,
                                            since = excluded.since, saved = excluded.saved`)
    .run(next.maintenance ? 1 : 0, next.source, next.since, next.saved);
}

/** ‎{ active, source: 'center'|'self'|null, since, saved }‎ — `saved` فقط نام‌ها، هیچ راز */
export function maintenanceState() {
  let r = null;
  try { r = row(); } catch { /* جدول هنوز نیست */ }
  let saved = null;
  try { saved = r?.saved ? JSON.parse(r.saved) : null; } catch { saved = null; }
  return { active: Boolean(r?.maintenance), source: r?.source || null, since: r?.since || null, saved };
}

export function maintenanceActive() {
  return maintenanceState().active;
}

//  یک گذار در هر لحظه — «روشن» و «خاموش» ِ پشتِ سرِ هم روی هم نمی‌افتند
let chain = Promise.resolve();
const serial = (fn) => {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
};

/** چه چیزی همین حالا روشن است (برای برگرداندنِ همان‌ها پس از نگه‌داری) */
async function snapshot() {
  const { runningSlugs } = await import('../sites/process.js');
  const { publicState } = await import('../tunnel.js');
  const { accountStatus } = await import('../account/supervisor.js');
  return {
    sites: runningSlugs(),
    tunnel: publicState().status !== 'stopped',
    account: Boolean(accountStatus().running),
  };
}

/**
 * ورود به نگه‌داری. `source`: ‎'center'‎ (فرمانِ مرکز در پاسخِ تپش) یا ‎'self'‎ (مالکِ همین نصب).
 * @returns {Promise<{ ok: true, already?: true, stopped?: object }>}
 */
export function enterMaintenance(source) {
  return serial(async () => {
    if (maintenanceActive()) return { ok: true, already: true };
    const saved = await snapshot();
    //  ⛔ پیش از ایستاندن ثبت می‌شود: پنلی که وسطِ کار بیفتد، در نگه‌داری بالا می‌آید و چیزی را روشن نمی‌کند
    persist({ maintenance: 1, source, since: Date.now(), saved: JSON.stringify(saved) });
    const { getSiteBySlug } = await import('../sites/registry.js');
    const { stopSite } = await import('../sites/process.js');
    const { stopAllSiteTunnels } = await import('../site-tunnels.js');
    const { stopTunnel } = await import('../tunnel.js');
    const { stopAccountServer, waitAccountServerExit } = await import('../account/supervisor.js');
    const stopped = { sites: [], tunnel: saved.tunnel, account: saved.account, errors: [] };
    for (const slug of saved.sites) {
      const site = getSiteBySlug(slug);
      if (!site) continue;
      try { await stopSite(site); stopped.sites.push(slug); } catch (e) { stopped.errors.push(`${slug}: ${e.message}`); }
    }
    try { stopAllSiteTunnels(); } catch (e) { stopped.errors.push(`site-tunnels: ${e.message}`); }
    //  همیشه صدا زده می‌شود (حتی خاموش): تلاشِ دوبارهٔ ده‌ثانیه‌ای را هم می‌بُرد
    try { stopTunnel(); } catch (e) { stopped.errors.push(`tunnel: ${e.message}`); }
    try { stopAccountServer(); await waitAccountServerExit(8000); } catch (e) { stopped.errors.push(`account: ${e.message}`); }
    logEvent('warn', 'fleet', `حالتِ نگه‌داری روشن شد (${source === 'center' ? 'به خواستِ مرکز' : 'به خواستِ مالک'}) — `
      + `${stopped.sites.length} سایت، ${saved.tunnel ? 'تونل، ' : ''}${saved.account ? 'سرورِ حساب ' : ''}ایستاد؛ پمپ‌ها روی شبکهٔ خانه روشن می‌مانند`);
    bumpSoon('fleet', 300);
    return { ok: true, stopped };
  });
}

/** خروج از نگه‌داری: همان‌هایی که پیش از آن روشن بودند */
export function exitMaintenance(source) {
  return serial(async () => {
    const st = maintenanceState();
    if (!st.active) return { ok: true, already: true };
    const saved = st.saved || { sites: [], tunnel: false, account: false };
    persist({ maintenance: 0, source, since: Date.now(), saved: null });
    const { getSiteBySlug, listSitesRaw } = await import('../sites/registry.js');
    const { startSite } = await import('../sites/process.js');
    const { autostartSiteTunnels } = await import('../site-tunnels.js');
    const { startTunnel } = await import('../tunnel.js');
    const { startAccountServer } = await import('../account/supervisor.js');
    const started = { sites: [], tunnel: false, account: false, errors: [] };
    if (saved.account) {
      const r = startAccountServer();
      started.account = Boolean(r?.ok);
      if (!r?.ok) started.errors.push(`account: ${r?.reason || 'start_failed'}`);
    }
    for (const slug of saved.sites || []) {
      const site = getSiteBySlug(slug);
      if (!site) continue;
      try {
        const r = await startSite(site);
        if (r?.ok) started.sites.push(slug); else started.errors.push(`${slug}: ${r?.error || 'start_failed'}`);
      } catch (e) { started.errors.push(`${slug}: ${e.message}`); }
    }
    try { await autostartSiteTunnels(listSitesRaw().filter((s) => s.enabled)); } catch (e) { started.errors.push(`site-tunnels: ${e.message}`); }
    if (saved.tunnel) {
      try { await startTunnel({}); started.tunnel = true; } catch (e) { started.errors.push(`tunnel: ${e.message}`); }
    }
    logEvent('info', 'fleet', `حالتِ نگه‌داری خاموش شد — ${started.sites.length} سایت، ${started.tunnel ? 'تونل، ' : ''}`
      + `${started.account ? 'سرورِ حساب ' : ''}دوباره روشن شد${started.errors.length ? ` (${started.errors.length} خطا)` : ''}`);
    bumpSoon('fleet', 300);
    return { ok: true, started };
  });
}
