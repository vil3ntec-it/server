// ---------------------------------------------------------------------------
//  API کنترلِ سرورِ حساب — فقط از پنل و با حسابِ مدیر
//
//  همان الگوی routes/ai.js: روی پورتِ **پنل**، نه پورتِ عمومی. یعنی از
//  اینترنت در دسترس نیست؛ فقط کسی که به پنل وارد شده می‌تواند سرورِ حساب را
//  روشن/خاموش کند یا لاگش را ببیند.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireRole, requireWriteRole, userRole } from '../auth.js';
import {
  accountStatus, accountLogs, startAccountServer, stopAccountServer, restartAccountServer,
} from '../account/supervisor.js';
import { probeAccountServer } from '../api/account-proxy.js';
import { check as checkBundle, apply as applyBundle } from '../account/updater.js';
import { cloudStatus } from '../stations/cloud.js';

const router = Router();
router.use(requireAuth);
//  ⛔ روشن/خاموش کردن و به‌روز کردنِ سرورِ حساب کارِ مدیرِ پنل است — تا ۱.۵۰.۸
//  هر واردشده‌ای (حتی «بیننده») سرورِ ورود و اشتراکِ همهٔ برنامه‌ها را
//  خاموش می‌کرد.
router.use(requireWriteRole('admin'));

/** وضعیت: نصب هست؟ روشن است؟ چند بار افتاده؟ و خودِ سرور جواب می‌دهد؟ */
router.get('/status', async (req, res) => {
  const st = accountStatus();
  const probe = await probeAccountServer().catch((e) => ({ up: false, error: e.message }));
  let bridge = null;
  try { bridge = cloudStatus(); } catch { /* گاوصندوق بسته */ }
  //  ⛔ رمزِ مدیرِ سرورِ حساب فقط به مدیرِ پنل نشان داده می‌شود. با آن رمز
  //  همهٔ اشتراک‌ها، کدها و پول دست می‌خورد؛ «بیننده» و «کارگزار» نامش را
  //  می‌بینند، نه رمزش.
  const admin = st.admin && userRole(req.user.id) !== 'admin'
    ? { ...st.admin, password: null, hidden: true }
    : st.admin;
  res.json({ ...st, admin, up: !!probe.up, version: probe.version || null, url: probe.url || null, bridge });
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

// ══ به‌روزرسانیِ خودِ سرورِ حساب ═══════════════════════════════════════════
//
//  ⛔ **چرا لازم شد** (۱۴۰۵/۰۷/۱۱): کدِ سرورِ حساب فقط با فایلِ نصبِ مرکز
//  فرمان می‌آمد، پس در لحظهٔ ساختِ نصاب یخ می‌زد. سرورِ صاحب سامانه روی
//  ۲.۷.۰ مانده بود در حالی که **فروشِ اشتراک ۲.۹.۰ می‌خواهد**. شرحِ کامل
//  در `account/updater.js`.

/** هست و تازه‌تر است؟ — خواندنی، پس برای هر واردشده باز است. */
router.get('/update', async (req, res) => {
  res.json(await checkBundle());
});

/**
 * بگیر و بنشان.
 *
 * ⛔ فقط `admin`: این سرویسِ حساب و اشتراکِ همهٔ برنامه‌ها را یک لحظه
 * می‌خواباند و دوباره بالا می‌آورد — همان قاعدهٔ `/api/platform/*`.
 */
router.post('/update', requireRole('admin'), async (req, res) => {
  const out = await applyBundle({ actor: req.user?.username || 'admin' });
  //  ⚠️ `detail` همان چیزی است که رابط به کاربر نشان می‌دهد (`ApiError`)،
  //  پس جملهٔ آدمیزاد (`why`) آن‌جا می‌نشیند، نه خروجیِ خامِ `tar`.
  if (!out.ok) return res.status(400).json({ ...out, error: out.code || 'update_failed', detail: out.why || 'به‌روزرسانی نشد' });
  res.json(out);
});

export default router;
