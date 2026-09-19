// ---------------------------------------------------------------------------
//  API کنترلِ سرورِ حساب — فقط از پنل و با حسابِ مدیر
//
//  همان الگوی routes/ai.js: روی پورتِ **پنل**، نه پورتِ عمومی. یعنی از
//  اینترنت در دسترس نیست؛ فقط کسی که به پنل وارد شده می‌تواند سرورِ حساب را
//  روشن/خاموش کند یا لاگش را ببیند.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth } from '../auth.js';
import {
  accountStatus, accountLogs, startAccountServer, stopAccountServer, restartAccountServer,
} from '../account/supervisor.js';
import { probeAccountServer } from '../api/account-proxy.js';
import { cloudStatus } from '../stations/cloud.js';

const router = Router();
router.use(requireAuth);

/** وضعیت: نصب هست؟ روشن است؟ چند بار افتاده؟ و خودِ سرور جواب می‌دهد؟ */
router.get('/status', async (req, res) => {
  const st = accountStatus();
  const probe = await probeAccountServer().catch((e) => ({ up: false, error: e.message }));
  let bridge = null;
  try { bridge = cloudStatus(); } catch { /* گاوصندوق بسته */ }
  res.json({ ...st, up: !!probe.up, version: probe.version || null, url: probe.url || null, bridge });
});

/** آخرین سطرهای لاگِ خودِ سرورِ حساب */
router.get('/logs', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  res.json({ lines: accountLogs(limit) });
});

router.post('/start', (req, res) => {
  const out = startAccountServer();
  res.status(out.ok ? 200 : 400).json(out);
});

router.post('/stop', (req, res) => {
  res.json(stopAccountServer());
});

router.post('/restart', async (req, res) => {
  res.json(await restartAccountServer());
});

export default router;
