// ---------------------------------------------------------------------------
//  API زیرساخت — همان چیزی که دستورِ «vill3n» روی خودِ سرور صدا می‌زند
//
//  با کلیدِ محلی (بی رمز، فقط از همین کامپیوتر) یا با حسابِ پنل. کارهایی که
//  چیزی را عوض می‌کنند (تعمیر، پشتیبان، روشن/خاموشِ دستیار) برای حسابِ پنل
//  فقط admin؛ برنامهٔ محلی خودش admin شمرده می‌شود (همان قاعدهٔ local-key.js).
//  همه در دفترِ کارهای حساس می‌نشینند.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireLocalOrAuth } from '../local-key.js';
import { audit } from '../lib/audit.js';
import { userRole, roleAtLeast } from '../auth.js';
import { checkDependencies, repair } from '../platform/selfheal.js';
import { createBackup as createLibraryBackup } from '../storage/backup.js';
import { createBackup as createDbBackup } from '../backup/index.js';
import { backupStatus, restoreTest, rotate, offsitePush } from '../backup/rotation.js';
import { healthPayload, readyPayload } from '../platform/health.js';
import { accountStatus } from '../account/supervisor.js';
import { probeAccountServer } from '../api/account-proxy.js';
import { publicState as tunnelState } from '../tunnel.js';
import * as guard from '../agent/guard.js';
import { config } from '../config.js';

const router = Router();
router.use(requireLocalOrAuth);

function adminOnly(req, res, next) {
  if (req.user?.local) return next();
  if (req.user?.id && roleAtLeast(userRole(req.user.id), 'admin')) return next();
  return res.status(403).json({ error: 'forbidden', needed: 'admin' });
}

/** یک نگاه: پنل، دیتابیس، سرورِ حساب، تونل، دستیار، پشتیبان‌ها */
router.get('/status', async (req, res) => {
  const acct = accountStatus();
  const probe = await probeAccountServer().catch((e) => ({ up: false, error: e.message }));
  let tunnel = null;
  try { tunnel = tunnelState(); } catch { /* تونل خاموش */ }
  res.json({
    ok: true,
    panel: { ...healthPayload(), port: config.port, publicPort: config.siteSync.port, domains: config.domains || null },
    ready: readyPayload(),
    accountServer: { enabled: acct.enabled, installed: acct.installed, running: acct.running, restarts: acct.restarts, lastError: acct.lastError, up: !!probe.up, version: probe.version || null },
    tunnel: tunnel ? { status: tunnel.status, url: tunnel.url, mode: tunnel.mode, installed: tunnel.installed, error: tunnel.error } : null,
    agent: config.agent?.enabled ? guard.guardStatus() : { enabled: false },
    backups: await backupStatus(),
  });
});

// ── خودترمیمی ────────────────────────────────────────────────────────────
router.get('/selfheal', async (req, res) => res.json({ ok: true, ...(await checkDependencies()) }));

router.post('/selfheal/repair', adminOnly, async (req, res) => {
  const result = await repair({ runInstaller: req.body?.installer !== false });
  audit(req, 'selfheal.repair', { ok: result.ok, detail: `${result.repaired?.length || 0} درست شد، ${result.skipped?.length || 0} ماند` });
  res.json({ ok: true, ...result });
});

// ── پشتیبان ──────────────────────────────────────────────────────────────
/** هر دو دفتر با هم: کتابخانه (رمزشده + صف) و VACUUM INTOی دیتابیسِ پنل */
router.post('/backup', adminOnly, async (req, res) => {
  const note = req.body?.note ? String(req.body.note).slice(0, 200) : 'از vill3n';
  const library = await createLibraryBackup({ kind: req.body?.kind || 'Manual', note });
  let dbBackup = null;
  try { dbBackup = createDbBackup({ reason: 'manual', note }); } catch (e) { dbBackup = { ok: false, error: e.message }; }
  audit(req, 'backup.create', { target: library.folder || null, ok: library.ok });
  if (!library.ok) return res.status(400).json({ ...library, db: dbBackup });
  res.json({ ok: true, library, db: dbBackup });
});

router.get('/backup', async (req, res) => res.json({ ok: true, ...(await backupStatus()) }));

router.post('/backup/restore-test', adminOnly, async (req, res) => {
  const result = await restoreTest();
  audit(req, 'backup.restoreTest', { ok: result.ok, target: result.backup });
  res.json({ ok: true, result });
});

router.post('/backup/rotate', adminOnly, async (req, res) => res.json({ ok: true, result: await rotate() }));
router.post('/backup/offsite', adminOnly, async (req, res) => res.json({ ok: true, result: await offsitePush() }));

// ── دستیار ───────────────────────────────────────────────────────────────
router.post('/agent', adminOnly, async (req, res) => {
  if (!config.agent?.enabled) return res.status(409).json({ ok: false, error: 'agent_disabled', message: 'دستیار با HLP_AGENT=0 از پنل برداشته شده' });
  const on = req.body?.on !== false;
  if (on) guard.powerOn(); else await guard.powerOff();
  audit(req, on ? 'agent.on' : 'agent.off');
  res.json({ ok: true, ...guard.guardStatus() });
});

export default router;
