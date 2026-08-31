// ---------------------------------------------------------------------------
//  حساب‌های برنامهٔ توحید
//
//  جدا از کاربرانِ خودِ پنل: اینها مشتری‌های برنامه‌اند، نه مدیرانِ سرور.
//  رمزِ ساده هیچ‌جا نگه داشته نمی‌شود؛ فقط hash با scrypt.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, getSetting, setSetting } from '../db.js';
import { hashPassword, verifyPassword } from '../auth.js';

const ACCESS_TTL_MS = 60 * 60 * 1000;             // یک ساعت
const REFRESH_TTL_MS = 60 * 24 * 60 * 60 * 1000;  // شصت روز

/** رازِ امضای توکن‌های برنامه — جدا از رازِ پنل */
function appSecret() {
  let s = getSetting('tohid_jwt_secret', null);
  if (!s) {
    s = crypto.randomBytes(48).toString('hex');
    setSetting('tohid_jwt_secret', s);
  }
  return s;
}

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

export function findAccount(identifier) {
  const v = String(identifier || '').trim();
  if (!v) return null;
  return db.prepare(`
    SELECT * FROM th_accounts
    WHERE lower(email) = lower(?) OR phone = ? OR account_id = ?
    LIMIT 1
  `).get(v, v, v) || null;
}

export function accountById(accountId) {
  return db.prepare('SELECT * FROM th_accounts WHERE account_id = ?').get(accountId) || null;
}

/**
 * ساختِ حساب. اگر ایمیل یا شمارهٔ تکراری باشد خطا می‌دهد — دو نفر نباید
 * روی یک نشانی حساب داشته باشند.
 */
export function createAccount({ name, email, phone, password }) {
  const mail = clean(email);
  const tel = clean(phone);
  if (!mail && !tel) throw Object.assign(new Error('ایمیل یا شماره لازم است'), { code: 'identifier_required' });
  if (mail && findAccount(mail)) throw Object.assign(new Error('این ایمیل قبلاً ثبت شده'), { code: 'email_taken' });
  if (tel && findAccount(tel)) throw Object.assign(new Error('این شماره قبلاً ثبت شده'), { code: 'phone_taken' });

  const accountId = newId('acc');
  db.prepare(`
    INSERT INTO th_accounts (account_id, name, email, phone, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(accountId, clean(name), mail, tel, password ? hashPassword(password) : null, Date.now());
  return accountById(accountId);
}

/** حسابِ موجود برای این نشانی، وگرنه یک حسابِ تازه — مسیرِ ورود با کد */
export function accountForContact({ method, value, name }) {
  const found = findAccount(value);
  if (found) {
    if (name && !found.name) {
      db.prepare('UPDATE th_accounts SET name = ? WHERE account_id = ?').run(clean(name), found.account_id);
    }
    return accountById(found.account_id);
  }
  return createAccount({
    name,
    email: method === 'email' ? value : null,
    phone: method === 'phone' ? value : null,
    password: null,
  });
}

export function checkPassword(account, password) {
  if (!account?.password_hash) return false;
  return verifyPassword(password, account.password_hash);
}

/* ------------------------------- توکن‌ها -------------------------------- */

export function issueTokens(account, deviceUid = null) {
  const now = Date.now();
  const accessExpiresAt = now + ACCESS_TTL_MS;
  const accessToken = jwt.sign(
    { sub: account.account_id, typ: 'access' },
    appSecret(),
    { expiresIn: Math.floor(ACCESS_TTL_MS / 1000) },
  );

  const refreshToken = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO th_sessions (account_id, refresh_hash, device_uid, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(account.account_id, sha(refreshToken), deviceUid, now, now + REFRESH_TTL_MS);

  db.prepare('UPDATE th_accounts SET last_login_at = ?, last_seen_at = ? WHERE account_id = ?')
    .run(now, now, account.account_id);

  return { accessToken, accessExpiresAt, refreshToken };
}

export function refreshAccess(refreshToken) {
  const row = db.prepare(`
    SELECT * FROM th_sessions WHERE refresh_hash = ? AND revoked = 0
  `).get(sha(refreshToken));
  if (!row) throw Object.assign(new Error('نشست معتبر نیست'), { code: 'invalid_token' });
  if (row.expires_at < Date.now()) throw Object.assign(new Error('نشست منقضی شده'), { code: 'invalid_token' });

  const account = accountById(row.account_id);
  if (!account) throw Object.assign(new Error('حساب پیدا نشد'), { code: 'invalid_token' });
  if (account.disabled) throw Object.assign(new Error('حساب غیرفعال است'), { code: 'account_disabled' });

  const now = Date.now();
  return {
    accessToken: jwt.sign({ sub: account.account_id, typ: 'access' }, appSecret(),
      { expiresIn: Math.floor(ACCESS_TTL_MS / 1000) }),
    accessExpiresAt: now + ACCESS_TTL_MS,
  };
}

/** حسابِ پشتِ یک Bearer token — یا null */
export function accountFromToken(header) {
  const raw = String(header || '');
  if (!raw.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(raw.slice(7), appSecret());
    if (payload.typ !== 'access') return null;
    const account = accountById(payload.sub);
    if (!account || account.disabled) return null;
    return account;
  } catch {
    return null;
  }
}

export function revokeSessions(accountId) {
  db.prepare('UPDATE th_sessions SET revoked = 1 WHERE account_id = ?').run(accountId);
}

/** شکلِ کاربر همان‌طور که برنامه انتظار دارد */
export function publicUser(account) {
  return {
    id: account.account_id,
    name: account.name || '',
    email: account.email || '',
    phone: account.phone || '',
  };
}

/* ------------------------------ دستگاه‌ها ------------------------------- */

export function touchDevice(accountId, device) {
  const uid = clean(device?.uid);
  if (!uid) throw Object.assign(new Error('شناسهٔ دستگاه لازم است'), { code: 'device_required' });
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM th_devices WHERE account_id = ? AND uid = ?').get(accountId, uid);

  if (existing) {
    db.prepare(`
      UPDATE th_devices SET name = ?, platform = ?, fingerprint = ?, last_seen = ? WHERE id = ?
    `).run(clean(device.name), clean(device.platform), clean(device.fingerprint), now, existing.id);
    return db.prepare('SELECT * FROM th_devices WHERE id = ?').get(existing.id);
  }

  db.prepare(`
    INSERT INTO th_devices (account_id, uid, name, platform, fingerprint, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(accountId, uid, clean(device.name), clean(device.platform), clean(device.fingerprint), now, now);
  return db.prepare('SELECT * FROM th_devices WHERE account_id = ? AND uid = ?').get(accountId, uid);
}

export function listDevices(accountId) {
  return db.prepare('SELECT * FROM th_devices WHERE account_id = ? ORDER BY last_seen DESC').all(accountId);
}
