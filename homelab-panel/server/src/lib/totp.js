// ---------------------------------------------------------------------------
//  رمزِ یک‌بارمصرفِ زمان‌دار (TOTP، RFC 6238) — بی هیچ وابستگی
//
//  چرا خودمان نوشتیم و کتابخانه نیاوردیم: کلِ الگوریتم HMAC-SHA1 روی یک
//  شمارندهٔ ۳۰ ثانیه‌ای است و در پنجاه خط جا می‌شود؛ `node:crypto` هر چه لازم
//  است دارد. یک وابستگیِ تازه یعنی یک چیزِ دیگر که باید سال‌ها به‌روز بماند.
//
//  با هر اپِ Authenticatorِ رایگان (Google Authenticator، Aegis، FreeOTP…)
//  کار می‌کند چون همان استانداردِ otpauth:// را می‌سازد.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** رازِ تازه — ۲۰ بایت، همان اندازه‌ای که RFC پیشنهاد می‌کند */
export function newSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function totp(secretBase32, at = Date.now()) {
  return hotp(secretBase32, Math.floor(at / 1000 / STEP_SECONDS));
}

/** ارقامِ فارسی و عربی هم پذیرفته می‌شوند — کاربر همان را تایپ می‌کند */
export function normalizeDigits(input) {
  return String(input || '')
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\D/g, '');
}

/**
 * پنجرهٔ ±۱ گام (۳۰ ثانیه): ساعتِ گوشی و سرور دقیقاً یکی نیستند.
 * مقایسه با زمانِ ثابت تا از روی طولِ مقایسه چیزی لو نرود.
 */
export function verifyTotp(secretBase32, input, { at = Date.now(), window = 1 } = {}) {
  const code = normalizeDigits(input);
  if (code.length !== DIGITS || !secretBase32) return false;
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  for (let i = -window; i <= window; i++) {
    const expected = hotp(secretBase32, counter + i);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return true;
  }
  return false;
}

export function otpauthUrl({ issuer, account, secret }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/* ---------------- کدهای بازیابی ----------------
 * ده کدِ یک‌بارمصرف برای روزی که گوشی گم شد. فقط هششان ذخیره می‌شود؛
 * خودِ کد یک بار نشان داده می‌شود و بس.
 */
export function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const raw = crypto.randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

export function hashRecovery(code) {
  return crypto.createHash('sha256').update(String(code).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('hex');
}

/** اگر کد در فهرست بود، همان را برمی‌دارد و فهرستِ تازه را می‌دهد */
export function useRecoveryCode(hashes, input) {
  const h = hashRecovery(input);
  const list = Array.isArray(hashes) ? hashes : [];
  const idx = list.findIndex((x) => x.length === h.length && crypto.timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  if (idx < 0) return { ok: false, remaining: list };
  return { ok: true, remaining: list.filter((_, i) => i !== idx) };
}
