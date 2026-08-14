// ---------------------------------------------------------------------------
//  API کنترلِ دستیارِ پشتیبانی — فقط از پنل و با حسابِ مدیر
//
//  این مسیرها روی پورتِ **پنل** نصب می‌شوند، نه روی پورتِ عمومی. یعنی از
//  اینترنت در دسترس نیستند؛ فقط کسی که به پنل وارد شده می‌تواند دستیار را
//  روشن/خاموش کند یا لاگش را ببیند.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import { aiStatus, aiLogs, startAi, stopAi, restartAi, resolveAiDir } from '../ai/supervisor.js';
import { config } from '../config.js';

const router = Router();
router.use(requireAuth);

/** وضعیت: نصب هست؟ روشن است؟ چند بار افتاده؟ */
router.get('/status', (req, res) => {
  res.json(aiStatus());
});

/** آخرین سطرهای لاگِ خودِ سرویس */
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  res.json({ lines: aiLogs(limit) });
});

router.post('/start', (req, res) => {
  const out = startAi();
  res.status(out.ok ? 200 : 400).json(out);
});

router.post('/stop', (req, res) => {
  res.json(stopAi());
});

router.post('/restart', async (req, res) => {
  res.json(await restartAi());
});

/**
 * سلامتِ خودِ سرویس — از داخلِ سرور صدا زده می‌شود تا معلوم شود مدل هم
 * بالاست یا فقط پروسه روشن است.
 */
router.get('/health', async (req, res) => {
  if (!resolveAiDir()) return res.status(404).json({ error: 'پوشهٔ ai-support پیدا نشد' });
  try {
    const r = await fetch(`http://127.0.0.1:${config.aiPort}/ai/support/health`, {
      signal: AbortSignal.timeout(5000),
    });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(503).json({ error: 'سرویس جواب نداد', detail: e.message });
  }
});

export default router;
