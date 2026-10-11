'use strict';
// رابطِ زندهٔ نمایشی داخل قاب دستگاه — تا وقتی مالک تصویر واقعی برنامه را نگذاشته، به‌جای قاب خالی دیده می‌شود.
// فقط HTML و CSS است (بدون تصویر و بدون کتابخانه)، با رنگ‌های همان برنامه. عددها نمونه‌اند و «aria-hidden» دارند.
const { esc } = require('./core/util');

const dayFmt = new Intl.DateTimeFormat('fa-AF-u-ca-persian', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kabul' });
const today = () => dayFmt.format(new Date());

// صحنهٔ هر برنامه → نوع رابط نمایشی
const KIND = { bars: 'shop', flow: 'fuel', pulse: 'fit', ticker: 'fx', dial: 'vault', code: 'dash', none: 'dash' };
const PHONE = new Set(['shop', 'fit']);

const rows = (list) => `<ul class="m-rows">${list.map(([a, b, c], i) => `<li style="--r:${i}"><span>${a}</span>${c ? `<em>${c}</em>` : ''}<b>${b}</b></li>`).join('')}</ul>`;
const bars = (hs) => `<div class="m-bars">${hs.map((h, i) => `<i style="--h:${h};--r:${i}"></i>`).join('')}</div>`;
const side = () => '<aside class="m-side"><i class="on"></i><i></i><i></i><i></i><i></i></aside>';
const tabs = () => '<div class="m-tabs"><i class="on"></i><i></i><i></i><i></i></div>';
const status = () => '<div class="m-status"><b>۹:۴۱</b><span></span></div>';

const UI = {
  shop: (name) => `${status()}
<div class="m-head"><span>${name}</span><small>فروش امروز</small></div>
<div class="m-big"><b data-tick="48250" data-step="350">۴۸٬۲۵۰</b><small>افغانی</small><em>۱۲٪ بیشتر از دیروز</em></div>
${bars([0.42, 0.6, 0.38, 0.74, 0.55, 0.9, 0.68])}
<div class="m-tiles"><div><small>سود امروز</small><b>۹٬۶۰۰</b></div><div><small>ارزش انبار</small><b>۳۱۲ قلم</b></div></div>
${rows([['فاکتور ۱۰۲۴', '۱٬۲۵۰'], ['فاکتور ۱۰۲۳', '۸۶۰'], ['قرض مشتری', '۳٬۴۰۰', 'باقی']])}
${tabs()}`,

  fit: (name) => `${status()}
<div class="m-head"><span>${name}</span><small>عضوهای فعال</small></div>
<div class="m-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="50"/><circle class="arc" cx="60" cy="60" r="50" pathLength="100"/></svg><b>۸۶</b><small>از ۱۱۰ عضو</small></div>
<div class="m-pulse"><svg viewBox="0 0 240 60" preserveAspectRatio="none" aria-hidden="true"><path pathLength="100" d="M0 34h46l8-9 9 20 11-38 12 44 9-17h34l8-9 9 20 11-38 12 44 9-17h62"/></svg></div>
<div class="m-tiles"><div><small>اشتراک‌های رو به پایان</small><b>۷</b></div><div><small>برنامهٔ تمرین</small><b>۲۴</b></div></div>
${rows([['عضو تازه', 'سه‌ماهه', 'فعال'], ['تمدید', 'ماهانه', 'امروز']])}
${tabs()}`,

  fuel: (name) => `${side()}
<div class="m-main">
  <div class="m-head"><span>${name}</span><small>ورق روزانه، ${esc(today())}</small></div>
  <div class="m-tanks">
    <div class="tank"><i style="--lv:.72"></i><b>دیزل</b><small>۷۲٪</small></div>
    <div class="tank is-b"><i style="--lv:.46"></i><b>پطرول</b><small>۴۶٪</small></div>
    <div class="m-kpi"><small>گاوصندوق</small><b dir="ltr">$ ۱۲٬۴۰۰</b><small>۸۶۵٬۰۰۰ افغانی</small></div>
  </div>
  ${rows([['شرکت نمونه', '۴۲٬۰۰۰', 'دیزل'], ['قرض‌دار نمونه', '۱۸٬۵۰۰', 'پطرول'], ['صرافی', '$ ۲٬۱۰۰', 'رسید']])}
</div>`,

  fx: (name) => `${side()}
<div class="m-main">
  <div class="m-head"><span>${name}</span><small>نرخ اسعار، ${esc(today())}</small></div>
  <ul class="m-fx">
    <li><span>دالر</span><i class="up"></i><b data-tick="70.5" data-step="0.05" data-fix="2">۷۰٫۵۰</b><b data-tick="70.8" data-step="0.05" data-fix="2">۷۰٫۸۰</b></li>
    <li><span>یورو</span><i class="up"></i><b data-tick="76.2" data-step="0.06" data-fix="2">۷۶٫۲۰</b><b data-tick="76.7" data-step="0.06" data-fix="2">۷۶٫۷۰</b></li>
    <li><span>کلدار</span><i></i><b data-tick="0.25" data-step="0.002" data-fix="3">۰٫۲۵۰</b><b data-tick="0.254" data-step="0.002" data-fix="3">۰٫۲۵۴</b></li>
    <li><span>درهم</span><i class="up"></i><b data-tick="19.2" data-step="0.02" data-fix="2">۱۹٫۲۰</b><b data-tick="19.3" data-step="0.02" data-fix="2">۱۹٫۳۰</b></li>
  </ul>
  <div class="m-deal"><div><small>خرید</small><b dir="ltr">$ ۵٬۰۰۰</b></div><span></span><div><small>پرداخت</small><b>۳۵۲٬۵۰۰</b></div><em>ثبت در دفتر کل</em></div>
</div>`,

  vault: (name) => `${side()}
<div class="m-main">
  <div class="m-head"><span>${name}</span><small>قفل با رمز اصلی</small></div>
  <ul class="m-sites">
    <li style="--r:0"><i></i><span dir="ltr">vill3n.top</span><em>دامنه</em><b>••••••••</b></li>
    <li style="--r:1"><i></i><span dir="ltr">home-server</span><em>سرور</em><b>••••••••</b></li>
    <li style="--r:2"><i class="warn"></i><span dir="ltr">shop.example</span><em>سایت</em><b>••••••••</b></li>
  </ul>
  <div class="m-safe"><span dir="ltr">AES-256-GCM</span><div><i></i></div><small>پشتیبان رمزگذاری‌شده</small></div>
</div>`,

  dash: (name) => `${side()}
<div class="m-main">
  <div class="m-head"><span>${name}</span><small>${esc(today())}</small></div>
  <div class="m-tiles is-3"><div><small>امروز</small><b>۱۲۸</b></div><div><small>این ماه</small><b>۳٬۴۲۰</b></div><div><small>فعال</small><b>۹۶٪</b></div></div>
  ${bars([0.5, 0.72, 0.44, 0.86, 0.62, 0.94, 0.7, 0.8])}
  ${rows([['سطر نمونه', '۱٬۲۵۰'], ['سطر نمونه', '۸۶۰']])}
</div>`,
};

function mockKind(app) { return KIND[app.scene] || 'dash'; }
function mockIsPhone(app) { return PHONE.has(mockKind(app)); }
function mock(app) {
  const kind = mockKind(app);
  return `<div class="mock k-${kind}${PHONE.has(kind) ? ' m-phone' : ' m-wide'}">${UI[kind](esc(app.name))}<i class="m-demo">نمونهٔ نمایشی</i></div>`;
}

module.exports = { mock, mockKind, mockIsPhone };
