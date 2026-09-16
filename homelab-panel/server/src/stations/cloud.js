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
//  ⚠️ **فهرستِ سفیدِ مسیرها**: پنل فقط همین چند مسیر را می‌تواند صدا
//  بزند. بی این، یک پروکسیِ باز می‌داشتیم که هر مسیرِ مدیریتیِ ابر —
//  از جمله بخشِ دکان — را با توکنِ مدیر باز می‌کرد.
// ---------------------------------------------------------------------------
import { putSecret, listSecrets, readSecret, deleteSecret, vaultReady } from '../control/vault.js';

/** نشانیِ ابر — قفل، نه از تنظیمات. */
export const CLOUD_BASE = 'https://api.vill3n.top';

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

  //  ⚠️ فقط برای آینه (‎cloud-mirror.js‎) — پنل این‌ها را نشان نمی‌دهد.
  //  خواستهٔ صاحب مخزن: «فولدرِ سرور همه‌چی رو داشته باشه، چه از این چه
  //  از اپِ شاپ.» پس حساب‌ها و اشتراک‌های دکان هم به پوشه می‌آیند.
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

/** آیا مرکز فرمان به ابر وصل است. */
export function cloudStatus() {
  const row = tokenRow();
  return {
    base: CLOUD_BASE,
    linked: !!row,
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

  const res = await fetch(`${CLOUD_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body?.token) {
    const err = new Error(body?.error?.message || 'ورود به سرورِ ابر نشد');
    err.code = body?.error?.code || 'cloud_login_failed';
    err.status = res.status;
    throw err;
  }

  putSecret({
    name: SECRET_NAME,
    kind: 'api_key',
    scope: 'global',
    value: body.token,
    note: 'توکنِ مدیرِ بخشِ پمپ روی سرورِ ابر',
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
  const t = token();
  if (!t) {
    const err = new Error('هنوز به سرورِ ابر وصل نشده‌اید');
    err.code = 'not_linked';
    err.status = 409;
    throw err;
  }

  const [method, path] = entry;
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();

  const res = await fetch(`${CLOUD_BASE}${path}${qs ? `?${qs}` : ''}`, {
    method,
    headers: {
      authorization: `Bearer ${t}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const out = await res.json().catch(() => ({}));

  if (res.status === 401) {
    //  توکنِ مدیر عمرِ کوتاهی دارد؛ «دوباره وارد شوید» بهتر از یک
    //  خطای گنگ است.
    const err = new Error('نشستِ ابر تمام شده — دوباره وارد شوید');
    err.code = 'cloud_session_expired';
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(out?.error?.message || 'سرورِ ابر جواب نداد');
    err.code = out?.error?.code || 'cloud_error';
    err.status = res.status;
    throw err;
  }
  return out;
}
