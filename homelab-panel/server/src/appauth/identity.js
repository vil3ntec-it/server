// ---------------------------------------------------------------------------
//  پاک‌سازیِ ورودی‌ها — شماره، ایمیل، و نامِ برنامه
//
//  جدا از بقیه نگه داشته شده تا دفترِ برنامه‌ها و مسیرهای API هم بتوانند از آن
//  استفاده کنند، بی‌آنکه ماژول‌ها به هم گره بخورند.
// ---------------------------------------------------------------------------
import { otpSettings } from './settings.js';

/** ارقامِ فارسی/عربی → انگلیسی */
export function latinDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * شماره را به شکلِ جهانی (+989121234567) در می‌آورد.
 * ۰۹۱۲…، 0912…، 912…، 98912…، +98912… و 0098912… همه یکی حساب می‌شوند،
 * تا کاربر هر جور نوشت، همان حسابِ قبلیِ خودش باشد.
 */
export function normalizePhone(raw, defaultCountry = '+98') {
  let s = latinDigits(raw).trim().replace(/[\s\-().]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  const cc = String(defaultCountry || '+98').replace(/[^\d]/g, '');

  if (!s.startsWith('+')) {
    if (s.startsWith('0')) s = `+${cc}${s.slice(1)}`;
    else if (s.startsWith(cc) && s.length > cc.length + 6) s = `+${s}`;
    else if (/^\d{6,12}$/.test(s)) s = `+${cc}${s}`;
    else s = `+${s}`;
  }
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

export function normalizeEmail(raw) {
  const s = latinDigits(raw).trim().toLowerCase();
  return /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

/** نامِ برنامه/سایت — تا هر برنامه کاربرانِ خودش را داشته باشد */
export function cleanApp(value) {
  const s = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'main';
}

/**
 * از روی ورودی می‌فهمد پیامک است یا ایمیل. برنامه می‌تواند فقط یک فیلدِ
 * «to» بفرستد و لازم نباشد خودش تشخیص بدهد.
 */
export function pickTarget(body = {}, settings = otpSettings()) {
  // اولین فیلدی که واقعاً چیزی دارد — فرم‌هایی که هر دو فیلد را می‌فرستند و
  // یکی‌شان خالی است (که خیلی هم رایج است) نباید «خالی» حساب شوند
  let key = null;
  let value = '';
  for (const candidate of ['phone', 'mobile', 'email', 'to', 'identifier', 'username']) {
    const v = latinDigits(body?.[candidate]).trim();
    if (v) {
      key = candidate;
      value = v;
      break;
    }
  }
  if (!key) return { error: 'empty' };

  if (key === 'email' || value.includes('@')) {
    const email = normalizeEmail(value);
    return email ? { channel: 'email', target: email } : { error: 'bad_email' };
  }
  const phone = normalizePhone(value, settings.defaultCountry);
  return phone ? { channel: 'sms', target: phone } : { error: 'bad_phone' };
}

