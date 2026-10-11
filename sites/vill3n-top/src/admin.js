'use strict';
// API پنل مالک. همهٔ مسیرها (به‌جز وضعیت، راه‌اندازی و ورود) نشست معتبر می‌خواهند.
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const { HttpError } = require('./core/http');
const { verifyPassword } = require('./core/auth');
const { hashFile, VIDEO_MAX } = require('./core/files');
const model = require('./core/model');
const { str, int, bool, id, dayKey, toLatinDigits, isColor, slugify } = require('./core/util');
const { PLATFORMS, ALLOWED_EXT, SOURCE_LABEL } = require('./core/detect');
const { writeZip } = require('./core/zip');
const { fetchFont, saveFont, fontFile } = require('./font');
const { buildExport } = require('./export');
const { ICONS, PICK } = require('./icons');

// نشانه‌های قابل‌انتخاب، با شکل‌شان، برای انتخابگرِ پنل (تا شکل‌ها یک‌جا تعریف شده باشند)
const PICK_ICONS = Object.fromEntries(Object.keys(PICK).map((k) => [k, { label: PICK[k], svg: ICONS[k] || '' }]));
const BIG = 2 * 1024 * 1024; // سقف حجم فرم‌هایی که «بخش‌های صفحه» دارند (چند جدول بزرگ جا می‌شود)

const CHUNK = 8 * 1024 * 1024;

module.exports = function adminRoutes({ app, db, auth, files, assets, env, dataDir, config, VERSION, indexNow }) {
  const data = () => db.data;
  const L = app.limiter;
  const uploads = new Map();
  const A = '/api/admin';

  const authed = (fn) => async (ctx) => { const session = auth.require(ctx); ctx.session = session; ctx.header('Cache-Control', 'no-store'); return fn(ctx); };
  const getApp = (ctx) => { const a = data().apps.find((x) => x.id === ctx.params.id); if (!a) throw new HttpError(404, 'برنامه پیدا نشد'); return a; };

  const sweepUploads = setInterval(() => {
    const now = Date.now();
    for (const [k, u] of uploads) if (now - u.at > 3 * 3600 * 1000) { fs.unlink(u.tmp, () => {}); uploads.delete(k); }
  }, 10 * 60 * 1000);
  if (sweepUploads.unref) sweepUploads.unref();

  /* ───── تصویرِ بخش‌ها: فایل فقط وقتی پاک می‌شود که دیگر هیچ‌جا به کار نرفته باشد ───── */
  const homeData = () => { const d = data(); if (!d.home || typeof d.home !== 'object' || !Array.isArray(d.home.blocks)) d.home = { blocks: [] }; return d.home; };
  const pageList = () => { const d = data(); if (!Array.isArray(d.pages)) d.pages = []; return d.pages; };
  // همهٔ فایل‌های یک فهرست بخش: تصویر، ویدیو و تصویر پیش‌نمایشِ ویدیو
  const blockImages = (blocks) => (Array.isArray(blocks) ? blocks : []).flatMap((b) => (b ? [b.image, b.video, b.poster] : [])).filter((m) => m && typeof m.file === 'string' && m.file).map((m) => m.file);
  function imagesInUse() {
    const used = new Set();
    for (const a of data().apps) { if (a.icon) used.add(a.icon); for (const sh of a.screenshots || []) used.add(sh.file); for (const f of blockImages(a.blocks)) used.add(f); }
    for (const p of pageList()) for (const f of blockImages(p.blocks)) used.add(f);
    for (const f of blockImages(homeData().blocks)) used.add(f);
    return used;
  }
  // بعد از هر تغییر صدا زده می‌شود: نام‌هایی که قبلاً استفاده می‌شدند و حالا هیچ‌جا نیستند از دیسک پاک می‌شوند
  // (بخشِ کپی‌شده همان فایلِ تصویر را دارد؛ پس حذف یکی نباید تصویر دیگری را ببرد)
  function releaseImages(names) {
    const list = [...new Set((names || []).filter((n) => typeof n === 'string' && n))];
    if (!list.length) return;
    const used = imagesInUse();
    for (const n of list) if (!used.has(n)) files.removeImage(n);
  }

  function appOut(a) {
    return Object.assign({}, a, {
      blocks: a.blocks || [], badges: a.badges || [],
      versions: a.versions.map((v) => Object.assign({}, v, { platformLabel: PLATFORMS[v.platform] || v.platform, sourceLabel: SOURCE_LABEL[v.source] || '' })),
      inbox: path.join(dataDir, 'inbox', a.slug),
    });
  }
  function appSummary(a) {
    const latest = model.latestVersion(a, '', { any: true });
    return {
      id: a.id, slug: a.slug, name: a.name, tagline: a.tagline, status: a.status, featured: a.featured, sample: a.sample === true, untouched: untouchedSample(a), order: a.order, color: a.color, icon: a.icon, category: a.category,
      versions: a.versions.length, latest: latest ? latest.version : '', plans: a.plans.length,
      downloads: a.versions.reduce((n, v) => n + (v.downloads || 0), 0),
      attention: a.versions.filter((v) => !v.version || v.missing).length,
    };
  }

  /* ───────────── وضعیت، راه‌اندازی، ورود ───────────── */

  app.get(`${A}/state`, (ctx) => {
    const session = auth.session(ctx);
    const setup = auth.needsSetup();
    if (setup) auth.ensureSetupCode();
    // نشانی کامل پوشه فقط به خودِ کامپیوتر سرور گفته می‌شود؛ از بیرون فقط نام فایل
    ctx.json({ ok: true, setup, authed: !!session, brand: data().settings.brand, username: session ? auth.owner.username : '', version: VERSION, codeFile: setup ? (ctx.local ? path.join(dataDir, 'SETUP-CODE.txt') : 'data/SETUP-CODE.txt') : '' });
  });

  app.post(`${A}/setup`, async (ctx) => {
    auth.guardWrite(ctx);
    const b = await ctx.readJson(8192);
    auth.setup(ctx, { username: b.username, password: b.password, email: b.email, code: b.code });
    ctx.json({ ok: true });
  });

  app.post(`${A}/login`, async (ctx) => {
    auth.guardWrite(ctx);
    const b = await ctx.readJson(8192);
    const r = await auth.login(ctx, { username: b.username, password: b.password });
    ctx.json(Object.assign({ ok: true }, r));
  });

  app.post(`${A}/login/code`, async (ctx) => {
    auth.guardWrite(ctx);
    const b = await ctx.readJson(8192);
    auth.completeLogin(ctx, b.ticket, b.code);
    ctx.json({ ok: true, step: 'done' });
  });

  app.post(`${A}/logout`, (ctx) => { auth.guardWrite(ctx); auth.logout(ctx); ctx.json({ ok: true }); });

  /* ───────────── داشبورد ───────────── */

  app.get(`${A}/overview`, authed((ctx) => {
    const d = data();
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const key = dayKey(new Date(Date.now() - i * 86400000));
      const sum = (bucket) => Object.values(bucket[key] || {}).reduce((n, x) => n + x, 0);
      days.push({ day: key, downloads: sum(d.stats.downloads), views: sum(d.stats.views) });
    }
    const perApp = {};
    for (const x of days) for (const [aid, n] of Object.entries(d.stats.downloads[x.day] || {})) perApp[aid] = (perApp[aid] || 0) + n;
    const now = Date.now();
    const active = d.licenses.filter((l) => model.licenseState(l, now) === 'active');
    const expiring = active.filter((l) => l.endAt && new Date(l.endAt) - now < 7 * 86400000)
      .map((l) => ({ id: l.id, customer: l.customer, phone: l.phone, endAt: l.endAt, app: (d.apps.find((a) => a.id === l.appId) || {}).name || '' }));
    const paid = d.orders.filter((o) => o.status === 'paid');
    ctx.json({
      ok: true,
      totals: {
        apps: d.apps.length, published: d.apps.filter((a) => a.status === 'published').length,
        downloads: d.apps.reduce((n, a) => n + a.versions.reduce((m, v) => m + (v.downloads || 0), 0), 0),
        downloadsToday: days[29].downloads, downloads30: days.reduce((n, x) => n + x.downloads, 0), views30: days.reduce((n, x) => n + x.views, 0),
        newOrders: d.orders.filter((o) => o.status === 'new').length, paidOrders: paid.length, revenue: paid.reduce((n, o) => n + o.total, 0),
        activeLicenses: active.length,
      },
      days,
      topApps: Object.entries(perApp).map(([aid, n]) => ({ name: (d.apps.find((a) => a.id === aid) || {}).name || 'حذف‌شده', n })).sort((x, y) => y.n - x.n).slice(0, 6),
      recentOrders: d.orders.slice(0, 6),
      expiring,
      checklist: {
        font: !!fontFile(assets),
        files: d.apps.some((a) => model.latestVersion(a, '', { any: true })),
        plans: d.apps.some((a) => a.plans.length),
        published: d.apps.some((a) => a.status === 'published'),
        emailCode: !!(auth.owner.emailCode && auth.owner.emailCode.enabled),
      },
      attention: d.apps.flatMap((a) => a.versions.filter((v) => !v.version || v.missing).map((v) => ({ appId: a.id, app: a.name, file: v.fileName, reason: v.missing ? 'فایل روی دیسک نیست' : 'نسخه پیدا نشد' }))),
      lastScan: files.lastScan,
      currency: d.settings.currency,
    });
  }));

  /* ───────────── برنامه‌ها ───────────── */

  // همراه فهرست برنامه‌ها، دانسته‌های ثابتِ پنل هم می‌رود: صحنه‌ها، نوع بخش‌ها و نشانه‌های قابل‌انتخاب
  app.get(`${A}/apps`, authed((ctx) => ctx.json({ ok: true, apps: data().apps.slice().sort((a, b) => a.order - b.order).map(appSummary), platforms: PLATFORMS, periods: model.PERIODS, scenes: model.SCENES, blockTypes: model.BLOCK_TYPES, blockLimits: model.BLOCK_LIMITS, videoMaxMB: VIDEO_MAX / 1048576, icons: PICK_ICONS, currency: data().settings.currency, allowedExt: ALLOWED_EXT, chunk: CHUNK, maxUploadMB: data().settings.maxUploadMB })));
  app.get(`${A}/apps/:id`, authed((ctx) => ctx.json({ ok: true, app: appOut(getApp(ctx)) })));

  app.post(`${A}/apps`, authed(async (ctx) => {
    const b = await ctx.readJson(BIG);
    const a = model.cleanApp(b, null, data().apps);
    data().apps.push(a);
    files.ensureInbox();
    db.audit('app-create', a.name, ctx.ip);
    db.touch();
    ctx.json({ ok: true, app: appOut(a) });
  }));

  app.put(`${A}/apps/:id`, authed(async (ctx) => {
    const old = getApp(ctx);
    const b = await ctx.readJson(BIG);
    const a = model.cleanApp(b, old, data().apps);
    if (a.watchDir && a.watchDir !== old.watchDir) {
      if (!path.isAbsolute(a.watchDir)) throw new HttpError(400, 'نشانی پوشهٔ ساخت باید کامل باشد (مثل D:\\\\shop app\\\\release)');
      let st; try { st = fs.statSync(a.watchDir); } catch (_) { /* نبود */ }
      if (!st || !st.isDirectory()) throw new HttpError(400, 'پوشهٔ ساخت روی این سرور پیدا نشد');
    }
    data().apps[data().apps.indexOf(old)] = a;
    releaseImages(blockImages(old.blocks)); // تصویرِ بخش‌هایی که حذف شده‌اند
    files.ensureInbox();
    db.audit('app-update', a.name, ctx.ip);
    db.touch();
    ctx.json({ ok: true, app: appOut(a) });
  }));

  app.del(`${A}/apps/:id`, authed((ctx) => {
    const a = getApp(ctx);
    if (data().licenses.some((l) => l.appId === a.id && model.licenseState(l) === 'active') && ctx.query.get('force') !== '1') {
      throw new HttpError(409, 'این برنامه اشتراک فعال دارد. اگر مطمئن هستید دوباره حذف را تأیید کنید.', { needsForce: true });
    }
    data().apps = data().apps.filter((x) => x.id !== a.id);
    files.removeApp(a);
    releaseImages(blockImages(a.blocks));
    db.audit('app-delete', a.name, ctx.ip);
    db.touch();
    ctx.json({ ok: true });
  }));

  // برنامه‌های نمونه‌ای که مالک هنوز به آن‌ها دست نزده (بدون فایل، تصویر، اشتراک و کد فعال‌سازی) یک‌جا پاک می‌شوند
  const untouchedSample = (a) => a.sample === true && !a.versions.length && !a.plans.length && !a.icon && !(a.screenshots || []).length && !data().licenses.some((l) => l.appId === a.id) && !data().orders.some((o) => o.appId === a.id);
  app.post(`${A}/apps/clear-samples`, authed((ctx) => {
    const gone = data().apps.filter(untouchedSample);
    if (!gone.length) throw new HttpError(409, 'برنامهٔ نمونهٔ دست‌نخورده‌ای نمانده است');
    data().apps = data().apps.filter((a) => !gone.includes(a));
    for (const a of gone) { files.removeApp(a); releaseImages(blockImages(a.blocks)); }
    data().apps.sort((a, b) => a.order - b.order).forEach((a, i) => { a.order = i; });
    db.audit('app-delete', `${gone.length} برنامهٔ نمونه`, ctx.ip);
    db.touch();
    ctx.json({ ok: true, removed: gone.length });
  }));

  app.post(`${A}/apps/order`, authed(async (ctx) => {
    const b = await ctx.readJson(64 * 1024);
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === 'string').slice(0, 500) : [];
    data().apps.forEach((a) => { const i = ids.indexOf(a.id); a.order = i < 0 ? 999 : i; });
    db.touch();
    ctx.json({ ok: true });
  }));

  app.put(`${A}/apps/:id/icon`, authed(async (ctx) => {
    const a = getApp(ctx);
    const { name } = files.saveImage(await ctx.readBody(6 * 1024 * 1024 + 1024));
    const before = a.icon;
    a.icon = name;
    releaseImages([before]);
    db.touch();
    ctx.json({ ok: true, icon: name });
  }));
  app.del(`${A}/apps/:id/icon`, authed((ctx) => { const a = getApp(ctx); const before = a.icon; a.icon = ''; releaseImages([before]); db.touch(); ctx.json({ ok: true }); }));

  app.post(`${A}/apps/:id/screenshots`, authed(async (ctx) => {
    const a = getApp(ctx);
    if (a.screenshots.length >= 12) throw new HttpError(400, 'حداکثر ۱۲ تصویر برای هر برنامه');
    const img = files.saveImage(await ctx.readBody(6 * 1024 * 1024 + 1024));
    const shot = { id: id(6), file: img.name, w: img.w, h: img.h, caption: '' };
    a.screenshots.push(shot);
    db.touch();
    ctx.json({ ok: true, screenshot: shot });
  }));
  app.del(`${A}/apps/:id/screenshots/:sid`, authed((ctx) => {
    const a = getApp(ctx);
    const s = a.screenshots.find((x) => x.id === ctx.params.sid);
    if (!s) throw new HttpError(404, 'تصویر پیدا نشد');
    a.screenshots = a.screenshots.filter((x) => x !== s);
    releaseImages([s.file]);
    db.touch();
    ctx.json({ ok: true });
  }));

  /* ───────────── صفحهٔ اصلی و صفحه‌های دلخواه (بخش‌های صفحه) ───────────── */

  const needBlocks = (b) => { if (!Array.isArray(b.blocks)) throw new HttpError(400, 'فهرست بخش‌ها درست نیست'); return b.blocks; };
  const getPage = (ctx) => { const p = pageList().find((x) => x.id === ctx.params.id); if (!p) throw new HttpError(404, 'صفحه پیدا نشد'); return p; };

  app.get(`${A}/home`, authed((ctx) => ctx.json({ ok: true, blocks: homeData().blocks })));
  app.put(`${A}/home`, authed(async (ctx) => {
    const b = await ctx.readJson(BIG);
    const h = homeData(), before = blockImages(h.blocks);
    h.blocks = model.cleanBlocks(needBlocks(b), h.blocks, model.BLOCK_LIMITS.home);
    releaseImages(before);
    db.audit('home-update', `بخش‌های صفحهٔ اصلی (${h.blocks.length})`, ctx.ip);
    db.touch();
    ctx.json({ ok: true, blocks: h.blocks });
  }));

  app.get(`${A}/pages`, authed((ctx) => ctx.json({ ok: true, pages: pageList() })));
  app.get(`${A}/pages/:id`, authed((ctx) => ctx.json({ ok: true, page: getPage(ctx) })));
  app.post(`${A}/pages`, authed(async (ctx) => {
    const b = await ctx.readJson(BIG);
    const all = pageList();
    if (all.length >= model.BLOCK_LIMITS.pages) throw new HttpError(400, `حداکثر ${model.BLOCK_LIMITS.pages} صفحه می‌توان ساخت`);
    const p = model.cleanPage(b, null, all);
    all.push(p);
    db.audit('page-create', p.title, ctx.ip);
    db.touch();
    ctx.json({ ok: true, page: p });
  }));
  app.put(`${A}/pages/:id`, authed(async (ctx) => {
    const old = getPage(ctx);
    const b = await ctx.readJson(BIG);
    const all = pageList();
    const p = model.cleanPage(b, old, all);
    all[all.indexOf(old)] = p;
    releaseImages(blockImages(old.blocks));
    db.audit('page-update', p.title, ctx.ip);
    db.touch();
    ctx.json({ ok: true, page: p });
  }));
  app.del(`${A}/pages/:id`, authed((ctx) => {
    const p = getPage(ctx);
    data().pages = pageList().filter((x) => x !== p);
    releaseImages(blockImages(p.blocks));
    db.audit('page-delete', p.title, ctx.ip);
    db.touch();
    ctx.json({ ok: true });
  }));
  // ترتیب صفحه‌ها همان ترتیب نمایش‌شان در منوی سایت است
  app.post(`${A}/pages/order`, authed(async (ctx) => {
    const b = await ctx.readJson(64 * 1024);
    const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === 'string').slice(0, 200) : [];
    const pos = (p) => { const i = ids.indexOf(p.id); return i < 0 ? 999 : i; };
    data().pages = pageList().map((p, i) => [p, i]).sort((x, y) => pos(x[0]) - pos(y[0]) || x[1] - y[1]).map((x) => x[0]);
    db.touch();
    ctx.json({ ok: true });
  }));

  // تصویرِ یک بخش «تصویر و متن». بخش باید از قبل ذخیره شده باشد؛ تصویر فقط از همین مسیر روی بخش می‌نشیند.
  const SCOPES = {
    app: { base: `${A}/apps/:id`, find: (ctx) => { const a = getApp(ctx); if (!Array.isArray(a.blocks)) a.blocks = []; return { owner: a, blocks: a.blocks, label: a.name }; } },
    page: { base: `${A}/pages/:id`, find: (ctx) => { const p = getPage(ctx); if (!Array.isArray(p.blocks)) p.blocks = []; return { owner: p, blocks: p.blocks, label: p.title }; } },
    home: { base: `${A}/home`, find: () => ({ owner: null, blocks: homeData().blocks, label: 'صفحهٔ اصلی' }) },
  };
  function imageBlock(ctx, scope) {
    const t = scope.find(ctx);
    const b = t.blocks.find((x) => x && x.id === ctx.params.bid);
    if (!b) throw new HttpError(404, 'این بخش هنوز ذخیره نشده است. اول تغییرها را ذخیره کنید، بعد تصویر بگذارید.');
    if (b.type !== 'image') throw new HttpError(400, 'فقط بخش «تصویر و متن» تصویر می‌پذیرد');
    return Object.assign(t, { block: b });
  }
  for (const scope of Object.values(SCOPES)) {
    app.put(`${scope.base}/blocks/:bid/image`, authed(async (ctx) => {
      const t = imageBlock(ctx, scope);
      const img = files.saveImage(await ctx.readBody(6 * 1024 * 1024 + 1024));
      const before = t.block.image && t.block.image.file;
      t.block.image = { file: img.name, w: img.w, h: img.h };
      releaseImages([before]); // تصویر قبلی جایگزین و پاک می‌شود
      if (t.owner) t.owner.updatedAt = new Date().toISOString();
      db.audit('block-image', `${t.label}: تصویر بخش گذاشته شد`, ctx.ip);
      db.touch();
      ctx.json({ ok: true, image: t.block.image });
    }));
    app.del(`${scope.base}/blocks/:bid/image`, authed((ctx) => {
      const t = imageBlock(ctx, scope);
      const before = t.block.image && t.block.image.file;
      t.block.image = null;
      releaseImages([before]);
      if (t.owner) t.owner.updatedAt = new Date().toISOString();
      db.audit('block-image', `${t.label}: تصویر بخش برداشته شد`, ctx.ip);
      db.touch();
      ctx.json({ ok: true });
    }));
    // ویدیو و تصویر پیش‌نمایشِ بخش «ویدیو» — مثل تصویر، فقط از همین مسیرها روی بخش می‌نشینند
    const videoBlock = (ctx) => {
      const t = scope.find(ctx);
      const b = t.blocks.find((x) => x && x.id === ctx.params.bid);
      if (!b) throw new HttpError(404, 'این بخش هنوز ذخیره نشده است. اول تغییرها را ذخیره کنید، بعد ویدیو بگذارید.');
      if (b.type !== 'video') throw new HttpError(400, 'فقط بخش «ویدیو» ویدیو می‌پذیرد');
      return Object.assign(t, { block: b });
    };
    const setMedia = (ctx, t, key, value, note) => {
      const before = t.block[key] && t.block[key].file;
      t.block[key] = value;
      releaseImages([before]);
      if (t.owner) t.owner.updatedAt = new Date().toISOString();
      db.audit('block-image', `${t.label}: ${note}`, ctx.ip);
      db.touch();
      ctx.json(Object.assign({ ok: true }, value ? { [key]: value } : {}));
    };
    app.put(`${scope.base}/blocks/:bid/video`, authed(async (ctx) => {
      const t = videoBlock(ctx);
      const len = Number(ctx.req.headers['content-length'] || 0);
      if (len > VIDEO_MAX) throw new HttpError(413, `ویدیو باید کمتر از ${VIDEO_MAX / 1048576} مگابایت باشد`);
      const v = files.saveVideo(await ctx.readBody(VIDEO_MAX + 1024));
      setMedia(ctx, t, 'video', { file: v.name, size: v.size, mime: v.mime }, 'ویدیوی بخش گذاشته شد');
    }));
    app.del(`${scope.base}/blocks/:bid/video`, authed((ctx) => setMedia(ctx, videoBlock(ctx), 'video', null, 'ویدیوی بخش برداشته شد')));
    app.put(`${scope.base}/blocks/:bid/poster`, authed(async (ctx) => {
      const t = videoBlock(ctx);
      const img = files.saveImage(await ctx.readBody(6 * 1024 * 1024 + 1024));
      setMedia(ctx, t, 'poster', { file: img.name, w: img.w, h: img.h }, 'تصویر پیش‌نمایش ویدیو گذاشته شد');
    }));
    app.del(`${scope.base}/blocks/:bid/poster`, authed((ctx) => setMedia(ctx, videoBlock(ctx), 'poster', null, 'تصویر پیش‌نمایش ویدیو برداشته شد')));
  }

  /* ───────────── بارگذاری نسخه (تکه‌تکه، تا از سقف ۱۰۰ مگابایتی واسط‌ها رد شود) ───────────── */

  app.post(`${A}/apps/:id/upload`, authed(async (ctx) => {
    const a = getApp(ctx);
    const b = await ctx.readJson(8192);
    const { clean } = files.checkName(b.name);
    const size = int(b.size, 1, Number.MAX_SAFE_INTEGER, 0);
    const max = data().settings.maxUploadMB * 1024 * 1024;
    if (!size) throw new HttpError(400, 'فایل خالی است');
    if (size > max) throw new HttpError(413, `حجم فایل از سقف ${data().settings.maxUploadMB} مگابایت بیشتر است (در تنظیمات قابل تغییر است)`);
    try { const st = fs.statfsSync(dataDir); if (st.bavail * st.bsize < size * 2 + 64 * 1024 * 1024) throw new HttpError(507, 'فضای خالی دیسک سرور برای این فایل کافی نیست'); } catch (e) { if (e instanceof HttpError) throw e; }
    if (uploads.size > 20) throw new HttpError(429, 'بارگذاری‌های نیمه‌تمام زیاد است؛ کمی صبر کنید');
    const uid = id(12);
    const tmp = path.join(dataDir, 'tmp', `chunk-${uid}`);
    fs.writeFileSync(tmp, '');
    uploads.set(uid, { appId: a.id, name: clean, size, tmp, received: 0, next: 0, at: Date.now(), busy: false });
    ctx.json({ ok: true, uploadId: uid, chunk: CHUNK });
  }));

  app.put(`${A}/uploads/:uid`, authed((ctx) => new Promise((resolve, reject) => {
    const u = uploads.get(ctx.params.uid);
    if (!u) return reject(new HttpError(404, 'این بارگذاری منقضی شده است؛ دوباره شروع کنید'));
    const index = int(ctx.query.get('i'), 0, 1e6, -1);
    if (index !== u.next) return reject(new HttpError(409, 'ترتیب تکه‌ها به هم خورده است', { next: u.next, received: u.received }));
    if (u.busy) return reject(new HttpError(409, 'تکهٔ قبلی هنوز در حال نوشتن است'));
    u.busy = true; u.at = Date.now();
    const before = u.received;
    const ws = fs.createWriteStream(u.tmp, { flags: 'r+', start: before });
    let got = 0, done = false;
    const fail = (err) => {
      if (done) return; done = true;
      ws.destroy();
      try { fs.truncateSync(u.tmp, before); } catch (_) { /* نادیده */ }
      u.busy = false;
      reject(err);
    };
    ctx.req.on('data', (c) => { got += c.length; if (got > CHUNK + 1024 || before + got > u.size) { ctx.req.unpipe(ws); ctx.req.resume(); fail(new HttpError(413, 'اندازهٔ تکه نادرست است')); } });
    ctx.req.on('aborted', () => fail(new HttpError(400, 'بارگذاری قطع شد')));
    ctx.req.on('error', fail);
    ws.on('error', (e) => fail(e.code === 'ENOSPC' ? new HttpError(507, 'فضای دیسک سرور پر است') : e));
    ws.on('finish', () => {
      if (done) return; done = true;
      u.received = before + got; u.next++; u.busy = false;
      ctx.json({ ok: true, received: u.received });
      resolve();
    });
    ctx.req.pipe(ws);
  })));

  app.post(`${A}/uploads/:uid/finish`, authed(async (ctx) => {
    const u = uploads.get(ctx.params.uid);
    if (!u) throw new HttpError(404, 'این بارگذاری منقضی شده است؛ دوباره شروع کنید');
    if (u.busy) throw new HttpError(409, 'هنوز در حال دریافت است');
    if (u.received !== u.size) throw new HttpError(400, 'فایل کامل نرسیده است', { received: u.received });
    const a = data().apps.find((x) => x.id === u.appId);
    uploads.delete(ctx.params.uid);
    if (!a) { fs.unlink(u.tmp, () => {}); throw new HttpError(404, 'برنامه پیدا نشد'); }
    const sha256 = await hashFile(u.tmp);
    const v = files.addVersion(a, u.tmp, u.name, { sha256, size: u.size, publish: data().settings.autoPublish !== false, move: true, via: 'upload' });
    db.audit('version-upload', `${a.name}: ${u.name} → ${v.version || 'نسخهٔ نامشخص'}`, ctx.ip);
    ctx.json({ ok: true, version: Object.assign({}, v, { platformLabel: PLATFORMS[v.platform] || v.platform, sourceLabel: SOURCE_LABEL[v.source] || 'پیدا نشد' }) });
  }));

  app.del(`${A}/uploads/:uid`, authed((ctx) => {
    const u = uploads.get(ctx.params.uid);
    // پاک‌کردنِ هم‌زمان: وقتی پاسخ می‌رسد، فایل موقت واقعاً رفته است
    if (u) { try { fs.unlinkSync(u.tmp); } catch (_) { /* نبود */ } uploads.delete(ctx.params.uid); }
    ctx.json({ ok: true });
  }));

  app.put(`${A}/apps/:id/versions/:vid`, authed(async (ctx) => {
    const a = getApp(ctx);
    const v = a.versions.find((x) => x.id === ctx.params.vid);
    if (!v) throw new HttpError(404, 'نسخه پیدا نشد');
    const b = await ctx.readJson(64 * 1024);
    if (b.version !== undefined) {
      const ver = toLatinDigits(str(b.version, 40)).replace(/^v/i, '');
      if (ver && !/^[\w.+-]+$/.test(ver)) throw new HttpError(400, 'شمارهٔ نسخه فقط عدد، نقطه و حروف انگلیسی باشد (مثل 2.4.1)');
      if (ver !== v.version) { v.version = ver; v.source = 'manual'; }
    }
    if (b.notes !== undefined) v.notes = str(b.notes, 4000);
    if (b.platform !== undefined && PLATFORMS[b.platform]) v.platform = b.platform;
    if (b.minOs !== undefined) v.minOs = str(b.minOs, 60);
    if (b.published !== undefined) {
      const want = bool(b.published);
      if (want && !v.version) throw new HttpError(400, 'برای انتشار، شمارهٔ نسخه را بنویسید');
      if (want && v.missing) throw new HttpError(400, 'فایل این نسخه روی دیسک نیست');
      if (want && !v.published) v.publishedAt = new Date().toISOString();
      v.published = want;
    }
    a.updatedAt = new Date().toISOString();
    db.touch();
    ctx.json({ ok: true });
  }));

  app.del(`${A}/apps/:id/versions/:vid`, authed((ctx) => {
    const a = getApp(ctx);
    const v = files.removeVersion(a, ctx.params.vid);
    db.audit('version-delete', `${a.name}: ${v.version}`, ctx.ip);
    ctx.json({ ok: true });
  }));

  app.post(`${A}/scan`, authed(async (ctx) => ctx.json(Object.assign({ ok: true }, await files.scan({ force: true })))));

  /* ───────────── کدهای تخفیف ───────────── */

  app.get(`${A}/coupons`, authed((ctx) => ctx.json({ ok: true, coupons: data().coupons, apps: data().apps.map((a) => ({ id: a.id, name: a.name })) })));
  app.post(`${A}/coupons`, authed(async (ctx) => {
    const c = model.cleanCoupon(await ctx.readJson(16384), null, data().coupons);
    data().coupons.unshift(c);
    db.audit('coupon-create', c.code, ctx.ip); db.touch();
    ctx.json({ ok: true, coupon: c });
  }));
  app.put(`${A}/coupons/:id`, authed(async (ctx) => {
    const old = data().coupons.find((x) => x.id === ctx.params.id);
    if (!old) throw new HttpError(404, 'کد پیدا نشد');
    const c = model.cleanCoupon(await ctx.readJson(16384), old, data().coupons);
    data().coupons[data().coupons.indexOf(old)] = c;
    db.touch();
    ctx.json({ ok: true, coupon: c });
  }));
  app.del(`${A}/coupons/:id`, authed((ctx) => { data().coupons = data().coupons.filter((x) => x.id !== ctx.params.id); db.touch(); ctx.json({ ok: true }); }));

  /* ───────────── سفارش‌ها و اشتراک‌ها ───────────── */

  const licOut = (l) => Object.assign({}, l, { state: model.licenseState(l), app: (data().apps.find((a) => a.id === l.appId) || {}).name || 'حذف‌شده' });

  app.get(`${A}/orders`, authed((ctx) => ctx.json({ ok: true, orders: data().orders.slice(0, 2000).map((o) => Object.assign({}, o, { license: o.licenseId ? (data().licenses.find((l) => l.id === o.licenseId) || {}).code || '' : '' })), currency: data().settings.currency })));
  app.put(`${A}/orders/:id`, authed(async (ctx) => {
    const o = data().orders.find((x) => x.id === ctx.params.id);
    if (!o) throw new HttpError(404, 'سفارش پیدا نشد');
    const b = await ctx.readJson(8192);
    if (b.adminNote !== undefined) { o.adminNote = str(b.adminNote, 500); db.save(); }
    if (b.status) { model.setOrderStatus(db, o, str(b.status, 20)); db.audit('order-status', `سفارش ${o.no} → ${o.status}`, ctx.ip); }
    const lic = o.licenseId && data().licenses.find((l) => l.id === o.licenseId);
    ctx.json({ ok: true, order: o, license: lic ? licOut(lic) : null });
  }));
  app.del(`${A}/orders/:id`, authed((ctx) => {
    const o = data().orders.find((x) => x.id === ctx.params.id);
    if (!o) throw new HttpError(404, 'سفارش پیدا نشد');
    if (o.status === 'paid') throw new HttpError(409, 'سفارش پرداخت‌شده حذف نمی‌شود؛ اول آن را لغو کنید');
    if (o.status === 'new') model.setOrderStatus(db, o, 'cancelled');
    data().orders = data().orders.filter((x) => x !== o);
    db.saveNow();
    ctx.json({ ok: true });
  }));

  app.get(`${A}/licenses`, authed((ctx) => ctx.json({ ok: true, licenses: data().licenses.slice(0, 5000).map(licOut), apps: data().apps.map((a) => ({ id: a.id, name: a.name, plans: a.plans.map((p) => ({ id: p.id, name: p.name, days: p.days })) })) })));
  app.post(`${A}/licenses`, authed(async (ctx) => {
    const b = await ctx.readJson(8192);
    const a = data().apps.find((x) => x.id === b.appId);
    if (!a) throw new HttpError(400, 'برنامه را انتخاب کنید');
    if (!str(b.customer, 80)) throw new HttpError(400, 'نام مشتری را بنویسید');
    const lic = model.createLicense(data(), { appId: a.id, planName: str(b.planName, 60) || 'دستی', days: bool(b.lifetime) ? 0 : int(b.days, 1, 36500, 30), customer: b.customer, phone: b.phone, note: b.note });
    db.saveNow(); db.audit('license-create', `${lic.code} برای ${lic.customer}`, ctx.ip);
    ctx.json({ ok: true, license: licOut(lic) });
  }));
  app.put(`${A}/licenses/:id`, authed(async (ctx) => {
    const l = data().licenses.find((x) => x.id === ctx.params.id);
    if (!l) throw new HttpError(404, 'اشتراک پیدا نشد');
    const b = await ctx.readJson(8192);
    if (b.action === 'revoke') l.status = 'revoked';
    else if (b.action === 'activate') l.status = 'active';
    else if (b.action === 'extend') {
      const days = int(b.days, 1, 36500, 0);
      if (!days) throw new HttpError(400, 'تعداد روز را بنویسید');
      if (!l.endAt) throw new HttpError(400, 'اشتراک دایمی تمدید نمی‌خواهد');
      // تمدید از تاریخ پایان (یا از امروز اگر تمام شده باشد)
      const from = Math.max(Date.now(), new Date(l.endAt).getTime());
      l.endAt = new Date(from + days * 86400000).toISOString();
      l.status = 'active';
    } else if (b.action === 'lifetime') { l.endAt = null; l.status = 'active'; }
    if (b.note !== undefined) l.note = str(b.note, 200);
    db.saveNow(); db.audit('license-update', `${l.code}: ${b.action || 'یادداشت'}`, ctx.ip);
    ctx.json({ ok: true, license: licOut(l) });
  }));
  app.del(`${A}/licenses/:id`, authed((ctx) => {
    const l = data().licenses.find((x) => x.id === ctx.params.id);
    if (!l) throw new HttpError(404, 'اشتراک پیدا نشد');
    data().licenses = data().licenses.filter((x) => x !== l);
    for (const o of data().orders) if (o.licenseId === l.id) o.licenseId = null;
    db.saveNow(); db.audit('license-delete', l.code, ctx.ip);
    ctx.json({ ok: true });
  }));

  /* ───────────── تنظیمات ───────────── */

  app.get(`${A}/settings`, authed((ctx) => ctx.json({ ok: true, settings: data().settings, font: fontFile(assets) })));
  // lenient=true (بازگردانی پشتیبان): مقدار نادرست فقط نادیده گرفته می‌شود
  function applySettings(s, b, lenient = false) {
    const text = { brand: 40, slogan: 80, heroTitle: 120, heroText: 400, about: 400, email: 120, phone: 24, telegram: 40, currency: 20, orderNote: 300 };
    for (const [k, max] of Object.entries(text)) if (b[k] !== undefined) s[k] = str(b[k], max);
    if (!s.brand) s.brand = 'VILL3N';
    if (!s.currency) s.currency = 'افغانی';
    if (b.whatsapp !== undefined) s.whatsapp = toLatinDigits(str(b.whatsapp, 24)).replace(/\D/g, '');
    if (b.siteUrl !== undefined) {
      let u; try { u = new URL(str(b.siteUrl, 200)); } catch (_) { if (lenient) u = null; else throw new HttpError(400, 'نشانی سایت درست نیست (مثل https://vill3n.top)'); }
      if (u && !/^https?:$/.test(u.protocol)) { if (lenient) u = null; else throw new HttpError(400, 'نشانی سایت باید با http یا https شروع شود'); }
      if (u) s.siteUrl = u.origin;
    }
    if (b.autoPublish !== undefined) s.autoPublish = bool(b.autoPublish);
    if (b.allowAI !== undefined) s.allowAI = bool(b.allowAI);
    if (b.indexNow !== undefined) s.indexNow = bool(b.indexNow);
    for (const k of ['googleVerify', 'bingVerify']) if (b[k] !== undefined) s[k] = str(b[k], 120).replace(/[^\w.=-]/g, '');
    if (b.autoFont !== undefined) s.autoFont = bool(b.autoFont);
    if (b.maxUploadMB !== undefined) s.maxUploadMB = int(b.maxUploadMB, 1, 16384, 2048);
  }

  app.put(`${A}/settings`, authed(async (ctx) => {
    const b = await ctx.readJson(64 * 1024);
    const s = data().settings;
    applySettings(s, b);
    db.audit('settings', 'تنظیمات ذخیره شد', ctx.ip); db.touch();
    ctx.json({ ok: true, settings: s });
  }));

  app.get(`${A}/seo`, authed((ctx) => {
    const d = data(), b = d.settings.siteUrl.replace(/\/+$/, '');
    ctx.json({ ok: true, indexNow: { enabled: d.settings.indexNow !== false, eligible: indexNow.eligible(), last: indexNow.state.last, keyUrl: `${b}/${d.meta.indexNowKey}.txt` }, allowAI: d.settings.allowAI !== false, links: { llms: `${b}/llms.txt`, full: `${b}/llms-full.txt`, sitemap: `${b}/sitemap.xml`, robots: `${b}/robots.txt`, api: `${b}/api/apps`, openapi: `${b}/api/openapi.json` } });
  }));
  app.post(`${A}/seo/indexnow`, authed(async (ctx) => {
    if (!L.hit('indexnow-manual', 6, 60 * 60 * 1000)) throw new HttpError(429, 'در این ساعت چند بار فرستاده شده است؛ کمی بعد دوباره تلاش کنید');
    const r = await indexNow.submit();
    if (r.skipped) throw new HttpError(400, 'برای خبر دادن به موتورهای جست‌وجو، نشانی سایت باید یک دامنهٔ واقعی با https باشد');
    ctx.json({ ok: true, result: r });
  }));

  app.post(`${A}/font/fetch`, authed(async (ctx) => {
    const r = await fetchFont(assets);
    if (!r.ok) throw new HttpError(502, 'فونت از اینترنت گرفته نشد. فایل Vazirmatn (woff2) را از همین‌جا بارگذاری کنید.');
    db.touch();
    ctx.json({ ok: true, font: fontFile(assets) });
  }));
  app.put(`${A}/font`, authed(async (ctx) => {
    try { saveFont(assets, await ctx.readBody(4 * 1024 * 1024)); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, e.message); }
    db.touch();
    ctx.json({ ok: true, font: fontFile(assets) });
  }));

  /* ───────────── امنیت ───────────── */

  app.get(`${A}/security`, authed((ctx) => {
    const o = auth.owner;
    ctx.json({
      ok: true, username: o.username, email: o.email,
      emailCode: { enabled: !!o.emailCode.enabled, url: o.emailCode.url, headers: o.emailCode.headers, body: o.emailCode.body },
      sessions: data().sessions.map((s) => ({ key: s.id.slice(0, 12), current: s.id === ctx.session.id, ip: s.ip, ua: s.ua, createdAt: s.createdAt, lastAt: s.lastAt })),
      audit: data().audit.slice(0, 120),
    });
  }));

  app.post(`${A}/security/password`, authed(async (ctx) => {
    const b = await ctx.readJson(8192);
    auth.changePassword(ctx, ctx.session, { current: b.current, next: b.next });
    ctx.json({ ok: true });
  }));

  app.put(`${A}/security/profile`, authed(async (ctx) => {
    const b = await ctx.readJson(8192);
    auth.throttle(ctx, 'pw');
    if (!verifyPassword(b.current, auth.owner.pass)) { auth.fail(ctx, 'pw'); throw new HttpError(403, 'رمز فعلی درست نیست'); }
    const username = str(b.username, 32).toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new HttpError(400, 'نام کاربری فقط حروف انگلیسی کوچک، عدد، نقطه و خط تیره (۳ تا ۳۲ نویسه)');
    const email = str(b.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'ایمیل درست نیست');
    if (!email && auth.owner.emailCode.enabled) throw new HttpError(400, 'تا وقتی کد ایمیلی روشن است، ایمیل نباید خالی باشد');
    if (email !== auth.owner.email) auth.owner.emailCode.enabled = false; // ایمیل تازه باید دوباره آزمایش شود
    auth.owner.username = username; auth.owner.email = email;
    db.saveNow(); db.audit('profile', 'نام کاربری یا ایمیل مالک عوض شد', ctx.ip);
    ctx.json({ ok: true, emailCodeEnabled: auth.owner.emailCode.enabled });
  }));

  app.del(`${A}/security/sessions/:key`, authed((ctx) => {
    const s = data().sessions.find((x) => x.id.slice(0, 12) === ctx.params.key);
    if (s) auth.dropSession(s.id);
    ctx.json({ ok: true });
  }));

  app.put(`${A}/security/email-code`, authed(async (ctx) => {
    const b = await ctx.readJson(16384);
    const ec = auth.owner.emailCode;
    // تغییر تنظیم، کد ایمیل را خاموش می‌کند؛ پس اگر روشن است، رمز فعلی لازم است (مثل خاموش‌کردن)
    if (ec.enabled) {
      auth.throttle(ctx, 'pw');
      if (!verifyPassword(b.current, auth.owner.pass)) { auth.fail(ctx, 'pw'); throw new HttpError(403, 'برای تغییر تنظیمِ کد ایمیل، رمز فعلی را درست بنویسید'); }
    }
    const url = str(b.url, 400);
    if (url) { let u; try { u = new URL(url); } catch (_) { throw new HttpError(400, 'نشانی سرویس درست نیست'); } if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, 'نشانی سرویس باید http یا https باشد'); }
    const body = str(b.body, 2000) || '{"to":"{{email}}","code":"{{code}}"}';
    if (!/\{\{\s*code\s*\}\}/.test(body)) throw new HttpError(400, 'در متن درخواست باید {{code}} باشد');
    Object.assign(ec, { url, headers: str(b.headers, 2000), body, enabled: false }); // هر تغییر، آزمایش دوباره می‌خواهد
    db.saveNow();
    ctx.json({ ok: true });
  }));
  app.post(`${A}/security/email-code/test`, authed(async (ctx) => ctx.json({ ok: true, ticket: await auth.startOtp(ctx, 'enable') })));
  app.post(`${A}/security/email-code/enable`, authed(async (ctx) => {
    const b = await ctx.readJson(8192);
    auth.verifyOtpInside(ctx, b.ticket, b.code, 'enable'); // فقط وقتی کد واقعاً رسیده باشد روشن می‌شود
    auth.owner.emailCode.enabled = true;
    db.saveNow(); db.audit('email-code', 'ورود با کد ایمیلی روشن شد', ctx.ip);
    ctx.json({ ok: true });
  }));
  app.post(`${A}/security/email-code/disable`, authed(async (ctx) => {
    const b = await ctx.readJson(8192);
    auth.throttle(ctx, 'pw');
    if (!verifyPassword(b.current, auth.owner.pass)) { auth.fail(ctx, 'pw'); throw new HttpError(403, 'رمز فعلی درست نیست'); }
    auth.owner.emailCode.enabled = false;
    db.saveNow(); db.audit('email-code', 'ورود با کد ایمیلی خاموش شد', ctx.ip);
    ctx.json({ ok: true });
  }));

  /* ───────────── پشتیبان ───────────── */

  const stamp = () => dayKey();
  app.get(`${A}/backup`, authed((ctx) => {
    const copy = Object.assign({}, data(), { owner: null, sessions: [] }); // رمز و نشست‌ها در پشتیبان نمی‌رود
    db.audit('backup', 'پشتیبان داده دانلود شد', ctx.ip);
    ctx.send(200, JSON.stringify(copy), 'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="vill3n-backup-${stamp()}.json"`, 'Cache-Control': 'no-store' });
  }));

  app.get(`${A}/backup.zip`, authed(async (ctx) => {
    const copy = Object.assign({}, data(), { owner: null, sessions: [] });
    const entries = [{ name: 'db.json', data: Buffer.from(JSON.stringify(copy)) }];
    for (const [sub, dir] of [['images', files.imagesDir], ['files', files.filesDir]]) {
      for (const f of fs.readdirSync(dir)) { const full = path.join(dir, f); if (fs.statSync(full).isFile()) entries.push({ name: `${sub}/${f}`, file: full }); }
    }
    db.audit('backup', 'پشتیبان کامل (با فایل‌ها) دانلود شد', ctx.ip);
    ctx.res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="vill3n-full-backup-${stamp()}.zip"`, 'Cache-Control': 'no-store' });
    try { await writeZip(ctx.res, entries); ctx.res.end(); } catch (e) { console.error('[پشتیبان]', e.message); ctx.res.destroy(); }
  }));

  app.post(`${A}/restore`, authed(async (ctx) => {
    const b = await ctx.readJson(96 * 1024 * 1024);
    const src = b.data;
    if (!src || typeof src !== 'object' || !src.meta || !Array.isArray(src.apps) || !src.settings) throw new HttpError(400, 'این فایل پشتیبان VILL3N نیست');
    if (b.confirm !== 'RESTORE') throw new HttpError(400, 'تأیید بازگردانی لازم است');
    // اول همه‌چیز بررسی و پاک‌سازی می‌شود، بعد یک‌جا جایگزین می‌شود (فایل خراب، دادهٔ فعلی را نیمه‌کاره عوض نمی‌کند)
    if (typeof src.settings !== 'object' || Array.isArray(src.settings)) throw new HttpError(400, 'این فایل پشتیبان VILL3N نیست');
    const next = model.normalizeBackup(src);
    const stats = { downloads: {}, views: {} };
    for (const kind of ['downloads', 'views']) {
      const bucket = src.stats && typeof src.stats === 'object' ? src.stats[kind] : null;
      if (!bucket || typeof bucket !== 'object') continue;
      for (const day of Object.keys(bucket).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort().slice(-400)) {
        const row = bucket[day];
        if (!row || typeof row !== 'object') continue;
        stats[kind][day] = {};
        for (const k of Object.keys(row).slice(0, 600)) stats[kind][day][str(k, 20)] = int(row[k], 0, 1e9);
      }
    }
    db.flush();
    fs.copyFileSync(db.file, path.join(dataDir, 'backups', `before-restore-${Date.now()}.json`));
    const d = data();
    Object.assign(d, next);
    d.stats = stats;
    d.meta.orderSeq = next.orders.reduce((m, o) => Math.max(m, o.no), Math.max(d.meta.orderSeq, int(src.meta.orderSeq, 0, 1e9, 0)));
    // تنظیمات از همان مسیرِ ذخیرهٔ تنظیمات می‌گذرد (فقط کلیدهای شناخته‌شده و با همان بررسی‌ها)
    applySettings(d.settings, src.settings, true);
    const missing = files.verify();
    db.audit('restore', 'پشتیبان بازگردانی شد', ctx.ip); db.touch(); db.saveNow();
    ctx.json({ ok: true, apps: d.apps.length, missing });
  }));

  /* ───────────── اتصال و استقرار ───────────── */

  app.get(`${A}/deploy`, authed((ctx) => {
    let disk = null;
    try { const st = fs.statfsSync(dataDir); disk = { free: st.bavail * st.bsize, total: st.blocks * st.bsize }; } catch (_) { /* در این نسخهٔ Node نیست */ }
    ctx.json({
      ok: true,
      node: process.version, platform: `${os.type()} ${os.release()}`, uptime: Math.round(process.uptime()), version: VERSION,
      port: config.port, bind: config.host, dataDir, root: path.resolve(__dirname, '..'),
      request: { host: ctx.host, secure: ctx.secure, viaProxy: ctx.viaProxy, ip: ctx.ip },
      siteUrl: data().settings.siteUrl, instance: data().meta.instance.slice(0, 8), disk, font: fontFile(assets),
      passenger: !!process.env.PASSENGER_APP_ENV || config.port === 'passenger',
    });
  }));

  app.post(`${A}/deploy/check`, authed(async (ctx) => {
    if (!L.hit('deploy-check', 20, 10 * 60 * 1000)) throw new HttpError(429, 'کمی صبر کنید و دوباره بررسی کنید');
    const out = { ok: true, dns: null, reach: null, same: false, https: false, admin: null };
    let u;
    try { u = new URL(data().settings.siteUrl); } catch (_) { throw new HttpError(400, 'نشانی سایت در تنظیمات درست نیست'); }
    out.https = u.protocol === 'https:';
    try { out.dns = (await dns.promises.lookup(u.hostname, { all: true })).map((x) => x.address).slice(0, 4); } catch (e) { out.dns = []; out.dnsError = e.code || e.message; }
    const probe = async (origin) => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 9000);
      try {
        const r = await fetch(`${origin}/healthz`, { signal: ac.signal, redirect: 'follow' });
        const j = await r.json().catch(() => null);
        return { status: r.status, instance: j && j.instance };
      } catch (e) { return { error: (e.cause && e.cause.code) || e.name || 'failed' }; } finally { clearTimeout(t); }
    };
    if (out.dns.length) {
      out.reach = await probe(u.origin);
      out.same = !!(out.reach.instance && out.reach.instance === data().meta.instance.slice(0, 8));
      out.admin = await probe(`${u.protocol}//admin.${u.hostname.replace(/^www\./, '')}`);
      out.adminSame = !!(out.admin.instance && out.admin.instance === data().meta.instance.slice(0, 8));
    }
    ctx.json(out);
  }));

  app.post(`${A}/export`, authed(async (ctx) => {
    const r = await buildExport({ db, files, assets, env, dataDir });
    db.audit('export', `خروجی ایستا ساخته شد (${r.pages} صفحه)`, ctx.ip);
    ctx.json(Object.assign({ ok: true }, r));
  }));

  app.get(`${A}/export.zip`, authed(async (ctx) => {
    const root = path.join(dataDir, 'export', 'site');
    if (!fs.existsSync(root)) throw new HttpError(404, 'اول خروجی را بسازید');
    const entries = [];
    (function walk(dir, rel) {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f), name = rel ? `${rel}/${f}` : f;
        if (fs.statSync(full).isDirectory()) walk(full, name); else entries.push({ name, file: full });
      }
    })(root, '');
    ctx.res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="vill3n-static-site-${stamp()}.zip"`, 'Cache-Control': 'no-store' });
    try { await writeZip(ctx.res, entries); ctx.res.end(); } catch (e) { console.error('[خروجی]', e.message); ctx.res.destroy(); }
  }));
};
