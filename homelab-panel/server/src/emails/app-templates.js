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
export const SAMPLE = '482916';

/**
 * کدام قالب؟ «فروشگاه» ⇒ قالبِ دکان؛ هر چیزِ دیگر (پمپ، مرکز فرمان، برنامهٔ
 * مدیر) ⇒ قالبِ «ویلن»، که نامِ خودِ سامانه است.
 */
export function appOf(app) {
  return /^(shop|store|dokan|tohid)/i.test(String(app || '')) ? 'shop' : 'pump';
}

const cache = new Map();
function raw(app) {
  const key = appOf(app);
  if (!cache.has(key)) {
    let text = null;
    try { text = fs.readFileSync(path.join(DIR, FILES[key]), 'utf8'); } catch { text = null; }
    cache.set(key, text);
  }
  return cache.get(key);
}

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

/** نامهٔ کد با قالبِ همان برنامه، یا `null` اگر قالب یا نشانه‌اش نبود. */
export function codeHtml({ app, code } = {}) {
  const digits = String(code ?? '').replace(/\D/g, '');
  if (digits.length !== 6) return null;
  const key = appOf(app);
  let html = raw(key);
  if (html === null) return null;
  if (key === 'pump') {
    html = once(html, `<div class="code" id="code" dir="ltr">${SAMPLE}</div>`,
      `<div class="code" id="code" dir="ltr">${digits}</div>`);
  } else {
    const spans = (s) => s.split('').map((d) => `<span>${d}</span>`).join('');
    html = once(html, spans(SAMPLE), spans(digits));
  }
  return html === null ? null : preheader() + html;
}
