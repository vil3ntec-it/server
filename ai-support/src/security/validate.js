// ═══════════════════════════════════════════════════════════════════════════
//  اعتبارسنجیِ ورودی
//
//  یک اعتبارسنجِ کوچکِ شبیهِ JSON-Schema. عمداً کوچک است: فقط چیزهایی که واقعاً
//  لازم داریم. هر ابزار schema دارد و آرگومان‌هایی که **مدل** می‌سازد از همین
//  رد می‌شوند — یعنی مدل نمی‌تواند با پارامترِ عجیب کاری بکند که پیش‌بینی نشده.
// ═══════════════════════════════════════════════════════════════════════════

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.statusCode = 400;
  }
}

/**
 * @param {object} value مقدارِ ورودی
 * @param {object} schema {type:'object', properties:{...}, required:[...]}
 * @param {string} where نامِ محل برای پیامِ خطا
 * @returns {object} نسخهٔ پاک‌شده — **فقط** فیلدهای تعریف‌شده (هر چیزِ اضافه دور می‌ریزد)
 */
export function validate(value, schema, where = 'ورودی') {
  if (!schema || schema.type !== 'object') throw new ValidationError('طرحِ اعتبارسنجی نامعتبر است', where);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(`${where} باید یک شیء باشد`, where);
  }

  const out = {};
  const props = schema.properties || {};

  for (const key of schema.required || []) {
    if (value[key] === undefined || value[key] === null || value[key] === '') {
      throw new ValidationError(`«${key}» لازم است`, key);
    }
  }

  for (const [key, spec] of Object.entries(props)) {
    let v = value[key];
    if (v === undefined || v === null) {
      if (spec.default !== undefined) out[key] = spec.default;
      continue;
    }

    switch (spec.type) {
      case 'string': {
        if (typeof v !== 'string') v = String(v);
        v = v.trim();
        if (spec.maxLength && v.length > spec.maxLength) v = v.slice(0, spec.maxLength);
        if (spec.minLength && v.length < spec.minLength) throw new ValidationError(`«${key}» خیلی کوتاه است`, key);
        if (spec.enum && !spec.enum.includes(v)) throw new ValidationError(`«${key}» باید یکی از این‌ها باشد: ${spec.enum.join('، ')}`, key);
        if (spec.pattern && !new RegExp(spec.pattern).test(v)) throw new ValidationError(`قالبِ «${key}» درست نیست`, key);
        out[key] = v;
        break;
      }
      case 'number':
      case 'integer': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new ValidationError(`«${key}» باید عدد باشد`, key);
        let x = spec.type === 'integer' ? Math.trunc(n) : n;
        if (spec.minimum !== undefined) x = Math.max(spec.minimum, x);
        if (spec.maximum !== undefined) x = Math.min(spec.maximum, x);
        out[key] = x;
        break;
      }
      case 'boolean':
        out[key] = typeof v === 'boolean' ? v : /^(1|true|yes|on)$/i.test(String(v));
        break;
      case 'array': {
        if (!Array.isArray(v)) throw new ValidationError(`«${key}» باید فهرست باشد`, key);
        const max = spec.maxItems || 20;
        out[key] = v.slice(0, max).map(item =>
          spec.items?.type === 'string' ? String(item).trim().slice(0, spec.items.maxLength || 200) : item);
        break;
      }
      default:
        // نوعِ ناشناخته → عمداً نمی‌پذیریم. سکوت بهتر از عبور دادنِ چیزِ نامعلوم است.
        break;
    }
  }

  return out;
}

/** خواندنِ بدنهٔ JSON با سقفِ اندازه — جلوی بدنهٔ غول‌پیکر را می‌گیرد */
export function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new ValidationError('بدنهٔ درخواست بیش از حد بزرگ است'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ValidationError('بدنهٔ درخواست JSON معتبر نیست')); }
    });
    req.on('error', reject);
  });
}
