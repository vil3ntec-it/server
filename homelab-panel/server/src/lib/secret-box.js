// ═══════════════════════════════════════════════════════════════════════════
//  جعبهٔ راز — شورا، پ۳ (ممیزی L3)
//
//  کلیدِ اصلیِ گاوصندوق (‎data/vault.key‎، ۳۲ بایت، ۰۶۰۰) و رمزنگاریِ AES-256-GCM
//  برای یک رشتهٔ کوتاه. ‎control/vault.js‎ همین کلید را از همین‌جا می‌گیرد —
//  یک فایل، یک سازنده.
//
//  ⛔ این ماژول هیچ چیزی از ‎db.js‎ نمی‌خواند: ‎db.js‎ خودش برای رازهای جدولِ
//  ‎settings‎ از این‌جا استفاده می‌کند و وابستگیِ دوری یعنی کلیدِ نیمه‌ساخته
//  هنگامِ بالا آمدن.
// ═══════════════════════════════════════════════════════════════════════════
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const ALGO = 'aes-256-gcm';
export const BOX_PREFIX = 'enc1:';
let cachedKey = null;
let cachedFor = null;

function keyFile() { return path.join(config.dataDir, 'vault.key'); }

/** کلیدِ اصلی — بارِ اول ساخته و برای همیشه نگه داشته می‌شود */
export function vaultKey() {
  const file = keyFile();
  if (cachedKey && cachedFor === file) return cachedKey;
  try {
    if (fs.existsSync(file)) {
      const hex = fs.readFileSync(file, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        cachedKey = Buffer.from(hex, 'hex'); cachedFor = file;
        return cachedKey;
      }
    }
  } catch { /* پایین ساخته می‌شود */ }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* ویندوز */ }
  cachedKey = key; cachedFor = file;
  return cachedKey;
}

export function isBoxed(v) { return typeof v === 'string' && v.startsWith(BOX_PREFIX); }

/** رشته ⇒ ‎enc1:iv.tag.ct‎ (base64) */
export function box(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, vaultKey(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `${BOX_PREFIX}${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

/** بازکردن — نشد (کلیدِ دیگر، دست‌خورده) ⇒ ‎null‎، نه استثنا */
export function unbox(sealed) {
  if (!isBoxed(sealed)) return null;
  try {
    const [iv, tag, ct] = sealed.slice(BOX_PREFIX.length).split('.');
    const d = crypto.createDecipheriv(ALGO, vaultKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
