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

// راز امضای JWT — یک‌بار ساخته و در دیتابیس نگهداری می‌شود
export function jwtSecret() {
  let s = getSetting('jwt_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSetting('jwt_secret', s);
  }
  return s;
}

export function isInitialized() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

export function createUser(username, password) {
  const now = Date.now();
  db.prepare('INSERT INTO users(username, password_hash, created_at) VALUES(?, ?, ?)').run(
    String(username).trim(),
    hashPassword(password),
    now
  );
  return db.prepare('SELECT id, username, created_at FROM users WHERE username = ?').get(String(username).trim());
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
    // توکنِ کاربرانِ برنامه (ورود با کدِ شش‌رقمی) هرگز کلیدِ پنل نمی‌شود
    if (payload.typ === 'app') return null;
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(payload.sid);
    if (!session || session.expires_at < Date.now()) return null;
    return { id: payload.uid, username: payload.username, sessionId: payload.sid };
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
