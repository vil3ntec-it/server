// ---------------------------------------------------------------------------
//  «سرورهای من» (۱.۵۰.۹۴) — ‎/api/fleet‎ (مالک) و ‎/api/fleet/hub‎ (گره‌ها)
//
//  ⛔ هر کارِ مالک: همان زنجیرِ «جابه‌جایی» (routes/move.js) — requireAuth ⇒ admin ⇒ **فقط مالک** (مدیرِ دوم ۴۰۳
//     ‎owner_only‎ پیش از رمز) ⇒ احرازِ دوباره برای هر تغییر (کد، نگه‌داری، جدا کردن، وصل/جدا شدن). دیدنِ فهرست
//     هم فقط مالک (بی احرازِ دوباره).
//  ⛔ ‎node scripts/join.mjs‎ با **کلیدِ محلیِ همین کامپیوتر** (‎data/local-admin.key‎، فقط از لوپ‌بک) وصل/جدا می‌کند —
//     همان «دسترسیِ ماشین = مالک» ِ ‎lib/shell-owner.js‎ و ‎vill3n owner-reset‎؛ هیچ درِ دیگری کلیدِ محلی نمی‌پذیرد.
//  ⛔ ‎/api/fleet/hub/*‎ بی ورود است ولی هر پیام امضای Ed25519 دارد (src/fleet/hub.js)؛ روی درِ عمومی (‎api/public.js‎) هم
//     سوار است تا گرهٔ بیرون از خانه از راهِ تونل به مرکز برسد. سقفِ نرخِ هر IP + دفتر برای ردها (با فاصله).
//  ⛔ کدِ وصل فقط یک بار در پاسخِ «افزودنِ سرور» برمی‌گردد (‎no-store‎) — نه در دفتر، نه در لاگ، نه در فهرست.
// ---------------------------------------------------------------------------
import express, { Router } from 'express';
import { requireAuth, requireRole, requireRecentAuth } from '../auth.js';
import { requireLocalOrAuth } from '../local-key.js';
import { denyUnlessShellAllowed } from '../lib/shell-owner.js';
import { audit } from '../lib/audit.js';
import { rateLimit, clientIp } from '../lib/rate-limit.js';
import * as hub from '../fleet/hub.js';
import * as node from '../fleet/node.js';
import { maintenanceState, enterMaintenance, exitMaintenance } from '../fleet/maintenance.js';
import * as placement from '../fleet/placement.js';
import { CHUNK_BYTES } from '../fleet/mover.js';

const router = Router();

const ownerOnly = (what) => (req, res, next) => (denyUnlessShellAllowed(req, res, what) ? next() : undefined);
const ownerChain = (what, { reauth = true } = {}) => [requireAuth, requireRole('admin'), ownerOnly(what), ...(reauth ? [requireRecentAuth] : [])];

/** کلیدِ محلیِ همین کامپیوتر (ابزارِ خطِ فرمان) یا زنجیرِ مالک با احرازِ دوباره */
function localOrOwner(what) {
  const chain = [requireRole('admin'), ownerOnly(what), requireRecentAuth];
  return [requireLocalOrAuth, (req, res, next) => {
    if (req.user?.local) return next();
    let i = 0;
    const step = (err) => {
      if (err) return next(err);
      const mw = chain[i++];
      return mw ? mw(req, res, step) : next();
    };
    return step();
  }];
}

function sendError(res, e) {
  if (e instanceof hub.FleetError) {
    const extra = {};
    if (e.serverTime !== undefined) extra.serverTime = e.serverTime;
    if (e.burned) extra.burned = true;
    if (e.received !== undefined) extra.received = e.received;
    return res.status(e.status).json({ error: e.code, message: e.message, ...extra });
  }
  return res.status(500).json({ error: 'fleet_failed', message: String(e?.message || e).slice(0, 300) });
}

const actorName = (req) => (req.user?.local ? 'local-key' : req.user?.username || null);
const onFlag = (v) => v === true || v === 'true' || v === 1;

/* ─────────────────────────────── دیدن ─────────────────────────────── */

router.get('/', ...ownerChain('panel.fleet', { reauth: false }), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const role = hub.isNode() ? 'node' : 'center';
    const overview = await hub.fleetOverview();
    //  (۱.۵۰.۹۵) جدولِ «جا» و کارهای جابه‌جایی فقط روی مرکز
    const extra = role === 'center' ? { placement: placement.placementView(overview), moves: placement.movesView() } : { placement: [], moves: [] };
    res.json({ ok: true, role, ...overview, ...extra, node: node.nodeStatus(), maintenance: maintenanceState() });
  } catch (e) { sendError(res, e); }
});

/* ─────────────────────────────── مرکز ─────────────────────────────── */

router.post('/codes', ...ownerChain('panel.fleet.code'), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const c = hub.issueJoinCode(req.user?.username);
    audit(req, 'panel.fleet.code', { target: c.id, detail: { ttlMs: c.ttlMs } });
    res.json({ ok: true, code: c.code, expiresAt: c.expiresAt, ttlMs: c.ttlMs });
  } catch (e) { sendError(res, e); }
});

router.post('/nodes/:id/maintenance', ...ownerChain('panel.fleet.maintenance'), (req, res) => {
  try {
    const r = hub.setNodeMaintenance(req.params.id, onFlag(req.body?.on), req.user?.username);
    audit(req, 'panel.fleet.maintenance', { target: r.id, detail: { name: r.name, on: r.maintenance } });
    res.json({ ok: true, ...r });
  } catch (e) { sendError(res, e); }
});

router.post('/nodes/:id/revoke', ...ownerChain('panel.fleet.revoke'), (req, res) => {
  try {
    const r = hub.revokeNode(req.params.id, req.user?.username);
    audit(req, 'panel.fleet.revoke', { target: r.id, detail: { name: r.name } });
    res.json({ ok: true, ...r });
  } catch (e) { sendError(res, e); }
});

/** نگه‌داریِ خودِ مرکز — روی گره این کار مالِ مرکز است */
router.post('/self/maintenance', ...ownerChain('panel.fleet.maintenance'), async (req, res) => {
  if (hub.isNode()) return res.status(409).json({ error: 'node_managed_by_center', message: 'این سرور گرهٔ یک مرکز است؛ روشن/خاموشش از «سرورهای من» ِ همان مرکز است.' });
  if (hub.hooks.busyNode('self')) return res.status(409).json({ error: 'move_in_progress', message: 'همین مرکز در یک کارِ جابه‌جایی است — تا پایانش روشن/خاموش نمی‌شود.' });
  const on = onFlag(req.body?.on);
  try {
    const r = on ? await enterMaintenance('self') : await exitMaintenance('self');
    audit(req, 'panel.fleet.maintenance', { target: 'self', detail: { on } });
    res.json({ ok: true, maintenance: maintenanceState(), result: r });
  } catch (e) { sendError(res, e); }
});

/* ─────────────── «این برنامه روی کدام سرور» (۱.۵۰.۹۵) ───────────────
 *  ⛔ فقط مالک (مدیرِ دوم ۴۰۳ پیش از رمز) + احرازِ دوباره + تأییدِ صریح با نامِ برنامه و دو سرور (`placement.startMove`).
 *  ⛔ کلیدِ بسته هرگز در پاسخ، دفتر یا لاگ نیست — فقط شناسهٔ کار.
 */
router.post('/moves', ...ownerChain('panel.fleet.move'), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const b = req.body || {};
  const detail = { app: String(b.app || '').slice(0, 120), from: String(b.from || '').slice(0, 64), to: String(b.to || '').slice(0, 64) };
  try {
    const r = await placement.startMove({ app: b.app, from: b.from, to: b.to, confirm: b.confirm || {}, by: req.user?.username });
    audit(req, 'panel.fleet.move', { target: r.id, detail });
    res.json({ ok: true, move: placement.moveView(r.id) });
  } catch (e) {
    audit(req, 'panel.fleet.move', { ok: false, detail: { ...detail, reason: e?.code || 'failed' } });
    sendError(res, e);
  }
});

router.get('/moves/:id', ...ownerChain('panel.fleet', { reauth: false }), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const m = placement.moveView(req.params.id);
  if (!m) return res.status(404).json({ error: 'move_not_found' });
  res.json({ ok: true, move: m });
});

/* ─────────────────────────────── گره ─────────────────────────────── */

router.post('/link', ...localOrOwner('panel.fleet.join'), async (req, res) => {
  try {
    const r = await node.joinCenter({ center: req.body?.center, code: req.body?.code, name: req.body?.name, kind: req.body?.kind, by: actorName(req) });
    audit(req, 'panel.fleet.join', { target: r.link?.centerUrl, detail: { nodeId: r.link?.nodeId } });
    res.json(r);
  } catch (e) {
    audit(req, 'panel.fleet.join', { ok: false, detail: { reason: e?.code || 'failed' } });
    sendError(res, e);
  }
});

router.delete('/link', ...localOrOwner('panel.fleet.leave'), async (req, res) => {
  try {
    const r = await node.leaveCenter();
    audit(req, 'panel.fleet.leave', { detail: { centerNotified: r.centerNotified } });
    res.json(r);
  } catch (e) { sendError(res, e); }
});

/* ─────────────────────────────── درِ گره‌ها (بی ورود، امضاشده) ─────────────────────────────── */

export const hubRouter = Router();

//  ⛔ ردها در دفتر — هر (IP، دلیل) دستِ‌بالا یک بار در دقیقه، تا رگبارِ امضای جعلی دفتر را پر نکند
const lastAudit = new Map();
function auditReject(req, action, code) {
  const k = `${clientIp(req)}|${action}|${code}`;
  const t = Date.now();
  if (t - (lastAudit.get(k) || 0) < 60 * 1000) return;
  if (lastAudit.size > 2000) lastAudit.clear();
  lastAudit.set(k, t);
  audit(req, action, { ok: false, target: typeof req.body?.node === 'string' ? req.body.node.slice(0, 64) : null, detail: { reason: code } });
}

hubRouter.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

hubRouter.post('/join', rateLimit('fleet-join', Number(process.env.HLP_RATE_FLEET_JOIN || 20), 10 * 60 * 1000), (req, res) => {
  try {
    const r = hub.joinNode(req.body, { ip: clientIp(req) });
    audit(req, 'panel.fleet.node_joined', { target: r.node.id, detail: { name: r.node.name, kind: r.node.kind } });
    res.json({ ok: true, reply: r.reply });
  } catch (e) {
    auditReject(req, 'panel.fleet.node_joined', e?.code || 'failed');
    sendError(res, e);
  }
});

function signedRoute(fn, action) {
  return (req, res) => {
    try {
      res.json({ ok: true, ...fn(req.body, { ip: clientIp(req) }) });
    } catch (e) {
      auditReject(req, action, e?.code || 'failed');
      if (e?.code === 'node_revoked' && e.reply) return res.status(403).json({ error: e.code, message: e.message, reply: e.reply });
      sendError(res, e);
    }
  };
}

hubRouter.post('/heartbeat', rateLimit('fleet-heartbeat', Number(process.env.HLP_RATE_FLEET_HEARTBEAT || 600), 60 * 1000), signedRoute(hub.heartbeat, 'panel.fleet.heartbeat'));
hubRouter.post('/leave', rateLimit('fleet-leave', 60, 10 * 60 * 1000), signedRoute(hub.leave, 'panel.fleet.node_left'));

//  (۱.۵۰.۹۵) کارِ جابه‌جایی: گره فرمان می‌گیرد/نتیجه می‌دهد (مرکز تا ۱۰ ثانیه نگه می‌دارد اگر فرمانی نیست)
hubRouter.post('/task', rateLimit('fleet-task', Number(process.env.HLP_RATE_FLEET_TASK || 1200), 60 * 1000), async (req, res) => {
  try {
    const { env, node: n } = hub.authenticate(req.body, 'task');
    const r = await placement.taskPoll(n.id, env.body);
    res.json({ ok: true, reply: hub.signedReply(n.id, env.nonce, { ok: true, ...r }) });
  } catch (e) {
    auditReject(req, 'panel.fleet.task', e?.code || 'failed');
    sendError(res, e);
  }
});

/** تکهٔ بسته ⇒ مرکز: بدنهٔ خام، پاکتِ امضاشده (با sha256 ِ همین تکه) در سرآیندِ ‎X-Fleet-Envelope‎ */
hubRouter.post('/chunk', rateLimit('fleet-chunk', Number(process.env.HLP_RATE_FLEET_CHUNK || 600), 60 * 1000),
  express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES + 1024 }), (req, res) => {
    try {
      let raw = null;
      try { raw = JSON.parse(Buffer.from(String(req.get('x-fleet-envelope') || ''), 'base64url').toString('utf8')); } catch { raw = null; }
      const { env, node: n } = hub.authenticate(raw, 'chunk');
      const r = placement.receiveChunk(n.id, env.body, req.body);
      res.json({ ok: true, reply: hub.signedReply(n.id, env.nonce, { ok: true, ...r }) });
    } catch (e) {
      auditReject(req, 'panel.fleet.chunk', e?.code || 'failed');
      sendError(res, e);
    }
  });

/** تکهٔ بسته ⇒ مقصد (مقصد هر تکه را با فهرستِ امضاشدهٔ فرمانِ import می‌سنجد) */
hubRouter.post('/chunk/get', rateLimit('fleet-chunk-get', Number(process.env.HLP_RATE_FLEET_CHUNK || 600), 60 * 1000), (req, res) => {
  try {
    const { env, node: n } = hub.authenticate(req.body, 'chunk-get');
    const buf = placement.chunkFor(n.id, env.body);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(buf);
  } catch (e) {
    auditReject(req, 'panel.fleet.chunk', e?.code || 'failed');
    sendError(res, e);
  }
});

hubRouter.use((req, res) => res.status(404).json({ error: 'not_found' }));

export default router;
