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

export function listPanelUsers() {
  return db
    .prepare('SELECT id, username, role, disabled, created_at, last_login FROM users ORDER BY created_at')
    .all()
    .map((u) => ({ ...u, disabled: Boolean(u.disabled) }));
}

export function adminCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0").get().n;
}

export function setRole(id, role, actor = 'admin') {
  if (!ROLES.includes(role)) throw new Error('invalid_role');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!user) throw new Error('not_found');
  // آخرین مدیر نباید از دستِ خودش برود
  if (user.role === 'admin' && role !== 'admin' && adminCount() <= 1) throw new Error('last_admin');
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  audit({ actor, action: 'panel.user.role', entity: 'user', entityId: user.username, detail: { from: user.role, to: role } });
  return { ...user, role, password_hash: undefined };
}

export function setDisabled(id, disabled, actor = 'admin') {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!user) throw new Error('not_found');
  if (disabled && user.role === 'admin' && adminCount() <= 1) throw new Error('last_admin');
  db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, user.id);
  // حسابِ از کار افتاده نباید نشستِ باز داشته باشد
  if (disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  audit({ actor, action: disabled ? 'panel.user.disable' : 'panel.user.enable', entity: 'user', entityId: user.username });
  return true;
}

export function deletePanelUser(id, actor = 'admin') {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!user) throw new Error('not_found');
  if (user.role === 'admin' && adminCount() <= 1) throw new Error('last_admin');
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  audit({ actor, action: 'panel.user.delete', entity: 'user', entityId: user.username });
  return true;
}
