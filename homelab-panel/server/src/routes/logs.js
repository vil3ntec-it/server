// لاگ‌های سراسری پنل (خطاها، هشدارها، رویدادها)
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { q, db } from '../db.js';

const router = Router();
// پاک کردنِ کلِ لاگ‌ها یعنی پاک کردنِ ردِ حادثه — فقط مدیر
router.use(requireAuth, requireWriteRole('admin'));

router.get('/', (req, res) => {
  const limit = Math.min(1000, Number(req.query.limit) || 200);
  const level = String(req.query.level || '').trim();
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;

  const where = [];
  const params = [];
  if (level && ['error', 'warn', 'info'].includes(level)) {
    where.push('e.level = ?');
    params.push(level);
  }
  if (siteId) {
    where.push('e.site_id = ?');
    params.push(siteId);
  }
  const sql = `
    SELECT e.*, s.name AS site_name FROM events e
    LEFT JOIN sites s ON s.id = e.site_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY e.id DESC LIMIT ?`;
  params.push(limit);

  const rows = q(sql).all(...params);
  const counts = q('SELECT level, COUNT(*) AS n FROM events GROUP BY level')
    .all()
    .reduce((acc, r) => ({ ...acc, [r.level]: r.n }), {});

  res.json({ events: rows, counts });
});

router.delete('/', (req, res) => {
  db.exec('DELETE FROM events');
  res.json({ ok: true });
});

export default router;
