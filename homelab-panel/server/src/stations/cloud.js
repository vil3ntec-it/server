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

/**
 * fetch که خطای شبکه را به خطای بادار برمی‌گرداند.
 *
 * ‎ECONNREFUSED‎ روی نشانیِ محلی یعنی سرورِ حساب روی همین کامپیوتر روشن
 * نیست — و پیامش باید همان راهِ درست کردن را بگوید (‎downPayload‎)، نه
 * «fetch failed».
 */
async function dial(url, init) {
  try {
    return await fetch(url, init);
  } catch (e) {
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

/* ══════════ سقفِ نرخ: یک دروازه برای **کلِ** پل، نه فقط درِ ورود ══════════
 *
 *  گزارشِ صاحب سامانه با عکس (۱۴۰۵/۰۷/۱۱)، بارِ سوم: «کدهای ورودِ
 *  برنامه‌ها نیامد — سقفِ نرخِ سرورِ حساب پر شده» و هر شمارنده صفر. و
 *  همان نوار روی میزِ فروشگاه.
 *
 *  ۱.۴۷.۴ مهلتِ ورودِ ناموفق را ساخت و ۱.۵۰.۲ ورودهای هم‌زمان را یکی
 *  کرد. هر دو درست بودند و هر دو فقط **درِ ورود** را می‌دیدند. ولی
 *  سرورِ حساب یک سقفِ **همگانی** هم دارد که روی هر درخواست می‌نشیند:
 *
 *      app.use(rateLimit({ max: generalMax }))   // shop/server/src/app.js
 *      generalMax = ۶۰۰ در پنجرهٔ ۱۵ دقیقه، برای هر IP
 *
 *  و همهٔ ترافیکِ این پنل از **یک** IP می‌رود (۱۲۷.۰.۰.۱، چون پل
 *  مستقیم به سرورِ حساب روی همین کامپیوتر می‌زند): دیدبانِ زنده هر ده
 *  ثانیه، آینهٔ کدها، سه ربات، و هر صفحه‌ای که باز است.
 *
 *  ⛔ و `cloudRaw` عددِ ۴۲۹ را **اصلاً نمی‌دید** — نه مهلتی، نه
 *  `Retry-After`ی. خطا را بالا می‌داد و ده ثانیهٔ بعد دیدبان باز می‌زد.
 *  یعنی پنل با ضربانِ خودش پنجره را پر **نگه می‌داشت** و پنجرهٔ
 *  ربع‌ساعته هیچ‌وقت خالی نمی‌شد: با رمزِ کاملاً درست و سرورِ کاملاً
 *  سالم، هیچ کدی و هیچ ردیفی هیچ‌وقت نمی‌آمد. همان بن‌بستِ «نبضِ کلیدِ
 *  مرده» در `admin-gate.js`، این بار از سمتِ خودمان و روی کلِ پل.
 *
 *  ⛔ پس مهلت از درِ ورود بیرون آمد و روی **کلِ پل** نشست: تا مهلت تمام
 *  نشود هیچ چیزی از این پل بیرون نمی‌رود — نه ورود، نه داده، نه دیدبان،
 *  نه ربات. صفرِ مطلق، تا پنجره خودش خالی شود.
 */

/** پنجرهٔ سقفِ نرخِ سرورِ حساب (`RATE_WINDOW_MS`) — صبرِ بیشتر از این بی‌معناست */
const LIMIT_WINDOW_MS = 15 * 60_000;

/**
 *  پله‌های عقب‌نشینی.
 *
 *  ⚠️ **پلهٔ اول صفر است و این عمدی است**: حرفِ خودِ سرور مقدم می‌ماند
 *  (قاعدهٔ ۱.۴۷.۴) و یک ۴۲۹ِ تکی با همان `Retry-After` تمام می‌شود.
 *
 *  ⚠️ ولی از ۴۲۹ِ **دوم** به بعد کف بالا می‌رود، چون `Retry-After`ِ این
 *  سرور می‌گوید کِی قدیمی‌ترین ضربه از پنجره می‌افتد — یعنی **یک** خانه
 *  آزاد می‌شود. پنلی که همان لحظه رگبارش را دوباره بزند همان یک خانه را
 *  می‌خورد و باز ۴۲۹ می‌گیرد: عقب‌نشینیِ خانه‌به‌خانه که هیچ‌وقت تمام
 *  نمی‌شود.
 */
const LIMIT_STEPS = [0, 30_000, 2 * 60_000, 5 * 60_000, LIMIT_WINDOW_MS];

/** سرور `Retry-After` نداد ⇒ کورکورانه نپرس؛ نیم دقیقه صبر کن */
const LIMIT_BLIND_MS = 30_000;

let limited = null;    // { until } — تا این لحظه هیچ درخواستی زده نمی‌شود
let limitStreak = 0;   // چند ۴۲۹ِ پشتِ سرِ هم؛ با اولین پاسخِ سالم صفر

/** خطای «الان نمی‌پرسیم» — شکلش همان قراردادِ صافِ این پنل است. */
function limitError(waitMs) {
  const secs = Math.max(1, Math.ceil(waitMs / 1000));
  const err = new Error(
    `سقفِ نرخِ سرورِ حساب پر شده — تا ${secs} ثانیهٔ دیگر چیزی از آن نمی‌پرسیم تا خودش خالی شود`
  );
  err.code = 'rate_limited';
  err.status = 429;
  err.retryAfter = secs;
  return err;
}

/** آیا این پاسخ «زیادی زدی» است؟ */
function isRateLimited(status, code) { return status === 429 || code === 'rate_limited'; }

/** ۴۲۹ آمد ⇒ کلِ پل تا پایانِ مهلت می‌خوابد. */
function noteLimit(res) {
  const retryAfter = Number(res?.headers?.get?.('retry-after'));
  const floor = LIMIT_STEPS[Math.min(limitStreak, LIMIT_STEPS.length - 1)];
  limitStreak += 1;
  const asked = Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter * 1000 + 1_000
    : LIMIT_BLIND_MS;
  const wait = Math.min(Math.max(asked, floor), LIMIT_WINDOW_MS);
  limited = { until: Date.now() + wait };
  return wait;
}

/** هر پاسخِ سالم یعنی پنجره باز است — و شمارنده از نو. */
function clearLimit() { limited = null; limitStreak = 0; }

/**
 * دروازه — پیش از **هر** درخواستِ این پل.
 *
 * ⛔ این تنها چیزی است که پنجرهٔ سرورِ حساب را خالی می‌کند؛ بی آن، هر
 * تلاش خودش دلیلِ تلاشِ بعدی است.
 */
function limitGate() {
  if (!limited) return;
  const left = limited.until - Date.now();
  if (left <= 0) { limited = null; return; }
  throw limitError(left);
}

/** برای آزمون و برای ناظر: پل همین حالا در مهلت است یا نه. */
export function cloudLimitState() {
  if (!limited) return { limited: false, secondsLeft: 0, streak: limitStreak };
  const left = limited.until - Date.now();
  if (left <= 0) { limited = null; return { limited: false, secondsLeft: 0, streak: limitStreak }; }
  return { limited: true, secondsLeft: Math.ceil(left / 1000), streak: limitStreak };
}

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
  //  ⛔ داخلِ مهلتِ سقفِ نرخ، حتی ورود هم زده نمی‌شود
  limitGate();
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
  });
  const body = await res.json().catch(() => ({}));
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
    err.status = res.status === 401 ? 409 : res.status;

    const retryAfter = Number(res.headers?.get?.('retry-after'));
    //  ⛔ ۴۲۹ِ درِ ورود هم کلِ پل را می‌خواباند: دیدبان و ربات‌ها که
    //  هم‌زمان می‌زنند، همان پنجره را پر نگه می‌دارند.
    if (isRateLimited(res.status, body?.error?.code)) noteLimit(res);
    const cool = coolFor(res.status, body?.error?.code, retryAfter);
    autoFail = cool > 0
      ? { until: Date.now() + cool, code: err.code, message: err.message, status: err.status }
      : null;
    throw err;
  }
  autoFail = null;
  clearLimit();
  const exp = body.expiresAt ? Number(new Date(body.expiresAt)) : NaN;
  auto = { token: body.token, expiresAt: Number.isFinite(exp) ? exp : null };
  return auto.token;
}

/** برای آزمون: توکنِ خودکار را دور بریز. */
export function cloudResetAuto() { auto = null; autoFail = null; autoInFlight = null; limited = null; limitStreak = 0; }

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
    linked: !!row || !!creds,
    auto: !!creds,
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
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body?.token) {
    const err = new Error(body?.error?.message || 'ورود به سرورِ حساب نشد');
    err.code = body?.error?.code || 'cloud_login_failed';
    err.status = res.status;
    throw err;
  }

  /*
   *  ⚠️ **ورودِ دستی دروازه نمی‌خورد و این عمدی است**: آدمی که خودش دکمه
   *  را زده، یک درخواست است نه یک ضربان — و باید جوابِ واقعیِ سرور را
   *  ببیند، نه «ما داریم صبر می‌کنیم». ولی موفقیتش یعنی پنجره باز است،
   *  پس مهلتِ خودکار هم همان‌جا برداشته می‌شود.
   */
  clearLimit();

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
export async function cloudCall(name, { query = {}, body = null, params = {} } = {}) {
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
  //  ورودِ خودکار (اگر تنظیم است) همیشه جلوتر از توکنِ گاوصندوق: آن یکی
  //  دوازده ساعته می‌میرد و کسی نیست دوباره وارد شود؛ این یکی خودش تازه می‌شود.
  limitGate();
  const creds = autoCreds();
  let t = creds ? await autoToken() : token();
  if (!t) {
    const err = new Error('هنوز با حسابِ مدیر به سرورِ حساب وارد نشده‌اید — از پنل ← پمپ‌ها ← تنظیمات و داده‌ها، یا از همین اپ');
    err.code = 'not_linked';
    err.status = 409;
    throw err;
  }

  const [method, path] = entry;
  return authedSend(method, path, { query, body, creds, token: t });
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
export async function cloudRaw(method, path, { query = {}, body = null } = {}) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)
      || !/^\/api\/admin\/[A-Za-z0-9_\-/]+$/.test(p) || p.includes('..')) {
    const err = new Error('این مسیر از پنل باز نیست');
    err.code = 'path_not_allowed';
    err.status = 400;
    throw err;
  }
  limitGate();
  const creds = autoCreds();
  const t = creds ? await autoToken() : token();
  if (!t) {
    const err = new Error('هنوز با حسابِ مدیر به سرورِ حساب وارد نشده‌اید — از پنل ← پمپ‌ها ← تنظیمات و داده‌ها، یا از همین اپ');
    err.code = 'not_linked';
    err.status = 409;
    throw err;
  }
  return authedSend(m, p, { query, body, creds, token: t });
}

/** خودِ فرستادن — یک بار، و روی ۴۰۱ِ توکنِ خودکار فقط یک بار دیگر. */
async function authedSend(method, path, { query = {}, body = null, creds, token: t }) {
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const url = `${cloudTarget()}${path}${qs ? `?${qs}` : ''}`;
  const send = (bearer) => dial(url, {
    method,
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let res = await send(t);
  if (res.status === 401 && creds) {
    //  توکنِ خودکار مرده — یک بار، و فقط یک بار، دوباره وارد شو
    t = await autoToken(true, t);
    res = await send(t);
  }

  /*
   *  ⛔ **۴۲۹ِ مسیرِ داده، نه فقط مسیرِ ورود.** تا دیروز این عدد مثلِ هر
   *  خطای دیگری بالا می‌رفت و ده ثانیهٔ بعد دیدبان باز می‌زد — یعنی پنل
   *  خودش پنجرهٔ سقفِ نرخِ سرورِ حساب را پر **نگه می‌داشت** و آن پنجره
   *  هیچ‌وقت خالی نمی‌شد. حالا همین‌جا کلِ پل می‌خوابد.
   */
  if (res.status === 429) throw limitError(noteLimit(res));

  const out = await res.json().catch(() => ({}));

  if (res.status === 401) {
    //  توکنِ مدیر عمرِ کوتاهی دارد؛ «دوباره وارد شوید» بهتر از یک
    //  خطای گنگ است.
    const err = new Error('نشستِ مدیر روی سرورِ حساب تمام شده — دوباره وارد شوید');
    err.code = 'cloud_session_expired';
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    if (isRateLimited(res.status, out?.error?.code)) throw limitError(noteLimit(res));
    const err = new Error(out?.error?.message || 'سرورِ حساب جواب نداد');
    err.code = out?.error?.code || 'cloud_error';
    err.status = res.status;
    throw err;
  }
  //  پاسخِ سالم ⇒ پنجره باز است، و شمارنده از نو
  clearLimit();
  return out;
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
export async function cloudRawText(method, path, { query = {} } = {}) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '');
  if (m !== 'GET' || !/^\/api\/admin\/[A-Za-z0-9_\-/]+$/.test(p) || p.includes('..')) {
    const err = new Error('این مسیر از پنل باز نیست');
    err.code = 'path_not_allowed';
    err.status = 400;
    throw err;
  }
  limitGate();
  const creds = autoCreds();
  let t = creds ? await autoToken() : token();
  if (!t) {
    const err = new Error('هنوز با حسابِ مدیر به سرورِ حساب وارد نشده‌اید — از پنل ← پمپ‌ها ← تنظیمات و داده‌ها، یا از همین اپ');
    err.code = 'not_linked';
    err.status = 409;
    throw err;
  }
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  const url = `${cloudTarget()}${p}${qs ? `?${qs}` : ''}`;
  const send = (bearer) => dial(url, { method: m, headers: { authorization: `Bearer ${bearer}` } });

  let res = await send(t);
  if (res.status === 401 && creds) {
    t = await autoToken(true, t);
    res = await send(t);
  }
  if (res.status === 429) throw limitError(noteLimit(res));
  const text = await res.text().catch(() => '');
  if (res.status === 401) {
    const err = new Error('نشستِ مدیر روی سرورِ حساب تمام شده — دوباره وارد شوید');
    err.code = 'cloud_session_expired';
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    let payload = null;
    try { payload = JSON.parse(text); } catch { /* متنِ ساده */ }
    const err = new Error(payload?.error?.message || 'سرورِ حساب جواب نداد');
    err.code = payload?.error?.code || 'cloud_error';
    err.status = res.status;
    throw err;
  }
  clearLimit();
  return { text, contentType: res.headers.get('content-type') || 'text/html; charset=utf-8' };
}
