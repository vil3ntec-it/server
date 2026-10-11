'use strict';
// دیده‌شدن در جست‌وجو و هوش مصنوعی:
//   /llms.txt و /llms-full.txt   خلاصه و متن کامل سایت به‌صورت ساده (برای ChatGPT، Claude، Gemini، Perplexity و …)
//   /app/<نشانی>.md              متن سادهٔ هر برنامه
//   /api/openapi.json            توضیح ماشینیِ API عمومی
//   robots.txt                   اجازهٔ صریح به خزنده‌های جست‌وجو و هوش مصنوعی
//   IndexNow                     خبر دادن فوری تغییرها به Bing و موتورهای هم‌پیمان
const { faDate, bytes, num } = require('./core/util');
const { PLATFORMS } = require('./core/detect');
const { latestByPlatform, publishedVersions, planPrice } = require('./core/model');
const { base } = require('./views');

const AI_BOTS = [
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot', 'anthropic-ai',
  'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'GoogleOther', 'Applebot-Extended', 'Amazonbot',
  'Meta-ExternalAgent', 'DuckAssistBot', 'MistralAI-User', 'cohere-ai', 'YouBot', 'CCBot', 'Bytespider', 'DeepSeekBot',
];

function robots(env) {
  const s = env.settings;
  const rules = 'Allow: /\nDisallow: /admin\nDisallow: /api/admin\nDisallow: /download/\n';
  let out = `User-agent: *\n${rules}\n`;
  out += s.allowAI === false
    ? `# خزنده‌های هوش مصنوعی به خواست مالک بسته‌اند\n${AI_BOTS.map((b) => `User-agent: ${b}`).join('\n')}\nDisallow: /\n\n`
    : `# خزنده‌های هوش مصنوعی و جست‌وجو خوش آمدید — خلاصهٔ سایت: ${base(env)}/llms.txt\n${AI_BOTS.map((b) => `User-agent: ${b}`).join('\n')}\n${rules}\n`;
  return `${out}Sitemap: ${base(env)}/sitemap.xml\n`;
}

const md = (t) => String(t || '').replace(/\r/g, '').trim();
const price = (n, s) => (n === 0 ? 'رایگان' : `${num(n)} ${s.currency}`);

/* ───── بخش‌های صفحه به‌صورت Markdown ───── */

const one = (t) => md(t).replace(/\s*\n+\s*/g, ' ');           // متن یک‌خطی (برای فهرست و جدول)
const cell = (t) => one(t).replace(/\|/g, '\\|') || ' ';       // خانهٔ جدول
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
// پیوند درون‌سایتی با نشانی کامل نوشته می‌شود تا بیرون از سایت هم کار کند
const link = (href, b) => (/^\//.test(href) && !/^\/\//.test(href) ? `${b}${href}` : href);

// blocks: همان آرایهٔ بخش‌ها (app.blocks ، home.blocks ، page.blocks)
// level: شمارهٔ تیترِ عنوان هر بخش (۲ یعنی «##»).  b: نشانی پایهٔ سایت برای تصویر و پیوندها (اختیاری)
function blocksMarkdown(blocks, level = 2, b = '') {
  const H = '#'.repeat(Math.min(6, Math.max(1, Number(level) || 2)));
  const out = [];
  for (const k of arr(blocks)) {
    const part = [];
    if (k.title) part.push(`${H} ${one(k.title)}`, '');
    if (k.intro) part.push(md(k.intro), '');
    switch (k.type) {
      case 'text':
        if (k.body) part.push(md(k.body), '');
        break;
      case 'cards':
        for (const x of arr(k.items)) part.push(`- **${one(x.title)}**${x.text ? `: ${one(x.text)}` : ''}`);
        part.push('');
        break;
      case 'table': {
        const head = Array.isArray(k.head) ? k.head : [];
        if (!head.length) break;
        part.push(`| ${head.map(cell).join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
        for (const r of Array.isArray(k.rows) ? k.rows : []) if (Array.isArray(r)) part.push(`| ${head.map((_, i) => cell(r[i])).join(' | ')} |`);
        part.push('');
        if (k.note) part.push(md(k.note), '');
        break;
      }
      case 'stats':
        for (const x of arr(k.items)) part.push(`- **${one(x.value)}** ${one(x.label)}`);
        part.push('');
        break;
      case 'steps':
        arr(k.items).forEach((x, i) => part.push(`${i + 1}. **${one(x.title)}**${x.text ? `: ${one(x.text)}` : ''}`));
        part.push('');
        break;
      case 'image':
        if (k.image && k.image.file) part.push(`![${one(k.alt || k.title || 'تصویر').replace(/[[\]]/g, '')}](${b}/media/${k.image.file})`, '');
        if (k.text) part.push(md(k.text), '');
        break;
      case 'quote':
        if (k.text) part.push(md(k.text).split('\n').map((l) => `> ${l}`).join('\n') + (k.by ? `\n>\n> — ${one(k.by)}${k.role ? `، ${one(k.role)}` : ''}` : ''), '');
        break;
      case 'video':
        if (k.video && k.video.file) part.push(`[ویدیو${k.caption ? `: ${one(k.caption).replace(/[[\]]/g, '')}` : ''}](${b}/media/${k.video.file})`, '');
        else if (k.caption) part.push(md(k.caption), '');
        break;
      case 'reviews':
        for (const x of arr(k.items)) if (x && x.text) part.push(md(x.text).split('\n').map((l) => `> ${l}`).join('\n') + (x.by ? `\n>\n> — ${one(x.by)}${x.role ? `، ${one(x.role)}` : ''}` : ''), '');
        break;
      case 'cta':
        if (k.text) part.push(md(k.text), '');
        if (k.label && k.href && !k.href.startsWith('#')) part.push(`[${one(k.label).replace(/[[\]]/g, '')}](${link(k.href, b)})`, '');
        else if (k.label) part.push(`**${one(k.label)}**`, '');
        break;
      case 'faq':
        for (const x of arr(k.items)) part.push(`**${one(x.q)}**`, '', md(x.a), '');
        break;
      default:
        continue; // نوع ناشناس (دادهٔ قدیمی یا دست‌کاری‌شده)
    }
    out.push(...part);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// صفحه‌های دلخواه و بخش‌های صفحهٔ اصلی. اگر در env نباشند، از پایگاه‌دادهٔ همین سایت خوانده می‌شوند
// (env.settings همان شیءِ db.data.settings است؛ indexNow آن را هنگام ساخت سایت ثبت می‌کند).
const dbOf = new WeakMap();
let lastDb = null;
function content(env) {
  const db = dbOf.get(env.settings) || lastDb;
  const d = db ? db.data : {};
  const home = env.home || d.home || {};
  const pages = Array.isArray(env.pages) ? env.pages : Array.isArray(d.pages) ? d.pages : [];
  return { home: Array.isArray(home.blocks) ? home.blocks : [], pages: pages.filter((p) => p && p.status === 'published' && p.slug) };
}

function pageMarkdown(env, page, level = 1) {
  const b = base(env), H = '#'.repeat(level);
  const out = [`${H} ${one(page.title)}`, '', `- صفحه: ${b}/p/${page.slug}`, ''];
  if (page.description) out.push(md(page.description), '');
  const body = blocksMarkdown(page.blocks, level + 1, b);
  if (body) out.push(body, '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function appMarkdown(env, app, level = 1) {
  const s = env.settings, b = base(env), H = '#'.repeat(level);
  const by = latestByPlatform(app);
  const versions = publishedVersions(app);
  const plans = app.plans.filter((p) => p.active);
  const out = [`${H} ${app.name}`, ''];
  if (app.tagline) out.push(`> ${md(app.tagline)}`, '');
  out.push(`- صفحه: ${b}/app/${app.slug}`, `- سازنده: ${s.brand}`, app.category ? `- دسته: ${app.category}` : '', `- وضعیت: ${Object.keys(by).length ? 'آمادهٔ دانلود' : 'به‌زودی'}`, '');
  if (app.description) out.push(md(app.description), '');
  if (Object.keys(by).length) {
    out.push(`${H}# دانلود آخرین نسخه`, '');
    for (const [p, v] of Object.entries(by)) out.push(`- ${PLATFORMS[p] || p}: نسخهٔ ${v.version}، ${bytes(v.size)}، منتشرشده در ${faDate(v.publishedAt)}${v.minOs ? `، ${v.minOs}` : ''} — ${b}/download/${app.slug}?p=${p} (SHA-256: ${v.sha256})`);
    out.push('');
  }
  if (app.features.length) {
    out.push(`${H}# ویژگی‌ها`, '');
    for (const f of app.features) out.push(`- **${md(f.title)}**${f.text ? `: ${md(f.text)}` : ''}`);
    out.push('');
  }
  const extra = blocksMarkdown(app.blocks, level + 1, b);
  if (extra) out.push(extra, '');
  if (plans.length) {
    out.push(`${H}# اشتراک‌ها و قیمت`, '');
    for (const p of plans) {
      const pp = planPrice(p);
      out.push(`- **${p.name}**${p.vip ? ' [VIP]' : ''} (${p.days ? `${num(p.days)} روز` : 'دایمی'}): ${price(pp.final, s)}${pp.off ? ` — ${num(pp.discount.percent)}٪ تخفیف از ${price(pp.base, s)}${pp.discount.to ? ` تا ${faDate(pp.discount.to)}` : ''}` : ''}${p.features.length ? ` — ${p.features.join('، ')}` : ''}`);
    }
    out.push('', `سفارش: در صفحهٔ برنامه دکمهٔ «سفارش این اشتراک» را بزنید. ${md(s.orderNote)}`, '');
  }
  if (versions.length) {
    out.push(`${H}# تاریخچهٔ نسخه‌ها`, '');
    for (const v of versions.slice(0, 12)) out.push(`- ${v.version} (${PLATFORMS[v.platform] || v.platform}، ${faDate(v.publishedAt)})${v.notes ? `: ${md(v.notes).replace(/\n+/g, '؛ ')}` : ''}`);
    out.push('');
  }
  if ((app.faq || []).length) {
    out.push(`${H}# پرسش‌های پرتکرار`, '');
    for (const f of app.faq) out.push(`**${md(f.q)}**`, '', md(f.a), '');
  }
  return out.filter((l) => l !== null && l !== undefined).join('\n').replace(/\n{3,}/g, '\n\n');
}

function contactLines(s) {
  return [s.phone ? `- تلفن: ${s.phone}` : '', s.whatsapp ? `- واتساپ: https://wa.me/${s.whatsapp.replace(/\D/g, '')}` : '', s.telegram ? `- تلگرام: https://t.me/${s.telegram.replace(/^@/, '')}` : '', s.email ? `- ایمیل: ${s.email}` : ''].filter(Boolean);
}

function llms(env, full = false) {
  const s = env.settings, b = base(env);
  const out = [
    `# ${s.brand}`, '',
    `> ${md(s.slogan)} — ${md(s.about)}`, '',
    `این سایت رسمی دانلود برنامه‌های ${s.brand} است. آخرین نسخهٔ هر برنامه، قیمت اشتراک‌ها و تاریخچهٔ نسخه‌ها این‌جاست. زبان سایت فارسی (دری) است.`, '',
    `${s.brand} is a software maker for Afghanistan and Persian/Dari speakers. This is its official download site: latest versions, subscription prices and changelogs for each app. Prices are in Afghani (AFN).`, '',
    '## برنامه‌ها', '',
  ];
  for (const a of env.apps) {
    const by = latestByPlatform(a);
    const latest = Object.entries(by).map(([p, v]) => `${PLATFORMS[p] || p} ${v.version}`).join('، ');
    out.push(`- [${a.name}](${b}/app/${a.slug}.md): ${md(a.tagline) || 'برنامه'}${latest ? ` — آخرین نسخه: ${latest}` : ' — به‌زودی'}`);
  }
  if (!env.apps.length) out.push('- هنوز برنامه‌ای منتشر نشده است.');
  const { home, pages } = content(env);
  out.push('', '## دادهٔ ماشینی', '',
    `- [فهرست برنامه‌ها و آخرین نسخه‌ها (JSON)](${b}/api/apps): نام، نشانی صفحه، نسخه، حجم، SHA-256 و پیوند دانلود هر پلتفرم`,
    `- [توضیح API (OpenAPI)](${b}/api/openapi.json)`,
    `- [متن کامل همهٔ برنامه‌ها](${b}/llms-full.txt)`,
    `- [نقشهٔ سایت](${b}/sitemap.xml)`, '',
    '## صفحه‌های دیگر', '',
    ...pages.map((p) => `- [${one(p.title).replace(/[[\]]/g, '')}](${b}/p/${p.slug})${p.description ? `: ${one(p.description)}` : ''}`),
    `- [بررسی اشتراک](${b}/check): وضعیت و تاریخ پایان اشتراک با کد فعال‌سازی`, '',
    '## تماس', '', ...contactLines(s), '');
  if (full) {
    const homeMd = blocksMarkdown(home, 3, b);
    if (homeMd) out.push('---', '', '## صفحهٔ اصلی', '', homeMd, '');
    for (const p of pages) out.push('---', '', pageMarkdown(env, p, 2), '');
    for (const a of env.apps) out.push('---', '', appMarkdown(env, a, 2), '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

function openapi(env) {
  const b = base(env);
  const version = { type: 'object', properties: { version: { type: 'string' }, code: { type: ['integer', 'null'] }, platform: { type: 'string' }, size: { type: 'integer' }, sha256: { type: 'string' }, publishedAt: { type: 'string', format: 'date-time' }, notes: { type: 'string' }, minOs: { type: 'string' }, url: { type: 'string', format: 'uri' } } };
  return {
    openapi: '3.1.0',
    info: { title: `${env.settings.brand} public API`, version: '1.0.0', description: 'Read-only catalogue of apps and their latest versions, plus subscription status lookup. No authentication. CORS enabled.' },
    servers: [{ url: b }],
    paths: {
      '/api/apps': { get: { operationId: 'listApps', summary: 'List all published apps with the latest version per platform', responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, apps: { type: 'array', items: { type: 'object', properties: { slug: { type: 'string' }, name: { type: 'string' }, tagline: { type: 'string' }, status: { type: 'string', enum: ['published', 'soon'] }, page: { type: 'string', format: 'uri' }, latest: { type: 'object', additionalProperties: version } } } } } } } } } } } },
      '/api/apps/{slug}/latest': { get: { operationId: 'latestVersion', summary: 'Latest version of one app (use for in-app update checks)', parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }, { name: 'platform', in: 'query', schema: { type: 'string', enum: Object.keys(PLATFORMS) } }, { name: 'current', in: 'query', description: 'Installed version; the response then says whether an update exists', schema: { type: 'string' } }], responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, latest: { oneOf: [version, { type: 'null' }] }, update: { type: ['boolean', 'null'] } } } } } }, 404: { description: 'Unknown app' } } } },
      '/api/license/{code}': { get: { operationId: 'checkLicense', summary: 'Check a subscription activation code', parameters: [{ name: 'code', in: 'path', required: true, schema: { type: 'string', example: 'V3-XXXX-XXXX-XXXX-XXXX' } }], responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, found: { type: 'boolean' }, state: { type: 'string', enum: ['active', 'expired', 'revoked', 'unknown'] }, valid: { type: 'boolean' }, app: { type: 'string' }, plan: { type: 'string' }, endAt: { type: ['string', 'null'], format: 'date-time' }, lifetime: { type: 'boolean' }, daysLeft: { type: ['integer', 'null'] }, now: { type: 'string', format: 'date-time' } } } } } }, 429: { description: 'Too many requests' } } } },
    },
  };
}

/* ───── IndexNow: خبر دادن تغییرها به موتورهای جست‌وجو (Bing، Yandex و …) ───── */

function indexNow(site, getEnv) {
  dbOf.set(site.db.data.settings, site.db); lastDb = site.db;
  const state = { last: null, rev: site.db.rev, pending: false };
  const eligible = () => {
    const s = site.db.data.settings;
    if (s.indexNow === false) return null;
    let u; try { u = new URL(s.siteUrl); } catch (_) { return null; }
    if (u.protocol !== 'https:' || /^(localhost|\d+\.\d+\.\d+\.\d+|\[.*\])$/.test(u.hostname) || !u.hostname.includes('.')) return null;
    return u;
  };
  async function submit() {
    const u = eligible();
    if (!u) return { ok: false, skipped: true };
    const env = getEnv();
    const key = site.db.data.meta.indexNowKey;
    const urlList = [`${u.origin}/`].concat(env.apps.map((a) => `${u.origin}/app/${a.slug}`), content(env).pages.map((p) => `${u.origin}/p/${p.slug}`));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10000);
    try {
      const r = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ host: u.hostname, key, keyLocation: `${u.origin}/${key}.txt`, urlList }), signal: ac.signal });
      state.last = { at: new Date().toISOString(), status: r.status, ok: r.status >= 200 && r.status < 300, urls: urlList.length };
    } catch (e) {
      state.last = { at: new Date().toISOString(), status: 0, ok: false, error: 'اتصال برقرار نشد' };
    } finally { clearTimeout(timer); }
    return state.last;
  }
  // هر تغییر محتوا، با کمی تأخیر و حداکثر هر ۱۰ دقیقه یک بار فرستاده می‌شود
  const timer = setInterval(() => {
    if (site.db.rev === state.rev) return;
    if (state.last && Date.now() - new Date(state.last.at).getTime() < 10 * 60 * 1000) return;
    state.rev = site.db.rev;
    submit().catch(() => {});
  }, 60 * 1000);
  if (timer.unref) timer.unref();
  return { submit, state, stop: () => clearInterval(timer), eligible: () => !!eligible() };
}

module.exports = { robots, llms, appMarkdown, pageMarkdown, blocksMarkdown, openapi, indexNow, AI_BOTS };
