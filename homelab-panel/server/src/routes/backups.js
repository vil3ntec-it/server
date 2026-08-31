// ---------------------------------------------------------------------------
//  بکاپ‌ها
//
//  گرفتنِ بکاپ کارِ روزمره است → operator
//  بازگردانی دادهٔ فعلی را دور می‌ریزد → فقط admin
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { logEvent } from '../db.js';
import { config } from '../config.js';
import { createBackup, listBackups, pruneBackups, restoreBackup } from '../backup/index.js';
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

// بازگردانی دادهٔ فعلی را کنار می‌گذارد — سنگین‌ترین کارِ این API
router.post('/:file/restore', requireRole('admin'), (req, res) => {
  const result = restoreBackup(req.params.file);
  if (!result.ok) return res.status(400).json(result);
  logEvent('warn', 'panel', `بازگردانیِ بکاپ «${result.file}» توسط ${req.user.username}`);
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
