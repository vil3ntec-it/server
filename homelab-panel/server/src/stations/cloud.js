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
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body?.token) {
    const err = new Error(body?.error?.message || 'ورود به سرورِ حساب نشد');
    err.code = body?.error?.code || 'cloud_login_failed';
    err.status = res.status;
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
  //  کلیدِ سرویس (اگر هست و پذیرفته است) جلوتر؛ وگرنه ورودِ خودکار، وگرنه توکنِ گاوصندوق (`sendAuthed`)
  const [method, path] = entry;
  return authedSend(method, path, { query, body });
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
export async function cloudRaw(method, path, { query = {}, body = null, headers = {}, legacyOnly = false } = {}) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '');
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)
      || !/^\/api\/admin\/[A-Za-z0-9_\-/]+$/.test(p) || p.includes('..')) {
    const err = new Error('این مسیر از پنل باز نیست');
    err.code = 'path_not_allowed';
    err.status = 400;
    throw err;
  }
  return authedSend(m, p, { query, body, headers: extraHeaders(headers), legacyOnly });
}

/*
 *  ⛔ سرآیندِ اضافه فقط «کلیدِ یکتایی» (‎Idempotency-Key‎ ِ سرورِ حساب، همان الگو) — نه هر سرآیندی:
 *  وگرنه صداکننده می‌توانست ‎X-Actor-*‎ یا ‎Authorization‎ را خودش بنویسد.
 */
const IDEM_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
function extraHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) {
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
  const body = await res.json().catch(() => ({}));
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
      await res.arrayBuffer().catch(() => null);
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
    const r = await fetch(`${cloudTarget()}/api/admin/me`, { headers: { authorization: `Bearer ${bearer}` } });
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
async function authedSend(method, path, { query = {}, body = null, headers = {}, legacyOnly = false } = {}) {
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
  });

  //  کلیدِ سرویس، یا توکنِ خودکار (مرده ⇒ یک بار، و فقط یک بار، دوباره وارد شو؛ ولی ۴۰۱ِ «مسیر نیست» نه)
  const res = await sendAuthed(send, path, { legacyOnly });
  const out = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(out?.error?.message || 'سرورِ حساب جواب نداد');
    err.code = out?.error?.code || 'cloud_error';
    err.status = res.status;
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
 * @returns برای POST همان JSON؛ برای GET ‎{ buffer, contentType }‎
 */
export async function cloudRawBytes(method, path, { body = null, contentType = '' } = {}) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path || '');
  if (!['GET', 'POST'].includes(m) || (m === 'POST' && !Buffer.isBuffer(body))
      || !/^\/api\/admin\/[A-Za-z0-9_\-/]+$/.test(p) || p.includes('..')) {
    const err = new Error('این مسیر از پنل باز نیست');
    err.code = 'path_not_allowed';
    err.status = 400;
    throw err;
  }
  const url = `${cloudTarget()}${p}`;
  const send = (auth) => dial(url, {
    method: m,
    headers: {
      ...auth,
      ...(m === 'POST' ? { 'content-type': String(contentType || 'application/octet-stream') } : {}),
    },
    body: m === 'POST' ? body : undefined,
  });

  const res = await sendAuthed(send, p);
  if (!res.ok || m === 'POST') {
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(out?.error?.message || 'سرورِ حساب جواب نداد');
      err.code = out?.error?.code || 'cloud_error';
      err.status = res.status;
      throw err;
    }
    return out;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
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
export async function cloudRawText(method, path, { query = {} } = {}) {
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
  const send = (auth) => dial(url, { method: m, headers: { ...auth } });

  const res = await sendAuthed(send, p);
  const text = await res.text().catch(() => '');
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
