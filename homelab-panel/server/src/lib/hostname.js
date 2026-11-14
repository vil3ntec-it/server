// ---------------------------------------------------------------------------
//  «چند دامنه برای هر برنامه» (۱.۵۰.۹۹) — سنجشِ یک نامِ میزبان، خالص و بی وابستگی
//
//  ⛔ هر نامی که صاحب‌کار برای یک برنامه/سایت می‌نویسد پیش از دیتابیس، ingress ِ تونل (‎config.yml‎) و
//     ‎PUBLIC_BASE_URLS‎ ِ سرورِ حساب از همین‌جا می‌گذرد. ‎config.yml‎ خط‌به‌خط نوشته می‌شود ⇒ یک «\n» یا «:» یا
//     فاصله در نام یعنی تزریقِ قاعدهٔ ingress؛ پس فقط حرف/عدد/خط‌تیره/نقطه، به شکلِ ASCII.
//  • چسباندن از نوارِ مرورگر پذیرفته است: ‎https://Shop.Example.com/‎ ⇐ ‎shop.example.com‎ (فقط ‎http(s)://‎ و مسیرِ پشتش).
//  • ⛔ رد: ستاره (هر جا — قاعدهٔ ‎*.x‎ همهٔ نام‌های برنامه‌های دیگرِ همان دامنه را می‌قاپد)، پورت، ‎user@‎، ‎%‎، فاصله و
//    نویسهٔ کنترلی، IP (۴ و ۶)، نامِ تک‌برچسبی (‎localhost‎)، پسوندهای درونی (‎.local‎، ‎.internal‎، ‎.localhost‎، ‎.arpa‎ …)،
//    دامنه‌های خودِ Cloudflare برای تونلِ سریع (‎trycloudflare.com‎، ‎cfargotunnel.com‎)، برچسبِ بیش از ۶۳ و نامِ بیش از
//    ۲۵۳ نویسه، خط‌تیرهٔ آغاز/پایانِ برچسب، ‎ab--‎ ِ رزرو (جز ‎xn--‎)، پسوندِ تمام‌عددی.
//  • نامِ یونیکدی (فارسی، …) به punycode ‎(xn--)‎ برگردانده می‌شود؛ ‎xn--‎ ِ نادرست (رفت‌وبرگشت نمی‌خواند) رد؛ برچسبی که
//    خط‌های گوناگون را قاطی کند (‎аpple‎ = سیریلیک + لاتین) رد — همان ترفندِ «نامِ هم‌شکل»؛ ایموجی و نماد رد.
//  ⛔ این فایل هیچ چیزی از پنل import نمی‌کند — آزمون (test/app-domains.mjs) آن را مستقیم می‌سنجد.
// ---------------------------------------------------------------------------
import { domainToASCII, domainToUnicode } from 'node:url';

export const MAX_HOSTNAME = 253;
export const MAX_LABEL = 63;

/** پسوندهایی که هرگز نامِ عمومیِ یک برنامه نیستند (RFC 6761/6762/8375 و نام‌های درونیِ رایج) */
const RESERVED_SUFFIXES = ['localhost', 'local', 'internal', 'intranet', 'lan', 'home.arpa', 'arpa', 'invalid', 'onion', 'corp', 'localdomain'];
/** دامنه‌هایی که مالِ خودِ Cloudflare است (تونلِ سریع/نشانیِ درونیِ تونل) */
const PROVIDER_SUFFIXES = ['trycloudflare.com', 'cfargotunnel.com'];

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Arabic', 'Hebrew', 'Armenian', 'Georgian', 'Devanagari', 'Thai', 'Hangul', 'Han', 'Hiragana', 'Katakana'];
const SCRIPT_RES = SCRIPTS.map((s) => [s, new RegExp(`\\p{Script=${s}}`, 'u')]);
const CJK = new Set(['Han', 'Hiragana', 'Katakana']);

//  نویسهٔ کنترلی، فاصله‌ها و نویسه‌های نامرئی/جهت‌دار (‎U+0000–0020، 007F–00A0، 1680، 2000–200F، 2028–202F، 205F–2064، 3000، FEFF‎)
const INVISIBLE = new RegExp('[' + [[0x00, 0x20], [0x7f, 0xa0], [0x1680, 0x1680], [0x2000, 0x200f], [0x2028, 0x202f], [0x205f, 0x2064], [0x3000, 0x3000], [0xfeff, 0xfeff]]
  .map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join('') + ']', 'u');
const fail = (reason, message) => ({ ok: false, error: 'invalid_hostname', reason, message });

function scriptsOf(label) {
  const found = new Set();
  for (const ch of label) {
    if (!/\p{L}/u.test(ch)) continue;
    let s = 'Other';
    for (const [name, re] of SCRIPT_RES) if (re.test(ch)) { s = name; break; }
    found.add(s);
  }
  return found;
}

/**
 * @param {unknown} raw  آن‌چه صاحب‌کار نوشت
 * @returns {{ ok: true, hostname: string, display: string, idn: boolean } | { ok: false, error: 'invalid_hostname', reason: string, message: string }}
 *   `hostname`: شکلِ ASCII (‎xn--‎) که در دیتابیس/ingress می‌نشیند؛ `display`: شکلِ خواندنی برای صفحه.
 */
export function parseHostname(raw) {
  if (typeof raw !== 'string') return fail('empty', 'نامِ میزبان را بنویسید.');
  if (raw.length > 400) return fail('too_long', 'این نام بیش از اندازه بلند است.');
  let s = raw.trim();
  if (!s) return fail('empty', 'نامِ میزبان را بنویسید.');
  //  ⛔ نویسهٔ کنترلی/فاصله پیش از هر تمیزکاری — «\n» در config.yml یعنی قاعدهٔ دیگر
  if (INVISIBLE.test(s)) return fail('bad_chars', 'فاصله یا نویسهٔ نامرئی در نام هست.');
  s = s.replace(/^https?:\/\//i, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return fail('bad_scheme', 'فقط نامِ میزبان یا نشانیِ http(s).');
  s = s.replace(/[/?#].*$/s, '');
  if (s.includes('@')) return fail('userinfo', 'نام با «@» (نام‌کاربری در نشانی) پذیرفته نیست.');
  if (s.includes('*')) return fail('wildcard', 'نامِ ستاره‌دار (‎*.‎) پذیرفته نیست — هر نام را جدا بنویسید.');
  if (s.startsWith('[') || (s.match(/:/g) || []).length > 1) return fail('ip_address', 'نشانیِ IP نامِ میزبان نیست.');
  if (s.includes(':')) return fail('port', 'پورت در نامِ میزبان نمی‌آید (همیشه ۴۴۳).');
  if (/[%\\'"<>`{}|^~!$&()+=,;[\]]/.test(s)) return fail('bad_chars', 'نویسهٔ نامجاز در نام هست.');
  if (s.endsWith('.')) s = s.slice(0, -1);
  if (!s) return fail('empty', 'نامِ میزبان را بنویسید.');
  if (s.startsWith('.') || s.includes('..')) return fail('bad_label', 'برچسبِ خالی (دو نقطهٔ پشتِ سرِ هم).');

  //  یونیکد ⇒ punycode (UTS-46)؛ خطا ⇒ رشتهٔ خالی
  const ascii = domainToASCII(s);
  if (!ascii) return fail('bad_punycode', 'این نام به punycode ِ درست برنمی‌گردد.');
  if (ascii.length > MAX_HOSTNAME) return fail('too_long', `نام بیش از ${MAX_HOSTNAME} نویسه است.`);
  if (/^[0-9.]+$/.test(ascii)) return fail('ip_address', 'نشانیِ IP نامِ میزبان نیست.');
  const labels = ascii.split('.');
  if (labels.length < 2) return fail('single_label', 'نامِ کامل بنویسید (مثلاً shop.example.com).');
  for (const label of labels) {
    if (!label) return fail('bad_label', 'برچسبِ خالی.');
    if (label.length > MAX_LABEL) return fail('label_too_long', `هر بخشِ نام حداکثر ${MAX_LABEL} نویسه.`);
    if (!LABEL_RE.test(label)) return fail('bad_label', `بخشِ «${label}» فقط حرف، عدد و خط‌تیره (نه در آغاز/پایان) دارد.`);
    if (label.slice(2, 4) === '--' && !label.startsWith('xn--')) return fail('bad_label', `بخشِ «${label}» شکلِ رزروشده دارد.`);
    if (label.startsWith('xn--')) {
      const uni = domainToUnicode(label);
      if (!uni || uni === label || domainToASCII(uni) !== label) return fail('bad_punycode', `بخشِ «${label}» punycode ِ درست نیست.`);
      if (!/^[\p{L}\p{M}\p{N}-]+$/u.test(uni) || uni.startsWith('-') || uni.endsWith('-')) return fail('bad_punycode', 'نام نماد یا ایموجی دارد.');
      const sc = scriptsOf(uni);
      const mixed = sc.size > 1 && ![...sc].every((x) => CJK.has(x));
      if (mixed) return fail('mixed_script', 'یک بخشِ نام خط‌های گوناگون را قاطی کرده (نامِ هم‌شکل) — پذیرفته نیست.');
    }
  }
  const tld = labels[labels.length - 1];
  if (/^[0-9]+$/.test(tld)) return fail('numeric_tld', 'پسوندِ تمام‌عددی پذیرفته نیست.');
  if (tld.length < 2) return fail('bad_label', 'پسوندِ دامنه دست‌کم دو نویسه.');
  for (const suf of RESERVED_SUFFIXES) {
    if (ascii === suf || ascii.endsWith(`.${suf}`)) return fail('reserved', `پسوندِ «.${suf}» نامِ درونی است و از اینترنت نمی‌رسد.`);
  }
  for (const suf of PROVIDER_SUFFIXES) {
    if (ascii === suf || ascii.endsWith(`.${suf}`)) return fail('reserved', `«${suf}» مالِ خودِ Cloudflare است (نشانیِ تونلِ سریع)، نه دامنهٔ شما.`);
  }
  const display = domainToUnicode(ascii) || ascii;
  return { ok: true, hostname: ascii, display, idn: display !== ascii };
}

/** فقط نام یا null — برای جاهایی که دلیل لازم نیست */
export function cleanHostname(raw) {
  const r = parseHostname(raw);
  return r.ok ? r.hostname : null;
}
