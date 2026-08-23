// ---------------------------------------------------------------------------
//  «ورودِ کاربرانِ برنامه» — با شمارهٔ موبایل یا ایمیل و یک کدِ شش‌رقمی
//
//  همان چیزی که برنامهٔ اندروید، برنامهٔ ویندوز و سایت‌هایتان لازم دارند:
//
//      ۱) POST /api/app/auth/request-code   {"phone":"09121234567"}
//         → سرور کد می‌سازد و پیامک/ایمیل می‌کند
//      ۲) POST /api/app/auth/verify-code    {"phone":"09121234567","code":"123456"}
//         → سرور «توکن» می‌دهد
//      ۳) هر درخواستِ بعدی:  Authorization: Bearer <توکن>
//
//  چند نکته که این‌جا رعایت شده:
//    • کد به‌صورتِ هش ذخیره می‌شود، نه خام (اگر دیتابیس لو رفت، کدی نیست)
//    • هر شماره در ساعت چند بار بیشتر نمی‌تواند کد بگیرد
//    • هر کد فقط چند بار می‌شود اشتباه زده شود و بعد می‌سوزد
//    • توکنِ برنامه با توکنِ مدیرِ پنل قاطی نمی‌شود (typ:'app')
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, logEvent } from '../db.js';
import { jwtSecret } from '../auth.js';
import { otpSettings } from './settings.js';
import { deliverCode, mask } from './send.js';
import { latinDigits, cleanApp } from './identity.js';

db.exec(`
CREATE TABLE IF NOT EXISTS app_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app           TEXT NOT NULL DEFAULT 'main', -- کدام برنامه/سایت
  phone         TEXT,                          -- +989121234567
  email         TEXT,                          -- lowercase
  name          TEXT,
  blocked       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_phone ON app_users(app, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_email ON app_users(app, email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  app        TEXT NOT NULL DEFAULT 'main',
  channel    TEXT NOT NULL,                    -- sms | email
  target     TEXT NOT NULL,                    -- شماره یا ایمیلِ استاندارد شده
  code_hash  TEXT NOT NULL,
  tries      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  ip         TEXT,
  sent_via   TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_codes_target ON app_codes(app, target, id DESC);

CREATE TABLE IF NOT EXISTS app_sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  app        TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  device     TEXT,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id);
`);

// پاک‌سازیِ ورودی‌ها در identity.js است — از این‌جا هم بیرون داده می‌شود تا
// جاهایی که از قبل از این فایل می‌خواندند نشکنند.
export { latinDigits, normalizePhone, normalizeEmail, cleanApp, pickTarget } from './identity.js';

// ---------------------------------------------------------------------------
//  خودِ کد
// ---------------------------------------------------------------------------
function makeCode(length) {
  const digits = '0123456789';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += digits[bytes[i] % 10];
  return out;
}

const hashCode = (code, target) =>
  crypto.createHmac('sha256', jwtSecret()).update(`${target}:${code}`).digest('hex');

const HOUR = 3600 * 1000;

/**
 * درخواستِ کد. همیشه یک شیء برمی‌گرداند؛ اگر ok=false باشد، `error` می‌گوید چرا.
 */
export async function requestCode({ app, channel, target, ip = '', settings = otpSettings() }) {
  const now = Date.now();

  const last = db
    .prepare('SELECT created_at FROM app_codes WHERE app = ? AND target = ? ORDER BY id DESC LIMIT 1')
    .get(app, target);
  if (last && now - last.created_at < settings.resendSeconds * 1000) {
    const wait = Math.ceil((settings.resendSeconds * 1000 - (now - last.created_at)) / 1000);
    return { ok: false, error: 'too_soon', retryAfter: wait, message: `${wait} ثانیه صبر کنید و دوباره بزنید` };
  }

  const perTarget = db
    .prepare('SELECT COUNT(*) AS n FROM app_codes WHERE app = ? AND target = ? AND created_at > ?')
    .get(app, target, now - HOUR).n;
  if (perTarget >= settings.maxPerHour) {
    return { ok: false, error: 'rate_limited', retryAfter: 3600, message: 'تعدادِ درخواستِ کد در یک ساعت زیاد شد' };
  }

  if (ip) {
    const perIp = db
      .prepare('SELECT COUNT(*) AS n FROM app_codes WHERE ip = ? AND created_at > ?')
      .get(ip, now - HOUR).n;
    if (perIp >= settings.maxPerHourIp) {
      return { ok: false, error: 'rate_limited', retryAfter: 3600, message: 'تعدادِ درخواست از این دستگاه زیاد شد' };
    }
  }

  // کدهای قبلیِ همین شماره می‌سوزند تا فقط تازه‌ترین کد کار کند
  db.prepare('UPDATE app_codes SET used_at = ? WHERE app = ? AND target = ? AND used_at IS NULL').run(now, app, target);

  const startedAt = Date.now();
  const code = makeCode(settings.codeLength);
  // اول در دیتابیس می‌نشیند و بعد فرستاده می‌شود: اگر پیامک نرفت، کد باز هم
  // معتبر است (شاید از لاگِ پنل خوانده شود) و سقفِ ساعتی هم دور زده نمی‌شود.
  const inserted = db
    .prepare(
      'INSERT INTO app_codes(app, channel, target, code_hash, created_at, expires_at, ip) VALUES(?,?,?,?,?,?,?) RETURNING id'
    )
    .get(app, channel, target, hashCode(code, target), now, now + settings.codeTtlSeconds * 1000, ip);

  const delivery = await deliverCode({ channel, to: target, code, settings });
  db.prepare('UPDATE app_codes SET sent_via = ? WHERE id = ?').run(delivery.via, inserted.id);

  return {
    ok: true,
    app,
    channel,
    to: mask(target),
    sent: delivery.sent,
    via: delivery.via,
    // چند میلی‌ثانیه طول کشید تا کد واقعاً تحویلِ سرویسِ پیامک/ایمیل شود
    tookMs: Date.now() - startedAt,
    expiresIn: settings.codeTtlSeconds,
    resendIn: settings.resendSeconds,
    codeLength: settings.codeLength,
    needsSetup: Boolean(delivery.needsSetup),
    message: delivery.sent
      ? `کد ${settings.codeLength} رقمی فرستاده شد`
      : delivery.needsSetup
        ? 'سرویسِ پیامک/ایمیل هنوز تنظیم نشده — کد در «پنل ← لاگ‌ها» دیده می‌شود'
        : `کد ساخته شد ولی فرستاده نشد: ${delivery.error || 'خطای نامعلوم'}`,
    deliveryError: delivery.sent ? null : delivery.error || null,
    // فقط وقتی OTP_ECHO=1 باشد (حالتِ آزمایش)
    ...(settings.echoCode ? { code } : {}),
  };
}

/** پیدا کردن یا ساختنِ کاربر — ثبت‌نامِ جدا لازم نیست */
export function upsertUser({ app, channel, target, name = null }) {
  const column = channel === 'email' ? 'email' : 'phone';
  const found = db.prepare(`SELECT * FROM app_users WHERE app = ? AND ${column} = ?`).get(app, target);
  if (found) return { user: found, isNew: false };

  const now = Date.now();
  db.prepare(`INSERT INTO app_users(app, ${column}, name, created_at) VALUES(?,?,?,?)`).run(
    app,
    target,
    name ? String(name).slice(0, 80) : null,
    now
  );
  const user = db.prepare(`SELECT * FROM app_users WHERE app = ? AND ${column} = ?`).get(app, target);
  logEvent('info', 'panel', `کاربرِ تازهٔ «${app}» ثبت شد: ${mask(target)}`);
  return { user, isNew: true };
}

export function createAppSession(user, { device = '', ip = '', settings = otpSettings() } = {}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + settings.tokenTtlSeconds * 1000;
  db.prepare('INSERT INTO app_sessions(id, user_id, app, created_at, expires_at, device, ip) VALUES(?,?,?,?,?,?,?)').run(
    id,
    user.id,
    user.app,
    now,
    expiresAt,
    String(device || '').slice(0, 200),
    String(ip || '')
  );
  db.prepare('UPDATE app_users SET last_login_at = ? WHERE id = ?').run(now, user.id);
  const token = jwt.sign({ typ: 'app', uid: user.id, sid: id, app: user.app }, jwtSecret(), {
    expiresIn: settings.tokenTtlSeconds,
  });
  return { token, expiresAt, expiresIn: settings.tokenTtlSeconds };
}

/**
 * بررسیِ کد. اگر درست بود، کاربر ساخته/پیدا و توکن داده می‌شود.
 */
export function verifyCode({ app, target, code, device = '', ip = '', name = null, settings = otpSettings() }) {
  const now = Date.now();
  const clean = latinDigits(code).replace(/\D/g, '');
  if (!clean) return { ok: false, error: 'code_required', message: 'کد را وارد کنید' };

  const row = db
    .prepare('SELECT * FROM app_codes WHERE app = ? AND target = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1')
    .get(app, target);

  if (!row) return { ok: false, error: 'no_code', message: 'اول درخواستِ کد بدهید' };
  if (row.expires_at < now) {
    db.prepare('UPDATE app_codes SET used_at = ? WHERE id = ?').run(now, row.id);
    return { ok: false, error: 'expired', message: 'کد منقضی شده — دوباره کد بگیرید' };
  }
  if (row.tries >= settings.maxTries) {
    db.prepare('UPDATE app_codes SET used_at = ? WHERE id = ?').run(now, row.id);
    return { ok: false, error: 'too_many_tries', message: 'تعدادِ تلاش زیاد شد — دوباره کد بگیرید' };
  }

  const expected = Buffer.from(row.code_hash, 'hex');
  const actual = Buffer.from(hashCode(clean, target), 'hex');
  const same = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);

  if (!same) {
    db.prepare('UPDATE app_codes SET tries = tries + 1 WHERE id = ?').run(row.id);
    const left = Math.max(0, settings.maxTries - (row.tries + 1));
    return { ok: false, error: 'wrong_code', triesLeft: left, message: `کد درست نیست (${left} تلاشِ دیگر)` };
  }

  db.prepare('UPDATE app_codes SET used_at = ? WHERE id = ?').run(now, row.id);

  const { user, isNew } = upsertUser({ app, channel: row.channel, target, name });
  if (user.blocked) return { ok: false, error: 'blocked', message: 'این حساب مسدود است' };

  const session = createAppSession(user, { device, ip, settings });
  return { ok: true, isNew, user: publicUser(user), ...session };
}

export const publicUser = (u) => ({
  id: u.id,
  app: u.app,
  phone: u.phone || null,
  email: u.email || null,
  name: u.name || null,
  createdAt: u.created_at,
  lastLoginAt: u.last_login_at || null,
});

// ---------------------------------------------------------------------------
//  توکنِ برنامه
// ---------------------------------------------------------------------------
export function verifyAppToken(token) {
  try {
    const payload = jwt.verify(String(token), jwtSecret());
    if (payload.typ !== 'app') return null;
    const session = db.prepare('SELECT * FROM app_sessions WHERE id = ?').get(payload.sid);
    if (!session || session.expires_at < Date.now()) return null;
    const user = db.prepare('SELECT * FROM app_users WHERE id = ?').get(session.user_id);
    if (!user || user.blocked) return null;
    return { user, sessionId: session.id, app: session.app };
  } catch {
    return null;
  }
}

/** میان‌افزارِ Express برای مسیرهایی که کاربرِ واردشده می‌خواهند */
export function requireAppUser(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : req.query?.token;
  const found = token ? verifyAppToken(token) : null;
  if (!found) return res.status(401).json({ ok: false, error: 'unauthorized', message: 'اول وارد شوید' });
  req.appUser = found.user;
  req.appSessionId = found.sessionId;
  next();
}

export function logoutApp(sessionId) {
  db.prepare('DELETE FROM app_sessions WHERE id = ?').run(sessionId);
  return { ok: true };
}

export function logoutAllDevices(userId) {
  db.prepare('DELETE FROM app_sessions WHERE user_id = ?').run(userId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
//  گزارش‌ها برای پنل
// ---------------------------------------------------------------------------
export function listApps() {
  return db
    .prepare(
      `SELECT app, COUNT(*) AS users, MAX(last_login_at) AS lastLogin
         FROM app_users GROUP BY app ORDER BY users DESC`
    )
    .all();
}

export function listUsers({ app = null, limit = 100, offset = 0, search = '' } = {}) {
  const like = `%${String(search || '').trim()}%`;
  const rows = db
    .prepare(
      `SELECT * FROM app_users
        WHERE (? IS NULL OR app = ?)
          AND (? = '%%' OR phone LIKE ? OR email LIKE ? OR name LIKE ?)
        ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(app, app, like, like, like, like, Math.min(500, Number(limit) || 100), Number(offset) || 0);
  return rows.map(publicUser);
}

export function setBlocked(userId, blocked) {
  db.prepare('UPDATE app_users SET blocked = ? WHERE id = ?').run(blocked ? 1 : 0, Number(userId));
  if (blocked) logoutAllDevices(Number(userId));
  return { ok: true };
}

export function deleteUser(userId) {
  db.prepare('DELETE FROM app_users WHERE id = ?').run(Number(userId));
  return { ok: true };
}

/** آخرین کدها — برای وقتی که پیامک هنوز تنظیم نشده و خودتان باید کد را ببینید */
export function recentCodes(limit = 20) {
  return db
    .prepare(
      `SELECT id, app, channel, target, created_at, expires_at, used_at, sent_via, tries
         FROM app_codes ORDER BY id DESC LIMIT ?`
    )
    .all(Math.min(100, Number(limit) || 20));
}

export function stats() {
  const now = Date.now();
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  return {
    users: one('SELECT COUNT(*) AS n FROM app_users').n,
    apps: one('SELECT COUNT(DISTINCT app) AS n FROM app_users').n,
    activeSessions: one('SELECT COUNT(*) AS n FROM app_sessions WHERE expires_at > ?', now).n,
    codesLastHour: one('SELECT COUNT(*) AS n FROM app_codes WHERE created_at > ?', now - HOUR).n,
    loginsToday: one('SELECT COUNT(*) AS n FROM app_users WHERE last_login_at > ?', now - 24 * HOUR).n,
  };
}

/** نگهداریِ دوره‌ای — نشست‌ها و کدهای تمام‌شده پاک می‌شوند */
export function pruneAppAuth() {
  const now = Date.now();
  try {
    db.prepare('DELETE FROM app_sessions WHERE expires_at < ?').run(now);
    db.prepare('DELETE FROM app_codes WHERE created_at < ?').run(now - 7 * 24 * HOUR);
  } catch { /* بی‌خیال */ }
}
