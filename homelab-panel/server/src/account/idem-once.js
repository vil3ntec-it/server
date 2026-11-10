// ---------------------------------------------------------------------------
//  «یک پنجره = یک کار» برای درهای سرورِ حساب که خودشان کلیدِ یکتایی ندارند (۱.۵۰.۷۵)
//
//  همان الگوی پشتیبانِ دستی (‎routes/console-ops.js‎)، یک بار و برای چند در: ازکارانداختنِ دستگاهِ کارمند
//  (‎/staff-perms/devices/:did/disable‎) و بازبینیِ بانکِ عکس (‎/image-bank/images/:id/approve|reject|archive|search‎).
//
//   • کلید از **رابط** (یکی برای هر `SensitiveDialog`) و بسته به همان کاربرِ پنل؛ بی کلید ⇒ ۴۰۰.
//   • همان کلید + همان کار ⇒ همان پاسخ با `replayed: true` (بی درخواستِ دوم به سرورِ حساب)؛ همان کلید برای کارِ
//     دیگر ⇒ ‎409 idempotency_key_reused‎.
//   • همان هدف (مثلاً همان دستگاه) هم‌زمان از دو پنجره ⇒ دومی ‎409 action_in_progress‎.
//   • شکستِ روشن ⇒ کلید آزاد می‌شود (دوباره قابلِ تلاش)؛ **نامعلوم** (مهلتِ پل، ‎outcome_unknown‎) ⇒ کلید
//     همان «نامعلوم» را نگه می‌دارد تا دوباره‌زدنِ همان پنجره کارِ دوم نسازد.
//   • یاد فقط در حافظه و ده دقیقه (مثلِ پشتیبان)، با سقفِ اندازه؛ راه‌اندازیِ دوباره فراموش می‌کند — پس سرورِ حساب
//     باید روزی کلیدِ یکتاییِ خودش را بگیرد (گزارشِ ۱.۵۰.۷۵).
//
//  ۱.۵۰.۷۷ — آن روز رسید (shop #1025، `idempotent-writes.v1`): سرورِ حسابِ تازه کلید را **خودش** در پایگاه نگه می‌دارد
//  (همان کلید ⇒ همان پاسخ با ‎Idempotent-Replayed‎؛ ‎409 idempotency_key_reused / idempotency_in_progress‎). آن‌جا
//  `makeUpstreamOnce` جای یادِ حافظه می‌نشیند (پس از راه‌اندازیِ دوبارهٔ پنل هم، بی مرزِ ده دقیقه)؛ سرورِ کهنه ⇒ همین یاد.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';

const IDEM_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const TTL = 10 * 60_000;
const MAX_SLOTS = 2000;

const bad = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

/** کلیدِ رابط: هست و شکلش درست است — پیش از هر پرسش از سرورِ حساب. */
export function checkIdemKey(key) {
  const k = String(key ?? '').trim();
  if (!k) throw bad('idempotency_key_required', 'کلیدِ یکتایی لازم است (رابطِ پنل خودش می‌فرستد)');
  if (!IDEM_RE.test(k)) throw bad('bad_idempotency_key', 'کلیدِ یکتایی نامعتبر است');
  return k;
}

/**
 * کلیدِ بالادست = کلیدِ پنجره، بسته به کاربرِ پنل (`u<id>.`): با راهِ پیشین (رمزِ ارشد) همهٔ کاربرانِ پنل یک «مدیر» ِ
 * سرورِ حساب‌اند، پس بی این پیشوند کلیدِ یک کاربر پاسخِ کاربرِ دیگر را بازپخش می‌کرد. (همان شکلِ بازگرداندنِ تعارض، ۱.۵۰.۷۵.)
 */
export function upstreamKey(req, key) {
  const k = checkIdemKey(key);
  return `u${req.user?.id ?? 'x'}.${k.length <= 110 ? k : crypto.createHash('sha256').update(k).digest('hex').slice(0, 64)}`;
}

/**
 * «یک بار» از راهِ خودِ سرورِ حساب. `send(headers)` همان ‎cloudRaw(…, { headers, replayFlag: true })‎ است؛
 * `finish(r, { record })` پاسخ را شکل می‌دهد و فقط وقتی `record` است ردیفِ دفترِ پنل می‌نویسد:
 *   • پاسخِ تازه ⇒ ردیف؛ بازپخش (‎replayed‎) ⇒ بی ردیفِ دوم —
 *   • **جز** بازپخشی که «نامعلوم» ِ همین پنل را روشن کرد (همان کلید پس از مهلت/افتادنِ اتصال): کار واقعاً انجام شده
 *     بود و دفترِ پنل تا این لحظه فقط «نامعلوم» داشت.
 *   • ‎409‎ ِ سرورِ حساب (کلیدِ تکراری برای کارِ دیگر، یا همان کار هنوز در راه) همان‌طور بالا می‌رود.
 */
export function makeUpstreamOnce({ ttl = TTL } = {}) {
  //  کلیدِ بالادست ⇒ { at, unknown } — هر کلیدی که از این راه رفت (نه فقط «نامعلوم»‌ها): `has` تا تلاشِ دوباره راه عوض نکند
  const sent = new Map();
  const prune = (now) => {
    for (const [k, v] of sent) if (now - v.at > ttl) sent.delete(k);
    while (sent.size > MAX_SLOTS) sent.delete(sent.keys().next().value);
  };
  async function viaServer(req, key, send, finish) {
    const upKey = upstreamKey(req, key);
    const now = Date.now();
    prune(now);
    const mark = sent.get(upKey) || { at: now, unknown: false };
    mark.at = now;
    sent.delete(upKey);
    sent.set(upKey, mark);
    let r;
    try {
      r = await send({ 'idempotency-key': upKey });
    } catch (err) {
      if (err?.outcome === 'unknown') { mark.unknown = true; mark.at = Date.now(); }
      throw err;
    }
    const replayed = r?.replayed === true;
    const resolved = replayed && mark.unknown;
    if (resolved) mark.unknown = false;
    const out = finish(r, { record: !replayed || resolved, resolved });
    return replayed ? { ...out, replayed: true } : out;
  }
  /** همین کلید (همین کاربر) در همین ده دقیقه از راهِ سرورِ حساب رفت؟ */
  viaServer.has = (req, key) => {
    prune(Date.now());
    try { return sent.has(upstreamKey(req, key)); } catch { return false; }
  };
  return viaServer;
}

/**
 * ⛔ راهِ یک کلید عوض نمی‌شود (۱.۵۰.۷۸): کلیدی که با یادِ پل رفت (سرورِ کهنه، یا پرسشِ ناموفقِ توانایی) سرورِ حساب آن را
 * نمی‌شناسد ⇒ فرستادنِ همان کار با کلید پس از به‌روز شدنِ سرورِ حساب **کارِ دوم** است؛ و کلیدی که با کلید رفت، بی کلید
 * فرستادنش همان. پس همان کلید ⇒ همان راهی که پیش‌تر رفت؛ فقط کلیدِ تازه با توانایی ِ همین لحظه.
 * @param {() => Promise<boolean>} capable  همان ‎capListed('idempotent-writes.v1')‎
 */
export async function serverPathFor(req, key, { once, viaServer, capable }) {
  if (viaServer.has(req, key)) return true;
  if (once.has(req, key)) return false;
  return capable();
}

export function makeIdemOnce({ ttl = TTL } = {}) {
  const slots = new Map();      // `${userId}:${key}` ⇒ { fp, at, done, promise }
  const busy = new Set();       // هدف‌هایی که همین حالا در راه‌اند

  function prune(now) {
    for (const [k, v] of slots) if (v.done && now - v.at > ttl) slots.delete(k);
    while (slots.size > MAX_SLOTS) slots.delete(slots.keys().next().value);
  }

  /**
   * @param {object} req       درخواستِ پنل (کاربر از ‎req.user‎)
   * @param {string} key       کلیدِ یکتاییِ رابط
   * @param {string} fp        اثرِ انگشتِ کار (هدف + دلیل + ورودی)؛ همان کلید با اثرِ دیگر ⇒ ۴۰۹
   * @param {string} target    هدف برای قفلِ هم‌زمانی
   * @param {() => Promise<object>} run
   * @returns {Promise<object>} پاسخ؛ تکرار ⇒ با `replayed: true`
   */
  async function once(req, key, fp, target, run) {
    const k = checkIdemKey(key);
    const now = Date.now();
    prune(now);
    const slotKey = `${req.user?.id ?? 'x'}:${k}`;
    const seen = slots.get(slotKey);
    if (seen) {
      if (seen.fp !== fp) throw bad('idempotency_key_reused', 'این کلیدِ یکتایی برای کارِ دیگری به کار رفته است', 409);
      return { ...(await seen.promise), replayed: true };
    }
    if (busy.has(target)) throw bad('action_in_progress', 'همین کار روی همین مورد همین حالا در راه است', 409);
    const slot = { fp, at: now, done: false, promise: null };
    slots.set(slotKey, slot);
    busy.add(target);
    slot.promise = (async () => {
      try {
        const out = await run();
        slot.done = true;
        slot.at = Date.now();
        return out;
      } catch (err) {
        if (err?.outcome === 'unknown') { slot.done = true; slot.at = Date.now(); }
        else slots.delete(slotKey);
        throw err;
      } finally {
        busy.delete(target);
      }
    })();
    return slot.promise;
  }
  /** همین کلید (همین کاربر) هنوز در یاد است؟ — `serverPathFor` */
  once.has = (req, key) => {
    prune(Date.now());
    return slots.has(`${req.user?.id ?? 'x'}:${String(key ?? '').trim()}`);
  };
  return once;
}
