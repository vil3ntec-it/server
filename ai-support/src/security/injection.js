// ═══════════════════════════════════════════════════════════════════════════
//  دفاع در برابر Prompt Injection
//
//  سه لایه داریم و این فایل لایهٔ دوم است. لایهٔ اول جدا کردنِ داده از دستور
//  است (پاکتِ DOCUMENT در prompt.js) و لایهٔ سوم — که مهم‌ترین است — این‌که
//  ابزارِ خطرناکی اصلاً وجود ندارد.
//
//  چرا این لایه به تنهایی کافی نیست: هیچ فهرستی از الگوها کامل نمی‌شود. کسی
//  می‌تواند همان دستور را با کلماتِ دیگر بنویسد. پس این‌جا فقط «هزینهٔ حمله را
//  بالا می‌بریم و ردش را ثبت می‌کنیم»؛ امنیتِ واقعی از نبودِ قدرت می‌آید.
// ═══════════════════════════════════════════════════════════════════════════

const PATTERNS = [
  // انگلیسی
  /ignore\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /disregard\s+(all\s+|the\s+)?(previous|prior|above|safety|security)/i,
  /you\s+are\s+now\s+(an?\s+)?(admin|administrator|root|developer|dan)\b/i,
  /(forget|override|bypass)\s+(your\s+)?(rules|instructions|restrictions|guardrails|system\s+prompt)/i,
  /\b(system|developer)\s*(prompt|message)\s*[:=]/i,
  /reveal\s+(your\s+)?(system\s+prompt|instructions|api\s*key|token|secret)/i,
  /\b(execute|run)\s+(this\s+)?(command|shell|bash|powershell|cmd)\b/i,
  /\b(drop|delete|truncate)\s+(the\s+)?(database|table|all\s+data)\b/i,
  /<\s*\/?\s*(system|assistant|instructions?)\s*>/i,

  // فارسی
  /(همهٔ?|تمام(ِ|ی)?)\s*(محدودیت|قانون|قواعد|دستور)(ها|های)?\s*(قبلی\s*)?را\s*(نادیده|فراموش|رها)/,
  /دستور(ات|های)?\s*(قبلی|بالا|پیشین)\s*را\s*(نادیده|فراموش)/,
  /تو\s*(حالا|از\s*این\s*به\s*بعد)\s*(مدیر|ادمین|روت|توسعه‌?دهنده)/,
  /(دیتابیس|پایگاه\s*داده|اطلاعات)\s*را\s*(پاک|حذف|خالی)\s*کن/,
  /(رمز|توکن|کلید|راز)(ِ|\s*)(سرور|سیستم|برنامه|ادمین)?\s*را\s*(بگو|نشان|چاپ|فاش)/,
  /سطح\s*ِ?\s*(دسترسی|کاربر)\s*(من\s*)?(را\s*)?(بالا|تغییر|عوض|ارتقا)/,
];

/** الگوهایی که فقط «مشکوک»اند و به تنهایی حمله نیستند */
const SOFT_PATTERNS = [
  /```[\s\S]{0,40}(system|instruction)/i,
  /\[\s*(SYSTEM|INST|ADMIN)\s*\]/i,
];

/**
 * متنِ بازیابی‌شده (یا هر متنِ نامعتمدِ دیگر) را بررسی و بی‌اثر می‌کند.
 *
 * «بی‌اثر کردن» یعنی جملهٔ دستوری را با یک نشانهٔ آشکار جایگزین می‌کنیم — نه
 * اینکه بی‌سروصدا پاکش کنیم. اگر روزی سندِ سالمی اشتباهی گیر افتاد، در خودِ
 * جوابْ دیده می‌شود و می‌شود درستش کرد.
 *
 * @param {string} text
 * @returns {{text: string, flagged: boolean, matches: string[]}}
 */
export function sanitizeUntrusted(text) {
  if (typeof text !== 'string' || !text) return { text: text ?? '', flagged: false, matches: [] };
  let out = text;
  const matches = [];

  for (const re of PATTERNS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    if (!g.test(out)) continue;
    matches.push(re.source.slice(0, 60));
    g.lastIndex = 0;
    out = out.replace(g, '⟪دستورِ حذف‌شده در متنِ سند⟫');
  }
  for (const re of SOFT_PATTERNS) {
    if (re.test(out)) matches.push('soft:' + re.source.slice(0, 40));
  }

  // نشانه‌های ساختاریِ گفت‌وگو داخلِ داده نباید عبور کند — وگرنه می‌تواند وانمود
  // کند پیامِ جدیدی از طرفِ سیستم است
  out = out
    .replace(/<\|[^|>]{0,40}\|>/g, '⟪⟫')
    .replace(/^\s*(system|assistant|user)\s*:/gim, '·$1:');

  return { text: out, flagged: matches.length > 0, matches };
}

/**
 * پرسشِ خودِ کاربر را بررسی می‌کند.
 * تفاوتش با بالا: پرسشِ کاربر را **پاک نمی‌کنیم** (شاید واقعاً دربارهٔ همین
 * موضوع می‌پرسد، مثلاً «آیا می‌توانی دیتابیس را پاک کنی؟» یک سؤالِ مشروع است).
 * فقط علامت می‌زنیم تا در prompt یادآوری شود و در audit ثبت شود.
 */
export function inspectUserInput(text) {
  const matches = [];
  for (const re of PATTERNS) if (re.test(String(text || ''))) matches.push(re.source.slice(0, 60));
  return { flagged: matches.length > 0, matches };
}

/** بستنِ متنِ نامعتمد در پاکتِ داده */
export function wrapAsData(label, text) {
  const clean = sanitizeUntrusted(text).text;
  return `<<<DOCUMENT ${label}>>>\n${clean}\n<<<END ${label}>>>`;
}
