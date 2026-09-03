// ---------------------------------------------------------------------------
//  کدِ شش‌رقمیِ ورود
//
//  قانون‌ها:
//    • خودِ کد هیچ‌جا ذخیره نمی‌شود — فقط hash آن، و بعد از مصرف پاک می‌شود.
//    • برای هر نشانی، یک کدِ فعال؛ کدِ تازه جای قبلی را می‌گیرد.
//    • فاصلهٔ اجباری بینِ دو درخواست، و سقفِ تعدادِ حدس.
//    • کد هیچ‌وقت در لاگ نوشته نمی‌شود.
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import { db } from '../db.js';
import { readTohidSettings, mailSettings } from './settings.js';
import { sendMail } from './smtp.js';
import { sendSms } from './sms.js';
import { otpEmail } from '../emails/otp.js';

const hash = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function sixDigits() {
  // بازهٔ ۱۰۰۰۰۰ تا ۹۹۹۹۹۹ به‌صورت یکنواخت
  return String(100000 + crypto.randomInt(900000));
}

export function normalizeContact(method, value) {
  const raw = String(value || '').trim();
  if (method === 'email') {
    const v = raw.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      throw Object.assign(new Error('ایمیل درست نیست'), { code: 'bad_email' });
    }
    return v;
  }
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^\+?\d{9,13}$/.test(digits)) {
    throw Object.assign(new Error('شماره درست نیست'), { code: 'bad_phone' });
  }
  return digits;
}

/**
 * ساخت و فرستادنِ کد.
 * اگر فرستادن شکست بخورد، کد ذخیره نمی‌ماند — وگرنه کاربر پشتِ کدی می‌ماند
 * که هرگز به دستش نرسیده.
 */
export async function sendCode({ method, value, name }) {
  const cfg = readTohidSettings();
  const contact = normalizeContact(method, value);
  const now = Date.now();

  const existing = db.prepare('SELECT * FROM th_otp WHERE method = ? AND value = ?').get(method, contact);
  if (existing) {
    const wait = cfg.resendSeconds * 1000 - (now - existing.created_at);
    if (wait > 0) {
      throw Object.assign(
        new Error(`تا ${Math.ceil(wait / 1000)} ثانیهٔ دیگر دوباره تلاش کنید`),
        { code: 'too_soon' },
      );
    }
  }

  const code = sixDigits();
  const minutes = Math.round(cfg.otpTtlSeconds / 60);

  if (method === 'email') {
    // نامِ فرستنده همان نامی است که در هدرِ ایمیل هم می‌نشیند، پس کاربر یک
    // نام می‌بیند نه دو تا
    const mail = mailSettings();
    const { subject, html, text } = otpEmail({
      code,
      minutes,
      appName: mail.fromName || 'توحید',
    });
    await sendMail(mail, { to: contact, subject, html, text });
  } else {
    // متنِ پیامک از تنظیمات می‌آید تا هر دکان بتواند نامِ خودش را بگذارد
    const text = String(cfg.otpMessage || 'کد ورود شما: {code}')
      .replaceAll('{code}', code)
      .replaceAll('{minutes}', String(minutes));
    await sendSms({ to: contact, text });
  }

  db.prepare('DELETE FROM th_otp WHERE method = ? AND value = ?').run(method, contact);
  db.prepare(`
    INSERT INTO th_otp (method, value, code_hash, name, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(method, contact, hash(code), String(name || '').trim() || null, now, now + cfg.otpTtlSeconds * 1000);

  return { ok: true };
}

/** بررسیِ کد. کدِ درست همان لحظه مصرف و پاک می‌شود. */
export function verifyCode({ method, value, code }) {
  const cfg = readTohidSettings();
  const contact = normalizeContact(method, value);
  const row = db.prepare('SELECT * FROM th_otp WHERE method = ? AND value = ?').get(method, contact);

  if (!row) throw Object.assign(new Error('کدی برای این نشانی فرستاده نشده'), { code: 'no_code' });
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM th_otp WHERE id = ?').run(row.id);
    throw Object.assign(new Error('کد منقضی شده — دوباره درخواست کنید'), { code: 'expired' });
  }
  if (row.tries >= cfg.maxTries) {
    db.prepare('DELETE FROM th_otp WHERE id = ?').run(row.id);
    throw Object.assign(new Error('تعداد تلاش زیاد شد — کد تازه بگیرید'), { code: 'too_many_tries' });
  }

  const given = String(code || '').trim();
  const expected = row.code_hash;
  const ok = given.length === 6 && crypto.timingSafeEqual(
    Buffer.from(hash(given), 'hex'),
    Buffer.from(expected, 'hex'),
  );

  if (!ok) {
    db.prepare('UPDATE th_otp SET tries = tries + 1 WHERE id = ?').run(row.id);
    throw Object.assign(new Error('کد درست نیست'), { code: 'bad_code' });
  }

  db.prepare('DELETE FROM th_otp WHERE id = ?').run(row.id);
  return { ok: true, contact, name: row.name };
}

/** کدهای منقضی را جمع می‌کند */
export function pruneCodes() {
  db.prepare('DELETE FROM th_otp WHERE expires_at < ?').run(Date.now());
}
