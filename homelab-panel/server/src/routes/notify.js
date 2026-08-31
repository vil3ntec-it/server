// ---------------------------------------------------------------------------
//  API اعلان — عمداً مثل ntfy ساده، تا هر برنامه‌ای بتواند خبر بدهد
//
//      curl -d "تیل مخزن ۲ کم شد"  http://<سرور>/api/notify/pump
//      curl -H "X-Title: هشدار" -H "X-Priority: 5" -d "..." .../api/notify/pump
//      curl -H "Content-Type: application/json" \
//           -d '{"title":"هشدار","message":"...","tags":["fuel"]}' .../api/notify/pump
//
//  فرستادن باز است (مگر موضوع رمزِ نوشتن داشته باشد). خواندنِ فهرستِ موضوع‌ها و
//  عوض کردنِ رمز، فقط از پنل و با حساب مدیر.
// ---------------------------------------------------------------------------
import express, { Router } from 'express';
import { requireAuth } from '../auth.js';
import * as notify from '../notify/index.js';
import { vapidPublicKey } from '../messenger/push.js';

const router = Router();

// متن خام هم قبول می‌شود، نه فقط JSON — تا «curl -d» ساده کار کند
router.use(express.text({ type: ['text/*', 'application/x-www-form-urlencoded'], limit: '1mb' }));

/**
 * هدرهای HTTP فقط حروف انگلیسی می‌پذیرند، پس عنوانِ فارسی را نمی‌شود مستقیم
 * در هدر گذاشت. اگر درصدی‌کدشده باشد بازش می‌کنیم — یعنی این هم کار می‌کند:
 *     curl -H "X-Title: %D9%87%D8%B4%D8%AF%D8%A7%D8%B1" ...
 * (برای متنِ فارسی بدون دردسر، حالت JSON را استفاده کنید.)
 */
function headerText(value) {
  if (!value) return null;
  const raw = String(value);
  if (!/%[0-9a-f]{2}/i.test(raw)) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const bearer = (req) =>
  String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token || null;

/* config عمداً باز است: فقط کلیدِ عمومیِ VAPID و «آیا رمزِ خواندن لازم است؟» را
   می‌گوید. خودِ رمز هرگز از این‌جا بیرون نمی‌رود — برنامه با آن می‌فهمد که باید
   از کاربر رمز بخواهد یا نه. */
router.get('/config', (req, res) => {
  res.json({ vapidPublicKey: vapidPublicKey(), readKeyRequired: Boolean(notify.readKeyAll()) });
});

// ------------------------------ فرستادن اعلان ------------------------------
async function send(req, res) {
  const topic = req.params.topic;
  const isJson = req.body && typeof req.body === 'object';

  const payload = isJson
    ? {
      title: req.body.title,
      body: req.body.message ?? req.body.body,
      priority: req.body.priority,
      tags: req.body.tags,
      click: req.body.click,
    }
    : {
      // هدرها همان‌هایی است که ntfy هم می‌پذیرد
      title: headerText(req.headers['x-title'] || req.headers.title),
      body: typeof req.body === 'string' ? req.body : '',
      priority: req.headers['x-priority'] || req.headers.priority,
      tags: headerText(req.headers['x-tags'] || req.headers.tags),
      click: req.headers['x-click'] || req.headers.click,
    };

  const result = await notify.publish(topic, { ...payload, token: bearer(req) });
  if (!result.ok) {
    return res.status(result.error === 'forbidden' ? 403 : 400).json(result);
  }
  res.json(result);
}

router.post('/:topic', send);
router.put('/:topic', send);

/* رمزِ خواندن — از هر سه راهِ معمول پذیرفته می‌شود تا هم مرورگر راحت باشد هم curl:
     ?key=…  ·  X-Read-Key: …  ·  Authorization: Bearer … */
const readKey = (req) =>
  req.query.key || req.headers['x-read-key'] || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;

// ------------------------------ خواندنِ پیام‌ها -----------------------------
router.get('/:topic/json', (req, res) => {
  if (!notify.mayRead(req.params.topic, readKey(req))) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  res.json({
    topic: notify.cleanTopic(req.params.topic),
    messages: notify.history(req.params.topic, { since: req.query.since, limit: req.query.limit }),
  });
});

/* آمارِ سریعِ یک موضوع — چند نفر همین لحظه بازند (آنلاین/بیننده) و چند دستگاه
   عضوِ نوتیفیکیشنِ آن‌اند. خواستهٔ صاحبِ برنامه: در تبِ «اعلان عمومی» ببیند
   الان چند نفر آنلاین‌اند و کلاً چند مشتری عضو شده‌اند. رمزِ خواندنِ همان
   موضوع را می‌خواهد — همان رمزی که برای دیدنِ خودِ پیام‌ها لازم است. */
router.get('/:topic/stats', (req, res) => {
  if (!notify.mayRead(req.params.topic, readKey(req))) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const topic = notify.cleanTopic(req.params.topic);
  res.json({ topic, online: notify.listenerCount(topic), members: notify.deviceCount(topic) });
});

/* همان آمار، ولی برای چند موضوع با یک درخواست:
       GET /api/notify/presence?topics=mirza,p-debt-2,p-guest_ab12
   برنامه برای نقطهٔ سبزِ «آنلاین» کنارِ هر گفت‌وگو لازمش دارد. با مسیرِ تکیِ
   بالا باید برای هر نفر یک درخواست می‌رفت — روی فهرستِ بلند یعنی ده‌ها درخواست
   در هر چند ثانیه. موضوع‌هایی که رمزِ خواندنشان با این دستگاه نمی‌خورد، ساده
   از جواب می‌افتند (نه خطا) تا یک موضوعِ قفل، بقیه را هم خراب نکند. */
const PRESENCE_MAX_TOPICS = 100;
router.get('/presence', (req, res) => {
  const key = readKey(req);
  const wanted = String(req.query.topics || '')
    .split(',')
    .map((t) => notify.cleanTopic(t))
    .filter(Boolean)
    .slice(0, PRESENCE_MAX_TOPICS);

  const presence = {};
  for (const topic of new Set(wanted)) {
    if (!notify.mayRead(topic, key)) continue;
    presence[topic] = { online: notify.listenerCount(topic), members: notify.deviceCount(topic) };
  }
  res.json({ presence, at: Date.now() });
});

// ---------------------- ثبت دستگاه برای نوتیفیکیشن -------------------------
/* ثبتِ دستگاه هم «خواندن» است: هر کس بتواند دستگاهش را روی یک موضوع ثبت کند،
   از آن به بعد همهٔ پیام‌های آن موضوع را به‌صورت نوتیفیکیشن می‌گیرد. پس همان
   رمزِ خواندن این‌جا هم لازم است. */
router.post('/:topic/devices', (req, res) => {
  if (!notify.mayRead(req.params.topic, readKey(req) || req.body?.key)) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  const sub = (req.body && req.body.subscription) || req.body || {};
  const result = notify.subscribeDevice(req.params.topic, {
    label: req.body?.label,
    endpoint: sub.endpoint,
    p256dh: sub.keys?.p256dh,
    auth: sub.keys?.auth,
  });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// برداشتنِ دستگاه رمز نمی‌خواهد: کسی که endpointِ خودش را دارد فقط می‌تواند
// خودش را از فهرست بردارد، و این کار هیچ اطلاعاتی لو نمی‌دهد.
router.delete('/:topic/devices', (req, res) => {
  res.json(notify.unsubscribeDevice(req.params.topic, req.query.endpoint));
});

export default router;

// ------------------------- مسیرهای مدیریتی (پنل) ---------------------------
export const adminRouter = Router();
adminRouter.use(requireAuth);

adminRouter.get('/', (req, res) => {
  res.json({ topics: notify.listTopics(), stats: notify.snapshot(), readKey: notify.readKeyAll() });
});

/* رمزِ خواندنِ همگانی — همانی که در برنامه («تنظیمات ← پیام‌رسان») گذاشته می‌شود
   و از آن به بعد فقط دستگاه‌هایی که رمز را دارند می‌توانند پیام‌ها را بگیرند.
     POST {}              → یک رمزِ تازه بساز و برگردان
     POST {key:'…'}       → همین رمز را بگذار
     POST {clear:true}    → رمز را بردار (همه‌چیز مثلِ قبل باز می‌شود) */
adminRouter.post('/read-key', (req, res) => {
  if (req.body?.clear) return res.json(notify.setReadKeyAll(''));
  if (req.body?.key) return res.json({ ...notify.setReadKeyAll(req.body.key), key: String(req.body.key) });
  res.json(notify.newReadKeyAll());
});

adminRouter.post('/', (req, res) => {
  const topic = notify.ensureTopic(req.body?.name, { title: req.body?.title });
  if (!topic) return res.status(400).json({ error: 'invalid_topic' });
  res.json({ ok: true, topic: topic.name });
});

adminRouter.post('/:topic/token', (req, res) => {
  const result = req.body?.clear ? notify.setWriteToken(req.params.topic, null) : notify.newWriteToken(req.params.topic);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

/* رمزِ خواندنِ موضوع — تا هر کس نامِ موضوع را دانست نتواند پیام‌هایش را بخواند
   یا دستگاهش را رویش ثبت کند. تا وقتی رمز نگذارید، موضوع مثل قبل باز است. */
adminRouter.post('/:topic/read-token', (req, res) => {
  const result = req.body?.clear ? notify.setReadToken(req.params.topic, null) : notify.newReadToken(req.params.topic);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// فرستادنِ دستی از داخل پنل
adminRouter.post('/:topic/send', async (req, res) => {
  const topicRow = notify.getTopic(req.params.topic);
  const result = await notify.publish(req.params.topic, {
    title: req.body?.title,
    body: req.body?.message ?? req.body?.body,
    priority: req.body?.priority,
    tags: req.body?.tags,
    // مدیرِ پنل رمزِ موضوع را لازم ندارد
    token: topicRow?.write_token,
  });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});
