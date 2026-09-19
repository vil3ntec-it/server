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

async function autoToken(force = false) {
  const creds = autoCreds();
  if (!creds) return null;
  const fresh = auto?.token && (!auto.expiresAt || auto.expiresAt - Date.now() > 60_000);
  if (!force && fresh) return auto.token;

  const res = await dial(`${cloudTarget()}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(creds),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.token) {
    auto = null;
    const err = new Error(body?.error?.message
      ? `ورودِ خودکار به سرورِ حساب نشد: ${body.error.message} — HLP_ACCOUNT_ADMIN_USER/PASSWORD را بسنجید`
      : 'ورودِ خودکار به سرورِ حساب نشد — HLP_ACCOUNT_ADMIN_USER/PASSWORD را بسنجید');
    err.code = body?.error?.code === 'bad_credentials' ? 'auto_login_rejected' : (body?.error?.code || 'auto_login_failed');
    err.status = res.status === 401 ? 409 : res.status;
    throw err;
  }
  const exp = body.expiresAt ? Number(new Date(body.expiresAt)) : NaN;
  auto = { token: body.token, expiresAt: Number.isFinite(exp) ? exp : null };
  return auto.token;
}

/** برای آزمون: توکنِ خودکار را دور بریز. */
export function cloudResetAuto() { auto = null; }

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
    t = await autoToken(true);
    res = await send(t);
  }

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
    const err = new Error(out?.error?.message || 'سرورِ حساب جواب نداد');
    err.code = out?.error?.code || 'cloud_error';
    err.status = res.status;
    throw err;
  }
  return out;
}
