// ---------------------------------------------------------------------------
//  مسیرهای اطلاعیه
//
//    /api/announce        برنامه‌ها و سایت‌ها این‌جا را می‌خوانند — بی توکن
//    /api/announce-admin  خودِ پنل و برنامهٔ مدیر — پشتِ ورودِ مدیر
//
//  ⚠️ مسیرِ عمومی عمداً توکن نمی‌خواهد: اطلاعیه راز نیست، و مهم‌ترین
//  جایی که باید دیده شود دقیقاً همان‌جاست که کاربر هنوز وارد نشده —
//  صفحهٔ ورود، صفحهٔ قیمت. اگر توکن می‌خواست، اعلانِ «سرور فردا خاموش
//  است» به کسی که نمی‌تواند وارد شود نمی‌رسید.
//
//  ⚠️ ولی اطلاعیهٔ یک حسابِ مشخص فقط با دانستنِ شناسهٔ همان حساب می‌آید و
//  هیچ‌وقت در فهرستِ عمومی نمی‌نشیند.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { logEvent } from '../db.js';
import {
  AUDIENCES,
  AUDIENCE_LABELS,
  KINDS,
  createAnnouncement,
  deleteAnnouncement,
  listAll,
  liveFor,
  markSeen,
  noticePayload,
  publicRow,
  updateAnnouncement,
} from '../announce/store.js';

export const router = Router();
export const adminRouter = Router();

/* ========================================================================= */
/*  آن‌چه برنامه‌ها می‌خوانند                                                  */
/* ========================================================================= */

/**
 *   GET /api/announce?audience=shop&id=<شناسهٔ حساب>
 *
 *   { "notices": [ { id, title, body, kind, link, dismissible, until } ] }
 */
router.get('/', (req, res) => {
  const rows = liveFor({
    audience: req.query.audience || req.query.app || 'all',
    targetId: req.query.id || req.query.account || null,
  });
  res.json({ ok: true, notices: rows.map(noticePayload), serverTime: Date.now() });
});

/** «دیدمش» — فقط شمارنده، تا در پنل معلوم باشد پیام به چند نفر رسیده */
router.post('/:id/seen', (req, res) => {
  markSeen(req.params.id);
  res.json({ ok: true });
});

/* ========================================================================= */
/*  آن‌چه برنامهٔ مدیر می‌بیند                                                 */
/* ========================================================================= */

adminRouter.use(requireAuth, requireWriteRole('operator'));

adminRouter.get('/', (req, res) => {
  res.json({
    ok: true,
    items: listAll().map(publicRow),
    audiences: AUDIENCES.map((key) => ({ key, title: AUDIENCE_LABELS[key] })),
    kinds: KINDS,
  });
});

adminRouter.post('/', (req, res) => {
  try {
    const row = createAnnouncement(req.body || {}, req.user?.username || 'admin');
    logEvent(
      'info',
      'panel',
      `اطلاعیهٔ «${row.title}» برای ${AUDIENCE_LABELS[row.audience] || row.audience} منتشر شد`,
    );
    res.json({ ok: true, item: publicRow(row) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.code || 'bad_request', message: e.message });
  }
});

adminRouter.put('/:id', (req, res) => {
  const row = updateAnnouncement(req.params.id, req.body || {});
  if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, item: publicRow(row) });
});

adminRouter.delete('/:id', (req, res) => {
  res.json({ ok: deleteAnnouncement(req.params.id) });
});

export default router;
