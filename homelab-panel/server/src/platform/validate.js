// ---------------------------------------------------------------------------
//  اعتبارسنجیِ ورودی — کوچک، بدونِ وابستگی، در مرزِ روتر
//
//  چرا کتابخانه نمی‌آوریم (zod و مانندش): این سرور عمداً وابستگیِ کم دارد تا
//  نصبش روی یک کامپیوترِ خانگی سبک بماند و سطحِ حملهٔ زنجیرهٔ تأمین کوچک.
//  چیزی که لازم داریم چند تابعِ ساده است، نه یک سیستمِ تایپ.
//
//  قاعده: ورودیِ بد باید ۴۰۰ بدهد، نه ۵۰۰. خطای ۵۰۰ یعنی ما ورودی را
//  بررسی نکرده‌ایم و ردِ پشتهٔ خطا هم ممکن است چیزی لو بدهد.
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  constructor(field, rule, message) {
    super(message || `${field}: ${rule}`);
    this.name = 'ValidationError';
    this.field = field;
    this.rule = rule;
    this.status = 400;
  }
}

export const v = {
  string(value, field, { min = 0, max = 1000, pattern = null, trim = true } = {}) {
    if (typeof value !== 'string') throw new ValidationError(field, 'not_a_string');
    const s = trim ? value.trim() : value;
    if (s.length < min) throw new ValidationError(field, 'too_short');
    if (s.length > max) throw new ValidationError(field, 'too_long');
    if (pattern && !pattern.test(s)) throw new ValidationError(field, 'bad_format');
    return s;
  },

  int(value, field, { min = -Infinity, max = Infinity } = {}) {
    const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) throw new ValidationError(field, 'not_a_number');
    if (n < min) throw new ValidationError(field, 'too_small');
    if (n > max) throw new ValidationError(field, 'too_large');
    return n;
  },

  bool(value, field) {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1 || value === '1') return true;
    if (value === 'false' || value === 0 || value === '0') return false;
    throw new ValidationError(field, 'not_a_boolean');
  },

  oneOf(value, field, allowed) {
    if (!allowed.includes(value)) throw new ValidationError(field, 'not_allowed');
    return value;
  },

  /**
   * رمز عبور. سقف هم لازم است: scrypt روی ورودیِ چندمگابایتی CPU را
   * می‌خورد و یک درخواست می‌تواند سرور را بخواباند (DoS از راهِ هش).
   */
  password(value, field = 'password', { min = 8 } = {}) {
    if (typeof value !== 'string') throw new ValidationError(field, 'not_a_string');
    if (value.length < min) throw new ValidationError(field, 'too_short');
    if (value.length > 200) throw new ValidationError(field, 'too_long');
    return value;
  },
};

/** خطای اعتبارسنجی را به پاسخِ ۴۰۰ تبدیل می‌کند؛ بقیه را رد می‌کند بالاتر */
export function handleValidation(err, req, res, next) {
  if (err instanceof ValidationError || err?.name === 'ValidationError') {
    return res.status(400).json({ error: 'invalid_input', field: err.field, rule: err.rule });
  }
  return next(err);
}
