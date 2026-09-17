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
import { mask } from './send.js';
import { drainQueue } from '../codes/queue.js';
import { mailReady } from '../codes/mail.js';
import { ensureApp as ensureCodeApp } from '../codes/store.js';
import { issueCode, verifyCode as verifyWithEngine } from '../codes/service.js';
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
/**
 * درخواستِ کد — حالا روی موتورِ «کدهای شش‌رقمی».
 *
 * ⚠️ این تابع دیگر خودش کد نمی‌سازد. تا پیش از این، این‌جا یک موتور بود و
 * فروشگاه یکی دیگر؛ کدها در دو جدولِ جدا می‌نشستند و هیچ‌کدام در پنل دیده
 * نمی‌شدند. حالا هر دو به server/src/codes/ می‌روند: یک موتور، یک صف، و یک
 * فهرستِ زنده که صاحبِ سرور در آن همه‌چیز را می‌بیند.
 *
 * ⚠️ پیامک برداشته شد — خواستهٔ صاحبِ سرور این بود که کدها فقط ایمیلی باشند.
 * درخواستِ شماره بی‌صدا رد نمی‌شود: خطای روشن برمی‌گردد تا برنامه بتواند به
 * کاربر بگوید ایمیلش را بزند.
 */
export async function requestCode({ app, channel, target, ip = '', settings = otpSettings() }) {
  if (channel !== 'email') {
    return {
      ok: false,
      error: 'sms_removed',
      message: 'ورود با پیامک برداشته شد — ایمیلتان را وارد کنید',
    };
  }

  ensureCodeApp(app, { name: app });
  const started = Date.now();
  const result = issueCode({ app, email: target, purpose: 'login', ip });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error === 'too_soon' ? 'too_soon' : result.error,
      retryAfter: result.retryAfter,
      message: result.message,
    };
  }

  // صف را هل می‌دهیم تا در بارِ کم منتظرِ تیکِ بعدی نماند
  drainQueue().catch(() => { /* خطا روی ردیفِ خودش ثبت می‌شود */ });
  const ready = mailReady();

  return {
    ok: true,
    app,
    channel: 'email',
    to: mask(target),
    // ایمیل در صف است؛ اگر سرورِ ایمیل تنظیم نشده باشد، کد فقط در پنل هست
    sent: ready,
    via: ready ? 'email' : null,
    needsSetup: !ready,
    tookMs: Date.now() - started,
    expiresIn: result.expiresIn,
    resendIn: result.resendIn,
    codeLength: result.codeLength,
    message: ready
      ? `کد ${result.codeLength} رقمی فرستاده شد`
      : 'سرورِ ایمیل هنوز تنظیم نشده — کد در «پنل ← کدهای شش‌رقمی» دیده می‌شود',
    deliveryError: null,
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
/**
 * سنجیدنِ کد. درست که باشد، کاربر ساخته/پیدا و توکن داده می‌شود.
 *
 * خودِ کد را موتورِ تازه می‌سنجد؛ چیزی که این‌جا مانده، همان بخشی است که
 * مالِ خودِ این ماژول است: کاربرِ برنامه و نشستش.
 */
export function verifyCode({ app, target, code, device = '', ip = '', name = null, settings = otpSettings() }) {
  // برنامه‌ای که هنوز کد نخواسته در دفترِ موتور نیست؛ بدونِ این، خطا
  // «برنامه ثبت نشده» می‌شد در حالی که مشکلِ واقعی «کدی نفرستاده‌ای» است
  ensureCodeApp(app, { name: app });
  const result = verifyWithEngine({ app, email: target, code });
  if (!result.ok) {
    const map = { no_code: 'no_code', expired: 'expired', wrong_code: 'wrong_code' };
    return {
      ok: false,
      error: map[result.error] || result.error,
      triesLeft: result.triesLeft,
      message: result.message,
    };
  }

  const { user, isNew } = upsertUser({ app, channel: 'email', target: result.email, name });
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

/**
 * میان‌افزارِ Express برای مسیرهایی که کاربرِ واردشده می‌خواهند.
 *
 * ⚠️ نشستِ هر بخش فقط مالِ همان بخش است.
 *
 * تا پیش از این، `app`ی که `verifyAppToken` برمی‌گرداند همین‌جا دور
 * ریخته می‌شد. نتیجه‌اش این بود که سرور هیچ راهی نداشت بگوید «این توکن
 * مالِ بخشِ پمپ است یا دکان» — و چون `appOf(req)` نامِ برنامه را از
 * خودِ درخواست می‌خواند (`body` / `query` / `x-app`)، هر مسیری که روزی
 * بر اساسِ آن فیلتر می‌کرد با توکنِ بخشِ دیگر باز می‌شد.
 *
 * حالا اگر درخواست نامِ برنامه‌ای بدهد که با نشست نمی‌خواند، جواب
 * «چنین نشستی نیست» است — نه «دسترسی نداری». همان چیزی که دربارهٔ
 * `tokens.app`ِ سرورِ ابر هم رعایت شده: وجودِ حسابِ آن بخش لو نرود.
 */
export function requireAppUser(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : req.query?.token;
  const found = token ? verifyAppToken(token) : null;
  if (!found) return res.status(401).json({ ok: false, error: 'unauthorized', message: 'اول وارد شوید' });

  //  نامِ برنامه فقط وقتی سنجیده می‌شود که درخواست خودش گفته باشد؛
  //  برنامه‌های قدیمی که چیزی نمی‌گویند نباید بیفتند.
  const asked = req.body?.app ?? req.query?.app ?? req.headers['x-app'];
  if (asked !== undefined && asked !== null && String(asked).trim() !== '') {
    if (cleanApp(asked) !== cleanApp(found.app)) {
      return res.status(401).json({ ok: false, error: 'unauthorized', message: 'اول وارد شوید' });
    }
  }

  req.appUser = found.user;
  req.appSessionId = found.sessionId;
  req.appName = cleanApp(found.app);
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
