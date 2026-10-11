'use strict';
// پیش‌نمایش با دادهٔ نمایشی — روی یک پوشهٔ موقت، بدون دست‌زدن به دادهٔ واقعی.
//   node test/demo.js            → http://localhost:4790   (ورود پنل: owner / demo-owner-2026)
// قیمت‌ها، نسخه‌ها و سفارش‌های این حالت ساختگی‌اند و فقط برای دیدن ظاهر سایت و پنل هستند.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { createSite, listen } = require('../src/app');
const { hashPassword } = require('../src/core/auth');
const model = require('../src/core/model');
const fx = require('./fixtures');
const { crc32 } = require('../src/core/zip');

const port = Number(process.argv[2]) || 4790;

// تصویر PNG ساده (گرادیان + نوارها) به‌جای اسکرین‌شات واقعی
function png(w, h, [r, g, b], seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const t = y / h;
      let k = 0.16 + 0.2 * (1 - t);
      const bar = y > 60 && ((y - 60 + seed * 13) % 74) < 46 && x > 22 && x < w - 22;
      if (y < 44) k = 0.9;
      else if (bar) k = 0.3 + 0.12 * (((y - 60) / 74 | 0) % 3) + (x > w - 110 ? 0.3 : 0);
      const i = row + 1 + x * 3;
      raw[i] = Math.min(255, 10 + r * k); raw[i + 1] = Math.min(255, 12 + g * k); raw[i + 2] = Math.min(255, 20 + b * k);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vill3n-demo-'));
  const site = createSite({ dataDir, publicDir: path.join(__dirname, '..', 'public'), config: { port, host: '127.0.0.1' } });
  const d = site.db.data;
  d.owner = { username: 'owner', email: 'owner@example.com', pass: hashPassword('demo-owner-2026'), emailCode: { enabled: false, url: '', headers: '', body: '{"to":"{{email}}","code":"{{code}}"}' }, createdAt: new Date().toISOString() };
  site.auth.clearSetupCode();

  const put = (name, buf) => { const f = path.join(dataDir, 'tmp', name); fs.writeFileSync(f, buf); return f; };
  const sha = (b) => require('crypto').createHash('sha256').update(b).digest('hex');
  const add = (app, name, buf, daysAgo, notes, downloads) => {
    const v = site.files.addVersion(app, put(name, buf), name, { sha256: sha(buf), size: buf.length, publish: true });
    v.publishedAt = new Date(Date.now() - daysAgo * 86400000).toISOString(); v.notes = notes; v.downloads = downloads;
    return v;
  };
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const soon = new Date(Date.now() + 5 * 86400000 + 7 * 3600000).toISOString();

  const [shop, pump, fit] = d.apps;
  for (const [i, app] of [shop, pump, fit].entries()) {
    app.status = 'published';
    for (let s = 0; s < 4; s++) { const img = site.files.saveImage(png(360, 760, rgb(app.color), s + i * 3)); app.screenshots.push({ id: `s${i}${s}`, file: img.name, w: img.w, h: img.h, caption: ['داشبورد', 'فروش و فاکتور', 'انبار', 'گزارش‌ها'][s] }); }
  }
  add(shop, 'vill3n-shop-2.3.0.apk', await fx.apk({ version: '2.3.0', code: 230, pkg: 'af.vill3n.shop' }), 64, 'جست‌وجو در جنس‌ها و مشتری‌ها\nرفع مشکل چاپ فاکتور', 148);
  add(shop, 'vill3n-shop-2.4.1.apk', await fx.apk({ version: '2.4.1', code: 241, pkg: 'af.vill3n.shop', minSdk: 24 }), 9, 'حالت روشن اضافه شد\nگزارش سود ماهانه\nسرعت باز شدن برنامه بیشتر شد', 312);
  add(shop, 'VILL3N-Shop-Setup.exe', fx.exe({ fileVersion: [2, 4, 0, 0], productVersion: '2.4.0' }), 21, 'اولین نسخهٔ ویندوز', 57);
  add(pump, 'pump-yaqoubi.html', fx.html('5.2.0', 'meta'), 14, 'بخش صرافی با گروه‌بندی ماهانه\nچاپ PDF مطابق فیلتر', 86);
  add(fit, 'fitness-pro.apk', await fx.apk({ version: '1.6.0', code: 160, pkg: 'af.vill3n.fitness', minSdk: 23 }), 30, 'برنامه‌های تمرین فوتبال', 73);

  shop.plans = [
    model.cleanPlan({ name: 'ماهانه', period: 'month', price: 500, features: ['همهٔ بخش‌ها', 'پشتیبانی در برنامه'] }),
    model.cleanPlan({ name: 'سالانه', period: 'year', price: 5000, popular: true, features: ['همهٔ بخش‌ها', 'پشتیبانی در برنامه', 'دو ماه رایگان'], discount: { type: 'percent', value: 20, to: soon, label: 'تخفیف پاییز' } }),
    model.cleanPlan({ name: 'دایمی', period: 'lifetime', price: 12000, vip: true, features: ['یک‌بار پرداخت', 'همهٔ نسخه‌های بعدی', 'پشتیبانی ویژه'] }),
  ];
  pump.plans = [model.cleanPlan({ name: 'سالانه', period: 'year', price: 9000, popular: true, features: ['نصب و آموزش', 'پشتیبان‌گیری'] }), model.cleanPlan({ name: 'دایمی', period: 'lifetime', price: 25000 })];
  fit.plans = [model.cleanPlan({ name: 'ماهانه', period: 'month', price: 700 })];
  shop.testimonials = [{ name: 'نمونهٔ نظر مشتری', role: 'متن نمایشی', text: 'این‌جا نظر واقعی مشتری‌های شما نمایش داده می‌شود.' }];
  d.coupons.push(model.cleanCoupon({ code: 'DEMO10', type: 'percent', value: 10, maxUses: 50, note: 'نمایشی' }, null, d.coupons));

  // آمار و سفارش نمایشی برای داشبورد
  for (let i = 0; i < 30; i++) {
    const key = require('../src/core/util').dayKey(new Date(Date.now() - i * 86400000));
    const wave = Math.round(14 + 10 * Math.sin(i / 3) + (i % 5) * 2);
    d.stats.downloads[key] = { [shop.id]: wave, [pump.id]: Math.round(wave / 3), [fit.id]: Math.round(wave / 4) };
    d.stats.views[key] = { [shop.id]: wave * 4, [pump.id]: wave * 2, [fit.id]: wave };
  }
  const names = [['نمونه یک', '0700000001'], ['نمونه دو', '0700000002'], ['نمونه سه', '0700000003'], ['نمونه چهار', '0700000004']];
  names.forEach(([name, phone], i) => {
    const { order } = model.createOrder(site.db, { appId: shop.id, planId: shop.plans[i % 3].id, name, phone, coupon: i === 1 ? 'DEMO10' : '' }, '127.0.0.1');
    if (i > 1) model.setOrderStatus(site.db, order, 'paid');
  });
  site.db.touch(); site.db.saveNow();

  await listen(site, { port, host: '127.0.0.1' });
  site.start();
  console.log(`\n  پیش‌نمایش نمایشی:  http://localhost:${port}/\n  پنل مالک:          http://localhost:${port}/admin   (owner / demo-owner-2026)\n  دادهٔ موقت:         ${dataDir}\n`);
  const bye = () => { site.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
})().catch((e) => { console.error(e); process.exit(1); });
