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
import { ensureApp as ensureCodeApp, recentRequests } from '../codes/store.js';
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

-- ⚠️ جدولِ app_codes این‌جا بود و دیگر ساخته نمی‌شود: از وقتی دو موتورِ
-- کد یکی شدند، کدها در code_requests می‌نشینند و کسی در این نمی‌نویسد.
--
-- عمداً DROP نشد. روی نصب‌های موجود ممکن است کدهای قدیمی داشته باشد و
-- «جدولِ بی‌مصرف» دلیلِ خوبی برای پاک کردنِ دادهٔ کسی نیست. فقط دیگر
-- ساخته و خوانده نمی‌شود؛ نصبِ تازه اصلاً آن را ندارد.

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
-- پاک‌سازیِ نشست‌های منقضی بی این، کلِ جدول را می‌خواند
CREATE INDEX IF NOT EXISTS idx_app_sessions_expiry ON app_sessions(expires_at);

/*
 *  ── دفترِ ورود ───────────────────────────────────────────────────────────
 *
 *  ⚠️ تا امروز هیچ تاریخچه‌ای از ورود نبود — فقط یک «last_login_at» روی
 *  خودِ کاربر. یعنی هیچ راهی نبود بفهمی کی، کِی، از کجا و به کدام برنامه
 *  وارد شده؛ و اگر حسابی دستِ کسِ دیگری می‌افتاد، هیچ ردی نمی‌ماند.
 *
 *  ⚠️ تلاش‌های *ناموفق* هم ثبت می‌شوند و همان‌ها مهم‌ترند: ده کدِ غلط
 *  پشتِ هم روی یک ایمیل، تنها نشانه‌ای است که کسی دارد حدس می‌زند.
 *
 *  ⚠️ و آنچه این‌جا ثبت *نمی‌شود*: کد، توکن، کلیدِ تمدید، رمز. دفترِ ورود
 *  نباید خودش یک گاوصندوقِ باز باشد.
 */
CREATE TABLE IF NOT EXISTS app_logins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  app        TEXT NOT NULL,              -- کدام برنامه/سایت
  user_id    INTEGER,                    -- اگر کاربر ساخته شده باشد
  email      TEXT NOT NULL,
  at         INTEGER NOT NULL,
  ok         INTEGER NOT NULL,           -- ۱ وارد شد، ۰ نشد
  reason     TEXT,                       -- چرا نشد: wrong_code | expired | …
  device     TEXT,
  ip         TEXT,
  session_id TEXT,                       -- نشستی که ساخته شد (اگر شد)
  is_new     INTEGER NOT NULL DEFAULT 0  -- اولین ورودِ این حساب؟
);
CREATE INDEX IF NOT EXISTS idx_app_logins_app  ON app_logins(app, at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logins_mail ON app_logins(email, at DESC);
CREATE INDEX IF NOT EXISTS idx_app_logins_time ON app_logins(at DESC);
`);

/*
 *  ستون‌هایی که بعداً اضافه شدند.
 *
 *  ⚠️ «CREATE TABLE IF NOT EXISTS» فقط روی دیتابیسِ نو کار می‌کند. روی
 *  سروری که از قبل بالا بوده جدول هست و ستونِ تازه نیست — و اولین ورودی
 *  که بخواهد تمدید شود با «چنین ستونی نداریم» می‌افتد.
 */
function addSessionColumn(column, type) {
  try {
    const has = db.prepare('PRAGMA table_info(app_sessions)').all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE app_sessions ADD COLUMN ${column} ${type}`);
  } catch { /* از قبل هست — بی‌ضرر */ }
}
//  هشِ کلیدِ تمدید. خودِ کلید ذخیره نمی‌شود، مثلِ رمز.
addSessionColumn('refresh_hash', 'TEXT');
//  تا کِی می‌شود تمدید کرد (فراتر از عمرِ خودِ توکن)
addSessionColumn('refresh_expires_at', 'INTEGER');
//  آخرین تمدید — برای اینکه در پنل معلوم باشد نشست زنده است یا رها شده
addSessionColumn('last_used_at', 'INTEGER');
//  چند بار تمدید شده
addSessionColumn('refresh_count', 'INTEGER');

// پاک‌سازیِ ورودی‌ها در identity.js است — از این‌جا هم بیرون داده می‌شود تا
// جاهایی که از قبل از این فایل می‌خواندند نشکنند.
export { latinDigits, normalizePhone, normalizeEmail, cleanApp, pickTarget } from './identity.js';

// ---------------------------------------------------------------------------
//  ⚠️ این‌جا زمانی makeCode و hashCodeِ خودِ این ماژول بودند. وقتی دو موتورِ
//  کد یکی شدند، کارشان به src/codes/service.js رفت و این‌ها ماندند بی‌مصرف.
//
//  برداشته شدند، و یکی‌شان یک اشکالِ واقعی داشت که خوب است در تاریخ بماند:
//
//      digits[bytes[i] % 10]
//
//  ۲۵۶ بر ۱۰ بخش‌پذیر نیست (۲۵۶ = ۲۵×۱۰ + ۶)، پس رقم‌های ۰ تا ۵ کمی
//  بیشتر از ۶ تا ۹ می‌آمدند. موتورِ فعلی crypto.randomInt می‌زند که این
//  سوگیری را ندارد. اگر روزی کسی این فایل را باز کرد و خواست «کدساز»ی
//  بنویسد: randomInt، نه modulo.
// ---------------------------------------------------------------------------

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
export async function requestCode({ app, channel, target, name = null, ip = '', settings = otpSettings() }) {
  if (channel !== 'email') {
    return {
      ok: false,
      error: 'sms_removed',
      message: 'ورود با پیامک برداشته شد — ایمیلتان را وارد کنید',
    };
  }

  ensureCodeApp(app, { name: app });
  const started = Date.now();
  /*
   *  ⚠️ `subjectName` این‌جا نبود و ایمیل‌های این مسیر بی‌نام می‌رفتند —
   *  «به VILL3N خوش آمدید» به‌جای «سارا عزیز، به VILL3N خوش آمدید».
   *  مسیرِ دیگر (/api/codes/request) نام را می‌فرستاد و این یکی نه، پس
   *  بسته به اینکه کلاینت کدام نشانی را زده بود، نتیجه فرق می‌کرد.
   *  یک آزمونِ سرتاسری گرفتش.
   */
  const result = issueCode({ app, email: target, subjectName: name, purpose: 'login', ip });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      scope: result.scope,
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

/* ---------------------------------------------------------------------------
 *  کلیدِ تمدید (refresh token)
 *
 *  ⚠️ چرا لازم شد: توکنِ برنامه ۳۰ روزه بود و راهِ تمدید نداشت. یعنی یا
 *  باید بلند می‌ماند — و توکنِ دزدیده‌شده یک ماه کار می‌کرد — یا کوتاه
 *  می‌شد و کاربر هر چند روز دوباره کدِ ایمیلی می‌خواست.
 *
 *  حالا دو تکه است:
 *    • توکنِ کوتاه‌عمر (پیش‌فرض ۱ روز) که در هر درخواست می‌رود
 *    • کلیدِ تمدیدِ بلندعمر (پیش‌فرض ۳۰ روز) که فقط به یک مسیر می‌رود
 *
 *  کلیدِ تمدید مثلِ رمز رفتار می‌شود: فقط هشش ذخیره می‌شود، پس اگر
 *  دیتابیس لو برود کلیدی در دست نیست.
 *
 *  ⚠️ و هر تمدید کلیدِ تازه می‌دهد و قبلی را می‌سوزاند (rotation). اگر
 *  کلیدی دو بار استفاده شود یعنی یکی‌شان دزدیده شده — و آن‌جا کلِ نشست
 *  بسته می‌شود، نه اینکه هر دو ادامه بدهند.
 * ------------------------------------------------------------------------- */

/**
 * ساختِ خودِ توکن.
 *
 * ⚠️ دو ریزه‌کاری که هر دو از یک آزمونِ قرمز درآمدند:
 *
 *   ۱) `exp` مستقیم از expiresAt می‌آید، نه از `expiresIn`. با expiresIn،
 *      jsonwebtoken آن را نسبت به `iat` حساب می‌کند و iat دقتِ ثانیه
 *      دارد — پس تمدیدی که در همان ثانیهٔ ساختِ توکنِ قبلی انجام می‌شد،
 *      توکنی می‌داد با *همان* لحظهٔ انقضا. یعنی تمدید هیچ چیزی تمدید
 *      نمی‌کرد. حالا انقضای توکن و انقضای ردیفِ نشست یک عدد است.
 *
 *   ۲) `jti` یکتا، وگرنه دو توکن با ادعای یکسان در یک ثانیه بایت‌به‌بایت
 *      یکی می‌شدند و کلاینت نمی‌فهمید تمدید انجام شده.
 */
function signAccess({ uid, sid, app, expiresAt }) {
  return jwt.sign(
    { typ: 'app', uid, sid, app, jti: crypto.randomUUID(), exp: Math.floor(expiresAt / 1000) },
    jwtSecret()
  );
}

const newRefresh = () => crypto.randomBytes(32).toString('base64url');
const hashRefresh = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** عمرِ خودِ توکن — کوتاه، چون تمدید دارد */
const accessTtl = (settings) =>
  Math.max(300, Number(settings.accessTtlSeconds) || 24 * 3600);

/** تا کِی می‌شود تمدید کرد */
const refreshTtl = (settings) =>
  Math.max(accessTtl(settings), Number(settings.tokenTtlSeconds) || 30 * 24 * 3600);

export function createAppSession(user, { device = '', ip = '', settings = otpSettings() } = {}) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + accessTtl(settings) * 1000;
  const refreshToken = newRefresh();
  const refreshExpiresAt = now + refreshTtl(settings) * 1000;

  db.prepare(
    `INSERT INTO app_sessions
       (id, user_id, app, created_at, expires_at, device, ip,
        refresh_hash, refresh_expires_at, last_used_at, refresh_count)
     VALUES(?,?,?,?,?,?,?,?,?,?,0)`
  ).run(
    id,
    user.id,
    user.app,
    now,
    expiresAt,
    String(device || '').slice(0, 200),
    String(ip || ''),
    hashRefresh(refreshToken),
    refreshExpiresAt,
    now
  );
  db.prepare('UPDATE app_users SET last_login_at = ? WHERE id = ?').run(now, user.id);
  const token = signAccess({ uid: user.id, sid: id, app: user.app, expiresAt });
  return {
    //  شناسهٔ نشست برای دفترِ ورود لازم است؛ در خودِ توکن هم هست، پس راز نیست
    sessionId: id,
    token,
    expiresAt,
    expiresIn: accessTtl(settings),
    refreshToken,
    refreshExpiresAt,
    refreshExpiresIn: refreshTtl(settings),
  };
}

/**
 * توکنِ تازه با کلیدِ تمدید.
 *
 * @returns {{ok:true, token, …}|{ok:false, error:string, message:string}}
 */
export function refreshAppSession({ refreshToken, device = '', ip = '', settings = otpSettings() }) {
  const given = String(refreshToken || '').trim();
  if (!given) {
    return { ok: false, error: 'refresh_required', message: 'کلیدِ تمدید را بفرستید' };
  }

  const row = db
    .prepare('SELECT * FROM app_sessions WHERE refresh_hash = ?')
    .get(hashRefresh(given));

  /*
   *  ⚠️ کلیدی که در دفتر نیست یعنی یا هرگز نبوده، یا یک بار مصرف شده و
   *  سوخته. حالتِ دوم خطرناک است: کسی دارد از کلیدِ کهنه استفاده می‌کند.
   *  ولی نمی‌شود از هم جدایشان کرد بی‌آنکه کلیدهای سوخته را نگه داریم؛
   *  پس هر دو یک جواب می‌گیرند: «دوباره وارد شو».
   */
  if (!row) {
    return { ok: false, error: 'bad_refresh', message: 'نشست تمام شده — دوباره وارد شوید' };
  }

  const now = Date.now();
  if (!row.refresh_expires_at || row.refresh_expires_at < now) {
    db.prepare('DELETE FROM app_sessions WHERE id = ?').run(row.id);
    return { ok: false, error: 'refresh_expired', message: 'نشست تمام شده — دوباره وارد شوید' };
  }

  const user = db.prepare('SELECT * FROM app_users WHERE id = ?').get(row.user_id);
  if (!user) {
    db.prepare('DELETE FROM app_sessions WHERE id = ?').run(row.id);
    return { ok: false, error: 'bad_refresh', message: 'نشست تمام شده — دوباره وارد شوید' };
  }
  if (user.blocked) {
    db.prepare('DELETE FROM app_sessions WHERE user_id = ?').run(user.id);
    return { ok: false, error: 'blocked', message: 'این حساب مسدود است' };
  }

  /*
   *  کلیدِ تازه، و قبلی همین‌جا می‌سوزد.
   *
   *  ⚠️ سقفِ تمدید از سرِ نو شروع نمی‌شود: refresh_expires_at دست‌نخورده
   *  می‌ماند. وگرنه یک نشست با تمدیدهای پشتِ هم برای همیشه زنده می‌ماند
   *  و «۳۰ روز» عملاً بی‌معنا می‌شد.
   */
  const rotated = newRefresh();
  const expiresAt = now + accessTtl(settings) * 1000;
  db.prepare(
    `UPDATE app_sessions
        SET refresh_hash = ?, expires_at = ?, last_used_at = ?,
            refresh_count = COALESCE(refresh_count, 0) + 1,
            device = COALESCE(NULLIF(?, ''), device),
            ip = COALESCE(NULLIF(?, ''), ip)
      WHERE id = ?`
  ).run(hashRefresh(rotated), expiresAt, now, String(device || '').slice(0, 200), String(ip || ''), row.id);

  const token = signAccess({ uid: user.id, sid: row.id, app: row.app, expiresAt });
  return {
    ok: true,
    token,
    expiresAt,
    expiresIn: accessTtl(settings),
    refreshToken: rotated,
    refreshExpiresAt: row.refresh_expires_at,
    refreshExpiresIn: Math.max(0, Math.round((row.refresh_expires_at - now) / 1000)),
    user: publicUser(user),
  };
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
/**
 * یک سطر در دفترِ ورود.
 *
 * ⚠️ هیچ‌وقت پرتاب نمی‌کند: ثبتِ ناموفق نباید جلوی ورودِ درست را بگیرد.
 */
function noteLogin({ app, userId = null, email, ok, reason = null, device = '', ip = '', sessionId = null, isNew = false }) {
  try {
    db.prepare(
      `INSERT INTO app_logins(app, user_id, email, at, ok, reason, device, ip, session_id, is_new)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).run(
      cleanApp(app),
      userId,
      String(email || '').slice(0, 254),
      Date.now(),
      ok ? 1 : 0,
      reason ? String(reason).slice(0, 40) : null,
      String(device || '').slice(0, 200),
      String(ip || '').slice(0, 64),
      sessionId,
      isNew ? 1 : 0
    );
  } catch { /* دفتر نباید جلوی ورود را بگیرد */ }
}

export function verifyCode({ app, target, code, device = '', ip = '', name = null, settings = otpSettings() }) {
  // برنامه‌ای که هنوز کد نخواسته در دفترِ موتور نیست؛ بدونِ این، خطا
  // «برنامه ثبت نشده» می‌شد در حالی که مشکلِ واقعی «کدی نفرستاده‌ای» است
  ensureCodeApp(app, { name: app });
  const result = verifyWithEngine({ app, email: target, code });
  if (!result.ok) {
    //  ⚠️ شکست هم ثبت می‌شود — همین‌ها می‌گویند کسی دارد حدس می‌زند
    noteLogin({ app, email: target, ok: false, reason: result.error, device, ip });
    const map = { no_code: 'no_code', expired: 'expired', wrong_code: 'wrong_code' };
    return {
      ok: false,
      error: map[result.error] || result.error,
      triesLeft: result.triesLeft,
      message: result.message,
    };
  }

  const { user, isNew } = upsertUser({ app, channel: 'email', target: result.email, name });
  if (user.blocked) {
    noteLogin({ app, userId: user.id, email: result.email, ok: false, reason: 'blocked', device, ip });
    return { ok: false, error: 'blocked', message: 'این حساب مسدود است' };
  }

  const session = createAppSession(user, { device, ip, settings });
  noteLogin({
    app, userId: user.id, email: result.email, ok: true,
    device, ip, sessionId: session.sessionId, isNew,
  });
  //  sessionId مالِ دفترِ خودمان است؛ کلاینت لازمش ندارد
  const { sessionId: _sid, ...forClient } = session;
  return { ok: true, isNew, user: publicUser(user), ...forClient };
}

/* ---------------------------------------------------------------------------
 *  خواندنِ دفترِ ورود — «هر برنامه در بخشِ خودش»
 * ------------------------------------------------------------------------- */

/**
 * ورودهای یک برنامه (یا همه، اگر app ندهید).
 *
 * @param {object} o
 * @param {string|null} [o.app]   فقط همین برنامه
 * @param {string} [o.email]      فقط همین ایمیل
 * @param {'all'|'ok'|'failed'} [o.only]
 */
export function listLogins({ app = null, email = '', only = 'all', limit = 100, offset = 0 } = {}) {
  const slug = app ? cleanApp(app) : null;
  const mail = String(email || '').trim().toLowerCase();
  const rows = db
    .prepare(
      `SELECT * FROM app_logins
        WHERE (? IS NULL OR app = ?)
          AND (? = '' OR email = ?)
          AND (? = 'all' OR (? = 'ok' AND ok = 1) OR (? = 'failed' AND ok = 0))
        ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(slug, slug, mail, mail, only, only, only,
      Math.min(500, Number(limit) || 100), Number(offset) || 0);

  return rows.map((r) => ({
    id: r.id,
    app: r.app,
    userId: r.user_id,
    email: r.email,
    at: r.at,
    ok: Boolean(r.ok),
    reason: r.reason,
    device: r.device || null,
    ip: r.ip || null,
    isNew: Boolean(r.is_new),
  }));
}

/** خلاصهٔ ورودهای هر برنامه — همان چیزی که کنارِ نامِ برنامه نشان داده می‌شود */
export function loginSummary(app = null) {
  const slug = app ? cleanApp(app) : null;
  const now = Date.now();
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const where = slug ? 'app = ? AND ' : '';
  const args = (extra) => (slug ? [slug, ...extra] : extra);
  return {
    app: slug,
    total: one(`SELECT COUNT(*) AS n FROM app_logins WHERE ${where}ok = 1`, ...args([])).n,
    today: one(`SELECT COUNT(*) AS n FROM app_logins WHERE ${where}ok = 1 AND at > ?`, ...args([now - 24 * HOUR])).n,
    failedToday: one(`SELECT COUNT(*) AS n FROM app_logins WHERE ${where}ok = 0 AND at > ?`, ...args([now - 24 * HOUR])).n,
    newToday: one(`SELECT COUNT(*) AS n FROM app_logins WHERE ${where}is_new = 1 AND at > ?`, ...args([now - 24 * HOUR])).n,
    lastAt: one(`SELECT MAX(at) AS t FROM app_logins WHERE ${where}ok = 1`, ...args([])).t || null,
  };
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

/**
 * آخرین کدها.
 *
 * ⚠️ این تابع تا امروز از جدولِ app_codes می‌خواند — جدولی که از وقتی دو
 * موتور یکی شدند **هیچ‌کس در آن نمی‌نویسد**. یعنی صفحهٔ «کدهای اخیر»
 * همیشه خالی بود و هیچ خطایی هم نمی‌داد؛ بدترین جور خرابی.
 *
 * حالا از همان‌جایی می‌خواند که کدها واقعاً آن‌جا ثبت می‌شوند.
 * شکلِ خروجی عمداً دست‌نخورده ماند تا هر چه از این می‌خواند نشکند.
 */
export function recentCodes(limit = 20) {
  return recentRequests({ limit: Math.min(100, Number(limit) || 20) }).map((row) => ({
    id: row.id,
    app: row.app,
    channel: 'email',
    target: row.email,
    created_at: row.created_at,
    expires_at: row.expires_at,
    used_at: row.used_at,
    sent_via: row.send_state === 'sent' ? 'email' : null,
    tries: row.tries,
  }));
}

export function stats() {
  const now = Date.now();
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  return {
    users: one('SELECT COUNT(*) AS n FROM app_users').n,
    apps: one('SELECT COUNT(DISTINCT app) AS n FROM app_users').n,
    activeSessions: one('SELECT COUNT(*) AS n FROM app_sessions WHERE expires_at > ?', now).n,
    // ⚠️ از جدولِ زنده، نه app_codesِ متروک که همیشه صفر می‌داد
    codesLastHour: one('SELECT COUNT(*) AS n FROM code_requests WHERE created_at > ?', now - HOUR).n,
    loginsToday: one('SELECT COUNT(*) AS n FROM app_users WHERE last_login_at > ?', now - 24 * HOUR).n,
  };
}

/** نگهداریِ دوره‌ای — نشست‌ها و کدهای تمام‌شده پاک می‌شوند */
export function pruneAppAuth() {
  const now = Date.now();
  try {
    db.prepare('DELETE FROM app_sessions WHERE expires_at < ?').run(now);
    // app_codes دیگر نوشته نمی‌شود؛ اگر روی نصبِ قدیمی هست، کهنه‌هایش برود
    try { db.prepare('DELETE FROM app_codes WHERE created_at < ?').run(now - 7 * 24 * HOUR); }
    catch { /* نصبِ تازه این جدول را ندارد */ }
  } catch { /* بی‌خیال */ }
}
