// ---------------------------------------------------------------------------
//  🚦 درِ پخشِ آپدیتِ برنامهٔ پمپ — فقط روی پورتِ پنل
//
//      GET  /api/pump-updates-admin               حال، حالت و نسخه‌های روی سرور
//      POST /api/pump-updates-admin/mode {mode}   auto | hold        (فقط مدیر)
//      POST /api/pump-updates-admin/publish {version}                (فقط مدیر)
//      POST /api/pump-updates-admin/check         «همین حالا از گیت‌هاب بپرس» (فقط مدیر)
//      GET  /api/pump-updates-admin/files/:v/:n   دانلودِ نسخهٔ نگه‌داشته برای آزمودن
//
//  ⛔ هیچ‌کدام روی پورتِ عمومی نیست: درِ عمومی (routes/pump-updates.js) فقط
//  آن‌چه منتشر شده را می‌دهد.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../control/audit.js';
import {
  status, versions, setMode, publish, syncOnce, filePath, mirrorEnabled,
} from '../pumpupdates/mirror.js';

const router = Router();
router.use(requireAuth);
router.use(requireWriteRole('admin'));

const actorOf = (req) => req.user?.username || req.user?.id || 'admin';
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message || 'failed' });

router.get('/', async (req, res) => {
  try { res.json({ ...(await status()), versions: await versions() }); } catch (e) { fail(res, e); }
});

router.post('/mode', async (req, res) => {
  try {
    const mode = String(req.body?.mode || '');
    const r = await setMode(mode, { by: actorOf(req) });
    audit({ actor: actorOf(req), action: mode === 'hold' ? 'pump_update.hold' : 'pump_update.auto', entity: 'pump-update', entityId: r.published || null });
    res.json({ ok: true, ...(await status()), versions: await versions() });
  } catch (e) { fail(res, e); }
});

router.post('/publish', async (req, res) => {
  try {
    const r = await publish(String(req.body?.version || ''), { by: actorOf(req) });
    audit({ actor: actorOf(req), action: 'pump_update.publish', entity: 'pump-update', entityId: r.published, detail: { previous: r.previous, mode: r.mode } });
    res.json({ ok: true, ...(await status()), versions: await versions() });
  } catch (e) { fail(res, e); }
});

let checking = null;
router.post('/check', async (req, res) => {
  if (!mirrorEnabled()) return res.status(409).json({ error: 'mirror_disabled', message: 'آینهٔ آپدیتِ پمپ روی این نصب خاموش است' });
  try {
    //  ⛔ یک پرسش در هر لحظه — کلیکِ دوم به همان می‌پیوندد
    checking ||= syncOnce().finally(() => { checking = null; });
    const out = await checking;
    res.json({ ok: true, result: out, ...(await status()), versions: await versions() });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e), ...(await status()), versions: await versions() });
  }
});

router.get('/files/:version/:name', async (req, res) => {
  const file = await filePath(req.params.version, req.params.name, { any: true });
  if (!file) return res.status(404).json({ error: 'not_found' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(file, req.params.name, { dotfiles: 'deny' });
});

export default router;
