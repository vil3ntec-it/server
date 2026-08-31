// ---------------------------------------------------------------------------
//  API نسخهٔ ۱ — قراردادِ رسمی با کلاینت‌ها
//
//  همهٔ روترهای پنل این‌جا زیرِ یک ریشه جمع می‌شوند تا دو بار نصب شوند:
//      /api/v1/...   قراردادِ عمومی و مستند
//      /api/...      نامِ مستعار، برای رابط کاربریِ ساخته‌شدهٔ فعلی
//
//  چرا اسمِ مستعار لازم است: باندلِ آمادهٔ رابط کاربری در server/public
//  مسیرهای /api/... را صدا می‌زند. اگر مسیر را جابه‌جا می‌کردیم، پنلِ در حالِ
//  اجرا همان لحظه می‌شکست تا وقتی که UI دوباره build شود. مسیرِ قدیمی هدرِ
//  Deprecation می‌گیرد تا مهاجرت قابلِ ردگیری باشد و روزی که UI مهاجرت کرد،
//  حذفش بی‌خطر باشد.
//
//  قراردادِ نسخه: تغییرِ شکسته → v2. افزودنِ فیلد یا مسیرِ تازه → همین v1
//  (کلاینت باید فیلدِ ناشناس را نادیده بگیرد).
// ---------------------------------------------------------------------------
import { Router } from 'express';

import authRoutes from './auth.js';
import usersRoutes from './users.js';
import dashboardRoutes from './dashboard.js';
import sitesRoutes from './sites.js';
import domainsRoutes from './domains.js';
import filesRoutes from './files.js';
import logsRoutes from './logs.js';
import networkRoutes from './network.js';
import settingsRoutes from './settings.js';
import siteServerRoutes from './site-server.js';
import messengerRoutes from './messenger.js';
import notifyRoutes, { adminRouter as notifyAdminRoutes } from './notify.js';
import aiRoutes from './ai.js';
import backupsRoutes from './backups.js';
import systemRoutes from './system.js';
import { healthPayload, readyPayload } from '../platform/health.js';

export function createApiV1() {
  const router = Router();

  // سلامت زیرِ API هم هست، برای کلاینت‌هایی که فقط /api را می‌بینند
  router.get('/health', (req, res) => res.json(healthPayload()));
  router.get('/ready', (req, res) => {
    const payload = readyPayload();
    res.status(payload.ready ? 200 : 503).json(payload);
  });

  router.use('/auth', authRoutes);
  router.use('/users', usersRoutes);
  router.use('/system', systemRoutes);
  router.use('/dashboard', dashboardRoutes);
  router.use('/sites', sitesRoutes);
  // «services» نامِ آینده‌نگرِ همان سایت‌هاست: یک سرویس همیشه سایت نیست.
  // هر دو به یک روتر می‌روند تا نامِ تازه بدونِ شکستنِ چیزی جا بیفتد.
  router.use('/services', sitesRoutes);
  router.use('/domains', domainsRoutes);
  router.use('/files', filesRoutes);
  router.use('/logs', logsRoutes);
  router.use('/network', networkRoutes);
  router.use('/settings', settingsRoutes);
  router.use('/backups', backupsRoutes);
  router.use('/site-server', siteServerRoutes);
  router.use('/messenger', messengerRoutes);
  router.use('/notify', notifyRoutes);
  router.use('/notify-admin', notifyAdminRoutes);
  router.use('/ai', aiRoutes);

  router.use((req, res) => res.status(404).json({ error: 'not_found' }));
  return router;
}

/**
 * نشانه‌گذاریِ مسیرِ قدیمی. فقط هدر اضافه می‌کند و رفتار را عوض نمی‌کند —
 * کلاینتِ قدیمی نباید با این تغییر چیزی از دست بدهد.
 */
export function deprecatedAlias(req, res, next) {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `<${req.baseUrl || ''}/v1${req.path}>; rel="successor-version"`);
  next();
}
