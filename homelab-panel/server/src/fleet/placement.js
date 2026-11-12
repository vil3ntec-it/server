// ---------------------------------------------------------------------------
//  «این برنامه/سایت روی کدام سرور» — نقشِ **مرکز** (۱.۵۰.۹۵، گامِ ۳ ِ docs/MULTI-SERVER-fa.md)
//
//  • جدولِ «جا» (`fleet_placement`): هر برنامه یک گرهٔ فعال؛ بی ردیف، همان که گزارشِ تپش می‌گوید رویش روشن است.
//  • کارِ جابه‌جایی — ترتیبِ امن (بخشِ ۳ ِ سند)، هر گام یک فرمان به همان سرور (src/fleet/mover.js):
//      freeze (مبدأ فقط‌خواندنی) ⇒ export (بستهٔ ‎--only‎، تکه‌تکه با sha256 **به مرکز**) ⇒ import (مقصد تکه‌ها را **از مرکز**
//      می‌گیرد و می‌سنجد) ⇒ start ⇒ route (عوض شدنِ مسیر) ⇒ retire (مبدأ خاموش و کنار) ⇒ جدولِ جا.
//    ⛔ گره‌به‌گره هیچ اتصالی نیست: هر دو گره فقط بیرون‌رو به مرکز وصل‌اند (NAT نمی‌شکند)؛ هر پیام پاکتِ امضاشدهٔ گامِ ۲.
//    ⛔ هر گامِ شکست‌خورده ⇒ برگشت: مقصد کنار (discard)، مبدأ دوباره همان (unfreeze، و اگر مسیر رفته بود پس‌گرفتنش)،
//       جدولِ جا بی تغییر. گامِ آخر (retire) شکستِ «بی‌خبری» را برگشت نمی‌زند — برنامه همان دم روی مقصد زنده است؛ صبر
//       می‌کند تا مبدأ برگردد (فرمان دوباره‌پذیر است).
//  • قفلِ یک نویسنده: نمایهٔ یکتای جزئیِ ‎fleet_moves(app_id) WHERE active = 1‎ ⇒ در هر لحظه یک کار برای هر برنامه.
//    هر دو سرور آنلاین و نه در نگه‌داری؛ نگه‌داریِ سرورِ درگیر تا پایانِ کار بسته است.
//  • کلیدِ بسته: ۳۲ بایتِ تصادفیِ همین کار **فقط در حافظهٔ مرکز** و فقط به همان دو گره، پیچیده با X25519 ِ یک‌بارمصرفِ
//    هر درخواست (crypto.js). نه دیتابیس، نه دفتر، نه لاگ، نه پاسخِ مالک. پایانِ کار ⇒ صفر می‌شود. مرکزی که وسطِ کار
//    دوباره بالا بیاید کلید را ندارد ⇒ اگر بسته هنوز جای نگرفته بود برگشت، وگرنه گام‌های بی‌کلید ادامه.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, logEvent } from '../db.js';
import { bumpSoon } from '../live/bus.js';
import { wrapSecret } from './crypto.js';
import { FleetError, isNode, offlineAfterMs, hooks } from './hub.js';
import { buildReport, defaultName } from './report.js';
import { maintenanceState } from './maintenance.js';
import { execute, bundlePath, workDir, sweepWork, CHUNK_BYTES } from './mover.js';
import { planRoute } from './route-plan.js';

const now = () => Date.now();
const MIN = 60 * 1000;
const FORWARD = [
  { op: 'freeze', side: 'from', timeout: 3 * MIN },
  { op: 'export', side: 'from', timeout: 6 * 60 * MIN, key: true },
  { op: 'import', side: 'to', timeout: 6 * 60 * MIN, key: true },
  { op: 'start', side: 'to', timeout: 3 * MIN },
  { op: 'route', side: 'to', timeout: 10 * MIN },
  { op: 'retire', side: 'from', timeout: 0 }, //  بی برگشتِ زمانی — بالا را ببینید
];
const KEYED = new Set(['export', 'import']);

export function maxMoveBytes() {
  const n = Number(process.env.HLP_MOVE_MAX_BYTES);
  return Number.isFinite(n) && n > 1024 ? Math.floor(n) : 16 * 1024 ** 3;
}

/** id ⇒ کارِ زنده (کلید فقط این‌جا) */
const jobs = new Map();
const waiters = new Map();

function wake(nodeId) {
  const set = waiters.get(nodeId);
  if (!set) return;
  waiters.delete(nodeId);
  for (const r of set) r();
}
function waitFor(nodeId, ms) {
  return new Promise((resolve) => {
    const set = waiters.get(nodeId) || new Set();
    const done = () => { clearTimeout(t); set.delete(done); resolve(); };
    const t = setTimeout(done, ms);
    t.unref?.();
    set.add(done);
    waiters.set(nodeId, set);
  });
}

const nodeOf = (job, side) => (side === 'from' ? job.from.id : job.to.id);
const involves = (job, nodeId) => job.from.id === nodeId || job.to.id === nodeId;

/* ─────────────────────────────── دفترِ کار (بی هیچ راز) ─────────────────────────────── */

function persist(job, fields = {}) {
  db.prepare(`UPDATE fleet_moves SET state = ?, active = ?, step = ?, progress = ?, steps = ?, route = ?, error = ?, bytes = ?,
              updated_at = ?, finished_at = ? WHERE id = ?`)
    .run(job.state, ['running', 'rolling_back'].includes(job.state) ? 1 : null, job.step || null,
      JSON.stringify({ ...job.progress, meta: job.meta }), JSON.stringify(job.steps.slice(-40)), job.route ? JSON.stringify(job.route) : null,
      job.error || null, job.bytes || null, now(), fields.finishedAt || null, job.id);
  bumpSoon('fleet', 300);
}

function logStep(job, op, state, info = null) {
  const last = job.steps[job.steps.length - 1];
  if (last && last.op === op && last.state === 'running' && state !== 'running') {
    last.state = state;
    last.endedAt = now();
    if (info) last.info = info;
  } else {
    job.steps.push({ op, state, at: now(), ...(info ? { info } : {}) });
  }
}

/** خلاصهٔ بی‌راز از نتیجهٔ هر گام (برای صفحه) */
function stepInfo(op, data) {
  if (!data || typeof data !== 'object') return null;
  if (op === 'export') return { size: data.size, files: data.files, sqlite: data.sqlite, accountReconciled: data.accountReconciled };
  if (op === 'import') return { files: data.files, sqlite: data.sqlite, accountReconciled: data.accountReconciled, replaced: data.replaced, same: data.after?.same };
  if (op === 'start') return { running: data.running };
  if (op === 'route') return { mode: data.mode, applied: (data.applied || []).length, manual: (data.failures || []).length };
  if (op === 'retire') return { aside: data.aside, failed: data.failed };
  if (op === 'freeze') return { wasRunning: data.wasRunning };
  return null;
}

/* ─────────────────────────────── فرمان‌ها ─────────────────────────────── */

function argsFor(job, op) {
  const fz = job.meta.freeze || {};
  if (op === 'import') { const e = job.meta.export || {}; return { size: e.size, sha256: e.sha256, chunkBytes: e.chunkBytes, chunks: e.chunks }; }
  if (op === 'start') return { wasRunning: fz.wasRunning !== false, siteTunnel: Boolean(fz.siteTunnel) };
  if (op === 'route') return { hostnames: fz.domains || [], siteTunnel: Boolean(fz.siteTunnel) };
  if (op === 'retire') return { toName: job.to.name };
  return {};
}

function dispatch(job, { op, node, args = {}, key = false, timeout = 0, phase }) {
  job.seq += 1;
  const cmd = { move: job.id, seq: job.seq, op, app: job.appId, args };
  job.outstanding = { node, cmd, key, timeout, phase, sentAt: now(), delivered: false };
  job.step = op;
  if (phase === 'forward') {
    job.progress.sent = [...new Set([...(job.progress.sent || []), op])];
    logStep(job, op, 'running');
  } else {
    logStep(job, `rollback:${op}`, 'running');
  }
  persist(job);
  if (node === 'self') {
    execute(cmd, { self: true, pass: key ? job.pass : null })
      .then((res) => onResult(job.id, 'self', res))
      .catch((e) => logEvent('error', 'fleet', `جابه‌جایی (گامِ «${op}» روی همین مرکز): ${e?.message || e}`));
  } else {
    wake(node);
  }
}

function forward(job, index) {
  const s = FORWARD[index];
  if (s.key && !job.key) return beginRollback(job, { code: 'center_restarted', message: 'مرکز وسطِ کار دوباره بالا آمد و کلیدِ بسته (فقط در حافظه) رفت.' });
  dispatch(job, { op: s.op, node: nodeOf(job, s.side), args: argsFor(job, s.op), key: s.key, timeout: s.timeout, phase: 'forward' });
}

function rollbackPlan(job) {
  const sent = new Set(job.progress.sent || []);
  const routed = sent.has('route');
  const plan = [];
  const discard = sent.has('import') ? { op: 'discard', node: job.to.id, args: { routed, hostnames: job.meta.freeze?.domains || [] } } : null;
  const unfreeze = sent.has('freeze') ? { op: 'unfreeze', node: job.from.id, args: { reclaim: routed } } : null;
  //  ⛔ مقصدی که روشن شده بود اول خاموش، بعد مبدأ — هرگز دو نسخهٔ روشن (یک نویسنده)؛ وگرنه اول مبدأ (زودتر زنده)
  if (sent.has('start')) plan.push(discard, unfreeze); else plan.push(unfreeze, discard);
  return plan.filter(Boolean);
}

function beginRollback(job, error) {
  job.state = 'rolling_back';
  job.error = `${error?.code || 'failed'}: ${String(error?.message || '').slice(0, 300)}`;
  job.rollback = rollbackPlan(job);
  wipeKey(job);
  logEvent('warn', 'fleet', `جابه‌جاییِ «${job.appName}» از «${job.from.name}» به «${job.to.name}» انجام نشد (${error?.code || 'failed'}) — برگشت`);
  nextRollback(job);
}

function nextRollback(job) {
  const entry = job.rollback.shift();
  if (!entry) return finish(job, 'failed');
  if (job.gone?.has(entry.node)) { logStep(job, `rollback:${entry.op}`, 'skipped', { reason: 'node_gone' }); return nextRollback(job); }
  dispatch(job, { ...entry, phase: 'rollback' });
}

function wipeKey(job) {
  if (job.key) { job.key.fill(0); job.key = null; }
  job.pass = null;
}

function finish(job, state) {
  wipeKey(job);
  job.state = state;
  job.outstanding = null;
  try { fs.rmSync(bundlePath(job.id), { force: true }); } catch { /* نیست */ }
  if (state === 'done') {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO fleet_placement(app_id, node_id, app_type, app_name, move_id, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(app_id) DO UPDATE SET node_id = excluded.node_id, app_type = excluded.app_type, app_name = excluded.app_name,
                  move_id = excluded.move_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
        .run(job.appId, job.to.id, job.appType, job.appName, job.id, now(), job.by);
      persist(job, { finishedAt: now() });
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* بسته */ }
      throw e;
    }
    logEvent('info', 'fleet', `«${job.appName}» از «${job.from.name}» به «${job.to.name}» رفت ✅${job.route?.manual ? ` — ${job.route.manual} گامِ دستیِ مسیر مانده` : ''}`);
  } else {
    persist(job, { finishedAt: now() });
  }
  jobs.delete(job.id);
}

function onResult(moveId, nodeId, res) {
  const job = jobs.get(String(moveId || ''));
  if (!job) return;
  try {
    handleResult(job, nodeId, res);
  } catch (e) {
    //  خطای خودِ مرکز (دیتابیس…) هرگز کار را نیمه‌باز رها نمی‌کند
    logEvent('error', 'fleet', `جابه‌جاییِ «${job.appName}»: ${e?.message || e}`);
    if (job.state === 'running') { try { beginRollback(job, { code: 'center_error', message: String(e?.message || e) }); } catch { /* همان دفتر */ } }
  }
}

function handleResult(job, nodeId, res) {
  const o = job.outstanding;
  if (!o || o.node !== nodeId || o.cmd.seq !== res?.seq) return; //  کهنه/تکراری
  job.outstanding = null;
  const op = o.cmd.op;
  if (o.phase === 'rollback') {
    logStep(job, `rollback:${op}`, res.ok ? 'done' : 'failed', res.ok ? null : { error: res.error?.code || 'failed' });
    persist(job);
    return nextRollback(job);
  }
  if (!res.ok) {
    logStep(job, op, 'failed', { error: res.error?.code || 'failed', message: String(res.error?.message || '').slice(0, 300) });
    return beginRollback(job, res.error);
  }
  const data = res.data || {};
  //  مرکز همان چیزی را که خودش گرفت با گزارشِ مبدأ می‌سنجد
  if (op === 'export' && job.from.id !== 'self') {
    const u = job.upload;
    const sameChunks = u && JSON.stringify(u.chunks) === JSON.stringify(data.chunks || []);
    if (!u || u.received !== data.size || u.hash.copy().digest('hex') !== data.sha256 || !sameChunks) {
      logStep(job, op, 'failed', { error: 'upload_mismatch' });
      return beginRollback(job, { code: 'upload_mismatch', message: 'بستهٔ رسیده به مرکز با گزارشِ مبدأ نمی‌خواند.' });
    }
  }
  job.meta[op] = data;
  if (op === 'export') job.bytes = data.size;
  if (op === 'route') {
    const fz = job.meta.freeze || {};
    job.route = planRoute({ hostnames: fz.domains || [], from: { name: job.from.name, route: fz.route }, to: { name: job.to.name, route: data }, claim: data });
    job.route.guarded = data.guarded || [];
  }
  job.progress.done = [...new Set([...(job.progress.done || []), op])];
  logStep(job, op, 'done', stepInfo(op, data));
  const i = FORWARD.findIndex((s) => s.op === op);
  if (i === FORWARD.length - 1) return finish(job, 'done');
  persist(job);
  return forward(job, i + 1);
}

/* ─────────────────────────────── گره‌ها: کار، تکه ─────────────────────────────── */

export function hasJobFor(nodeId) {
  for (const j of jobs.values()) if (involves(j, nodeId)) return true;
  return false;
}

/** ‎/hub/task‎: نتیجه‌ها ⇒ گامِ بعد؛ فرمانِ همین گره (با کلیدِ پیچیده برای همین درخواست) یا null */
export async function taskPoll(nodeId, body) {
  for (const r of Array.isArray(body?.results) ? body.results.slice(0, 20) : []) {
    if (r && typeof r === 'object') onResult(r.move, nodeId, { seq: r.seq, ok: r.ok === true, data: r.data, error: r.error });
  }
  const pick = () => {
    for (const job of jobs.values()) if (job.outstanding?.node === nodeId) return job;
    return null;
  };
  let job = pick();
  const waitMs = Math.max(0, Math.min(10_000, Number(body?.wait) || 0));
  if (!job && waitMs && hasJobFor(nodeId)) { await waitFor(nodeId, waitMs); job = pick(); }
  if (!job) return { command: null, active: hasJobFor(nodeId) };
  const o = job.outstanding;
  const cmd = { ...o.cmd };
  if (o.key) {
    if (!job.key) return { command: null, active: true };
    const w = wrapSecret(job.key, body?.eph, `${job.id}|${nodeId}`);
    if (!w) throw new FleetError(400, 'bad_eph', 'کلیدِ یک‌بارمصرفِ همین درخواست نیست یا X25519 نیست.');
    cmd.key = w;
  }
  o.delivered = true;
  o.deliveredAt = now();
  return { command: cmd, active: true };
}

/** ‎/hub/chunk‎: تکهٔ بستهٔ مبدأ ⇒ مرکز (پشتِ سرِ هم، sha256 ِ هر تکه همان پاکتِ امضاشده) */
export function receiveChunk(nodeId, meta, body) {
  const job = jobs.get(String(meta?.job || ''));
  if (!job || job.state !== 'running') throw new FleetError(404, 'move_not_found', 'این کارِ جابه‌جایی نیست یا تمام شده.');
  const o = job.outstanding;
  if (!o || o.cmd.op !== 'export' || o.node !== nodeId || job.from.id !== nodeId) throw new FleetError(409, 'not_expected', 'مرکز منتظرِ بستهٔ این سرور نیست.');
  if (!Buffer.isBuffer(body) || !body.length || body.length > CHUNK_BYTES) throw new FleetError(400, 'bad_chunk', 'تکهٔ نادرست.');
  const file = bundlePath(job.id);
  if (meta.index === 0 && meta.offset === 0) {
    //  آغاز (یا آغازِ دوباره پس از بالا آمدنِ دوبارهٔ مبدأ)
    fs.mkdirSync(workDir(), { recursive: true });
    fs.rmSync(file, { force: true });
    job.upload = { received: 0, chunks: [], hash: crypto.createHash('sha256') };
  }
  const u = job.upload;
  if (!u || meta.offset !== u.received || meta.index !== u.chunks.length) throw new FleetError(409, 'bad_offset', 'ترتیبِ تکه‌ها به هم خورد.', { received: u?.received ?? 0 });
  const sha = crypto.createHash('sha256').update(body).digest('hex');
  if (body.length !== meta.size || sha !== meta.sha256) throw new FleetError(400, 'chunk_mismatch', 'sha256 ِ تکه با پاکتِ امضاشده نمی‌خواند.');
  if (u.received + body.length > maxMoveBytes()) throw new FleetError(413, 'too_large', 'بسته از سقف بزرگ‌تر است.');
  if (meta.index === 0) {
    try {
      const st = fs.statfsSync(workDir());
      if (Number(st.bavail) * Number(st.bsize) < body.length + 256 * 1024 * 1024) throw new FleetError(507, 'disk_full', 'جای خالیِ دیسکِ مرکز کم است.');
    } catch (e) { if (e instanceof FleetError) throw e; }
  }
  fs.appendFileSync(file, body, { mode: 0o600 });
  u.received += body.length;
  u.chunks.push({ size: body.length, sha256: sha });
  u.hash.update(body);
  job.lastProgressAt = now();
  job.bytes = u.received;
  return { received: u.received };
}

/** ‎/hub/chunk/get‎: تکهٔ بسته ⇒ مقصد (مقصد هر تکه را با فهرستِ امضاشدهٔ فرمانِ import می‌سنجد) */
export function chunkFor(nodeId, meta) {
  const job = jobs.get(String(meta?.job || ''));
  if (!job || job.state !== 'running') throw new FleetError(404, 'move_not_found', 'این کارِ جابه‌جایی نیست یا تمام شده.');
  const o = job.outstanding;
  if (!o || o.cmd.op !== 'import' || o.node !== nodeId || job.to.id !== nodeId) throw new FleetError(409, 'not_expected', 'این تکه برای این سرور نیست.');
  const chunks = job.meta.export?.chunks || [];
  const i = Number(meta.index);
  if (!Number.isSafeInteger(i) || i < 0 || i >= chunks.length) throw new FleetError(404, 'no_chunk', 'تکه نیست.');
  const offset = chunks.slice(0, i).reduce((a, c) => a + c.size, 0);
  const buf = Buffer.alloc(chunks[i].size);
  const fd = fs.openSync(bundlePath(job.id), 'r');
  try { fs.readSync(fd, buf, 0, buf.length, offset); } finally { fs.closeSync(fd); }
  job.lastProgressAt = now();
  return buf;
}

/* ─────────────────────────────── کارِ مالک ─────────────────────────────── */

async function resolveNode(id) {
  if (id === 'self') {
    const report = await buildReport();
    return { id: 'self', name: report.name || defaultName(), online: true, maintenance: maintenanceState().active, apps: report.apps || [] };
  }
  const n = db.prepare('SELECT * FROM fleet_nodes WHERE id = ?').get(String(id || ''));
  if (!n) throw new FleetError(404, 'node_not_found', 'این سرور در فهرست نیست.');
  if (n.status !== 'active') throw new FleetError(409, 'node_revoked', `«${n.name}» از این مرکز جدا شده است.`);
  let report = null;
  try { report = n.last_report ? JSON.parse(n.last_report) : null; } catch { report = null; }
  return {
    id: n.id, name: n.name,
    online: Boolean(n.last_seen_at) && now() - n.last_seen_at <= offlineAfterMs(),
    maintenance: Boolean(n.maintenance) || Boolean(report?.maintenance?.active),
    apps: report?.apps || [],
  };
}

const clean = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

/**
 * آغازِ یک کار. ⛔ مالک + احرازِ دوباره در درِ ‎routes/fleet.js‎؛ این‌جا: تأییدِ صریح (نامِ برنامه و دو سرور همان که
 * صفحه نشان داد)، هر دو آنلاین و نه در نگه‌داری، برنامه روی مبدأ هست، پمپ نیست، و قفلِ یک نویسنده.
 */
export async function startMove({ app, from, to, confirm = {}, by = null }) {
  if (isNode()) throw new FleetError(409, 'is_node', 'این سرور گرهٔ یک مرکز است؛ جابه‌جایی از «سرورهای من» ِ مرکز.');
  const appId = clean(app).slice(0, 120);
  if (!appId) throw new FleetError(400, 'app_missing', 'برنامه را بگویید.');
  if (!from || !to || from === to) throw new FleetError(400, 'same_node', 'مبدأ و مقصد باید دو سرورِ جدا باشند.');
  const [src, dst] = [await resolveNode(String(from)), await resolveNode(String(to))];
  const a = src.apps.find((x) => x.id === appId);
  if (!a) throw new FleetError(404, 'app_not_on_source', `این برنامه روی «${src.name}» نیست.`);
  if (a.type === 'pump') {
    throw new FleetError(409, 'pump_cli_only', 'پمپ‌ها (تانک‌تیل) داخلِ پروسهٔ پنل‌اند و بی دست زدن به کدِ پمپ ایستاندنی نیستند — فقط با پنلِ بسته از خطِ فرمان: '
      + 'move-server.mjs export --only stations ⇐ import --only stations (docs/DEPLOY-ANYWHERE-fa.md).');
  }
  if (a.main) throw new FleetError(409, 'main_site', 'سایتِ اصلی دفترِ اصلیِ سرورِ سایت را دارد و جدا نمی‌رود — «جابه‌جاییِ کامل».');
  for (const n of [src, dst]) {
    if (!n.online) throw new FleetError(409, 'node_offline', `«${n.name}» آفلاین است — هر دو سرور باید آنلاین باشند.`);
    if (n.maintenance) throw new FleetError(409, 'node_maintenance', `«${n.name}» در نگه‌داری (غیرفعال) است.`);
  }
  if (clean(confirm.app) !== clean(a.name) || clean(confirm.from) !== clean(src.name) || clean(confirm.to) !== clean(dst.name)) {
    throw new FleetError(400, 'confirm_mismatch', 'تأیید با نامِ برنامه و دو سرور نمی‌خواند — نامِ برنامه را دقیق بنویسید.');
  }
  for (const j of jobs.values()) if (j.appId === appId) throw new FleetError(409, 'move_busy', 'همین برنامه همین حالا در کارِ جابه‌جاییِ دیگری است.');
  const id = crypto.randomBytes(16).toString('base64url');
  const t = now();
  try {
    db.prepare(`INSERT INTO fleet_moves(id, app_id, app_type, app_name, from_node, to_node, from_name, to_name, state, active, step, progress, steps,
                created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', 1, NULL, '{}', '[]', ?, ?, ?)`)
      .run(id, appId, a.type, a.name, src.id, dst.id, src.name, dst.name, t, t, by ? String(by).slice(0, 80) : null);
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) throw new FleetError(409, 'move_busy', 'همین برنامه همین حالا در کارِ جابه‌جاییِ دیگری است.');
    throw e;
  }
  const key = crypto.randomBytes(32);
  const job = {
    id, appId, appType: a.type, appName: a.name, by: by ? String(by).slice(0, 80) : null,
    from: { id: src.id, name: src.name }, to: { id: dst.id, name: dst.name },
    key, pass: key.toString('base64url'), state: 'running', step: null, seq: 0, outstanding: null,
    progress: {}, meta: {}, steps: [], route: null, error: null, bytes: 0, startedAt: t, lastProgressAt: t, gone: new Set(),
  };
  jobs.set(id, job);
  logEvent('info', 'fleet', `جابه‌جاییِ «${a.name}» از «${src.name}» به «${dst.name}» آغاز شد`);
  forward(job, 0);
  return { id, app: appId, from: src.id, to: dst.id };
}

/* ─────────────────────────────── زمان و گره‌های رفته ─────────────────────────────── */

function lastSeen(nodeId) {
  const n = db.prepare('SELECT last_seen_at, status FROM fleet_nodes WHERE id = ?').get(nodeId);
  return n?.status === 'active' ? n.last_seen_at || 0 : 0;
}

function tick() {
  const t = now();
  for (const job of [...jobs.values()]) {
    const o = job.outstanding;
    if (!o || o.node === 'self' || o.phase !== 'forward' || !o.timeout) continue;
    const offline = t - lastSeen(o.node) > offlineAfterMs();
    const stale = t - Math.max(o.sentAt, job.lastProgressAt || 0) > o.timeout;
    if (offline || stale) {
      job.outstanding = null;
      logStep(job, o.cmd.op, 'failed', { error: offline ? 'node_offline' : 'timeout' });
      beginRollback(job, { code: offline ? 'node_offline' : 'timeout', message: offline ? 'سرورِ درگیر آفلاین شد.' : 'گام در زمانش تمام نشد.' });
    }
  }
}

/** گره جدا شد: فرمان‌های مانده برای آن رها (نمی‌رسد)؛ کاری که فقط منتظرِ همان بود تمام می‌شود */
function nodeGone(nodeId) {
  for (const job of [...jobs.values()]) {
    if (!involves(job, nodeId)) continue;
    job.gone.add(nodeId);
    const o = job.outstanding;
    if (o?.node !== nodeId) continue;
    job.outstanding = null;
    if (o.phase === 'rollback') { logStep(job, `rollback:${o.cmd.op}`, 'skipped', { reason: 'node_gone' }); nextRollback(job); continue; }
    if (o.cmd.op === 'retire') {
      //  برنامه روی مقصد زنده و مسیرش آن‌جاست؛ مبدأ دیگر نمی‌رسد ⇒ جا عوض، با یادداشت
      logStep(job, 'retire', 'skipped', { reason: 'node_gone' });
      job.error = 'source_gone: مبدأ پیش از «کنار گذاشتن» از مرکز جدا شد — نسخهٔ آن‌جا را دستی خاموش نگه دارید.';
      finish(job, 'done');
      continue;
    }
    logStep(job, o.cmd.op, 'failed', { error: 'node_gone' });
    beginRollback(job, { code: 'node_gone', message: 'سرورِ درگیر از مرکز جدا شد.' });
  }
}

let timer = null;
let started = false;

/** هنگامِ بالا آمدنِ پنل (مرکز یا گره): کارگاه پاک، کارهای نیمه‌کارهٔ مرکز ادامه یا برگشت */
export function startPlacement() {
  if (started) return;
  started = true;
  hooks.tasksFor = hasJobFor;
  hooks.busyNode = hasJobFor;
  hooks.nodeGone = nodeGone;
  sweepWork();
  for (const r of db.prepare('SELECT * FROM fleet_moves WHERE active = 1').all()) {
    let progress = {};
    let steps = [];
    try { progress = JSON.parse(r.progress || '{}'); steps = JSON.parse(r.steps || '[]'); } catch { /* خالی */ }
    const job = {
      id: r.id, appId: r.app_id, appType: r.app_type, appName: r.app_name, by: r.created_by,
      from: { id: r.from_node, name: r.from_name }, to: { id: r.to_node, name: r.to_name },
      key: null, pass: null, state: r.state, step: r.step, seq: 1000, outstanding: null,
      progress: { sent: progress.sent || [], done: progress.done || [] }, meta: progress.meta || {}, steps, route: r.route ? JSON.parse(r.route) : null, error: r.error, bytes: r.bytes || 0,
      startedAt: r.created_at, lastProgressAt: now(), gone: new Set(),
    };
    jobs.set(job.id, job);
    const done = new Set(progress.done || []);
    if (r.state === 'running' && done.has('import')) {
      //  بسته جای گرفته بود: گام‌های مانده کلید نمی‌خواهند ⇒ ادامه
      const next = FORWARD.findIndex((s) => !done.has(s.op));
      logEvent('warn', 'fleet', `جابه‌جاییِ «${job.appName}» پس از بالا آمدنِ دوبارهٔ مرکز از گامِ «${FORWARD[next].op}» ادامه یافت`);
      forward(job, next);
    } else {
      beginRollback(job, { code: 'center_restarted', message: 'مرکز وسطِ کار دوباره بالا آمد و کلیدِ بسته (فقط در حافظه) رفت.' });
    }
  }
  timer = setInterval(() => { try { tick(); } catch (e) { logEvent('warn', 'fleet', `زمان‌سنجِ جابه‌جایی: ${e.message}`); } }, 1000);
  timer.unref?.();
}

/* ─────────────────────────────── نما ─────────────────────────────── */

const LIVE_STATES = ['running', 'rolling_back'];

function moveRowView(r) {
  let steps = [];
  let route = null;
  try { steps = JSON.parse(r.steps || '[]'); } catch { steps = []; }
  try { route = r.route ? JSON.parse(r.route) : null; } catch { route = null; }
  const live = jobs.get(r.id);
  return {
    id: r.id, app: r.app_id, appType: r.app_type, appName: r.app_name,
    from: { id: r.from_node, name: r.from_name }, to: { id: r.to_node, name: r.to_name },
    state: r.state, active: LIVE_STATES.includes(r.state), step: r.step, steps, route, error: r.error,
    bytes: live?.bytes ?? r.bytes ?? null, waitingFor: live?.outstanding ? (live.outstanding.node === 'self' ? 'self' : live.outstanding.node) : null,
    delivered: live?.outstanding ? Boolean(live.outstanding.delivered || live.outstanding.node === 'self') : null,
    createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at, by: r.created_by,
  };
}

export function movesView(limit = 12) {
  return db.prepare('SELECT * FROM fleet_moves ORDER BY created_at DESC LIMIT ?').all(limit).map(moveRowView);
}

export function moveView(id) {
  const r = db.prepare('SELECT * FROM fleet_moves WHERE id = ?').get(String(id || ''));
  return r ? moveRowView(r) : null;
}

/**
 * جدولِ «جا» برای صفحه: هر برنامه ⇒ کجاست (جدول، یا «دیده‌شده» از گزارشِ تپش)، روی کدام سرورها هست/روشن است،
 * جابه‌جاشدنی هست یا نه (و چرا)، و کارِ در جریانش.
 */
export function placementView({ self, nodes }) {
  const entries = [self, ...(nodes || []).filter((n) => n.status === 'active')];
  const apps = new Map();
  for (const e of entries) {
    for (const a of e.apps || []) {
      if (!apps.has(a.id)) apps.set(a.id, { id: a.id, type: a.type, name: a.name, kind: a.kind || null, dataful: Boolean(a.dataful), main: Boolean(a.main), holders: [] });
      const x = apps.get(a.id);
      if (a.dataful) x.dataful = true;
      if (a.main) x.main = true;
      x.holders.push({ id: e.id, name: e.name, self: Boolean(e.self), running: Boolean(a.running), online: Boolean(e.online) });
    }
  }
  const rows = new Map(db.prepare('SELECT * FROM fleet_placement').all().map((r) => [r.app_id, r]));
  for (const [id, r] of rows) if (!apps.has(id)) apps.set(id, { id, type: r.app_type, name: r.app_name, kind: null, dataful: true, main: false, holders: [] });
  const live = new Map();
  for (const r of db.prepare(`SELECT * FROM fleet_moves WHERE active = 1`).all()) live.set(r.app_id, moveRowView(r));
  const nameOf = (id) => entries.find((e) => e.id === id)?.name || (nodes || []).find((n) => n.id === id)?.name || null;
  const out = [];
  for (const a of apps.values()) {
    const row = rows.get(a.id);
    const running = a.holders.filter((h) => h.running);
    const observed = running.length === 1 ? running[0].id : (running.length === 0 && a.holders.length === 1 ? a.holders[0].id : null);
    const nodeId = row?.node_id || observed;
    const why = a.type === 'pump' ? 'pump_cli_only' : a.main ? 'main_site' : null;
    out.push({
      ...a,
      node: nodeId ? { id: nodeId, name: nameOf(nodeId) } : null,
      source: row ? 'table' : observed ? 'observed' : 'unknown',
      mismatch: Boolean(row && running.length && !running.some((h) => h.id === row.node_id)),
      movable: !why,
      why,
      move: live.get(a.id) || null,
    });
  }
  const order = { account: 0, site: 1, pump: 2 };
  return out.sort((x, y) => (order[x.type] ?? 9) - (order[y.type] ?? 9) || String(x.name).localeCompare(String(y.name)));
}
