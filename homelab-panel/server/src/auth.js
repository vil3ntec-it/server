// ---------------------------------------------------------------------------
// احراز هویت: رمز عبورِ هش‌شده با scrypt + توکن JWT + نشست‌ها
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { q, db, getSetting, setSetting, logEvent } from './db.js';
import { config } from './config.js';
import { issueTicket, useTicket } from './lib/ws-ticket.js';
import { matchTotpStep, useRecoveryCode } from './lib/totp.js';

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

/**
 * نشستِ یک اتصالِ **باز** (وب‌سوکت) هنوز زنده است؟ — همان قاعدهٔ `verifyToken`، بی توکن.
 *
 * ⛔ (۱.۵۰.۷۱) Socket.IO توکن را فقط هنگامِ دست‌دادن می‌سنجید: پس از `vill3n owner-reset`،
 * «خروج از همه»، بستنِ حساب یا تغییرِ نقش، وب‌سوکتِ بازِ نشستِ باطل‌شده همچنان ترمینال
 * داشت. `realtime.js` با همین تابع هر کارِ ترمینال و هر چند ثانیه همهٔ اتصال‌ها را می‌سنجد.
 */
export function liveSessionUser(user) {
  if (!user?.id || !user?.sessionId) return null;
  //  فقط خواندن: بازبینیِ دوره‌ای نباید «آخرین دیده‌شدن» ِ نشستِ بی‌کار را تازه نگه دارد
  const u = sessionUser(user.id, user.sessionId, user.username, { touch: false });
  return u && !u.mustChangePassword ? u : null;
}

/** رمزِ یک‌بارمصرفِ `vill3n owner-reset` از مهلتش گذشته؟ (`users.must_change_by`، مهاجرتِ ۰۰۸) */
export function recoveryExpired(user, now = Date.now()) {
  return Boolean(user?.must_change_password) && user?.must_change_by != null && Number(user.must_change_by) < now;
}

/** نشست هنوز هست، منقضی نشده و حساب باز است؟ — هم برای توکن، هم برای بلیت. */
function sessionUser(uid, sid, username, { touch = true } = {}) {
  const session = q('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(sid, uid);
  if (!session || session.expires_at < Date.now()) return null;
  // حسابِ بسته‌شده باید همان لحظه بی‌اثر شود، نه وقتی توکنش منقضی شد
  const user = q('SELECT username, role, disabled, must_change_password, must_change_by FROM users WHERE id = ?').get(uid);
  if (!user || user.disabled) return null;
  //  ⛔ نشستی که با رمزِ یک‌بارمصرفِ بازیابی ساخته شد، پس از مهلتش می‌میرد (مهاجرتِ ۰۰۸)
  if (recoveryExpired(user)) return null;
  if (touch) touchSession(session);
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

/**
 * ⛔ (۱.۵۰.۷۳) پرس‌وجوی متعارف: جفت‌های رمزگشایی‌شده به **همان ترتیب**، بی هر `ticket`. تا ۱.۵۰.۷۲ بلیت فقط به
 * مسیر بسته بود: بلیتِ دانلودِ یک پرونده که در لاگ یا Referer لو می‌رفت، با عوض کردنِ ‎?path=‎ هر پروندهٔ دیگرِ
 * ریشه‌های فایل‌منیجر را باز می‌کرد. حالا هر پارامترِ افزوده، کم‌شده، تکراری یا عوض‌شده ⇒ ۴۰۱. فقط نوشتنِ
 * دیگرِ همان مقدار (‎%2F‎ یا ‎/‎، ‎+‎ یا ‎%20‎) و جای خودِ `ticket` آزاد است.
 */
function queryOnly(url) {
  try {
    const pairs = [];
    for (const [k, v] of new URL(String(url || ''), 'http://x').searchParams) if (k !== 'ticket') pairs.push([k, v]);
    return JSON.stringify(pairs);
  } catch {
    return null;
  }
}

/** بلیتِ نشانی برای نشستِ همین درخواست — فقط مسیرِ `/api/...`، بسته به مسیر **و** پرس‌وجو. */
export function issueUrlTicket(user, rawPath) {
  //  فقط مسیرِ نسبیِ همین سرور — نه نشانیِ کامل، نه `//میزبانِ دیگر`
  if (typeof rawPath !== 'string' || !rawPath.startsWith('/api/') || rawPath.length > 4096) return null;
  const p = pathOnly(rawPath);
  const query = queryOnly(rawPath);
  if (!p || !p.startsWith('/api/') || p.length > 512 || query === null) return null;
  return issueTicket({ kind: TICKET_KIND, uid: user.id, sid: user.sessionId, path: p, query });
}

function userFromTicket(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const t = useTicket(String(req.query.ticket || ''));
  if (!t || t.kind !== TICKET_KIND) return null;
  if (t.path !== pathOnly(req.originalUrl)) return null;
  if (typeof t.query !== 'string' || t.query !== queryOnly(req.originalUrl)) return null;
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
 * رمز (و اگر دوعاملی روشن است، کد) — **تنها** قاعدهٔ احرازِ دوباره در پنل.
 * `POST /api/auth/reauth` و «رمز همراهِ درخواست» ِ درهای کنسول هر دو همین را صدا می‌زنند.
 *
 * ⛔ (۱.۵۰.۷۱) درهای کنسولِ فروشگاه (کلیدِ سرویس، مدیرانِ سرورِ حساب، پرچم‌ها، بازار، مالی،
 * انتشارِ مرحله‌ای) هر کدام رمز را جدا می‌سنجیدند و **بی کدِ دوعاملی** `markFresh` می‌کردند؛
 * با آمدنِ فاز ۱ همان نشستِ «تازه» درهای فاز ۱ را هم باز می‌کرد (نمایشِ رمزِ ارشد، کاربرانِ
 * پنل، روشن کردنِ دوعاملی). یعنی دوعاملی برای احرازِ دوباره دور زده می‌شد.
 */
export function verifyReauth(userId, password, code) {
  const u = q('SELECT password_hash, totp_enabled FROM users WHERE id = ?').get(Number(userId));
  if (!u || typeof password !== 'string' || !password || !verifyPassword(password, u.password_hash)) {
    return { ok: false, error: 'wrong_password', totpRequired: Boolean(u?.totp_enabled) };
  }
  if (u.totp_enabled) {
    if (code === undefined || code === null || code === '') return { ok: false, error: 'totp_required', totpRequired: true };
    //  ⛔ S13: کد پس از رمزِ درست مصرف می‌شود — کسی که رمز را ندارد کدهای صاحبِ حساب را نمی‌سوزاند
    const t = consumeTotp(userId, code);
    if (!t.ok) return { ok: false, error: 'totp_invalid', totpRequired: true, reused: Boolean(t.reused) };
  }
  return { ok: true, totpRequired: Boolean(u.totp_enabled) };
}

/**
 * ⛔ S13 (۱.۵۰.۷۳) — **تنها** درِ پذیرفتنِ کدِ دوعاملیِ رازِ روشن: ورود (`/login/totp`)، احرازِ دوباره و
 * «رمز همراهِ درخواست» (`verifyReauth`)، خاموش کردن، کلیدِ درِ مدیر و رباتِ تلگرام همه همین را صدا
 * می‌زنند. هر کد یک بار: گامِ جورشده در `users.totp_last_step` می‌نشیند و همان گام یا هر گامِ
 * کهنه‌تر دیگر پذیرفته نمی‌شود — حتی در پنجرهٔ ±۱ و حتی از درِ دیگر.
 *
 * «مقایسه و جایگذاری» در خودِ `UPDATE` است (`totp_last_step < گام` و همان راز): دو درخواستِ
 * هم‌زمان با یک کد — یا دو پروسه روی یک `panel.db` — فقط یکی‌شان یک ردیف عوض می‌کند.
 *
 * ⚠️ ساعتِ سرور اگر به عقب برگردد (مثلاً ساعتِ جلوافتاده‌ای که NTP درست کرد)، کدها تا رسیدن به
 * آخرین گامِ ثبت‌شده پذیرفته نمی‌شوند؛ کدِ بازیابی و `vill3n owner-reset` در این حال هم کار می‌کنند.
 *
 * @returns {{ ok: true, step: number } | { ok: false, reused: boolean }}
 */
export function consumeTotp(userId, code, { at = Date.now() } = {}) {
  const id = Number(userId);
  const u = q('SELECT totp_enabled, totp_secret, totp_last_step FROM users WHERE id = ?').get(id);
  if (!u?.totp_enabled || !u.totp_secret) return { ok: false, reused: false };
  const last = u.totp_last_step === null || u.totp_last_step === undefined ? null : Number(u.totp_last_step);
  const step = matchTotpStep(u.totp_secret, code, { at, after: last });
  if (step < 0) {
    //  فقط برای دفتر: کدِ درستی که گامش مصرف شده بود (بازپخش)، نه کدِ غلط
    return { ok: false, reused: last !== null && matchTotpStep(u.totp_secret, code, { at }) >= 0 };
  }
  const won = q('UPDATE users SET totp_last_step = ? WHERE id = ? AND totp_enabled = 1 AND totp_secret = ? AND (totp_last_step IS NULL OR totp_last_step < ?)')
    .run(step, id, u.totp_secret, step);
  return Number(won.changes) === 1 ? { ok: true, step } : { ok: false, reused: true };
}

/**
 * کدِ بازیابیِ یک‌بارمصرف — همان یک در برای ورود، کلیدِ درِ مدیر و رباتِ تلگرام. فهرستِ تازه فقط
 * اگر فهرست از لحظهٔ خواندن عوض نشده نوشته می‌شود (`totp_recovery IS ?`)، پس یک کد دو بار نمی‌گذرد.
 *
 * @returns {{ ok: boolean, remaining: number }}
 */
export function consumeRecoveryCode(userId, code) {
  const id = Number(userId);
  const before = q('SELECT totp_recovery FROM users WHERE id = ?').get(id)?.totp_recovery ?? null;
  let list = [];
  try { list = JSON.parse(before || '[]'); } catch { list = []; }
  const r = useRecoveryCode(list, String(code ?? ''));
  if (!r.ok) return { ok: false, remaining: Array.isArray(list) ? list.length : 0 };
  const won = q('UPDATE users SET totp_recovery = ? WHERE id = ? AND totp_recovery IS ?').run(JSON.stringify(r.remaining), id, before);
  return Number(won.changes) === 1 ? { ok: true, remaining: r.remaining.length } : { ok: false, remaining: list.length };
}

/**
 * احرازِ دوبارهٔ «رمز همراهِ همین درخواست» (`body.password`، و `body.code` اگر دوعاملی روشن است).
 *
 *   • رمز یا کدِ غلط ⇒ `{ pass: false, failed: true }` — همیشه، حتی اگر نشست تازه باشد
 *   • رمزِ درست + (کدِ درست یا بی دوعاملی) ⇒ نشست تازه می‌شود و `{ pass: true }`
 *   • رمزِ درست بی کد روی حسابِ دوعاملی‌دار ⇒ نشست **تازه نمی‌شود**؛ فقط اگر از پیش تازه بود رد می‌شود،
 *     وگرنه `{ pass: false, totpRequired: true }` تا رابط پنجرهٔ رمز و کد را باز کند (`ReauthHost`)
 *   • بی رمز ⇒ فقط نشستِ تازه (`requireRecentAuth`)
 */
export function bodyStepUp(req) {
  const fresh = () => Boolean(req.user?.sessionId) && freshUntil(req.user.sessionId) > Date.now();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password) return fresh() ? { pass: true } : { pass: false, failed: false };
  const r = verifyReauth(req.user?.id, password, req.body?.code);
  if (r.ok) {
    if (req.user?.sessionId) markFresh(req.user.sessionId);
    return { pass: true };
  }
  if (r.error === 'totp_required') return fresh() ? { pass: true } : { pass: false, failed: false, totpRequired: true };
  return { pass: false, failed: true, error: r.error };
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
  q('UPDATE users SET password_hash = ?, must_change_password = 0, must_change_by = NULL WHERE id = ?').run(hashPassword(newPassword), userId);
  // همهٔ نشست‌های دیگر باطل می‌شوند
  q('DELETE FROM sessions WHERE user_id = ?').run(userId);
  logEvent('info', 'panel', `رمز عبور کاربر ${user.username} تغییر کرد`);
  return { ok: true };
}
