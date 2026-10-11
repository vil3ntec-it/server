'use strict';
// قاعده‌های کسب‌وکار: برنامه‌ها، نسخه‌ها، اشتراک‌ها، تخفیف، کد تخفیف، سفارش و فعال‌سازی.
// همهٔ قیمت‌ها عدد صحیح‌اند و همیشه روی سرور حساب می‌شوند.
const { id, str, int, bool, slugify, isColor, isoOrNull, cmpVersion, licenseCode, toLatinDigits, parseNumber } = require('./util');
const { HttpError } = require('./http');
const { PLATFORMS } = require('./detect');
const { PICK } = require('../icons');

const PERIODS = { month: { label: 'ماهانه', days: 30 }, quarter: { label: 'سه‌ماهه', days: 90 }, half: { label: 'شش‌ماهه', days: 180 }, year: { label: 'سالانه', days: 365 }, lifetime: { label: 'دایمی', days: 0 }, custom: { label: 'دلخواه', days: null } };
const APP_STATUS = ['published', 'soon', 'draft'];
// صحنهٔ متحرکِ بالای صفحهٔ هر برنامه — هر برنامه تم خودش را دارد
const SCENES = { code: 'کدنویسی', bars: 'بارکد (دکان)', flow: 'موج (تیل و مایعات)', pulse: 'نبض (ورزش و سلامت)', ticker: 'ارقام (صرافی و حساب)', dial: 'قفل (امنیت و ابزار)', none: 'بدون صحنه' };

// رنگ دوم پیش‌فرض: همان رنگ اصلی با چرخش ته‌رنگ
function shiftColor(hex, deg = 40) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  h = (h + deg + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}

function list(v, max) { return Array.isArray(v) ? v.slice(0, max) : []; }
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

// عدد صحیحِ نامنفی از فرم (قیمت، مقدار تخفیف، تعداد). چیزی که عدد نباشد خطا می‌دهد تا بی‌صدا صفر نشود.
function amount(v, label, max = 1e12) {
  if (v === undefined || v === null || v === '') return 0;
  const n = parseNumber(v);
  if (n === null || n < 0) throw new HttpError(400, `${label} باید عدد باشد (مثل 1500)`);
  return Math.min(max, Math.round(n));
}

function cleanDiscount(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const type = d.type === 'amount' ? 'amount' : 'percent';
  const value = amount(d.value, 'مقدار تخفیف', type === 'percent' ? 100 : 1e12);
  if (!value) return null;
  const from = isoOrNull(d.from), to = isoOrNull(d.to);
  if (from && to && new Date(to) <= new Date(from)) throw new HttpError(400, 'پایان تخفیف باید بعد از شروع آن باشد');
  return { type, value, from, to, label: str(d.label, 40) };
}

function cleanPlan(p, old) {
  p = obj(p);
  const period = Object.prototype.hasOwnProperty.call(PERIODS, p.period) ? p.period : 'month';
  const days = period === 'custom' ? Math.max(1, amount(p.days, 'تعداد روز', 36500) || 30) : PERIODS[period].days;
  const name = str(p.name, 60) || PERIODS[period].label;
  return {
    id: old ? old.id : id(6),
    name, period, days,
    price: amount(p.price, 'قیمت'),
    features: list(p.features, 12).map((f) => str(f, 120)).filter(Boolean),
    popular: bool(p.popular),
    vip: bool(p.vip),
    active: p.active === undefined ? true : bool(p.active),
    discount: cleanDiscount(p.discount),
  };
}

/* ───── بخش‌های صفحه (بلوک‌ها): مالک با همین‌ها به صفحهٔ برنامه، صفحهٔ اصلی و صفحه‌های تازه محتوا اضافه می‌کند ───── */

const BLOCK_TYPES = { text: 'متن', cards: 'کادرها', table: 'جدول', stats: 'آمار و ارقام', steps: 'مرحله‌ها', image: 'تصویر و متن', video: 'ویدیو', quote: 'نقل‌قول یا نکته', reviews: 'نظر مشتری‌ها', cta: 'دعوت به اقدام', faq: 'پرسش و پاسخ' };
const BLOCK_LIMITS = { app: 30, home: 40, page: 40, pages: 40 };
const PAGE_STATUS = ['published', 'draft'];
// نشانی صفحه‌ها /p/<نشانی> است؛ این نام‌ها برای خودِ سایت کنار گذاشته شده‌اند
const PAGE_RESERVED = ['admin', 'api', 'assets', 'download', 'media', 'app', 'p', 'check', 'index', 'new'];
const BLOCK_ID = /^[A-Za-z0-9_-]{3,24}$/;
// پیوند دکمه فقط به همین شکل‌ها پذیرفته می‌شود (javascript: و data: هرگز)
const HREF_OK = /^(\/|#|https?:\/\/|tel:|mailto:)/i;

const pickIcon = (v) => (own(PICK, v) ? v : '');
function cleanHref(v) {
  const s = str(v, 300).replace(/[\n\r\t]/g, '');
  return HREF_OK.test(s) ? s : '';
}
// ردیف‌های یک فهرست: اول پاک‌سازی، بعد حذف خالی‌ها، بعد سقف (تا یک ردیف خالی جای ردیف پُر را نگیرد)
function items(v, max, fn) {
  const out = [];
  for (const x of list(v, max * 4 + 8)) { const r = fn(obj(x)); if (r) out.push(r); if (out.length >= max) break; }
  return out;
}
const blockImage = (im) => (im && typeof im === 'object' && typeof im.file === 'string' && IMAGE_NAME.test(im.file) ? { file: im.file, w: int(im.w, 0, 20000), h: int(im.h, 0, 20000) } : null);
// ویدیوی بخش: نام فایل را فقط سرور می‌سازد؛ نوع از روی پسوندِ همان نام نوشته می‌شود، نه از چیزی که فرستاده شده
const VIDEO_NAME = /^[\w-]+\.(mp4|webm)$/;
const VIDEO_MIME = { mp4: 'video/mp4', webm: 'video/webm' };
const blockVideo = (v) => (v && typeof v === 'object' && typeof v.file === 'string' && VIDEO_NAME.test(v.file) ? { file: v.file, size: int(v.size, 0, 1e10), mime: VIDEO_MIME[v.file.slice(v.file.lastIndexOf('.') + 1)] } : null);

// یک بخش را پاک‌سازی می‌کند؛ null یعنی «چیزی برای نمایش ندارد» و کنار گذاشته می‌شود
// media: فایل‌های بخش (تصویر، ویدیو، تصویر پیش‌نمایش) که cleanBlocks از دادهٔ خودِ سرور برداشته است
function cleanBlock(b, type, media) {
  const out = { id: '', type, title: str(b.title, 120), intro: str(b.intro, 400) };
  switch (type) {
    case 'text':
      out.body = str(b.body, 6000); out.align = b.align === 'center' ? 'center' : 'start';
      return out.title || out.body ? out : null;
    case 'cards':
      out.layout = b.layout === 'grid' ? 'grid' : 'bento';
      out.items = items(b.items, 12, (x) => { const title = str(x.title, 80); return title ? { icon: pickIcon(x.icon), title, text: str(x.text, 300) } : null; });
      return out.items.length ? out : null;
    case 'table': {
      const head = list(b.head, 8).map((x) => str(x, 60));
      if (!head.length) return null;
      const body = [];
      // هر ردیف دقیقاً به اندازهٔ سرستون‌ها خانه دارد؛ ردیفِ کاملاً خالی نگه داشته نمی‌شود
      for (const r of list(b.rows, 200)) {
        if (!Array.isArray(r)) continue;
        const row = head.map((_, i) => str(r[i], 160));
        if (row.some(Boolean)) body.push(row);
        if (body.length >= 40) break;
      }
      if (!head.some(Boolean) && !body.length) return null;
      out.head = head; out.rows = body; out.firstCol = bool(b.firstCol); out.note = str(b.note, 300);
      return out;
    }
    case 'stats':
      out.items = items(b.items, 6, (x) => { const value = str(x.value, 16), label = str(x.label, 60); return value && label ? { value, label } : null; });
      return out.items.length ? out : null;
    case 'steps':
      out.items = items(b.items, 8, (x) => { const title = str(x.title, 80); return title ? { title, text: str(x.text, 300) } : null; });
      return out.items.length ? out : null;
    case 'image':
      out.image = media.image || null; out.alt = str(b.alt, 140); out.text = str(b.text, 1200);
      out.side = b.side === 'end' || b.side === 'full' ? b.side : 'start';
      // متن جایگزین هم بخش را نگه می‌دارد: مالک اول بخش را ذخیره می‌کند و بعد تصویرش را می‌گذارد
      return out.image || out.title || out.text || out.alt ? out : null;
    case 'video':
      out.video = media.video || null; out.poster = media.poster || null; out.caption = str(b.caption, 200);
      // مثل تصویر: بخشِ بی‌ویدیو با عنوان یا زیرنویس نگه داشته می‌شود تا مالک بعد از ذخیره، ویدیو را بگذارد
      return out.video || out.poster || out.title || out.caption ? out : null;
    case 'quote':
      out.text = str(b.text, 600); out.by = str(b.by, 80); out.role = str(b.role, 80);
      return out.text ? out : null;
    case 'reviews':
      out.items = items(b.items, 12, (x) => { const text = str(x.text, 600); return text ? { text, by: str(x.by, 60), role: str(x.role, 80) } : null; });
      return out.items.length ? out : null;
    case 'cta':
      out.text = str(b.text, 400); out.label = str(b.label, 40); out.href = cleanHref(b.href);
      return out.title || out.text || (out.label && out.href) ? out : null;
    case 'faq':
      out.items = items(b.items, 20, (x) => { const q = str(x.q, 200), a = str(x.a, 1500); return q && a ? { q, a } : null; });
      return out.items.length ? out : null;
    default:
      return null;
  }
}

// فهرست بخش‌ها از فرم پنل. نوع ناشناس و بخش خالی حذف می‌شود و شناسهٔ تکراری یا نبوده از نو ساخته می‌شود.
// تصویر هیچ‌وقت از مرورگر پذیرفته نمی‌شود: فقط از بخشِ قبلی با همان شناسه می‌آید (آن را مسیر بارگذاری تصویر می‌گذارد).
// imageFrom (شناسهٔ یک بخش قبلی) برای «کپی بخش» است: کپی همان تصویر را نشان می‌دهد، باز هم از دادهٔ سرور.
// ویدیو و تصویر پیش‌نمایشِ بخش «ویدیو» هم همین قاعده را دارند (videoFrom و posterFrom برای کپی بخش).
// trustImages فقط برای بازگردانی پشتیبان است: نام فایل از خودِ پشتیبان می‌آید و با الگوی نام تصویر یا ویدیو سنجیده می‌شود.
function cleanBlocks(input, oldBlocks, max = BLOCK_LIMITS.app, { trustImages = false } = {}) {
  if (!Array.isArray(input)) return [];
  max = int(max, 1, 200, BLOCK_LIMITS.app);
  const old = new Map();
  for (const o of Array.isArray(oldBlocks) ? oldBlocks : []) if (o && typeof o === 'object' && typeof o.id === 'string') old.set(o.id, o);
  const oldOf = (k, type) => { const o = typeof k === 'string' ? old.get(k) : null; return o && o.type === type ? o : null; };
  const oldImage = (k) => { const o = oldOf(k, 'image'); return o ? blockImage(o.image) : null; };
  const oldVideo = (k) => { const o = oldOf(k, 'video'); return o ? blockVideo(o.video) : null; };
  const oldPoster = (k) => { const o = oldOf(k, 'video'); return o ? blockImage(o.poster) : null; };
  const seen = new Set(), out = [];
  let scanned = 0;
  for (const raw of input) {
    if (out.length >= max || ++scanned > max * 4 + 40) break;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !own(BLOCK_TYPES, raw.type)) continue;
    let bid = typeof raw.id === 'string' && BLOCK_ID.test(raw.id) && !seen.has(raw.id) ? raw.id : '';
    const media = {};
    if (raw.type === 'image') media.image = trustImages ? blockImage(raw.image) : oldImage(bid) || oldImage(raw.imageFrom);
    else if (raw.type === 'video') {
      media.video = trustImages ? blockVideo(raw.video) : oldVideo(bid) || oldVideo(raw.videoFrom);
      media.poster = trustImages ? blockImage(raw.poster) : oldPoster(bid) || oldPoster(raw.posterFrom);
    }
    const b = cleanBlock(raw, raw.type, media);
    if (!b) continue;
    if (!bid) do { bid = id(6); } while (seen.has(bid) || old.has(bid));
    seen.add(bid);
    b.id = bid;
    out.push(b);
  }
  return out;
}

// صفحهٔ دلخواهِ مالک (نشانی عمومی: /p/<نشانی>)
function cleanPage(input, old, allPages) {
  input = obj(input);
  const all = Array.isArray(allPages) ? allPages : [];
  const title = str(input.title, 80);
  if (!title) throw new HttpError(400, 'عنوان صفحه را بنویسید');
  let slug = slugify(str(input.slug, 80) || (old && old.slug) || title);
  if (!slug) slug = `page-${id(4).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  if (PAGE_RESERVED.includes(slug)) throw new HttpError(400, 'این نشانی رزرو است؛ نشانی دیگری بنویسید');
  if (all.some((p) => p && p.slug === slug && (!old || p.id !== old.id))) throw new HttpError(409, `نشانی «${slug}» را صفحهٔ دیگری گرفته است`);
  const now = new Date().toISOString();
  return {
    id: old ? old.id : id(8),
    slug, title,
    description: str(input.description, 300),
    nav: input.nav === undefined && old ? !!old.nav : bool(input.nav),
    status: PAGE_STATUS.includes(input.status) ? input.status : (old ? old.status : 'draft'),
    blocks: Array.isArray(input.blocks) ? cleanBlocks(input.blocks, old ? old.blocks : [], BLOCK_LIMITS.page) : (old && Array.isArray(old.blocks) ? old.blocks : []),
    createdAt: old ? old.createdAt : now,
    updatedAt: now,
  };
}

// برچسب‌های کوتاهِ بالای صفحهٔ برنامه (بدون تکرار)
function cleanBadges(v) {
  const out = [];
  for (const x of list(v, 40)) { const t = str(x, 28); if (t && !out.includes(t)) out.push(t); if (out.length >= 6) break; }
  return out;
}

// فیلدهای قابل ویرایشِ یک برنامه از فرم پنل (نسخه‌ها و تصویرها جدا مدیریت می‌شوند)
function cleanApp(input, old, allApps) {
  const name = str(input.name, 80);
  if (!name) throw new HttpError(400, 'نام برنامه را بنویسید');
  let slug = slugify(input.slug || (old && old.slug) || name);
  if (!slug) slug = `app-${id(4).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  if (['admin', 'api', 'assets', 'download', 'media'].includes(slug)) throw new HttpError(400, 'این نشانی رزرو است؛ نشانی دیگری بنویسید');
  if (allApps.some((a) => a.slug === slug && (!old || a.id !== old.id))) throw new HttpError(409, `نشانی «${slug}» را برنامهٔ دیگری گرفته است`);
  const oldPlans = new Map((old ? old.plans : []).map((p) => [p.id, p]));
  const app = {
    id: old ? old.id : id(8),
    slug, name,
    tagline: str(input.tagline, 140),
    description: str(input.description, 6000),
    category: str(input.category, 40),
    color: isColor(input.color) ? input.color.toLowerCase() : (old && old.color) || '#3b6cff',
    color2: isColor(input.color2) ? input.color2.toLowerCase() : '',
    scene: typeof input.scene === 'string' && Object.prototype.hasOwnProperty.call(SCENES, input.scene) ? input.scene : (old && old.scene) || 'code',
    status: APP_STATUS.includes(input.status) ? input.status : (old ? old.status : 'draft'),
    featured: bool(input.featured),
    order: int(input.order, 0, 9999, old ? old.order : allApps.length),
    watchDir: str(input.watchDir, 400),
    features: list(input.features, 24).map(obj).map((f) => ({ icon: pickIcon(f.icon), title: str(f.title, 80), text: str(f.text, 300) })).filter((f) => f.title),
    // برچسب‌ها و بخش‌ها اگر در فرم نباشند (درخواستِ قدیمی یا ناقص)، همان قبلی‌ها می‌مانند
    badges: Array.isArray(input.badges) ? cleanBadges(input.badges) : (old && Array.isArray(old.badges) ? old.badges : []),
    blocks: Array.isArray(input.blocks) ? cleanBlocks(input.blocks, old ? old.blocks : [], BLOCK_LIMITS.app) : (old && Array.isArray(old.blocks) ? old.blocks : []),
    testimonials: list(input.testimonials, 12).map(obj).map((t) => ({ name: str(t.name, 60), role: str(t.role, 80), text: str(t.text, 500) })).filter((t) => t.name && t.text),
    faq: list(input.faq, 20).map(obj).map((f) => ({ q: str(f.q, 200), a: str(f.a, 1500) })).filter((f) => f.q && f.a),
    plans: list(input.plans, 12).map((p) => cleanPlan(p, oldPlans.get(obj(p).id))),
    icon: old ? old.icon : '',
    screenshots: old ? old.screenshots : [],
    versions: old ? old.versions : [],
    createdAt: old ? old.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (!app.color2) app.color2 = shiftColor(app.color);
  // ترتیب و عنوان تصویرها از فرم
  if (old && Array.isArray(input.screenshots)) {
    const byId = new Map(old.screenshots.map((s) => [s.id, s]));
    const next = [];
    for (const s of input.screenshots.map(obj)) { const o = byId.get(s.id); if (o) { next.push({ id: o.id, file: o.file, w: o.w || 0, h: o.h || 0, caption: str(s.caption, 100) }); byId.delete(o.id); } }
    app.screenshots = next.concat([...byId.values()]);
  }
  return app;
}

/* ───── نسخه‌ها ───── */

// نسخه‌های قابل دانلود. برنامه‌ای که «منتشرشده» نیست برای بازدیدکننده هیچ نسخه‌ای ندارد
// (any=true فقط برای نمایش در پنل مالک است).
function publishedVersions(app, any = false) {
  if (!any && app.status !== 'published') return [];
  return app.versions.filter((v) => v.published && !v.missing && v.version).sort((a, b) => cmpVersion(b.version, a.version) || String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

// تازه‌ترین نسخهٔ منتشرشده برای هر پلتفرم
function latestByPlatform(app, any = false) {
  const out = Object.create(null); // بدون کلیدهای ارثی (مثل __proto__)
  for (const v of publishedVersions(app, any)) if (!out[v.platform]) out[v.platform] = v;
  return out;
}

// strict=true: اگر برای همان پلتفرم نسخه‌ای نباشد، نسخهٔ پلتفرم دیگری برنمی‌گردد
function latestVersion(app, platform, { strict = false, any = false } = {}) {
  const by = latestByPlatform(app, any);
  if (typeof platform === 'string' && platform && by[platform]) return by[platform];
  if (strict && platform) return null;
  return Object.values(by).sort((x, y) => String(y.publishedAt).localeCompare(String(x.publishedAt)))[0] || null;
}

function platformFromUA(ua) {
  ua = String(ua || '');
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac os x|macintosh/i.test(ua)) return 'mac';
  if (/linux/i.test(ua)) return 'linux';
  return '';
}

/* ───── قیمت و تخفیف ───── */

function discountActive(d, now = Date.now()) {
  if (!d || !d.value) return false;
  if (d.from && new Date(d.from).getTime() > now) return false;
  if (d.to && new Date(d.to).getTime() <= now) return false;
  return true;
}

function applyDiscount(price, d) {
  const off = d.type === 'percent' ? Math.round((price * d.value) / 100) : d.value;
  return Math.max(0, Math.min(price, off));
}

function planPrice(plan, now = Date.now()) {
  const base = plan.price;
  if (!discountActive(plan.discount, now)) return { base, final: base, off: 0, discount: null };
  const off = applyDiscount(base, plan.discount);
  const percent = base > 0 ? Math.round((off / base) * 100) : 0;
  return { base, final: base - off, off, discount: { label: plan.discount.label, percent, to: plan.discount.to } };
}

function cleanCoupon(input, old, all) {
  const code = toLatinDigits(str(input.code, 32)).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (code.length < 3) throw new HttpError(400, 'کد تخفیف دست‌کم ۳ حرف یا عدد انگلیسی باشد');
  if (all.some((c) => c.code === code && (!old || c.id !== old.id))) throw new HttpError(409, 'این کد قبلاً ساخته شده است');
  const type = input.type === 'amount' ? 'amount' : 'percent';
  const value = amount(input.value, 'مقدار تخفیف', type === 'percent' ? 100 : 1e12);
  if (!value) throw new HttpError(400, 'مقدار تخفیف را بنویسید');
  const from = isoOrNull(input.from), to = isoOrNull(input.to);
  if (from && to && new Date(to) <= new Date(from)) throw new HttpError(400, 'پایان کد باید بعد از شروع آن باشد');
  return {
    id: old ? old.id : id(6), code, type, value, from, to,
    appIds: list(input.appIds, 100).map((x) => str(x, 20)).filter(Boolean),
    maxUses: amount(input.maxUses, 'حداکثر دفعات استفاده', 1e9),
    used: old ? old.used : 0,
    active: input.active === undefined ? true : bool(input.active),
    note: str(input.note, 200),
    createdAt: old ? old.createdAt : new Date().toISOString(),
  };
}

// ظرفیت مصرف‌شدهٔ یک کد: سفارش‌های پرداخت‌شده + سفارش‌های تازه‌ای که هنوز ۷۲ ساعت از ثبت‌شان نگذشته (رزرو موقت).
// سفارشِ پرداخت‌نشده بعد از ۷۲ ساعت جای کسی را نمی‌گیرد.
const HOLD_MS = 72 * 3600 * 1000;
function couponLoad(data, c, now = Date.now()) {
  let held = 0;
  for (const o of data.orders) if (o.status === 'new' && o.coupon === c.code && now - new Date(o.createdAt).getTime() < HOLD_MS) held++;
  return c.used + held;
}

function couponProblem(c, appId, now = Date.now(), data = null) {
  if (!c || !c.active) return 'این کد تخفیف معتبر نیست';
  if (c.from && new Date(c.from).getTime() > now) return 'زمان استفاده از این کد هنوز شروع نشده است';
  if (c.to && new Date(c.to).getTime() <= now) return 'مهلت این کد تمام شده است';
  if (c.maxUses && (data ? couponLoad(data, c, now) : c.used) >= c.maxUses) return 'ظرفیت این کد تمام شده است';
  if (c.appIds.length && !c.appIds.includes(appId)) return 'این کد برای این برنامه نیست';
  return '';
}

// قیمت نهایی یک سفارش: تخفیف اشتراک، بعد کد تخفیف روی باقی‌مانده
function quote(data, appId, planId, couponCode, now = Date.now()) {
  const app = data.apps.find((a) => a.id === appId && a.status !== 'draft');
  if (!app) throw new HttpError(404, 'برنامه پیدا نشد');
  const plan = app.plans.find((p) => p.id === planId && p.active);
  if (!plan) throw new HttpError(404, 'این اشتراک دیگر فعال نیست');
  const pp = planPrice(plan, now);
  const q = { app, plan, base: pp.base, planOff: pp.off, couponOff: 0, total: pp.final, coupon: null, couponError: '' };
  const code = toLatinDigits(str(couponCode, 32)).toUpperCase();
  if (code) {
    const c = data.coupons.find((x) => x.code === code);
    const problem = couponProblem(c, appId, now, data);
    if (problem) q.couponError = problem;
    else { q.couponOff = applyDiscount(pp.final, c); q.total = pp.final - q.couponOff; q.coupon = c; }
  }
  return q;
}

function createOrder(db, input, ip) {
  const data = db.data;
  const name = str(input.name, 80);
  const phone = toLatinDigits(str(input.phone, 24)).replace(/[^\d+]/g, '');
  const email = str(input.email, 120);
  if (name.length < 2) throw new HttpError(400, 'نام خود را بنویسید');
  if (!/^\+?\d{9,15}$/.test(phone)) throw new HttpError(400, 'شمارهٔ تماس درست نیست (مثال: 0792236008)');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'ایمیل درست نیست');
  // جلوگیری از ثبت دوبارهٔ همان سفارش (دو بار زدن دکمه یا تلاش دوباره) — پیش از بررسی ظرفیت کد تخفیف
  const planId = str(input.planId, 20);
  const dup = data.orders.find((o) => o.status === 'new' && o.phone === phone && o.planId === planId && Date.now() - new Date(o.createdAt).getTime() < 10 * 60 * 1000);
  if (dup) return { order: dup, duplicate: true };
  const q = quote(data, str(input.appId, 20), planId, input.coupon);
  if (q.couponError) throw new HttpError(400, q.couponError);
  const order = {
    id: id(8), no: ++data.meta.orderSeq,
    appId: q.app.id, appName: q.app.name, planId: q.plan.id, planName: q.plan.name, period: q.plan.period, days: q.plan.days,
    name, phone, email, note: str(input.note, 500),
    coupon: q.coupon ? q.coupon.code : '', base: q.base, planOff: q.planOff, couponOff: q.couponOff, total: q.total,
    status: 'new', createdAt: new Date().toISOString(), paidAt: null, licenseId: null, ip,
  };
  data.orders.unshift(order);
  // سقفِ سفارش‌های تازه: سفارش‌های بی‌پاسخِ خیلی قدیمی کنار می‌روند تا پرونده بی‌حد بزرگ نشود
  let fresh = 0;
  data.orders = data.orders.filter((o) => o.status !== 'new' || ++fresh <= 2000);
  db.saveNow();
  return { order, duplicate: false };
}

function endDate(startIso, days) {
  if (!days) return null; // دایمی
  return new Date(new Date(startIso).getTime() + days * 86400000).toISOString();
}

function createLicense(data, { appId, planName, days, customer, phone, orderId, note }) {
  let code;
  do { code = licenseCode(); } while (data.licenses.some((l) => l.code === code));
  const startAt = new Date().toISOString();
  const lic = { id: id(8), code, appId, planName: str(planName, 60), days: int(days, 0, 36500), customer: str(customer, 80), phone: str(phone, 24), orderId: orderId || null, note: str(note, 200), startAt, endAt: endDate(startAt, int(days, 0, 36500)), status: 'active', createdAt: startAt };
  data.licenses.unshift(lic);
  return lic;
}

function licenseState(lic, now = Date.now()) {
  if (lic.status === 'revoked') return 'revoked';
  if (lic.endAt && new Date(lic.endAt).getTime() <= now) return 'expired';
  return 'active';
}

// تغییر وضعیت سفارش با گذارهای مجاز (پرداخت دوباره، اشتراک دوباره نمی‌سازد)
function setOrderStatus(db, order, status) {
  const data = db.data;
  if (order.status === status) return order;
  if (status === 'paid') {
    if (order.status === 'cancelled') throw new HttpError(409, 'سفارش لغوشده را نمی‌توان پرداخت‌شده کرد؛ اول آن را برگردانید');
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    // کد تخفیف فقط با پرداخت «مصرف‌شده» حساب می‌شود
    if (order.coupon && !order.couponCounted) { const c = data.coupons.find((x) => x.code === order.coupon); if (c) c.used++; order.couponCounted = true; }
    const existing = order.licenseId && data.licenses.find((x) => x.id === order.licenseId);
    if (existing) existing.status = 'active';
    else {
      const lic = createLicense(data, { appId: order.appId, planName: order.planName, days: order.days, customer: order.name, phone: order.phone, orderId: order.id });
      order.licenseId = lic.id;
    }
  } else if (status === 'cancelled') {
    if (order.coupon && order.couponCounted) {
      const c = data.coupons.find((x) => x.code === order.coupon);
      if (c && c.used > 0) c.used--;
      order.couponCounted = false;
    }
    if (order.licenseId) { const l = data.licenses.find((x) => x.id === order.licenseId); if (l) l.status = 'revoked'; }
    order.status = 'cancelled';
  } else if (status === 'new') {
    if (order.status !== 'cancelled') throw new HttpError(409, 'فقط سفارش لغوشده را می‌توان برگرداند');
    order.createdAt = new Date().toISOString(); // رزرو کد تخفیف از نو شروع می‌شود
    order.status = 'new';
  } else throw new HttpError(400, 'وضعیت نامعتبر است');
  db.saveNow();
  return order;
}

/* ───── بازگردانی پشتیبان: هر رکورد دوباره بررسی می‌شود (فایل پشتیبان ممکن است ناقص یا دست‌کاری‌شده باشد) ───── */

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const IMAGE_NAME = /^[\w-]+\.(png|jpg|webp|gif)$/;

function normalizeApp(a) {
  const color = isColor(a.color) ? a.color.toLowerCase() : '#3b6cff';
  const now = new Date().toISOString();
  return {
    id: str(a.id, 20), slug: slugify(a.slug), name: str(a.name, 80) || 'بدون نام',
    tagline: str(a.tagline, 140), description: str(a.description, 6000), category: str(a.category, 40),
    color, color2: isColor(a.color2) ? a.color2.toLowerCase() : shiftColor(color), scene: has(SCENES, a.scene) ? a.scene : 'code',
    status: APP_STATUS.includes(a.status) ? a.status : 'draft', featured: !!a.featured, sample: a.sample === true, order: int(a.order, 0, 9999, 0), watchDir: str(a.watchDir, 400),
    features: list(a.features, 24).filter(isObj).map((f) => ({ icon: pickIcon(f.icon), title: str(f.title, 80), text: str(f.text, 300) })).filter((f) => f.title),
    badges: cleanBadges(a.badges),
    blocks: cleanBlocks(a.blocks, [], BLOCK_LIMITS.app, { trustImages: true }),
    testimonials: list(a.testimonials, 12).filter(isObj).map((t) => ({ name: str(t.name, 60), role: str(t.role, 80), text: str(t.text, 500) })).filter((t) => t.name && t.text),
    faq: list(a.faq, 20).filter(isObj).map((f) => ({ q: str(f.q, 200), a: str(f.a, 1500) })).filter((f) => f.q && f.a),
    plans: list(a.plans, 12).filter(isObj).map((p) => { try { return cleanPlan(p, typeof p.id === 'string' && p.id ? { id: str(p.id, 20) } : null); } catch (_) { return null; } }).filter(Boolean),
    icon: typeof a.icon === 'string' && IMAGE_NAME.test(a.icon) ? a.icon : '',
    screenshots: list(a.screenshots, 12).filter((x) => isObj(x) && typeof x.file === 'string' && IMAGE_NAME.test(x.file)).map((x) => ({ id: str(x.id, 12) || id(6), file: x.file, w: int(x.w, 0, 20000), h: int(x.h, 0, 20000), caption: str(x.caption, 100) })),
    versions: list(a.versions, 1000).filter((v) => isObj(v) && typeof v.id === 'string' && typeof v.file === 'string').map((v) => ({
      id: str(v.id, 20), version: str(v.version, 40).replace(/[^\w.+-]/g, ''), code: Number.isFinite(v.code) ? v.code : null,
      platform: has(PLATFORMS, v.platform) ? v.platform : 'other', file: str(v.file, 160).replace(/^.*[\\/]/, '').replace(/[^\w.-]/g, '_'), fileName: str(v.fileName, 160),
      ext: str(v.ext, 12).replace(/[^a-z0-9]/gi, ''), size: int(v.size, 0), sha256: str(v.sha256, 64).replace(/[^a-f0-9]/gi, ''),
      notes: str(v.notes, 4000), package: str(v.package, 200), minOs: str(v.minOs, 60), source: str(v.source, 20), via: str(v.via, 12),
      published: !!v.published, publishedAt: isoOrNull(v.publishedAt) || now, downloads: int(v.downloads, 0),
    })),
    createdAt: isoOrNull(a.createdAt) || now, updatedAt: isoOrNull(a.updatedAt) || now,
  };
}

function normalizeOrder(o) {
  return {
    id: str(o.id, 20), no: int(o.no, 0, 1e9), appId: str(o.appId, 20), appName: str(o.appName, 80), planId: str(o.planId, 20), planName: str(o.planName, 60),
    period: str(o.period, 12), days: int(o.days, 0, 36500), name: str(o.name, 80), phone: str(o.phone, 24), email: str(o.email, 120), note: str(o.note, 500), adminNote: str(o.adminNote, 500),
    coupon: str(o.coupon, 32), couponCounted: !!o.couponCounted, base: int(o.base, 0), planOff: int(o.planOff, 0), couponOff: int(o.couponOff, 0), total: int(o.total, 0),
    status: ['new', 'paid', 'cancelled'].includes(o.status) ? o.status : 'new', createdAt: isoOrNull(o.createdAt) || new Date().toISOString(), paidAt: isoOrNull(o.paidAt),
    licenseId: typeof o.licenseId === 'string' ? str(o.licenseId, 20) : null, ip: str(o.ip, 64),
  };
}

function normalizeLicense(l) {
  const startAt = isoOrNull(l.startAt) || new Date().toISOString();
  return {
    id: str(l.id, 20), code: str(l.code, 40).toUpperCase().replace(/[^A-Z0-9-]/g, ''), appId: str(l.appId, 20), planName: str(l.planName, 60), days: int(l.days, 0, 36500),
    customer: str(l.customer, 80), phone: str(l.phone, 24), orderId: typeof l.orderId === 'string' ? str(l.orderId, 20) : null, note: str(l.note, 200),
    startAt, endAt: isoOrNull(l.endAt), status: l.status === 'revoked' ? 'revoked' : 'active', createdAt: isoOrNull(l.createdAt) || startAt,
  };
}

// کل محتوای یک پشتیبان را بررسی و آمادهٔ جایگزینی می‌کند
function normalizeBackup(src) {
  const rows = (k) => (Array.isArray(src[k]) ? src[k] : []).filter((x) => isObj(x) && typeof x.id === 'string' && x.id);
  const seen = new Set();
  const apps = rows('apps').slice(0, 500).map(normalizeApp).filter((a) => {
    if (!a.slug) a.slug = `app-${a.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || id(4).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
    for (let n = 2, root = a.slug; seen.has(a.slug); n++) a.slug = `${root.slice(0, 40)}-${n}`;
    seen.add(a.slug);
    // پوشهٔ ساخت از پشتیبان برنمی‌گردد: پشتیبانِ دست‌کاری‌شده نباید پوشهٔ دلخواهی را منتشر کند
    a.watchDir = '';
    return true;
  });
  const coupons = [];
  for (const c of rows('coupons').slice(0, 2000)) { try { const x = cleanCoupon(c, { id: str(c.id, 20), used: int(c.used, 0), createdAt: isoOrNull(c.createdAt) || new Date().toISOString() }, coupons); coupons.push(x); } catch (_) { /* کد خراب کنار گذاشته می‌شود */ } }
  const licenses = rows('licenses').slice(0, 100000).map(normalizeLicense).filter((l) => l.code);
  // صفحهٔ اصلی و صفحه‌های دلخواه. پشتیبانِ قدیمی که این‌ها را ندارد، آن‌ها را خالی برمی‌گرداند (بازگردانی یعنی جایگزینی).
  const home = { blocks: cleanBlocks(isObj(src.home) ? src.home.blocks : [], [], BLOCK_LIMITS.home, { trustImages: true }) };
  const taken = new Set(), now = new Date().toISOString();
  const pages = rows('pages').slice(0, BLOCK_LIMITS.pages).map((p) => {
    let slug = slugify(p.slug);
    if (!slug || PAGE_RESERVED.includes(slug)) slug = `page-${str(p.id, 20).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || id(4).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
    for (let n = 2, root = slug; taken.has(slug); n++) slug = `${root.slice(0, 40)}-${n}`;
    taken.add(slug);
    return {
      id: str(p.id, 20), slug, title: str(p.title, 80) || 'بدون عنوان', description: str(p.description, 300), nav: !!p.nav,
      status: PAGE_STATUS.includes(p.status) ? p.status : 'draft', blocks: cleanBlocks(p.blocks, [], BLOCK_LIMITS.page, { trustImages: true }),
      createdAt: isoOrNull(p.createdAt) || now, updatedAt: isoOrNull(p.updatedAt) || now,
    };
  });
  return { apps, coupons, orders: rows('orders').slice(0, 100000).map(normalizeOrder), licenses, home, pages };
}

module.exports = {
  PERIODS, APP_STATUS, SCENES, shiftColor, PLATFORMS, cleanApp, cleanPlan, cleanCoupon, publishedVersions, latestByPlatform, latestVersion, platformFromUA,
  planPrice, discountActive, quote, couponProblem, couponLoad, amount, normalizeBackup, createOrder, createLicense, licenseState, setOrderStatus, endDate,
  BLOCK_TYPES, BLOCK_LIMITS, PAGE_STATUS, PAGE_RESERVED, cleanBlocks, cleanPage, cleanBadges,
};
