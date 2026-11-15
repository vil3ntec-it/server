// ---------------------------------------------------------------------------
//  🏪 پوستهٔ کنسولِ «فروشگاه» — درهای سمتِ پنل (زیرِ ‎/api/account-admin/console/…‎، همان روترِ پل)
//
//    GET  modules                         ماژول‌های همین نشست (نقش‌محور، از `console/modules.js`) — بی سرورِ حساب
//    GET  summary                         کارتِ داشبوردِ هر ماژول (۴.۱): منبع، زمان، «—» برای نیامده، هشدارها
//    GET  search?q=                       جست‌وجوی سراسریِ بخش: دکان، کاربر، پرداخت، سفارش، خطا، مدیر، کاربرِ پنل
//    GET  admins                          مدیرانِ سرورِ حساب (۴.۳) — فقط admin
//    POST admins                          ساختن — مالک + احرازِ دوباره + دلیل + تأیید + کلیدِ یکتایی
//    POST admins/:id/update               نقش/تعلیق/برگرداندن — همان قاعده؛ مالکِ اصلی هرگز
//    GET  admins/:id/sessions             نشست‌های یک مدیر (توانایی `admin-sessions.v1`)
//    POST admins/:id/sessions/revoke      بستنِ یکی/همه — مالک + احرازِ دوباره + دلیل + تأیید
//    PUT  flags · POST flags/reset        پرچمِ شناخته (۴.۱۲): نوع، scope، دلیل، تأیید؛ پرخطر ⇒ نوشتنِ نامِ کلید + رمز
//                                         (یا «حالتِ تغییر» ِ باز، ۱.۵۱.۱)
//    GET|POST|DELETE flags/sudo           «حالتِ تغییر» ِ همین نشست: دیدن · باز کردن با رمز (و کد) · بستن
//    POST flags/batch                     چند پرچم با یک دلیل در یک درخواست — همه یا هیچ؛ هر پرچم ردیفِ خودش در دفتر
//
//  ⛔ مدیرانِ سرورِ حساب فقط از **راهِ پیشین** (ورودِ ارشد): سرورِ حساب کلیدِ سرویس را به ‎/admin/admins‎ راه
//     نمی‌دهد (‎SERVICE_DENY‎ ِ #597 — هویتِ ماشین مدیر نمی‌سازد). راهِ پیشین نیست ⇒ «پشتیبانی نمی‌شود» با دلیل،
//     نه خطای گنگ. سابقهٔ سرورِ حساب این کارها را به نامِ همان ارشدِ پل می‌نویسد؛ دفترِ پنل آدمِ واقعی را.
//  ⛔ رمز هرگز در پاسخ، دفتر یا لاگ نیست (`password`/`adminPassword` از جزئیاتِ دفتر بیرون‌اند).
//  ⛔ هر درِ تازه در همین روتر است، پس ‎test/bridge-roles.mjs‎ خودش آن را با سه نقش می‌سنجد.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { audit, auditMany, bridgeFail, cloudRaw, db, legacyAvailable, panelAuth, panelRoles, rateLimit } from '../host.js';
import { CONSOLE_GROUPS, isPanelOwner, moduleById, modulesFor, requireModule } from '../console/modules.js';
import { SUMMARIES } from '../console/summaries.js';

const { requireRole, roleOf } = panelRoles;
const actorOf = (req) => req.user?.username || 'admin';

function fail(code, status, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  Object.assign(err, extra);
  return err;
}

function guard(handler) {
  return async (req, res) => {
    try { await handler(req, res); } catch (err) { bridgeFail(res, err); }
  };
}

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
function idOf(value) {
  const id = String(value || '');
  if (!ID_RE.test(id)) throw fail('bad_id', 400, 'شناسه معتبر نیست');
  return id;
}
function reasonOf(req) {
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 3 || reason.length > 200) throw fail('reason_required', 400, 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در دفترِ رخداد می‌ماند');
  return reason;
}
function requireConfirm(req) {
  if (req.body?.confirm !== true) throw fail('confirm_required', 400, 'این کار پیش از فرستادن تأیید می‌خواهد');
}

/** با یک سقفِ زمان — یک منبعِ کند کلِ داشبورد یا جست‌وجو را نگه نمی‌دارد. */
function withTimeout(promise, ms, code = 'timeout') {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(fail(code, 504, 'منبع در زمانِ مقرر جواب نداد')), ms); }),
  ]);
}

/* ─────────────────────────── احرازِ دوباره ─────────────────────────────
 *  همان قاعدهٔ درِ کلیدِ سرویس: رمزِ پنلِ خودِ همین کاربر همراهِ درخواست (و با فاز ۱ در پایه، نشستِ تازه هم بس
 *  است — `requireRecentAuth`). پنج رمزِ غلط در ربع ساعت ⇒ ۴۲۹.
 */
const reauthLimit = rateLimit({
  name: 'console-reauth', max: 5, windowMs: 15 * 60_000,
  key: (req) => `u${req.user?.id ?? 'x'}`,
  skipSuccess: true, countIf: (_req, res) => res.locals?.reauthFailed === true,
});

//  ⛔ قاعده یکی است و در `auth.js` (`bodyStepUp`): رمز، و اگر دوعاملی روشن است کد هم (۱.۵۰.۷۱)
function reauth(req, res, next) {
  const r = panelAuth.bodyStepUp(req);
  //  `reauthVerified`: رمز (و کد) در همین درخواست سنجیده شد — نه «نشستِ تازه» — تنها راهِ «حالتِ تغییر» ِ پرچم‌ها
  if (r.pass) { res.locals.reauthed = true; res.locals.reauthVerified = r.verified === true; return next(); }
  if (r.failed) {
    res.locals.reauthFailed = true;
    audit({ actor: actorOf(req), action: 'account.console.reauth_failed', entity: 'console', result: 'forbidden', detail: { path: req.path, step: r.error } });
    return res.status(403).json({ error: 'reauth_failed', message: 'رمزِ پنل یا کدِ دوعاملی درست نیست' });
  }
  return res.status(403).json({ error: 'reauth_required', totpRequired: r.totpRequired || undefined, message: 'برای این کار رمزِ پنلِ خودتان را دوباره بزنید' });
}

function ownerOnly(what) {
  return (req, res, next) => {
    if (isPanelOwner(req)) return next();
    audit({ actor: actorOf(req), action: 'account.console.denied', entity: what, result: 'forbidden', detail: { why: 'not_owner', path: req.path } });
    return res.status(403).json({ error: 'owner_only', message: 'این کار فقط از دستِ مالکِ پنل است' });
  };
}

/* ─────────────────────────── کلیدِ یکتایی ─────────────────────────────
 *  یکی برای هر پنجرهٔ رابط (‎idempotencyKey‎): همان کلید + همان بدنه ⇒ همان پاسخ، بی درخواستِ دوم به سرورِ حساب؛
 *  همان کلید + بدنهٔ دیگر ⇒ ۴۰۹. ده دقیقه در حافظه، به کاربر و مسیر بسته. رمزها در اثرِ انگشت نیستند.
 */
const IDEM_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const IDEM_TTL = 10 * 60_000;
const idemStore = new Map();
function fingerprint(body) {
  const { password, adminPassword, idempotencyKey, ...rest } = body || {};
  const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
      : JSON.stringify(v ?? null));
  return crypto.createHash('sha256').update(stable(rest)).digest('hex');
}
async function once(req, res, run) {
  const raw = req.body?.idempotencyKey;
  if (raw === undefined || raw === null || raw === '') throw fail('idempotency_key_required', 400, 'کلیدِ یکتایی لازم است (رابطِ پنل خودش می‌فرستد)');
  const key = String(raw);
  if (!IDEM_RE.test(key)) throw fail('bad_idempotency_key', 400, 'کلیدِ یکتایی نامعتبر است');
  const now = Date.now();
  for (const [k, v] of idemStore) if (now - v.at > IDEM_TTL) idemStore.delete(k);
  const slot = `${req.user?.id}:${req.method}:${req.baseUrl}${req.path}:${key}`;
  const hash = fingerprint(req.body);
  const seen = idemStore.get(slot);
  if (seen) {
    if (seen.hash !== hash) throw fail('idempotency_key_reused', 409, 'این کلیدِ یکتایی برای کارِ دیگری به کار رفته است');
    const out = await seen.promise;
    return res.status(out.status).json({ ...out.body, replayed: true });
  }
  const promise = (async () => {
    try {
      const body = await run();
      return { status: 200, body };
    } catch (err) {
      idemStore.delete(slot);   //  شکست ⇒ همان کلید دوباره قابلِ تلاش است، نه پاسخِ خطای ماندگار
      throw err;
    }
  })();
  idemStore.set(slot, { hash, at: now, promise });
  const out = await promise;
  return res.status(out.status).json(out.body);
}

/* ─────────────────────────── توانایی‌های سرورِ حساب ─────────────────────────── */

const NEEDS = {
  'admin-sessions.v1': 'GET /api/admin/admins/:id/sessions · POST …/sessions/revoke',
  'search.v1': 'GET /api/admin/search',
  'flags.v1': 'GET|PUT|DELETE /api/admin/flags',
};
async function capsOf(opts = {}) {
  const me = await cloudRaw('GET', '/api/admin/me', opts);
  return { list: Array.isArray(me?.capabilities) ? me.capabilities.map(String) : [], me };
}
const unavailable = (reason, extra = {}) => ({ available: false, reason, fetchedAt: Date.now(), ...extra });

/** راهِ پیشین برای درهای مدیران؛ نبود ⇒ «پشتیبانی نمی‌شود» با دلیلِ دقیق، نه خطا. */
function adminsBlocked() {
  if (legacyAvailable()) return null;
  return unavailable('not_linked', {
    why: 'service_key_denied',
    message: 'مدیرانِ سرورِ حساب فقط با ورودِ ارشدِ پل دیده و عوض می‌شوند — کلیدِ سرویس عمداً به آن‌ها راه ندارد. '
      + 'از «پمپ‌بنزین‌ها ← تنظیمات و داده‌ها» یک بار با حسابِ ارشد وارد شوید.',
  });
}

/* ─────────────────────────── پرچم‌های شناخته ─────────────────────────── */

/*
 *  ⛔ پرخطر = هر چه روی **همهٔ** دکان‌ها اثر دارد (scope ‎all‎ یا ‎security‎) یا به پول/سفارش/امنیت دست می‌زند.
 *  پرخطر ⇒ نوشتنِ نامِ کلید در تأیید (‎confirmKey‎) + رمزِ پنل. پرچمِ یک دکان ⇒ تأیید و دلیل.
 *  فهرست‌های کانالِ آزمایشی (‎beta.*‎ در scope ‎release‎) این‌جا نیستند: جایشان «نسخه‌ها و انتشار» است.
 */
const RISKY_KEYS = new Set(['shop.orders', 'shop.orders.refunds', 'shop.delivery', 'shop.storefront', 'hashchain.audit', 'market.directory']);
export const isRiskyFlag = (key, scope) => scope === 'all' || scope === 'security' || RISKY_KEYS.has(key);

async function knownFlag(key) {
  const out = await cloudRaw('GET', '/api/admin/flags', { query: { scope: 'all' } });
  const known = Array.isArray(out?.known) ? out.known : [];
  const k = known.find((x) => x && x.key === key);
  if (!k) throw fail('unknown_flag', 400, 'این پرچم در کاتالوگِ سرورِ حساب نیست — از کنسول فقط پرچمِ شناخته عوض می‌شود');
  if (Array.isArray(k.default) || k.scope === 'release') throw fail('use_versions_module', 400, 'فهرستِ کانالِ آزمایشی از «نسخه‌ها و انتشار» عوض می‌شود');
  if (typeof k.default !== 'boolean') throw fail('unsupported_flag_type', 400, 'نوعِ این پرچم در کنسول پشتیبانی نمی‌شود');
  return k;
}
function scopeFor(k, raw) {
  const s = String(raw ?? '').trim() || (k.scope === 'shop' ? 'all' : k.scope);
  if (k.scope === 'shop') {
    if (s === 'all' || ID_RE.test(s)) return s;
  } else if (s === k.scope) return s;
  throw fail('bad_flag_scope', 400, k.scope === 'shop' ? 'scope ِ این پرچم «all» یا شناسهٔ یک دکان است' : `scope ِ این پرچم فقط «${k.scope}» است`);
}
function riskyGate(req, res, key, scope) {
  if (!isRiskyFlag(key, scope)) return false;
  //  ⛔ کمربندِ دوم: پرخطر بودن این‌جا از scope ِ **نهایی** سنجیده می‌شود؛ اگر پیش‌سنجی (`reauthIfRisky`) به هر دلیلی
  //  آن را کم‌خطر خوانده بود (مثلاً scope با فاصله)، بی احرازِ دوباره همین‌جا می‌ایستد
  if (res.locals?.reauthed !== true) throw fail('reauth_required', 403, 'برای این کار رمزِ پنلِ خودتان را دوباره بزنید');
  if (String(req.body?.confirmKey || '') !== key) {
    throw fail('confirm_key_required', 400, 'این پرچم روی همهٔ دکان‌ها یا پول/امنیت اثر دارد — برای تأیید نامِ کلید را بنویسید');
  }
  return true;
}
/* ─────────────────── «حالتِ تغییر» (sudo) و تغییرِ دسته‌ای (۱.۵۱.۱) ───────────────────
 *
 *  دستورِ صاحب سامانه: «این صد تا دوصد تا رو دونه‌به‌دونه بزنم؟ یک بار رمز رو می‌زنم و هر کدوم رو خواستم روشن یا
 *  خاموش کنم.» دو چیز، هر دو فقط در لایهٔ پنل (سرورِ حساب برای پرچم رمز نمی‌خواهد؛ رمز هرگز به آن‌جا نمی‌رود):
 *
 *  ۱) **حالتِ تغییر** — یک احرازِ دوبارهٔ کامل (`bodyStepUp().verified`: رمز، و کد اگر دوعاملی روشن است) پنجرهٔ
 *     ۱۵ دقیقهٔ لغزان با سقفِ سخت ِ ۶۰ دقیقه برای **همین نشست** باز می‌کند (قاعده‌اش فقط `auth.js`). در پنجره، پرچمِ
 *     پرخطر رمز نمی‌خواهد؛ رمزِ فرستاده‌شده همیشه سنجیده می‌شود (غلط ⇒ همان `reauth_failed` و همان سقفِ نرخ).
 *  ۲) **تغییرِ دسته‌ای** — `POST flags/batch`: یک scope، یک دلیل، یک درخواست. همه یا هیچ: پیش از نخستین نوشتن همه
 *     سنجیده می‌شوند (کاتالوگ، نوع، scope، تکرار)، حالِ پیشینِ هر پرچم برداشته می‌شود، نوشتن‌ها یکی‌یکی و پشتِ یک قفل،
 *     و شکستِ هر کدام ⇒ برگرداندنِ همه به حالِ پیشین. هر پرچم ردیفِ خودش را در دفتر دارد با دلیلِ مشترک و شناسهٔ دسته
 *     (`auditMany` ⇒ همه یا هیچ در دفتر هم).
 *  ⛔ نوشتنِ نامِ کلید فقط وقتی scope همهٔ دکان‌ها (‎all‎/‎security‎) است یا پرچم در فهرستِ پرخطر است
 *     (`flagConfirmPhrase`؛ همان قاعده در ‎web/src/modules/shop/consoleData.ts‎ ⇐ `flagConfirmPhrase`).
 */
const BATCH_MAX = 100;
const KEY_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

/**
 * متنی که آدم برای تأییدِ دستهٔ پرخطر می‌نویسد: یک پرچم ⇒ نامِ همان کلید (همان پنجرهٔ پیشین)؛ چند پرچم ⇒ نامِ
 * scope (‎all‎، ‎security‎ یا شناسهٔ دکان) — نه بیست بار نوشتنِ بیست کلید. بی پرچمِ پرخطر ⇒ `null` (فقط تأییدِ خلاصه).
 */
export function flagConfirmPhrase(scope, riskyKeys) {
  const keys = [...new Set((riskyKeys || []).map(String))];
  if (!keys.length) return null;
  return keys.length === 1 ? keys[0] : String(scope);
}

export function sudoView(sessionId) {
  const st = panelAuth.sudoState(sessionId);
  return {
    ...(st.open ? { open: true, openedAt: st.openedAt, until: st.until, idleUntil: st.idleUntil, hardUntil: st.hardUntil } : { open: false }),
    idleMs: panelAuth.SUDO_IDLE_MS, maxMs: panelAuth.SUDO_MAX_MS, serverTime: Date.now(),
  };
}

/**
 * پرچمِ پرخطر ⇒ «حالتِ تغییر» ِ باز (بی رمز) یا همان احرازِ دوبارهٔ همیشگی (سقفِ نرخ + `bodyStepUp`) — پیش از هر
 * درخواست به سرورِ حساب. احرازِ کاملِ همین درخواست پنجره را باز می‌کند؛ «نشستِ تازه» ِ بی رمز بازش نمی‌کند.
 * (۱.۵۱.۲) درِ «اعلانِ گوشی» (`console-push.js`) هم همین را با `() => true` دارد — همان پنجره، همان رمز.
 */
export function flagStepUp(needs) {
  return (req, res, next) => {
    if (!needs(req)) return next();
    const sid = req.user?.sessionId;
    const pw = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!pw && panelAuth.sudoState(sid).open) {
      res.locals.reauthed = true;
      res.locals.viaSudo = true;
      return next();
    }
    return reauthLimit(req, res, () => reauth(req, res, () => {
      if (res.locals.reauthVerified === true && sid) {
        const st = panelAuth.openSudo(sid);
        res.locals.sudoOpened = true;
        audit({ actor: actorOf(req), action: 'account.flag.sudo_opened', entity: 'flag', detail: { via: req.path, until: st.until || null } });
      }
      next();
    }));
  };
}
const singleRisky = (req) => isRiskyFlag(String(req.body?.key || '').trim(), String(req.body?.scope ?? '').trim() || 'all');
const batchRisky = (req) => {
  const scope = String(req.body?.scope ?? '').trim() || 'all';
  const changes = Array.isArray(req.body?.changes) ? req.body.changes : [];
  return isRiskyFlag('', scope) || changes.some((c) => isRiskyFlag(String(c?.key || '').trim(), scope));
};
/** پس از نوشتنِ موفق: پنجرهٔ باز می‌لغزد (فعالیت = تغییرِ پرچم، نه خواندن). */
const slideSudo = (req) => panelAuth.touchSudo(req.user?.sessionId);

/** نوشتن‌های پرچم یکی‌یکی — دو دستهٔ هم‌زمان (دو زبانه) حالِ پیشینِ هم را خراب نمی‌کنند. */
let flagChain = Promise.resolve();
function serialFlags(fn) {
  const run = flagChain.then(fn, fn);
  flagChain = run.then(() => {}, () => {});
  return run;
}

/** شکلِ دسته، پیش از احرازِ دوباره (کدِ دوعاملی برای درخواستِ بدشکل سوزانده نمی‌شود) و پیش از سرورِ حساب. */
function batchShape(req, res, next) {
  const bad = (error, message, status = 400) => res.status(status).json({ error, message });
  const b = req.body || {};
  const scope = String(b.scope ?? '').trim();
  if (!scope || !ID_RE.test(scope)) return bad('bad_flag_scope', 'scope را بگویید: «all» یا شناسهٔ یک دکان (یا scope ِ خودِ پرچم)');
  const reason = String(b.reason ?? '').trim();
  if (reason.length < 3 || reason.length > 200) return bad('reason_required', 'دلیل را بنویسید (۳ تا ۲۰۰ نویسه) — در دفترِ رخداد می‌ماند');
  if (b.confirm !== true) return bad('confirm_required', 'این کار پیش از فرستادن تأیید می‌خواهد');
  const list = b.changes;
  if (!Array.isArray(list) || !list.length) return bad('no_changes', 'هیچ تغییری نیامد');
  if (list.length > BATCH_MAX) return bad('too_many_changes', `در هر دسته حداکثر ${BATCH_MAX} پرچم`);
  const seen = new Set();
  const changes = [];
  for (const c of list) {
    const key = typeof c?.key === 'string' ? c.key.trim() : '';
    if (!KEY_RE.test(key)) return bad('bad_flag_key', 'نامِ پرچم درست نیست');
    if (seen.has(key)) return bad('duplicate_flag', `«${key}» دو بار در یک دسته آمده است`);
    seen.add(key);
    if (c.reset === true && c.value === undefined) changes.push({ key, reset: true });
    else if (c.reset === undefined && typeof c.value === 'boolean') changes.push({ key, value: c.value });
    else return bad('bad_flag_value', `مقدارِ «${key}» «روشن» یا «خاموش» است، یا «بازگشت به پیش‌فرض»`);
  }
  res.locals.batch = { scope, reason, changes };
  return next();
}

/** خطای دسته با جزئیاتش (کدام پرچم، چه برگشت، چه ماند)؛ بقیه همان `bridgeFail`. */
function batchFail(res, err) {
  if (err?.expose) return res.status(err.status || 502).json({ error: err.code, message: err.message, ...err.expose });
  return bridgeFail(res, err);
}

/** شکستِ نوشتن «مبهم» است (شاید رسیده باشد)؟ ⇒ برگرداندنش هم لازم است. ردِ صریحِ ۴xx یعنی ننشست. */
const maybeLanded = (err) => err?.outcome === 'unknown' || !(Number(err?.status) >= 400 && Number(err?.status) < 500);

async function writeFlag(scope, c, reason) {
  if (c.reset) return cloudRaw('DELETE', '/api/admin/flags', { body: { scope, key: c.key, reason } });
  return cloudRaw('PUT', '/api/admin/flags', { body: { scope, key: c.key, value: c.value, reason } });
}
/** برگرداندنِ یک پرچم به حالِ پیشینش: نوشته بود ⇒ همان مقدار؛ نوشته نبود ⇒ پاک. */
async function restoreFlag(scope, p, reason) {
  if (p.prior.set) return cloudRaw('PUT', '/api/admin/flags', { body: { scope, key: p.key, value: p.prior.value, reason } });
  return cloudRaw('DELETE', '/api/admin/flags', { body: { scope, key: p.key, reason } });
}

/* ═══════════════════════════════ سوار کردن ═══════════════════════════════ */

/**
 * درهای پوسته را روی همان روترِ پل (`routes/account-admin.js`) سوار می‌کند — پیش از «هر چیزِ دیگری ۴۰۴».
 * @param {import('express').Router} router
 */
export function mountConsoleShell(router) {
  /* ── فهرستِ ماژول‌ها (بی سرورِ حساب) ── */
  router.get('/console/modules', (req, res) => {
    const role = roleOf(req);
    const mods = modulesFor(role);
    const groups = CONSOLE_GROUPS.filter((g) => mods.some((m) => m.group === g.id));
    res.json({
      role, owner: isPanelOwner(req), groups,
      modules: mods.map(({ id, spec, group, order, minRole, label, probe }) => ({ id, spec, group, order, minRole, label, built: Boolean(probe) })),
      at: Date.now(),
    });
  });

  /* ── داشبورد: یک کارت برای هر ماژولِ دیدنی ── */
  router.get('/console/summary', requireModule('dash'), guard(async (req, res) => {
    const role = roleOf(req);
    const memo = new Map();
    const ctx = {
      role, req,
      get(path, query = {}) {
        const k = `${path}?${new URLSearchParams(query)}`;
        if (!memo.has(k)) memo.set(k, cloudRaw('GET', path, { query }));
        return memo.get(k);
      },
    };
    const mods = modulesFor(role).filter((m) => m.id !== 'dash');
    const items = await Promise.all(mods.map(async (m) => {
      const fn = SUMMARIES[m.id];
      if (!fn) return { module: m.id, ok: false, reason: m.probe ? 'no_summary' : 'not_built' };
      try {
        const out = await withTimeout(Promise.resolve(fn(ctx)), 8000);
        return {
          module: m.id, ok: true, source: out.source, at: out.at || null, receivedAt: Date.now(),
          metrics: Array.isArray(out.metrics) ? out.metrics : [], alerts: Array.isArray(out.alerts) ? out.alerts : [],
        };
      } catch (e) {
        return { module: m.id, ok: false, reason: 'error', error: { code: e.code || 'cloud_error', message: e.message || '' } };
      }
    }));
    const rank = { bad: 0, warn: 1, info: 2 };
    const alerts = items.flatMap((it) => (it.alerts || []).map((a) => ({ ...a, module: it.module, source: it.source, at: it.at || it.receivedAt })))
      .sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3));
    res.json({ items, alerts, fetchedAt: Date.now() });
  }));

  /* ── جست‌وجوی سراسری ── */
  router.get('/console/search', requireModule('dash'), guard(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2 || q.length > 80) throw fail('bad_query', 400, 'دو تا هشتاد نویسه بنویسید');
    const role = roleOf(req);
    const visible = new Set(modulesFor(role).map((m) => m.id));
    //  نوعِ نتیجه ⇐ ماژولی که پیوندش به آن‌جا می‌رود؛ ماژولِ نادیدنی ⇒ آن نوع هم نه
    const KIND_MODULE = { shops: 'shops', users: 'shops', payments: 'finance', orders: 'finance', errors: 'health', admins: 'users' };
    const sources = [];
    const add = (kind, p) => sources.push(withTimeout(p, 8000).then(
      (items) => ({ kind, module: KIND_MODULE[kind] || kind, ok: true, items }),
      (e) => ({ kind, module: KIND_MODULE[kind] || kind, ok: false, error: { code: e.code || 'cloud_error', message: e.message || '' } }),
    ));

    let caps = null;
    try { caps = await withTimeout(capsOf(), 8000); } catch { caps = null; }
    if (caps && caps.list.includes('search.v1')) {
      const out = withTimeout(cloudRaw('GET', '/api/admin/search', { query: { q, limit: 5 } }), 8000);
      for (const kind of ['shops', 'users', 'payments', 'orders', 'errors', 'admins']) {
        if (!visible.has(KIND_MODULE[kind])) continue;
        add(kind, out.then((r) => {
          if (!Array.isArray(r?.kinds) || !r.kinds.includes(kind)) throw fail('not_for_role', 403, 'سرورِ حساب این نوع را برای این نقش نمی‌دهد');
          return Array.isArray(r.results?.[kind]) ? r.results[kind] : [];
        }));
      }
    } else {
      //  سرورِ حسابِ پیش از `search.v1`: فقط دو درِ پیشینِ جست‌وجودار؛ بقیه صریح «پشتیبانی نمی‌شود»
      if (visible.has('shops')) {
        add('shops', cloudRaw('GET', '/api/admin/shops', { query: { q, limit: 5 } }).then((r) => (Array.isArray(r?.shops) ? r.shops : [])));
        add('users', cloudRaw('GET', '/api/admin/users', { query: { q, limit: 5 } }).then((r) => (Array.isArray(r?.users) ? r.users : [])));
      }
      for (const kind of ['payments', 'orders', 'errors', 'admins']) {
        if (!visible.has(KIND_MODULE[kind])) continue;
        sources.push(Promise.resolve({ kind, module: KIND_MODULE[kind], ok: false,
          error: { code: caps ? 'capability_missing' : 'account_server_unreachable', message: caps ? `سرورِ حساب هنوز ${NEEDS['search.v1']} را ندارد` : 'سرورِ حساب جواب نداد' } }));
      }
    }
    //  کاربرانِ خودِ پنل — از پایگاهِ پنل، فقط برای admin (همان درِ ‎/api/auth/users‎)
    if (panelRoles.atLeast(role, 'admin')) {
      const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = db.prepare("SELECT id, username, role, disabled FROM users WHERE lower(username) LIKE ? ESCAPE '\\' ORDER BY id LIMIT 5").all(like);
      sources.push(Promise.resolve({ kind: 'panelUsers', module: 'users', ok: true, items: rows.map((r) => ({ ...r, disabled: Boolean(r.disabled) })) }));
    }
    res.json({ q, results: await Promise.all(sources), searchCapability: Boolean(caps?.list.includes('search.v1')), fetchedAt: Date.now() });
  }));

  /* ═══ ۴.۳ — مدیرانِ سرورِ حساب ═══ */

  const ADMIN_ROLES = ['superadmin', 'admin', 'finance', 'viewer'];

  async function adminsNow() {
    const [list, caps] = await Promise.all([
      cloudRaw('GET', '/api/admin/admins', { legacyOnly: true }),
      capsOf({ legacyOnly: true }).catch(() => ({ list: [], me: null })),
    ]);
    return { admins: Array.isArray(list?.admins) ? list.admins : [], caps: caps.list, bridge: caps.me?.admin || null };
  }

  router.get('/console/admins', requireModule('users'), guard(async (req, res) => {
    const blocked = adminsBlocked();
    if (blocked) return res.json(blocked);
    const now = await adminsNow();
    res.json({
      available: true,
      admins: now.admins.map((a) => ({
        id: a.id, username: a.username, name: a.name || '', role: a.role, status: a.status,
        isOwner: a.is_owner === true, createdAt: Number(a.created_at) || null,
        bridge: Boolean(now.bridge && now.bridge.id === a.id),
      })),
      roles: ADMIN_ROLES,
      sessionsSupported: now.caps.includes('admin-sessions.v1'),
      panelOwner: isPanelOwner(req),
      source: '/api/admin/admins',
      fetchedAt: Date.now(),
    });
  }));

  const writeGate = [requireModule('users'), requireRole('admin'), ownerOnly('account_admin'), reauthLimit, reauth];

  router.post('/console/admins', ...writeGate, guard(async (req, res) => {
    const reason = reasonOf(req);
    requireConfirm(req);
    const username = String(req.body?.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw fail('bad_username', 400, 'نامِ کاربری ۳ تا ۴۰ نویسه: حروفِ کوچکِ انگلیسی، رقم و . _ -');
    //  ⛔ بی پیش‌فرض: نقش باید صریح انتخاب شود (رابط «فقط‌خواندن» را پیشنهاد می‌کند)
    const role = String(req.body?.role || '');
    if (!ADMIN_ROLES.includes(role)) throw fail('role_required', 400, 'نقش را انتخاب کنید');
    const adminPassword = typeof req.body?.adminPassword === 'string' ? req.body.adminPassword : '';
    if (adminPassword.length < 10) throw fail('weak_password', 400, 'رمزِ مدیرِ تازه دستِ‌کم ۱۰ نویسه');
    const name = String(req.body?.name || '').trim().slice(0, 60);
    const blocked = adminsBlocked();
    if (blocked) throw fail('not_linked', 409, blocked.message);
    await once(req, res, async () => {
      const out = await cloudRaw('POST', '/api/admin/admins', { legacyOnly: true, body: { username, name, password: adminPassword, role, reason } });
      const a = out?.admin || {};
      audit({ actor: actorOf(req), action: 'account.admin.created', entity: 'account_admin', entityId: a.id || null, detail: { username, role: a.role || role, reason } });
      return { ok: true, admin: { id: a.id, username: a.username, name: a.name || '', role: a.role }, confirmedByServer: true };
    });
  }));

  router.post('/console/admins/:id/update', ...writeGate, guard(async (req, res) => {
    const id = idOf(req.params.id);
    const reason = reasonOf(req);
    requireConfirm(req);
    const to = {};
    if (req.body?.role !== undefined) {
      if (!ADMIN_ROLES.includes(String(req.body.role))) throw fail('bad_role', 400, 'نقش درست نیست');
      to.role = String(req.body.role);
    }
    if (req.body?.status !== undefined) {
      if (!['active', 'disabled'].includes(String(req.body.status))) throw fail('bad_status', 400, 'وضعیت «active» یا «disabled»');
      to.status = String(req.body.status);
    }
    if (!Object.keys(to).length) throw fail('nothing', 400, 'چیزی برای عوض کردن نیامد');
    const blocked = adminsBlocked();
    if (blocked) throw fail('not_linked', 409, blocked.message);
    await once(req, res, async () => {
      const now = await adminsNow();
      const target = now.admins.find((a) => a.id === id);
      if (!target) throw fail('not_found', 404, 'مدیر پیدا نشد');
      //  ⛔ مالکِ اصلیِ سرورِ حساب: هرگز (سرورِ حساب هم ۴۰۳ می‌دهد — این‌جا پیش از فرستادن)
      if (target.is_owner === true) {
        audit({ actor: actorOf(req), action: 'account.admin.owner_protected', entity: 'account_admin', entityId: id, result: 'forbidden', detail: { to, reason } });
        throw fail('owner_protected', 403, 'مالکِ اصلیِ سرورِ حساب تعلیق یا تنزل داده نمی‌شود');
      }
      //  ⛔ حسابی که خودِ پل با آن وارد می‌شود: تعلیق/تنزلش پل را می‌بُرد
      if (now.bridge && now.bridge.id === id) throw fail('bridge_account', 409, 'این همان حسابِ ارشدی است که پل با آن وارد می‌شود — عوض کردنش پل را قطع می‌کند');
      const out = await cloudRaw('PATCH', `/api/admin/admins/${id}`, { legacyOnly: true, body: { ...to, reason } });
      const row = out?.admin || {};
      audit({
        actor: actorOf(req), action: 'account.admin.updated', entity: 'account_admin', entityId: id,
        detail: { username: target.username, from: { role: target.role, status: target.status }, to: { role: row.role, status: row.status }, reason },
      });
      return { ok: true, admin: { id, username: row.username, role: row.role, status: row.status }, confirmedByServer: true };
    });
  }));

  router.get('/console/admins/:id/sessions', requireModule('users'), guard(async (req, res) => {
    const id = idOf(req.params.id);
    const blocked = adminsBlocked();
    if (blocked) return res.json(blocked);
    const caps = await capsOf({ legacyOnly: true });
    if (!caps.list.includes('admin-sessions.v1')) {
      return res.json(unavailable('capability_missing', { capability: 'admin-sessions.v1', needs: NEEDS['admin-sessions.v1'] }));
    }
    const out = await cloudRaw('GET', `/api/admin/admins/${id}/sessions`, { legacyOnly: true });
    res.json({ available: true, sessions: Array.isArray(out?.sessions) ? out.sessions : [], serverTime: out?.serverTime || null, fetchedAt: Date.now() });
  }));

  router.post('/console/admins/:id/sessions/revoke', ...writeGate, guard(async (req, res) => {
    const id = idOf(req.params.id);
    const reason = reasonOf(req);
    requireConfirm(req);
    const sessionId = req.body?.sessionId ? String(req.body.sessionId) : '';
    if (sessionId && !/^[0-9a-f]{16}$/.test(sessionId)) throw fail('bad_session_id', 400, 'شناسهٔ نشست درست نیست');
    const blocked = adminsBlocked();
    if (blocked) throw fail('not_linked', 409, blocked.message);
    await once(req, res, async () => {
      const caps = await capsOf({ legacyOnly: true });
      if (!caps.list.includes('admin-sessions.v1')) throw fail('capability_missing', 501, `سرورِ حساب هنوز ${NEEDS['admin-sessions.v1']} را ندارد — به‌روزش کنید`);
      const out = await cloudRaw('POST', `/api/admin/admins/${id}/sessions/revoke`, { legacyOnly: true, body: { ...(sessionId ? { sessionId } : {}), reason } });
      audit({ actor: actorOf(req), action: 'account.admin.sessions_revoked', entity: 'account_admin', entityId: id, detail: { session: sessionId || 'all', revoked: Number(out?.revoked) || 0, reason } });
      return { ok: true, revoked: Number(out?.revoked) || 0, confirmedByServer: true };
    });
  }));

  /* ═══ ۴.۱۲ — پرچم‌های شناخته ═══ */

  const flagGate = [requireModule('settings'), requireRole('admin')];

  //  ⛔ درِ تکیِ پیشین — شکلِ درخواست و پاسخ همان است (صداکننده‌های کهنه، «پرچمِ ویترین» ِ بازار)؛ فقط «حالتِ تغییر» را
  //  هم می‌شناسد: پنجرهٔ باز ⇒ بی رمز؛ رمزِ درستِ همین درخواست ⇒ پنجره باز می‌شود.
  router.put('/console/flags', ...flagGate, flagStepUp(singleRisky), guard(async (req, res) => {
    const key = String(req.body?.key || '').trim();
    const reason = reasonOf(req);
    requireConfirm(req);
    if (typeof req.body?.value !== 'boolean') throw fail('bad_flag_value', 400, 'مقدارِ پرچم «روشن» یا «خاموش» است');
    const caps = await capsOf();
    if (!caps.list.includes('flags.v1')) throw fail('capability_missing', 501, `سرورِ حساب هنوز ${NEEDS['flags.v1']} را ندارد`);
    const k = await knownFlag(key);
    const scope = scopeFor(k, req.body?.scope);
    const risky = riskyGate(req, res, key, scope);
    await once(req, res, () => serialFlags(async () => {
      const out = await cloudRaw('PUT', '/api/admin/flags', { body: { scope, key, value: req.body.value, reason } });
      if (res.locals.viaSudo) slideSudo(req);
      audit({ actor: actorOf(req), action: 'account.flag.set', entity: 'flag', entityId: `${scope}:${key}`,
        detail: { scope, key, to: req.body.value, risky, reason, ...(res.locals.viaSudo ? { viaSudo: true } : {}) } });
      return { ok: true, scope: out?.scope || scope, key: out?.key || key, to: req.body.value, confirmedByServer: true, fetchedAt: Date.now() };
    }));
  }));

  router.post('/console/flags/reset', ...flagGate, flagStepUp(singleRisky), guard(async (req, res) => {
    const key = String(req.body?.key || '').trim();
    const reason = reasonOf(req);
    requireConfirm(req);
    const caps = await capsOf();
    if (!caps.list.includes('flags.v1')) throw fail('capability_missing', 501, `سرورِ حساب هنوز ${NEEDS['flags.v1']} را ندارد`);
    const k = await knownFlag(key);
    const scope = scopeFor(k, req.body?.scope);
    const risky = riskyGate(req, res, key, scope);
    await once(req, res, () => serialFlags(async () => {
      const out = await cloudRaw('DELETE', '/api/admin/flags', { body: { scope, key, reason } });
      if (res.locals.viaSudo) slideSudo(req);
      audit({ actor: actorOf(req), action: 'account.flag.reset', entity: 'flag', entityId: `${scope}:${key}`,
        detail: { scope, key, removed: out?.removed === true, risky, reason, ...(res.locals.viaSudo ? { viaSudo: true } : {}) } });
      return { ok: true, removed: out?.removed === true, confirmedByServer: true, fetchedAt: Date.now() };
    }));
  }));

  /* ── «حالتِ تغییر»: دیدن، باز کردن با رمز (و کد)، بستن ── */
  router.get('/console/flags/sudo', ...flagGate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(sudoView(req.user?.sessionId));
  });

  router.post('/console/flags/sudo', ...flagGate, reauthLimit, (req, res, next) => {
    if (typeof req.body?.password !== 'string' || !req.body.password) {
      return res.status(400).json({ error: 'password_required', message: 'رمزِ پنلِ خودتان را بزنید' });
    }
    return next();
  }, reauth, (req, res) => {
    //  رمزِ درست بی کد روی حسابِ دوعاملی‌دار (نشستِ تازه) ⇒ کار رد نمی‌شود ولی پنجره هم باز نمی‌شود
    if (res.locals.reauthVerified !== true) {
      return res.status(400).json({ error: 'totp_required', totpRequired: true, message: 'کدِ شش‌رقمیِ دوعاملی را هم بزنید' });
    }
    const st = panelAuth.openSudo(req.user?.sessionId);
    audit({ actor: actorOf(req), action: 'account.flag.sudo_opened', entity: 'flag', detail: { via: 'sudo', until: st.until || null } });
    res.setHeader('Cache-Control', 'no-store');
    res.json(sudoView(req.user?.sessionId));
  });

  router.delete('/console/flags/sudo', ...flagGate, (req, res) => {
    const was = panelAuth.sudoState(req.user?.sessionId).open;
    panelAuth.closeSudo(req.user?.sessionId);
    if (was) audit({ actor: actorOf(req), action: 'account.flag.sudo_closed', entity: 'flag', detail: { by: 'user' } });
    res.json(sudoView(req.user?.sessionId));
  });

  /* ── تغییرِ دسته‌ای: یک scope، یک دلیل، یک درخواست، همه یا هیچ ── */
  router.post('/console/flags/batch', ...flagGate, batchShape, flagStepUp(batchRisky), async (req, res) => {
    try {
      const { scope, reason, changes } = res.locals.batch;
      const caps = await capsOf();
      if (!caps.list.includes('flags.v1')) throw fail('capability_missing', 501, `سرورِ حساب هنوز ${NEEDS['flags.v1']} را ندارد`);
      //  کاتالوگ و حالِ امروزِ همین scope در یک خواندن — پیش از هر نوشتن
      const cur = await cloudRaw('GET', '/api/admin/flags', { query: { scope } });
      const known = Array.isArray(cur?.known) ? cur.known : [];
      const items = new Map((Array.isArray(cur?.items) ? cur.items : []).filter((x) => x && typeof x.key === 'string').map((x) => [x.key, x.value]));
      const plan = changes.map((c) => {
        const k = knownIn(known, c.key);
        scopeFor(k, scope);
        return { ...c, risky: isRiskyFlag(c.key, scope), prior: items.has(c.key) ? { set: true, value: items.get(c.key) } : { set: false } };
      });
      const riskyKeys = plan.filter((p) => p.risky).map((p) => p.key);
      //  ⛔ کمربندِ دوم (همان `riskyGate`): پرخطر بی احراز یا پنجره، همین‌جا می‌ایستد
      if (riskyKeys.length && res.locals.reauthed !== true) throw fail('reauth_required', 403, 'برای این کار رمزِ پنلِ خودتان را دوباره بزنید');
      const phrase = flagConfirmPhrase(scope, riskyKeys);
      if (phrase && String(req.body?.confirmText ?? '') !== phrase) {
        throw fail('confirm_text_required', 400, `این تغییر روی همهٔ دکان‌ها یا پول/امنیت اثر دارد — برای تأیید «${phrase}» را بنویسید`, { expose: { expected: phrase } });
      }
      await once(req, res, () => serialFlags(() => applyBatch(req, res, scope, reason, plan)));
    } catch (err) {
      batchFail(res, err);
    }
  });
}

/** کاتالوگِ همان خواندن — همان قاعده‌های `knownFlag`. */
function knownIn(known, key) {
  const k = known.find((x) => x && x.key === key);
  if (!k) throw fail('unknown_flag', 400, `«${key}» در کاتالوگِ سرورِ حساب نیست — از کنسول فقط پرچمِ شناخته عوض می‌شود`, { expose: { key } });
  if (Array.isArray(k.default) || k.scope === 'release') throw fail('use_versions_module', 400, 'فهرستِ کانالِ آزمایشی از «نسخه‌ها و انتشار» عوض می‌شود', { expose: { key } });
  if (typeof k.default !== 'boolean') throw fail('unsupported_flag_type', 400, `نوعِ «${key}» در کنسول پشتیبانی نمی‌شود`, { expose: { key } });
  return k;
}

/**
 * نوشتنِ دسته — همه یا هیچ. سرورِ حساب درِ دسته‌ای ندارد (هر `PUT /api/admin/flags` تراکنشِ خودش است)، پس «هیچ» با
 * برگرداندن ساخته می‌شود: هر پرچمِ نشسته (و پرچمِ شکسته‌ای که شاید نشسته باشد) به حالِ پیشینش. اگر برگرداندنی هم نشد،
 * پاسخ دقیق می‌گوید کدام پرچم‌ها هنوز عوض‌شده‌اند — هرگز «انجام شد» یا «هیچ» ِ دروغ.
 */
async function applyBatch(req, res, scope, reason, plan) {
  const batchId = `fb-${crypto.randomBytes(8).toString('hex')}`;
  const actor = actorOf(req);
  const viaSudo = res.locals.viaSudo === true;
  const done = [];
  let broken = null;
  for (const p of plan) {
    try {
      const out = await writeFlag(scope, p, reason);
      done.push({ ...p, removed: out?.removed === true });
    } catch (err) {
      broken = { p, err };
      break;
    }
  }
  const rowOf = (p, result = 'ok') => ({
    actor, action: p.reset ? 'account.flag.reset' : 'account.flag.set', entity: 'flag', entityId: `${scope}:${p.key}`, result,
    detail: {
      scope, key: p.key, from: p.prior.set ? p.prior.value : null, ...(p.reset ? { removed: p.removed === true } : { to: p.value }),
      risky: p.risky, reason, batch: batchId, of: plan.length, ...(viaSudo ? { viaSudo: true } : {}),
    },
  });

  if (!broken) {
    if (viaSudo) slideSudo(req);
    const audited = auditMany(done.map((p) => rowOf(p)));
    return {
      ok: true, batchId, scope, count: done.length, confirmedByServer: true, audited,
      applied: done.map((p) => (p.reset ? { key: p.key, reset: true, removed: p.removed === true } : { key: p.key, to: p.value })),
      sudo: sudoView(req.user?.sessionId), fetchedAt: Date.now(),
    };
  }

  //  ── شکست: برگرداندن به ترتیبِ وارونه ──
  const undo = [...done].reverse();
  if (maybeLanded(broken.err)) undo.unshift(broken.p);
  const undoReason = `برگشتِ خودکارِ دستهٔ ${batchId}`;
  const stuck = [];
  for (const p of undo) {
    try { await restoreFlag(scope, p, undoReason); } catch (e) { stuck.push({ p, code: e?.code || 'cloud_error', unknown: e?.outcome === 'unknown' }); }
  }
  const cause = { key: broken.p.key, code: broken.err?.code || 'cloud_error', message: broken.err?.message || '', ...(broken.err?.outcome === 'unknown' ? { outcome: 'unknown' } : {}) };
  if (!stuck.length) {
    audit({ actor, action: 'account.flag.batch_rolled_back', entity: 'flag', entityId: scope, result: 'failed',
      detail: { scope, batch: batchId, keys: plan.map((p) => p.key), cause, rolledBack: undo.map((p) => p.key), reason } });
    const st = Number(broken.err?.status);
    throw fail('batch_rolled_back', st >= 400 && st < 500 ? st : 502,
      `«${cause.key}» در سرورِ حساب نشست (${cause.code}) — هیچ تغییری نماند؛ ${undo.length ? 'آن‌چه نشسته بود برگشت' : 'چیزی نوشته نشده بود'}`,
      { expose: { batchId, cause, applied: [], rolledBack: undo.map((p) => p.key) } });
  }
  //  ⛔ برگرداندنِ بخشی نشد: آن‌چه ماند تغییرِ واقعی است ⇒ ردیفِ خودش در دفتر، و پاسخ دقیق
  const stuckKeys = new Set(stuck.map((x) => x.p.key));
  auditMany([
    ...done.filter((p) => stuckKeys.has(p.key)).map((p) => rowOf(p, 'partial')),
    { actor, action: 'account.flag.batch_partial', entity: 'flag', entityId: scope, result: 'partial',
      detail: { scope, batch: batchId, cause, stillChanged: [...stuckKeys], reason } },
  ]);
  throw fail('batch_partial', 502,
    `«${cause.key}» نشست و برگرداندنِ ${stuck.length} پرچم هم نشد — پیش از تکرار، پرچم‌ها را ببینید`,
    { expose: { batchId, cause, stillChanged: stuck.map((x) => ({ key: x.p.key, code: x.code, ...(x.unknown ? { outcome: 'unknown' } : {}) })) } });
}

export { moduleById };
