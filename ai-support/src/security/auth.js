// ═══════════════════════════════════════════════════════════════════════════
//  احراز هویت و سطحِ دسترسی
//
//  نکتهٔ مهم و صادقانه:
//  توکنِ داخلیِ برنامه (`BUILTIN_TOKEN`) از روزِ اول داخلِ index.htmlِ باز روی
//  اینترنت است. پس «هرکس آن را دارد» یعنی «هرکس سایت را باز کرده». بنابراین:
//
//    • با توکنِ برنامه، بیشترین سطحی که می‌شود گرفت USER است.
//    • سطحِ ADMIN فقط با AI_ADMIN_TOKEN (رازِ جداگانه، فقط رویِ سرورِ خودت)
//      داده می‌شود. اگر تنظیم نشده باشد، ADMIN اصلاً صادر نمی‌شود.
//    • سطحِ INTERNAL هرگز از راهِ چت صادر نمی‌شود — نه با هیچ توکنی.
//
//  یعنی نوشتنِ «من مدیرم» در متنِ چت هیچ اثری ندارد؛ نقش از توکنِ امضاشده
//  خوانده می‌شود، نه از حرفِ کاربر.
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import config from '../config.js';

/** نردبانِ سطحِ دسترسی — هر سطح شاملِ پایینی‌هاست */
export const LEVELS = ['PUBLIC', 'USER', 'PREMIUM', 'ADMIN', 'INTERNAL'];

export function levelRank(level) {
  const i = LEVELS.indexOf(String(level || '').toUpperCase());
  return i < 0 ? 0 : i;
}

/** آیا کاربرِ با سطحِ `userLevel` اجازهٔ دیدنِ سندِ با سطحِ `docLevel` را دارد؟ */
export function canAccess(userLevel, docLevel) {
  const doc = String(docLevel || 'PUBLIC').toUpperCase();
  // INTERNAL هیچ‌وقت از راهِ چت دیده نمی‌شود، حتی اگر نشستی به هر دلیلی ADMIN باشد
  if (doc === 'INTERNAL') return false;
  return levelRank(userLevel) >= levelRank(doc);
}

/** نگاشتِ نقشِ برنامهٔ اصلی به سطحِ دسترسیِ دستیار */
export function levelForAppRole(role) {
  switch (String(role || '').toLowerCase()) {
    case 'admin': return 'ADMIN';
    case 'staff':
    case 'employee':
    case 'viewer': return 'USER';
    case 'person':
    case 'customer':
    case 'guest': return 'PUBLIC';
    default: return 'PUBLIC';
  }
}

const b64u = buf => Buffer.from(buf).toString('base64url');

function sign(payloadStr) {
  return crypto.createHmac('sha256', config.auth.sessionSecret).update(payloadStr).digest('base64url');
}

/** مقایسهٔ ثابت‌زمان — جلوی حدسِ رمز با اندازه‌گیریِ زمان را می‌گیرد */
function safeEqual(a, b) {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

/**
 * توکنِ برنامه را بررسی می‌کند و سطحِ سقفِ مجاز را برمی‌گرداند.
 * @returns {{ok: boolean, maxLevel: string, reason?: string}}
 */
export function checkAppCredentials({ appToken, adminToken }) {
  const expectedApp = config.auth.appToken || process.env.AI_APP_TOKEN || '';
  const expectedAdmin = process.env.AI_ADMIN_TOKEN || '';

  // اگر رمزِ برنامه تنظیم نشده باشد، سرویس در حالتِ «خانگیِ باز» است: هر کسی که
  // به پورت می‌رسد می‌تواند نشستِ USER بگیرد. چون سرویس پیش‌فرض فقط روی 127.0.0.1
  // گوش می‌دهد، این یعنی «هرکسی که پشتِ همین کامپیوتر است».
  if (expectedApp && !safeEqual(appToken, expectedApp)) {
    return { ok: false, maxLevel: 'PUBLIC', reason: 'رمزِ برنامه درست نیست' };
  }

  if (adminToken) {
    if (!expectedAdmin) return { ok: true, maxLevel: 'USER', reason: 'AI_ADMIN_TOKEN روی سرور تنظیم نشده — سطحِ مدیر صادر نمی‌شود' };
    if (safeEqual(adminToken, expectedAdmin)) return { ok: true, maxLevel: 'ADMIN' };
    return { ok: false, maxLevel: 'PUBLIC', reason: 'رمزِ مدیر درست نیست' };
  }

  return { ok: true, maxLevel: 'USER' };
}

/**
 * ساختِ توکنِ نشست.
 * @param {{deviceId: string, role: string, level: string}} claims
 */
export function issueSession({ deviceId, role, level }) {
  const now = Date.now();
  const payload = {
    v: 1,
    sub: String(deviceId || '').slice(0, 64) || 'anon',
    role: String(role || 'guest').slice(0, 24),
    lvl: LEVELS.includes(level) ? level : 'PUBLIC',
    iat: now,
    exp: now + config.auth.sessionTtlMs,
    // شناسهٔ یکتا تا هر نشست در لاگ قابلِ ردیابی باشد بدونِ لو رفتنِ خودِ توکن
    jti: crypto.randomBytes(8).toString('hex'),
  };
  const body = b64u(JSON.stringify(payload));
  return { token: `${body}.${sign(body)}`, payload };
}

/**
 * بررسیِ توکنِ نشست.
 * @returns {{ok: boolean, session?: object, reason?: string}}
 */
export function verifySession(token) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'نشست نیست' };
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return { ok: false, reason: 'قالبِ نشست خراب است' };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, sign(body))) return { ok: false, reason: 'امضای نشست معتبر نیست' };

  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { return { ok: false, reason: 'محتوای نشست خوانده نشد' }; }

  if (!payload || payload.v !== 1) return { ok: false, reason: 'نسخهٔ نشست پشتیبانی نمی‌شود' };
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return { ok: false, reason: 'نشست منقضی شده' };
  // INTERNAL حتی اگر با امضای درست هم بیاید پذیرفته نمی‌شود
  if (payload.lvl === 'INTERNAL') return { ok: false, reason: 'سطحِ INTERNAL از راهِ چت معتبر نیست' };

  return { ok: true, session: payload };
}

/** خواندنِ نشست از هدرِ درخواست */
export function sessionFromRequest(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  const token = m ? m[1] : (req.headers['x-ai-session'] || '');
  return verifySession(String(token || '').trim());
}
