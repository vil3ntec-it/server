// ---------------------------------------------------------------------------
//  مسیرهای موتورِ اتوماسیون — فقط پورتِ پنل
//
//      هر واردشده   فهرستِ کارها، تاریخچه، رویدادها
//      admin        روشن/خاموش و اجرای دستی — هر دو در دفترِ حسابرسی
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../lib/audit.js';
import * as engine from '../automation/engine.js';
import { recentEvents, KNOWN_EVENTS } from '../automation/events.js';
import { automationEnabled } from '../automation/index.js';

const router = Router();
router.use(requireAuth);

router.get('/status', (req, res) => {
  res.json({ ok: true, enabled: automationEnabled, ...engine.engineStatus(), events: KNOWN_EVENTS });
});

router.get('/jobs', (req, res) => {
  res.json({ ok: true, enabled: automationEnabled, items: engine.listJobs() });
});

router.get('/runs', (req, res) => {
  res.json({ ok: true, items: engine.recentRuns({ limit: req.query.limit, all: req.query.all === '1' }) });
});

router.get('/runs/:id', (req, res) => {
  const run = engine.getRun(req.params.id);
  if (!run) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, run });
});

router.get('/events', (req, res) => {
  res.json({ ok: true, items: recentEvents({ limit: req.query.limit, name: req.query.name || null }), known: KNOWN_EVENTS });
});

router.get('/jobs/:name', (req, res) => {
  const job = engine.listJobs().find((j) => j.name === req.params.name);
  if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, job });
});

router.get('/jobs/:name/runs', (req, res) => {
  if (!engine.getJob(req.params.name)) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, items: engine.listRuns(req.params.name, { limit: req.query.limit }) });
});

router.patch('/jobs/:name', requireWriteRole('admin'), (req, res) => {
  if (req.body?.enabled === undefined) return res.status(400).json({ ok: false, error: 'enabled_required' });
  const job = engine.setEnabled(req.params.name, Boolean(req.body.enabled));
  audit(req, 'automation.toggle', { target: req.params.name, ok: Boolean(job), detail: { enabled: Boolean(req.body.enabled) } });
  if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, job });
});

router.post('/jobs/:name/run', requireWriteRole('admin'), async (req, res) => {
  const def = engine.getJob(req.params.name);
  if (!def) return res.status(404).json({ ok: false, error: 'not_found' });
  // خودِ موتور قفل را می‌سنجد و اجرای رد‌شده را هم «skipped» ثبت می‌کند —
  // این‌جا پیش‌سنجی نمی‌کنیم تا هیچ تلاشی بی ثبت نماند
  const result = await engine.runJob(def.name, { trigger: 'manual', payload: req.body?.payload ?? null });
  audit(req, 'automation.run', { target: def.name, ok: result.error !== 'already_running', detail: result.error === 'already_running' ? 'already_running' : { status: result.status, runId: result.runId } });
  if (result.error === 'already_running') return res.status(409).json(result);
  res.json({ ...result, job: engine.listJobs().find((j) => j.name === def.name) });
});

export default router;
