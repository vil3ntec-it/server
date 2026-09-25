// ---------------------------------------------------------------------------
//  ══ «گروهِ کارکنان» — گفت‌وگوی گروهیِ یک پمپ ═════════════════════════════
//
//  کارمندان، مدیر و میرزای **یک** پمپ با هم حرف می‌زنند: برنامهٔ کامپیوتر
//  (رمزِ برنامه) و گوشی‌های اپِ کارمندان (رمزِ خواندن). مشتری هرگز در آن
//  نیست و پمپ‌های دیگرِ همین سرور هرگز آن را نمی‌بینند.
//
//      data/stations/<کدِ پمپ>/chat.json   (۰۶۰۰)
//        { seq: <آخرین شماره>, messages: [{ seq, cid, from, role, text, at }] }
//
//  ⛔ **سرور فقط رله است، نه بایگانی**: هر پیام حداکثر ‎CHAT_RELAY_DAYS‎ (۱۵
//  روز) و حداکثر ‎CHAT_KEEP‎ (۲۰۰۰) پیام می‌ماند. برنامه‌ها نسخهٔ خودشان را
//  نگه می‌دارند.
//
//  ⛔ **هرس تنبل است، نه دوره‌ای**: با هر خواندن و هر نوشتن. هیچ
//  ‎setInterval‎ی این‌جا نیست — پمپی که کسی سراغش نمی‌رود هیچ هزینه‌ای ندارد.
//
//  ⛔ **‎seq‎ هرگز عقب نمی‌رود**، حتی وقتی همهٔ پیام‌ها هرس شده‌اند: گوشی با
//  ‎since=<آخرین seqِ خودش>‎ می‌پرسد و شمارهٔ تکراری یعنی پیامی که هیچ‌وقت
//  نمی‌رسد.
//
//  ⛔ **‎cid‎ (شناسهٔ خودِ کلاینت) نوشتن را تکرارپذیر می‌کند**: گوشی‌ای که
//  جوابش در راه گم شد و دوباره فرستاد، همان پیامِ قبلی را پس می‌گیرد، نه
//  پیامِ دوتایی.
//
//  ⛔ **نوشتن‌های یک پمپ پشتِ سرِ هم‌اند** (زنجیرهٔ ‎Promise‎ به‌ازای هر
//  پمپ) و فایل اتمی نوشته می‌شود (فایلِ موقت + ‎rename‎)، پس بیست پیامِ
//  هم‌زمان بیست شمارهٔ یکتا می‌گیرند و هیچ‌کدام گم نمی‌شود.
//
//  ⚠️ حالِ هر پمپ یک بار از دیسک خوانده و در حافظه نگه داشته می‌شود؛
//  گوشی‌ها هر چند ثانیه می‌پرسند و خواندنِ یک فایلِ چند مگابایتی با هر
//  پرسش همان «همهٔ ردیف‌ها را بخوان» است.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

/** چند روز پیام روی سرور می‌ماند — تنها جای این عدد (محیط فقط برای آزمون) */
export const CHAT_RELAY_DAYS = num(process.env.HLP_CHAT_RELAY_DAYS, 15);
/** بیشترین شمارِ پیامِ نگه‌داشته برای هر پمپ */
export const CHAT_KEEP = Math.floor(num(process.env.HLP_CHAT_KEEP, 2000));
/** نامِ فایلِ گفت‌وگو داخلِ پوشهٔ پمپ — همان که ‎layout.js‎ هم می‌گوید */
export const CHAT_FILE = 'chat.json';
/** نامِ شاخه‌ای که دفترِ ‎sitesync‎ نباید به آن دست بزند */
export const CHAT_BRANCH = 'chat';

export const CHAT_TEXT_MAX = 2000;
export const CHAT_FROM_MAX = 60;
export const CHAT_ROLES = ['admin', 'mirza', 'staff'];
export const CHAT_LIMIT_DEFAULT = 200;
export const CHAT_LIMIT_MAX = 500;

const CID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// نویسه‌های کنترلی (جز خطِ تازه و تب) — نه در نام و نه در متن
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const relayMs = () => CHAT_RELAY_DAYS * 24 * 60 * 60 * 1000;

/**
 * ورودیِ کلاینت را می‌سنجد. خطا ⇒ ‎{ error, message }‎؛ درست ⇒ ‎{ value }‎.
 * ⚠️ متنِ بلند بریده **نمی‌شود**، رد می‌شود: پیامِ نصفه‌ای که کاربر خبر
 * ندارد نصفه رفته، از پیامِ نرفته بدتر است.
 */
export function validateChatInput(body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  let cid = b.cid === undefined || b.cid === null || b.cid === '' ? '' : String(b.cid).trim();
  if (cid && !CID_RE.test(cid)) return { error: 'bad_cid', message: 'شناسهٔ پیام (cid) نامعتبر است' };
  if (!cid) cid = 's-' + crypto.randomBytes(9).toString('base64url');

  const from = String(b.from ?? '').replace(CONTROL_RE, '').replace(/\s+/g, ' ').trim();
  if (!from) return { error: 'bad_from', message: 'نامِ فرستنده لازم است' };
  if ([...from].length > CHAT_FROM_MAX) return { error: 'from_too_long', message: `نام حداکثر ${CHAT_FROM_MAX} نویسه` };

  const role = b.role === undefined || b.role === null || b.role === '' ? 'staff' : String(b.role).trim();
  if (!CHAT_ROLES.includes(role)) return { error: 'bad_role', message: 'نقش باید admin، mirza یا staff باشد' };

  const text = String(b.text ?? '').replace(CONTROL_RE, '').trim();
  if (!text) return { error: 'empty', message: 'متنِ پیام خالی است' };
  if ([...text].length > CHAT_TEXT_MAX) return { error: 'text_too_long', message: `متن حداکثر ${CHAT_TEXT_MAX} نویسه` };

  return { value: { cid, from, role, text } };
}

/**
 * @param {object} opts
 * @param {(code: string) => string} opts.dirFor  پوشهٔ یک پمپ
 * @param {(code: string) => void} [opts.onChange]  پس از هر نوشتنِ موفق
 */
export function createStationChat({ dirFor, onChange = () => {} }) {
  /** کدِ پمپ → { seq, messages } در حافظه */
  const cache = new Map();
  /** کدِ پمپ → زنجیرهٔ نوشتن‌ها */
  const chains = new Map();

  const fileOf = (code) => path.join(dirFor(code), CHAT_FILE);

  function load(code) {
    const hit = cache.get(code);
    if (hit) return hit;
    let state = { seq: 0, messages: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(fileOf(code), 'utf8'));
      const messages = Array.isArray(raw?.messages)
        ? raw.messages.filter((m) => m && Number.isFinite(Number(m.seq)) && typeof m.text === 'string')
            .map((m) => ({
              seq: Number(m.seq),
              cid: String(m.cid || ''),
              from: String(m.from || ''),
              role: CHAT_ROLES.includes(m.role) ? m.role : 'staff',
              text: m.text,
              at: Number(m.at) || 0,
            }))
            .sort((a, b) => a.seq - b.seq)
        : [];
      const top = messages.length ? messages[messages.length - 1].seq : 0;
      state = { seq: Math.max(Number(raw?.seq) || 0, top), messages };
    } catch { /* هنوز فایلی نیست، یا خراب است — از صفر، ولی ‎seq‎ از دیسک اگر بود */ }
    cache.set(code, state);
    return state;
  }

  /** پیام‌های کهنه و اضافه را برمی‌دارد؛ ‎true‎ یعنی چیزی رفت */
  function prune(state, now = Date.now()) {
    const cutoff = now - relayMs();
    const before = state.messages.length;
    let kept = state.messages.filter((m) => m.at >= cutoff);
    if (kept.length > CHAT_KEEP) kept = kept.slice(kept.length - CHAT_KEEP);
    state.messages = kept;
    return kept.length !== before;
  }

  async function persist(code, state) {
    const file = fileOf(code);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const text = JSON.stringify({ seq: state.seq, messages: state.messages });
    await fsp.writeFile(tmp, text, { encoding: 'utf8', mode: 0o600 });
    try {
      await fsp.rename(tmp, file);
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw e;
    }
    try { await fsp.chmod(file, 0o600); } catch { /* ویندوز */ }
  }

  /** کارِ ‎fn‎ را پشتِ نوشتن‌های قبلیِ همان پمپ می‌گذارد */
  function serial(code, fn) {
    const prev = chains.get(code) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    chains.set(code, tail);
    tail.finally(() => { if (chains.get(code) === tail) chains.delete(code); });
    return run;
  }

  /**
   * پیام‌های بعد از ‎since‎، به ترتیب. هرسِ تنبل همین‌جا هم می‌دود و اگر
   * چیزی رفت، روی دیسک هم می‌نشیند (پشتِ همان زنجیرهٔ نوشتن).
   */
  async function list(code, { since = 0, limit = CHAT_LIMIT_DEFAULT } = {}) {
    const state = load(code);
    if (prune(state)) await serial(code, () => persist(code, state)).catch(() => {});
    const s = Math.max(0, Math.floor(Number(since) || 0));
    const l = Math.min(CHAT_LIMIT_MAX, Math.max(1, Math.floor(Number(limit) || CHAT_LIMIT_DEFAULT)));
    const out = [];
    for (const m of state.messages) {
      if (m.seq <= s) continue;
      out.push({ ...m });
      if (out.length >= l) break;
    }
    return { last: state.seq, messages: out };
  }

  /** یک پیامِ سنجیده‌شده را می‌افزاید. ‎cid‎ِ تکراری ⇒ همان پیامِ قبلی. */
  function post(code, input) {
    return serial(code, async () => {
      const state = load(code);
      prune(state);
      const dup = state.messages.find((m) => m.cid === input.cid);
      if (dup) return { message: { ...dup }, duplicate: true };
      const message = {
        seq: state.seq + 1,
        cid: input.cid,
        from: input.from,
        role: input.role,
        text: input.text,
        at: Date.now(),
      };
      state.messages.push(message);
      prune(state);
      const prevSeq = state.seq;
      state.seq = message.seq;
      try {
        await persist(code, state);
      } catch (e) {
        // دیسک ننوشت ⇒ حافظه هم نباید جلو برود، وگرنه پیامی «رفته» که نمانده
        state.messages = state.messages.filter((m) => m !== message);
        state.seq = prevSeq;
        throw e;
      }
      try { onChange(code); } catch { /* خبر دادن نوشتن را نمی‌خواباند */ }
      return { message: { ...message }, duplicate: false };
    });
  }

  /** پمپِ پاک‌شده — حالِ حافظه‌اش هم برود */
  function forget(code) {
    cache.delete(code);
  }

  return { list, post, forget };
}
