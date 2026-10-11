'use strict';
// صفحه‌های عمومی سایت — روی سرور ساخته می‌شوند: سریع، قابل فهرست‌شدن در جست‌وجو و خوانا برای هوش مصنوعی،
// و بدون جاوااسکریپت هم کامل خوانده می‌شوند.
const { esc, num, faDate, bytes, jsonForHtml, faDigits } = require('./core/util');
const { PLATFORMS, SOURCE_LABEL } = require('./core/detect');
const { latestByPlatform, publishedVersions, planPrice } = require('./core/model');
const { fontFile } = require('./font');
const { icon, PICK } = require('./icons');
const { mock, mockIsPhone } = require('./mock');
const blocksMod = require('./blocks');
const { renderBlocks, faqFromBlocks, faqList, rich } = blocksMod;

// صفحهٔ برنامه‌ها وقتی نشانگر رویشان می‌رود از پیش آماده می‌شود (در مرورگرهایی که پشتیبانی می‌کنند)
const SPEC_RULES = '{"prerender":[{"where":{"href_matches":"/app/*"},"eagerness":"moderate"}]}';

const yearFmt = new Intl.DateTimeFormat('fa-AF-u-ca-persian', { year: 'numeric', timeZone: 'Asia/Kabul' });
function faYear() { return yearFmt.format(new Date()).replace(/[^۰-۹0-9]/g, ''); }

// برچسب فنی (نسخه، حجم، اثر انگشت) — فقط برای دادهٔ واقعی
function hud(text) { return `<bdi class="hud" dir="ltr">${esc(text)}</bdi>`; }
function money(n, s) { return n === 0 ? 'رایگان' : `${num(n)} ${esc(s.currency)}`; }
function base(env) { return env.settings.siteUrl.replace(/\/+$/, ''); }
const arr = (v) => (Array.isArray(v) ? v : []);
// در خروجی ایستا هر صفحه یک پوشه است؛ نشانی با «/» پایانی مستقیم باز می‌شود (بدون تغییر مسیر)
const appUrl = (env, slug) => `/app/${slug}${env.static ? '/' : ''}`;
const pageUrl = (env, slug) => `/p/${slug}${env.static ? '/' : ''}`;
const aiOn = (env) => !env.static && env.settings.allowAI !== false;
// واحد پول برای دادهٔ ساختاریافته (کد سه‌حرفی)؛ اگر شناخته نشود قیمت در آن‌جا نوشته نمی‌شود
const ISO_CURRENCY = { 'افغانی': 'AFN', 'afn': 'AFN', '؋': 'AFN', 'دالر': 'USD', 'دلار': 'USD', 'usd': 'USD', '$': 'USD', 'یورو': 'EUR', 'eur': 'EUR', 'تومان': 'IRR', 'ریال': 'IRR', 'کلدار': 'PKR', 'روپیه': 'PKR', 'درهم': 'AED' };
const isoCurrency = (s) => ISO_CURRENCY[String(s.currency || '').trim().toLowerCase()] || '';

function fontTags(a, preload) {
  const f = fontFile(a);
  if (!f) return '';
  const fmt = f.endsWith('.ttf') ? 'truetype' : 'woff2';
  return `${preload ? `<link rel="preload" href="${a.url(f)}" as="font" type="font/${fmt === 'woff2' ? 'woff2' : 'ttf'}" crossorigin>\n` : ''}<style>@font-face{font-family:"Vazirmatn";src:url("${a.url(f)}") format("${fmt}");font-weight:100 900;font-display:swap}</style>`;
}

// نام فایل در خروجی ایستا (هاست بدون Node)
function staticFile(app, v) { return `${app.slug}-${v.version}-${v.platform}.${v.ext}`.replace(/[^\w.-]/g, '_'); }
function dlLatest(env, app, v) { return env.static ? `/files/${staticFile(app, v)}` : `/download/${app.slug}?p=${v.platform}`; }
function dlExact(env, app, v) { return env.static ? `/files/${staticFile(app, v)}` : `/download/${app.slug}/${v.id}`; }
function waLink(s, text) {
  const n = String(s.whatsapp || '').replace(/\D/g, '');
  return n ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ''}` : (s.phone ? `tel:${s.phone}` : '#contact');
}
const ext = (href) => (/^https?:/i.test(href) ? ' target="_blank" rel="noopener"' : '');
function waOrder(env, app, plan) { return waLink(env.settings, `سلام، می‌خواهم اشتراک «${plan.name}» برنامهٔ «${app.name}» را سفارش بدهم.`); }

function monogram(name) {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  const first = w[0] || 'V';
  // نام لاتین: دو حرف اول واژه‌ها ؛ نام فارسی: فقط حرف اول (دو حرفِ چسبیده خوانا نیست)
  const latin = /^[A-Za-z0-9]/.test(first);
  const ch = Array.from(first);
  const pick = latin ? (w.length > 1 && /^[A-Za-z0-9]/.test(w[1]) ? first[0] + w[1][0] : first.slice(0, 2)) : ch[0];
  return esc(pick.toUpperCase());
}

function appIcon(app, cls = '', vt = true) {
  const name = vt ? ` style="view-transition-name:icon-${esc(app.slug)}"` : '';
  if (app.icon) return `<span class="app-icon ${cls}"${name}><img src="/media/${esc(app.icon)}" alt="" width="96" height="96" decoding="async"></span>`;
  return `<span class="app-icon mono ${cls}"${name} aria-hidden="true">${monogram(app.name)}</span>`;
}

// رنگ دکمهٔ اصلیِ هر برنامه: همان رنگ برنامه، با کمی تیره/روشن‌شدن فقط اگر برای خوانایی نوشته لازم باشد (نسبت ۴٫۵ به ۱)
function lum(rgb) { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
function cta(hex) {
  const n = parseInt(String(hex).slice(1), 16);
  let rgb = [n >> 16 & 255, n >> 8 & 255, n & 255];
  const dark = lum(rgb) > 0.19; // نوشتهٔ تیره روی رنگ روشن، و برعکس
  const inkL = dark ? 0.004 : 1;
  for (let i = 0; i < 24; i++) {
    const L = lum(rgb);
    const ratio = dark ? (L + 0.05) / (inkL + 0.05) : (inkL + 0.05) / (L + 0.05);
    if (ratio >= 4.6) break;
    rgb = rgb.map((v) => Math.round(dark ? v + (255 - v) * 0.06 : v * 0.94));
  }
  return { bg: '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join(''), on: dark ? '#0b0d12' : '#ffffff' };
}
function theme(app) {
  const color = /^#[0-9a-f]{6}$/i.test(app.color) ? app.color : '#3b6cff';
  const c = cta(color);
  return `--app:${esc(color)};--app2:${esc(/^#[0-9a-f]{6}$/i.test(app.color2) ? app.color2 : color)};--cta-app:${c.bg};--on-app:${c.on};--on-icon:${c.on}`;
}
function newest(app) { return Object.values(latestByPlatform(app)).sort((x, y) => String(y.publishedAt).localeCompare(String(x.publishedAt)))[0] || null; }
function cheapest(app) { return arr(app.plans).filter((p) => p.active).map((p) => planPrice(p)).sort((x, y) => x.final - y.final)[0] || null; }
function onSale(app) { return arr(app.plans).some((p) => p.active && planPrice(p).off > 0); }

// دستگاه عمودی (موبایل) یا افقی (پنجرهٔ دسکتاپ)؟ از اندازهٔ تصویر واقعی، وگرنه از پلتفرم، وگرنه از نوع برنامه
function isPhone(app) {
  const shot = arr(app.screenshots)[0];
  if (shot && shot.w && shot.h) return shot.h > shot.w;
  const by = latestByPlatform(app);
  if (by.android || by.ios) return true;
  if (Object.keys(by).length) return false;
  return mockIsPhone(app);
}
const dims = (im) => (Number(im.w) > 0 && Number(im.h) > 0 ? ` width="${Number(im.w)}" height="${Number(im.h)}"` : '');
// قاب دستگاه: تصویر واقعی برنامه اگر هست، وگرنه رابط زندهٔ نمایشی با رنگ‌های همان برنامه
function frame(app, { eager = false } = {}) {
  const shot = arr(app.screenshots)[0];
  const phone = isPhone(app);
  const screen = shot
    ? `<img src="/media/${esc(shot.file)}" alt=""${dims(shot)} decoding="async"${eager ? ' fetchpriority="high"' : ' loading="lazy"'}>`
    : mock(app);
  return { phone, html: `<div class="device-frame">${phone ? '<i class="device-notch"></i>' : '<div class="device-bar"><i></i><i></i><i></i></div>'}<div class="device-screen">${screen}</div></div>` };
}

// واژه‌های تیتر جدا می‌شوند تا یکی‌یکی بالا بیایند؛ متن کامل برای صفحه‌خوان در aria-label می‌ماند
function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).map((w, i) => `<span class="w" style="--w:${i}"><span>${esc(w)}</span></span>`).join(' ');
}

function layout(env, { title, description, path, body, appTheme, jsonLd = [], noindex, image, alternates = '', scene, cls = '' }) {
  const s = env.settings;
  const a = env.assets;
  const canonical = `${base(env)}${path}`;
  const full = title ? `${title} | ${s.brand}` : [s.brand, s.slogan].filter(Boolean).join(' — ');
  const desc = String(description || s.about).replace(/\s+/g, ' ').trim().slice(0, 300);
  const wa = s.whatsapp ? `https://wa.me/${esc(s.whatsapp.replace(/\D/g, ''))}` : '';
  const og = image || `${base(env)}${a.url('og.png')}`;
  const navPages = arr(env.pages).filter((p) => p.nav);
  const apps = arr(env.apps);
  return `<!doctype html>
<html lang="fa" dir="rtl" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="${esc(canonical)}">`}
<meta property="og:site_name" content="${esc(s.brand)}">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:locale" content="fa_AF">
<meta property="og:image" content="${esc(og)}">
<meta name="twitter:card" content="${image ? 'summary' : 'summary_large_image'}">
<meta name="twitter:title" content="${esc(full)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(og)}">
${s.googleVerify ? `<meta name="google-site-verification" content="${esc(s.googleVerify)}">\n` : ''}${s.bingVerify ? `<meta name="msvalidate.01" content="${esc(s.bingVerify)}">\n` : ''}<meta name="theme-color" content="#000000">
<meta name="color-scheme" content="dark light">
<link rel="icon" href="${a.url('favicon.svg')}" type="image/svg+xml">
<link rel="manifest" href="/site.webmanifest">
${aiOn(env) ? `<link rel="alternate" type="text/plain" title="خلاصهٔ سایت برای هوش مصنوعی" href="/llms.txt">\n${alternates}` : ''}
${fontTags(a, true)}
${env.themeInline ? `<script>${env.themeInline}</script>` : `<script src="${a.url('theme.js')}"></script>`}
<link rel="stylesheet" href="${a.url('site.css')}">
<script src="${a.url('site.js')}" defer></script>
<script type="speculationrules">${SPEC_RULES}</script>
${jsonLd.filter(Boolean).map((j) => `<script type="application/ld+json">${jsonForHtml(j)}</script>`).join('\n')}
</head>
<body class="${esc(cls)}"${appTheme ? ` style="${appTheme}"` : ''}${scene ? ` data-scene-src="${a.url('scene.js')}"` : ''}>
<a class="skip" href="#main">رفتن به محتوا</a>
<div class="progress" aria-hidden="true"><i></i></div>
<header class="top" data-top>
  <a class="brand" href="/" aria-label="${esc(s.brand)} — صفحهٔ اصلی"><b>${esc(s.brand)}</b><span>${esc(s.slogan)}</span></a>
  <nav class="nav" id="nav" aria-label="بخش‌های سایت">
    <a href="/#apps">برنامه‌ها</a>
    ${navPages.map((p) => `<a href="${pageUrl(env, esc(p.slug))}">${esc(p.title)}</a>`).join('\n    ')}
    ${env.static ? '' : '<a href="/check">بررسی اشتراک</a>'}
    <a href="#contact">تماس</a>
  </nav>
  <div class="top-act">
    <button class="theme" type="button" data-theme-toggle aria-label="تغییر حالت روشن و تیره">${icon('sun', 'i-sun')}${icon('moon', 'i-moon')}</button>
    <a class="btn btn-main btn-sm top-cta" href="#contact">سفارش برنامه</a>
    <button class="menu-btn" type="button" data-menu aria-controls="nav" aria-expanded="false" aria-label="فهرست">${icon('menu')}</button>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot" id="contact">
  <div class="foot-lead">
    <h2>برنامه‌ای می‌خواهید؟<br>با ما تماس بگیرید.</h2>
    <p>${esc(s.about)}</p>
    <div class="cta-row">
      ${wa ? `<a class="btn btn-main btn-xl" href="${wa}" rel="noopener" target="_blank">${icon('chat')}گفت‌وگو در واتساپ</a>` : ''}
      ${s.phone ? `<a class="btn btn-ghost btn-xl" href="tel:${esc(s.phone)}">${icon('phone')}<bdi dir="ltr">${esc(faDigits(s.phone))}</bdi></a>` : ''}
    </div>
  </div>
  <ul class="foot-links">
    ${s.phone ? `<li><a href="tel:${esc(s.phone)}">${icon('phone')}<span>تماس</span><bdi dir="ltr">${esc(faDigits(s.phone))}</bdi></a></li>` : ''}
    ${wa ? `<li><a href="${wa}" rel="noopener" target="_blank">${icon('chat')}<span>واتساپ</span><bdi dir="ltr">+${esc(faDigits(s.whatsapp.replace(/\D/g, '')))}</bdi></a></li>` : ''}
    ${s.telegram ? `<li><a href="https://t.me/${esc(s.telegram.replace(/^@/, ''))}" rel="noopener" target="_blank">${icon('chat')}<span>تلگرام</span><bdi dir="ltr">@${esc(s.telegram.replace(/^@/, ''))}</bdi></a></li>` : ''}
    ${s.email ? `<li><a href="mailto:${esc(s.email)}">${icon('mail')}<span>ایمیل</span><bdi dir="ltr">${esc(s.email)}</bdi></a></li>` : ''}
  </ul>
  <nav class="foot-map" aria-label="نقشهٔ سایت">
    ${apps.length ? `<div><h3>برنامه‌ها</h3><ul>${apps.slice(0, 10).map((x) => `<li><a href="${appUrl(env, esc(x.slug))}">${esc(x.name)}</a></li>`).join('')}</ul></div>` : ''}
    <div><h3>سایت</h3><ul><li><a href="/">صفحهٔ اصلی</a></li>${env.static ? '' : '<li><a href="/check">بررسی اشتراک</a></li>'}${arr(env.pages).map((p) => `<li><a href="${pageUrl(env, esc(p.slug))}">${esc(p.title)}</a></li>`).join('')}</ul></div>
  </nav>
  <p class="foot-mark" aria-hidden="true">${esc(s.brand)}</p>
  <p class="foot-base"><b>${esc(s.brand)}</b><span>${esc(s.slogan)}</span><span>${esc(faYear())}</span></p>
</footer>
</body>
</html>`;
}

/* ───────────── صفحهٔ اصلی ───────────── */

// قهرمان صفحه: کد خودش تایپ می‌شود و هر خط، همان برنامه را روی دستگاهِ کناری زنده می‌کند (با رنگ خودش).
function heroStage(env) {
  const apps = env.apps.slice(0, 6);
  const tok = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;
  const live = apps.filter((a) => newest(a)).length;
  const lines = [
    `<span class="ln">${tok('c-com', `// ${base(env).replace(/^https?:\/\//, '')}`)}</span>`,
    ...apps.map((a, i) => {
      const v = newest(a);
      return `<span class="ln" data-i="${i}"><span>apps.</span>${tok('c-fn', v ? 'publish' : 'soon')}<span>(</span>${tok('c-str', `"${a.slug}"`)}${v ? `<span>, </span>${tok('c-str', `"${v.version}"`)}` : ''}<span>);</span></span>`;
    }),
    `<span class="ln">${tok('c-com', live ? `// ${live} online` : `// ${apps.length} on the way`)}</span>`,
  ];
  return `<div class="stage" data-stage aria-hidden="true">
  <div class="stage-3d">
    <div class="stage-apps">
      ${apps.map((a, i) => {
        const f = frame(a, { eager: i === 0 });
        return `<div class="stage-app ${f.phone ? 'is-phone' : 'is-wide'}${i === 0 ? ' is-on' : ''}" data-i="${i}" style="${theme(a)}"><i class="stage-glow"></i>${f.html}</div>`;
      }).join('\n      ')}
    </div>
    <div class="editor">
      <div class="editor-bar"><i></i><i></i><i></i><span>vill3n.js</span></div>
      <pre class="editor-code" dir="ltr"><code>${lines.join('')}</code></pre>
    </div>
  </div>
  <div class="stage-tabs">
    ${apps.map((a, i) => `<button type="button" tabindex="-1" class="stage-tab${i === 0 ? ' is-on' : ''}" data-i="${i}" style="${theme(a)}">${appIcon(a, 'xs', false)}<span>${esc(a.name)}</span></button>`).join('\n    ')}
  </div>
</div>`;
}

// نوار روان: کارهایی که برنامه‌ها واقعاً انجام می‌دهند (از ویژگی‌های ثبت‌شدهٔ خودِ برنامه‌ها)
function marquee(env) {
  const seen = new Set();
  const list = [];
  for (const a of env.apps) for (const f of arr(a.features)) if (f.title && !seen.has(f.title)) { seen.add(f.title); list.push(f.title); }
  if (list.length < 6) return '';
  const half = Math.ceil(Math.min(list.length, 24) / 2);
  const row = (items, cls) => `<div class="band-row ${cls}"><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><ul aria-hidden="true">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
  return `<section class="band" aria-label="کارهایی که برنامه‌ها انجام می‌دهند" data-band><div class="band-rows">${row(list.slice(0, half), 'is-a')}${row(list.slice(half, half * 2), 'is-b')}</div><button class="band-toggle" type="button" data-band-toggle aria-pressed="false" aria-label="ایستادن و حرکت نوار">${icon('pause', 'i-pause')}${icon('play', 'i-play')}</button></section>`;
}

function metaLine(app, env) {
  const by = latestByPlatform(app);
  const first = newest(app);
  const plats = Object.keys(by).map((p) => PLATFORMS[p] || p);
  const cheap = cheapest(app);
  return `${app.featured ? `<span class="pill is-star">${icon('star')}ویژه</span>` : ''}${first ? `<span class="pill is-ver">${hud(`v${first.version}`)}</span>` : '<span class="pill is-soon">به‌زودی</span>'}${plats.length ? `<span class="pill">${esc(plats.join('، '))}</span>` : ''}${cheap ? `<span class="pill is-price">${onSale(app) ? '<em>تخفیف</em>' : ''}از ${money(cheap.final, env.settings)}</span>` : ''}`;
}

// هر برنامه یک «فصل» تمام‌عرض با رنگ و دستگاه خودش؛ در صفحه‌های بزرگ فصل‌ها مثل یک دسته کارت روی هم می‌نشینند
function chapter(app, env, i) {
  const f = frame(app);
  const first = newest(app);
  const points = arr(app.features).slice(0, 3);
  return `<li class="chapter" data-cat="${esc(app.category)}" style="${theme(app)};--i:${i}">
  <article class="chapter-card spot ring">
    <div class="chapter-copy">
      ${app.category ? `<p class="chapter-cat">${esc(app.category)}</p>` : ''}
      <h3><a href="${appUrl(env, esc(app.slug))}">${appIcon(app)}<span style="view-transition-name:name-${esc(app.slug)}">${esc(app.name)}</span></a></h3>
      <p class="chapter-tag">${esc(app.tagline)}</p>
      ${points.length ? `<ul class="chapter-points">${points.map((p) => `<li>${icon('check')}<span><b>${esc(p.title)}</b>${p.text ? ` ${esc(p.text)}` : ''}</span></li>`).join('')}</ul>` : ''}
      <p class="chapter-meta">${metaLine(app, env)}</p>
      <a class="btn btn-app" href="${appUrl(env, esc(app.slug))}" aria-label="${esc(`${first ? 'دانلود و جزئیات' : 'جزئیات'} ${app.name}`)}">${first ? `${icon('download')}دانلود و جزئیات` : 'دیدن جزئیات'}${icon('go')}</a>
    </div>
    <a class="chapter-visual device ${f.phone ? 'is-phone' : 'is-wide'}" href="${appUrl(env, esc(app.slug))}" tabindex="-1" aria-hidden="true">${f.html}</a>
  </article>
</li>`;
}

function miniCard(app, env, vt = true) {
  return `<li class="mini-wrap" data-cat="${esc(app.category)}">
  <a class="mini spot" href="${appUrl(env, esc(app.slug))}" style="${theme(app)}">
    ${appIcon(app, '', vt)}
    <span class="mini-main"><strong${vt ? ` style="view-transition-name:name-${esc(app.slug)}"` : ''}>${esc(app.name)}</strong><span>${esc(app.tagline)}</span></span>
    <span class="mini-meta">${metaLine(app, env)}</span>
    <span class="mini-go">${icon('go')}</span>
  </a>
</li>`;
}

function home(env) {
  const s = env.settings;
  const apps = env.apps;
  const blocks = arr(env.home && env.home.blocks);
  const cats = [...new Set(apps.map((a) => a.category).filter(Boolean))];
  let last = null;
  for (const a of apps) for (const v of publishedVersions(a)) if (!last || v.publishedAt > last.v.publishedAt) last = { a, v };
  const downloads = apps.reduce((n, a) => n + arr(a.versions).reduce((m, v) => m + (v.downloads || 0), 0), 0);
  const lead = apps.slice(0, 6), rest = apps.slice(6);
  const heroTitle = s.heroTitle || s.brand;
  const anyLive = apps.some((a) => newest(a));
  const body = `
<section class="hero">
  <canvas class="scene" data-scene="dust" aria-hidden="true"></canvas>
  <div class="hero-copy">
    <p class="kicker">${esc(s.slogan)}</p>
    <h1 class="display" aria-label="${esc(heroTitle)}"><span aria-hidden="true">${words(heroTitle)}</span></h1>
    <p class="lead">${esc(s.heroText)}</p>
    <div class="cta-row">
      <a class="btn btn-main btn-xl" href="#apps">${anyLive ? `${icon('download')}دیدن و دانلود برنامه‌ها` : 'دیدن برنامه‌ها'}</a>
      <a class="btn btn-ghost btn-xl" href="#contact">سفارش برنامهٔ اختصاصی</a>
    </div>
    <ul class="hero-facts" aria-label="وضعیت">
      ${cats.length ? `<li class="is-for"><span>برای</span>${cats.slice(0, 6).map((c) => `<em>${esc(c)}</em>`).join('')}</li>` : (apps.length ? `<li><b>${num(apps.length)}</b><span>برنامه</span></li>` : '')}
      ${downloads > 20 ? `<li><b>${num(downloads)}</b><span>دانلود</span></li>` : ''}
      ${last ? `<li class="is-wide"><span>آخرین انتشار</span><a href="${appUrl(env, esc(last.a.slug))}">${esc(last.a.name)} ${hud(`v${last.v.version}`)}</a><span>${esc(faDate(last.v.publishedAt))}</span></li>` : ''}
    </ul>
  </div>
  ${apps.length ? heroStage(env) : ''}
</section>
${marquee(env)}
<section class="sec chapters" id="apps">
  <header class="sec-head">
    <h2>برنامه‌ها</h2>
    <p>هر برنامه صفحه، رنگ و دنیای خودش را دارد: دانلود آخرین نسخه، قیمت اشتراک و تاریخچهٔ نسخه‌ها.</p>
  </header>
  ${cats.length > 1 && apps.length > 3 ? `<div class="chips" role="group" aria-label="دسته‌بندی"><button type="button" class="chip is-on" data-cat="" aria-pressed="true">همه</button>${cats.map((c) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('')}</div>` : ''}
  ${apps.length ? `<ol class="chapter-list">${lead.map((a, i) => chapter(a, env, i)).join('')}</ol>` : '<div class="empty"><p>هنوز برنامه‌ای منتشر نشده است.</p><p>به‌زودی اولین برنامه همین‌جا قرار می‌گیرد.</p></div>'}
  ${rest.length ? `<h3 class="more-title">برنامه‌های دیگر</h3><ul class="minis">${rest.map((a) => miniCard(a, env)).join('')}</ul>` : ''}
</section>
${renderBlocks(blocks)}`;
  const org = { '@type': 'Organization', '@id': `${base(env)}/#org`, name: s.brand, url: `${base(env)}/`, slogan: s.slogan, description: s.about, email: s.email || undefined, telephone: s.phone || undefined, logo: `${base(env)}${env.assets.url('og.png')}` };
  const faq = faqFromBlocks(blocks);
  return layout(env, {
    title: '', description: s.heroText, path: '/', body, cls: 'is-home', scene: true,
    jsonLd: [
      { '@context': 'https://schema.org', '@graph': [org, { '@type': 'WebSite', '@id': `${base(env)}/#site`, url: `${base(env)}/`, name: s.brand, inLanguage: 'fa', publisher: { '@id': `${base(env)}/#org` } }] },
      apps.length ? { '@context': 'https://schema.org', '@type': 'ItemList', name: `برنامه‌های ${s.brand}`, itemListElement: apps.map((a, i) => ({ '@type': 'ListItem', position: i + 1, name: a.name, url: `${base(env)}${appUrl(env, a.slug)}` })) } : null,
      faqLd(faq),
    ],
  });
}

function faqLd(faq) {
  return faq.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) } : null;
}

/* ───────────── صفحهٔ هر برنامه ───────────── */

function planCard(app, plan, env) {
  const pp = planPrice(plan);
  const period = plan.days ? `${num(plan.days)} روز اعتبار` : 'بدون تاریخ پایان';
  return `<li class="plan spot ring${plan.popular ? ' is-popular' : ''}${plan.vip ? ' is-vip' : ''}">
  ${plan.vip || plan.popular ? `<p class="plan-flags">${plan.vip ? `<span class="plan-flag is-vip">${icon('star')}<bdi dir="ltr">VIP</bdi></span>` : ''}${plan.popular ? '<span class="plan-flag">پیشنهادی</span>' : ''}</p>` : ''}
  <h3>${esc(plan.name)}</h3>
  <p class="plan-period">${esc(period)}</p>
  <p class="plan-price">${pp.off ? `<s>${money(pp.base, env.settings)}</s>` : ''}<b>${money(pp.final, env.settings)}</b></p>
  ${pp.off ? `<p class="plan-off"><em>${num(pp.discount.percent)}٪ تخفیف</em>${pp.discount.label ? `<span>${esc(pp.discount.label)}</span>` : ''}${pp.discount.to ? `<span class="until" data-until="${esc(pp.discount.to)}">تا ${esc(faDate(pp.discount.to))}</span>` : ''}</p>` : ''}
  ${plan.features.length ? `<ul class="plan-list">${plan.features.map((f) => `<li>${icon('check')}${esc(f)}</li>`).join('')}</ul>` : ''}
  <a class="btn ${plan.vip ? 'btn-vip' : plan.popular ? 'btn-app' : 'btn-line'}" href="${esc(waOrder(env, app, plan))}"${ext(waOrder(env, app, plan))}${env.static ? '' : ` data-order="${esc(plan.id)}"`}>سفارش این اشتراک</a>
</li>`;
}

// دستگاه سه‌بعدی بالای صفحهٔ برنامه با برچسب‌های شناور
function device(app, primary) {
  const f = frame(app, { eager: true });
  return `<div class="device ${f.phone ? 'is-phone' : 'is-wide'} has-floats" aria-hidden="true">
  <div class="device-3d">
    <i class="device-glow"></i>
    ${f.html}
    <span class="float f1">${appIcon(app, 'sm', false)}</span>
    ${primary ? `<span class="float f2"><b dir="ltr">v${esc(primary.version)}</b><small>${esc(PLATFORMS[primary.platform] || primary.platform)}</small></span>` : '<span class="float f2"><b>به‌زودی</b></span>'}
    <span class="float f3"><i></i><i></i><i></i></span>
  </div>
</div>`;
}

// نگارهٔ کوچکِ کاشی‌های پهن (فقط وقتی کاشی جا دارد دیده می‌شود)
const ARTS = [
  '<span class="art art-bars" aria-hidden="true"><i style="--h:.45"></i><i style="--h:.7"></i><i style="--h:.5"></i><i style="--h:.92"></i><i style="--h:.64"></i><i style="--h:.8"></i></span>',
  '<span class="art art-rows" aria-hidden="true"><i></i><i></i><i></i><i></i></span>',
  '<span class="art art-ring" aria-hidden="true"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="50"/><circle class="arc" cx="60" cy="60" r="50" pathLength="100"/></svg></span>',
  '<span class="art art-wave" aria-hidden="true"><svg viewBox="0 0 240 80" preserveAspectRatio="none"><path d="M0 60 C30 60 40 18 70 26 S110 70 140 44 S190 8 240 22"/></svg></span>',
  `<span class="art art-grid" aria-hidden="true">${'<i></i>'.repeat(15)}</span>`,
  '<span class="art art-stack" aria-hidden="true"><i></i><i></i><i></i></span>',
];
const tileArt = (i) => ARTS[i % ARTS.length];
blocksMod.ctx.art = tileArt;
const FEATURE_ICONS = ['spark', 'chart', 'shield', 'bolt', 'layers', 'sync', 'users', 'receipt', 'clock', 'lock'];

function appPage(env, app) {
  const s = env.settings;
  const by = latestByPlatform(app);
  const platforms = Object.keys(by);
  const allVersions = publishedVersions(app);
  const versions = env.static ? Object.values(by) : allVersions;
  const primary = newest(app);
  const plans = arr(app.plans).filter((p) => p.active);
  const blocks = arr(app.blocks);
  const faq = arr(app.faq);
  const features = arr(app.features);
  const shots = arr(app.screenshots);
  const reviews = arr(app.testimonials);
  const badges = arr(app.badges);
  const totalDl = arr(app.versions).reduce((n, v) => n + (v.downloads || 0), 0);
  const dlData = platforms.map((p) => ({ p, label: PLATFORMS[p] || p, v: by[p].version, size: bytes(by[p].size), href: dlLatest(env, app, by[p]) }));
  const url = `${base(env)}${appUrl(env, app.slug)}`;
  const scene = app.scene && app.scene !== 'none' ? app.scene : '';
  const paras = String(app.description || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const others = env.apps.filter((a) => a.id !== app.id).slice(0, 3);
  const captioned = shots.length >= 2 && shots.every((x) => x.caption);
  const chips = [...badges, ...platforms.map((p) => PLATFORMS[p] || p)].filter((v, i, l) => v && l.indexOf(v) === i);

  const links = [
    paras.length ? ['about', 'معرفی'] : null,
    features.length ? ['features', 'ویژگی‌ها'] : null,
    shots.length > 1 ? ['shots', 'تصویرها'] : null,
    plans.length ? ['plans', 'اشتراک‌ها'] : null,
    versions.length ? ['downloads', 'دانلود'] : null,
    faq.length ? ['faq', 'پرسش‌ها'] : null,
  ].filter(Boolean);

  const body = `
<section class="app-hero">
  ${scene ? `<canvas class="scene" data-scene="${esc(scene)}" aria-hidden="true"></canvas>` : ''}
  <div class="app-copy">
    <a class="crumb" href="/#apps">${icon('back')}همهٔ برنامه‌ها</a>
    <div class="app-head">
      ${appIcon(app, 'lg')}
      <div>
        ${app.category ? `<p class="chapter-cat">${esc(app.category)}</p>` : ''}
        <h1 style="view-transition-name:name-${esc(app.slug)}">${esc(app.name)}</h1>
      </div>
    </div>
    <p class="app-tag">${esc(app.tagline)}</p>
    ${chips.length ? `<ul class="badges">${chips.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    ${primary ? `
    <div class="app-cta cta-row" data-downloads='${esc(JSON.stringify(dlData))}'>
      <a class="btn btn-app btn-xl" href="${esc(dlLatest(env, app, primary))}" data-dl-main rel="nofollow">${icon('download')}<span><b data-dl-label>دانلود برای ${esc(PLATFORMS[primary.platform] || primary.platform)}</b><small data-dl-sub>نسخهٔ ${esc(faDigits(primary.version))} · ${esc(bytes(primary.size))}</small></span></a>
      ${plans.length ? '<a class="btn btn-ghost btn-xl" href="#plans">دیدن اشتراک‌ها</a>' : ''}
    </div>
    ${platforms.length > 1 ? `<p class="app-other">دانلود برای: ${platforms.map((p) => `<a href="${esc(dlLatest(env, app, by[p]))}" rel="nofollow">${esc(PLATFORMS[p] || p)} ${hud(`v${by[p].version}`)}</a>`).join('')}</p>` : ''}
    <ul class="app-facts">
      <li>${hud(`v${primary.version}`)}<span>منتشرشده در ${esc(faDate(primary.publishedAt))}</span></li>
      ${primary.minOs ? `<li>${hud('OS')}<span>${esc(primary.minOs)}</span></li>` : ''}
      ${totalDl > 20 ? `<li>${hud('DL')}<span>${num(totalDl)} دانلود</span></li>` : ''}
      <li>${hud('SHA-256')}<span class="sha" dir="ltr" title="اثر انگشت فایل برای اطمینان از سالم‌بودن دانلود">${esc(primary.sha256.slice(0, 16))}…</span></li>
    </ul>` : `
    <p class="app-status"><i aria-hidden="true"></i>به‌زودی برای دانلود آماده می‌شود</p>
    <div class="app-cta cta-row">
      <a class="btn btn-app btn-xl" href="${esc(waLink(s, `سلام، دربارهٔ برنامهٔ «${app.name}» پرسش دارم.`))}"${ext(waLink(s, ''))}>${icon('chat')}پرسیدن دربارهٔ این برنامه</a>
      ${plans.length ? '<a class="btn btn-ghost btn-xl" href="#plans">دیدن اشتراک‌ها</a>' : ''}
    </div>`}
  </div>
  ${device(app, primary)}
</section>

${links.length > 1 ? `
<nav class="subnav" aria-label="بخش‌های این صفحه" data-subnav>
  <a class="subnav-app" href="#main" aria-label="${esc(app.name)}، بالای صفحه">${appIcon(app, 'xs', false)}<b>${esc(app.name)}</b></a>
  <ul>${links.map(([id, label]) => `<li><a href="#${id}">${label}</a></li>`).join('')}</ul>
  ${primary ? `<a class="btn btn-app btn-sm" href="${esc(dlLatest(env, app, primary))}" rel="nofollow">${icon('download')}دانلود</a>` : (plans.length ? '<a class="btn btn-app btn-sm" href="#plans">اشتراک‌ها</a>' : '')}
</nav>` : ''}

${paras.length ? `
<section class="sec statement" id="about" aria-label="دربارهٔ برنامه">
  <h2 class="sr">${esc(app.name)} چه می‌کند؟</h2>
  <p class="statement-big" aria-label="${esc(paras[0])}"><span aria-hidden="true">${words(paras[0])}</span></p>
  ${paras.length > 1 ? `<div class="prose">${paras.slice(1).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}
</section>` : ''}

${features.length ? `
<section class="sec" id="features">
  <header class="sec-head"><h2>ویژگی‌های ${esc(app.name)}</h2></header>
  <ul class="tiles is-bento" data-n="${features.length}">${features.map((f, i) => {
    const ic = f.icon && PICK[f.icon] ? f.icon : FEATURE_ICONS[i % FEATURE_ICONS.length];
    return `<li class="tile spot" style="--i:${i}"><span class="tile-ic">${icon(ic)}</span><h3>${esc(f.title)}</h3>${f.text ? `<p>${esc(f.text)}</p>` : ''}<span class="tile-wm" aria-hidden="true">${icon(ic)}</span>${tileArt(i)}</li>`;
  }).join('')}</ul>
</section>` : ''}

${shots.length > 1 ? (captioned ? `
<section class="sec tour" id="shots" aria-label="گشتی در برنامه" data-tour>
  <header class="sec-head"><h2>گشتی در ${esc(app.name)}</h2></header>
  <div class="tour-grid">
    <div class="tour-stage"><div class="device ${isPhone(app) ? 'is-phone' : 'is-wide'}"><div class="device-frame">${isPhone(app) ? '<i class="device-notch"></i>' : '<div class="device-bar"><i></i><i></i><i></i></div>'}<div class="device-screen">${shots.map((sh, i) => `<img${i === 0 ? ' class="is-on"' : ''} src="/media/${esc(sh.file)}" alt=""${dims(sh)} loading="lazy" decoding="async">`).join('')}</div></div></div></div>
    <ol class="tour-steps">${shots.map((sh, i) => `<li${i === 0 ? ' class="is-on"' : ''} data-i="${i}"><span class="step-n" aria-hidden="true">${faDigits(i + 1)}</span><p>${esc(sh.caption)}</p><img src="/media/${esc(sh.file)}" alt="${esc(sh.caption)}"${dims(sh)} loading="lazy" decoding="async"></li>`).join('')}</ol>
  </div>
</section>` : `
<section class="sec shots" id="shots" aria-label="تصویرهای برنامه">
  <header class="sec-head"><h2>تصویرهای ${esc(app.name)}</h2></header>
  <div class="shots-stage" data-zoomable>
    ${shots.map((sh, i) => `<figure><button type="button" class="shot" aria-label="بزرگ‌نمایی: ${esc(sh.caption || `تصویر ${i + 1}`)}"><img src="/media/${esc(sh.file)}" alt="${esc(sh.caption || `تصویر ${i + 1} از ${app.name}`)}"${dims(sh)} loading="lazy" decoding="async"></button>${sh.caption ? `<figcaption>${esc(sh.caption)}</figcaption>` : ''}</figure>`).join('')}
  </div>
</section>`) : ''}

${renderBlocks(blocks)}

${plans.length ? `
<section class="sec" id="plans">
  <header class="sec-head">
    <h2>اشتراک‌های ${esc(app.name)}</h2>
    <p>${esc(s.orderNote)}</p>
  </header>
  <ul class="plans" data-n="${plans.length}">${plans.map((p) => planCard(app, p, env)).join('')}</ul>
</section>` : ''}

${versions.length ? `
<section class="sec" id="downloads">
  <header class="sec-head"><h2>دانلود و تاریخچهٔ نسخه‌ها</h2></header>
  <div class="tbl-wrap" tabindex="0" role="region" aria-label="آخرین نسخه برای هر دستگاه"><table class="tbl has-rowhead">
    <thead><tr><th scope="col">دستگاه</th><th scope="col">نسخه</th><th scope="col">حجم</th><th scope="col">تاریخ انتشار</th><th scope="col"><span class="sr">دانلود</span></th></tr></thead>
    <tbody>${platforms.map((p) => `<tr><th scope="row">${esc(PLATFORMS[p] || p)}</th><td>${hud(`v${by[p].version}`)}</td><td>${esc(bytes(by[p].size))}</td><td>${esc(faDate(by[p].publishedAt))}</td><td><a class="btn btn-line btn-sm" href="${esc(dlLatest(env, app, by[p]))}" rel="nofollow" aria-label="دانلود برای ${esc(PLATFORMS[p] || p)}">${icon('download')}دانلود</a></td></tr>`).join('')}</tbody>
  </table></div>
  <p class="tbl-hint">برای دیدن ستون‌های دیگر، جدول را به پهلو بکشید.</p>
  <ol class="timeline">
    ${versions.slice(0, 12).map((v, i) => `<li><details${i === 0 ? ' open' : ''}>
      <summary><span class="tl-head">${hud(`v${v.version}`)}<span>${esc(PLATFORMS[v.platform] || v.platform)}</span><time datetime="${esc(v.publishedAt)}">${esc(faDate(v.publishedAt))}</time><span>${esc(bytes(v.size))}</span></span>${icon('plus')}</summary>
      <div class="tl-body">
        ${v.notes ? `<div class="tl-notes">${esc(v.notes).split('\n').filter(Boolean).map((l) => `<p>${l}</p>`).join('')}</div>` : ''}
        <a class="tl-dl" href="${esc(dlExact(env, app, v))}" rel="nofollow">${icon('download')}دانلود نسخهٔ ${esc(faDigits(v.version))} (${esc(PLATFORMS[v.platform] || v.platform)})</a>
      </div>
    </details></li>`).join('')}
  </ol>
</section>` : ''}

${faq.length ? `
<section class="sec blk-faq" id="faq">
  <header class="sec-head"><h2>پرسش‌های پرتکرار</h2></header>
  ${faqList(faq)}
</section>` : ''}

${reviews.length ? `
<section class="sec" id="reviews">
  <header class="sec-head"><h2>نظر مشتری‌ها</h2></header>
  <ul class="quotes">${reviews.map((t) => `<li class="spot"><blockquote>${esc(t.text)}</blockquote><p><b>${esc(t.name)}</b>${t.role ? `<span>${esc(t.role)}</span>` : ''}</p></li>`).join('')}</ul>
</section>` : ''}

${others.length ? `
<section class="sec more">
  <header class="sec-head"><h2>برنامه‌های دیگر ${esc(s.brand)}</h2></header>
  <ul class="minis">${others.map((a) => miniCard(a, env)).join('')}</ul>
</section>` : ''}

${plans.length && !env.static ? `
<dialog class="order" id="order" aria-labelledby="order-title" data-app="${esc(app.id)}" data-currency="${esc(s.currency)}" data-wa="${esc((s.whatsapp || '').replace(/\D/g, ''))}" data-appname="${esc(app.name)}">
  <form method="dialog" class="order-box" novalidate>
    <button class="order-x" type="button" data-close aria-label="بستن">${icon('close')}</button>
    <div data-step="form">
      <h2 id="order-title">سفارش اشتراک ${esc(app.name)}</h2>
      <label><span>اشتراک</span>
        <select name="planId" required>${plans.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.vip ? ' (VIP)' : ''} — ${money(planPrice(p).final, s)}</option>`).join('')}</select>
      </label>
      <label><span>نام شما</span><input name="name" type="text" autocomplete="name" required maxlength="80"></label>
      <label><span>شمارهٔ تماس یا واتساپ</span><input name="phone" type="tel" inputmode="tel" autocomplete="tel" dir="ltr" required maxlength="24" placeholder="07xxxxxxxx"></label>
      <label><span>کد تخفیف <small>اگر دارید</small></span>
        <span class="coupon"><input name="coupon" type="text" dir="ltr" autocomplete="off" maxlength="32"><button class="btn btn-line" type="button" data-apply>اعمال</button></span>
      </label>
      <label><span>یادداشت <small>اختیاری</small></span><textarea name="note" rows="2" maxlength="500"></textarea></label>
      <label class="hp" aria-hidden="true">وب‌سایت<input name="website" type="text" tabindex="-1" autocomplete="off"></label>
      <dl class="bill" data-bill aria-live="polite"></dl>
      <div class="order-actions">
        <p class="order-err" data-err role="alert"></p>
        <button class="btn btn-app btn-xl" type="submit" data-submit>ثبت سفارش</button>
      </div>
    </div>
    <div data-step="done" hidden>
      <h2 tabindex="-1" data-done>سفارش شما ثبت شد</h2>
      <p class="order-no">شمارهٔ سفارش <b data-no></b></p>
      <p>${esc(s.orderNote)}</p>
      <a class="btn btn-app btn-xl" data-wa-link target="_blank" rel="noopener" hidden>${icon('chat')}فرستادن سفارش در واتساپ</a>
      <button class="btn btn-ghost" type="button" data-close>بستن</button>
    </div>
  </form>
</dialog>` : ''}`;

  const osNames = { android: 'Android', windows: 'Windows', web: 'Web', mac: 'macOS', linux: 'Linux', ios: 'iOS' };
  const allFaq = faq.concat(faqFromBlocks(blocks));
  const soft = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', '@id': `${url}#app`, name: app.name, url,
    description: (app.tagline || app.description || '').slice(0, 300) || undefined, inLanguage: 'fa',
    applicationCategory: 'BusinessApplication', operatingSystem: platforms.map((p) => osNames[p]).filter(Boolean).join(', ') || undefined,
    softwareVersion: primary ? primary.version : undefined, datePublished: primary ? primary.publishedAt : undefined,
    fileSize: primary ? `${Math.max(1, Math.round(primary.size / 1024))} KB` : undefined,
    downloadUrl: primary && !env.static ? `${base(env)}/download/${app.slug}?p=${primary.platform}` : undefined,
    image: app.icon ? `${base(env)}/media/${app.icon}` : undefined,
    screenshot: shots.length ? shots.slice(0, 4).map((x) => `${base(env)}/media/${x.file}`) : undefined,
    featureList: features.length ? features.map((f) => f.title) : undefined,
    offers: plans.length && isoCurrency(s) ? plans.map((p) => ({ '@type': 'Offer', name: p.name, price: String(planPrice(p).final), priceCurrency: isoCurrency(s), availability: `https://schema.org/${primary ? 'InStock' : 'PreOrder'}`, url: `${url}#plans` })) : undefined,
    publisher: { '@type': 'Organization', name: s.brand, url: `${base(env)}/` },
  };
  return layout(env, {
    title: `${app.name}${primary ? ` — دانلود نسخهٔ ${faDigits(primary.version)}` : ''}`,
    description: [`${app.name}${app.tagline ? `: ${app.tagline}` : ''}`, String(app.description || '').split('\n')[0], primary ? `دانلود آخرین نسخه (${faDigits(primary.version)})، قیمت اشتراک و تاریخچهٔ نسخه‌ها در ${s.brand}` : `به‌زودی در ${s.brand}`].filter(Boolean).join('. ').replace(/\.\. /g, '. '),
    path: appUrl(env, app.slug), body, appTheme: theme(app), scene: !!scene, cls: 'is-app',
    image: app.icon ? `${base(env)}/media/${app.icon}` : '',
    alternates: `<link rel="alternate" type="text/markdown" title="${esc(app.name)} (متن ساده)" href="/app/${esc(app.slug)}.md">`,
    jsonLd: [
      soft,
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: s.brand, item: `${base(env)}/` }, { '@type': 'ListItem', position: 2, name: app.name, item: url }] },
      faqLd(allFaq),
    ],
  });
}

/* ───────────── صفحه‌های دلخواه مالک ───────────── */

function customPage(env, pg) {
  const s = env.settings;
  const url = `${base(env)}${pageUrl(env, pg.slug)}`;
  const blocks = arr(pg.blocks);
  const body = `
<section class="page-hero">
  <canvas class="scene" data-scene="dust" aria-hidden="true"></canvas>
  <a class="crumb" href="/">${icon('back')}صفحهٔ اصلی</a>
  <h1 class="display" aria-label="${esc(pg.title)}"><span aria-hidden="true">${words(pg.title)}</span></h1>
  ${pg.description ? `<p class="lead">${esc(pg.description)}</p>` : ''}
</section>
${renderBlocks(blocks) || '<section class="blk"><div class="empty"><p>این صفحه هنوز نوشته نشده است.</p></div></section>'}`;
  return layout(env, {
    title: pg.title, description: pg.description || `${pg.title} — ${s.brand}`, path: pageUrl(env, pg.slug), body, cls: 'is-page', scene: true,
    alternates: `<link rel="alternate" type="text/markdown" title="${esc(pg.title)} (متن ساده)" href="/p/${esc(pg.slug)}.md">`,
    jsonLd: [
      { '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${url}#page`, url, name: pg.title, description: pg.description || undefined, inLanguage: 'fa', dateModified: pg.updatedAt || undefined, isPartOf: { '@id': `${base(env)}/#site` } },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: s.brand, item: `${base(env)}/` }, { '@type': 'ListItem', position: 2, name: pg.title, item: url }] },
      faqLd(faqFromBlocks(blocks)),
    ],
  });
}

/* ───────────── بررسی اشتراک ───────────── */

// verdict: نتیجهٔ بررسیِ کدی که در نشانی آمده (برای وقتی که جاوااسکریپت خاموش است)
function checkPage(env, verdict) {
  const body = `
<section class="solo">
  <canvas class="scene" data-scene="dust" aria-hidden="true"></canvas>
  <span class="solo-ic">${icon('key')}</span>
  <h1>بررسی اشتراک</h1>
  <p>کد فعال‌سازی‌ای را که از ما گرفته‌اید بنویسید تا وضعیت و تاریخ پایان آن را ببینید.</p>
  <form class="check" data-check novalidate action="/check" method="get">
    <label for="code">کد فعال‌سازی</label>
    <div class="check-row">
      <input id="code" name="code" type="text" dir="ltr" autocomplete="off" spellcheck="false" maxlength="40" placeholder="V3-XXXX-XXXX-XXXX-XXXX" required>
      <button class="btn btn-main" type="submit">${icon('key')}بررسی کد</button>
    </div>
  </form>
  <div class="check-out" data-check-out aria-live="polite">${verdict ? `<p class="verdict ${verdict.ok ? 'is-ok' : 'is-bad'}"><b>${esc(verdict.title)}</b>${verdict.lines.map((l) => `<span>${esc(l)}</span>`).join('')}</p>` : ''}</div>
</section>`;
  return layout(env, { title: 'بررسی اشتراک', description: `وضعیت و تاریخ پایان اشتراک برنامه‌های ${env.settings.brand} را با کد فعال‌سازی بررسی کنید.`, path: '/check', body, cls: 'is-solo', scene: true, noindex: !!verdict });
}

function errorPage(env, status, message) {
  const titles = { 404: 'این صفحه پیدا نشد', 429: 'درخواست زیاد بود', 500: 'خطای سرور' };
  const body = `
<section class="solo">
  <canvas class="scene" data-scene="dust" aria-hidden="true"></canvas>
  <p class="solo-code" aria-hidden="true">${esc(faDigits(status))}</p>
  <h1>${esc(titles[status] || 'مشکلی پیش آمد')}</h1>
  <p>${esc(status === 404 ? 'نشانی را بررسی کنید یا از صفحهٔ اصلی برنامهٔ مورد نظر را پیدا کنید.' : message)}</p>
  <a class="btn btn-main btn-xl" href="/">بازگشت به صفحهٔ اصلی</a>
</section>`;
  return layout(env, { title: titles[status] || 'خطا', path: '/', body, noindex: true, cls: 'is-solo', scene: true });
}

function adminShell(env) {
  const a = env.assets;
  return `<!doctype html>
<html lang="fa" dir="rtl" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>پنل مالک | ${esc(env.settings.brand)}</title>
<link rel="icon" href="${a.url('favicon.svg')}" type="image/svg+xml">
${fontTags(a, false)}
${env.themeInline ? `<script>${env.themeInline}</script>` : `<script src="${a.url('theme.js')}"></script>`}
<link rel="stylesheet" href="${a.url('admin.css')}">
<script src="${a.url('admin.js')}" defer></script>
</head>
<body>
<div id="app" aria-live="polite"><p class="boot">در حال باز کردن پنل…</p></div>
<noscript><p class="boot">برای پنل مالک باید جاوااسکریپت روشن باشد.</p></noscript>
</body>
</html>`;
}

function sitemap(env) {
  const b = base(env);
  const urls = [{ loc: `${b}/`, mod: env.apps.map((a) => a.updatedAt).sort().pop() }, { loc: `${b}/check`, mod: null }]
    .concat(env.apps.map((a) => ({ loc: `${b}${appUrl(env, a.slug)}`, mod: a.updatedAt })))
    .concat(arr(env.pages).map((p) => ({ loc: `${b}${pageUrl(env, p.slug)}`, mod: p.updatedAt })));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${esc(u.loc)}</loc>${u.mod ? `<lastmod>${esc(String(u.mod).slice(0, 10))}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}

module.exports = { home, appPage, customPage, checkPage, errorPage, adminShell, sitemap, staticFile, newest, base, cta, SPEC_RULES, SOURCE_LABEL, rich };
