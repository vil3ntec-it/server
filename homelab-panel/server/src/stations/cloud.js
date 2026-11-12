// ---------------------------------------------------------------------------
//  پلِ «مرکز فرمان» به بخشِ پمپِ سرورِ ابر
//
//  خواستهٔ صاحب ریپو: «بخشِ پمپ‌بنزین تو برنامهٔ سرور هیچی نداره که اشتراک
//  بدم به اپ و ببینم افراد رو، اشتراک‌هاشون و غیره. بخشِ فروشگاه خیلی
//  تکمیل است، شبیه همون باشه.»
//
//  ── چرا پل، و نه یک دفترِ تازه این‌جا ─────────────────────────────────
//  اشتراکِ پمپ روی سرورِ ابر زندگی می‌کند؛ همان‌جا که برنامهٔ کامپیوتر
//  مجوزش را می‌گیرد و همان‌جا که کدِ شش‌رقمی خرج می‌شود. اگر این‌جا هم
//  یک دفترِ اشتراک می‌ساختیم، دو حقیقتِ جدا می‌داشتیم و روزی یکی‌شان
//  می‌گفت «فعال» و آن یکی «تمام شده».
//
//  پس مرکز فرمان چیزی را نگه نمی‌دارد جز یک توکن، و بقیه را از ابر
//  می‌پرسد.
//
//  ⚠️ نشانیِ ابر این‌جا هم **قفل** است — همان قاعده‌ای که اپ و برنامهٔ
//  کامپیوتر دارند. اگر از تنظیمات خوانده می‌شد، هر کسی می‌توانست پنل را
//  به سرورِ خودش ببرد و رمزِ مدیر را آن‌جا بفرستد.
//
//  ⚠️ «ابر» همان **سرورِ حساب** است، روی همین کامپیوترِ خانگی (از
//  ۱۴۰۵/۰۷/۰۲): تونلِ api.<دامنه> به پورتِ عمومیِ همین پنل می‌رسد و
//  درگاهِ ‎api/account-proxy.js‎ آن را به shop/server می‌برد. پس این پل
//  وقتی درگاه روشن است **مستقیم** همان نشانیِ محلی را می‌زند
//  (‎cloudTarget()‎) — نه این‌که از اینترنت بیرون برود، از تونل برگردد و
//  به خودش برسد. تونلِ خاموش یا اینترنتِ قطع دیگر پل را نمی‌خواباند.
//  نشانیِ عمومی فقط وقتی زده می‌شود که درگاه خاموش باشد (HLP_ACCOUNT_API=0).
//
//  ⚠️ و پل خودش وارد می‌شود اگر نام و رمزِ مدیرِ سرورِ حساب در ‎.env‎ باشد
//  (‎HLP_ACCOUNT_ADMIN_USER‎ / ‎HLP_ACCOUNT_ADMIN_PASSWORD‎). تا پیش از این
//  صاحبِ سامانه باید هر دوازده ساعت (عمرِ توکنِ مدیر) دوباره در پنل وارد
//  می‌شد، وگرنه اپِ مدیریت «وصل نشده‌اید» می‌گفت. آن دو مقدار همان‌هایی‌اند
//  که در ‎shop/server/.env‎ روی همین دیسک هست؛ توکنِ خودکار فقط در حافظه
//  می‌ماند و با هر ۴۰۱ یک بار تازه می‌شود.
//
//  ⚠️ **فهرستِ سفیدِ مسیرها**: پنل فقط همین چند مسیر را می‌تواند صدا
//  بزند. بی این، یک پروکسیِ باز می‌داشتیم که هر مسیرِ مدیریتیِ ابر —
//  از جمله بخشِ دکان — را با توکنِ مدیر باز می‌کرد.
// ---------------------------------------------------------------------------
import { putSecret, listSecrets, readSecret, deleteSecret, vaultReady } from '../control/vault.js';
import { config } from '../config.js';
import { accountApiUrl, downPayload } from '../api/account-proxy.js';
import { managedAdminCreds } from '../account/supervisor.js';
import { readServiceKey, actorHeaders, SYSTEM_ACTOR, SERVICE_KEY_RE } from '../account/service-key.js';
import { makeBodyGate, bodyGateConfig, BODY_FREE_BYTES } from './body-gate.js';

/** نشانیِ عمومیِ سرورِ حساب — قفل، نه از تنظیمات. همان که برنامه‌ها می‌زنند. */
export const CLOUD_BASE = 'https://api.vill3n.top';

/**
 * نشانی‌ای که این پل واقعاً زنگ می‌زند.
 *
 * درگاه روشن ⇒ سرورِ حساب روی همین کامپیوتر (‎config.accountApi.url‎)؛
 * خاموش ⇒ راهِ تونل، همان ‎CLOUD_BASE‎. برای آزمون می‌شود با
 * ‎HLP_ACCOUNT_API‎ به یک سرورِ ساختگی برد — همان کاری که
 * ‎test/account-gateway.mjs‎ با درگاه می‌کند.
 */
export function cloudTarget() {
  const local = accountApiUrl();
  return local ? local.href.replace(/\/+$/, '') : CLOUD_BASE;
}

/** نام و رمزِ مدیرِ سرورِ حساب از ‎.env‎ — اگر هر دو باشند، پل خودش وارد می‌شود. */
function autoCreds() {
  //  تنظیمِ صریح جلوتر؛ وگرنه همان مدیری که ناظرِ سرورِ حساب خودش ساخته
  //  (account/supervisor.js) — یعنی با نصبِ تازه هیچ چیزی دستی تنظیم نمی‌شود.
  try { return managedAdminCreds(); } catch { return null; }
}

/*
 *  ⏱️ **مهلتِ پل** (۱.۵۰.۷۵، ممیزی §۹ «باقی‌مانده»). تا پیش از این هیچ درخواستِ پل مهلتِ خودش را نداشت و فقط
 *  مهلتِ پیش‌فرضِ fetch ِ Node (undici: سرآیند و بدنه هر کدام ۳۰۰ ثانیه) بود ⇒ سرورِ حسابِ گیرکرده هر صفحه و هر
 *  ربات را پنج دقیقه نگه می‌داشت، و پشتیبانِ کُند «شکست» نشان داده می‌شد با این‌که شاید ساخته شده بود.
 *
 *  ⛔ هر درخواست یک ‎AbortSignal‎ دارد (‎AbortSignal.timeout‎، و اگر صداکننده ‎signal‎ داد، هر دو) که **تا پایانِ
 *     خواندنِ بدنه** زنده است — نه فقط تا سرآیند؛ بدنهٔ نیمه‌کاره دیگر «{}» ِ موفق نمی‌شود (`readBody`).
 *  ⛔ عادی ‎30s‎؛ «بلند» فقط برای کاری که واقعاً طول می‌کشد (‎POST /api/admin/backups‎ = یک pg_dump، و جابه‌جاییِ
 *     بایتِ رسانهٔ پشتیبانی تا ۲۵ مگابایت در `cloudRawBytes` وقتی سرورِ حساب از راهِ تونل است) ‎270s‎ — زیرِ
 *     سقفِ ۳۰۰ ثانیه‌ایِ undici تا همیشه مهلتِ **ما** (با پیامِ درست) برسد. آزمون: ‎HLP_BRIDGE_TIMEOUT_MS‎ و
 *     ‎HLP_BRIDGE_LONG_TIMEOUT_MS‎ (۱۰۰ تا ۲۹۰٬۰۰۰).
 *  ⛔ خواندن (‎GET/HEAD‎، و ورود) ⇒ ‎504 account_server_timeout‎ (تکرارپذیر). **نوشتن** ⇒ ‎504 outcome_unknown‎ با
 *     ‎outcome: 'unknown'‎: سرورِ حساب شاید انجامش داده — «پیش از تکرار ببینید»، هرگز «شکست»؛ و هیچ‌جا خودکار
 *     دوباره فرستاده نمی‌شود (تنها تکرارِ پل روی ۴۰۱ است، که یعنی سرورِ حساب اصلاً به کار نرسیده).
 */
export const BRIDGE_TIMEOUT_MS = 30_000;
export const BRIDGE_LONG_TIMEOUT_MS = 270_000;
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const envMs = (name, def) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 100 && n <= 290_000 ? Math.round(n) : def;
};
export function bridgeTimeouts() {
  return { normalMs: envMs('HLP_BRIDGE_TIMEOUT_MS', BRIDGE_TIMEOUT_MS), longMs: envMs('HLP_BRIDGE_LONG_TIMEOUT_MS', BRIDGE_LONG_TIMEOUT_MS) };
}
const timeoutMsOf = (t) => (t === 'long' ? bridgeTimeouts().longMs : bridgeTimeouts().normalMs);

/*
 *  S18 (۱.۵۰.۷۵): سرورِ حسابِ تازه سرِ هر پاسخِ ‎/api/admin/*‎ ‎X-Admin-API-Version‎ می‌گذارد (فقط با شکستنِ یک درِ موجود
 *  بالا می‌رود). پل آخرین مقدارِ دیده‌شده را نگه می‌دارد تا «یکپارچه‌سازی» بگوید سازگار است یا نه (‎account/bridge-contract.js‎).
 */
let apiVersionSeen = null;   // { version, at }
function noteApiVersion(res) {
  const v = String(res?.headers?.get?.('x-admin-api-version') || '');
  if (/^\d{1,4}$/.test(v)) apiVersionSeen = { version: Number(v), at: Date.now() };
}
export function adminApiVersionSeen() { return apiVersionSeen; }

/** پاسخ ⇒ مهلتِ همان درخواست، برای خواندنِ بدنه (`readBody`). */
const DIALED = new WeakMap();

function stalled(e, ctx) {
  const code = String(e?.cause?.code || e?.code || '');
  return ctx.signal.aborted || e?.name === 'TimeoutError' || e?.name === 'AbortError'
    || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT';
}

function timeoutErr(ctx) {
  const s = Math.max(1, Math.round(ctx.ms / 1000));
  const err = ctx.safe
    ? new Error(`سرورِ حساب در ${s} ثانیه جواب نداد — دوباره بخوانید`)
    : new Error(`سرورِ حساب در ${s} ثانیه جواب نداد و معلوم نیست این کار انجام شد یا نه — پیش از تکرار، نتیجه را در همان فهرست ببینید`);
  err.code = ctx.safe ? 'account_server_timeout' : 'outcome_unknown';
  err.status = 504;
  if (!ctx.safe) err.outcome = 'unknown';
  err.method = ctx.method;
  err.path = ctx.path;
  err.timeoutMs = ctx.ms;
  return err;
}

/*
 *  🚇 **پاسخِ تونل روی نوشتن** (۱.۵۰.۸۷، تصمیمِ ۳-۱۵ پرسشِ ۱ «الف»؛ ممیزی §۹ «۱.۵۰.۷۷ (شکافِ شناخته)»):
 *  نوشتنی که به‌جای پاسخِ خودِ سرورِ حساب (JSON با ‎error‎) صفحهٔ خطای تونل/واسط را گرفت:
 *    • **رسیده یا مبهم** — ‎502‎ (cloudflared: هر دو)، ‎504‎، ‎520‎ و ‎524‎ (Cloudflare: سرورِ حساب گرفت، جوابش نیامد/دیر شد)
 *      ⇒ «نامعلوم» (‎outcome: 'unknown'‎، ‎502 outcome_unknown‎ با ‎upstreamStatus‎) — شاید انجام شده؛ همان پنجره تا ده دقیقه
 *      دوباره نمی‌فرستد (`account/idem-once.js`) تا آدم نتیجه را ببیند، و یک ردیفِ دفتر (`bridge-fail.js`).
 *    • **نرسیدهٔ روشن** — ‎521‎ (خاموش)، ‎522‎/‎523‎ (اتصال نشد)، ‎525‎/‎526‎ (TLS) ⇒ «شکست» (‎502 tunnel_not_delivered‎) — کار
 *      انجام نشده و دوباره زدن بی‌خطر است، پس کلید بی‌دلیل قفل نمی‌شود.
 *  ⛔ پاسخِ JSON ِ خودِ سرورِ حساب (‎{ error: { code } }‎) با هر وضعیتی همان‌طور که آمد می‌ماند؛ خواندن‌ها (‎GET/HEAD‎) هم دست
 *     نخوردند (همیشه تکرارپذیرند). تا ۱.۵۰.۸۶ همهٔ این‌ها «‎cloud_error‎ با همان وضعیت» = شکست بودند، حتی ‎524‎.
 */
const TUNNEL_REACHED = new Set([502, 504, 520, 524]);
const TUNNEL_NOT_DELIVERED = new Set([521, 522, 523, 525, 526]);
/** ‎'unknown'‎ | ‎'failed'‎ | ‎null‎ (پاسخِ خودِ سرورِ حساب یا نه‌تونل) — فقط برای نوشتن */
export function tunnelVerdict(status, out) {
  if (out && typeof out === 'object' && out.error) return null;
  if (TUNNEL_REACHED.has(status)) return 'unknown';
  if (TUNNEL_NOT_DELIVERED.has(status)) return 'failed';
  return null;
}
function tunnelErr(method, path, status, verdict) {
  const unknown = verdict === 'unknown';
  const err = new Error(unknown
    ? `تونل به‌جای پاسخِ سرورِ حساب خطای ${status} داد و معلوم نیست این کار انجام شد یا نه — پیش از تکرار، نتیجه را در همان فهرست ببینید`
    : `تونل به سرورِ حساب نرسید (${status}) — این کار انجام نشد؛ کمی بعد دوباره بکوشید`);
  return Object.assign(err, {
    code: unknown ? 'outcome_unknown' : 'tunnel_not_delivered', status: 502, upstreamStatus: status,
    ...(unknown ? { outcome: 'unknown' } : {}), method, path, timeoutMs: null,
  });
}

/** خطاهایی که یعنی درخواست اصلاً به سرورِ حساب نرسید ⇒ تکرارش بی‌خطر است. */
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
function droppedErr(ctx) {
  const err = new Error('ارتباط با سرورِ حساب وسطِ کار قطع شد و معلوم نیست این کار انجام شد یا نه — پیش از تکرار، نتیجه را در همان فهرست ببینید');
  return Object.assign(err, { code: 'outcome_unknown', status: 502, outcome: 'unknown', method: ctx.method, path: ctx.path, timeoutMs: null });
}

/*
 *  📦 **بدنهٔ پاسخِ پل** (۱.۵۰.۷۷، بازبینیِ ۱.۵۰.۷۶):
 *  ⛔ سقف: بدنه جریانی و با شمارشِ بایت خوانده می‌شود، نه یک‌جا (‎res.json()/arrayBuffer()‎ تا هر اندازه در حافظه
 *     جمع می‌کرد ⇒ یک viewer با بازکردنِ رسانه یا عکس پنل را به بافر کردنِ بدنهٔ بی‌سقف وامی‌داشت). سقف بالای
 *     بزرگ‌ترین بارِ درست است (رسانهٔ پشتیبانی ۲۵ مگابایت، ‎MAX_MEDIA‎ ِ هر دو سو)؛ ‎content-length‎ ِ بیش از سقف ⇒ همان
 *     دم، وگرنه همان بایتی که از سقف گذشت ⇒ خواندن بریده (‎reader.cancel‎، اتصال بسته) و ‎502 account_server_too_large‎.
 *  ⛔ بدنهٔ **۲xx** که کامل نرسید (اتصال وسطِ بدنه افتاد) یا JSON ِ درست نبود (صفحهٔ HTML ِ واسط، بی‌بدنه) دیگر «‎{}‎ ِ
 *     موفق» نیست: خواندن ⇒ ‎502 account_server_bad_response‎ (تکرارپذیر)؛ نوشتن ⇒ ‎502 outcome_unknown‎ — همان قاعدهٔ
 *     مهلتِ پل (کار شاید انجام شده و پاسخش گم شد). ۲۰۴/۲۰۵/۳۰۴ و HEAD بی‌بدنهٔ قراردادی‌اند ⇒ ‎{}‎.
 *  ⚠️ پاسخِ **غیرِ ۲xx** با بدنهٔ ناخوانا همان رفتارِ پیشین را دارد (‎{}‎ ⇒ خطا با وضعیتِ خودِ پاسخ): وضعیت خودش
 *     گفته رد شد، و ۴۰۴ ِ HTML ِ مسیرِ نبوده «نامعلوم» نیست.
 */
export const BRIDGE_MAX_BODY_BYTES = 32 * 1024 * 1024;
const NO_BODY = new Set([204, 205, 304]);
/** سقفِ بدنهٔ همین درخواست: تنگ‌ترِ خودِ یک در (‎cloudRawBytes({ maxBytes })‎، مثلاً مدرکِ پرونده) — هرگز گشادتر از سقفِ پل */
const capOf = (ctx) => (ctx.max > 0 && ctx.max < BRIDGE_MAX_BODY_BYTES ? ctx.max : BRIDGE_MAX_BODY_BYTES);

/** خواندنِ بدنه نشد — ‎err.unreadable‎ تا درهای ورود/پرسشِ کلید رفتارِ نرمِ پیشین را نگه دارند (`loose`). */
function unreadableErr(ctx, why) {
  const big = why === 'too_large';
  const mb = Math.round(capOf(ctx) / (1024 * 1024));
  const err = ctx.safe
    ? new Error(big
      ? `پاسخِ سرورِ حساب از سقفِ ${mb} مگابایت بزرگ‌تر بود و خوانده نشد`
      : 'پاسخِ سرورِ حساب ناقص یا خراب رسید — دوباره بخوانید')
    : new Error(big
      ? `پاسخِ سرورِ حساب از سقفِ ${mb} مگابایت بزرگ‌تر بود و معلوم نیست این کار انجام شد یا نه — پیش از تکرار، نتیجه را در همان فهرست ببینید`
      : 'پاسخِ سرورِ حساب ناقص یا خراب رسید و معلوم نیست این کار انجام شد یا نه — پیش از تکرار، نتیجه را در همان فهرست ببینید');
  err.code = ctx.safe ? (big ? 'account_server_too_large' : 'account_server_bad_response') : 'outcome_unknown';
  err.status = 502;
  if (!ctx.safe) err.outcome = 'unknown';
  return Object.assign(err, { unreadable: why, method: ctx.method, path: ctx.path, timeoutMs: null });
}

/*
 *  🚦 **سقفِ هم‌زمانیِ بدنه‌های بزرگ** (۱.۵۰.۷۹، `stations/body-gate.js`): تا ۱ مگابایت هر بدنه آزاد است؛ بیش از آن یک «جا»
 *  می‌خواهد (۴ جا، هر کدام سهمِ کاملِ یک بدنه)، نبودِ جا ⇒ صف (تا ۱۲۸، با همان مهلتِ درخواست)، و فقط صفِ پر ⇒
 *  ‎503 account_server_busy‎. جا تا پایانِ خواندنِ JSON نگه داشته می‌شود (`readBody`)، چون رونوشت و متنِ بازشده هم حافظه‌اند.
 *  ⛔ دو دسته **هرگز** پشتِ این سقف نمی‌روند و جا هم نمی‌گیرند:
 *     • نوشتن (‎!ctx.safe‎): کار شاید همین حالا انجام شده و پاسخ تنها شاهدِ آن است — صبر یا ‎503‎ ِ خودساخته آن را «نامعلوم» می‌کرد؛
 *     • رسانهٔ یک‌بارمصرفِ پشتیبانی (‎ctx.once‎، `cloudRawBytes`): سرورِ حساب با رسیدنِ بدنه به سوکت آن را **پاک** می‌کند
 *       (‎res.on('finish')‎ ⇒ ‎DELETE‎، shop ‎lib/station-chat.js‎) — هر ‎503‎ یا مهلتِ صف پس از سرآیند می‌توانست رسانهٔ مشتری را گم کند.
 *       و تکرارپذیر هم نیست (یک بار، سپس از دیسکِ پنل)، پس هم‌زمانیِ آن را viewer نمی‌تواند چند برابر کند.
 */
let bodyGate = null;
const gate = () => (bodyGate ??= makeBodyGate(bodyGateConfig()));

let busyWarnAt = 0;
function busyErr(ctx) {
  const t = Date.now();
  if (t - busyWarnAt > 60_000) {
    busyWarnAt = t;
    const s = gate().stats();
    console.warn(`[bridge] صفِ بدنه‌های بزرگِ پل پر است (${s.inUse}/${s.slots} جا، ${s.waiting}/${s.queue} در صف) ⇒ 503 account_server_busy`);
  }
  const err = new Error('پنل همین حالا پاسخ‌های بزرگِ زیادی از سرورِ حساب می‌خواند — چند ثانیهٔ دیگر دوباره بخوانید');
  return Object.assign(err, { code: 'account_server_busy', status: 503, busy: true, method: ctx.method, path: ctx.path, timeoutMs: null });
}

/** یک جا برای بدنهٔ بزرگ — صفِ پر ⇒ بریدنِ خواندن و ‎busy‎؛ مهلت در صف ⇒ بریدن و همان خطای ‎signal‎ (⇒ خطای مهلت). */
async function admit(ctx, reader) {
  try {
    return await gate().acquire(ctx.signal);
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e?.busy ? busyErr(ctx) : e;
  }
}

/**
 * بدنه تا سقف، تکه‌تکه — از سقف گذشت ⇒ بریدن و ‎too_large‎ (هیچ بایتِ بیشتری خوانده یا نگه داشته نمی‌شود).
 * ‎hold.release‎: جای بدنهٔ بزرگ (بالا) — صداکننده پس از کارش با بایت‌ها رهایش می‌کند؛ خطا ⇒ همین‌جا رها می‌شود.
 */
async function readCapped(res, ctx, hold = {}) {
  const cap = capOf(ctx);
  const declared = Number(res.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > cap) {
    await res.body?.cancel().catch(() => {});
    throw unreadableErr(ctx, 'too_large');
  }
  if (!res.body) return Buffer.alloc(0);
  const gated = ctx.safe && !ctx.once;
  const reader = res.body.getReader();
  const parts = [];
  let n = 0;
  try {
    //  طولِ اعلام‌شده (اگر فشرده، اندازهٔ فشرده — بازشده معمولاً بزرگ‌تر) بیش از آزاد ⇒ جا پیش از نخستین بایت
    if (gated && Number.isFinite(declared) && declared > BODY_FREE_BYTES) hold.release = await admit(ctx, reader);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > cap) {
        await reader.cancel().catch(() => {});
        throw unreadableErr(ctx, 'too_large');
      }
      parts.push(value);
      if (gated && !hold.release && n > BODY_FREE_BYTES) hold.release = await admit(ctx, reader);
    }
    return Buffer.concat(parts, n);
  } catch (e) {
    hold.release?.();
    hold.release = null;
    throw e;
  }
}

/**
 * بدنهٔ پاسخ — با همان مهلتِ درخواست و سقفِ بالا. بدنه‌ای که مهلتش سر رسید **خطای مهلت** است؛ بدنهٔ ۲xx ِ بریده،
 * خراب یا بیش از سقف **خطای بدنه** (بالا)، نه پاسخِ خالیِ موفق.
 * @param {'json'|'text'|'bytes'} kind
 */
async function readBody(res, kind = 'json') {
  const ctx = DIALED.get(res) || { ms: 0, method: '', safe: true, signal: { aborted: false }, path: '', once: false };
  const hold = { release: null };
  let buf;
  try {
    buf = await readCapped(res, ctx, hold);
  } catch (e) {
    if (stalled(e, ctx)) throw timeoutErr(ctx);
    //  صفِ پرِ بدنه‌های بزرگ (فقط خواندنِ تکرارپذیر می‌رسد این‌جا) ⇒ همان ‎503‎ — جز غیرِ ۲xx که وضعیتِ خودش را نگه می‌دارد
    if (e?.busy && res.ok) throw e;
    //  ⛔ ۲xx: بدنهٔ گم‌شده یا بیش از سقف ⇒ خطای بدنه؛ غیرِ ۲xx: وضعیت خودش گفته رد شد (بیش از سقف هم)
    if (res.ok) throw e?.unreadable ? e : unreadableErr(ctx, 'cut');
    if (kind === 'json') return {};
    if (kind === 'text') return '';
    throw e?.unreadable || e?.busy ? e : unreadableErr(ctx, 'cut');
  }
  try {
    if (kind === 'bytes') return buf;
    const text = new TextDecoder().decode(buf);
    if (kind === 'text') return text;
    if (!buf.length && (NO_BODY.has(res.status) || ctx.method === 'HEAD')) return {};
    try {
      return JSON.parse(text);
    } catch {
      if (res.ok) throw unreadableErr(ctx, text ? 'invalid' : 'empty');
      return {};
    }
  } finally {
    hold.release?.();
  }
}

/** درهای ورود و پرسشِ کلید: بدنهٔ ناخوانا همان «‎{}‎» ِ پیشین (⇒ «ورود نشد» با مهلتِ ۱۵ ثانیه‌اش، یا «کلید به کار نمی‌رود»). */
const loose = (res) => readBody(res).catch((e) => { if (e?.unreadable) return {}; throw e; });

/**
 * fetch که خطای شبکه را به خطای بادار برمی‌گرداند — و مهلت دارد (بالا).
 *
 * ‎ECONNREFUSED‎ روی نشانیِ محلی یعنی سرورِ حساب روی همین کامپیوتر روشن
 * نیست — و پیامش باید همان راهِ درست کردن را بگوید (‎downPayload‎)، نه
 * «fetch failed».
 *
 * @param {{ timeout?: 'normal'|'long', safe?: boolean, signal?: AbortSignal|null, once?: boolean, max?: number }} [opts]
 *        ‎safe‎: تکرارش بی‌اثر است (پیش‌فرض: فقط GET/HEAD) — ورود هم.
 *        ‎once‎: بدنهٔ یک‌بارمصرف (سرورِ حساب پس از فرستادن پاکش می‌کند) ⇒ بیرون از سقفِ هم‌زمانیِ بدنه‌های بزرگ (`readCapped`).
 *        ‎max‎: سقفِ تنگ‌ترِ بدنه برای همین در (بایت) — بیش از آن ⇒ بریدن و ‎too_large‎ پیش از نگه داشتنِ بایتِ بیشتر.
 */
async function dial(url, init = {}, { timeout = 'normal', safe = null, signal = null, once = false, max = 0 } = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  const ms = timeoutMsOf(timeout);
  const timer = AbortSignal.timeout(ms);
  const ctx = {
    ms, method, safe: safe ?? SAFE_METHODS.has(method), once: once === true, max: Number.isSafeInteger(max) && max > 0 ? max : 0,
    signal: signal ? AbortSignal.any([timer, signal]) : timer,
    path: (() => { try { return new URL(url).pathname.slice(0, 200); } catch { return ''; } })(),
  };
  try {
    const res = await fetch(url, { ...init, signal: ctx.signal });
    DIALED.set(res, ctx);
    return res;
  } catch (e) {
    if (stalled(e, ctx)) throw timeoutErr(ctx);
    //  ⛔ همان دسته: نوشتنی که فرستاده شد و اتصال **وسطِ کار** افتاد (نه «وصل نشد») هم نامعلوم است، نه «سرور خاموش»
    if (!ctx.safe && !NEVER_SENT.has(String(e?.cause?.code || e?.code || ''))) throw droppedErr(ctx);
    const local = !!accountApiUrl();
    const err = new Error(local
      ? downPayload().error.message
      : 'به سرورِ حساب نرسیدیم — اینترنت یا تونل قطع است');
    err.code = local ? 'account_server_down' : 'account_server_unreachable';
    err.status = 503;
    err.cause = e;
    throw err;
  }
}

/** توکنِ خودکار — فقط در حافظه. */
let auto = null; // { token, expiresAt }

/*
 *  ⛔ **یک ورود در یک زمان** — و این تنها چیزی است که ازدحامِ سرد را
 *  مهار می‌کند.
 *
 *  گزارشِ صاحب سامانه با عکس (۱۴۰۵/۰۷/۱۰): هم «کدهای زنده» و هم میزِ
 *  فروشگاه نوارِ «ورودِ خودکار به سرورِ حساب نشد: تعداد درخواست بیش از
 *  حد مجاز است» داشتند و **هیچ ردیفی** نمی‌آمد.
 *
 *  مهلتِ ۱.۴۷.۴ (`autoFail`) درست بود ولی نیمی از مسئله را می‌دید: آن
 *  تلاش‌های **پشتِ سرِ هم** را مهار می‌کند و تلاش‌های **هم‌زمان** را نه.
 *  با کَشِ خالی یا توکنِ مرده، هر درخواستی که همان لحظه در راه است خودش
 *  یک `POST /api/admin/login` می‌زند:
 *
 *      صفحهٔ کدها      ⇒ دو دفترِ بالادست با allSettled   ۲
 *      حالِ رباتِ ایمیل ⇒ /api/admin/email                 ۱
 *      میزِ فروشگاه    ⇒ overview + groups                ۲
 *      دیدبانِ زنده    ⇒ /api/admin/stamps هر ده ثانیه    ۱
 *      سه ربات        ⇒ pump-watch · shop-watch · login   ۳
 *
 *  یعنی یک بار باز کردنِ پنل با توکنِ مرده می‌تواند **نُه** ورود بزند —
 *  و سقفِ `authMax`ِ سرورِ حساب ده در ربع ساعت است. بعدش ۴۲۹، بعدش مهلتِ
 *  دو دقیقه‌ای، و بعد از مهلت **باز همان ازدحام** ⇒ پنجرهٔ ربع‌ساعته
 *  هیچ‌وقت خالی نمی‌شود. همان بن‌بستِ ۱.۴۷.۴، این بار از سمتِ هم‌زمانی.
 *
 *  ⛔ پس هر کسی که وسطِ یک ورود برسد، به **همان** ورود می‌پیوندد و ورودِ
 *  دومی نمی‌زند. یک ورود ⇒ یک خانه از سقف، نه نُه‌تا.
 *
 *  ⚠️ و `force` هم می‌پیوندد: هر ورودی که همین حالا تمام شود توکنِ
 *  **تازه‌ای** از سرور می‌آورد، پس جدا زدنش فقط یک خانهٔ دیگر از سقف را
 *  می‌خورد و هیچ چیزی تازه‌تر نمی‌دهد.
 */
let autoInFlight = null; // Promise<string> | null

/*
 *  ⛔ ورودِ ناموفق مهلت می‌گیرد — وگرنه پنل خودش را بیرون می‌گذارد.
 *
 *  گزارشِ صاحب سامانه با عکس (۱۴۰۵/۰۷/۰۸): صفحهٔ «کدهای زنده» نوارِ
 *  «ورود خودکار به سرور حساب نشد: تعداد درخواست بیش از حد مجاز است»
 *  داشت و هر چهار شمارنده صفر بود.
 *
 *  زنجیرهٔ مرگ، و هر سه حلقه‌اش لازم بود:
 *    ۱) هر خطا `auto = null` می‌کرد — از جمله ۴۲۹
 *    ۲) پس درخواستِ بعدی کَش نداشت و یک `POST /api/admin/login` تازه می‌زد
 *    ۳) و سقفِ `authMax`ِ سرورِ حساب ده در ربع ساعت است
 *
 *  صفحهٔ کدهای زنده مرتب تازه می‌شود، پس هر تازه‌شدن یک لاگین بود ⇒ ۴۲۹
 *  ⇒ کَش پاک ⇒ لاگینِ بعدی هم ۴۲۹… و پنجرهٔ ربع‌ساعته هیچ‌وقت خالی
 *  نمی‌شد. یعنی **حتی با رمزِ کاملاً درست** دیگر هیچ‌وقت وارد نمی‌شد.
 *
 *  ⚠️ همان الگوی «نبضِ کلیدِ مرده» در `admin-gate.js` است، این بار از
 *  سمتِ خودمان: تلاشِ تکراریِ بی‌مهلت، خودش سقف را پر می‌کند.
 */
let autoFail = null; // { until, code, message, status }

/** مهلتِ پس از هر ورودِ ناموفق — بر حسبِ جنسِ خرابی. */
function coolFor(status, code, retryAfterSec) {
  //  ⚠️ حرفِ خودِ سرور مقدم است: سقفِ نرخ `Retry-After` می‌دهد.
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1000 + 1_000, 15 * 60_000);
  }
  if (status === 429 || code === 'rate_limited') return 2 * 60_000;
  //  ⛔ رمزِ غلط مهلت **نمی‌گیرد** و این عمدی است: صاحبِ سامانه `.env` را
  //  درست می‌کند و باید همان لحظه وصل شود، بی راه‌اندازیِ دوباره —
  //  سنجه‌اش سرِ جایش است. و بی‌مهارِ هم نمی‌ماند: تلاشِ پشتِ سرِ هم
  //  خودش سقفِ نرخ را پر می‌کند و همان ۴۲۹ِ بالا مهارش می‌کند. یعنی
  //  مهار یک لایه بیرون‌تر است، نه این‌که نباشد.
  if (code === 'bad_credentials') return 0;
  return 15_000;
}

/**
 * توکنِ مدیرِ سرورِ حساب — از حافظه، وگرنه یک ورود.
 *
 * @param {boolean} force  توکنی که داشتیم رد شد (۴۰۱)
 * @param {string|null} stale  **همان** توکنی که رد شد — و این مهم است:
 *   شش درخواستِ هم‌زمان با یک توکنِ مرده، شش تا ۴۰۱ می‌گیرند. اگر یکی‌شان
 *   زودتر وارد شود و توکنِ تازه بنشاند، بقیه هم `force` می‌زنند و چون
 *   `force` سنجشِ تازگی را دور می‌زند، **ورودِ دومی** می‌سازند — حتی
 *   برای توکنی که چند میلی‌ثانیه پیش ساخته شده. با این پارامتر،
 *   «مرده» یعنی «همانی که من زدم هنوز روی حافظه است»، نه «۴۰۱ گرفتم».
 */
async function autoToken(force = false, stale = null) {
  const creds = autoCreds();
  if (!creds) return null;
  const fresh = auto?.token && (!auto.expiresAt || auto.expiresAt - Date.now() > 60_000);
  //  کسِ دیگری همین حالا توکن را عوض کرده ⇒ همان تازه را بگیر، دوباره وارد نشو
  if (fresh && (!force || (stale && auto.token !== stale))) return auto.token;

  //  ⛔ داخلِ مهلت، **هیچ درخواستی** زده نمی‌شود. این تنها چیزی است که
  //  سقفِ نرخ را خالی می‌کند؛ بی آن، هر تلاش خودش دلیلِ تلاشِ بعدی است.
  if (autoFail && autoFail.until > Date.now()) {
    //  توکنِ سالمِ قبلی بهتر از هیچ است — شاید هنوز کار کند.
    if (auto?.token && !force) return auto.token;
    const err = new Error(autoFail.message);
    err.code = autoFail.code;
    err.status = autoFail.status;
    throw err;
  }

  //  ⛔ ورودی در راه است ⇒ همان را بگیر، ورودِ دومی نزن.
  if (autoInFlight) return autoInFlight;
  autoInFlight = doLogin(creds).finally(() => { autoInFlight = null; });
  return autoInFlight;
}

/** خودِ ورود — تنها جایی که ورودِ **خودکار** زده می‌شود، و یکی‌یکی. */
async function doLogin(creds) {
  const res = await dial(`${cloudTarget()}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds),
  }, { safe: true });
  const body = await loose(res);
  if (!res.ok || !body?.token) {
    const code = body?.error?.code === 'bad_credentials'
      ? 'auto_login_rejected'
      : (body?.error?.code || 'auto_login_failed');
    const limited = res.status === 429 || body?.error?.code === 'rate_limited';

    //  ⛔ توکنِ سالمِ روی حافظه با یک ۴۲۹ پاک نمی‌شود. فقط وقتی دور
    //  ریخته می‌شود که خودِ سرور بگوید این رمز/نشست بد است.
    if (!limited) auto = null;

    //  ⚠️ پیام باید کارِ درست را بگوید: «رمز را بسنج» برای ۴۲۹ غلط است
    //  و آدم را دنبالِ چیزی می‌فرستد که خراب نیست.
    const why = body?.error?.message ? `: ${body.error.message}` : '';
    const hint = limited
      ? ' — سقفِ نرخِ سرورِ حساب پر شده؛ خودش چند دقیقهٔ دیگر باز می‌شود'
      : ' — HLP_ACCOUNT_ADMIN_USER/PASSWORD را بسنجید';
    const err = new Error(`ورودِ خودکار به سرورِ حساب نشد${why}${hint}`);
    err.code = code;
    //  ⛔ ۲۰۰ ِ بی توکن (یا بدنهٔ ناخوانا) «ورود نشد» است، نه پاسخِ ۲۰۰ ِ خطادار به مرورگر
    err.status = res.status === 401 ? 409 : (res.ok ? 502 : res.status);

    const retryAfter = Number(res.headers?.get?.('retry-after'));
    const cool = coolFor(res.status, body?.error?.code, retryAfter);
    autoFail = cool > 0
      ? { until: Date.now() + cool, code: err.code, message: err.message, status: err.status }
      : null;
    throw err;
  }
  autoFail = null;
  const exp = body.expiresAt ? Number(new Date(body.expiresAt)) : NaN;
  auto = { token: body.token, expiresAt: Number.isFinite(exp) ? exp : null };
  return auto.token;
}

/** برای آزمون: توکنِ خودکار را دور بریز. */
export function cloudResetAuto() { auto = null; autoFail = null; autoInFlight = null; }

/** نامِ رازی که توکنِ مدیرِ ابر زیرش می‌نشیند. */
const SECRET_NAME = 'pump_cloud_admin_token';

/**
 * مسیرهایی که پنل اجازه دارد صدا بزند — و بس.
 * هر کدام: [متد, مسیرِ ابر]
 */
const ALLOWED = {
  stats:        ['GET',  '/api/admin/pump/stats'],
  stations:     ['GET',  '/api/admin/pump/stations'],
  users:        ['GET',  '/api/admin/pump/users'],
  subscriptions:['GET',  '/api/admin/pump/subscriptions'],
  expiring:     ['GET',  '/api/admin/pump/subscriptions/expiring'],
  vipCodes:     ['GET',  '/api/admin/pump/vip-codes'],
  plans:        ['GET',  '/api/admin/plans'],
  grant:        ['POST', '/api/admin/pump/subscriptions'],
  makeCode:     ['POST', '/api/admin/pump/vip-codes'],
  //  پلن و قیمتِ خودِ پمپ — باز است، ولی از همین پل می‌رود تا نشانی یکی بماند
  pumpPlans:    ['GET',  '/api/pump/plans'],
  //  نشانیِ دانلود و آخرین نسخهٔ هر برنامه (‎portal.downloadsOf‎ ِ shop) — باز است و درِ خواندنیِ مدیر ندارد؛ فقط
  //  ‎routes/console-parity.js‎ (ماژولِ «نسخه‌ها») می‌خواندش، پیش از ‎PUT /api/admin/downloads‎ (۱.۵۰.۸۰)
  downloads:    ['GET',  '/api/downloads'],
  //  ‎:id‎ از ‎params.id‎ می‌آید و فقط حرف/رقم/خطِ تیره — نه هر چیزی
  stationDetail:['GET',  '/api/admin/pump/stations/:id'],
  revokeCode:   ['POST', '/api/admin/pump/vip-codes/:id/revoke'],
  subStatus:    ['POST', '/api/admin/pump/subscriptions/:id/status'],

  //  ⚠️ برای آینه (‎cloud-mirror.js‎). خواستهٔ صاحب مخزن: «فولدرِ سرور
  //  همه‌چی رو داشته باشه، چه از این چه از اپِ شاپ.» پس حساب‌ها و
  //  اشتراک‌های دکان هم به پوشه می‌آیند. پنل و اپِ مدیریت بخشِ دکان را از
  //  ‎routes/account-admin.js‎ می‌بینند که ‎cloudRaw‎ را می‌زند.
  shopUsers:    ['GET',  '/api/admin/users'],
  shops:        ['GET',  '/api/admin/shops'],
  shopSubs:     ['GET',  '/api/admin/subscriptions'],
};

// ── توکن ───────────────────────────────────────────────────────────

function tokenRow() {
  if (!vaultReady()) return null;
  return listSecrets({ scope: 'global' }).find((s) => s.name === SECRET_NAME) || null;
}

function token() {
  const row = tokenRow();
  return row ? readSecret(row.id) : null;
}

/**
 * آیا مرکز فرمان به سرورِ حساب وصل است.
 *
 *   base     نشانیِ عمومی (قفل) — همان که برنامه‌ها می‌زنند
 *   target   نشانی‌ای که این پل واقعاً می‌زند (محلی وقتی درگاه روشن است)
 *   local    درگاه روشن است و پل از همین کامپیوتر می‌رود
 *   linked   توکنی هست: یا از ورودِ دستی در گاوصندوق، یا خودکار از ‎.env‎
 *   auto     ورودِ خودکار تنظیم است
 */
export function cloudStatus() {
  const row = tokenRow();
  const creds = autoCreds();
  return {
    base: CLOUD_BASE,
    target: cloudTarget(),
    local: !!accountApiUrl(),
    linked: !!row || !!creds || !!readServiceKey(),
    auto: !!creds,
    //  کلیدِ سرویس (فقط بودنش، هرگز خودش) — «کدام راه» را ‎GET /api/account-admin/console/service-key‎ می‌گوید
    serviceKey: !!readServiceKey(),
    vault: vaultReady(),
    updatedAt: row?.updated_at || null,
  };
}

/**
 * ورود به ابر با نام و رمزِ مدیر.
 *
 * ⚠️ رمز **ذخیره نمی‌شود** — فقط یک بار به ابر می‌رود و توکنی که
 * برمی‌گردد در گاوصندوق می‌نشیند. رمزِ مدیر روی دیسکِ خانه نماند.
 */
export async function cloudLogin(username, password, actor = 'admin') {
  if (!vaultReady()) {
    const err = new Error('گاوصندوق باز نیست — اول آن را راه بیندازید');
    err.code = 'vault_locked';
    throw err;
  }

  const res = await dial(`${cloudTarget()}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  }, { safe: true });
  const body = await loose(res);

  if (!res.ok || !body?.token) {
    const err = new Error(body?.error?.message || 'ورود به سرورِ حساب نشد');
    err.code = body?.error?.code || 'cloud_login_failed';
    err.status = res.ok ? 502 : res.status;
    throw err;
  }

  putSecret({
    name: SECRET_NAME,
    kind: 'api_key',
    scope: 'global',
    value: body.token,
    note: 'توکنِ مدیرِ بخشِ پمپ روی سرورِ حساب',
    actor,
  });

  return { ok: true, admin: body.admin || null, expiresAt: body.expiresAt || null };
}

/** توکن را فراموش کن — پل بسته می‌شود، دادهٔ ابر دست نمی‌خورد. */
export function cloudForget(actor = 'admin') {
  const row = tokenRow();
  if (!row) return false;
  return deleteSecret(row.id, actor);
}

// ── صدا زدنِ ابر ───────────────────────────────────────────────────

/**
 * یکی از مسیرهای فهرستِ سفید را صدا می‌زند.
 *
 * @param {string} name کلیدی از ALLOWED — نه یک مسیرِ دلخواه.
 * @param {object} opts { query, body }
 */
export async function cloudCall(name, { query = {}, body = null, params = {}, timeout = 'normal', signal = null } = {}) {
  let entry = ALLOWED[name];
  if (!entry) {
    const err = new Error('این مسیر از پنل باز نیست');
    err.code = 'path_not_allowed';
    err.status = 400;
    throw err;
  }
  if (entry[1].includes(':id')) {
    const id = String(params.id || '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
      const err = new Error('شناسه معتبر نیست');
      err.code = 'bad_id';
      err.status = 400;
      throw err;
    }
    entry = [entry[0], entry[1].replace(':id', encodeURIComponent(id))];
  }
  //  کلیدِ سرویس (اگر هست و پذیرفته است) جلوتر؛ وگرنه ورودِ خودکار، وگرنه توکنِ گاوصندوق (`sendAuthed`)
  const [method, path] = entry;
  return authedSend(method, path, { query, body, timeout, signal });
}

/**
 * یک مسیرِ مدیریتیِ سرورِ حساب را با توکنِ مدیر می‌زند — و «مسیرِ مدیریتی»
 * یعنی فقط زیرِ ‎/api/admin/‎.
 *
 * ⚠️ این در برای ‎routes/account-admin.js‎ است، که خودش فهرستِ سفیدِ
 * خودش را دارد (پنل و اپِ مدیریت فقط همان چند مسیر را می‌بینند). هیچ
 * مسیرِ دیگری این تابع را صدا نمی‌زند، وگرنه همان «پروکسیِ باز» می‌شود
 * که بالا قدغن شده. مسیرِ بیرون از ‎/api/admin‎ همین‌جا رد می‌شود.
 *
 * @param {string} method GET/POST/PUT/PATCH/DELETE
 * @param {string} path   مثلاً ‎/api/admin/shops‎
 * @param {object} opts   { query, body }
 */
export async function cloudRaw(method, path, { query = {}, body = null, headers = {}, legacyOnly = false, timeout = 'normal', signal = null, replayFlag = false } = {}) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)
      || !/^\/api\/admin\/[A-Za-z0-9_\-/]+$/.test(p) || p.includes('..')) {
    const err = new Error('این مسیر از پنل باز نیست');
    err.code = 'path_not_allowed';
    err.status = 400;
    throw err;
  }
  return authedSend(m, p, { query, body, headers: extraHeaders(headers), legacyOnly, timeout, signal, replayFlag });
}

/*
 *  ⛔ سرآیندِ اضافه فقط «کلیدِ یکتایی» (‎Idempotency-Key‎ ِ سرورِ حساب، همان الگو) و «زمانِ احرازِ دوبارهٔ
 *  پنل» (‎X-Actor-Reauth-At‎، فقط عدد؛ سندِ اصلاحیِ مالی — ‎routes/account-finance.js‎) — نه هر سرآیندی:
 *  وگرنه صداکننده می‌توانست ‎X-Actor-Id/Role‎ یا ‎Authorization‎ را خودش بنویسد.
 */
const IDEM_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
function extraHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
    if (String(k).toLowerCase() === 'x-actor-reauth-at' && /^\d{12,14}$/.test(String(v ?? ''))) {
      out['x-actor-reauth-at'] = String(v);
      continue;
    }
    if (String(k).toLowerCase() !== 'idempotency-key' || v === undefined || v === null || v === '') continue;
    if (!IDEM_RE.test(String(v))) {
      const err = new Error('کلیدِ یکتایی نامعتبر است');
      err.code = 'bad_idempotency_key';
      err.status = 400;
      throw err;
    }
    out['idempotency-key'] = String(v);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════
   🔑 کلیدِ سرویس + «انجام‌دهنده» (چسبِ فاز ۲ و ۳ ِ پنلِ مرکزی؛ ‎account/service-key.js‎)

   هر درخواستِ پل:
     ۱) کلیدِ سرویس در گاوصندوق هست، سرورِ حساب آن را پذیرفته (‎GET /api/admin/me‎ ⇒ ۲۰۰) **و**
        `service-key.v1` و `actor.v1` را اعلام کرده ⇒ ‎Bearer vsk_…‎ + ‎X-Actor-Id/Role/Name‎.
     ۲) وگرنه همان راهِ پیشین، دست‌نخورده: ورودِ خودکار با رمزِ ارشد، یا توکنِ گاوصندوق.
   ⛔ سنجشِ «پذیرفته است» یک دقیقه نگه داشته می‌شود (یک ‎/me‎ در دقیقه، نه یکی برای هر درخواست)؛ و
      ۴۰۱ روی خودِ درخواست ⇒ همان دم کنار، و همان درخواست یک بار با راهِ پیشین (۴۰۱ یعنی سرورِ حساب
      اصلاً به کارش نرسیده، پس تکرار امن است). راهِ پیشین هم نبود ⇒ ‎409 service_key_rejected‎.
   ⛔ کلید هرگز در پیام، خطا یا لاگ نمی‌آید.
   ═══════════════════════════════════════════════════════════════════════ */
const PROBE_TTL = 60_000;
let svcProbe = null;      // { keyId, at, ok, caps, code }
let svcInFlight = null;

async function probeKey(key, keyId) {
  const res = await dial(`${cloudTarget()}/api/admin/me`, {
    headers: { authorization: `Bearer ${key}`, ...actorHeaders(SYSTEM_ACTOR) },
  });
  const body = await loose(res);
  if (res.status !== 200) {
    return { keyId, at: Date.now(), ok: false, caps: [], code: String(body?.error?.code || `http_${res.status}`).slice(0, 60) };
  }
  const caps = Array.isArray(body?.capabilities) ? body.capabilities.map(String) : [];
  return { keyId, at: Date.now(), ok: true, caps, code: '' };
}

const keyUsable = (p) => Boolean(p?.ok && p.caps.includes('service-key.v1') && p.caps.includes('actor.v1'));

/** کلیدِ ذخیره‌شده اگر همین حالا به کار می‌رود؛ وگرنه null (⇒ راهِ پیشین). خطای شبکه بالا می‌رود. */
async function serviceKeyInUse() {
  const stored = readServiceKey();
  if (!stored) return null;
  const fresh = svcProbe && svcProbe.keyId === stored.id && Date.now() - svcProbe.at < PROBE_TTL;
  if (!fresh) {
    if (!svcInFlight) {
      svcInFlight = probeKey(stored.key, stored.id)
        .then((r) => { svcProbe = r; return r; })
        .finally(() => { svcInFlight = null; });
    }
    await svcInFlight;
  }
  return keyUsable(svcProbe) && svcProbe.keyId === stored.id ? stored : null;
}

/** پس از ساختن/چرخش/ابطالِ کلید — سنجشِ تازه، نه یک دقیقه بعد. */
export function serviceKeyReset() { svcProbe = null; svcInFlight = null; }

/** کلیدِ تازه پیش از ذخیره: پذیرفته است و هر دو توانایی را دارد؟ ⇒ { ok, caps, code } */
export async function cloudProbeServiceKey(key) {
  if (!SERVICE_KEY_RE.test(String(key || ''))) return { ok: false, caps: [], code: 'bad_service_key' };
  const p = await probeKey(String(key), 'new');
  return { ok: keyUsable(p), caps: p.caps, code: p.ok && !keyUsable(p) ? 'capability_missing' : p.code };
}

/** راهِ پیشین (رمزِ ارشد یا توکنِ گاوصندوق) در دسترس است؟ */
export function legacyAvailable() {
  return Boolean(autoCreds()) || Boolean(tokenRow());
}

/**
 * حالِ پل برای صفحهٔ «یکپارچه‌سازی» — ⛔ بی کلید: فقط بودن، فراداده، راهِ امروز و دلیل.
 *   mode    'service' | 'legacy' | 'none'
 *   reason  null | 'no_key' | 'capability_missing' | کدِ ردِ سرورِ حساب (مثلاً 'invalid_service_key') | کدِ شبکه
 */
export async function serviceKeyStatus() {
  //  ⛔ این صفحه حقیقتِ همین لحظه را می‌خواهد، نه سنجشِ یک دقیقه پیش — و سنجشِ تازه همان کَشِ درخواست‌ها را هم تازه می‌کند
  serviceKeyReset();
  const stored = readServiceKey();
  let reason = null;
  let usable = false;
  if (!stored) reason = 'no_key';
  else {
    try {
      usable = Boolean(await serviceKeyInUse());
      if (!usable) reason = svcProbe?.ok ? 'capability_missing' : (svcProbe?.code || 'key_rejected');
    } catch (e) { reason = e.code || 'account_server_unreachable'; }
  }
  const legacy = legacyAvailable();
  return {
    stored: Boolean(stored),
    mode: usable ? 'service' : legacy ? 'legacy' : 'none',
    reason,
    legacy,
    probe: stored && svcProbe && svcProbe.keyId === stored.id
      ? { ok: svcProbe.ok, code: svcProbe.code || null, at: svcProbe.at, capabilities: svcProbe.caps }
      : null,
  };
}

function notLinkedErr() {
  const err = new Error('هنوز با حسابِ مدیر به سرورِ حساب وارد نشده‌اید — از پنل ← پمپ‌ها ← تنظیمات و داده‌ها، یا از همین اپ');
  err.code = 'not_linked';
  err.status = 409;
  return err;
}

function rejectedErr() {
  const err = new Error('کلیدِ سرویسِ پل را سرورِ حساب نپذیرفت (باطل یا ناشناخته) و راهِ پیشین هم تنظیم نیست — '
    + 'یک بار با حسابِ ارشد وارد شوید و از «فروشگاه ← یکپارچه‌سازی» کلیدِ تازه بسازید');
  err.code = 'service_key_rejected';
  err.status = 409;
  return err;
}

/**
 * تنها جای «با کدام هویت بفرستم». `send(authHeaders)` خودِ fetch را می‌سازد.
 * @param {{ legacyOnly?: boolean }} opts ‎legacyOnly‎: فقط راهِ پیشین — برای درهای کلیدهای سرویس، که
 *        کلیدِ سرویس به آن‌ها نمی‌رسد (‎SERVICE_DENY‎ ِ سرورِ حساب).
 */
async function sendAuthed(send, path, { legacyOnly = false } = {}) {
  if (!legacyOnly) {
    const svc = await serviceKeyInUse();
    if (svc) {
      const res = await send({ authorization: `Bearer ${svc.key}`, ...actorHeaders() });
      if (res.status !== 401) return res;
      await res.body?.cancel().catch(() => {});   //  بدنهٔ دورریختنی خوانده نمی‌شود (سقفِ ۱.۵۰.۷۷)
      svcProbe = { keyId: svc.id, at: Date.now(), ok: false, caps: [], code: 'invalid_service_key' };
      if (!legacyAvailable()) throw rejectedErr();
    }
  }
  //  ورودِ خودکار (اگر تنظیم است) همیشه جلوتر از توکنِ گاوصندوق: آن یکی
  //  دوازده ساعته می‌میرد و کسی نیست دوباره وارد شود؛ این یکی خودش تازه می‌شود.
  const creds = autoCreds();
  const t = creds ? await autoToken() : token();
  if (!t) throw notLinkedErr();
  return send401((bearer) => send({ authorization: `Bearer ${bearer}` }), t, creds, path);
}

/*
 *  ⛔ **۴۰۱ِ سرورِ حساب دو معنا دارد** (۱۴۰۵/۰۸/۰۹، فاز ۲ ِ پنلِ مرکزی — با سرورِ حسابِ واقعی سنجیده شد):
 *
 *    ۱) توکنِ مدیر مرده است؛
 *    ۲) **این مسیر روی این نسخهٔ سرورِ حساب نیست.** مسیرِ ناشناختهٔ ‎/api/admin/*‎ از روترهای مدیر رد
 *       می‌شود و به ‎routes/data‎ (روی ‎/‎ ِ همان ‎apiRouter‎) می‌رسد، که توکنِ **کاربر** می‌خواهد ⇒
 *       ‎401 invalid_token‎ — نه ۴۰۴. (‎GET /api/admin/shops/x/health‎ روی ‎shop@2.14.4‎: همین.)
 *
 *  تا امروز هر دو «نشست تمام شد» خوانده می‌شد و دو زخم داشت:
 *    • پل برای **هر** درخواست به مسیرِ نبوده یک ورودِ تازه می‌زد (`autoToken(true)`) — و `useLoad`
 *      روی `cloud_session_expired` دوباره تلاش می‌کند ⇒ همان سقفِ نرخِ ورود که «ازدحامِ سرد» بست؛
 *    • ۴۰۱ تا مرورگر می‌رسید و `web/src/api.ts` آن را «نشستِ **پنل** تمام شد» می‌خواند و صاحب سامانه
 *      را از پنل بیرون می‌انداخت — با این‌که نشستِ پنلش سالم بود.
 *
 *  حالا: ۴۰۱ ⇒ یک پرسشِ ‎GET /api/admin/me‎ با **همان** توکن (این مسیر در همهٔ نسخه‌ها هست).
 *    زنده ⇒ ‎501 account_server_outdated‎ — بی ورود، بی تکرار؛ صفحه می‌گوید «سرورِ حساب را به‌روز کنید».
 *    مرده ⇒ همان راهِ قبلی: یک ورودِ تک‌پرواز (`stale`) و یک بارِ دیگر.
 *  ⛔ و `cloud_session_expired` دیگر ۴۰۱ نیست بلکه ۴۰۹ — همان قاعدهٔ `doLogin` (۴۰۱ِ ورود ⇒ ۴۰۹).
 */
async function tokenAlive(bearer) {
  try {
    const r = await dial(`${cloudTarget()}/api/admin/me`, { headers: { authorization: `Bearer ${bearer}` } });
    await r.body?.cancel().catch(() => {});
    return r.status === 200;
  } catch { return false; }
}

function outdatedErr(path) {
  const err = new Error('این بخش روی نسخهٔ فعلیِ سرورِ حساب نیست — سرورِ حساب را به‌روز کنید');
  err.code = 'account_server_outdated';
  err.status = 501;
  err.path = String(path || '');
  return err;
}

function expiredErr() {
  const err = new Error('نشستِ مدیر روی سرورِ حساب تمام شده — دوباره وارد شوید');
  err.code = 'cloud_session_expired';
  err.status = 409;
  return err;
}

/** فرستادن با قاعدهٔ بالا؛ پاسخِ غیرِ ۴۰۱ همان‌طور که آمد برمی‌گردد. */
async function send401(send, t, creds, path) {
  let res = await send(t);
  if (res.status !== 401) return res;
  if (await tokenAlive(t)) throw outdatedErr(path);
  if (!creds) throw expiredErr();
  const next = await autoToken(true, t);
  res = await send(next);
  if (res.status !== 401) return res;
  if (await tokenAlive(next)) throw outdatedErr(path);
  throw expiredErr();
}

/** خودِ فرستادن — یک بار، و روی ۴۰۱ِ توکنِ خودکار فقط یک بار دیگر. */
async function authedSend(method, path, { query = {}, body = null, headers = {}, legacyOnly = false, timeout = 'normal', signal = null, replayFlag = false } = {}) {
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const url = `${cloudTarget()}${path}${qs ? `?${qs}` : ''}`;
  const send = (auth) => dial(url, {
    method,
    headers: {
      ...headers,
      ...auth,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }, { timeout, signal });

  //  کلیدِ سرویس، یا توکنِ خودکار (مرده ⇒ یک بار، و فقط یک بار، دوباره وارد شو؛ ولی ۴۰۱ِ «مسیر نیست» نه)
  const res = await sendAuthed(send, path, { legacyOnly });
  noteApiVersion(res);
  const out = await readBody(res);
  //  ‎Idempotent-Replayed: true‎ ِ سرورِ حساب (کلیدِ یکتاییِ خودش) ⇒ ‎replayed‎ در همان پاسخ — فقط درهایی که خواستند
  if (replayFlag && res.ok && out && typeof out === 'object' && !Array.isArray(out)
      && String(res.headers.get('idempotent-replayed') || '').toLowerCase() === 'true') out.replayed = true;

  if (!res.ok) {
    const verdict = SAFE_METHODS.has(method) ? null : tunnelVerdict(res.status, out);
    if (verdict) throw tunnelErr(method, path, res.status, verdict);
    const err = new Error(out?.error?.message || 'سرورِ حساب جواب نداد');
    err.code = out?.error?.code || 'cloud_error';
    err.status = res.status;
    //  بدنهٔ خطای بالادست برای درهایی که فیلدِ شناخته‌ای از آن می‌خواهند (مثلاً ‎products‎ ِ ‎409 changed_since‎) —
    //  ‎bridgeFail‎ آن را به مرورگر نمی‌فرستد؛ هر در خودش فقط همان فیلدِ سنجیده را برمی‌دارد
    if (out?.error && typeof out.error === 'object' && !Array.isArray(out.error)) err.upstream = out.error;
    throw err;
  }
  return out;
}

/**
 * همان در، برای **بایت** — فقط رسانهٔ پشتیبانیِ پمپ.
 *
 * ⛔ همان قفلِ ‎/api/admin/‎ و همان دو فعل: ‎POST‎ با بدنهٔ دودویی (بارگذاری،
 * پاسخ JSON) و ‎GET‎ با پاسخِ دودویی (گرفتن). این تابع دری تازه باز
 * نمی‌کند؛ فقط شکلِ بدنه و پاسخ فرق دارد. تنها صداکننده‌اش
 * ‎routes/account-admin.js‎ است و مسیر را خودش از فهرستِ سفید می‌سازد.
 *
 * ⚠️ سرورِ حساب رسانه را پس از رسیدن به گیرنده **پاک** می‌کند، پس هر
 * ‎GET‎ یک بار مصرف است — صداکننده باید همان لحظه روی دیسک نگهش دارد.
 *
 * ‎maxBytes‎ (فقط GET، ۱.۵۰.۹۸): سقفِ تنگ‌ترِ پاسخ برای همین در — مدرکِ پروندهٔ شکایت چند مگابایت است و پاسخِ بزرگ‌تر همان‌جا
 * بریده می‌شود، نه پس از ۳۲ مگابایتِ پل (‎502 account_server_too_large‎، `err.unreadable === 'too_large'`).
 *
 * @returns برای POST همان JSON؛ برای GET ‎{ buffer, contentType }‎
 */
//  ⏱️ بایت (رسانهٔ پشتیبانی تا ۲۵ مگابایت) با سرورِ حسابِ دور (راهِ تونل) واقعاً طول می‌کشد ⇒ پیش‌فرض «بلند»
//  ⛔ (۱.۵۰.۸۸، ۳-۹) بانکِ عکس: ‎PUT‎ (فایلِ دسته)، ‎query‎ ِ بارگذاری و ‎sha256‎ ⇒ ‎X-Content-SHA256‎ (سرورِ حساب درستیِ بایت‌ها را
//  پس از تونل می‌سنجد، IMG-14). تکهٔ آخرِ مسیر می‌تواند نامِ فایلِ ‎encodeURIComponent‎ شده باشد (‎.‎ و ‎%XX‎)؛ ‎..‎ هنوز نه.
export async function cloudRawBytes(method, path, { body = null, contentType = '', timeout = 'long', signal = null, query = {}, sha256 = '', maxBytes = 0 } = {}) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '');
  const write = m === 'POST' || m === 'PUT';
  if (!['GET', 'POST', 'PUT'].includes(m) || (write && !Buffer.isBuffer(body))
      || !/^\/api\/admin\/[A-Za-z0-9_\-/]+(?:\/[A-Za-z0-9_.%-]+)?$/.test(p) || p.includes('..')
      || (sha256 && !/^[0-9a-f]{64}$/.test(String(sha256)))) {
    const err = new Error('این مسیر از پنل باز نیست');
    err.code = 'path_not_allowed';
    err.status = 400;
    throw err;
  }
  const qs = new URLSearchParams(
    Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const url = `${cloudTarget()}${p}${qs ? `?${qs}` : ''}`;
  //  ⛔ رسانهٔ پشتیبانی یک‌بارمصرف است (بالا) ⇒ هرگز پشتِ سقفِ هم‌زمانیِ بدنه‌ها (`readCapped`): نه صف، نه ‎503‎
  const once = m === 'GET' && p.startsWith('/api/admin/support/media/');
  const send = (auth) => dial(url, {
    method: m,
    headers: {
      ...auth,
      ...(write ? { 'content-type': String(contentType || 'application/octet-stream') } : {}),
      ...(write && sha256 ? { 'x-content-sha256': String(sha256) } : {}),
    },
    body: write ? body : undefined,
  }, { timeout, signal, once, max: m === 'GET' ? maxBytes : 0 });

  const res = await sendAuthed(send, p);
  if (!res.ok || write) {
    const out = await readBody(res);
    if (!res.ok) {
      //  ۱.۵۰.۸۷ (۳-۱۵): بارگذاریِ بایت هم نوشتن است — همان قاعدهٔ پاسخِ تونل
      const verdict = write ? tunnelVerdict(res.status, out) : null;
      if (verdict) throw tunnelErr(m, p, res.status, verdict);
      const err = new Error(out?.error?.message || 'سرورِ حساب جواب نداد');
      err.code = out?.error?.code || 'cloud_error';
      err.status = res.status;
      throw err;
    }
    return out;
  }
  const buffer = await readBody(res, 'bytes');
  return { buffer, contentType: res.headers.get('content-type') || 'application/octet-stream' };
}

/**
 * همان در، ولی پاسخ **متن** است نه JSON.
 *
 * ⚠️ یک مصرف بیشتر ندارد و باید همان بماند: رسید و فاکتورِ سرورِ حساب
 * یک صفحهٔ HTMLِ چاپیِ فارسی است، نه PDF — مرورگر خودش «چاپ ⇒ ذخیره به
 * PDF» دارد و هیچ کتابخانهٔ PDFی نه این‌جا هست نه آن‌جا. اگر این تابع
 * JSON می‌خواست، آن صفحه را باید دوباره در پنل می‌ساختیم و همان لحظه
 * دو حقیقتِ جدا برای یک رسید می‌داشتیم.
 *
 * ⛔ همان فهرستِ سفید و همان قفلِ ‎/api/admin/‎؛ این تابع دری تازه باز
 * نمی‌کند، فقط شکلِ خواندنِ پاسخ فرق دارد.
 */
export async function cloudRawText(method, path, { query = {}, timeout = 'normal', signal = null } = {}) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '');
  if (m !== 'GET' || !/^\/api\/admin\/[A-Za-z0-9_\-/]+$/.test(p) || p.includes('..')) {
    const err = new Error('این مسیر از پنل باز نیست');
    err.code = 'path_not_allowed';
    err.status = 400;
    throw err;
  }
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const url = `${cloudTarget()}${p}${qs ? `?${qs}` : ''}`;
  const send = (auth) => dial(url, { method: m, headers: { ...auth } }, { timeout, signal });

  const res = await sendAuthed(send, p);
  const text = await readBody(res, 'text');
  if (!res.ok) {
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* متنِ ساده */ }
    const err = new Error(payload?.error?.message || 'سرورِ حساب جواب نداد');
    err.code = payload?.error?.code || 'cloud_error';
    err.status = res.status;
    throw err;
  }
  return { text, contentType: res.headers.get('content-type') || 'text/html; charset=utf-8' };
}
