// ---------------------------------------------------------------------------
//  «سرورهای من» — نقشِ «گره» (۱.۵۰.۹۴)
//
//  مالکِ همین نصب نشانیِ مرکز و کدِ یک‌باره را می‌دهد (تنظیمات، یا ‎node scripts/join.mjs <نشانی> <کد>‎) ⇒ کلیدِ
//  Ed25519 ِ تازه ⇒ پیامِ «وصل» با همان کلید امضا ⇒ پاسخِ امضاشدهٔ مرکز (کلیدِ عمومیِ مرکز همین‌جا سنجاق می‌شود) ⇒
//  تازه آن‌وقت کلیدِ خصوصی روی دیسک (‎0600‎) و ردیفِ `fleet_link`. کدِ نادرست ⇒ هیچ چیزی روی دیسک نمی‌ماند.
//
//  ⛔ فقط بیرون‌رو: هر ‎HLP_FLEET_HEARTBEAT_MS‎ (۳۰ ثانیه) یک ‎POST /api/fleet/hub/heartbeat‎. سوکتِ ‎realtime.js‎ ِ پنل
//     برای مرورگرِ واردشده است (JWT، اتاق‌ها، پخش)؛ برای گره یک درخواستِ امضاشدهٔ بی‌حالت از هر پراکسی/تونلی می‌گذرد
//     و قطع و وصلِ شبکه چیزی برای «دوباره وصل شدن» ندارد.
//  ⛔ پاسخی که امضای مرکزِ سنجاق‌شده را ندارد یا nonce ِ همین درخواست را برنمی‌گرداند نادیده است — فرمانِ «نگه‌داری»
//     را فقط مرکزِ واقعی می‌دهد.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, logEvent } from '../db.js';
import { bumpSoon } from '../live/bus.js';
import { generateKeys, signEnvelope, readEnvelope, verifyEnvelope, parsePublicKey, ephemeralKey, unwrapSecret } from './crypto.js';
import { writeNodeKey, readNodeKey } from './keys.js';
import { buildReport, defaultName, defaultKind, NODE_KINDS } from './report.js';
import { maintenanceState, enterMaintenance, exitMaintenance } from './maintenance.js';
import { FleetError, activeNodeCount } from './hub.js';
import { versionInfo } from '../version.js';
import { execute } from './mover.js';

export const heartbeatMs = () => {
  const n = Number(process.env.HLP_FLEET_HEARTBEAT_MS);
  return Number.isFinite(n) && n >= 200 ? Math.min(n, 10 * 60 * 1000) : 30 * 1000;
};

export function activeLink() {
  return db.prepare("SELECT * FROM fleet_link WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() || null;
}

const LOOPBACK_OR_LAN = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+)$/i;

/** نشانیِ مرکز ⇒ ‎origin‎. ‎https‎ اجباری مگر نشانیِ همین شبکه (خانه/Tailscale) یا همین کامپیوتر. */
export function normalizeCenterUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new FleetError(400, 'bad_url', 'نشانیِ مرکز درست نیست (مثلاً https://panel.example.com).'); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new FleetError(400, 'bad_url', 'نشانیِ مرکز باید با https:// شروع شود.');
  if (u.protocol === 'http:' && !LOOPBACK_OR_LAN.test(u.hostname)) {
    throw new FleetError(400, 'https_required', 'نشانیِ مرکز از اینترنت باید https باشد؛ http فقط روی همین شبکهٔ خانه.');
  }
  return u.origin;
}

async function post(url, body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  t.unref?.();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      redirect: 'manual',
    });
    let json = null;
    try { json = await r.json(); } catch { /* نه JSON */ }
    return { status: r.status, json };
  } finally {
    clearTimeout(t);
  }
}

/** پاسخِ امضاشدهٔ مرکز برای همین درخواست؟ ‎payload‎ یا null */
function readReply(raw, centerKey, nodeId, nonce) {
  const r = readEnvelope(raw, 'reply');
  if (!r.ok) return null;
  if (r.env.node !== nodeId || r.env.nonce !== nonce || r.env.body.node !== nodeId || r.env.body.nonce !== nonce) return null;
  if (!verifyEnvelope(r.env, centerKey)) return null;
  return r.env.body;
}

const JOIN_ERRORS = {
  code_invalid: [403, null], code_expired: [403, null], code_used: [403, null], code_missing: [400, null],
  stale_ts: [400, 'ساعتِ این کامپیوتر با مرکز بیش از ۵ دقیقه فرق دارد — ساعت را درست کنید.'],
  is_node: [409, null], bad_signature: [502, null], bad_key: [502, null], bad_envelope: [502, null],
};

/**
 * وصل شدن به مرکز. ‎{ ok, link }‎ یا FleetError.
 * @param {{ center: string, code: string, name?: string, kind?: string, by?: string }} o
 */
export async function joinCenter({ center, code, name, kind, by = null }) {
  if (activeLink()) throw new FleetError(409, 'already_linked', 'این سرور همین حالا به یک مرکز وصل است؛ اول «جدا شدن» را بزنید.');
  if (activeNodeCount() > 0) throw new FleetError(409, 'center_has_nodes', 'این سرور خودش مرکزِ سرورهای دیگری است؛ گرهٔ مرکزِ دیگر نمی‌شود.');
  const origin = normalizeCenterUrl(center);
  if (!String(code || '').trim()) throw new FleetError(400, 'code_missing', 'کدِ وصل را بنویسید.');
  const nodeName = (typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) : '') || defaultName();
  const nodeKind = NODE_KINDS.includes(kind) ? kind : defaultKind();
  const keys = generateKeys();
  const env = signEnvelope({
    purpose: 'join',
    node: '',
    payload: { code: String(code), publicKey: keys.publicKey, name: nodeName, kind: nodeKind, version: versionInfo.version || null },
    privateKey: keys.privateKeyPem,
  });
  let res;
  try {
    res = await post(`${origin}/api/fleet/hub/join`, env);
  } catch (e) {
    throw new FleetError(502, 'center_unreachable', `مرکز جواب نداد (${e?.name === 'AbortError' ? 'زمان گذشت' : (e?.cause?.code || e?.message || 'شبکه')}).`);
  }
  if (res.status !== 200) {
    const err = String(res.json?.error || `http_${res.status}`);
    const [status, msg] = JOIN_ERRORS[err] || [502, null];
    throw new FleetError(status, err, msg || res.json?.message || `مرکز نپذیرفت (${res.status}).`);
  }
  //  پاسخ با کلیدِ مرکز امضا شده و nonce ِ همین درخواست را برمی‌گرداند؛ همان کلید از این پس سنجاق است
  const r = readEnvelope(res.json?.reply, 'reply');
  const centerKey = r.ok ? r.env.body.centerKey : null;
  const nodeId = r.ok ? r.env.node : null;
  if (!r.ok || !parsePublicKey(centerKey) || !/^[A-Za-z0-9_-]{8,64}$/.test(String(nodeId || '')) || !readReply(res.json.reply, centerKey, nodeId, env.nonce)) {
    throw new FleetError(502, 'bad_reply', 'پاسخِ مرکز امضای درست نداشت — وصل نشد.');
  }
  writeNodeKey(nodeId, keys.privateKeyPem);
  db.prepare(`INSERT INTO fleet_link(center_url, node_id, center_key, center_name, name, kind, status, joined_at, joined_by)
              VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(origin, nodeId, centerKey, String(r.env.body.centerName || '').slice(0, 80) || null, nodeName, nodeKind, Date.now(), by);
  logEvent('info', 'fleet', `این سرور به مرکزِ ${origin} وصل شد`);
  bumpSoon('fleet', 300);
  startFleetNode();
  setTimeout(() => tick().catch(() => {}), 50).unref?.();
  return { ok: true, link: linkView(activeLink()) };
}

function endLink(link, status) {
  db.prepare('UPDATE fleet_link SET status = ?, ended_at = ? WHERE id = ?').run(status, Date.now(), link.id);
  bumpSoon('fleet', 300);
}

/** نگه‌داری‌ای که مرکز خواسته بود، با جدا شدن برمی‌گردد — سرورِ تنها برنامه‌هایش را روشن دارد */
async function liftCenterMaintenance() {
  const m = maintenanceState();
  if (m.active && m.source === 'center') await exitMaintenance('center');
}

/** جدا شدن از سوی همین گره: پیامِ امضاشده به مرکز (اگر برسد) و پایانِ ردیف. کلید پاک نمی‌شود. */
export async function leaveCenter() {
  const link = activeLink();
  if (!link) throw new FleetError(404, 'not_linked', 'این سرور به مرکزی وصل نیست.');
  let notified = false;
  const key = readNodeKey(link.node_id);
  if (key) {
    try {
      const env = signEnvelope({ purpose: 'leave', node: link.node_id, payload: {}, privateKey: key });
      const res = await post(`${link.center_url}/api/fleet/hub/leave`, env, 5000);
      notified = res.status === 200 && Boolean(readReply(res.json?.reply, link.center_key, link.node_id, env.nonce));
    } catch { notified = false; }
  }
  endLink(link, 'left');
  await liftCenterMaintenance();
  logEvent('info', 'fleet', `این سرور از مرکزِ ${link.center_url} جدا شد${notified ? '' : ' (مرکز خبردار نشد — آن‌جا «جدا کردن» را بزنید)'}`);
  return { ok: true, centerNotified: notified };
}

export function linkView(link) {
  if (!link) return null;
  return {
    status: link.status,
    centerUrl: link.center_url,
    centerName: link.center_name,
    nodeId: link.node_id,
    name: link.name,
    kind: link.kind,
    joinedAt: link.joined_at,
    lastOkAt: link.last_ok_at || null,
    lastError: link.last_error || null,
    lastErrorAt: link.last_error_at || null,
    endedAt: link.ended_at || null,
  };
}

/** وضعیتِ «گره» برای تنظیمات: پیوندِ فعال، یا آخرین پیوندِ پایان‌یافته */
export function nodeStatus() {
  const active = activeLink();
  const last = active || db.prepare('SELECT * FROM fleet_link ORDER BY id DESC LIMIT 1').get() || null;
  return { linked: Boolean(active), link: linkView(last), heartbeatMs: heartbeatMs() };
}

/* ─────────────────────────────── تپش ─────────────────────────────── */

let timer = null;
let inflight = false;

function recordError(link, code, message) {
  db.prepare('UPDATE fleet_link SET last_error = ?, last_error_at = ? WHERE id = ?').run(`${code}${message ? `: ${String(message).slice(0, 200)}` : ''}`, Date.now(), link.id);
}

/** یک تپش — بیرون‌رو. پاسخ فقط با امضای مرکزِ سنجاق‌شده اثر دارد. */
export async function tick() {
  if (inflight) return { skipped: 'inflight' };
  const link = activeLink();
  if (!link) return { skipped: 'not_linked' };
  inflight = true;
  try {
    const key = readNodeKey(link.node_id);
    if (!key) { recordError(link, 'key_missing', 'کلیدِ این گره در پوشهٔ داده نیست — جدا شوید و دوباره وصل شوید'); return { ok: false, error: 'key_missing' }; }
    const report = await buildReport(link);
    const env = signEnvelope({ purpose: 'heartbeat', node: link.node_id, payload: { report }, privateKey: key });
    let res;
    try {
      res = await post(`${link.center_url}/api/fleet/hub/heartbeat`, env, 15000);
    } catch (e) {
      recordError(link, 'center_unreachable', e?.cause?.code || e?.name || e?.message);
      return { ok: false, error: 'center_unreachable' };
    }
    if (res.status === 403 && res.json?.error === 'node_revoked') {
      const body = readReply(res.json?.reply, link.center_key, link.node_id, env.nonce);
      if (body?.revoked) {
        endLink(link, 'revoked');
        await liftCenterMaintenance();
        logEvent('warn', 'fleet', `مرکزِ ${link.center_url} این سرور را جدا کرد`);
        return { ok: false, error: 'node_revoked' };
      }
      recordError(link, 'bad_reply', 'پاسخِ «جدا شده» امضای مرکز را نداشت');
      return { ok: false, error: 'bad_reply' };
    }
    if (res.status !== 200) {
      let msg = res.json?.message || null;
      if (res.json?.error === 'stale_ts' && Number.isFinite(res.json?.serverTime)) {
        msg = `ساعتِ این کامپیوتر ${Math.round((Date.now() - res.json.serverTime) / 60000)} دقیقه با مرکز فرق دارد`;
      }
      recordError(link, String(res.json?.error || `http_${res.status}`), msg);
      return { ok: false, error: res.json?.error || `http_${res.status}` };
    }
    const body = readReply(res.json?.reply, link.center_key, link.node_id, env.nonce);
    if (!body?.ok) { recordError(link, 'bad_reply', 'پاسخِ مرکز امضای درست نداشت'); return { ok: false, error: 'bad_reply' }; }
    db.prepare('UPDATE fleet_link SET last_ok_at = ?, last_error = NULL, last_error_at = NULL WHERE id = ?').run(Date.now(), link.id);
    const m = maintenanceState();
    if (body.maintenance === true && !m.active) await enterMaintenance('center');
    else if (body.maintenance === false && m.active && m.source === 'center') await exitMaintenance('center');
    //  (۱.۵۰.۹۵) مرکز برای این گره کارِ جابه‌جایی دارد ⇒ سراغِ ‎/hub/task‎ (باز هم فقط بیرون‌رو)
    if (body.tasks === true) startTaskLoop();
    return { ok: true, maintenance: body.maintenance === true, tasks: body.tasks === true };
  } finally {
    inflight = false;
  }
}

export function startFleetNode() {
  if (timer) return;
  timer = setInterval(() => { tick().catch((e) => logEvent('warn', 'fleet', `تپش: ${e?.message || e}`)); }, heartbeatMs());
  timer.unref?.();
  if (activeLink()) setTimeout(() => tick().catch(() => {}), 1000).unref?.();
}

export function stopFleetNode() {
  clearInterval(timer);
  timer = null;
}

/* ─────────────── کارهای جابه‌جایی (۱.۵۰.۹۵، گامِ ۳) — باز هم فقط بیرون‌رو ───────────────
 *  پاسخِ تپش که بگوید «کار داری»، گره پشتِ سرِ هم ‎POST /api/fleet/hub/task‎ می‌زند (مرکز تا ۸ ثانیه نگه می‌دارد اگر
 *  فرمانی نیست): هر درخواست نتیجه‌های پیشین را می‌برد و یک کلیدِ X25519 ِ یک‌بارمصرف، و فرمانِ بعدی را می‌گیرد.
 *  ⛔ پاسخِ بی امضای مرکزِ سنجاق‌شده نادیده؛ کلیدِ بسته فقط با کلیدِ خصوصیِ یک‌بارمصرفِ **همان** درخواست باز می‌شود و
 *     فقط در حافظهٔ همان فرمان می‌ماند. بستهٔ رمزشده تکه‌تکه به مرکز می‌رود و از مرکز می‌آید — هرگز گره‌به‌گره.
 */
let looping = false;
const pendingResults = [];
const resultCache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const codedErr = (code, message) => Object.assign(new Error(message), { code });

async function fetchTimed(url, init, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  t.unref?.();
  try { return await fetch(url, { ...init, signal: ctrl.signal, redirect: 'manual' }); } finally { clearTimeout(t); }
}

async function uploadBundle(link, key, move, file, meta) {
  const fd = fs.openSync(file, 'r');
  try {
    let offset = 0;
    for (let index = 0; index < meta.chunks.length; index++) {
      const c = meta.chunks[index];
      const buf = Buffer.alloc(c.size);
      fs.readSync(fd, buf, 0, c.size, offset);
      let ok = false;
      let last = '';
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const env = signEnvelope({ purpose: 'chunk', node: link.node_id, payload: { job: move, index, offset, size: c.size, sha256: c.sha256 }, privateKey: key });
        try {
          const r = await fetchTimed(`${link.center_url}/api/fleet/hub/chunk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Fleet-Envelope': Buffer.from(JSON.stringify(env)).toString('base64url') },
            body: buf,
          }, 120000);
          if (r.status === 200) { ok = true; break; }
          let j = null;
          try { j = await r.json(); } catch { /* نه JSON */ }
          last = `${r.status} ${j?.error || ''}`;
          if (r.status < 500) break; //  ردِ صریح: تلاشِ دوباره معنا ندارد
        } catch (e) { last = e?.name === 'AbortError' ? 'timeout' : (e?.cause?.code || e?.message || 'network'); }
        await sleep(1000 * (attempt + 1));
      }
      if (!ok) throw codedErr('upload_failed', `تکهٔ ${index + 1} از ${meta.chunks.length} به مرکز نرسید (${last}).`);
      offset += c.size;
    }
  } finally { fs.closeSync(fd); }
}

async function downloadBundle(link, key, move, args, dest) {
  const chunks = Array.isArray(args?.chunks) ? args.chunks : [];
  if (!chunks.length || !Number.isSafeInteger(args.size)) throw codedErr('bad_command', 'فهرستِ تکه‌ها نیامد.');
  try {
    const st = fs.statfsSync(path.dirname(dest));
    if (Number(st.bavail) * Number(st.bsize) < args.size * 2 + 256 * 1024 * 1024) throw codedErr('disk_full', 'جای خالیِ دیسکِ این سرور برای این بسته کم است.');
  } catch (e) { if (e.code === 'disk_full') throw e; }
  fs.rmSync(dest, { force: true });
  const fd = fs.openSync(dest, 'w', 0o600);
  try {
    for (let index = 0; index < chunks.length; index++) {
      let buf = null;
      let last = '';
      for (let attempt = 0; attempt < 3 && !buf; attempt++) {
        const env = signEnvelope({ purpose: 'chunk-get', node: link.node_id, payload: { job: move, index }, privateKey: key });
        try {
          const r = await fetchTimed(`${link.center_url}/api/fleet/hub/chunk/get`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env),
          }, 120000);
          if (r.status === 200) buf = Buffer.from(await r.arrayBuffer());
          else { last = String(r.status); if (r.status < 500) break; }
        } catch (e) { last = e?.name === 'AbortError' ? 'timeout' : (e?.cause?.code || e?.message || 'network'); }
        if (!buf) await sleep(1000 * (attempt + 1));
      }
      if (!buf) throw codedErr('download_failed', `تکهٔ ${index + 1} از ${chunks.length} از مرکز نرسید (${last}).`);
      //  ⛔ هر تکه با sha256 ِ فهرستِ امضاشدهٔ فرمان (همان که مبدأ گزارش داد)
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      if (buf.length !== chunks[index].size || sha !== chunks[index].sha256) throw codedErr('chunk_mismatch', `تکهٔ ${index + 1} با sha256 ِ مبدأ نمی‌خواند — هیچ چیزی جابه‌جا نشد.`);
      fs.writeSync(fd, buf);
    }
  } finally { fs.closeSync(fd); }
}

async function taskLoop() {
  let idle = 0;
  while (idle < 3) {
    const link = activeLink();
    if (!link) return;
    const key = readNodeKey(link.node_id);
    if (!key) return;
    const eph = ephemeralKey();
    const results = pendingResults.splice(0);
    const env = signEnvelope({ purpose: 'task', node: link.node_id, payload: { results, eph: eph.publicKey, wait: 8000 }, privateKey: key });
    let res = null;
    try { res = await post(`${link.center_url}/api/fleet/hub/task`, env, 20000); } catch { res = null; }
    const body = res?.status === 200 ? readReply(res.json?.reply, link.center_key, link.node_id, env.nonce) : null;
    if (!body?.ok) {
      pendingResults.unshift(...results);
      idle++;
      await sleep(2000);
      continue;
    }
    const cmd = body.command && typeof body.command === 'object' ? body.command : null;
    if (cmd) {
      idle = 0;
      const k = `${cmd.move}:${cmd.seq}`;
      let result = resultCache.get(k);
      if (!result) {
        let pass = null;
        if (cmd.key) {
          const raw = unwrapSecret(cmd.key, eph.privateKey, `${cmd.move}|${link.node_id}`);
          if (raw) { pass = raw.toString('base64url'); raw.fill(0); }
          else result = { move: cmd.move, seq: cmd.seq, ok: false, error: { code: 'bad_key', message: 'کلیدِ این کار باز نشد.' } };
        }
        if (!result) {
          result = await execute({ move: cmd.move, seq: cmd.seq, op: cmd.op, app: cmd.app, args: cmd.args || {} }, {
            self: false, pass,
            upload: (file, meta) => uploadBundle(link, key, cmd.move, file, meta),
            download: (args, dest) => downloadBundle(link, key, cmd.move, args, dest),
          });
        }
        pass = null;
        resultCache.set(k, result);
        for (const old of [...resultCache.keys()].slice(0, -50)) resultCache.delete(old);
      }
      pendingResults.push(result);
      continue;
    }
    if (body.active) { idle = 0; continue; }
    idle++;
    await sleep(pendingResults.length ? 0 : 500);
  }
}

export function startTaskLoop() {
  if (looping) return;
  looping = true;
  taskLoop()
    .catch((e) => logEvent('warn', 'fleet', `کارِ جابه‌جایی: ${e?.message || e}`))
    .finally(() => { looping = false; });
}

