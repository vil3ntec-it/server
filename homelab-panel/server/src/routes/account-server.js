// ---------------------------------------------------------------------------
//  API کنترلِ سرورِ حساب — فقط از پنل و با حسابِ مدیر
//
//  همان الگوی routes/ai.js: روی پورتِ **پنل**، نه پورتِ عمومی. یعنی از
//  اینترنت در دسترس نیست؛ فقط کسی که به پنل وارد شده می‌تواند سرورِ حساب را
//  روشن/خاموش کند یا لاگش را ببیند.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireRole, requireWriteRole, requireRecentAuth } from '../auth.js';
import { isOwner } from '../control/roles.js';
import { auditFromReq } from '../control/audit.js';
import {
  accountStatus, accountLogs, startAccountServer, stopAccountServer, restartAccountServer,
} from '../account/supervisor.js';
import { probeAccountServer } from '../api/account-proxy.js';
import { check as checkBundle, start as startBundle, progress as bundleProgress } from '../account/updater.js';
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
  //  ⛔ رمزِ ارشدِ سرورِ حساب دیگر در این پاسخ نیست — برای **هیچ‌کس**
  //  (فاز ۱ ِ ممیزی، بخشِ پنلیِ ۶-۴ / S4). تا ۱.۵۰.۶۱ هر admin ِ پنل آن را
  //  می‌گرفت و با آن از اینترنت به `api.<دامنه>/admin/` می‌رفت و نقش‌ها و
  //  دفترِ پنل را دور می‌زد. فقط «تنظیم هست/نیست»؛ خودِ رمز را فقط مالکِ اصلی،
  //  با احرازِ دوباره و یک ردیفِ دفتر، از `POST /admin-password/reveal` می‌بیند.
  const admin = st.admin
    ? { username: st.admin.username, source: st.admin.source, passwordSet: Boolean(st.admin.password) }
    : null;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...st, admin, up: !!probe.up, version: probe.version || null, url: probe.url || null, bridge });
});

/**
 * نمایشِ یک‌بارهٔ رمزِ ارشدِ سرورِ حساب — فقط مالکِ اصلی، فقط با رمزِ تازه.
 *
 * ⛔ هر بار یک درخواستِ جدا، یک ردیفِ دفتر و `no-store`؛ رابط آن را در حالتِ
 * صفحه نگه نمی‌دارد و پس از بستنِ پنجره دیگر ندارد. مدیرِ دیگر ۴۰۳ ِ
 * `owner_only` می‌گیرد و تلاشش هم می‌ماند.
 */
router.post('/admin-password/reveal', requireRole('admin'), (req, res) => {
  if (!isOwner(req.user.id)) {
    auditFromReq(req, 'account.admin_password.reveal', { entity: 'account-server', result: 'forbidden', detail: { why: 'owner_only' } });
    return res.status(403).json({ error: 'owner_only', message: 'فقط مالکِ اصلیِ پنل این رمز را می‌بیند.' });
  }
  return requireRecentAuth(req, res, () => {
    const st = accountStatus();
    if (!st.admin?.password) return res.status(404).json({ error: 'not_configured' });
    auditFromReq(req, 'account.admin_password.reveal', { entity: 'account-server', entityId: st.admin.username });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, username: st.admin.username, password: st.admin.password, source: st.admin.source });
  });
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
 * بگیر و بنشان — **در پس‌زمینه**.
 *
 * ⛔ همان لحظه برمی‌گردد و کار روی سرور ادامه دارد. پیش از این کلِ دانلود
 * داخلِ همین درخواست بود: صفحه هیچ عددی نمی‌دید، رفتن به بخشِ دیگر دکمه را
 * از نو می‌ساخت و کلیکِ دوم دانلودِ اولی را پاک می‌کرد. کارِ در جریان
 * دوباره شروع نمی‌شود (`started: false`).
 *
 * ⛔ فقط `admin`: این سرویسِ حساب و اشتراکِ همهٔ برنامه‌ها را یک لحظه
 * می‌خواباند و دوباره بالا می‌آورد — همان قاعدهٔ `/api/platform/*`.
 */
router.post('/update', requireRole('admin'), (req, res) => {
  res.json(startBundle({ actor: req.user?.username || 'admin' }));
});

/** حالِ کارِ جاری — چند مگابایت آمده، کدام گام. بی هیچ درخواستی به بیرون. */
router.get('/update/progress', (req, res) => {
  res.json(bundleProgress());
});

export default router;
