// ---------------------------------------------------------------------------
//  گذرگاهِ زنده — «چه چیزی عوض شد»، نه «این هم کلِ داده»
//
//  گزارشِ صاحب ریپو: «همه‌چی که تغییر می‌خوره باید ریست بشه تا دیده بشه…
//  من توی همون بخش مد نظر استم و هیچی نمیاد و باید از اون بخش بیرون بشم.»
//
//  ریشه: هیچ کانالِ زنده‌ای برای دادهٔ پنل نبود. هر صفحه خودش یک
//  `setInterval` داشت (۲٫۵ تا ۶۰ ثانیه) و صفحه‌هایی که نداشتند تا رفتن و
//  برگشتن هیچ‌وقت تازه نمی‌شدند.
//
//  ── چرا «موضوع» می‌فرستیم، نه خودِ داده ──────────────────────────────
//  فرستادنِ داده یعنی سرور باید بداند هر بیننده چه فیلتری دارد، چند ردیف
//  می‌خواهد و چه نقشی دارد — یعنی منطقِ هر صفحه دو جا نوشته شود. به‌جایش
//  فقط نامِ موضوع می‌رود («codes عوض شد») و خودِ صفحه همان پرس‌وجوی
//  همیشگی‌اش را دوباره می‌زند. یک خط پیام، و هیچ منطقِ تکراری.
//
//  ⛔ **و همین است که فشار را کم می‌کند، نه زیاد.** امروز هر تبِ باز هر
//  دو‌ونیم ثانیه یک درخواست می‌زد، چه چیزی عوض شده باشد چه نه. حالا تا
//  چیزی عوض نشود **هیچ** درخواستی زده نمی‌شود.
//
//  ── دو در، یک گذرگاه ────────────────────────────────────────────────
//  مرورگر از همان Socket.IOی موجود می‌شنود (`changed`)، و اپِ اندروید از
//  SSE — چون آن اپ عمداً هیچ وابستگیِ شبکه‌ای ندارد و `HttpURLConnection`
//  خطبه‌خط خواندنِ SSE را رایگان انجام می‌دهد. Socket.IO آن‌جا یعنی یک
//  کتابخانهٔ تازه.
// ---------------------------------------------------------------------------

/**
 *  موضوع‌های شناخته‌شده.
 *
 *  ⚠️ فهرستِ بسته است و عمداً: نامِ تایپی‌شده در یک `bump` وگرنه بی‌صدا
 *  گم می‌شد و کسی نمی‌فهمید چرا آن صفحه زنده نیست. `bump`ِ نامِ ناشناس
 *  خطا می‌دهد و آزمون همان را می‌سنجد.
 */
export const TOPICS = Object.freeze([
  //  دادهٔ خودِ پنل
  'sites', 'automation', 'logs', 'stations', 'agent', 'backups', 'cron', 'settings',
  //  بندِ ۱.۵-الف: دفترِ پیام‌رسان و اعلان‌ها هم به گذرگاه وصل شد
  'messenger', 'notify',
  //  دادهٔ سرورِ حساب (از راهِ pushِ خودش یا دیدبانِ مشترک)
  'codes', 'logins', 'support', 'customers', 'plans', 'notices', 'sales', 'sync',
]);

const KNOWN = new Set(TOPICS);

/** شنونده‌های SSE — هر کدام یک `res`ِ باز */
const sseClients = new Set();

/** یک‌بار نشانده می‌شود تا `bump` بتواند به مرورگرها هم برسد */
let io = null;

/**
 *  آخرین باری که هر موضوع عوض شده.
 *
 *  ⚠️ به چه درد می‌خورد: مشتری‌ای که تازه وصل شده باید بداند در فاصلهٔ
 *  قطعی چیزی از دستش رفته یا نه. بی این، یک قطعیِ دو ثانیه‌ای یعنی یک
 *  تغییرِ گم‌شده تا دفعهٔ بعد — دقیقاً همان چیزی که می‌خواهیم نباشد.
 */
const lastAt = new Map();

export function attachIo(server) {
  io = server;
}

/** برای آزمون‌ها */
export function resetBus() {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
  sseClients.clear();
  lastAt.clear();
  io = null;
}

/*
 *  ⚠️ کلیدش `seen` است نه `topics`: مسیرِ `/marks` فهرستِ **بستهٔ** موضوع‌ها
 *  را زیرِ `topics` می‌دهد و اگر این هم همان نام را داشته باشد، رویش
 *  می‌نشیند و فهرست بی‌صدا ناپدید می‌شود. (آزمون همین را گرفت.)
 */
export function liveStats() {
  return { sse: sseClients.size, seen: Object.fromEntries(lastAt) };
}

/** آخرین مهرِ هر موضوع — مشتریِ تازه‌وصل با این می‌فهمد عقب مانده یا نه */
export function marks() {
  return Object.fromEntries(lastAt);
}

/**
 * «این موضوع عوض شد.»
 *
 * ⛔ فقط وقتی صدا زده می‌شود که **واقعاً** چیزی عوض شده باشد. زدنش در
 * مسیرِ خواندن یعنی هر بیننده را به یک پرس‌وجوی تازه می‌فرستیم و همان
 * حلقهٔ بی‌پایانی می‌شود که می‌خواستیم برداریم.
 *
 * @param {string} topic  یکی از TOPICS
 * @param {object} [detail] چند کلیدِ کوچک — هرگز خودِ داده
 */
export function bump(topic, detail = {}) {
  const name = String(topic || '');
  if (!KNOWN.has(name)) throw new Error(`موضوعِ ناشناس برای گذرگاهِ زنده: ${name}`);

  const at = Date.now();
  lastAt.set(name, at);

  const line = JSON.stringify({ topic: name, at, ...detail });

  //  مرورگرها
  try { io?.emit('changed', JSON.parse(line)); } catch { /* گذرگاه نباید کسی را بخواباند */ }

  //  اپِ اندروید و هر مشتریِ SSE
  for (const res of sseClients) {
    try {
      res.write(`event: changed\ndata: ${line}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
  return at;
}

/*
 *  ── جمع کردنِ رگبار ────────────────────────────────────────────────
 *
 *  بعضی جاها پشتِ سرِ هم عوض می‌شوند: یک اجرای اتوماسیون ده سطرِ لاگ
 *  می‌نویسد، یک وارد کردنِ داده صد ردیف می‌سازد. اگر هر کدام یک پیام
 *  بفرستد، هر بیننده صد بار همان صفحه را دوباره می‌خواند — یعنی درست
 *  همان فشاری که می‌خواستیم برداریم، فقط این بار از سمتِ سرور.
 *
 *  ⛔ پس هر جایی که ممکن است رگبار بزند `bumpSoon` را صدا می‌زند، نه
 *  `bump`. یک رگبار = یک پیام.
 *
 *  ⚠️ و پیام **بعد** از رگبار می‌رود، نه اولش: مشتری که بشنود و همان
 *  لحظه بخواند، وسطِ کار را می‌بیند.
 */
const pending = new Map();

export function bumpSoon(topic, waitMs = 500, detail = {}) {
  if (!KNOWN.has(String(topic))) throw new Error(`موضوعِ ناشناس برای گذرگاهِ زنده: ${topic}`);
  if (pending.has(topic)) return false;
  const t = setTimeout(() => {
    pending.delete(topic);
    try { bump(topic, detail); } catch { /* گذرگاه نباید کسی را بخواباند */ }
  }, Math.max(0, waitMs));
  t.unref?.();
  pending.set(topic, t);
  return true;
}

/** برای آزمون‌ها — رگبارهای در راه را همین حالا می‌فرستد */
export function flushSoon() {
  for (const [topic, t] of pending) {
    clearTimeout(t);
    pending.delete(topic);
    try { bump(topic); } catch { /* رد */ }
  }
}

/**
 * یک شنوندهٔ SSE تازه.
 *
 * ⚠️ `flushHeaders` لازم است: بی آن، Node سرآیندها را تا اولین نوشتنِ
 * بزرگ نگه می‌دارد و مشتری فکر می‌کند اتصال برقرار نشده.
 *
 * ⚠️ و ضربانِ دوره‌ای هم لازم است — نه برای ما، برای واسط‌های بینِ راه:
 * یک اتصالِ SSEی ساکت را هر پروکسی و هر مودمی بعد از یک دقیقه می‌بندد.
 */
export function addSseClient(req, res, { heartbeatMs = 25_000 } = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    //  nginx و هر پروکسیِ بافرکننده — وگرنه هیچ‌چیز تا بسته شدن نمی‌رسد
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  //  مشتری همین اول می‌فهمد کجای کار است
  res.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now(), marks: marks() })}\n\n`);

  sseClients.add(res);

  const beat = setInterval(() => {
    try { res.write(': beat\n\n'); } catch { /* پایین بسته می‌شود */ }
  }, heartbeatMs);

  /*
   *  ⚠️ `res.on('close')`، نه `req.on('close')` — همان تله‌ای که یک بار
   *  جریانِ SSEی دستیار را می‌کشت: در Node، `req` بعد از خوانده شدنِ بدنه
   *  بسته می‌شود.
   */
  const bye = () => {
    clearInterval(beat);
    sseClients.delete(res);
  };
  res.on('close', bye);
  res.on('error', bye);

  return bye;
}
