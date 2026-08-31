// ---------------------------------------------------------------------------
//  بسته‌بندیِ ZIP — بدون هیچ کتابخانهٔ بیرونی
//
//  چرا خودمان نوشتیم: بکاپ باید روی ویندوز و لینوکس، با هر نسخهٔ Node، بدون
//  نصبِ چیزی کار کند. tar روی همهٔ ویندوزها نیست و کتابخانه‌های zip وابستگی
//  اضافه می‌آورند. این پیاده‌سازی جریانی است (فایلِ بزرگ حافظه را پر نمی‌کند)
//  و خروجی‌اش با هر برنامهٔ zip دیگری باز می‌شود.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

/* ------------------------------- CRC-32 --------------------------------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf, previous = 0) {
  let c = ~previous;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/* --------------------------- تاریخ به قالبِ DOS -------------------------- */
function dosTime(date) {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const year = Math.max(1980, d.getFullYear());
  return {
    time: ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f),
  };
}

function fromDosTime(time, date) {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = ((date >> 5) & 0x0f) - 1;
  const day = date & 0x1f;
  const hours = (time >> 11) & 0x1f;
  const minutes = (time >> 5) & 0x3f;
  const seconds = (time & 0x1f) * 2;
  return new Date(year, Math.max(0, month), Math.max(1, day), hours, minutes, seconds).getTime();
}

/* ------------------------- پیمایشِ پوشه (بازگشتی) ----------------------- */

/**
 * فهرستِ همهٔ فایل‌های زیرِ یک پوشه، با نامِ نسبی.
 * پیوندهای نمادین دنبال نمی‌شوند تا بکاپ از مرزِ پروژه بیرون نزند.
 */
export async function walk(root, { skip = () => false, followSymlinks = false } = {}) {
  const out = [];
  const base = path.resolve(root);

  async function visit(dir, rel) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = rel ? `${rel}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (skip(name, entry)) continue;
      if (entry.isSymbolicLink() && !followSymlinks) continue;
      if (entry.isDirectory()) {
        out.push({ name: `${name}/`, path: full, dir: true, size: 0, mtime: Date.now() });
        await visit(full, name);
      } else if (entry.isFile()) {
        let st;
        try {
          st = await fsp.stat(full);
        } catch {
          continue;
        }
        out.push({ name, path: full, dir: false, size: st.size, mtime: st.mtimeMs });
      }
    }
  }

  await visit(base, '');
  return out;
}

/* ------------------------------ نوشتنِ ZIP ------------------------------ */

function writeChunk(stream, buffer) {
  if (stream.destroyed || stream.errored) return Promise.reject(stream.errored || new Error('stream_closed'));
  if (stream.write(buffer)) return Promise.resolve();
  // شنوندهٔ خطا یک‌بار روی خودِ جریان نصب می‌شود، نه به ازای هر نوشتن
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      stream.off('error', onError);
      resolve();
    };
    const onError = (e) => {
      stream.off('drain', onDrain);
      reject(e);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

/** شمارندهٔ CRC و اندازه، وسطِ مسیرِ جریان */
class Counter extends Transform {
  constructor() {
    super();
    this.crc = 0;
    this.bytes = 0;
  }
  _transform(chunk, _enc, cb) {
    this.crc = crc32(chunk, this.crc);
    this.bytes += chunk.length;
    cb(null, chunk);
  }
}

class ByteCounter extends Transform {
  constructor() {
    super();
    this.bytes = 0;
  }
  _transform(chunk, _enc, cb) {
    this.bytes += chunk.length;
    cb(null, chunk);
  }
}

/**
 * یک آرشیوِ ZIP از فهرستِ داده‌شده می‌سازد.
 * @param {string} outPath مسیرِ فایلِ خروجی
 * @param {Array<{name:string, path?:string, data?:Buffer, dir?:boolean, mtime?:number}>} entries
 * @returns {{files:number, bytes:number, size:number}}
 */
export async function createZip(outPath, entries, { level = 6, onProgress = null } = {}) {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  const out = fs.createWriteStream(outPath);
  const central = [];
  let offset = 0;
  let totalRaw = 0;
  let files = 0;

  const finished = new Promise((resolve, reject) => {
    out.on('error', reject);
    out.on('close', resolve);
  });

  try {
    for (const entry of entries) {
      const isDir = Boolean(entry.dir);
      const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
      const { time, date } = dosTime(entry.mtime);
      const method = isDir ? 0 : 8; // 0 = ذخیره، 8 = deflate
      const localOffset = offset;

      // سرآیندِ محلی — با بیتِ ۳ روشن، اندازه‌ها بعد از داده نوشته می‌شوند
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // نسخهٔ لازم
      local.writeUInt16LE(isDir ? 0x0800 : 0x0808, 6); // بیت ۳ (توضیحگرِ داده) + بیت ۱۱ (UTF-8)
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(0, 14); // crc — بعداً
      local.writeUInt32LE(0, 18); // اندازهٔ فشرده — بعداً
      local.writeUInt32LE(0, 22); // اندازهٔ خام — بعداً
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      await writeChunk(out, local);
      await writeChunk(out, nameBuf);
      offset += 30 + nameBuf.length;

      let crc = 0;
      let compressed = 0;
      let raw = 0;

      if (!isDir) {
        if (entry.data) {
          const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
          crc = crc32(data);
          raw = data.length;
          const deflated = zlib.deflateRawSync(data, { level });
          compressed = deflated.length;
          await writeChunk(out, deflated);
        } else {
          // جریانِ خروجی بینِ فایل‌ها باز می‌ماند، پس به‌جای pipeline خودمان
          // تکه‌ها را می‌خوانیم و با رعایتِ فشارِ برگشتی می‌نویسیم.
          const source = fs.createReadStream(entry.path);
          const counter = new Counter();
          const deflate = zlib.createDeflateRaw({ level });
          const outCounter = new ByteCounter();
          const fail = (e) => outCounter.destroy(e);
          source.on('error', fail);
          counter.on('error', fail);
          deflate.on('error', fail);
          source.pipe(counter).pipe(deflate).pipe(outCounter);
          for await (const chunk of outCounter) await writeChunk(out, chunk);
          crc = counter.crc;
          raw = counter.bytes;
          compressed = outCounter.bytes;
        }
        offset += compressed;
        files++;
        totalRaw += raw;
      }

      // توضیحگرِ داده
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed, 8);
      descriptor.writeUInt32LE(raw, 12);
      await writeChunk(out, descriptor);
      offset += 16;

      central.push({ nameBuf, method, time, date, crc, compressed, raw, localOffset, isDir });
      onProgress?.({ files, name: entry.name });
    }

    // فهرستِ مرکزی
    const cdStart = offset;
    for (const c of central) {
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(20, 6);
      head.writeUInt16LE(c.isDir ? 0x0800 : 0x0808, 8);
      head.writeUInt16LE(c.method, 10);
      head.writeUInt16LE(c.time, 12);
      head.writeUInt16LE(c.date, 14);
      head.writeUInt32LE(c.crc, 16);
      head.writeUInt32LE(c.compressed, 20);
      head.writeUInt32LE(c.raw, 24);
      head.writeUInt16LE(c.nameBuf.length, 28);
      head.writeUInt16LE(0, 30);
      head.writeUInt16LE(0, 32);
      head.writeUInt16LE(0, 34);
      head.writeUInt16LE(0, 36);
      head.writeUInt32LE(c.isDir ? 0x10 : 0, 38); // ویژگیِ پوشه
      head.writeUInt32LE(c.localOffset, 42);
      await writeChunk(out, head);
      await writeChunk(out, c.nameBuf);
      offset += 46 + c.nameBuf.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(central.length, 8);
    eocd.writeUInt16LE(central.length, 10);
    eocd.writeUInt32LE(offset - cdStart, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    await writeChunk(out, eocd);
    offset += 22;
  } finally {
    out.end();
  }

  await finished;
  const st = await fsp.stat(outPath);
  return { files, bytes: totalRaw, size: st.size };
}

/* ------------------------------ خواندنِ ZIP ----------------------------- */

/** فهرستِ درونِ آرشیو — بدون باز کردنِ فایل‌ها (برای «پیش‌نمایشِ بازگردانی») */
export async function readZipIndex(zipPath) {
  const handle = await fsp.open(zipPath, 'r');
  try {
    const { size } = await handle.stat();
    const tailLen = Math.min(size, 66 * 1024);
    const tail = Buffer.alloc(tailLen);
    await handle.read(tail, 0, tailLen, size - tailLen);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('not_a_zip');

    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);

    const cd = Buffer.alloc(cdSize);
    await handle.read(cd, 0, cdSize, cdOffset);

    const entries = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const time = cd.readUInt16LE(p + 12);
      const date = cd.readUInt16LE(p + 14);
      const crc = cd.readUInt32LE(p + 16);
      const compressed = cd.readUInt32LE(p + 20);
      const raw = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localOffset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      entries.push({
        name,
        dir: name.endsWith('/'),
        method,
        crc,
        compressed,
        size: raw,
        mtime: fromDosTime(time, date),
        localOffset,
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { entries, count, size };
  } finally {
    await handle.close();
  }
}

/** یک ورودیِ آرشیو را می‌خواند و برمی‌گرداند (برای فایل‌های کوچک مثل مانیفست) */
export async function readZipEntry(zipPath, entryName) {
  const index = await readZipIndex(zipPath);
  const entry = index.entries.find((e) => e.name === entryName);
  if (!entry) return null;
  const handle = await fsp.open(zipPath, 'r');
  try {
    const head = Buffer.alloc(30);
    await handle.read(head, 0, 30, entry.localOffset);
    const nameLen = head.readUInt16LE(26);
    const extraLen = head.readUInt16LE(28);
    const dataStart = entry.localOffset + 30 + nameLen + extraLen;
    const data = Buffer.alloc(entry.compressed);
    await handle.read(data, 0, entry.compressed, dataStart);
    return entry.method === 0 ? data : zlib.inflateRawSync(data);
  } finally {
    await handle.close();
  }
}

/**
 * آرشیو را در یک پوشه باز می‌کند.
 * مسیرِ هر ورودی بررسی می‌شود تا هیچ فایلی بیرونِ پوشهٔ مقصد نوشته نشود
 * (حملهٔ معروفِ zip-slip).
 */
export async function extractZip(zipPath, destDir, { onEntry = null, filter = null } = {}) {
  const index = await readZipIndex(zipPath);
  const dest = path.resolve(destDir);
  await fsp.mkdir(dest, { recursive: true });
  const handle = await fsp.open(zipPath, 'r');
  let written = 0;
  let skipped = 0;

  try {
    for (const entry of index.entries) {
      if (filter && !filter(entry)) {
        skipped++;
        continue;
      }
      const target = path.resolve(dest, entry.name);
      const rel = path.relative(dest, target);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        skipped++;
        continue; // بیرونِ مقصد — رد می‌شود
      }
      if (entry.dir) {
        await fsp.mkdir(target, { recursive: true });
        continue;
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });

      const head = Buffer.alloc(30);
      await handle.read(head, 0, 30, entry.localOffset);
      const nameLen = head.readUInt16LE(26);
      const extraLen = head.readUInt16LE(28);
      const dataStart = entry.localOffset + 30 + nameLen + extraLen;

      const source = fs.createReadStream(zipPath, { start: dataStart, end: dataStart + entry.compressed - 1 });
      const counter = new Counter();
      if (entry.method === 0) {
        await pipeline(source, counter, fs.createWriteStream(target));
      } else {
        await pipeline(source, zlib.createInflateRaw(), counter, fs.createWriteStream(target));
      }
      if (entry.crc && counter.crc !== entry.crc) {
        throw new Error(`checksum_mismatch:${entry.name}`);
      }
      written++;
      onEntry?.(entry);
    }
  } finally {
    await handle.close();
  }

  return { written, skipped, total: index.entries.length };
}

/** درستیِ آرشیو را بدون باز کردن می‌سنجد (CRC هر فایل بررسی می‌شود) */
export async function verifyZip(zipPath) {
  const index = await readZipIndex(zipPath);
  const handle = await fsp.open(zipPath, 'r');
  const bad = [];
  try {
    for (const entry of index.entries) {
      if (entry.dir) continue;
      const head = Buffer.alloc(30);
      await handle.read(head, 0, 30, entry.localOffset);
      if (head.readUInt32LE(0) !== 0x04034b50) {
        bad.push({ name: entry.name, reason: 'bad_header' });
        continue;
      }
      const nameLen = head.readUInt16LE(26);
      const extraLen = head.readUInt16LE(28);
      const dataStart = entry.localOffset + 30 + nameLen + extraLen;
      const source = fs.createReadStream(zipPath, { start: dataStart, end: dataStart + entry.compressed - 1 });
      try {
        let stream = source;
        if (entry.method !== 0) {
          const inflate = zlib.createInflateRaw();
          source.on('error', (e) => inflate.destroy(e));
          stream = source.pipe(inflate);
        }
        let crc = 0;
        for await (const chunk of stream) crc = crc32(chunk, crc);
        if (crc !== entry.crc) bad.push({ name: entry.name, reason: 'checksum_mismatch' });
      } catch (e) {
        bad.push({ name: entry.name, reason: e.code || e.message });
      }
    }
  } finally {
    await handle.close();
  }
  return { ok: bad.length === 0, entries: index.entries.length, bad };
}
