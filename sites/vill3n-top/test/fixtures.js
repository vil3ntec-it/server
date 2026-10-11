'use strict';
// سازندهٔ فایل‌های آزمایشی واقعی‌نما: APK (با AndroidManifest دودویی)، EXE (با منبع نسخه)، ZIP و HTML
const { zipBuffer } = require('../src/core/zip');

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }
function i32(n) { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; }
function pad4(b) { const r = b.length % 4; return r ? Buffer.concat([b, Buffer.alloc(4 - r)]) : b; }

function stringPool(strings, utf8) {
  const offsets = [];
  const parts = [];
  let pos = 0;
  for (const s of strings) {
    offsets.push(pos);
    let enc;
    if (utf8) {
      const bytes = Buffer.from(s, 'utf8');
      enc = Buffer.concat([Buffer.from([s.length, bytes.length]), bytes, Buffer.from([0])]);
    } else {
      enc = Buffer.concat([u16(s.length), Buffer.from(s, 'utf16le'), u16(0)]);
    }
    parts.push(enc);
    pos += enc.length;
  }
  const data = pad4(Buffer.concat(parts));
  const hsize = 28;
  const stringsStart = hsize + strings.length * 4;
  const size = stringsStart + data.length;
  return Buffer.concat([
    u16(0x0001), u16(hsize), u32(size), u32(strings.length), u32(0), u32(utf8 ? 0x100 : 0), u32(stringsStart), u32(0),
    ...offsets.map(u32), data,
  ]);
}

function startTag(nameIdx, attrs) {
  // attrs: [{ name, type, data, raw }]
  const body = Buffer.concat([
    i32(-1), i32(nameIdx), u16(20), u16(20), u16(attrs.length), u16(0), u16(0), u16(0),
    ...attrs.map((a) => Buffer.concat([i32(-1), i32(a.name), i32(a.raw === undefined ? -1 : a.raw), u16(8), Buffer.from([0, a.type]), u32(a.data)])),
  ]);
  return Buffer.concat([u16(0x0102), u16(16), u32(16 + body.length), u32(1), i32(-1), body]);
}

// AndroidManifest.xml دودویی. obfuscated=true یعنی نام ویژگی‌ها خالی است و فقط شناسهٔ منبع وجود دارد.
function axml({ version = '2.4.1', code = 241, pkg = 'af.vill3n.shop', minSdk = 24, utf8 = false, obfuscated = false } = {}) {
  const S = [obfuscated ? '' : 'versionCode', obfuscated ? '' : 'versionName', obfuscated ? '' : 'minSdkVersion', 'package', 'manifest', 'uses-sdk', 'application', version, pkg];
  const pool = stringPool(S, utf8);
  const resMap = Buffer.concat([u16(0x0180), u16(8), u32(8 + 12), u32(0x0101021b), u32(0x0101021c), u32(0x0101020c)]);
  const manifest = startTag(4, [
    { name: 0, type: 0x10, data: code },
    { name: 1, type: 0x03, data: 7, raw: 7 },
    { name: 3, type: 0x03, data: 8, raw: 8 },
  ]);
  const usesSdk = startTag(5, [{ name: 2, type: 0x10, data: minSdk }]);
  const application = startTag(6, []);
  const body = Buffer.concat([pool, resMap, manifest, usesSdk, application]);
  return Buffer.concat([u16(0x0003), u16(8), u32(8 + body.length), body]);
}

function apk(opts) {
  return zipBuffer([
    { name: 'AndroidManifest.xml', data: axml(opts) },
    { name: 'classes.dex', data: Buffer.from('dex\n035\0' + 'x'.repeat(4000)) },
    { name: 'res/drawable/icon.png', data: Buffer.alloc(300, 7), store: true },
  ]);
}

function utf16z(s) { return Buffer.from(s + '\0', 'utf16le'); }

// فایل PE حداقلی با ساختار VS_VERSIONINFO (همان چیزی که ویندوز در «Properties → Details» نشان می‌دهد)
function exe({ fileVersion = [3, 1, 0, 0], productVersion = '3.1.0', withString = true } = {}) {
  const head = Buffer.alloc(4096);
  head.write('MZ', 0, 'latin1');
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xfeef04bd, 0); fixed.writeUInt32LE(0x00010000, 4);
  fixed.writeUInt32LE((fileVersion[0] << 16) | fileVersion[1], 8); fixed.writeUInt32LE((fileVersion[2] << 16) | fileVersion[3], 12);
  fixed.writeUInt32LE((fileVersion[0] << 16) | fileVersion[1], 16); fixed.writeUInt32LE((fileVersion[2] << 16) | fileVersion[3], 20);
  const parts = [head, utf16z('VS_VERSION_INFO'), u16(0), fixed, utf16z('StringFileInfo'), utf16z('040904b0')];
  if (withString) {
    parts.push(pad4(utf16z('FileVersion')), utf16z(fileVersion.join('.')), u16(0));
    parts.push(pad4(utf16z('ProductName')), utf16z('VILL3N Pump'), u16(0));
    parts.push(pad4(utf16z('ProductVersion')), utf16z(productVersion), u16(0));
  }
  parts.push(Buffer.alloc(2048, 0x90));
  return Buffer.concat(parts);
}

function html(version = '1.7.2', style = 'meta') {
  if (style === 'meta') return Buffer.from(`<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="app-version" content="${version}"><title>برنامه</title></head><body>سلام</body></html>`);
  if (style === 'const') return Buffer.from(`<!doctype html><html><head><title>برنامه</title></head><body><script>const APP_VERSION = '${version}';</script></body></html>`);
  if (style === 'fa') return Buffer.from(`<!doctype html><html><head><title>برنامه</title></head><body><footer>نسخه ۱٫۷٫۲</footer><p>نسخهٔ: ${version.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])}</p></body></html>`);
  return Buffer.from('<!doctype html><title>x</title>');
}

function webZip(version = '0.9.4') {
  return zipBuffer([
    { name: 'app/package.json', data: JSON.stringify({ name: 'web-app', version }) },
    { name: 'app/index.html', data: '<!doctype html><title>x</title>' },
  ]);
}

// PNG یک‌پیکسلی معتبر
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

module.exports = { axml, apk, exe, html, webZip, PNG };
