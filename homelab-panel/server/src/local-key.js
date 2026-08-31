// ---------------------------------------------------------------------------
//  کلیدِ محلی — تا برنامهٔ رویِ همین کامپیوتر بتواند بدونِ ورودِ دستی کار کند
//
//  مسئله: «برنامهٔ سرور خانگی» روی همین کامپیوتر است و باید بتواند برنامه‌ها و
//  سایت‌ها را بسازد و تنظیم کند. اگر هر بار نامِ کاربری و رمزِ پنل بخواهد،
//  دیگر ساده نیست؛ و اگر مسیرهای مدیریتی را برای «هر چیزی که از localhost
//  بیاید» باز بگذاریم، هر سایتی در مرورگرِ همین کامپیوتر می‌تواند صدایشان بزند.
//
//  راهِ حل: سرور یک کلیدِ تصادفی در data/local-admin.key می‌نویسد. فقط برنامه‌ای
//  که روی همین کامپیوتر است می‌تواند آن فایل را بخواند — یک صفحهٔ وب هرگز
//  نمی‌تواند. پس: کلیدِ درست + اتصال از خودِ همین کامپیوتر = اجازهٔ مدیریت.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { requireAuth } from './auth.js';

const KEY_FILE = path.join(config.dataDir, 'local-admin.key');

let cached = null;

export function localKey() {
  if (cached) return cached;
  try {
    const saved = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (saved.length >= 32) {
      cached = saved;
      return cached;
    }
  } catch { /* هنوز ساخته نشده */ }

  cached = crypto.randomBytes(24).toString('hex');
  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, cached, 'utf8');
  } catch { /* اگر ننوشت، برنامهٔ محلی باید با حسابِ پنل وارد شود */ }
  return cached;
}

export function keyFilePath() {
  return KEY_FILE;
}

/** آیا این اتصال از خودِ همین کامپیوتر است؟ */
function isLocal(req) {
  const address = String(req.socket?.remoteAddress || '');
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * یا کلیدِ محلی (برنامهٔ روی همین کامپیوتر)، یا حسابِ مدیرِ پنل.
 */
export function requireLocalOrAuth(req, res, next) {
  const sent = req.headers['x-local-key'] || req.query?.localKey;
  if (sent && isLocal(req) && crypto.timingSafeEqual(
    Buffer.from(String(sent).padEnd(64).slice(0, 64)),
    Buffer.from(localKey().padEnd(64).slice(0, 64))
  )) {
    req.user = { id: 0, username: 'local-app', local: true };
    return next();
  }
  return requireAuth(req, res, next);
}
