// ---------------------------------------------------------------------------
//  گفت‌وگوهای سایت‌ها در کنترول سنتر (src/support/site-chats.js) — فقط مدیر
//
//      GET  /api/site-chats                 همهٔ سایت‌ها و گفت‌وگوهایشان
//      GET  /api/site-chats/:slug/:id       یک گفت‌وگو
//      POST /api/site-chats/:slug/:id       { text } ← جواب؛ درجا به بازدیدکننده می‌رسد
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../control/audit.js';
import { listAll, getChat, reply } from '../support/site-chats.js';

const router = Router();
router.use(requireAuth);
router.use(requireWriteRole('admin'));

const fail = (res, e) => res.status(e.status && e.status < 600 ? e.status : 500).json({ error: e.message });

router.get('/', async (req, res) => {
  try { res.set('Cache-Control', 'no-store').json(await listAll()); } catch (e) { fail(res, e); }
});

router.get('/:slug/:id', async (req, res) => {
  try { res.set('Cache-Control', 'no-store').json(await getChat(req.params.slug, req.params.id)); } catch (e) { fail(res, e); }
});

router.post('/:slug/:id', async (req, res) => {
  try {
    const out = await reply(req.params.slug, req.params.id, req.body?.text);
    audit({ actor: req.user?.username || 'admin', action: 'site-chat.reply', entity: 'site', detail: { site: req.params.slug } });
    res.json(out);
  } catch (e) { fail(res, e); }
});

export default router;
