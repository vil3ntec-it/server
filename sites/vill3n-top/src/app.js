'use strict';
// سرهم‌کردن سایت: صفحه‌های عمومی، دانلود، API عمومی و پنل مالک.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { App, HttpError, Assets, sendFile, precompress, MIME, CSP } = require('./core/http');
const { DB } = require('./core/db');
const { Auth } = require('./core/auth');
const { Files } = require('./core/files');
const model = require('./core/model');
const views = require('./views');
const { str, num, faDate, bytes, toLatinDigits } = require('./core/util');
const { PLATFORMS } = require('./core/detect');
const { seed } = require('./seed');
const { ensureFont, fontFile } = require('./font');
const ai = require('./ai');

const VERSION = require('../package.json').version;
const BOT = /bot|crawl|spider|slurp|preview|monitor|curl|wget|python|headless/i;

function createSite({ dataDir, publicDir, config = {} }) {
  const db = new DB(dataDir);
  if (db.fresh && config.seed !== false) seed(db);
  const assets = new Assets(path.join(publicDir, 'assets'));
  const app = new App({ trustProxy: !!config.trustProxy, proxy: config.proxy === 'cloudflare' ? 'cloudflare' : '' });
  const auth = new Auth(db, { dataDir });
  const files = new Files(db, dataDir);
  files.verify();
  const L = app.limiter;
  const pages = new Map();

  // اسکریپت کوچکِ حالت روشن/تیره داخل خودِ صفحه گذاشته می‌شود (یک درخواست کمتر پیش از نقاشی صفحه)
  // و اثر انگشتش در سیاست امنیتی می‌آید تا هیچ اسکریپت درون‌خطیِ دیگری اجازهٔ اجرا نداشته باشد.
  const themeInline = fs.readFileSync(path.join(publicDir, 'assets', 'theme.js'), 'utf8').replace(/^\/\/.*$/gm, '').replace(/\s*\n\s*/g, '').replace(/<\/script/gi, '<\\/script');
  const sha = (text) => `'sha256-${crypto.createHash('sha256').update(text).digest('base64')}'`;
  app.csp = CSP.replace("script-src 'self'", `script-src 'self' ${sha(themeInline)} ${sha(views.SPEC_RULES)}`);

  const publicApps = () => db.data.apps.filter((a) => a.status === 'published' || a.status === 'soon')
    .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.order - b.order);
  const publicPages = () => (Array.isArray(db.data.pages) ? db.data.pages : []).filter((p) => p && p.status === 'published');
  const env = (extra) => Object.assign({ settings: db.data.settings, assets, apps: publicApps(), pages: publicPages(), home: db.data.home || { blocks: [] }, themeInline }, extra);
  const findApp = (slug) => publicApps().find((a) => a.slug === slug);

  function page(ctx, key, render, status = 200) {
    let hit = pages.get(key);
    if (!hit || hit.rev !== db.rev || Date.now() - hit.at > 30000) {
      hit = { rev: db.rev, at: Date.now(), pre: precompress(Buffer.from(render(), 'utf8')) };
      pages.set(key, hit);
      if (pages.size > 300) pages.delete(pages.keys().next().value);
    }
    ctx.sendPre(status, hit.pre, 'text/html; charset=utf-8', { 'Cache-Control': 'public, max-age=0, must-revalidate' });
  }

  // وضعیت یک کد فعال‌سازی (برای API عمومی و برای صفحهٔ «بررسی اشتراک» بدون جاوااسکریپت)
  function licenseInfo(code) {
    const lic = db.data.licenses.find((l) => l.code === code);
    if (!lic) return { ok: true, found: false, state: 'unknown' };
    const a = db.data.apps.find((x) => x.id === lic.appId);
    const state = model.licenseState(lic);
    return { ok: true, found: true, state, valid: state === 'active', app: a ? a.name : '', appSlug: a ? a.slug : '', plan: lic.planName, startAt: lic.startAt, endAt: lic.endAt, lifetime: !lic.endAt, endFa: lic.endAt ? faDate(lic.endAt) : 'دایمی', daysLeft: lic.endAt ? Math.max(0, Math.ceil((new Date(lic.endAt) - Date.now()) / 86400000)) : null, now: new Date().toISOString() };
  }
  const cors = (ctx) => ctx.header('Access-Control-Allow-Origin', '*');
  const isAdminHost = (ctx) => /^admin\./.test(ctx.host);
  const adminHtml = (ctx) => ctx.html(views.adminShell(env()), 200, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });

  app.errorPage = (ctx, status, message) => views.errorPage(env(), status, message);
  app.notFound = (ctx) => {
    // فایل کلید IndexNow (مالکیت دامنه را به موتور جست‌وجو ثابت می‌کند)
    if (ctx.path === `/${db.data.meta.indexNowKey}.txt`) return ctx.send(200, db.data.meta.indexNowKey, 'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=86400' });
    if (ctx.path.startsWith('/api/')) throw new HttpError(404, 'پیدا نشد');
    page(ctx, 'e404', () => views.errorPage(env(), 404, ''), 404);
  };

  app.before = (ctx) => {
    // admin.vill3n.top → فقط پنل
    if (isAdminHost(ctx) && ctx.method === 'GET' && !/^\/(api|assets|media|healthz|admin)(\/|$)/.test(ctx.path)) { adminHtml(ctx); return true; }
    return false;
  };

  /* ───────────── فایل‌های ایستا ───────────── */

  app.get('/assets/*', (ctx) => {
    const a = assets.get(ctx.params.rest);
    if (!a) throw new HttpError(404, 'پیدا نشد');
    const cache = ctx.query.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
    if (a.br || a.gz) ctx.sendPre(200, a, a.type, { 'Cache-Control': cache });
    else {
      if (ctx.req.headers['if-none-match'] === a.etag) { ctx.res.statusCode = 304; ctx.res.setHeader('ETag', a.etag); return ctx.res.end(); }
      ctx.send(200, a.raw, a.type, { 'Cache-Control': cache, ETag: a.etag });
    }
  });

  app.get('/media/:file', (ctx) => {
    const name = ctx.params.file;
    if (!/^[\w-]+\.(png|jpg|webp|gif|mp4|webm)$/.test(name)) throw new HttpError(404, 'پیدا نشد');
    sendFile(ctx, files.imagePath(name), { type: MIME[path.extname(name)] || { '.mp4': 'video/mp4', '.webm': 'video/webm' }[path.extname(name)] || 'application/octet-stream', cache: 'public, max-age=31536000, immutable' });
  });

  app.get('/favicon.ico', (ctx) => ctx.redirect(assets.url('favicon.svg'), 302));
  app.get('/robots.txt', (ctx) => ctx.send(200, ai.robots(env()), 'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' }));
  // متن ساده برای هوش مصنوعی
  const aiOff = () => db.data.settings.allowAI === false;
  app.get('/llms.txt', (ctx) => { if (aiOff()) return app.notFound(ctx); ctx.send(200, ai.llms(env()), 'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=600' }); });
  app.get('/llms-full.txt', (ctx) => { if (aiOff()) return app.notFound(ctx); ctx.send(200, ai.llms(env(), true), 'text/plain; charset=utf-8', { 'Cache-Control': 'public, max-age=600' }); });
  app.get('/api/openapi.json', (ctx) => { cors(ctx); ctx.send(200, JSON.stringify(ai.openapi(env())), 'application/json; charset=utf-8', { 'Cache-Control': 'public, max-age=3600' }); });

  app.get('/sitemap.xml', (ctx) => ctx.send(200, views.sitemap(env()), 'application/xml; charset=utf-8', { 'Cache-Control': 'public, max-age=600' }));
  app.get('/site.webmanifest', (ctx) => {
    const s = db.data.settings;
    ctx.send(200, JSON.stringify({ name: `${s.brand} — ${s.slogan}`, short_name: s.brand, lang: 'fa', dir: 'rtl', start_url: '/', display: 'browser', background_color: '#000000', theme_color: '#000000', icons: [{ src: assets.url('favicon.svg'), sizes: 'any', type: 'image/svg+xml' }] }), 'application/manifest+json', { 'Cache-Control': 'public, max-age=3600' });
  });
  // نسخه فقط برای خودِ همین کامپیوتر؛ بیرون فقط «زنده‌ام» (نسخه نشان نمی‌دهد چه چیزی وصله نشده)
  app.get('/healthz', (ctx) => ctx.json(ctx.local ? { ok: true, instance: db.data.meta.instance.slice(0, 8), version: VERSION } : { ok: true, instance: db.data.meta.instance.slice(0, 8) }));

  /* ───────────── صفحه‌ها ───────────── */

  app.get('/', (ctx) => page(ctx, 'home', () => views.home(env())));
  app.get('/check', (ctx) => {
    const code = toLatinDigits(str(ctx.query.get('code'), 40)).toUpperCase().replace(/\s+/g, '');
    if (!code) return page(ctx, 'check', () => views.checkPage(env()));
    // کد در نشانی آمده (فرم بدون جاوااسکریپت): نتیجه روی سرور ساخته می‌شود، با همان محدودیتِ API
    let verdict;
    if (code.length < 8) verdict = { ok: false, title: 'کد کامل نیست', lines: ['کد فعال‌سازی را کامل بنویسید.'] };
    else if (!L.hit(`lic:${ctx.ipKey}`, 30, 10 * 60 * 1000)) verdict = { ok: false, title: 'درخواست زیاد بود', lines: ['چند دقیقه صبر کنید و دوباره تلاش کنید.'] };
    else {
      const j = licenseInfo(code);
      const head = `${j.app} — ${j.plan}`;
      if (!j.found) verdict = { ok: false, title: 'این کد پیدا نشد', lines: ['کد را دوباره بررسی کنید یا با ما تماس بگیرید.'] };
      else if (j.state === 'active') verdict = { ok: true, title: 'اشتراک فعال است', lines: [head, j.lifetime ? 'این اشتراک دایمی است.' : `تا ${j.endFa} (${num(j.daysLeft)} روز دیگر)`] };
      else if (j.state === 'expired') verdict = { ok: false, title: 'اشتراک تمام شده است', lines: [head, `پایان: ${j.endFa}. برای تمدید با ما تماس بگیرید.`] };
      else verdict = { ok: false, title: 'این اشتراک باطل شده است', lines: [head, 'برای پیگیری با ما تماس بگیرید.'] };
    }
    ctx.html(views.checkPage(env(), verdict), 200, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  });
  app.get('/app/:slug', (ctx) => {
    if (ctx.params.slug.endsWith('.md')) {
      const m = findApp(ctx.params.slug.slice(0, -3));
      if (!m || aiOff()) return app.notFound(ctx);
      return ctx.send(200, ai.appMarkdown(env(), m), 'text/markdown; charset=utf-8', { 'Cache-Control': 'public, max-age=600', 'X-Robots-Tag': 'noindex' });
    }
    const a = findApp(ctx.params.slug);
    if (!a) return app.notFound(ctx);
    // بازدید واقعی شمرده می‌شود، نه ربات و نه پیش‌بارگذاری مرورگر
    if (ctx.method === 'GET' && !ctx.req.headers['sec-purpose'] && !BOT.test(ctx.ua) && L.hit(`view:${ctx.ipKey}:${a.id}`, 1, 10 * 60 * 1000)) db.bump('views', a.id);
    page(ctx, `app:${a.slug}`, () => views.appPage(env(), a));
  });
  // صفحه‌های دلخواه مالک (ساخته‌شده از «بخش‌ها» در پنل)
  app.get('/p/:slug', (ctx) => {
    const md = ctx.params.slug.endsWith('.md');
    const pg = publicPages().find((x) => x.slug === (md ? ctx.params.slug.slice(0, -3) : ctx.params.slug));
    if (!pg || (md && aiOff())) return app.notFound(ctx);
    if (md) return ctx.send(200, ai.pageMarkdown(env(), pg), 'text/markdown; charset=utf-8', { 'Cache-Control': 'public, max-age=600', 'X-Robots-Tag': 'noindex' });
    page(ctx, `page:${pg.slug}`, () => views.customPage(env(), pg));
  });
  for (const p of ['/admin', '/admin/*']) app.get(p, adminHtml);

  /* ───────────── دانلود ───────────── */

  function download(ctx) {
    const a = db.data.apps.find((x) => x.slug === ctx.params.slug && x.status === 'published');
    if (!a) throw new HttpError(404, 'برنامه پیدا نشد');
    const vid = ctx.params.vid;
    const asked = str(ctx.query.get('p'), 16);
    // پلتفرمِ خواسته‌شده دقیق است؛ فقط وقتی از روی دستگاه حدس می‌زنیم، نسخهٔ تازه‌ترِ دیگر جایگزین می‌شود
    const v = vid ? model.publishedVersions(a).find((x) => x.id === vid)
      : asked ? model.latestVersion(a, asked, { strict: true }) : model.latestVersion(a, model.platformFromUA(ctx.ua));
    if (!v) throw new HttpError(404, 'این نسخه برای دانلود موجود نیست');
    if (!L.hit(`dl:${ctx.ipKey}`, 120, 10 * 60 * 1000)) throw new HttpError(429, 'دانلود زیاد بود. چند دقیقهٔ دیگر دوباره تلاش کنید.');
    ctx.header('X-Checksum-Sha256', v.sha256).header('X-Robots-Tag', 'noindex');
    sendFile(ctx, files.filePath(v), {
      downloadName: `${a.slug}-${v.version}.${v.ext}`, cache: 'private, max-age=0', etag: `"${v.sha256.slice(0, 32)}"`,
      onStart: () => {
        if (ctx.method !== 'GET' || BOT.test(ctx.ua) || !L.hit(`dlc:${ctx.ipKey}:${v.id}`, 1, 60000)) return;
        v.downloads = (v.downloads || 0) + 1;
        db.bump('downloads', a.id);
      },
    });
  }
  app.get('/download/:slug', download);
  app.get('/download/:slug/:vid', download);

  /* ───────────── API عمومی ───────────── */

  const needJson = (ctx) => { if (!/application\/json/i.test(String(ctx.req.headers['content-type'] || ''))) throw new HttpError(415, 'نوع درخواست باید JSON باشد'); };
  const versionOut = (a, v, origin) => ({ version: v.version, code: v.code, platform: v.platform, size: v.size, sha256: v.sha256, publishedAt: v.publishedAt, notes: v.notes, minOs: v.minOs, url: `${origin}/download/${a.slug}/${v.id}` });

  // فهرست برنامه‌ها و آخرین نسخه‌ها — برای «بررسی به‌روزرسانی» از داخل خودِ برنامه‌ها
  app.get('/api/apps', (ctx) => {
    cors(ctx);
    const origin = db.data.settings.siteUrl.replace(/\/+$/, '') || ctx.origin;
    ctx.json({ ok: true, apps: publicApps().map((a) => ({ slug: a.slug, name: a.name, tagline: a.tagline, status: a.status, page: `${origin}/app/${a.slug}`, latest: Object.fromEntries(Object.entries(model.latestByPlatform(a)).map(([p, v]) => [p, versionOut(a, v, origin)])) })) });
  });
  app.get('/api/apps/:slug/latest', (ctx) => {
    cors(ctx);
    const a = findApp(ctx.params.slug);
    if (!a) throw new HttpError(404, 'برنامه پیدا نشد');
    const v = model.latestVersion(a, str(ctx.query.get('platform'), 16), { strict: true });
    if (!v) return ctx.json({ ok: true, latest: null, update: false });
    const origin = db.data.settings.siteUrl.replace(/\/+$/, '') || ctx.origin;
    const current = str(ctx.query.get('current'), 40).replace(/^v/i, '');
    ctx.json({ ok: true, latest: versionOut(a, v, origin), update: current ? require('./core/util').cmpVersion(v.version, current) > 0 : null });
  });

  app.post('/api/quote', async (ctx) => {
    needJson(ctx);
    if (!L.hit(`quote:${ctx.ipKey}`, 40, 10 * 60 * 1000)) throw new HttpError(429, 'درخواست زیاد بود. چند دقیقه صبر کنید.');
    const b = await ctx.readJson(8192);
    const q = model.quote(db.data, str(b.appId, 20), str(b.planId, 20), b.coupon);
    ctx.json({ ok: true, base: q.base, planOff: q.planOff, couponOff: q.couponOff, total: q.total, couponError: q.couponError, coupon: q.coupon ? q.coupon.code : '' });
  });

  app.post('/api/order', async (ctx) => {
    needJson(ctx);
    const b = await ctx.readJson(8192);
    if (str(b.website, 100)) return ctx.json({ ok: true, no: 0, total: 0 }); // تلهٔ ربات: فرم پنهان پر شده است
    const busy = 'سفارش زیاد ثبت شد. کمی بعد دوباره تلاش کنید یا با ما تماس بگیرید.';
    // هر نشانی: ۳۰ تلاش و ۶ سفارشِ ثبت‌شده در ساعت. سقف کلی فقط سفارش‌های واقعاً ثبت‌شده را می‌شمارد،
    // تا درخواست‌های خرابِ یک نفر جلوی سفارش مشتری‌های دیگر را نگیرد.
    if (!L.hit(`order-try:${ctx.ipKey}`, 30, 60 * 60 * 1000) || !L.peek(`order:${ctx.ipKey}`, 6) || !L.peek('order:all', 400)) throw new HttpError(429, busy);
    const { order, duplicate } = model.createOrder(db, b, ctx.ip);
    if (!duplicate) { L.hit(`order:${ctx.ipKey}`, 6, 60 * 60 * 1000); L.hit('order:all', 400, 60 * 60 * 1000); }
    ctx.json({ ok: true, no: order.no, total: order.total, plan: order.planName, duplicate });
  });

  app.get('/api/license/:code', (ctx) => {
    cors(ctx);
    if (!L.hit(`lic:${ctx.ipKey}`, 30, 10 * 60 * 1000)) throw new HttpError(429, 'درخواست زیاد بود. چند دقیقه صبر کنید.');
    ctx.json(licenseInfo(toLatinDigits(str(ctx.params.code, 40)).toUpperCase().replace(/\s+/g, '')));
  });

  const site = { app, db, auth, files, assets };
  const indexNow = ai.indexNow(site, env);
  require('./admin')({ app, db, auth, files, assets, env, dataDir, config, VERSION, pages, indexNow });

  let fontTimer = null;
  function start() {
    files.start();
    if (db.data.settings.autoFont === false) return;
    // فونت وزیرمتن: اگر کنار سایت نیست، همین حالا و بعد هر ۲۰ دقیقه (تا وقتی اینترنت وصل شود) گرفته می‌شود
    const tryFont = () => ensureFont(assets, { background: true }).then((r) => { if (r && r.ok) { db.rev++; clearInterval(fontTimer); } }).catch(() => {});
    tryFont();
    fontTimer = setInterval(() => { if (fontFile(assets)) clearInterval(fontTimer); else tryFont(); }, 20 * 60 * 1000);
    if (fontTimer.unref) fontTimer.unref();
  }
  function stop() { try { clearInterval(files.timer); clearInterval(fontTimer); indexNow.stop(); } catch (_) { /* نبود */ } db.flush(); }

  return Object.assign(site, { indexNow, start, stop, handler: (req, res) => app.handle(req, res) });
}

function listen(site, { port, host }) {
  const server = http.createServer(site.handler);
  server.requestTimeout = 15 * 60 * 1000; // هر درخواست حداکثر ۱۵ دقیقه (فایل‌های بزرگ تکه‌تکه می‌آیند، پس کافی است)
  server.headersTimeout = 30000;
  server.keepAliveTimeout = 65000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    const done = () => { server.removeListener('error', reject); resolve(server); };
    if (port === 'passenger' || typeof port === 'string' && !/^\d+$/.test(port)) server.listen(port, done);
    else server.listen(Number(port), host, done);
  });
}

module.exports = { createSite, listen, VERSION, num, bytes, PLATFORMS };
