// ---------------------------------------------------------------------------
//  مسیرهای نسخه‌های Node و Python
//
//      viewer     نسخه‌های موجود را می‌بیند
//      admin      نصب و حذف می‌کند
//
//  نصب دانلود از اینترنت است و چند ده مگابایت می‌گیرد؛ عمداً به admin محدود
//  شده تا هر کسی نتواند دیسکِ سرور را پر کند.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../lib/audit.js';
import {
  listNode, installNode, removeNode, npmVersionFor,
  listPython, createVenv, downloadUrlFor, normalizeVersion,
} from '../system/runtimes.js';

const router = Router();
router.use(requireAuth);

function send(res, result) {
  if (result.ok) return res.json(result);
  const status =
    ['invalid_version', 'invalid_path', 'invalid_name'].includes(result.error) ? 400
      : result.error === 'already_installed' ? 409
        : result.error === 'not_found' ? 404
          : result.error === 'unsupported_platform' ? 501
            : 500;
  return res.status(status).json(result);
}

router.get('/node', async (req, res) => {
  const list = await listNode();
  if (!list.ok) return send(res, list);

  // نسخهٔ npm فقط برای نسخهٔ در حالِ اجرا خوانده می‌شود؛ برای هر نسخه یک
  // اجرای جداگانه است و صفحه را کند می‌کند
  const current = list.items.find((i) => i.current);
  const npm = current ? await npmVersionFor(current.binary) : null;

  res.json({ ...list, npm, platformSupported: Boolean(downloadUrlFor('v22.0.0')) });
});

router.post('/node/install', requireWriteRole('admin'), async (req, res) => {
  const version = normalizeVersion(req.body?.version);
  if (!version) return send(res, { ok: false, error: 'invalid_version' });

  const result = await installNode(version);
  audit(req, 'runtime.node.install', { target: version, ok: result.ok, detail: result.ok ? null : result });
  send(res, result);
});

router.delete('/node/:version', requireWriteRole('admin'), async (req, res) => {
  const result = await removeNode(req.params.version);
  audit(req, 'runtime.node.remove', { target: req.params.version, ok: result.ok });
  send(res, result);
});

router.get('/python', async (req, res) => {
  send(res, await listPython());
});

router.post('/python/venv', requireWriteRole('operator'), async (req, res) => {
  const { python, dir, name } = req.body || {};
  const result = await createVenv(String(python || 'python3'), String(dir || ''), { name: String(name || '.venv') });
  audit(req, 'runtime.python.venv', { target: String(dir || ''), ok: result.ok });
  send(res, result);
});

export default router;
