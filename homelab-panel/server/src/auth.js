// ---------------------------------------------------------------------------
// احراز هویت: رمز عبورِ هش‌شده با scrypt + توکن JWT + نشست‌ها
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, getSetting, setSetting, logEvent } from './db.js';
import { config } from './config.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, saltHex, keyHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// راز امضای JWT.
//   ۱) اگر HLP_SECRET_KEY در محیط باشد، همان — راز در بکاپِ دیتابیس نمی‌رود و
//      با بازسازیِ دیتابیس هم نشست‌ها نمی‌پرند.
//   ۲) وگرنه مثل قبل: یک‌بار ساخته و در دیتابیس نگهداری می‌شود، تا نصبِ
//      یک‌کلیکی بدونِ هیچ تنظیمی کار کند.
export function jwtSecret() {
  if (config.secretKey) return config.secretKey;
  let s = getSetting('jwt_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('jwt_secret', s);
  }
  return s;
}

// ---------------------------------------------------------------------------
//  نقش‌ها
//
//  تا امروز هر کسی که وارد می‌شد همه‌کاره بود: می‌توانست فایل پاک کند، پروسه
//  اجرا کند و تنظیمات را عوض کند. حالا سه سطح داریم — از کم به زیاد:
//
//    viewer    فقط دیدن: داشبورد، وضعیت سرویس‌ها، لاگ‌ها
//    operator  کارِ روزمره: اجرا/توقف/ری‌استارتِ سرویس، فایل، بکاپ گرفتن
//    admin     همه‌چیز: کاربران، تنظیمات، بازگردانیِ بکاپ، حذفِ سرویس
//
//  چرا سلسله‌مراتبی و نه مجوزهای ریز: مجوزِ ریز برای یک تیمِ بزرگ خوب است.
//  این‌جا یک نفر مدیر است و شاید چند نفر کمک‌دست؛ سه سطح هم بیانگر است هم
//  قابلِ فهم. سطحِ ریزتر را همیشه می‌شود بعداً روی همین اضافه کرد.
// ---------------------------------------------------------------------------
export const ROLES = ['viewer', 'operator', 'admin'];
const RANK = { viewer: 1, operator: 2, admin: 3 };

export function roleAtLeast(role, needed) {
  return (RANK[role] || 0) >= (RANK[needed] || 99);
}

export function isValidRole(role) {
  return ROLES.includes(role);
}

/**
 * میان‌افزارِ نقش. همیشه بعد از requireAuth می‌آید.
 *
 * نقش از دیتابیس خوانده می‌شود، نه از توکن: اگر مدیر نقشِ کسی را پایین
 * بیاورد یا حسابش را ببندد، باید **همان لحظه** اثر کند، نه وقتی توکنِ
 * ۱۲ ساعته‌اش منقضی شود.
 */
export function requireRole(needed) {
  return function roleGuard(req, res, next) {
    const row = req.user?.id
      ? db.prepare('SELECT role, disabled FROM users WHERE id = ?').get(req.user.id)
      : null;
    if (!row || row.disabled) return res.status(401).json({ error: 'unauthorized' });
    if (!roleAtLeast(row.role, needed)) {
      return res.status(403).json({ error: 'forbidden', needed, role: row.role });
    }
    req.user.role = row.role;
    next();
  };
}

export function isInitialized() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

export function createUser(username, password, role = 'admin') {
  const now = Date.now();
  const name = String(username).trim();
  // اولین کاربرِ سیستم همیشه admin است، وگرنه پنلی می‌ماند که هیچ‌کس
  // نمی‌تواند مدیریتش کند.
  const finalRole = isInitialized() && isValidRole(role) ? role : 'admin';
  db.prepare('INSERT INTO users(username, password_hash, created_at, role) VALUES(?, ?, ?, ?)').run(
    name,
    hashPassword(password),
    now,
    finalRole
  );
  return db
    .prepare('SELECT id, username, role, created_at FROM users WHERE username = ?')
    .get(name);
}

export function findUser(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
}

export function createSession(user, req) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expires = now + config.tokenTtlSeconds * 1000;
  db.prepare(
    'INSERT INTO sessions(id, user_id, created_at, expires_at, user_agent, ip) VALUES(?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    user.id,
    now,
    expires,
    String(req?.headers?.['user-agent'] || '').slice(0, 200),
    String(req?.socket?.remoteAddress || '')
  );
  const token = jwt.sign({ uid: user.id, sid: id, username: user.username }, jwtSecret(), {
    expiresIn: config.tokenTtlSeconds,
  });
  return { token, sessionId: id, expiresAt: expires };
}

export function destroySession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function pruneSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, jwtSecret());
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(payload.sid);
    if (!session || session.expires_at < Date.now()) return null;
    // حسابِ بسته‌شده باید همان لحظه بی‌اثر شود، نه وقتی توکنش منقضی شد
    const user = db.prepare('SELECT role, disabled FROM users WHERE id = ?').get(payload.uid);
    if (!user || user.disabled) return null;
    return { id: payload.uid, username: payload.username, sessionId: payload.sid, role: user.role };
  } catch {
    return null;
  }
}

function bearer(req) {
  const h = req.headers?.authorization || '';
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return null;
}

// میان‌افزار Express
export function requireAuth(req, res, next) {
  const token = bearer(req) || req.query?.token;
  const user = token ? verifyToken(token) : null;
  if (!user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.user = user;
  next();
}

/**
 * فقط **نوشتن** را به نقشِ داده‌شده محدود می‌کند؛ خواندن برای هر کاربرِ
 * واردشده باز می‌ماند.
 *
 * چرا این شکل: تقریباً همهٔ روترهای پنل الگوی «GET برای دیدن، بقیه برای
 * تغییر» را دارند. با یک میان‌افزار روی کلِ روتر، هیچ مسیرِ تغییردهنده‌ای
 * از قلم نمی‌افتد — که همان اشتباهی است که با گذاشتنِ نگهبان روی تک‌تکِ
 * مسیرها دیر یا زود رخ می‌دهد.
 */
export function requireWriteRole(needed = 'operator') {
  const guard = requireRole(needed);
  return function writeGuard(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    return guard(req, res, next);
  };
}

/** نقشِ فعلیِ کاربر از دیتابیس (نه از توکن) */
export function userRole(userId) {
  return db.prepare('SELECT role FROM users WHERE id = ?').get(userId)?.role || 'viewer';
}

export function listSessions(userId) {
  return db
    .prepare('SELECT id, created_at, expires_at, user_agent, ip FROM sessions WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId);
}

export function changePassword(userId, oldPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { ok: false, error: 'user_not_found' };
  if (!verifyPassword(oldPassword, user.password_hash)) return { ok: false, error: 'wrong_password' };
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), userId);
  // همهٔ نشست‌های دیگر باطل می‌شوند
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  logEvent('info', 'panel', `رمز عبور کاربر ${user.username} تغییر کرد`);
  return { ok: true };
}
