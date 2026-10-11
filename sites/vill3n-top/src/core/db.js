'use strict';
// پایگاه‌دادهٔ فایل (JSON) با نوشتن اتمی، نسخهٔ قبلی و پشتیبان روزانه.
// برای این اندازه از داده (ده‌ها برنامه، هزاران سفارش) کافی و بدون نصب است.
const fs = require('fs');
const path = require('path');
const { dayKey } = require('./util');

const SCHEMA = 1;

function defaults() {
  return {
    meta: { schema: SCHEMA, createdAt: new Date().toISOString(), instance: require('crypto').randomBytes(8).toString('hex'), indexNowKey: require('crypto').randomBytes(16).toString('hex'), orderSeq: 1000 },
    owner: null, // { username, email, pass:{salt,hash}, emailCode:{...} }
    sessions: [],
    settings: {
      brand: 'VILL3N',
      slogan: 'سریع، آسان',
      heroTitle: 'برنامه‌هایی که کار را سریع و آسان می‌کنند',
      heroText: 'برنامه‌های VILL3N برای دکان، پمپ تیل، صرافی و باشگاه ساخته شده‌اند. هر برنامه صفحهٔ خودش را دارد: معرفی، قیمت اشتراک و آخرین نسخه برای دانلود.',
      about: 'VILL3N برنامه و وب‌سایت می‌سازد؛ ساده برای کار روزانه و آماده برای بازار افغانستان.',
      email: 'vill3ntec@gmail.com',
      phone: '0792236008',
      whatsapp: '93792236008',
      telegram: '',
      siteUrl: 'https://vill3n.top',
      currency: 'افغانی',
      autoPublish: true,
      maxUploadMB: 2048,
      orderNote: 'بعد از ثبت سفارش، برای پرداخت و فعال‌سازی با شما تماس می‌گیریم.',
      allowAI: true,      // خزنده‌های هوش مصنوعی اجازهٔ خواندن سایت را دارند
      indexNow: true,     // تغییرها فوری به موتورهای جست‌وجو خبر داده می‌شود
      googleVerify: '',
      bingVerify: '',
    },
    apps: [],
    home: { blocks: [] }, // بخش‌هایی که مالک به صفحهٔ اصلی اضافه می‌کند
    pages: [],            // صفحه‌های دلخواه مالک (/p/<نشانی>)
    coupons: [],
    orders: [],
    licenses: [],
    stats: { downloads: {}, views: {} },
    audit: [],
  };
}

class DB {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.rev = 1; // با هر تغییر محتوا زیاد می‌شود (برای باطل‌کردن کش صفحه‌ها)
    this._timer = null;
    this._dirty = false;
    for (const d of ['', 'files', 'images', 'inbox', 'backups', 'tmp']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
    this.data = this._load();
    this.fresh = !!this._fresh;
    if (this._needsSave || this._fresh) this.saveNow();
  }

  _load() {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        if (!fs.existsSync(f)) continue;
        const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.meta) {
          if (f !== this.file) console.warn('[db] فایل اصلی خراب بود؛ از نسخهٔ قبلی (db.json.bak) بازیابی شد.');
          return this._migrate(parsed);
        }
      } catch (e) {
        console.error(`[db] خواندن ${path.basename(f)} ناموفق: ${e.message}`);
      }
    }
    if (fs.existsSync(this.file)) {
      // هر دو فایل خراب‌اند: روی داده نمی‌نویسیم، فایل خراب را نگه می‌داریم
      const keep = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, keep);
      console.error(`[db] دادهٔ خراب در ${keep} نگه داشته شد.`);
    }
    this._fresh = true;
    return defaults();
  }

  _migrate(d) {
    const base = defaults();
    for (const k of Object.keys(base)) if (d[k] === undefined) d[k] = base[k];
    if (!d.meta || !d.meta.indexNowKey || !d.meta.instance) this._needsSave = true; // کلیدهای ثابت باید همین حالا ذخیره شوند
    d.settings = Object.assign(base.settings, d.settings);
    d.meta = Object.assign(base.meta, d.meta);
    d.stats = Object.assign({ downloads: {}, views: {} }, d.stats);
    // دادهٔ نسخه‌های قبلی «بخش‌های صفحه» و «برچسب‌ها» را ندارد: جای خالی‌شان پر می‌شود تا همه‌جا آرایه باشند
    if (!d.home || typeof d.home !== 'object' || Array.isArray(d.home)) d.home = { blocks: [] };
    const rows = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) : []);
    d.home.blocks = rows(d.home.blocks);
    d.pages = rows(d.pages).filter((p) => typeof p.id === 'string' && typeof p.slug === 'string');
    for (const p of d.pages) p.blocks = rows(p.blocks);
    for (const a of Array.isArray(d.apps) ? d.apps : []) {
      if (!a || typeof a !== 'object') continue;
      a.blocks = rows(a.blocks);
      if (!Array.isArray(a.badges)) a.badges = [];
      for (const f of Array.isArray(a.features) ? a.features : []) if (f && typeof f === 'object' && typeof f.icon !== 'string') f.icon = '';
    }
    d.meta.schema = SCHEMA;
    return d;
  }

  // تغییر محتوا: کش صفحه‌ها باطل و ذخیره زمان‌بندی می‌شود
  touch() { this.rev++; this.save(); }

  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      try { this.flush(); this._retry = 0; } catch (e) {
        // دیسک پر، قفل موقت ویندوز و … : داده در حافظه می‌ماند و دوباره تلاش می‌شود
        this._retry = Math.min((this._retry || 0) + 1, 6);
        console.error(`[db] ذخیره نشد (${e.code || e.message}). ${this._retry * 5} ثانیهٔ دیگر دوباره تلاش می‌شود.`);
        const t = setTimeout(() => this.save(), this._retry * 5000);
        if (t.unref) t.unref();
      }
    }, 150);
    if (this._timer.unref) this._timer.unref();
  }

  // ذخیرهٔ فوری برای کارهای حساس (ورود، سفارش، اشتراک)
  saveNow() { this._dirty = true; this.flush(); }

  flush() {
    if (!this._dirty) return;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const json = JSON.stringify(this.data);
    const tmp = `${this.file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, json); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak'); } catch (_) { /* پشتیبان اختیاری */ }
    try { fs.renameSync(tmp, this.file); } catch (e) {
      // ویندوز گاهی فایل را یک لحظه قفل نگه می‌دارد (ضدویروس، نمایه‌ساز): یک بار دیگر
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') { try { fs.unlinkSync(tmp); } catch (_) { /* نادیده */ } throw e; }
      const until = Date.now() + 120; while (Date.now() < until) { /* مکث کوتاه */ }
      try { fs.renameSync(tmp, this.file); } catch (e2) { try { fs.unlinkSync(tmp); } catch (_) { /* نادیده */ } throw e2; }
    }
    this._dirty = false;
    this._dailyBackup(json);
  }

  _dailyBackup(json) {
    const key = dayKey();
    if (this._lastBackup === key) return;
    this._lastBackup = key;
    try {
      const dir = path.join(this.dir, 'backups');
      const f = path.join(dir, `db-${key}.json`);
      if (!fs.existsSync(f)) fs.writeFileSync(f, json);
      const all = fs.readdirSync(dir).filter((n) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
      for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.unlinkSync(path.join(dir, old));
    } catch (e) {
      console.error('[db] پشتیبان روزانه ناموفق:', e.message);
    }
  }

  audit(action, detail, ip) {
    this.data.audit.unshift({ at: new Date().toISOString(), action, detail: String(detail || '').slice(0, 300), ip: ip || '' });
    if (this.data.audit.length > 500) this.data.audit.length = 500;
    this.save();
  }

  bump(kind, appId, n = 1) {
    const day = dayKey();
    const bucket = this.data.stats[kind];
    if (!bucket[day]) bucket[day] = {};
    bucket[day][appId] = (bucket[day][appId] || 0) + n;
    // فقط ۴۰۰ روز آخر نگه داشته می‌شود
    const keys = Object.keys(bucket);
    if (keys.length > 400) for (const k of keys.sort().slice(0, keys.length - 400)) delete bucket[k];
    this.save();
  }
}

module.exports = { DB, defaults };
