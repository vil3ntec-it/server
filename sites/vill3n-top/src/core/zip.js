'use strict';
// نویسندهٔ کوچک ZIP (برای خروجی ایستا و آزمون‌ها). فایل‌های بزرگ بدون فشرده‌سازی و به‌صورت جریانی نوشته می‌شوند.
const fs = require('fs');
const zlib = require('zlib');

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

// جریانی و ناهمگام: هنگام ساختن پشتیبانِ فایل‌های بزرگ، سایت برای بازدیدکننده‌ها نمی‌ایستد
function fileCrc(file) {
  return new Promise((resolve, reject) => {
    let crc = 0;
    fs.createReadStream(file, { highWaterMark: 1024 * 1024 }).on('data', (c) => { crc = crc32(c, crc); }).on('end', () => resolve(crc)).on('error', reject);
  });
}

function dosTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function localHeader(name, method, crc, comp, uncomp, t) {
  const nb = Buffer.from(name, 'utf8');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
  h.writeUInt16LE(t.time, 10); h.writeUInt16LE(t.date, 12); h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(comp, 18); h.writeUInt32LE(uncomp, 22); h.writeUInt16LE(nb.length, 26); h.writeUInt16LE(0, 28);
  return Buffer.concat([h, nb]);
}

function centralHeader(name, method, crc, comp, uncomp, off, t) {
  const nb = Buffer.from(name, 'utf8');
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(20, 6); h.writeUInt16LE(0x0800, 8); h.writeUInt16LE(method, 10);
  h.writeUInt16LE(t.time, 12); h.writeUInt16LE(t.date, 14); h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(comp, 20); h.writeUInt32LE(uncomp, 24); h.writeUInt16LE(nb.length, 28);
  h.writeUInt32LE(off, 42);
  return Buffer.concat([h, nb]);
}

function endRecord(count, cdSize, cdOff) {
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(count, 8); e.writeUInt16LE(count, 10);
  e.writeUInt32LE(cdSize, 12); e.writeUInt32LE(cdOff, 16);
  return e;
}

// entries: [{ name, data: Buffer, store? } | { name, file: '/path' }]
// خروجی به یک جریان نوشتنی (پاسخ HTTP یا فایل). حد ZIP معمولی: ۴ گیگابایت.
async function writeZip(out, entries) {
  const t = dosTime();
  const central = [];
  let off = 0;
  const write = (buf) => new Promise((resolve, reject) => {
    if (out.destroyed || out.writableEnded) return reject(new Error('دریافت‌کننده قطع کرد'));
    off += buf.length;
    if (out.write(buf)) resolve(); else { out.once('drain', resolve); out.once('error', reject); out.once('close', () => reject(new Error('دریافت‌کننده قطع کرد'))); }
  });
  for (const e of entries) {
    const start = off;
    if (e.file) {
      const size = fs.statSync(e.file).size;
      if (start + size > 0xfff00000) throw new Error('خروجی از ۴ گیگابایت بزرگ‌تر است');
      const crc = await fileCrc(e.file);
      await write(localHeader(e.name, 0, crc, size, size, t));
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(e.file);
        // اگر گیرنده وسط کار قطع کند، فایل بسته می‌شود و کار تمام می‌شود
        const gone = () => { rs.destroy(); reject(new Error('دریافت‌کننده قطع کرد')); };
        if (out.on) out.once('close', gone);
        const done = (fn, arg) => { if (out.removeListener) out.removeListener('close', gone); fn(arg); };
        rs.on('data', (c) => { off += c.length; if (!out.write(c)) { rs.pause(); out.once('drain', () => rs.resume()); } });
        rs.on('end', () => done(resolve)); rs.on('error', (err) => done(reject, err));
      });
      central.push(centralHeader(e.name, 0, crc, size, size, start, t));
    } else {
      const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
      const crc = crc32(data);
      const comp = e.store ? data : zlib.deflateRawSync(data, { level: 9 });
      const method = e.store ? 0 : 8;
      await write(localHeader(e.name, method, crc, comp.length, data.length, t));
      await write(comp);
      central.push(centralHeader(e.name, method, crc, comp.length, data.length, start, t));
    }
  }
  const cdOff = off;
  const cd = Buffer.concat(central);
  await write(cd);
  await write(endRecord(central.length, cd.length, cdOff));
}

function zipBuffer(entries) {
  const chunks = [];
  const sink = { write(b) { chunks.push(b); return true; }, once() {}, on() {}, removeListener() {} };
  return writeZip(sink, entries).then(() => Buffer.concat(chunks));
}

module.exports = { crc32, writeZip, zipBuffer };
