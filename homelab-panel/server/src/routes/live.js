// ---------------------------------------------------------------------------
//  مسیرهای گذرگاهِ زنده
//
//    GET  /api/live/stream   جریانِ SSE — اپِ ادمین و هر مشتریِ بی‌کتابخانه
//    GET  /api/live/marks    آخرین مهرِ هر موضوع (برای مشتریِ تازه‌وصل)
//    POST /api/live/bump     سرورِ حساب می‌گوید چیزی عوض شد
//
//  ⛔ **هر سه فقط روی پورتِ پنل.** این روتر هیچ‌وقت روی پورتِ عمومی سوار
//  نمی‌شود: جریانِ زنده یعنی دانستنِ این‌که همین حالا چه کسی چه کاری کرد، و
//  آن از اینترنت درز نمی‌کند. اپِ ادمین از بیرونِ خانه از **درِ کلیددار**
//  می‌آید که همین مسیر را به پورتِ پنل لوله می‌کند.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import crypto from 'node:crypto';
import { requireAuth } from '../auth.js';
import { addSseClient, bump, liveStats, marks, TOPICS } from '../live/bus.js';

const router = Router();

/**
 *  رازِ pushِ سرورِ حساب.
 *
 *  ⚠️ در حافظه ساخته می‌شود و با هر بالا آمدنِ پنل تازه است — و همان لحظه
 *  در محیطِ فرزند می‌نشیند (`accountChildEnv`). پس روی دیسک نمی‌نشیند و
 *  پنلِ ریاستارت‌شده فرزندش را هم با رازِ تازه بالا می‌آورد.
 */
let pushSecret = crypto.randomBytes(32).toString('base64url');

export function livePushSecret() {
  return pushSecret;
}

/** فقط برای آزمون */
export function setLivePushSecret(value) {
  pushSecret = String(value || '');
}

function isLoopback(req) {
  const a = String(req.socket?.remoteAddress || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/*
 *  جریانِ زنده.
 *
 *  ⚠️ توکن از `?token=` هم پذیرفته می‌شود و این عمدی است: `EventSource`ِ
 *  مرورگر سرآیندِ دلخواه نمی‌پذیرد. `requireAuth` از قبل همین را بلد است.
 */
router.get('/stream', requireAuth, (req, res) => {
  /*
   *  ⚠️ مهلتِ خودِ پاسخ برداشته می‌شود، وگرنه Node بعد از دو دقیقه جریان
   *  را می‌بندد و مشتری هر دو دقیقه دوباره وصل می‌شود — یعنی همان نبضی
   *  که می‌خواستیم برداریم، فقط با نامِ دیگر.
   */
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);
  addSseClient(req, res);
});

router.get('/marks', requireAuth, (req, res) => {
  res.json({ ok: true, topics: TOPICS, marks: marks(), ...liveStats() });
});

/**
 * «چیزی در دفترِ من عوض شد» — از سرورِ حساب.
 *
 * ⛔ دو نگهبان و هر دو لازم‌اند: از خودِ این کامپیوتر، **و** با رازی که
 * فقط فرزندِ همین پنل دارد. بی دومی، هر برنامه‌ای روی همان کامپیوتر
 * می‌توانست پنل را بی‌جهت به پرس‌وجو بیندازد.
 */
router.post('/bump', (req, res) => {
  const sent = String(req.headers['x-live-key'] || '');
  const ok = isLoopback(req)
    && sent.length === pushSecret.length
    && sent.length > 0
    && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(pushSecret));
  if (!ok) return res.status(404).type('text/plain').send('not found');

  const list = Array.isArray(req.body?.topics)
    ? req.body.topics
    : [req.body?.topic].filter(Boolean);

  const done = [];
  for (const t of list.slice(0, 20)) {
    //  موضوعِ ناشناخته از سرورِ تازه‌تر نباید ۵۰۰ بدهد — رد می‌شود و تمام
    try { bump(String(t), { via: 'account' }); done.push(String(t)); } catch { /* رد */ }
  }
  res.json({ ok: true, bumped: done });
});

export default router;
