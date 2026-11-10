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
// ---------------------------------------------------------------------------
const IDEM_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const TTL = 10 * 60_000;
const MAX_SLOTS = 2000;

const bad = (code, message, status = 400) => Object.assign(new Error(message), { code, status });

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
  return async function once(req, key, fp, target, run) {
    const k = String(key ?? '').trim();
    if (!k) throw bad('idempotency_key_required', 'کلیدِ یکتایی لازم است (رابطِ پنل خودش می‌فرستد)');
    if (!IDEM_RE.test(k)) throw bad('bad_idempotency_key', 'کلیدِ یکتایی نامعتبر است');
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
  };
}
