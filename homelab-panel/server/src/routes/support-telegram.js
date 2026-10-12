// ---------------------------------------------------------------------------
//  تنظیمِ پلِ تلگرامِ پشتیبانی (src/support/telegram.js) — فقط مدیر
//
//      GET  /api/support-telegram            حال: روشن؟ chat id، برنامه‌ها، آخرین دور
//      PUT  /api/support-telegram            { enabled, chatId, apps, token? }
//      POST /api/support-telegram/find-chat  { token? } ← آخرین گفت‌وگویی که به ربات Start زده
//      POST /api/support-telegram/test       پیامِ آزمایشی به همان گفت‌وگو
// ---------------------------------------------------------------------------
import { Router } from 'express';
import { requireAuth, requireWriteRole } from '../auth.js';
import { audit } from '../control/audit.js';
import { status, saveConfig, findChat, tg, token, config, validToken, assertNotPumpBot } from '../support/telegram.js';

const router = Router();
router.use(requireAuth);
router.use(requireWriteRole('admin'));

const actorOf = (req) => req.user?.username || 'admin';

router.get('/', (req, res) => res.json(status()));

router.put('/', async (req, res) => {
  try {
    const b = req.body || {};
    const t = String(b.token || '').trim();
    // ⛔ نه رباتِ پمپ بنزین — رباتِ مالک جداست
    if (t && validToken(t)) await assertNotPumpBot(t);
    const out = saveConfig({ enabled: b.enabled, chatId: b.chatId, apps: b.apps, token: b.token }, actorOf(req));
    audit({ actor: actorOf(req), action: 'support-telegram.config', entity: 'setting', detail: { enabled: out.enabled, apps: out.apps } });
    res.json(out);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message === 'invalid_token' ? 'توکنِ ربات درست نیست؛ همان متنی را بچسبانید که BotFather داد' : e.message });
  }
});

router.post('/find-chat', async (req, res) => {
  const t = String(req.body?.token || '').trim();
  try {
    const use = t && validToken(t) ? t : token();
    await assertNotPumpBot(use);
    const chat = await findChat(use);
    if (!chat) return res.status(404).json({ error: 'هنوز پیامی به ربات نرسیده. ربات را در تلگرام باز کنید، Start را بزنید و دوباره امتحان کنید.' });
    res.json({ chat });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

router.post('/test', async (req, res) => {
  const c = config();
  try {
    await tg(token(), 'sendMessage', { chat_id: c.chatId, text: '✅ پلِ پشتیبانیِ کنترول سنتر وصل است. پیامِ کاربرانِ پمپ، فروشگاه و سایت‌ها این‌جا می‌آید؛ برای جواب روی پیامشان Reply بزنید.' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
