// ---------------------------------------------------------------------------
//  مسیرهای کارهای زمان‌بندی‌شده
//
//      viewer     فهرست و تاریخچه را می‌بیند
//      admin      می‌سازد، عوض می‌کند، حذف می‌کند و دستی اجرا می‌کند
//
//  چرا admin و نه operator: یک کارِ زمان‌بندی‌شده هر دقیقه هر فرمانی را روی
//  سرور اجرا می‌کند — همان قدرتِ ترمینال، ولی خودکار و بدونِ ناظر. پس همان
//  مرزِ ترمینال را دارد.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../lib/audit.js';
import { run as execCmd } from '../lib/exec.js';
import { list, get, create, update, remove, runs, execute, nextRunAt, parseSchedule } from '../system/cron.js';

const router = Router();
router.use(requireAuth);

function send(res, result) {
  if (result.ok) return res.json(result);
  const status =
    result.error === 'not_found' ? 404
      : result.error === 'already_running' ? 409
        : 400;
  return res.status(status).json(result);
}

router.get('/', (req, res) => {
  res.json(list());
});

/** پیش‌نمایشِ الگو — تا کاربر پیش از ذخیره ببیند واقعاً کِی اجرا می‌شود */
router.post('/preview', (req, res) => {
  const parsed = parseSchedule(req.body?.schedule);
  if (!parsed.ok) return send(res, parsed);

  const times = [];
  let cursor = new Date();
  for (let i = 0; i < 5; i++) {
    const at = nextRunAt(parsed.normalized, cursor);
    if (!at) break;
    times.push(at);
    cursor = new Date(at + 1000);
  }
  res.json({ ok: true, normalized: parsed.normalized, next: times });
});

router.post('/', requireWriteRole('admin'), (req, res) => {
  const result = create({ ...req.body, actor: req.user?.username || null });
  audit(req, 'cron.create', { target: String(req.body?.name || ''), ok: result.ok, detail: result.ok ? { schedule: result.job.schedule } : result });
  send(res, result);
});

router.patch('/:id', requireWriteRole('admin'), (req, res) => {
  const result = update(req.params.id, req.body || {});
  audit(req, 'cron.update', { target: req.params.id, ok: result.ok });
  send(res, result);
});

router.delete('/:id', requireWriteRole('admin'), (req, res) => {
  const result = remove(req.params.id);
  audit(req, 'cron.delete', { target: req.params.id, ok: result.ok });
  send(res, result);
});

router.get('/:id/runs', (req, res) => {
  if (!get(req.params.id)) return send(res, { ok: false, error: 'not_found' });
  res.json(runs(req.params.id, req.query.limit));
});

router.post('/:id/run', requireWriteRole('admin'), async (req, res) => {
  const job = get(req.params.id);
  if (!job) return send(res, { ok: false, error: 'not_found' });

  audit(req, 'cron.run', { target: `${job.id}:${job.name}` });
  send(res, await execute(req.params.id, { reason: 'manual' }));
});

/**
 * crontabِ سیستم — فقط‌خواندنی.
 *
 * پنل آن را نمی‌نویسد (دلیلش در مهاجرتِ ۰۰۴ نوشته شده)، ولی نشان دادنش لازم
 * است: وگرنه کاربری که یک کار را در crontab دارد، این‌جا نمی‌بیندش و فکر
 * می‌کند پاک شده.
 */
router.get('/system/crontab', requireWriteRole('admin'), async (req, res) => {
  if (process.platform === 'win32') {
    return res.json({ ok: true, supported: false, lines: [] });
  }
  const result = await execCmd('crontab', ['-l'], { timeout: 5000 });
  const lines = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  res.json({ ok: true, supported: true, lines });
});

export default router;
