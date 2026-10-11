'use strict';
// نشانه‌های خطی سایت (۲۴×۲۴). یک‌جا تعریف شده‌اند تا سایت عمومی و پنل مالک هر دو از همین‌ها استفاده کنند.
// PICK: نشانه‌هایی که مالک می‌تواند در پنل برای کادرها و ویژگی‌ها انتخاب کند (کلید → نام فارسی).

const ICONS = {
  download: '<path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 19h16"/>',
  back: '<path d="M9 6l6 6-6 6"/>',
  go: '<path d="M15 6l-6 6 6 6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  out: '<path d="M8 7h9v9M17 7 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.2A8.5 8.5 0 1 1 21 11.5z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-3 3 2.5 2.5M14 9l2 2"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  offline: '<path d="M2.5 9a15 15 0 0 1 4-2.8M21.500 9a15 15 0 0 0-9-4.300M6 12.800a9.500 9.500 0 0 1 3-2M18 12.800a9.500 9.500 0 0 0-3.500-2.200M9.300 16.300a4.500 4.500 0 0 1 5.400 0"/><circle cx="12" cy="19.5" r=".9" fill="currentColor"/><path d="m3 3 18 18"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
  wallet: '<path d="M4 7.500V6a2 2 0 0 1 2-2h11v3.500"/><rect x="3" y="7.500" width="18" height="12.500" rx="2"/><path d="M16 13.800h2"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.700 2.700 3 6 3M3 12v5c0 1.700 2.700 3 6 3"/><ellipse cx="16" cy="14.500" rx="5" ry="2.500"/><path d="M11 14.500v4c0 1.400 2.200 2.500 5 2.500s5-1.100 5-2.500v-4"/>',
  exchange: '<path d="M4 8h15l-3.500-3.500M20 16H5l3.500 3.500"/>',
  chart: '<path d="M4 4v16h16M8.500 16v-4M12.500 16V8M16.500 16v-6"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="m12 17 4-6"/><circle cx="12" cy="17" r="1" fill="currentColor"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
  printer: '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><rect x="7" y="14" width="10" height="7" rx="1"/>',
  users: '<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 4.800a3.500 3.500 0 0 1 0 6.400M18 14.300a6.500 6.500 0 0 1 3.500 5.700"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  cloud: '<path d="M7 18.500a4.500 4.500 0 0 1-.6-9A6 6 0 0 1 18 11a3.800 3.800 0 0 1-.5 7.500z"/>',
  sync: '<path d="M4 12a8 8 0 0 1 13.700-5.600L20 8.500M20 4v4.500h-4.500M20 12a8 8 0 0 1-13.700 5.600L4 15.500M4 20v-4.500h4.500"/>',
  database: '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.700 3.600 3 8 3s8-1.300 8-3V6M4 12v6c0 1.700 3.600 3 8 3s8-1.300 8-3v-6"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.500h.01M7 16.500h.01"/>',
  mobile: '<rect x="7" y="2.500" width="10" height="19" rx="2.500"/><path d="M11 18.300h2"/>',
  desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.500 5l-3 14"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.500-3.500"/>',
  star: '<path d="m12 3 2.700 5.600 6.100.8-4.500 4.300 1.100 6.100-5.400-3-5.400 3 1.100-6.100-4.500-4.300 6.100-.8z"/>',
  heart: '<path d="M12 20s-7-4.300-7-10a4 4 0 0 1 7-2.600A4 4 0 0 1 19 10c0 5.700-7 10-7 10z"/>',
  spark: '<path d="M12 3l1.800 4.700 4.700 1.800-4.700 1.800L12 16l-1.800-4.700-4.700-1.800 4.700-1.800z"/><path d="m19 15 .8 2.200L22 18l-2.200.8L19 21l-.8-2.200L16 18l2.200-.8z"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20.500a2 2 0 0 0 4 0"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.500" cy="8.500" r="1.300"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.500" y="13" width="4" height="6" rx="1.500"/><rect x="17.500" y="13" width="4" height="6" rx="1.500"/><path d="M19.500 19c0 1.700-2 2.500-5 2.500"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M6.500 7h5v4h-5z"/><path d="M14 9h1.500a2 2 0 0 1 2 2v5.500a1.500 1.500 0 0 0 3 0V8l-3-3"/>',
  dumbbell: '<path d="M6 7.500v9M3.500 10v4M18 7.500v9M20.500 10v4M6 12h12"/>',
  eye: '<path d="M2 12s3.600-7 10-7 10 7 10 7-3.600 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.500" cy="9.500" r="1.500"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  play: '<path d="M7 4.500v15l12-7.500z"/>',
  pause: '<path d="M8.500 5v14M15.500 5v14"/>',
};

// نشانه‌های قابل‌انتخاب در پنل
const PICK = {
  bolt: 'سرعت', shield: 'امنیت', lock: 'قفل', offline: 'بدون اینترنت', globe: 'جهان و زبان', wallet: 'کیف پول', coins: 'پول و سکه',
  exchange: 'تبادله', chart: 'نمودار', trend: 'رشد', gauge: 'سنجه', box: 'جنس و انبار', receipt: 'رسید و فاکتور', file: 'سند',
  printer: 'چاپ', users: 'مشتری‌ها', user: 'کاربر', clock: 'زمان', calendar: 'تاریخ', cloud: 'ابر', sync: 'همگام‌سازی',
  database: 'داده', server: 'سرور', mobile: 'موبایل', desktop: 'کمپیوتر', code: 'کد', layers: 'لایه‌ها', search: 'جست‌وجو',
  star: 'ستاره', heart: 'قلب', spark: 'درخشش', bell: 'اعلان', tag: 'قیمت و تخفیف', headset: 'پشتیبانی', fuel: 'پمپ تیل',
  dumbbell: 'ورزش', eye: 'دیدن', key: 'کلید', chat: 'گفت‌وگو', phone: 'تماس', mail: 'ایمیل', check: 'تأیید', download: 'دانلود', image: 'تصویر',
};

function icon(name, cls = '') {
  return `<svg class="ic${cls ? ` ${cls}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

module.exports = { ICONS, PICK, icon };
