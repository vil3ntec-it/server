'use strict';
// انبار فایل‌ها: بارگذاری جریانی، ثبت نسخه با تشخیص خودکار، تصویرها و پوشه‌های ورودی خودکار.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { id, str } = require('./util');
const { HttpError } = require('./http');
const { detect, extOf, ALLOWED_EXT, EXT_PLATFORM } = require('./detect');

const VIDEO_MAX = 60 * 1024 * 1024; // سقف حجم ویدیوی هر بخش
const IMAGE_TYPES = [
  { ext: 'png', test: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  { ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', test: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { ext: 'gif', test: (b) => b.length > 6 && /^GIF8[79]a$/.test(b.toString('latin1', 0, 6)) },
];

// اندازهٔ تصویر از سرآیند فایل (برای اینکه مرورگر جای تصویر را از پیش نگه دارد و صفحه نپرد)
function imageSize(buf, ext) {
  try {
    if (ext === 'png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (ext === 'gif') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (ext === 'webp') {
      const kind = buf.toString('latin1', 12, 16);
      if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1 }; }
      if (kind === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
    }
    if (ext === 'jpg') {
      let p = 2;
      while (p + 9 < buf.length) {
        if (buf[p] !== 0xff) { p++; continue; }
        const m = buf[p + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: buf.readUInt16BE(p + 7), h: buf.readUInt16BE(p + 5) };
        if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { p += 2; continue; }
        p += 2 + buf.readUInt16BE(p + 2);
      }
    }
  } catch (_) { /* سرآیند ناقص */ }
  return { w: 0, h: 0 };
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

class Files {
  constructor(db, dataDir) {
    this.db = db;
    this.dir = dataDir;
    this.filesDir = path.join(dataDir, 'files');
    this.imagesDir = path.join(dataDir, 'images');
    this.inboxDir = path.join(dataDir, 'inbox');
    this.tmpDir = path.join(dataDir, 'tmp');
    this.seen = new Map(); // فایل‌های ورودی که هنوز در حال کپی‌شدن‌اند
    this.scanning = false;
    this.lastScan = null;
    // پاک‌سازی باقی‌مانده‌های بارگذاری نیمه‌تمام
    try { for (const f of fs.readdirSync(this.tmpDir)) fs.unlinkSync(path.join(this.tmpDir, f)); } catch (_) { /* خالی */ }
  }

  filePath(v) { return path.join(this.filesDir, path.basename(v.file)); }
  imagePath(name) { return path.join(this.imagesDir, path.basename(name)); }

  // دریافت بدنهٔ درخواست روی دیسک، با محاسبهٔ هم‌زمان SHA-256 و سقف حجم
  receive(ctx, maxBytes) {
    return new Promise((resolve, reject) => {
      const declared = Number(ctx.req.headers['content-length'] || 0);
      if (declared > maxBytes) return reject(new HttpError(413, 'حجم فایل از سقف مجاز بیشتر است'));
      const tmp = path.join(this.tmpDir, `up-${id(8)}`);
      const ws = fs.createWriteStream(tmp, { flags: 'wx' });
      const hash = crypto.createHash('sha256');
      let size = 0, done = false;
      const fail = (err) => {
        if (done) return; done = true;
        ws.destroy(); fs.unlink(tmp, () => {});
        reject(err);
      };
      ctx.req.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { ctx.req.unpipe(ws); ctx.req.resume(); return fail(new HttpError(413, 'حجم فایل از سقف مجاز بیشتر است')); }
        hash.update(c);
      });
      ctx.req.on('aborted', () => fail(new HttpError(400, 'بارگذاری قطع شد')));
      ctx.req.on('error', fail);
      ws.on('error', (e) => fail(e.code === 'ENOSPC' ? new HttpError(507, 'فضای دیسک سرور پر است') : e));
      ws.on('finish', () => { if (done) return; done = true; if (!size) { fs.unlink(tmp, () => {}); return reject(new HttpError(400, 'فایل خالی است')); } resolve({ tmp, size, sha256: hash.digest('hex') }); });
      ctx.req.pipe(ws);
    });
  }

  checkName(name) {
    const clean = str(path.basename(String(name || '').replace(/\\/g, '/')), 160);
    const ext = extOf(clean);
    if (!ALLOWED_EXT.includes(ext)) throw new HttpError(400, `پسوند «${ext || '؟'}» پذیرفته نمی‌شود. پسوندهای مجاز: ${ALLOWED_EXT.join('، ')}`);
    return { clean, ext };
  }

  // ثبت یک فایل به‌عنوان نسخهٔ جدید برنامه
  addVersion(app, srcPath, originalName, { sha256, size, publish = true, move = true, via = 'upload' } = {}) {
    const { clean, ext } = this.checkName(originalName);
    const dup = app.versions.find((v) => v.sha256 === sha256);
    if (dup) {
      if (move) fs.unlink(srcPath, () => {});
      throw new HttpError(409, `همین فایل قبلاً به‌عنوان نسخهٔ ${dup.version || '؟'} ثبت شده است`, { duplicate: dup.id });
    }
    const info = detect(srcPath, clean);
    const vid = id(6);
    const stored = `${app.id}-${vid}.${ext}`.replace(/[^\w.-]/g, '_');
    const dest = path.join(this.filesDir, stored);
    if (move) {
      try { fs.renameSync(srcPath, dest); } catch (_) { fs.copyFileSync(srcPath, dest); fs.unlinkSync(srcPath); }
    } else fs.copyFileSync(srcPath, dest);
    const version = {
      id: vid, version: info.version, code: info.code, platform: info.platform || EXT_PLATFORM[ext] || 'other',
      file: stored, fileName: clean, ext, size, sha256,
      notes: '', package: info.package || '', minOs: info.minOs || '', source: info.source || '',
      published: !!(publish && info.version), publishedAt: new Date().toISOString(), downloads: 0, via,
    };
    app.versions.unshift(version);
    app.updatedAt = version.publishedAt;
    this.db.touch();
    return version;
  }

  removeVersion(app, vid) {
    const i = app.versions.findIndex((v) => v.id === vid);
    if (i < 0) throw new HttpError(404, 'نسخه پیدا نشد');
    const [v] = app.versions.splice(i, 1);
    fs.unlink(this.filePath(v), () => {});
    this.db.touch();
    return v;
  }

  saveImage(buf) {
    if (!buf || buf.length < 24) throw new HttpError(400, 'تصویر خالی است');
    if (buf.length > 6 * 1024 * 1024) throw new HttpError(413, 'تصویر باید کمتر از ۶ مگابایت باشد');
    const kind = IMAGE_TYPES.find((t) => t.test(buf));
    if (!kind) throw new HttpError(400, 'فقط تصویر PNG، JPG، WebP یا GIF پذیرفته می‌شود');
    const name = `${id(10)}.${kind.ext}`;
    const size = imageSize(buf, kind.ext);
    if (size.w > 12000 || size.h > 12000) throw new HttpError(400, 'تصویر خیلی بزرگ است');
    fs.writeFileSync(path.join(this.imagesDir, name), buf);
    return { name, w: size.w, h: size.h };
  }

  // ویدیوی بخش «ویدیو»: فقط MP4 و WebM، از روی خودِ بایت‌های فایل (نه نام یا نوعِ اعلام‌شده). کنار تصویرها نگه داشته می‌شود.
  saveVideo(buf) {
    if (!buf || buf.length < 32) throw new HttpError(400, 'ویدیو خالی است');
    if (buf.length > VIDEO_MAX) throw new HttpError(413, `ویدیو باید کمتر از ${VIDEO_MAX / 1048576} مگابایت باشد`);
    const mp4 = buf.toString('latin1', 4, 8) === 'ftyp';
    const webm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    if (!mp4 && !webm) throw new HttpError(400, 'فقط ویدیوی MP4 یا WebM پذیرفته می‌شود');
    const name = `${id(10)}.${mp4 ? 'mp4' : 'webm'}`;
    fs.writeFileSync(path.join(this.imagesDir, name), buf);
    return { name, size: buf.length, mime: mp4 ? 'video/mp4' : 'video/webm' };
  }

  removeImage(name) { if (name) fs.unlink(this.imagePath(name), () => {}); }

  removeApp(app) {
    for (const v of app.versions) fs.unlink(this.filePath(v), () => {});
    for (const s of app.screenshots) this.removeImage(s.file);
    this.removeImage(app.icon);
  }

  // علامت‌گذاری نسخه‌هایی که فایل‌شان روی دیسک نیست (مثلاً بعد از بازگردانی پشتیبان)
  verify() {
    let missing = 0;
    for (const app of this.db.data.apps) {
      for (const v of app.versions) {
        const gone = !fs.existsSync(this.filePath(v));
        if (gone) missing++;
        if (!!v.missing !== gone) { v.missing = gone; this.db.touch(); }
      }
    }
    return missing;
  }

  ensureInbox() {
    for (const app of this.db.data.apps) { try { fs.mkdirSync(path.join(this.inboxDir, app.slug), { recursive: true }); } catch (_) { /* نادیده */ } }
  }

  // پیدا کردن خودکار نسخه‌های تازه:
  //  ۱) data/inbox/<نشانی-برنامه>/  → فایل منتقل و ثبت می‌شود
  //  ۲) «پوشهٔ ساخت» هر برنامه       → فایل کپی و ثبت می‌شود (اصل دست نمی‌خورد)
  async scan({ force = false } = {}) {
    if (this.scanning) return { busy: true, added: [] };
    this.scanning = true;
    const added = [], errors = [];
    try {
      this.ensureInbox();
      const data = this.db.data;
      const seenWatch = data.meta.watchSeen || (data.meta.watchSeen = {});
      const now = Date.now();
      for (const app of data.apps) {
        const sources = [{ dir: path.join(this.inboxDir, app.slug), move: true }];
        if (app.watchDir) sources.push({ dir: app.watchDir, move: false });
        for (const src of sources) {
          let names;
          try { names = fs.readdirSync(src.dir); } catch (e) { if (!src.move) errors.push(`${app.name}: پوشهٔ ساخت خوانده نشد (${src.dir})`); continue; }
          for (const name of names) {
            if (name.startsWith('.') || name.startsWith('~')) continue;
            const ext = extOf(name);
            if (!ALLOWED_EXT.includes(ext)) continue;
            const full = path.join(src.dir, name);
            let st;
            try { st = fs.statSync(full); } catch (_) { continue; }
            if (!st.isFile() || !st.size) continue;
            const sig = `${st.size}:${Math.round(st.mtimeMs)}`;
            if (!src.move && seenWatch[full] === sig) continue;
            // صبر تا کپی‌شدن فایل تمام شود: اندازه و زمان باید در دو بررسی یکسان بماند
            const prev = this.seen.get(full);
            if (!force && (!prev || prev.sig !== sig || now - prev.at < 4000)) { if (!prev || prev.sig !== sig) this.seen.set(full, { sig, at: now }); continue; }
            this.seen.delete(full);
            try {
              const sha256 = await hashFile(full);
              if (app.versions.some((v) => v.sha256 === sha256)) {
                if (src.move) fs.unlink(full, () => {}); else seenWatch[full] = sig;
                continue;
              }
              const v = this.addVersion(app, full, name, { sha256, size: st.size, publish: data.settings.autoPublish !== false, move: src.move, via: src.move ? 'inbox' : 'watch' });
              if (!src.move) seenWatch[full] = sig;
              added.push({ app: app.name, version: v.version, file: name, published: v.published });
              this.db.audit('auto-version', `${app.name}: ${name} → نسخهٔ ${v.version || 'نامشخص'}`, 'خودکار');
            } catch (e) {
              errors.push(`${app.name}: ${name} — ${e.message}`);
              if (!src.move) seenWatch[full] = sig;
            }
          }
        }
      }
      const keys = Object.keys(seenWatch);
      if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete seenWatch[k];
      if (added.length) this.db.saveNow();
    } finally {
      this.scanning = false;
      this.lastScan = { at: new Date().toISOString(), added: added.length, errors };
    }
    return { added, errors };
  }

  start(intervalMs = 15000) {
    const tick = () => this.scan().catch((e) => console.error('[ورودی خودکار]', e.message));
    this.timer = setInterval(tick, intervalMs);
    if (this.timer.unref) this.timer.unref();
    setTimeout(tick, 1500).unref();
  }
}

module.exports = { Files, hashFile, imageSize, VIDEO_MAX };
