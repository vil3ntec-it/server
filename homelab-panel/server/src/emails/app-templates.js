// ---------------------------------------------------------------------------
//  ایمیلِ کد با قالبِ خودِ صاحبِ سامانه — برای «ساختِ کد و فرستادن»ِ پنل
//
//  ⛔ گزارشِ صاحب سامانه (۱۴۰۵/۰۷/۱۳، عکسِ جیمیل): «آن دو سایتِ ایمیل که دادم
//  چرا کار گرفته نمی‌شوند و هنوز قدیمی‌ترین مدل است؟» قالب‌ها فقط در سرورِ
//  حساب (`shop` ⇒ `lib/mail-templates`) نشسته بودند؛ دکمهٔ «ساختِ کد و
//  فرستادن»ِ همین پنل از موتورِ کدِ خودِ پنل می‌رود و هنوز قالبِ قدیمیِ
//  `otp.js` را می‌فرستاد — با کد در عنوان و در پیش‌نمایش.
//
//  ⚠️ `templates/*.html` **بایت‌به‌بایت** همان دو فایلِ `shop` است (آزمون هشِ
//  هر دو را می‌سنجد). منطقِ جاگذاری هم همان است: فقط شش رقمِ نمونه، و یک
//  خطِ پیش‌نمایشِ پنهانِ بی‌کد سرِ نامه. هیچ رنگ، قلم یا نوشته‌ای عوض
//  نمی‌شود. اگر یکی را عوض کردید، دیگری را هم.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
export const FILES = Object.freeze({ pump: 'pump-code.html', shop: 'shop-code.html' });
/*
 *  ⛔ **نسخهٔ فرستادنی** (گزارشِ صاحبِ سامانه با عکسِ جیمیل، ۱۴۰۵/۰۷/۱۳: «اصلاً
 *  ظاهرش رو دیدی؟»). فایلِ او صفحهٔ وب است و جیمیل برگهٔ سبک، متغیرِ CSS،
 *  فلکس و گرید، SVG و اسکریپت را دور می‌ریزد؛ نامه متنِ خام می‌رسید. فایلِ او
 *  مرجع می‌ماند و نامه از نسخهٔ جدولی با سبکِ درون‌خطی می‌رود (نوشته‌ها
 *  واژه‌به‌واژه همان — آزمون می‌سنجد)، و شکل‌ها PNGِ همان SVGها با `cid:`.
 *  ⚠️ این‌ها هم بایت‌به‌بایت همان فایل‌های `shop` هستند.
 */
export const EMAIL_FILES = Object.freeze({ pump: 'pump-code.email.html', shop: 'shop-code.email.html' });
export const SAMPLE = '482916';

/**
 * کدام قالب؟ «فروشگاه» ⇒ قالبِ دکان؛ هر چیزِ دیگر (پمپ، مرکز فرمان، برنامهٔ
 * مدیر) ⇒ قالبِ «ویلن»، که نامِ خودِ سامانه است.
 */
export function appOf(app) {
  return /^(shop|store|dokan|tohid)/i.test(String(app || '')) ? 'shop' : 'pump';
}

const cache = new Map();
function read(file) {
  if (!cache.has(file)) {
    let text = null;
    try { text = fs.readFileSync(path.join(DIR, file), 'utf8'); } catch { text = null; }
    cache.set(file, text);
  }
  return cache.get(file);
}
function raw(app) { return read(FILES[appOf(app)]); }
function rawEmail(app) { return read(EMAIL_FILES[appOf(app)]); }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const PREVIEW = 'کدِ شما آماده است — برای دیدنش همین ایمیل را باز کنید.';
export function preheader(line = PREVIEW) {
  return '<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;'
    + 'mso-hide:all;font-size:1px;line-height:1px;color:transparent">'
    + `${esc(line)}${'&#847;&zwnj;&nbsp;'.repeat(90)}</div>\n`;
}

/** عنوانِ ایمیل = `<title>`ِ خودِ فایل. ⛔ بی کد — عنوان در اعلان دیده می‌شود. */
export function titleOf(app) {
  const m = /<title>([^<]*)<\/title>/.exec(raw(app) || '');
  return m ? m[1].trim() : '';
}

/** نامِ فرستنده — همان عنوان بی «کد ورود». */
export function brandOf(app) {
  return titleOf(app).replace(/^کد\s*ورود\s*/, '').trim();
}

function once(text, from, to) {
  if (text === null) return null;
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + 1) >= 0) return null;
  return text.slice(0, i) + to + text.slice(i + from.length);
}

/** خطِ پیش‌نمایش درست پس از `<body …>`. */
function withPreheader(html) {
  if (html === null) return null;
  const m = /<body[^>]*>/.exec(html);
  if (!m) return null;
  const at = m.index + m[0].length;
  return html.slice(0, at) + '\n' + preheader() + html.slice(at);
}

/** نامهٔ کد با قالبِ همان برنامه، یا `null` اگر قالب یا نشانه‌اش نبود. */
export function codeHtml({ app, code } = {}) {
  const digits = String(code ?? '').replace(/\D/g, '');
  if (digits.length !== 6) return null;
  const key = appOf(app);
  let html = rawEmail(key);
  if (html === null) return null;
  if (key === 'pump') {
    html = once(html, `">${SAMPLE}</div>`, `">${digits}</div>`);
  } else {
    const m = /<!--digits-->[^]*?<!--\/digits-->/.exec(html);
    if (!m) return null;
    let k = 0;
    const block = m[0].replace(/>(\d)<\/td>/g, () => `>${digits[k++]}</td>`);
    if (k !== 6) return null;
    html = html.slice(0, m.index) + block + html.slice(m.index + m[0].length);
  }
  return withPreheader(html);
}

/** پیوست‌های درون‌خطیِ نامه — هر `cid:<app>-<نام>@vill3n`، همان PNGِ کنارِ قالب. */
export function inlineParts(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || '').matchAll(/cid:(pump|shop)-([a-z0-9]+)@vill3n/g)) {
    const cid = `${m[1]}-${m[2]}@vill3n`;
    if (seen.has(cid)) continue;
    seen.add(cid);
    try {
      out.push({ cid, filename: `${m[2]}.png`, contentType: 'image/png',
        data: fs.readFileSync(path.join(DIR, `${m[1]}-img`, `${m[2]}.png`)) });
    } catch { /* نیست ⇒ بی تصویر */ }
  }
  return out;
}
