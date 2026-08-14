// ═══════════════════════════════════════════════════════════════════════════
//  پالایشِ اسرار — روی ورودی، خروجی، حافظه و لاگ
//
//  دو جهت دارد و هر دو لازم است:
//    • ورودی  → کاربر ممکن است ناخواسته رمزش را در سؤال بچسباند؛ نباید در لاگ
//               یا در حافظه یا در درخواستِ مدل بنشیند.
//    • خروجی  → اگر به هر دلیلی رشته‌ای شبیهِ توکن از سندی بیرون آمد، به کاربر نرسد.
//
//  اصل: این «آخرین تور» است، نه اولین دفاع. اولین دفاع این است که اصلاً رمزی
//  داخلِ Knowledge Base نگذاریم.
// ═══════════════════════════════════════════════════════════════════════════

const RULES = [
  // توکنِ داخلیِ خودِ برنامه و هم‌شکل‌هایش (hex بلند)
  { name: 'hex-token', re: /\b[0-9a-f]{28,}\b/gi },
  // JWT
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // کلیدهای معروفِ سرویس‌ها
  { name: 'api-key', re: /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'gh-token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  // «کلید: مقدار» — چه فارسی چه انگلیسی
  //
  // ⚠️ چرا \b به کار نرفته: در جاوااسکریپت \b بر پایهٔ \w = [A-Za-z0-9_] است، پس
  //    کنارِ حرفِ فارسی هیچ‌وقت «مرزِ کلمه» تشخیص نمی‌دهد و /\bرمز\b/ روی
  //    «رمز: ۱۲۳» اصلاً نمی‌گیرد. با lookaround یونیکدی هر دو زبان درست کار می‌کنند.
  //    \p{M} هم در lookahead هست تا «کلیدِ» و «رمزِ» (با کسره) برچسب حساب نشوند —
  //    آن‌ها متنِ عادی‌اند، نه «برچسبِ رمز».
  //
  // بینِ برچسب و دونقطه تا ۲۴ نویسه جا داده شده تا «رمز من: ...» هم گرفته شود.
  {
    name: 'labelled-secret',
    re: /(?<![\p{L}\p{N}_])(password|passwd|secret|token|api[_-]?key|apikey|credential|رمز|گذرواژه|کلید|توکن)(?![\p{L}\p{N}_\p{M}])[^\n:=]{0,24}?[:=]\s*["']?([^\s"',;]{6,})/giu,
    replace: (m, label) => `${label}: ⟪پنهان⟫`,
  },
  // رشتهٔ اتصالِ دیتابیس
  { name: 'db-url', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^\s]+/gi },
  // user:pass@host داخلِ هر URL
  { name: 'url-credentials', re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, replace: (m, scheme) => `${scheme}⟪پنهان⟫@` },
];

export const REDACTED = '⟪پنهان⟫';

/**
 * متن را پالایش می‌کند.
 * @param {string} text
 * @returns {{text: string, hits: string[]}} متنِ پاک‌شده و نامِ قاعده‌هایی که خورد
 */
export function redact(text) {
  if (typeof text !== 'string' || !text) return { text: text ?? '', hits: [] };
  let out = text;
  const hits = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    if (!rule.re.test(out)) continue;
    hits.push(rule.name);
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, rule.replace || REDACTED);
  }
  return { text: out, hits };
}

/** فقط متنِ پاک‌شده */
export function redactText(text) {
  return redact(text).text;
}

/** آیا متن رَدِ رازی دارد؟ (برای اینکه چیزی وارد حافظه نشود) */
export function containsSecret(text) {
  return redact(text).hits.length > 0;
}

/** پالایشِ بازگشتیِ یک شیء — برای لاگ و برای آرگومان‌های ابزار */
export function redactDeep(value, depth = 0) {
  if (depth > 6) return '⟪عمیق⟫';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(v => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // نامِ کلید هم می‌تواند خودش افشاگر باشد
      if (/^(password|pass|secret|token|apikey|api_key|auth|credential|رمز|توکن)$/i.test(k)) out[k] = REDACTED;
      else out[k] = redactDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}
