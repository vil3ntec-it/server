// ---------------------------------------------------------------------------
//  دسترسیِ نقش‌محور
//
//  مرکز فرمان به همهٔ زیرساخت دسترسی دارد، پس هر کسی نباید هر کاری بکند.
//  سه نقش داریم و اجازه‌ها انباشتی‌اند:
//
//      viewer    فقط می‌بیند و آزمایش می‌کند
//      operator  می‌سازد، ویرایش می‌کند، بکاپ می‌گیرد
//      admin     همهٔ کارها: گاوصندوق، حذف، بازگردانی، انتقال، به‌روزرسانی،
//                Cloudflare و مدیریتِ خودِ کاربرانِ پنل
//
//  اولین حسابی که ساخته می‌شود همیشه admin است و هرگز نمی‌شود آخرین admin را
//  حذف کرد یا از کار انداخت.
// ---------------------------------------------------------------------------
import { db } from '../db.js';
import { audit } from './audit.js';
import { clientIp } from '../platform/security.js';

export const ROLES = ['viewer', 'operator', 'admin'];

/** هر نقش، نقش‌های پایین‌ترش را هم در بر می‌گیرد */
const RANK = { viewer: 0, operator: 1, admin: 2 };

export function rankOf(role) {
  return RANK[role] ?? -1;
}

export function atLeast(role, needed) {
  return rankOf(role) >= rankOf(needed);
}

/** توضیحِ خواندنیِ هر نقش — برای رابط کاربری */
export const ROLE_ABILITIES = {
  viewer: ['دیدنِ همهٔ صفحه‌ها', 'اجرای آزمونِ اتصال'],
  operator: ['ساخت و ویرایشِ پروژه، سرور، دامنه و Endpoint', 'گرفتنِ بکاپ', 'ثبتِ انتشار و پیکربندی'],
  admin: ['گاوصندوق', 'حذف و بازگردانی و انتقال', 'Cloudflare', 'به‌روزرسانی برنامه', 'مدیریتِ کاربرانِ پنل'],
};

/** نقشِ کاربرِ درخواست — اگر معلوم نبود، کم‌ترین دسترسی */
export function roleOf(req) {
  const id = req?.user?.id;
  if (!id) return 'viewer';
  const row = db.prepare('SELECT role, disabled FROM users WHERE id = ?').get(Number(id));
  if (!row || row.disabled) return 'viewer';
  return ROLES.includes(row.role) ? row.role : 'viewer';
}

/**
 * میان‌افزار: این مسیر دستِ‌کم چه نقشی می‌خواهد.
 *     router.post('/…', requireRole('admin'), handler)
 */
export function requireRole(needed) {
  return (req, res, next) => {
    const role = roleOf(req);
    if (!atLeast(role, needed)) {
      audit({
        actor: req?.user?.username || 'unknown',
        action: 'access.denied',
        entity: req.baseUrl + req.path,
        result: 'forbidden',
        detail: { role, needed },
      });
      return res.status(403).json({ error: 'forbidden', detail: { role, needed } });
    }
    req.role = role;
    next();
  };
}

/**
 * مسیرهایی که با POST صدا زده می‌شوند ولی در واقع فقط «نگاه می‌کنند»:
 * آزمونِ اتصال، بررسیِ دامنه، وارسیِ پورت و بکاپ. اینها برای viewer هم بازند.
 */
const PROBE_ONLY = /\/(test|check|inspect|validate|preview|verify|run|sync)$/;

/** نوشتن دستِ‌کم operator می‌خواهد؛ خواندن و آزمایش برای همه باز است */
export function writeNeedsOperator(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.method === 'POST' && PROBE_ONLY.test(req.path)) return next();
  return requireRole('operator')(req, res, next);
}

/* ------------------------ مدیریتِ کاربرانِ پنل -------------------------- */

/*
 *  ⛔ مالکِ اصلیِ پنل (۱۴۰۵/۰۸/۰۹، برنامهٔ پنلِ مرکزی §۲): «مالکِ اصلی حذف،
 *  تعلیق یا تغییرِ نقش نمی‌شود». تا امروز فقط «آخرین مدیر» محافظت داشت؛ پس
 *  مدیرِ دوم (یا نشستِ دزدیده‌شدهٔ او) می‌توانست صاحبِ سامانه را تنزل دهد،
 *  ببندد، پاک کند یا رمزش را عوض کند و او را از پنلِ خودش بیرون بگذارد.
 *
 *  مالک = قدیمی‌ترین مدیرِ فعال (کم‌ترین id) — همان حسابِ `/api/auth/setup`.
 *  ستون یا مهاجرتِ تازه لازم نیست: چون هیچ‌کس نمی‌تواند او را تنزل دهد یا
 *  ببندد، همین قاعده همیشه همان آدم را برمی‌گرداند.
 */
export function ownerId() {
  return db.prepare("SELECT MIN(id) AS id FROM users WHERE role = 'admin' AND disabled = 0").get()?.id ?? null;
}

export function isOwner(id) {
  const owner = ownerId();
  return owner != null && Number(id) === Number(owner);
}

export function listPanelUsers() {
  const owner = ownerId();
  return db
    .prepare('SELECT id, username, role, disabled, created_at, last_login, last_login_at, totp_enabled FROM users ORDER BY created_at')
    .all()
    .map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      disabled: Boolean(u.disabled),
      created_at: u.created_at,
      last_login: u.last_login ?? u.last_login_at ?? null,
      totp: Boolean(u.totp_enabled),
      owner: u.id === owner,
    }));
}

export function adminCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get().n;
}

/* ═══════════════ یک قاعده برای هر دو درِ کاربران (۶-۲ / S17) ═══════════════
 *
 *  ⛔ تا ۱.۵۰.۶۱ دو API ِ کاربران با قاعده‌های نابرابر بود: `/api/auth/users`
 *  (رابطِ وب و «ویلن ادمین») خودِ مدیر را تنزل می‌داد و می‌بست، ساختن و حذفش
 *  در دفترِ رخداد نبود و نامِ کاربری را نمی‌سنجید؛ `/api/panel/v1/users` همهٔ
 *  این‌ها را داشت ولی بازنشانیِ رمزش با نشستِ هر مدیری می‌شد. حالا هر دو همین
 *  تابع‌ها را صدا می‌زنند و فقط شکلِ پاسخشان فرق دارد:
 *
 *    • خودت: نه تنزل، نه بستن، نه حذف؛ رمزِ خودت فقط با رمزِ فعلی
 *    • آخرین مدیرِ فعال نمی‌رود · مالکِ اصلی دست نمی‌خورد (403 owner_protected)
 *    • تغییرِ نقش یا بستن ⇒ همهٔ نشست‌های آن کاربر همان لحظه باطل
 *    • هر کار — و هر تلاشِ ردشده روی مالک — یک ردیف در دفترِ رخدادها
 *    • همهٔ نوشتن‌ها پشتِ `requireRecentAuth` (رمز در ده دقیقهٔ گذشته) — در روتر
 */
export const USERNAME_RE = /^[\p{L}\p{N}._-]{3,40}$/u;

export function panelUserError(code, status = 400) {
  const e = new Error(code);
  e.code = code;
  e.status = status;
  return e;
}

function targetOf(id) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!user) throw panelUserError('not_found', 404);
  return user;
}

const actorName = (req) => req?.user?.username || 'unknown';

function auditUser(req, action, entityId, extra = {}) {
  audit({ actor: actorName(req), ip: clientIp(req), action, entity: 'user', entityId, ...extra });
}

/** نام، رمز و نقشِ کاربرِ تازه — همان قاعده برای هر دو در. */
export function checkNewUser({ username, password, role }) {
  const name = typeof username === 'string' ? username.trim() : '';
  if (name.length < 3) throw panelUserError('username_too_short');
  if (!USERNAME_RE.test(name)) throw panelUserError('username_invalid');
  if (typeof password !== 'string' || password.length < 8) throw panelUserError('password_too_short');
  if (password.length > 200) throw panelUserError('password_too_long');
  if (!ROLES.includes(role)) throw panelUserError('invalid_role');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(name)) throw panelUserError('username_taken', 409);
  return { username: name, password, role };
}

export function createPanelUser(req, input, createUser) {
  const { username, password, role } = checkNewUser(input);
  const user = createUser(username, password, role);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  auditUser(req, 'panel.user.create', username, { detail: { role } });
  return { id: user.id, username, role, disabled: false, created_at: user.created_at };
}

/** دستِ کسی به مالک نمی‌رسد — و تلاشش می‌ماند. */
function ownerDenied(req, target, what) {
  auditUser(req, 'panel.user.owner_protected', String(target.id), { result: 'forbidden', detail: { what, username: target.username } });
  return panelUserError('owner_protected', 403);
}

export function updatePanelUser(req, id, body = {}) {
  const target = targetOf(id);
  const self = Number(target.id) === Number(req.user?.id);
  let role = target.role;
  let disabled = target.disabled ? 1 : 0;
  if (body.role !== undefined) {
    if (!ROLES.includes(body.role)) throw panelUserError('invalid_role');
    role = body.role;
    // مدیر نباید بتواند خودش را از مدیریت بیندازد و پنل را قفل کند
    if (self && role !== 'admin') throw panelUserError('cannot_demote_self');
  }
  if (body.disabled !== undefined) {
    disabled = body.disabled === true || body.disabled === 1 || body.disabled === 'true' ? 1 : 0;
    if (self && disabled) throw panelUserError('cannot_disable_self');
  }
  const losingAdmin = target.role === 'admin' && !target.disabled && (role !== 'admin' || disabled);
  if (losingAdmin && adminCount() <= 1) throw panelUserError('last_admin');
  if (losingAdmin && isOwner(target.id)) throw ownerDenied(req, target, body.role !== undefined && role !== 'admin' ? 'role' : 'disable');

  if (role === target.role && disabled === (target.disabled ? 1 : 0)) return { ...target, password_hash: undefined };
  db.prepare('UPDATE users SET role = ?, disabled = ? WHERE id = ?').run(role, disabled, target.id);
  // تغییرِ دسترسی باید فوری اثر کند، نه بعد از انقضای توکن
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  if (role !== target.role) auditUser(req, 'panel.user.role', target.username, { detail: { from: target.role, to: role } });
  if (disabled !== (target.disabled ? 1 : 0)) auditUser(req, disabled ? 'panel.user.disable' : 'panel.user.enable', target.username);
  return { id: target.id, username: target.username, role, disabled: Boolean(disabled) };
}

/** بازنشانیِ رمزِ کاربرِ **دیگر** — رمزِ خودت فقط با رمزِ فعلی (`change-password`). */
export function resetPanelUserPassword(req, id, password, hashPassword) {
  const target = targetOf(id);
  if (Number(target.id) === Number(req.user?.id)) throw panelUserError('use_change_password');
  if (isOwner(target.id)) throw ownerDenied(req, target, 'password');
  if (typeof password !== 'string' || password.length < 8) throw panelUserError('password_too_short');
  if (password.length > 200) throw panelUserError('password_too_long');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), target.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  auditUser(req, 'panel.user.password_reset', target.username);
  return true;
}

export function deletePanelUser(req, id) {
  const target = targetOf(id);
  if (Number(target.id) === Number(req.user?.id)) throw panelUserError('cannot_delete_self');
  if (target.role === 'admin' && !target.disabled && adminCount() <= 1) throw panelUserError('last_admin');
  if (isOwner(target.id)) throw ownerDenied(req, target, 'delete');
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id); // نشست‌ها با CASCADE می‌روند
  auditUser(req, 'panel.user.delete', target.username);
  return true;
}
