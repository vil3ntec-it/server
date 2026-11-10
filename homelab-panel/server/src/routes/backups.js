// ---------------------------------------------------------------------------
//  بکاپ‌ها
//
//  گرفتنِ بکاپ کارِ روزمره است → operator
//  بازگردانی دادهٔ فعلی را دور می‌ریزد → فقط admin
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireRole, requireRecentAuth } from '../auth.js';
import { logEvent } from '../db.js';
import { config } from '../config.js';
import { createBackup, listBackups, pruneBackups, restoreBackup } from '../backup/index.js';
import { audit } from '../lib/audit.js';
import { v } from '../platform/validate.js';

const router = Router();
router.use(requireAuth, requireRole('operator'));

router.get('/', (req, res) => {
  const backups = listBackups();
  const latest = backups[0] || null;
  res.json({
    backups,
    keep: config.backupKeep,
    scheduled: config.backupSchedule,
    totalBytes: backups.reduce((sum, b) => sum + b.sizeBytes, 0),
    latest,
    // «آخرین بکاپ چقدر کهنه است؟» — همان چیزی که باید نگران‌کننده باشد
    ageHours: latest ? Math.round((Date.now() - latest.createdAt) / 36e5) : null,
  });
});

router.post('/', (req, res, next) => {
  try {
    const note = req.body?.note ? v.string(req.body.note, 'note', { max: 200 }) : null;
    const entry = createBackup({ reason: 'manual', note });
    logEvent('info', 'panel', `بکاپِ دستی گرفته شد: ${entry.file}`);
    res.json({ ok: true, backup: entry });
  } catch (e) {
    next(e);
  }
});

// بازگردانی دادهٔ فعلی را کنار می‌گذارد — سنگین‌ترین کارِ این API.
//  ⛔ (۱.۵۰.۸۲) بازگردانی کلِ `panel.db` — کاربران، نقش‌ها، نشست‌ها — را جای‌گزین
//  می‌کند، پس مدیرِ دوم (یا نشستِ دزدیده‌شده) می‌توانست با برگرداندنِ نسخهٔ کهنه،
//  بستنِ خودش را خنثی کند یا رمزِ کهنهٔ مالک را برگرداند و مرزهای «فقط مالک» را
//  دور بزند. حالا مثلِ هر کارِ حساس (S7) احرازِ دوباره می‌خواهد و یک ردیفِ دفترِ
//  یکپارچه می‌نویسد؛ تا ۱.۵۰.۸۱ هیچ‌کدام نبود (فقط یک خطِ لاگِ ساده).
router.post('/:file/restore', requireRole('admin'), requireRecentAuth, (req, res) => {
  const result = restoreBackup(req.params.file);
  if (!result.ok) {
    audit(req, 'panel.backup.restore', { target: String(req.params.file).slice(0, 200), ok: false, detail: { error: result.error } });
    return res.status(400).json(result);
  }
  logEvent('warn', 'panel', `بازگردانیِ بکاپ «${result.file}» توسط ${req.user.username}`);
  audit(req, 'panel.backup.restore', { target: result.file, detail: { safetyCopy: result.safetyCopy || null, pending: true } });
  res.json({
    ...result,
    message: 'بکاپ آمادهٔ بازگردانی است؛ با راه‌اندازیِ دوبارهٔ پنل اعمال می‌شود.',
  });
});

router.delete('/', requireRole('admin'), (req, res) => {
  const removed = pruneBackups(config.backupKeep);
  res.json({ ok: true, removed });
});

export default router;
