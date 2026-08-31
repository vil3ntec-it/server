// ---------------------------------------------------------------------------
//  وضعیتِ زیرساخت — «الان سرور در چه حالی است؟» در یک جواب
//
//  داشبورد از قبل معیارها را می‌داد؛ این‌جا چیزی است که داشبورد نمی‌داد:
//  نسخهٔ اسکیما، وضعیتِ آمادگی، دامنه‌های پیکربندی‌شده و آدرسی که کلاینت‌ها
//  باید بشناسند.
//
//  ⚠️ هیچ رازی این‌جا نمی‌آید: نه توکن، نه رمز، نه HLP_SECRET_KEY. فقط
//     «آیا تنظیم شده؟» به‌صورت بله/خیر.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import os from 'node:os';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { schemaVersion } from '../db.js';
import { versionInfo } from '../version.js';
import { readyPayload } from '../platform/health.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const ready = readyPayload();
  res.json({
    service: {
      name: 'homelab-panel',
      version: versionInfo.version,
      build: versionInfo.build,
      apiVersion: 'v1',
      schemaVersion,
      startedAt: versionInfo.startedAt,
      uptimeSeconds: Math.round(process.uptime()),
    },
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      uptimeSeconds: Math.round(os.uptime()),
    },
    domain: {
      configured: config.domains.configured,
      root: config.domains.root,
      api: config.domains.api,
      admin: config.domains.admin,
      files: config.domains.files,
      // همین آدرس است که کلاینت‌ها باید بشناسند — نه IP سرور
      apiUrl: config.domains.apiUrl,
    },
    edge: {
      trustProxy: config.trustProxy,
      // فقط «تنظیم شده یا نه»، نه خودِ مقدار
      secretFromEnv: Boolean(config.secretKey),
    },
    ready,
  });
});

export default router;
