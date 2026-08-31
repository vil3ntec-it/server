// ---------------------------------------------------------------------------
//  رمزهای هر نصب — هیچ رمزی نباید داخلِ کد بماند
//
//  هر نصبِ سرور رمزهای خودش را دارد که بارِ اول ساخته و در پوشهٔ دادهٔ همان
//  نصب نگه داشته می‌شوند. دو نصبِ متفاوت هرگز رمزِ یکسان ندارند.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { getSetting, setSetting } from '../db.js';

/**
 * یک رازِ نام‌دار. اگر نبود، ساخته و ذخیره می‌شود.
 * @param {string} name  نامِ راز، مثل 'sitesync_legacy'
 * @param {number} bytes طولِ تصادفی
 */
export function secret(name, bytes = 24) {
  const key = `secret_${name}`;
  let value = getSetting(key, null);
  if (typeof value === 'string' && value.length >= 16) return value;
  value = crypto.randomBytes(bytes).toString('hex');
  setSetting(key, value);
  return value;
}

/** رازِ تازه به‌جای قبلی (برای دکمهٔ «رمزِ تازه») */
export function rotateSecret(name, bytes = 24) {
  const value = crypto.randomBytes(bytes).toString('hex');
  setSetting(`secret_${name}`, value);
  return value;
}

/** مقایسهٔ امن — تا زمانِ پاسخ، رمز را لو ندهد */
export function sameSecret(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
