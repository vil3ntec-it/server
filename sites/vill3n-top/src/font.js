'use strict';
// فونت وزیرمتن (متن‌باز، مجوز OFL). اگر فایل فونت کنار سایت نباشد، یک بار از اینترنت گرفته می‌شود.
// تا آن زمان سایت با فونت خودِ دستگاه بازدیدکننده نمایش داده می‌شود و هیچ‌چیز خراب نمی‌شود.
const fs = require('fs');
const path = require('path');

const SOURCES = [
  'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2',
  'https://cdn.jsdelivr.net/npm/vazirmatn@33.0.3/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2',
  'https://unpkg.com/vazirmatn@33.0.3/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2',
  'https://raw.githubusercontent.com/rastikerdar/vazirmatn/v33.003/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2',
  'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn/fonts/webfonts/Vazirmatn%5Bwght%5D.woff2',
];

function fontKind(buf) {
  if (!buf || buf.length < 20000) return '';
  const tag = buf.toString('latin1', 0, 4);
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'OTTO' || buf.readUInt32BE(0) === 0x00010000) return 'ttf';
  return '';
}

function fontFile(assets) {
  for (const name of ['fonts/Vazirmatn.woff2', 'fonts/Vazirmatn.ttf']) if (assets.get(name)) return name;
  return '';
}

function saveFont(assets, buf) {
  const kind = fontKind(buf);
  if (!kind) throw new Error('این فایل فونت معتبر نیست (فقط woff2 یا ttf)');
  const dir = path.join(assets.dir, 'fonts');
  fs.mkdirSync(dir, { recursive: true });
  for (const old of ['Vazirmatn.woff2', 'Vazirmatn.ttf']) { try { fs.unlinkSync(path.join(dir, old)); } catch (_) { /* نبود */ } }
  fs.writeFileSync(path.join(dir, `Vazirmatn.${kind}`), buf);
  return kind;
}

let running = null;
let warned = false;
async function fetchFont(assets) {
  if (running) return running;
  running = (async () => {
    for (const url of SOURCES) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 20000);
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (fontKind(buf) !== 'woff2' || buf.length > 3 * 1024 * 1024) continue;
        saveFont(assets, buf);
        return { ok: true, source: new URL(url).host, size: buf.length };
      } catch (_) { /* منبع بعدی */ } finally { clearTimeout(timer); }
    }
    return { ok: false };
  })();
  try { return await running; } finally { running = null; }
}

function ensureFont(assets, { background = false } = {}) {
  if (fontFile(assets)) return Promise.resolve({ ok: true, cached: true });
  const p = fetchFont(assets).then((r) => {
    if (r.ok) console.log(`[فونت] وزیرمتن از ${r.source} گرفته شد.`);
    else if (!warned) { warned = true; console.log('[فونت] وزیرمتن هنوز گرفته نشده (اینترنت در دسترس نبود). دوباره تلاش می‌شود؛ یا از «تنظیمات ← فونت» فایل را بگذارید.'); }
    return r;
  });
  if (background) p.catch(() => {});
  return p;
}

module.exports = { ensureFont, fetchFont, saveFont, fontFile, fontKind };
