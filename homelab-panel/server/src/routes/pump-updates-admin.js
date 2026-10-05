// ---------------------------------------------------------------------------
//  🚦 درِ پخشِ آپدیتِ برنامهٔ پمپ — فقط روی پورتِ پنل
//
//      GET  /api/pump-updates-admin               حال، حالت و نسخه‌های روی سرور
//      POST /api/pump-updates-admin/mode {mode}   auto | hold        (فقط مدیر)
//      POST /api/pump-updates-admin/publish {version}                (فقط مدیر)
//      POST /api/pump-updates-admin/stable {version}                 «همین را پایدار کن» (فقط مدیر)
//      POST /api/pump-updates-admin/check         «همین حالا از گیت‌هاب بپرس» (فقط مدیر)
//      GET  /api/pump-updates-admin/files/:v/:n   دانلودِ نسخهٔ نگه‌داشته برای آزمودن
//      POST /api/pump-updates-admin/testers {codes}  🧪 پمپ‌های آزمایشی (فقط مدیر)
//
//  ⛔ هیچ‌کدام روی پورتِ عمومی نیست: درِ عمومی (routes/pump-updates.js) فقط
//  آن‌چه منتشر شده را می‌دهد.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../control/audit.js';
import {
  status, versions, setMode, publish, syncOnce, filePath, mirrorEnabled, promoteStable, setTesters, testers,
} from '../pumpupdates/mirror.js';
import { getStations } from '../state.js';
import { safeCode } from '../stations/index.js';

const router = Router();
router.use(requireAuth);
router.use(requireWriteRole('admin'));

const actorOf = (req) => req.user?.username || req.user?.id || 'admin';
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message || 'failed' });

/** پمپ‌های ثبت‌شده — فقط کد و نام، برای فهرستِ تیک‌دارِ «آزمایشی» */
const stationList = () => {
  try { return (getStations()?.list() || []).map((s) => ({ code: s.code, name: s.name })); } catch { return []; }
};
const full = async () => ({ ...(await status()), versions: await versions(), stations: stationList() });

router.get('/', async (req, res) => {
  try { res.json(await full()); } catch (e) { fail(res, e); }
});

//  🧪 فهرستِ پمپ‌های آزمایشی — ⛔ فقط کدِ پمپی که واقعاً ثبت شده
router.post('/testers', async (req, res) => {
  try {
    const raw = req.body?.codes;
    if (!Array.isArray(raw)) return res.status(400).json({ error: 'bad_testers' });
    const stations = getStations();
    const codes = raw.map((c) => safeCode(c));
    if (codes.some((c) => !c || !stations?.has(c))) return res.status(400).json({ error: 'unknown_station' });
    const before = await testers();
    const r = await setTesters(codes, { by: actorOf(req) });
    audit({ actor: actorOf(req), action: 'pump_update.testers', entity: 'pump-update', entityId: null, detail: { before, after: r.codes } });
    res.json({ ok: true, ...(await full()) });
  } catch (e) { fail(res, e); }
});

router.post('/mode', async (req, res) => {
  try {
    const mode = String(req.body?.mode || '');
    const r = await setMode(mode, { by: actorOf(req) });
    audit({ actor: actorOf(req), action: mode === 'hold' ? 'pump_update.hold' : 'pump_update.auto', entity: 'pump-update', entityId: r.published || null });
    res.json({ ok: true, ...(await full()) });
  } catch (e) { fail(res, e); }
});

router.post('/publish', async (req, res) => {
  try {
    const r = await publish(String(req.body?.version || ''), { by: actorOf(req) });
    audit({ actor: actorOf(req), action: 'pump_update.publish', entity: 'pump-update', entityId: r.published, detail: { previous: r.previous, mode: r.mode } });
    res.json({ ok: true, ...(await full()) });
  } catch (e) { fail(res, e); }
});

router.post('/stable', async (req, res) => {
  try {
    const r = await promoteStable(String(req.body?.version || ''), { by: actorOf(req) });
    audit({ actor: actorOf(req), action: 'pump_update.stable', entity: 'pump-update', entityId: r.stable, detail: { previous: r.stablePrevious } });
    res.json({ ok: true, ...(await full()) });
  } catch (e) { fail(res, e); }
});

let checking = null;
router.post('/check', async (req, res) => {
  if (!mirrorEnabled()) return res.status(409).json({ error: 'mirror_disabled', message: 'آینهٔ آپدیتِ پمپ روی این نصب خاموش است' });
  try {
    //  ⛔ یک پرسش در هر لحظه — کلیکِ دوم به همان می‌پیوندد
    checking ||= syncOnce().finally(() => { checking = null; });
    const out = await checking;
    res.json({ ok: true, result: out, ...(await full()) });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e), ...(await full()) });
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
