// ---------------------------------------------------------------------------
// احراز هویت: رمز عبورِ هش‌شده با scrypt + توکن JWT + نشست‌ها
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { q, db, getSetting, setSetting, logEvent } from './db.js';
import { config } from './config.js';
import { issueTicket, useTicket } from './lib/ws-ticket.js';

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
// چون هر درخواستِ واردشونده یک بار امضا را بررسی می‌کند، بعد از اولین بار در
// حافظه می‌ماند و دیگر برای هر درخواست به دیتابیس نمی‌رویم.
let _jwtSecret = null;
export function jwtSecret() {
  if (config.secretKey) return config.secretKey;
  if (_jwtSecret) return _jwtSecret;
  let s = getSetting('jwt_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('jwt_secret', s);
  }
  _jwtSecret = s;
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
  return q('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

export function createUser(username, password, role = 'admin') {
  const now = Date.now();
  const name = String(username).trim();
  // اولین کاربرِ سیستم همیشه admin است، وگرنه پنلی می‌ماند که هیچ‌کس
  // نمی‌تواند مدیریتش کند.
  const finalRole = isInitialized() && isValidRole(role) ? role : 'admin';
  q('INSERT INTO users(username, password_hash, created_at, role) VALUES(?, ?, ?, ?)').run(
    name,
    hashPassword(password),
    now,
    finalRole
  );
  return q('SELECT id, username, role, created_at FROM users WHERE username = ?').get(name);
}

export function findUser(username) {
  return q('SELECT * FROM users WHERE username = ?').get(String(username).trim());
}

export function createSession(user, req) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expires = now + config.tokenTtlSeconds * 1000;
  //  ⛔ `auth_at`: همین حالا رمز زده شد، پس این نشست تا ده دقیقه برای کارِ
  //  حساس «تازه» است (`requireRecentAuth`). مهاجرتِ ۰۰۷.
  q(
    'INSERT INTO sessions(id, user_id, created_at, expires_at, user_agent, ip, auth_at) VALUES(?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    user.id,
    now,
    expires,
    String(req?.headers?.['user-agent'] || '').slice(0, 200),
    String(req?.socket?.remoteAddress || ''),
    now
  );
  const token = jwt.sign({ uid: user.id, sid: id, username: user.username }, jwtSecret(), {
    expiresIn: config.tokenTtlSeconds,
  });
  return { token, sessionId: id, expiresAt: expires };
}

/**
 * «آخرین فعالیت» هر نشست — تا در فهرستِ دستگاه‌ها معلوم باشد کدام زنده است.
 * هر درخواست یک نوشتن نمی‌شود: فقط اگر از آخرین مهر یک دقیقه گذشته باشد.
 */
function touchSession(session) {
  const now = Date.now();
  if (session.last_seen_at && now - session.last_seen_at < 60_000) return;
  try { q('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now, session.id); } catch { /* ستونِ نبوده روی دیتابیسِ کهنه */ }
}

/** یک نشستِ مشخصِ همین کاربر را می‌بندد (خروجِ یک دستگاه از فهرست) */
export function revokeSession(userId, sessionId) {
  return q('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId).changes > 0;
}

/** خروج از همهٔ دستگاه‌های دیگر — نشستِ همین دستگاه می‌ماند تا کاربر بیرون نیفتد */
export function revokeOtherSessions(userId, keepSessionId) {
  return q('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, keepSessionId).changes;
}

export function destroySession(sessionId) {
  q('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function pruneSessions() {
  q('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
    // توکنِ کاربرانِ برنامه (ورود با کدِ شش‌رقمی) هرگز کلیدِ پنل نمی‌شود
    if (payload.typ === 'app') return null;
    return sessionUser(payload.uid, payload.sid, payload.username);
  } catch {
    return null;
  }
}

/** نشست هنوز هست، منقضی نشده و حساب باز است؟ — هم برای توکن، هم برای بلیت. */
function sessionUser(uid, sid, username) {
  const session = q('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(sid, uid);
  if (!session || session.expires_at < Date.now()) return null;
  // حسابِ بسته‌شده باید همان لحظه بی‌اثر شود، نه وقتی توکنش منقضی شد
  const user = q('SELECT username, role, disabled, must_change_password FROM users WHERE id = ?').get(uid);
  if (!user || user.disabled) return null;
  touchSession(session);
  return {
    id: uid,
    username: username || user.username,
    sessionId: sid,
    role: user.role,
    mustChangePassword: Boolean(user.must_change_password),
  };
}

function bearer(req) {
  const h = req.headers?.authorization || '';
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return null;
}

/* ------------------- بلیتِ نشانی، به‌جای توکن در نشانی -------------------
 *
 *  ⛔ (فاز ۱ ِ ممیزی، ۶-۶ / S8) تا ۱.۵۰.۶۱ `requireAuth` توکنِ ۱۲ساعتهٔ نشست
 *  را از `?token=` هم می‌پذیرفت (دانلود، رسانه، جریانِ زنده) — یعنی توکن در
 *  نشانی، تاریخچهٔ مرورگر، لاگِ پراکسی و سرآیندِ Referer می‌نشست. حالا نشست
 *  **فقط** از سرآیندِ `Authorization` است. جایی که مرورگر سرآیند نمی‌فرستد
 *  (پیوندِ دانلود)، صفحه با همان نشست یک بلیتِ ۶۰ ثانیه‌ایِ **یک‌بارمصرف**
 *  می‌گیرد (`POST /api/auth/ticket`) که به همان نشست و همان مسیر بسته است و
 *  فقط برای GET/HEAD کار می‌کند. نشستِ باطل‌شده بلیتش را هم می‌کشد.
 */
const TICKET_KIND = 'panel-url';

function pathOnly(url) {
  try {
    return decodeURIComponent(new URL(String(url || ''), 'http://x').pathname);
  } catch {
    return null;
  }
}

/** بلیتِ نشانی برای نشستِ همین درخواست — فقط مسیرِ `/api/...`، بی پرس‌وجو. */
export function issueUrlTicket(user, rawPath) {
  //  فقط مسیرِ نسبیِ همین سرور — نه نشانیِ کامل، نه `//میزبانِ دیگر`
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/api/')) return null;
  const p = pathOnly(rawPath);
  if (!p || !p.startsWith('/api/') || p.length > 512) return null;
  return issueTicket({ kind: TICKET_KIND, uid: user.id, sid: user.sessionId, path: p });
}

function userFromTicket(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const t = useTicket(String(req.query.ticket || ''));
  if (!t || t.kind !== TICKET_KIND) return null;
  if (t.path !== pathOnly(req.originalUrl)) return null;
  return sessionUser(t.uid, t.sid, null);
}

/*
 *  ⛔ رمزِ یک‌بارمصرفِ `vill3n owner-reset`: با آن فقط می‌شود دید کیستی، رمزِ
 *  تازه گذاشت یا بیرون رفت. هر درِ دیگری ۴۰۳ — سرور اجبار می‌کند، نه رابط.
 */
const MUST_CHANGE_OK = /^\/api\/(panel\/v1\/)?auth\/(me|change-password|logout)$/;

// میان‌افزار Express
export function requireAuth(req, res, next) {
  const token = bearer(req);
  const user = token ? verifyToken(token) : req.query?.ticket ? userFromTicket(req) : null;
  if (!user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  if (user.mustChangePassword && !MUST_CHANGE_OK.test(pathOnly(req.originalUrl) || '')) {
    return res.status(403).json({
      error: 'password_change_required',
      message: 'با رمزِ یک‌بارمصرفِ بازیابی وارد شده‌اید؛ اول رمزِ تازه بگذارید.',
    });
  }
  req.user = user;
  next();
}

/* ------------------------ احرازِ دوباره برای کارِ حساس ---------------------
 *
 *  ⛔ (فاز ۱ ِ ممیزی، ۶-۵ / S7) توکنِ ۱۲ساعته برای «نمایشِ راز، تغییرِ نقش،
 *  حذف» کافی نیست: کسی که یک دقیقه پشتِ مرورگرِ بازِ صاحبِ سامانه بنشیند یا
 *  نشستش را بدزدد، همه را می‌کرد. حالا این کارها فقط از نشستی پذیرفته
 *  می‌شوند که در ده دقیقهٔ گذشته رمز زده (ورود، یا `POST /api/auth/reauth`).
 *  همان الگوی `lib/reauth.js` ِ سرورِ حساب. ستونش `sessions.auth_at` است، پس
 *  به همین نشست بسته است — دستگاهِ دیگر یا توکنِ دیگر تازه نمی‌شود.
 */
export function reauthWindowMs() {
  const sec = Number(process.env.HLP_REAUTH_WINDOW_SEC);
  return (Number.isFinite(sec) && sec >= 60 ? sec : 600) * 1000;
}

export const REAUTH_MESSAGE = 'برای این کار رمزِ خودتان را دوباره بزنید (هر ده دقیقه یک بار).';

/** تا کِی این نشست برای کارِ حساس تازه است — صفر یعنی نیست. */
export function freshUntil(sessionId) {
  if (!sessionId) return 0;
  const row = q('SELECT auth_at FROM sessions WHERE id = ?').get(sessionId);
  return row?.auth_at ? Number(row.auth_at) + reauthWindowMs() : 0;
}

export function markFresh(sessionId) {
  q('UPDATE sessions SET auth_at = ? WHERE id = ?').run(Date.now(), sessionId);
}

/** میان‌افزار — پس از `requireAuth`. کلیدِ محلیِ همین کامپیوتر از این مرز نمی‌گذرد. */
export function requireRecentAuth(req, res, next) {
  if (req.user?.sessionId && freshUntil(req.user.sessionId) > Date.now()) return next();
  return res.status(403).json({ error: 'reauth_required', message: REAUTH_MESSAGE });
}

/**
 * کارِ پولیِ پلِ سرورِ حساب هم احرازِ دوباره بخواهد؟ — پیش‌فرض **خاموش**.
 * ⚠️ «ویلن ادمین» (اندروید) هنوز پنجرهٔ «رمز را دوباره بزنید» ندارد و همان
 * درها را برای دادنِ اشتراک و کدِ VIP می‌زند؛ روشن کردنش پیش از آن، کارِ
 * هر روزِ صاحبِ سامانه را روی گوشی می‌خواباند. `HLP_REAUTH_MONEY=1` روشنش
 * می‌کند (وب پنجره را دارد).
 */
export function reauthMoneyEnforced() {
  return process.env.HLP_REAUTH_MONEY === '1';
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
  return q('SELECT id, created_at, expires_at, user_agent, ip, last_seen_at FROM sessions WHERE user_id = ? ORDER BY COALESCE(last_seen_at, created_at) DESC')
    .all(userId);
}

export function changePassword(userId, oldPassword, newPassword) {
  const user = q('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { ok: false, error: 'user_not_found' };
  if (!verifyPassword(oldPassword, user.password_hash)) return { ok: false, error: 'wrong_password' };
  //  رمزِ یک‌بارمصرف نباید همان رمزِ «تازه» بماند
  if (String(newPassword) === String(oldPassword)) return { ok: false, error: 'same_password' };
  //  رمزِ یک‌بارمصرفِ بازیابی همین‌جا تمام می‌شود
  q('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(newPassword), userId);
  // همهٔ نشست‌های دیگر باطل می‌شوند
  q('DELETE FROM sessions WHERE user_id = ?').run(userId);
  logEvent('info', 'panel', `رمز عبور کاربر ${user.username} تغییر کرد`);
  return { ok: true };
}
