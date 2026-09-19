// ---------------------------------------------------------------------------
//  پالایشِ اسرار — روی هر چیزی که به مدل می‌رود و هر چیزی که از آن می‌آید
//
//  آخرین تور است، نه اولین دفاع: اولین دفاع این است که ابزارها اصلاً رمز
//  برنگردانند. ولی لاگِ یک سایت می‌تواند هر چیزی داشته باشد، و «چیزی که به
//  مدل رفت» فردا می‌تواند در جوابِ یک سؤالِ دیگر برگردد.
// ---------------------------------------------------------------------------
const RULES = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: 'gh-token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'api-key', re: /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'hex-token', re: /\b[0-9a-f]{32,}\b/gi },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._-]{16,}/g },
  //  «رمز: مقدار» — فارسی و انگلیسی؛ بی \b چون در فارسی مرزِ کلمه کار نمی‌کند
  { name: 'labelled', re: /((?<![\p{L}\p{M}])(?:رمز|گذرواژه|توکن|کلید|password|passwd|secret|token|api[_-]?key|authorization)[^\S\n]{0,24}[:=][^\S\n]*)([^\s"'`]{4,})/giu, keep: 1 },
];

/** متن را با اسرارِ پوشانده برمی‌گرداند */
export function redactText(input) {
  let s = String(input ?? '');
  for (const rule of RULES) {
    s = rule.keep
      ? s.replace(rule.re, (m, label) => `${label}[پنهان]`)
      : s.replace(rule.re, '[پنهان]');
  }
  return s;
}

/** روی هر رشته‌ای داخلِ یک شیء — برای خروجیِ ابزارها */
export function redactDeep(value, depth = 0) {
  if (depth > 8) return value;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (/(password|passwd|secret|token|api_?key|private)/i.test(k)) { out[k] = '[پنهان]'; continue; }
      out[k] = redactDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}
