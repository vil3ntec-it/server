// ---------------------------------------------------------------------------
//  «جابه‌جایی به کامپیوترِ دیگر» (۱.۵۰.۹۳) — ‎/api/move‎
//
//  ⛔ ساختنِ فایل و بازگرداندن روی نصبِ پُر: فقط مالک (مدیرِ دوم ۴۰۳ ‎owner_only‎ **پیش از** رمز) + احرازِ دوباره.
//     همان دو مرزِ «بازگرداندنِ پشتیبانِ پنل» (routes/backups.js): این فایل کلِ سرور است — کاربران، رازها، سرورِ حساب.
//  ⛔ نصبِ تازه (هنوز مدیری نیست): همان مرزِ «ساختنِ نخستین مدیر» (routes/auth.js ‎/setup‎) — از راهِ عمومیِ پراکسی
//     هرگز؛ از همین کامپیوتر بی کد؛ از دستگاهِ دیگرِ شبکه فقط با کدِ یک‌بارِ راه‌اندازی (کنسولِ سرور).
//  ⛔ رمزِ بسته هرگز در دفتر/لاگ/کار نمی‌نشیند. نامِ فایلِ روی دیسک را پنل می‌سازد؛ هیچ مسیری از کاربر نیست.
// ---------------------------------------------------------------------------
import express, { Router } from 'express';
import fs from 'node:fs';
import { requireAuth, requireRole, requireRecentAuth, isInitialized } from '../auth.js';
import { denyUnlessShellAllowed } from '../lib/shell-owner.js';
import { audit } from '../lib/audit.js';
import { deploy } from '../config.js';
import { viaProxy } from '../deploy.js';
import { isDirectLocal, checkSetupCode, hasSetupCode, issueSetupCode, clearSetupCode } from '../lib/setup-code.js';
import * as move from '../backup/move.js';

const router = Router();

const ownerOnly = (what) => (req, res, next) => (denyUnlessShellAllowed(req, res, what) ? next() : undefined);
const ownerChain = (what, { reauth = true } = {}) => [requireAuth, requireRole('admin'), ownerOnly(what), ...(reauth ? [requireRecentAuth] : [])];

function runChain(chain, req, res, done) {
  let i = 0;
  const step = (err) => {
    if (err) return done(err);
    const mw = chain[i++];
    if (!mw) return done();
    return mw(req, res, step);
  };
  step();
}

const SETUP_CODE_MESSAGE = 'روی نصبِ تازه، بازگرداندن از دستگاهی جز خودِ همین کامپیوتر فقط با «کدِ یک‌بارِ راه‌اندازی» است — '
  + 'همان که سرور هنگامِ بالا آمدن در کنسول/لاگِ خودش چاپ کرده. یا پنل را روی خودِ همین کامپیوتر باز کنید.';

/**
 * نصبِ پُر ⇒ مالک (+ احرازِ دوباره اگر `reauth`)؛ نصبِ تازه ⇒ مرزِ ‎/setup‎ (`code`: کدِ یک‌بار از دستگاهِ دیگر).
 * `req.moveMode` = ‎'owner' | 'fresh'‎
 */
function importGate({ reauth = true, code = true } = {}) {
  return (req, res, next) => {
    if (isInitialized()) {
      req.moveMode = 'owner';
      return runChain(ownerChain('panel.move.import', { reauth }), req, res, next);
    }
    if (deploy.panel.public && viaProxy(req)) {
      audit(req, 'panel.move.import', { ok: false, detail: { reason: 'public_path' } });
      return res.status(403).json({ error: 'setup_private_only', message: 'روی نصبِ تازه، بازگرداندن از راهِ عمومی نیست — از تونلِ SSH/Tailscale یا خودِ سرور.' });
    }
    if (code && !isDirectLocal(req)) {
      if (!hasSetupCode()) issueSetupCode();
      const r = checkSetupCode(req.get('x-setup-code') || req.body?.setupCode);
      if (!r.ok) {
        const error = r.reason === 'missing' ? 'setup_code_required' : 'setup_code_invalid';
        audit(req, 'panel.move.import', { ok: false, detail: { reason: error } });
        return res.status(403).json({ error, message: SETUP_CODE_MESSAGE });
      }
    }
    req.moveMode = 'fresh';
    return next();
  };
}

const actor = (req) => ({ id: req.user?.id ?? null, username: req.user?.username || null, mode: req.moveMode || 'owner' });

/** کار/بارگذاری مالِ همین درخواست‌کننده است؟ */
const sameActor = (by, req) => Boolean(by) && by.mode === (req.moveMode || 'owner') && (by.mode === 'fresh' || by.id === req.user?.id);

function sendError(res, e) {
  if (e?.status) {
    const extra = {};
    for (const k of ['max', 'received']) if (e[k] !== undefined) extra[k] = e[k];
    return res.status(e.status).json({ error: e.code, message: e.message, ...extra });
  }
  return res.status(500).json({ error: 'move_failed', message: String(e?.message || e).slice(0, 300) });
}

/* ─────────────────────────────── وضعیت ─────────────────────────────── */

router.get('/info', ...ownerChain('panel.move.export', { reauth: false }), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, ...move.moveInfo() });
});

/**
 * بی ورود (صفحهٔ ورود پس از راه‌اندازیِ دوباره): فقط «آیا نصبِ تازه است» و خلاصهٔ بی‌نامِ آخرین بازگردانی تا
 * ۳۰ دقیقه پس از آن — نه نامِ فایل، نه نشانیِ پوشه، نه متنِ اختلاف‌ها.
 */
router.get('/public', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const last = move.lastImport();
  const fresh = last && Date.now() - Date.parse(last.at) < 30 * 60 * 1000;
  res.json({
    initialized: isInitialized(),
    pending: move.pendingImport(),
    lastImport: fresh ? {
      at: last.at,
      ok: Boolean(last.ok),
      same: Boolean(last.compare?.same),
      diffs: last.compare?.diffs?.length || 0,
      files: last.summary?.files || 0,
      tables: last.summary?.tables || 0,
      account: Boolean(last.account?.reconciled),
    } : null,
  });
});

router.get('/jobs/:id', (req, res, next) => {
  const by = move.jobOwner(req.params.id);
  if (!by) return res.status(404).json({ error: 'job_not_found' });
  res.setHeader('Cache-Control', 'no-store');
  //  نصبِ تازه: شناسهٔ ۱۲۸بیتیِ کار خودش کلید است (هیچ رازی در وضعیت نیست)
  if (by.mode === 'fresh') return res.json({ ok: true, job: move.jobView(req.params.id) });
  return runChain(ownerChain(by.kind === 'export' ? 'panel.move.export' : 'panel.move.import', { reauth: false }), req, res, (err) => {
    if (err) return next(err);
    if (by.id !== req.user?.id) return res.status(404).json({ error: 'job_not_found' });
    return res.json({ ok: true, job: move.jobView(req.params.id) });
  });
});

/* ─────────────────────────────── export ─────────────────────────────── */

router.post('/export', ...ownerChain('panel.move.export'), (req, res) => {
  try {
    const job = move.startExport({ pass: req.body?.passphrase, include: req.body?.include || {}, by: actor(req) });
    audit(req, 'panel.move.export', { target: job.id, detail: { backups: req.body?.include?.backups === true } });
    res.json({ ok: true, job: move.jobView(job.id) });
  } catch (e) {
    if (e?.code === 'passphrase_too_short') audit(req, 'panel.move.export', { ok: false, detail: { reason: e.code } });
    sendError(res, e);
  }
});

//  پیوندِ دانلود سرآیندِ Authorization ندارد ⇒ بلیتِ یک‌بارِ ‎/api/auth/ticket‎ (requireAuth همان را می‌پذیرد)
router.get('/export/:id/download', ...ownerChain('panel.move.export', { reauth: false }), (req, res) => {
  const m = move.exportFile(req.params.id, req.user?.id);
  if (!m) return res.status(404).json({ error: 'export_not_found', message: 'این فایل دیگر روی سرور نیست — دوباره بسازید.' });
  audit(req, 'panel.move.download', { target: req.params.id, detail: { size: m.size } });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(m.size));
  res.setHeader('Content-Disposition', `attachment; filename="${m.name}"`);
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(m.file).on('error', () => res.destroy()).pipe(res);
});

router.delete('/export/:id', ...ownerChain('panel.move.export', { reauth: false }), (req, res) => {
  const m = move.exportFile(req.params.id, req.user?.id);
  if (!m) return res.status(404).json({ error: 'export_not_found' });
  move.dropExport(req.params.id);
  res.json({ ok: true });
});

/* ─────────────────────────────── import ─────────────────────────────── */

const FORCE_MESSAGE = 'این سرور از پیش داده دارد. با بازگرداندن، دادهٔ فعلی کنار گذاشته می‌شود (پاک نمی‌شود) و دادهٔ فایل جایش می‌نشیند — تأییدش کنید.';

router.post('/import/begin', importGate(), (req, res) => {
  if (req.moveMode === 'owner' && req.body?.force !== true) return res.status(409).json({ error: 'force_required', message: FORCE_MESSAGE });
  try {
    const r = move.beginUpload({ size: req.body?.size, by: actor(req) });
    res.json({ ok: true, ...r, mode: req.moveMode });
  } catch (e) { sendError(res, e); }
});

//  ⛔ مرز پیش از خواندنِ بدنه — ناشناس نمی‌تواند پنل را وادار به نگه‌داشتنِ ۸ مگابایت کند
router.put('/import/:id/chunk',
  importGate({ reauth: false, code: false }),
  (req, res, next) => {
    const u = move.uploadOf(req.params.id);
    if (!u || !sameActor(u.by, req)) return res.status(404).json({ error: 'upload_not_found' });
    return next();
  },
  express.raw({ type: () => true, limit: move.CHUNK_BYTES + 1024 }),
  (req, res) => {
    try {
      res.json({ ok: true, ...move.receiveChunk({ id: req.params.id, offset: Number(req.query.offset), body: req.body }) });
    } catch (e) { sendError(res, e); }
  });

router.post('/import/start', importGate(), (req, res) => {
  if (req.moveMode === 'owner' && req.body?.force !== true) return res.status(409).json({ error: 'force_required', message: FORCE_MESSAGE });
  const u = move.uploadOf(req.body?.uploadId);
  if (!u || !sameActor(u.by, req)) return res.status(404).json({ error: 'upload_not_found', message: 'فایل پیدا نشد — دوباره انتخابش کنید.' });
  try {
    const fresh = req.moveMode === 'fresh';
    const job = move.startImport({ uploadId: u.id, pass: req.body?.passphrase, by: actor(req), onReady: fresh ? () => clearSetupCode() : null });
    audit(req, 'panel.move.import', { target: job.id, detail: { mode: req.moveMode, size: u.size } });
    res.json({ ok: true, job: move.jobView(job.id) });
  } catch (e) {
    if (e?.code === 'passphrase_too_short') audit(req, 'panel.move.import', { ok: false, detail: { reason: e.code } });
    sendError(res, e);
  }
});

export default router;
