// ---------------------------------------------------------------------------
//  ساختنِ آیکونِ برنامه (.ico) — بدونِ هیچ کتابخانه‌ای
//
//      node tools/make-icon.mjs
//
//  چرا خودمان: میان‌برِ روی دسکتاپ بدونِ آیکون، همان آیکونِ بی‌ریختِ ویندوز را
//  می‌گیرد و کاربر بینِ ده‌ها فایل پیدایش نمی‌کند.
//
//  هر اندازه را چهار برابر می‌کشیم و بعد کوچک می‌کنیم تا لبه‌ها نرم شود.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SCALE = 4;

const BRAND_TOP = [96, 140, 255];
const BRAND_BOTTOM = [43, 87, 214];
const WHITE = [255, 255, 255];

/** آیا این نقطه داخلِ مستطیلِ گردگوشه است؟ */
function inRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** یک تصویرِ RGBA در اندازهٔ بزرگ می‌کشد */
function draw(size) {
  const big = size * SCALE;
  const pixels = new Float64Array(big * big * 4);

  const pad = big * 0.06;
  const radius = big * 0.22;

  // بدنهٔ آبیِ گردگوشه
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      if (!inRoundedRect(x, y, pad, pad, big - pad, big - pad, radius)) continue;
      const t = y / big;
      const i = (y * big + x) * 4;
      pixels[i] = BRAND_TOP[0] + (BRAND_BOTTOM[0] - BRAND_TOP[0]) * t;
      pixels[i + 1] = BRAND_TOP[1] + (BRAND_BOTTOM[1] - BRAND_TOP[1]) * t;
      pixels[i + 2] = BRAND_TOP[2] + (BRAND_BOTTOM[2] - BRAND_TOP[2]) * t;
      pixels[i + 3] = 255;
    }
  }

  // دو طبقهٔ سفیدِ سرور، هر کدام با یک چراغ
  const barLeft = big * 0.24;
  const barRight = big * 0.76;
  const barHeight = big * 0.17;
  const barRadius = barHeight * 0.32;
  const tops = [big * 0.28, big * 0.55];

  for (const top of tops) {
    const bottom = top + barHeight;
    for (let y = Math.floor(top); y <= Math.ceil(bottom); y++) {
      for (let x = Math.floor(barLeft); x <= Math.ceil(barRight); x++) {
        if (!inRoundedRect(x, y, barLeft, top, barRight, bottom, barRadius)) continue;
        const i = (y * big + x) * 4;
        pixels[i] = WHITE[0];
        pixels[i + 1] = WHITE[1];
        pixels[i + 2] = WHITE[2];
        pixels[i + 3] = 255;
      }
    }
    // چراغِ آبی روی هر طبقه
    const lightX = barRight - barHeight * 0.55;
    const lightY = top + barHeight / 2;
    const lightR = barHeight * 0.19;
    for (let y = Math.floor(lightY - lightR - 1); y <= Math.ceil(lightY + lightR + 1); y++) {
      for (let x = Math.floor(lightX - lightR - 1); x <= Math.ceil(lightX + lightR + 1); x++) {
        const dx = x - lightX;
        const dy = y - lightY;
        if (dx * dx + dy * dy > lightR * lightR) continue;
        const i = (y * big + x) * 4;
        pixels[i] = 76;
        pixels[i + 1] = 125;
        pixels[i + 2] = 255;
        pixels[i + 3] = 255;
      }
    }
  }

  // کوچک کردن با میانگین‌گیری → لبه‌های نرم
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SCALE; sy++) {
        for (let sx = 0; sx < SCALE; sx++) {
          const i = ((y * SCALE + sy) * big + (x * SCALE + sx)) * 4;
          const alpha = pixels[i + 3];
          r += pixels[i] * alpha;
          g += pixels[i + 1] * alpha;
          b += pixels[i + 2] * alpha;
          a += alpha;
        }
      }
      const n = SCALE * SCALE;
      const o = (y * size + x) * 4;
      // BGRA — ترتیبی که ویندوز می‌خواهد
      out[o] = a > 0 ? Math.round(b / a) : 0;
      out[o + 1] = a > 0 ? Math.round(g / a) : 0;
      out[o + 2] = a > 0 ? Math.round(r / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** یک تصویر را به شکلِ BMP داخلِ ico در می‌آورد */
function toBmp(size, bgra) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // دو برابر: تصویر + ماسک
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);

  // BMP از پایین به بالا نوشته می‌شود
  const flipped = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    bgra.copy(flipped, y * size * 4, (size - 1 - y) * size * 4, (size - y) * size * 4);
  }

  const maskRow = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskRow * size); // همه صفر = همه‌جا دیده شود (آلفا کار را می‌کند)

  return Buffer.concat([header, flipped, mask]);
}

const images = SIZES.map((size) => ({ size, data: toBmp(size, draw(size)) }));

const dir = Buffer.alloc(6 + images.length * 16);
dir.writeUInt16LE(0, 0);
dir.writeUInt16LE(1, 2); // نوع: آیکون
dir.writeUInt16LE(images.length, 4);

let offset = dir.length;
images.forEach((image, index) => {
  const at = 6 + index * 16;
  dir.writeUInt8(image.size >= 256 ? 0 : image.size, at);
  dir.writeUInt8(image.size >= 256 ? 0 : image.size, at + 1);
  dir.writeUInt8(0, at + 2);
  dir.writeUInt8(0, at + 3);
  dir.writeUInt16LE(1, at + 4);
  dir.writeUInt16LE(32, at + 6);
  dir.writeUInt32LE(image.data.length, at + 8);
  dir.writeUInt32LE(offset, at + 12);
  offset += image.data.length;
});

const outPath = path.join(import.meta.dirname, '..', 'homelab-panel', 'desktop', 'server.ico');
fs.writeFileSync(outPath, Buffer.concat([dir, ...images.map((i) => i.data)]));
console.log(`آیکون ساخته شد: ${outPath}`);
console.log(`اندازه‌ها: ${SIZES.join(', ')} — حجم: ${(fs.statSync(outPath).size / 1024).toFixed(1)} کیلوبایت`);
