// ---------------------------------------------------------------------------
//  «جابه‌جاییِ یک برنامه» — سهمِ **همین نصب** در یک کار (۱.۵۰.۹۵، گامِ ۳ ِ docs/MULTI-SERVER-fa.md)
//
//  مرکز فرمان می‌دهد، هر گره (و خودِ مرکز وقتی مبدأ/مقصد است) همین تابع‌ها را اجرا می‌کند — یک کد برای هر دو:
//    مبدأ:  freeze  ⇒ «فقط‌خواندنی»: برنامه می‌ایستد و نگه داشته می‌شود (دفترِ سرورِ سایتش هم بسته)
//           export  ⇒ همان ‎move-server.mjs export --only‎ با کلیدِ همین کار ⇒ تکه‌تکه با sha256 به مرکز
//           retire  ⇒ پس از روشن شدنِ مقصد و عوض شدنِ مسیر: خاموش و **کنار** (‎.vmove-aside/‎، پاک نه)
//    مقصد:  import  ⇒ دانلودِ تکه‌ها از مرکز (sha256 ِ هر تکه و کلِ بسته) ⇒ ‎stageOnlyImport‎ (sha256 ِ هر فایل، شمارِ ردیف،
//                     move-db) ⇒ ‎promoteOnly‎ با برنامهٔ **خاموش و نگه‌داشته** ⇒ ‎compareOnly‎
//           start   ⇒ نگه برداشته، برنامه روشن، پورتش جواب می‌دهد؟
//           route   ⇒ ‎route.js‎ (تونلِ نام‌دار: خودکار؛ وگرنه گامِ دستی)
//    برگشت: unfreeze (مبدأ دوباره همان که بود، و اگر مسیر رفته بود پس گرفتنش) · discard (مقصد: خاموش، کنار، و آن‌چه
//           پیش از آن بود سرِ جایش)
//  ⛔ حالِ هر کار در `fleet_move_local` ِ همین نصب (پیش از هر کارِ برگشت‌ناپذیر نوشته می‌شود) ⇒ هر فرمان دوباره‌پذیر
//     است: پاسخِ گم‌شده یا پنلِ دوباره‌بالاآمده همان نتیجه را می‌دهد، نه کارِ دوباره.
//  ⛔ کلیدِ بسته (`io.pass`) فقط در حافظهٔ همین فرمان؛ نه دیتابیس، نه دفتر، نه لاگ. هیچ داده‌ای پاک نمی‌شود.
//  ⛔ پمپ‌ها (تانک‌تیل) این‌جا نیستند: داخلِ پروسهٔ پنل‌اند و راهِ ایستاندن ندارند؛ کدِ پمپ دست نمی‌خورد ⇒
//     فقط ‎move-server.mjs --only stations‎ با پنلِ بسته.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, deploy } from '../config.js';
import { db, logEvent } from '../db.js';
import { bumpSoon } from '../live/bus.js';
import { vacuumInto } from '../backup/sqlite.js';
import { exportData, stageOnlyImport, promoteOnly, compareOnly, parseOnly, ASIDE_DIR } from '../../scripts/move-server.mjs';
import { holdOf } from './hold.js';
import { routeInfo, claimRoutes, releaseRoutes, accountHostnames, publicPort } from './route.js';
import { setTenantGuard } from '../sitesync/index.js';
import { getSiteSync } from '../state.js';
import { getSite, getSiteBySlug, allocatePort, mainSiteId, domainsForSite } from '../sites/registry.js';
import { sitesRoot } from '../sites/root.js';
import { isRunning, startSite, stopSite, probePort } from '../sites/process.js';
import { startSiteTunnel, stopSiteTunnel, siteTunnelWanted, siteTunnelState } from '../site-tunnels.js';
import { accountStatus, startAccountServer, stopAccountServer, waitAccountServerExit } from '../account/supervisor.js';

//  ⛔ دفترِ سرورِ سایتِ نگه‌داشته باز نمی‌شود (پیش از `loadAll` ِ هنگامِ بالا آمدن — این ماژول زودتر بار می‌شود)
setTenantGuard((key) => Boolean(holdOf(`site:${key}`)));

export const CHUNK_BYTES = 4 * 1024 * 1024;
export const workDir = () => path.join(config.dataDir, '.vmove-panel', 'fleet');
const safeId = (id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
export const bundlePath = (moveId) => path.join(workDir(), `${safeId(moveId)}.vmove`);

const coded = (code, message) => Object.assign(new Error(message), { code });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stampNow = () => new Date().toISOString().replace(/[:.]/g, '-');

/* ─────────────────────────────── حالِ همین نصب ─────────────────────────────── */

export function localOf(moveId) {
  const r = db.prepare('SELECT * FROM fleet_move_local WHERE move_id = ?').get(String(moveId));
  if (!r) return null;
  let saved = null;
  try { saved = r.saved ? JSON.parse(r.saved) : null; } catch { saved = null; }
  return { ...r, saved: saved || {} };
}

function setLocal(moveId, appId, role, state, saved) {
  const t = Date.now();
  db.prepare(`INSERT INTO fleet_move_local(move_id, app_id, role, state, saved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(move_id) DO UPDATE SET state = excluded.state, saved = excluded.saved, updated_at = excluded.updated_at`)
    .run(String(moveId), String(appId), role, state, JSON.stringify(saved || {}), t, t);
  bumpSoon('fleet', 300);
}

/** sha256 و تکه‌های یک فایل (همان تکه‌هایی که از سیم می‌روند) */
export async function fileChunks(file, chunkBytes = CHUNK_BYTES) {
  const whole = crypto.createHash('sha256');
  const chunks = [];
  let cur = crypto.createHash('sha256');
  let curSize = 0;
  for await (const buf of fs.createReadStream(file, { highWaterMark: 1024 * 1024 })) {
    whole.update(buf);
    let off = 0;
    while (off < buf.length) {
      const take = Math.min(chunkBytes - curSize, buf.length - off);
      cur.update(buf.subarray(off, off + take));
      curSize += take;
      off += take;
      if (curSize === chunkBytes) { chunks.push({ size: curSize, sha256: cur.digest('hex') }); cur = crypto.createHash('sha256'); curSize = 0; }
    }
  }
  if (curSize > 0 || !chunks.length) chunks.push({ size: curSize, sha256: cur.digest('hex') });
  const size = chunks.reduce((a, c) => a + c.size, 0);
  return { size, sha256: whole.digest('hex'), chunkBytes, chunks };
}

/** کنار گذاشتن (rename؛ دیسکِ دیگر ⇒ کنارِ خودش) — هرگز پاک نه */
function asideMover(base, stamp) {
  const items = [];
  const put = (from, what) => {
    if (!from || !fs.existsSync(from)) return;
    fs.mkdirSync(base, { recursive: true });
    let to = path.join(base, what);
    try {
      try { fs.renameSync(from, to); } catch (e) {
        if (e.code !== 'EXDEV') throw e;
        to = `${from}.vmove-aside-${stamp}`;
        fs.renameSync(from, to);
      }
      items.push({ what, from, to });
    } catch (e) {
      items.push({ what, from, error: e.code || e.message });
    }
  };
  const note = (extra) => {
    if (!items.length) return;
    try { fs.writeFileSync(path.join(base, 'aside.json'), JSON.stringify({ at: new Date().toISOString(), items, ...extra }, null, 2), { mode: 0o600 }); } catch { /* یادداشت */ }
  };
  return { put, items, note };
}

const siteDirs = (slug) => ({ workspace: path.join(config.dataDir, 'sites', slug), store: path.join(config.siteSync.dataDir, 'sites', slug) });

/* ─────────────────────────────── مبدأ ─────────────────────────────── */

async function freeze({ move, app }) {
  const cur = localOf(move);
  if (cur?.role === 'source' && cur.state === 'frozen') return cur.saved.result;
  const only = parseOnly(app);
  if (only.kind === 'stations') throw coded('pump_cli_only', 'پمپ‌ها فقط با پنلِ بسته و از خطِ فرمان جابه‌جا می‌شوند (move-server.mjs --only stations).');
  const other = holdOf(app);
  if (other && other.moveId !== move) throw coded('app_held', 'این برنامه همین حالا در کارِ دیگری است یا از این سرور رفته است.');
  if (only.kind === 'site') {
    const site = getSiteBySlug(only.slug);
    if (!site) throw coded('app_not_found', `سایتِ «${only.slug}» روی این سرور نیست.`);
    if (mainSiteId() === site.id) throw coded('main_site', 'سایتِ اصلی دفترِ اصلیِ سرورِ سایت را دارد و جدا نمی‌رود — «جابه‌جاییِ کامل».');
    if (site.kind === 'external') throw coded('external_site', 'این سایت روی این کامپیوتر نیست (بیرونی).');
    const wasRunning = isRunning(site.slug);
    const result = {
      type: 'site', name: site.name, kind: site.kind || 'static', port: site.port, wasRunning,
      domains: domainsForSite(site.id).map((d) => d.name), siteTunnel: siteTunnelWanted(site.slug), route: routeInfo(),
    };
    //  ⛔ پیش از ایستاندن ثبت: پنلی که وسطِ کار بیفتد، این سایت را خودسرانه روشن نمی‌کند (hold.js)
    setLocal(move, app, 'source', 'frozen', { autostart: site.autostart, enabled: site.enabled, running: wasRunning, siteTunnel: result.siteTunnel, result });
    db.prepare('UPDATE sites SET autostart = 0, updated_at = ? WHERE id = ?').run(Date.now(), site.id);
    await stopSite(site);
    stopSiteTunnel(site.slug, { forget: false });
    await getSiteSync()?.releaseTenant?.(site.slug);
    logEvent('warn', 'fleet', `سایتِ «${site.name}» برای جابه‌جایی به سرورِ دیگر ایستاد (فقط‌خواندنی)`, site.id);
    return result;
  }
  if (!fs.existsSync(path.join(config.dataDir, 'account-server'))) throw coded('app_not_found', 'سرورِ حسابی روی این سرور نیست.');
  const st = accountStatus();
  const result = { type: 'account', name: 'سرورِ حساب', wasRunning: Boolean(st.running), domains: accountHostnames(), route: routeInfo() };
  setLocal(move, app, 'source', 'frozen', { running: Boolean(st.running), result });
  stopAccountServer();
  if (!(await waitAccountServerExit(15000))) throw coded('account_busy', 'سرورِ حساب در ۱۵ ثانیه نایستاد.');
  logEvent('warn', 'fleet', 'سرورِ حساب برای جابه‌جایی به سرورِ دیگر ایستاد (فقط‌خواندنی)');
  return result;
}

async function doExport({ move, app }, io) {
  const cur = localOf(move);
  if (!cur || cur.role !== 'source' || cur.state !== 'frozen') throw coded('not_frozen', 'برنامه روی این سرور ایستانده نشده است.');
  if (!io.pass) throw coded('no_key', 'کلیدِ این کار نرسید.');
  const out = bundlePath(move);
  await fsp.mkdir(path.dirname(out), { recursive: true });
  const only = parseOnly(app);
  const snap = only.kind === 'site' ? path.join(workDir(), `${safeId(move)}.panel.db`) : '';
  let r;
  try {
    if (snap) vacuumInto(db, snap);
    r = await exportData({
      dataDir: config.dataDir, out, pass: io.pass, only: app, panelDbSnapshot: snap, sitesyncDir: config.siteSync.dataDir,
      live: { from: 'panel', fleet: true },
    });
  } finally {
    if (snap) fs.rmSync(snap, { force: true });
  }
  const meta = await fileChunks(out);
  if (!io.self) {
    try { await io.upload(out, meta); } finally { fs.rmSync(out, { force: true }); }
  }
  logEvent('info', 'fleet', `بستهٔ «${app}» ساخته و رمزشده فرستاده شد (${r.manifest.files.length} فایل، ${meta.size} بایت)`);
  return { ...meta, files: r.manifest.files.length, sqlite: Object.keys(r.manifest.sqlite || {}).length, accountReconciled: Boolean(r.manifest.account?.reconciled) };
}

async function retire({ move, app, args = {} }) {
  const cur = localOf(move);
  if (cur?.role === 'source' && cur.state === 'retired') return cur.saved.retireResult;
  if (!cur || cur.role !== 'source' || !['frozen', 'retiring'].includes(cur.state)) throw coded('not_frozen', 'برنامه روی این سرور ایستانده نشده است.');
  const only = parseOnly(app);
  const stamp = stampNow();
  const base = path.join(config.dataDir, ASIDE_DIR, `${stamp}-moved-${only.kind === 'site' ? `site-${only.slug}` : only.id}`);
  const aside = asideMover(base, stamp);
  setLocal(move, app, 'source', 'retiring', { ...cur.saved, asideBase: base });
  const hostnames = cur.saved.result?.domains || [];
  let release = null;
  if (only.kind === 'site') {
    const site = getSiteBySlug(only.slug);
    if (site) {
      db.prepare('UPDATE sites SET enabled = 0, autostart = 0, updated_at = ? WHERE id = ?').run(Date.now(), site.id);
      stopSiteTunnel(site.slug, { forget: true });
      release = await releaseRoutes({ hostnames }).catch((e) => ({ error: e.message }));
      await getSiteSync()?.releaseTenant?.(site.slug);
      const d = siteDirs(site.slug);
      aside.put(site.root_path, 'root');
      aside.put(d.workspace, 'workspace');
      aside.put(d.store, 'store');
    }
  } else {
    release = await releaseRoutes({ hostnames }).catch((e) => ({ error: e.message }));
    aside.put(path.join(config.dataDir, 'account-server'), 'account-server');
  }
  aside.note({ app, move, to: args.toName || null, reason: 'moved' });
  db.prepare('INSERT INTO fleet_aside(app_id, slug, move_id, aside_dir, items, saved, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(app, only.slug || null, move, base, JSON.stringify(aside.items), JSON.stringify({ to: args.toName || null, before: { autostart: cur.saved.autostart, enabled: cur.saved.enabled } }), Date.now());
  const result = { aside: aside.items.filter((i) => !i.error).length, failed: aside.items.filter((i) => i.error).map((i) => i.what), released: release?.released?.length || 0 };
  setLocal(move, app, 'source', 'retired', { ...cur.saved, retireResult: result });
  logEvent('info', 'fleet', `«${app}» از این سرور رفت به «${args.toName || 'سرورِ دیگر'}» — نسخهٔ این‌جا خاموش و کنار گذاشته شد (پاک نه)`);
  return result;
}

async function unfreeze({ move, app, args = {} }) {
  const cur = localOf(move);
  if (!cur || cur.role !== 'source') return { nothing: true };
  if (cur.state === 'released') return { already: true };
  if (cur.state === 'retired') throw coded('already_retired', 'این برنامه از این سرور رفته است؛ برگشتِ خودکار نیست.');
  const saved = cur.saved || {};
  const only = parseOnly(app);
  //  نیمه‌راهِ «کنار گذاشتن» (پنل وسطش افتاد): آن‌چه کنار رفته بود سرِ جایش
  if (cur.state === 'retiring' && saved.asideBase) {
    try {
      const note = JSON.parse(fs.readFileSync(path.join(saved.asideBase, 'aside.json'), 'utf8'));
      for (const it of (note.items || []).filter((x) => x.to)) { try { if (!fs.existsSync(it.from)) fs.renameSync(it.to, it.from); } catch { /* بماند تا دستی */ } }
    } catch { /* یادداشت نبود */ }
  }
  setLocal(move, app, 'source', 'released', saved); //  نگه برداشته شد
  const out = { restarted: false, reclaimed: null };
  if (only.kind === 'site') {
    const site = getSiteBySlug(only.slug);
    if (site) {
      db.prepare('UPDATE sites SET autostart = ?, enabled = ?, updated_at = ? WHERE id = ?').run(saved.autostart ? 1 : 0, saved.enabled === 0 ? 0 : 1, Date.now(), site.id);
      await getSiteSync()?.ensureTenant?.(site.slug, { label: site.name });
      if (saved.running) out.restarted = Boolean((await startSite(getSite(site.id)))?.ok);
      if (saved.siteTunnel && deploy.features.tunnel) startSiteTunnel(getSite(site.id)).catch(() => {});
      if (args.reclaim) out.reclaimed = await claimRoutes({ hostnames: saved.result?.domains || [] }).catch((e) => ({ error: e.message }));
    }
  } else {
    if (saved.running) out.restarted = Boolean(startAccountServer()?.ok);
    if (args.reclaim) out.reclaimed = await claimRoutes({ hostnames: saved.result?.domains || [], port: publicPort() }).catch((e) => ({ error: e.message }));
  }
  logEvent('warn', 'fleet', `جابه‌جاییِ «${app}» برگشت خورد — برنامه روی همین سرور دوباره همان شد که بود${out.restarted ? ' (روشن)' : ''}`);
  return out;
}

/* ─────────────────────────────── مقصد ─────────────────────────────── */

async function doImport({ move, app, args = {} }, io) {
  const cur = localOf(move);
  if (cur?.role === 'dest' && ['placed', 'starting', 'active'].includes(cur.state)) return cur.saved.result;
  if (!io.pass) throw coded('no_key', 'کلیدِ این کار نرسید.');
  const only = parseOnly(app);
  if (only.kind === 'stations') throw coded('pump_cli_only', 'پمپ‌ها فقط با پنلِ بسته و از خطِ فرمان.');
  if (only.kind === 'site') {
    const s = getSiteBySlug(only.slug);
    if (s && isRunning(s.slug)) throw coded('dest_running', `سایتِ «${only.slug}» همین حالا روی این سرور روشن است — دو دفتر؛ هیچ چیزی جابه‌جا نشد.`);
  }
  const file = io.self ? bundlePath(move) : path.join(workDir(), `${safeId(move)}.in.vmove`);
  await fsp.mkdir(workDir(), { recursive: true });
  if (!io.self) await io.download(args, file);
  const got = await fileChunks(file);
  if (got.sha256 !== args.sha256 || got.size !== args.size) {
    if (!io.self) fs.rmSync(file, { force: true });
    throw coded('bundle_mismatch', 'بستهٔ رسیده با sha256 ِ مبدأ نمی‌خواند — هیچ چیزی جابه‌جا نشد.');
  }
  const stamp = stampNow();
  const staging = path.join(config.dataDir, `.vmove-importing-${stamp}`);
  setLocal(move, app, 'dest', 'staged', { at: Date.now() }); //  نگه: هنوز هیچ چیزی جای نگرفته
  let r;
  try {
    r = await stageOnlyImport({ file, pass: io.pass, staging, expect: app });
  } finally {
    if (!io.self) fs.rmSync(file, { force: true });
  }
  let placed;
  let prevAccount = null;
  const restored = [];
  try {
    if (only.kind === 'site') {
      const port = await allocatePort(r.manifest.app.port);
      placed = promoteOnly({
        staging, manifest: r.manifest, dataDir: config.dataDir, stamp, db, sitesRoot: sitesRoot(), sitesyncDir: config.siteSync.dataDir,
        port, enabled: false, replace: 'aside',
      });
    } else {
      prevAccount = { running: Boolean(accountStatus().running) };
      if (prevAccount.running) { stopAccountServer(); await waitAccountServerExit(15000); }
      placed = promoteOnly({ staging, manifest: r.manifest, dataDir: config.dataDir, stamp });
    }
    //  برنامه‌ای که پیشتر از همین سرور «رفته» بود حالا برگشته — نشانِ «کنار» برداشته (نگهِ «در جابه‌جایی» تا روشن شدن می‌ماند)
    for (const a of db.prepare('SELECT id FROM fleet_aside WHERE app_id = ? AND restored_at IS NULL').all(app)) {
      db.prepare('UPDATE fleet_aside SET restored_at = ? WHERE id = ?').run(Date.now(), a.id);
      restored.push(a.id);
    }
  } catch (e) {
    //  `promoteOnly` خودش همه را برگرداند ⇒ چیزی جای نگرفت؛ نگه برداشته و سرورِ حسابِ خودِ این سرور دوباره همان که بود
    setLocal(move, app, 'dest', 'discarded', { failed: e?.code || 'failed' });
    if (prevAccount?.running) startAccountServer();
    throw e;
  } finally {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  const after = compareOnly({ manifest: r.manifest, placed, dataDir: config.dataDir, sitesyncDir: config.siteSync.dataDir });
  const result = {
    files: r.files, sqlite: r.sqlite, accountReconciled: Boolean(r.account?.reconciled), port: placed.port ?? null,
    replaced: Boolean(placed.asideDir), after: { same: after.same, diffs: after.diffs.length },
  };
  setLocal(move, app, 'dest', 'placed', { result, placed, prevAccount, restored });
  if (!after.same) throw coded('verify_after', `${after.diffs.length} فایل پس از جای‌نشستن با بسته نمی‌خواند.`);
  logEvent('info', 'fleet', `بستهٔ «${app}» رسید، با sha256 و شمارِ ردیف سنجیده شد و جای گرفت (هنوز خاموش)`);
  return result;
}

async function untilTrue(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch { /* هنوز */ }
    await wait(250);
  }
  return false;
}

async function start({ move, app, args = {} }) {
  const cur = localOf(move);
  if (cur?.role === 'dest' && cur.state === 'active') return cur.saved.startResult;
  if (!cur || cur.role !== 'dest' || !['placed', 'starting'].includes(cur.state)) throw coded('not_placed', 'برنامه روی این سرور جای نگرفته است.');
  const only = parseOnly(app);
  setLocal(move, app, 'dest', 'starting', cur.saved); //  نگه برداشته: حالا خودِ همین کار روشنش می‌کند
  let result;
  if (only.kind === 'site') {
    const site = getSiteBySlug(only.slug);
    if (!site) throw coded('not_placed', 'ردیفِ سایت روی این سرور نیست.');
    db.prepare('UPDATE sites SET enabled = 1, autostart = ?, updated_at = ? WHERE id = ?').run(cur.saved.placed?.original?.autostart ? 1 : 0, Date.now(), site.id);
    await getSiteSync()?.ensureTenant?.(site.slug, { label: site.name });
    let running = false;
    if (args.wasRunning !== false) {
      const r = await startSite(getSite(site.id));
      if (!r?.ok) throw coded('start_failed', `سایت روی این سرور روشن نشد (${r?.error || 'خطا'}).`);
      running = await untilTrue(() => probePort(site.port), 20000);
      if (!running) throw coded('start_failed', `سایت روشن شد ولی پورتِ ${site.port} جواب نداد.`);
    }
    if (args.siteTunnel && deploy.features.tunnel) startSiteTunnel(getSite(site.id)).catch(() => {});
    result = { running, port: site.port };
  } else {
    let running = false;
    if (args.wasRunning !== false) {
      const r = startAccountServer();
      if (!r?.ok) throw coded('start_failed', `سرورِ حساب روی این سرور روشن نشد (${r?.reason || 'خطا'}).`);
      running = await untilTrue(() => accountStatus().running, 5000);
      if (!running) throw coded('start_failed', 'سرورِ حساب روشن نماند.');
    }
    result = { running };
  }
  setLocal(move, app, 'dest', 'active', { ...cur.saved, startResult: result });
  logEvent('info', 'fleet', `«${app}» روی این سرور روشن شد`);
  return result;
}

async function route({ move, app, args = {} }) {
  const cur = localOf(move);
  if (cur?.saved?.routeResult) return cur.saved.routeResult;
  if (!cur || cur.role !== 'dest' || cur.state !== 'active') throw coded('not_active', 'برنامه روی این سرور روشن نیست.');
  const only = parseOnly(app);
  const claim = await claimRoutes({ hostnames: args.hostnames || [], port: only.kind === 'account' ? publicPort() : null });
  let quickUrl = null;
  if (only.kind === 'site' && args.siteTunnel && deploy.features.tunnel) {
    await untilTrue(() => Boolean(siteTunnelState(only.slug).url), 15000);
    quickUrl = siteTunnelState(only.slug).url || null;
  }
  const result = { ...claim, quickUrl, port: cur.saved.startResult?.port ?? cur.saved.result?.port ?? null };
  setLocal(move, app, 'dest', 'active', { ...cur.saved, routeResult: result, routed: true });
  return result;
}

async function discard({ move, app, args = {} }) {
  const cur = localOf(move);
  if (!cur || cur.role !== 'dest') return { nothing: true };
  if (cur.state === 'discarded') return { already: true };
  const saved = cur.saved || {};
  if (cur.state === 'staged' || !saved.placed) {
    setLocal(move, app, 'dest', 'discarded', saved);
    return { nothing: true };
  }
  const only = parseOnly(app);
  const placed = saved.placed;
  const stamp = stampNow();
  const base = path.join(config.dataDir, ASIDE_DIR, `${stamp}-discarded-${only.kind === 'site' ? `site-${only.slug}` : only.id}`);
  const aside = asideMover(base, stamp);
  let released = null;
  if (only.kind === 'site') {
    const site = getSiteBySlug(only.slug);
    if (site) {
      await stopSite(site);
      stopSiteTunnel(site.slug, { forget: true });
      db.prepare('UPDATE sites SET enabled = 0, autostart = 0, updated_at = ? WHERE id = ?').run(Date.now(), site.id);
      await getSiteSync()?.releaseTenant?.(site.slug);
    }
    if (saved.routed || args.routed) released = await releaseRoutes({ hostnames: placed.domains || [] }).catch((e) => ({ error: e.message }));
    const d = siteDirs(only.slug);
    aside.put(placed.rootPath, 'root');
    aside.put(d.workspace, 'workspace');
    aside.put(d.store, 'store');
  } else {
    stopAccountServer();
    await waitAccountServerExit(15000);
    if (saved.routed || args.routed) released = await releaseRoutes({ hostnames: args.hostnames || [] }).catch((e) => ({ error: e.message }));
    aside.put(path.join(config.dataDir, 'account-server'), 'account-server');
  }
  //  آن‌چه پیش از این کار این‌جا بود (و `promoteOnly` کنارش گذاشته بود) سرِ جایش
  for (const it of placed.aside || []) {
    try { if (fs.existsSync(it.to) && !fs.existsSync(it.from)) fs.renameSync(it.to, it.from); } catch { /* بماند تا دستی */ }
  }
  for (const id of saved.restored || []) db.prepare('UPDATE fleet_aside SET restored_at = NULL WHERE id = ?').run(id);
  if (only.kind === 'site') {
    const prev = placed.previousRow;
    const site = getSiteBySlug(only.slug);
    if (site && prev) {
      db.prepare('UPDATE sites SET name = ?, root_path = ?, domain = ?, port = ?, kind = ?, start_command = ?, autostart = ?, enabled = ?, updated_at = ? WHERE id = ?')
        .run(prev.name, prev.root_path, prev.domain, prev.port, prev.kind, prev.start_command, prev.autostart, prev.enabled, Date.now(), site.id);
    } else if (site && !(saved.restored || []).length) {
      //  تازه ساخته شده بود ⇒ ردیف خاموش می‌ماند و «کنار» علامت می‌خورد (پاک نه: دفترِ رویدادهایش هم می‌ماند)
      db.prepare('INSERT INTO fleet_aside(app_id, slug, move_id, aside_dir, items, saved, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(app, only.slug, move, base, JSON.stringify(aside.items), JSON.stringify({ reason: 'discarded' }), Date.now());
    }
  }
  aside.note({ app, move, reason: 'discarded' });
  setLocal(move, app, 'dest', 'discarded', saved);
  if (only.kind === 'account' && saved.prevAccount?.running) startAccountServer();
  logEvent('warn', 'fleet', `نسخهٔ رسیدهٔ «${app}» روی این سرور خاموش و کنار رفت (برگشتِ جابه‌جایی؛ پاک نه)`);
  return { aside: aside.items.filter((i) => !i.error).length, released: released?.released?.length || 0 };
}

/* ─────────────────────────────── فرمان ─────────────────────────────── */

const HANDLERS = { freeze, export: doExport, import: doImport, start, route, retire, unfreeze, discard };
export const OPS = Object.freeze(Object.keys(HANDLERS));

//  یک فرمان در هر لحظه روی همین نصب (دو کار که هر دو این سرور را دارند پشتِ سرِ هم)
let chain = Promise.resolve();

/**
 * اجرای یک فرمانِ مرکز. ‎{ move, seq, op, app, args }‎ ⇒ ‎{ move, seq, ok, data | error }‎ — هرگز پرتاب نمی‌کند.
 * `io`: ‎{ self, pass, upload(file, meta), download(args, dest) }‎ — `pass` فقط در حافظهٔ همین فراخوانی.
 */
export function execute(cmd, io = {}) {
  const run = async () => {
    const fn = HANDLERS[cmd?.op];
    if (!fn) return { move: cmd?.move, seq: cmd?.seq, ok: false, error: { code: 'bad_op', message: 'فرمانِ ناشناخته' } };
    try {
      const data = await fn(cmd, io);
      return { move: cmd.move, seq: cmd.seq, ok: true, data: data ?? {} };
    } catch (e) {
      logEvent('warn', 'fleet', `گامِ «${cmd.op}» ِ جابه‌جاییِ «${cmd.app}» انجام نشد: ${String(e?.message || e).slice(0, 200)}`);
      return { move: cmd.move, seq: cmd.seq, ok: false, error: { code: e?.code || 'failed', message: String(e?.message || e).slice(0, 400) } };
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

/** پاک‌سازیِ کارگاهِ همین نصب هنگامِ بالا آمدن (بسته‌های رمزشدهٔ نیمه‌کاره — داده نیستند) */
export function sweepWork() {
  try { fs.rmSync(workDir(), { recursive: true, force: true }); } catch { /* نیست */ }
}
