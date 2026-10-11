'use strict';
// تشخیص خودکار نسخه از داخل خودِ فایل برنامه — بدون هیچ ابزار بیرونی.
//   APK / XAPK  → AndroidManifest (versionName, versionCode, package, minSdk)
//   EXE / DLL   → منبع نسخهٔ ویندوز (ProductVersion / FileVersion)
//   ZIP         → package.json ، manifest ، version.txt ، index.html
//   HTML        → متا تگ نسخه یا ثابت APP_VERSION داخل کد
//   بقیه        → از نام فایل
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { toLatinDigits } = require('./util');

const PLATFORMS = {
  android: 'اندروید', windows: 'ویندوز', web: 'وب', mac: 'مک', linux: 'لینوکس', ios: 'آیفون', other: 'سایر',
};

const EXT_PLATFORM = {
  apk: 'android', xapk: 'android', apks: 'android', aab: 'android',
  exe: 'windows', msi: 'windows', msix: 'windows', appx: 'windows',
  dmg: 'mac', pkg: 'mac',
  appimage: 'linux', deb: 'linux', rpm: 'linux',
  ipa: 'ios',
  html: 'web', htm: 'web', zip: 'web',
  rar: 'other', '7z': 'other', gz: 'other', pdf: 'other',
};
const ALLOWED_EXT = Object.keys(EXT_PLATFORM);

const VERSION_RE = /\d+(?:\.\d+){1,3}(?:[-.]?(?:alpha|beta|rc|b|a)\.?\d*)?/i;

function extOf(name) {
  return path.extname(String(name || '')).slice(1).toLowerCase();
}

function readAt(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return n === len ? buf : buf.subarray(0, n);
}

/* ───────────── ZIP ───────────── */

function zipEntries(fd, size) {
  const tailLen = Math.min(size, 65557);
  const tail = readAt(fd, size - tailLen, tailLen);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) return null;
  let cdSize = tail.readUInt32LE(e + 12);
  let cdOff = tail.readUInt32LE(e + 16);
  if (cdOff === 0xffffffff || cdSize === 0xffffffff) {
    // ZIP64
    const loc = e - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) return null;
    const recOff = Number(tail.readBigUInt64LE(loc + 8));
    const rec = readAt(fd, recOff, 56);
    if (rec.length < 56 || rec.readUInt32LE(0) !== 0x06064b50) return null;
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOff = Number(rec.readBigUInt64LE(48));
  }
  if (cdSize <= 0 || cdSize > 32 * 1024 * 1024 || cdOff + cdSize > size) return null;
  const cd = readAt(fd, cdOff, cdSize);
  const out = [];
  let p = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
    const method = cd.readUInt16LE(p + 10);
    let comp = cd.readUInt32LE(p + 20);
    let uncomp = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let off = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, p + 46 + nl);
    if (comp === 0xffffffff || uncomp === 0xffffffff || off === 0xffffffff) {
      let x = p + 46 + nl;
      const xe = x + xl;
      while (x + 4 <= xe) {
        const hid = cd.readUInt16LE(x), hsz = cd.readUInt16LE(x + 2);
        if (hid === 0x0001) {
          let q = x + 4;
          if (uncomp === 0xffffffff && q + 8 <= xe) { uncomp = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (comp === 0xffffffff && q + 8 <= xe) { comp = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (off === 0xffffffff && q + 8 <= xe) { off = Number(cd.readBigUInt64LE(q)); }
          break;
        }
        x += 4 + hsz;
      }
    }
    out.push({ name, method, comp, uncomp, off });
    p += 46 + nl + xl + cl;
    if (out.length > 200000) break;
  }
  return out;
}

function zipRead(fd, entry, max = 8 * 1024 * 1024) {
  if (!entry || entry.comp > max * 4) return null;
  const lh = readAt(fd, entry.off, 30);
  if (lh.length < 30 || lh.readUInt32LE(0) !== 0x04034b50) return null;
  const start = entry.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  const raw = readAt(fd, start, entry.comp);
  try {
    if (entry.method === 0) return raw.subarray(0, max);
    if (entry.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: max });
  } catch (_) { /* فشرده‌سازی ناشناخته یا خراب */ }
  return null;
}

/* ───────────── AndroidManifest دودویی (AXML) ───────────── */

function axmlStrings(buf, off) {
  const hsize = buf.readUInt16LE(off + 2);
  const count = buf.readUInt32LE(off + 8);
  const flags = buf.readUInt32LE(off + 16);
  const start = off + buf.readUInt32LE(off + 20);
  const utf8 = (flags & 0x100) !== 0;
  const cache = new Map();
  return (i) => {
    if (i < 0 || i >= count) return '';
    if (cache.has(i)) return cache.get(i);
    let s = '';
    try {
      let p = start + buf.readUInt32LE(off + hsize + i * 4);
      if (utf8) {
        if (buf[p] & 0x80) p += 2; else p += 1; // تعداد نویسه
        let len = buf[p];
        if (len & 0x80) { len = ((len & 0x7f) << 8) | buf[p + 1]; p += 2; } else p += 1;
        s = buf.toString('utf8', p, p + len);
      } else {
        let len = buf.readUInt16LE(p);
        if (len & 0x8000) { len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p + 2); p += 4; } else p += 2;
        s = buf.toString('utf16le', p, p + len * 2);
      }
    } catch (_) { s = ''; }
    cache.set(i, s);
    return s;
  };
}

const RES_VERSION_CODE = 0x0101021b, RES_VERSION_NAME = 0x0101021c, RES_MIN_SDK = 0x0101020c;

function parseAxml(buf) {
  if (!buf || buf.length < 16 || buf.readUInt16LE(0) !== 0x0003) return null;
  let off = buf.readUInt16LE(2);
  let strAt = null;
  const resMap = [];
  const out = {};
  let guard = 0;
  while (off + 8 <= buf.length && guard++ < 100000) {
    const type = buf.readUInt16LE(off), hsize = buf.readUInt16LE(off + 2), size = buf.readUInt32LE(off + 4);
    if (size < 8 || off + size > buf.length) break;
    if (type === 0x0001) strAt = axmlStrings(buf, off);
    else if (type === 0x0180) { for (let p = off + hsize; p + 4 <= off + size; p += 4) resMap.push(buf.readUInt32LE(p)); }
    else if (type === 0x0102 && strAt) {
      const p = off + hsize;
      const el = strAt(buf.readInt32LE(p + 4));
      if (el === 'manifest' || el === 'uses-sdk') {
        const aStart = buf.readUInt16LE(p + 8), aSize = buf.readUInt16LE(p + 10), aCount = buf.readUInt16LE(p + 12);
        for (let i = 0; i < aCount; i++) {
          const a = p + aStart + i * aSize;
          if (a + 20 > buf.length) break;
          const nameIdx = buf.readInt32LE(a + 4);
          const rawIdx = buf.readInt32LE(a + 8);
          const dataType = buf[a + 15];
          const data = buf.readUInt32LE(a + 16);
          const resId = nameIdx >= 0 && nameIdx < resMap.length ? resMap[nameIdx] : 0;
          const aname = strAt(nameIdx);
          let val = null;
          if (dataType === 0x03) val = strAt(data);
          else if (dataType === 0x10 || dataType === 0x11) val = data;
          else if (rawIdx >= 0) val = strAt(rawIdx);
          if (el === 'manifest') {
            if (resId === RES_VERSION_CODE || aname === 'versionCode') out.code = Number(val) || null;
            else if (resId === RES_VERSION_NAME || aname === 'versionName') { if (typeof val === 'string' && val) out.version = val; }
            else if (aname === 'package' && typeof val === 'string') out.package = val;
          } else if (resId === RES_MIN_SDK || aname === 'minSdkVersion') out.minSdk = Number(val) || null;
        }
      } else if (el === 'application') break; // بعد از این چیز لازمی نیست
    }
    off += size;
  }
  return out.version || out.code || out.package ? out : null;
}

const SDK_NAMES = {
  21: '۵', 22: '۵٫۱', 23: '۶', 24: '۷', 25: '۷٫۱', 26: '۸', 27: '۸٫۱', 28: '۹', 29: '۱۰', 30: '۱۱', 31: '۱۲', 32: '۱۲', 33: '۱۳', 34: '۱۴', 35: '۱۵', 36: '۱۶',
};
function androidName(sdk) {
  if (!sdk) return '';
  if (SDK_NAMES[sdk]) return `اندروید ${SDK_NAMES[sdk]} به بالا`;
  return sdk < 21 ? 'اندروید ۴٫۴ به بالا' : `اندروید (API ${sdk}) به بالا`;
}

/* ───────────── ویندوز: منبع نسخه در فایل PE ───────────── */

function readUtf16Value(buf, keyAscii) {
  const key = Buffer.from(keyAscii + '\0', 'utf16le');
  let i = buf.indexOf(key);
  if (i < 0) return '';
  i += key.length;
  while (i + 1 < buf.length && buf.readUInt16LE(i) === 0) i += 2; // پرکنندهٔ هم‌ترازی
  let j = i;
  while (j + 1 < buf.length && buf.readUInt16LE(j) !== 0 && j - i < 128) j += 2;
  return buf.toString('utf16le', i, j).trim();
}

function versionFromBlock(block) {
  const i = block.indexOf(Buffer.from([0xbd, 0x04, 0xef, 0xfe]));
  if (i < 0 || i + 52 > block.length || block.readUInt32LE(i + 4) !== 0x00010000) return null;
  const ms = block.readUInt32LE(i + 8), ls = block.readUInt32LE(i + 12), pms = block.readUInt32LE(i + 16), pls = block.readUInt32LE(i + 20);
  const fileV = [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff], prodV = [pms >>> 16, pms & 0xffff, pls >>> 16, pls & 0xffff];
  const tail = block.subarray(i);
  const pick = [readUtf16Value(tail, 'ProductVersion'), readUtf16Value(tail, 'FileVersion')].map((s) => (toLatinDigits(s).match(VERSION_RE) || [''])[0]).find(Boolean);
  const nums = prodV.some(Boolean) ? prodV : fileV;
  let numeric = nums.join('.').replace(/(\.0)+$/, '');
  if (!/\./.test(numeric)) numeric += '.0';
  const version = pick || (nums.some(Boolean) ? numeric : '');
  return version ? { version, code: null, source: 'pe' } : null;
}

// راه دقیق: منبع نسخهٔ خودِ فایل از جدول منابع PE (نه نسخهٔ یک DLL که داخل فایل جاسازی شده)
function peResourceVersion(fd, size) {
  const dos = readAt(fd, 0, 64);
  if (dos.length < 64) return null;
  const pe = dos.readUInt32LE(0x3c);
  if (pe <= 0 || pe + 24 > size) return null;
  const coff = readAt(fd, pe, 24);
  if (coff.length < 24 || coff.readUInt32LE(0) !== 0x00004550) return null;
  const sections = coff.readUInt16LE(6), optSize = coff.readUInt16LE(20);
  if (!sections || sections > 96 || optSize < 96 || optSize > 4096) return null;
  const opt = readAt(fd, pe + 24, optSize);
  const magic = opt.readUInt16LE(0);
  const dirs = magic === 0x20b ? 112 : magic === 0x10b ? 96 : 0;
  if (!dirs || dirs + 24 > opt.length) return null;
  const resRva = opt.readUInt32LE(dirs + 16), resSize = opt.readUInt32LE(dirs + 20);
  if (!resRva || !resSize) return null;
  const table = readAt(fd, pe + 24 + optSize, sections * 40);
  const toOffset = (rva) => {
    for (let i = 0; i + 40 <= table.length; i += 40) {
      const va = table.readUInt32LE(i + 12), raw = table.readUInt32LE(i + 16), ptr = table.readUInt32LE(i + 20), vs = Math.max(table.readUInt32LE(i + 8), raw);
      if (rva >= va && rva < va + vs) return ptr + (rva - va);
    }
    return -1;
  };
  const base = toOffset(resRva);
  if (base < 0 || base >= size) return null;
  const dir = (off) => {
    const head = readAt(fd, base + off, 16);
    if (head.length < 16) return [];
    const n = Math.min(head.readUInt16LE(12) + head.readUInt16LE(14), 256);
    const body = readAt(fd, base + off + 16, n * 8), out = [];
    for (let i = 0; i + 8 <= body.length; i += 8) out.push({ id: body.readUInt32LE(i), to: body.readUInt32LE(i + 4) });
    return out;
  };
  const sub = (entry) => (entry && entry.to & 0x80000000 ? (entry.to & 0x7fffffff) : -1);
  const type = sub(dir(0).find((x) => x.id === 16)); // RT_VERSION
  if (type < 0 || type > resSize) return null;
  const name = sub(dir(type)[0]);
  if (name < 0 || name > resSize) return null;
  const lang = dir(name)[0];
  if (!lang || lang.to & 0x80000000 || lang.to > resSize) return null;
  const entry = readAt(fd, base + lang.to, 16);
  if (entry.length < 16) return null;
  const at = toOffset(entry.readUInt32LE(0)), len = Math.min(entry.readUInt32LE(4), 256 * 1024);
  if (at < 0 || at >= size || len < 60) return null;
  return versionFromBlock(readAt(fd, at, len));
}

function peVersion(fd, size) {
  if (readAt(fd, 0, 2).toString('latin1') !== 'MZ') return null;
  try { const exact = peResourceVersion(fd, size); if (exact) return exact; } catch (_) { /* ساختار غیرعادی: جست‌وجوی ساده */ }
  const sig = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);
  const CHUNK = 4 * 1024 * 1024, OVER = 64;
  const limit = Math.min(size, 1024 * 1024 * 1024);
  for (let pos = 0; pos < limit; pos += CHUNK - OVER) {
    const buf = readAt(fd, pos, Math.min(CHUNK, size - pos));
    let i = -1;
    while ((i = buf.indexOf(sig, i + 1)) >= 0) {
      const fixed = readAt(fd, pos + i, 52);
      if (fixed.length < 52 || fixed.readUInt32LE(4) !== 0x00010000) continue;
      const ms = fixed.readUInt32LE(8), ls = fixed.readUInt32LE(12);
      const pms = fixed.readUInt32LE(16), pls = fixed.readUInt32LE(20);
      const fileV = [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff];
      const prodV = [pms >>> 16, pms & 0xffff, pls >>> 16, pls & 0xffff];
      // رشته‌های نسخه معمولاً چند کیلوبایت بعد از ساختار ثابت‌اند
      const around = readAt(fd, pos + i, 16 * 1024);
      const strP = toLatinDigits(readUtf16Value(around, 'ProductVersion'));
      const strF = toLatinDigits(readUtf16Value(around, 'FileVersion'));
      const pick = [strP, strF].map((s) => (s.match(VERSION_RE) || [''])[0]).find(Boolean);
      const nums = (prodV.some(Boolean) ? prodV : fileV);
      let numeric = nums.join('.').replace(/(\.0)+$/, '');
      if (!/\./.test(numeric)) numeric += '.0';
      const version = pick || (nums.some(Boolean) ? numeric : '');
      if (!version) continue;
      return { version, code: null, source: 'pe', product: readUtf16Value(around, 'ProductName') };
    }
    if (pos + CHUNK >= size) break;
  }
  return null;
}

/* ───────────── متن: HTML / JS / JSON ───────────── */

function versionFromText(text) {
  const t = toLatinDigits(text).replace(/(\d)٫(?=\d)/g, '$1.');
  const tests = [
    /<meta\s[^>]{0,200}?name=["'](?:app-?version|version)["'][^>]{0,200}?content=["']v?([^"']{1,32})["']/i,
    /<meta\s[^>]{0,200}?content=["']v?([^"']{1,32})["'][^>]{0,200}?name=["'](?:app-?version|version)["']/i,
    /\b(?:APP_?VERSION|appVersion|APP_VER|__VERSION__|VERSION)\b\s*[:=]\s*["'`]v?(\d+(?:\.\d+){1,3}[\w.-]{0,12})["'`]/,
    /["']?\bversion["']?\s*[:=]\s*["'`]v?(\d+(?:\.\d+){1,3}[\w.-]{0,12})["'`]/i,
    /data-version=["']v?(\d+(?:\.\d+){1,3}[\w.-]{0,12})["']/i,
    /<title>[^<]{0,200}?\bv(\d+(?:\.\d+){1,3})[^<]{0,200}<\/title>/i,
    /(?:نسخه|نسخهٔ|ورژن)\s*[:：]?\s*v?(\d+(?:\.\d+){1,3})/,
  ];
  for (const re of tests) {
    const m = t.match(re);
    if (m && VERSION_RE.test(m[1])) return m[1].match(VERSION_RE)[0];
  }
  return '';
}

function versionFromName(name) {
  const base = toLatinDigits(path.basename(String(name || ''), path.extname(String(name || ''))));
  const m = base.match(/(?:^|[-_ .(v])v?(\d+(?:\.\d+){1,3}(?:[-.]?(?:alpha|beta|rc)\.?\d*)?)/i);
  if (m) return m[1];
  const single = base.match(/(?:^|[-_ ])v(\d{1,4})(?:$|[-_ ])/i);
  return single ? `${single[1]}.0` : '';
}

/* ───────────── تشخیص اصلی ───────────── */

function detect(filePath, originalName) {
  const ext = extOf(originalName || filePath);
  const res = { version: '', code: null, platform: EXT_PLATFORM[ext] || 'other', package: '', minSdk: null, minOs: '', source: '', ext };
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const head = readAt(fd, 0, 8);
    const isZip = head.length >= 4 && head.readUInt32LE(0) === 0x04034b50;
    const isPE = head.toString('latin1', 0, 2) === 'MZ';

    if (isZip) {
      const entries = zipEntries(fd, size) || [];
      const find = (re) => entries.find((e) => re.test(e.name));
      const manifest = entries.find((e) => e.name === 'AndroidManifest.xml');
      if (manifest) {
        const info = parseAxml(zipRead(fd, manifest));
        if (info) {
          Object.assign(res, { version: info.version || '', code: info.code || null, package: info.package || '', minSdk: info.minSdk || null, platform: 'android', source: 'apk' });
          res.minOs = androidName(info.minSdk);
          if (!res.version && res.code) res.version = String(res.code);
        }
      }
      if (!res.source) {
        // XAPK / APKS: فایل manifest.json متنی
        const mj = entries.find((e) => e.name === 'manifest.json');
        const txt = mj && zipRead(fd, mj, 1024 * 1024);
        if (txt) {
          try {
            const j = JSON.parse(txt.toString('utf8'));
            if (j.version_name || j.package_name) {
              Object.assign(res, { version: String(j.version_name || ''), code: Number(j.version_code) || null, package: String(j.package_name || ''), platform: 'android', source: 'xapk' });
              if (j.min_sdk_version) { res.minSdk = Number(j.min_sdk_version); res.minOs = androidName(res.minSdk); }
            } else if (j.version) Object.assign(res, { version: String(j.version), source: 'manifest' });
          } catch (_) { /* JSON نبود */ }
        }
      }
      if (!res.source) {
        const pj = find(/^(?:[^/]+\/)?package\.json$/);
        const txt = pj && zipRead(fd, pj, 1024 * 1024);
        if (txt) { try { const j = JSON.parse(txt.toString('utf8')); if (j.version) Object.assign(res, { version: String(j.version), source: 'package.json' }); } catch (_) { /* نادیده */ } }
      }
      if (!res.source) {
        const wm = find(/^(?:[^/]+\/)?(?:manifest\.webmanifest|version\.json)$/);
        const txt = wm && zipRead(fd, wm, 1024 * 1024);
        if (txt) { try { const j = JSON.parse(txt.toString('utf8')); if (j.version) Object.assign(res, { version: String(j.version), source: 'manifest' }); } catch (_) { /* نادیده */ } }
      }
      if (!res.source) {
        const vt = find(/^(?:[^/]+\/)?(?:version\.txt|VERSION)$/i);
        const txt = vt && zipRead(fd, vt, 4096);
        const v = txt && (toLatinDigits(txt.toString('utf8')).match(VERSION_RE) || [''])[0];
        if (v) Object.assign(res, { version: v, source: 'version.txt' });
      }
      if (!res.source) {
        const ih = find(/^(?:[^/]+\/)?index\.html?$/i);
        const txt = ih && zipRead(fd, ih);
        const v = txt && versionFromText(txt.toString('utf8'));
        if (v) Object.assign(res, { version: v, source: 'index.html' });
      }
      // نصب‌کنندهٔ ویندوزی داخل ZIP
      if (!res.source && entries.some((e) => /\.exe$/i.test(e.name)) && !entries.some((e) => /\.html?$/i.test(e.name))) res.platform = 'windows';
    } else if (isPE) {
      const pe = peVersion(fd, size);
      res.platform = 'windows';
      if (pe) Object.assign(res, { version: pe.version, source: 'exe' });
    } else if (ext === 'html' || ext === 'htm') {
      const txt = readAt(fd, 0, Math.min(size, 12 * 1024 * 1024)).toString('utf8');
      const v = versionFromText(txt);
      if (v) Object.assign(res, { version: v, source: 'html' });
    }
  } catch (e) {
    res.error = e.message;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) { /* بسته */ }
  }
  if (!res.version) {
    const v = versionFromName(originalName || filePath);
    if (v) Object.assign(res, { version: v, source: 'filename' });
  }
  // فقط نویسه‌های بی‌خطر در شمارهٔ نسخه می‌ماند (این مقدار در نام فایل دانلود و نشانی‌ها می‌آید)
  res.version = toLatinDigits(String(res.version || '')).replace(/^v/i, '').replace(/[^\w.+-]/g, '').slice(0, 40);
  return res;
}

const SOURCE_LABEL = {
  apk: 'از داخل APK خوانده شد', xapk: 'از داخل XAPK خوانده شد', exe: 'از مشخصات فایل ویندوز خوانده شد',
  'package.json': 'از package.json خوانده شد', manifest: 'از manifest خوانده شد', 'version.txt': 'از version.txt خوانده شد',
  'index.html': 'از index.html خوانده شد', html: 'از داخل فایل HTML خوانده شد', filename: 'از نام فایل خوانده شد',
  manual: 'دستی وارد شد', '': 'پیدا نشد',
};

module.exports = { detect, peResourceVersion, parseAxml, versionFromText, versionFromName, extOf, PLATFORMS, EXT_PLATFORM, ALLOWED_EXT, SOURCE_LABEL, zipEntries, zipRead };
