// ---------------------------------------------------------------------------
//  مسیرهای Process Manager
//
//      viewer     فهرست را می‌بیند
//      admin      می‌تواند سیگنال بفرستد
//
//  چرا کشتن مستقیم به admin رفت و به operator نه: operator در بقیهٔ پنل
//  چیزهایی را دست می‌زند که پنل خودش ساخته و می‌تواند دوباره بسازدشان.
//  یک پروسهٔ دلخواهِ سیستم چنین چیزی نیست — کشته که شد، رفته.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../lib/audit.js';
import { list, kill, summary } from '../system/processes.js';

const router = Router();
router.use(requireAuth);

function send(res, result) {
  if (result.ok) return res.json(result);
  const status =
    ['invalid_pid', 'invalid_signal'].includes(result.error) ? 400
      : result.error === 'protected_pid' ? 409
        : result.error === 'not_found' ? 404
          : result.error === 'forbidden_by_os' ? 403
            : result.error === 'ps_failed' ? 503
              : 500;
  return res.status(status).json(result);
}

router.get('/', async (req, res) => {
  send(res, await list({
    query: req.query.q,
    sort: String(req.query.sort || 'cpu'),
    limit: req.query.limit,
  }));
});

router.get('/summary', async (req, res) => {
  res.json(await summary());
});

router.post('/:pid/kill', requireWriteRole('admin'), (req, res) => {
  const { pid } = req.params;
  const signal = String(req.body?.signal || 'TERM');
  const result = kill(pid, signal);

  audit(req, 'process.kill', {
    target: String(pid),
    ok: result.ok,
    detail: { signal, ...(result.ok ? {} : { error: result.error }) },
  });

  send(res, result);
});

export default router;
