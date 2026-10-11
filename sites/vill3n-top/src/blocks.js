'use strict';
// نمایش «بخش‌های صفحه» که مالک در پنل می‌سازد: متن، کادرها، جدول، آمار، مرحله‌ها، تصویر، نقل‌قول، دعوت به اقدام و پرسش‌وپاسخ.
// همه‌چیز از پیش در پنل پاک‌سازی شده است؛ این‌جا هم هر متن هنگام نوشتن در HTML بی‌خطر می‌شود.
const { esc, faDigits } = require('./core/util');
const { icon, PICK } = require('./icons');

const YES = /^(✓|✔|✅|☑)$/;
const NO = /^(✗|✘|×|❌|✕)$/;

// متن ساده → بندها و فهرست‌ها («- » اول خط یعنی یک مورد فهرست؛ خط خالی یعنی بند تازه)
function rich(text) {
  return String(text || '').split(/\n{2,}/).map((part) => {
    const lines = part.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return '';
    const out = [];
    let para = [], items = [];
    const flush = () => {
      if (para.length) { out.push(`<p>${para.map(esc).join('<br>')}</p>`); para = []; }
      if (items.length) { out.push(`<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`); items = []; }
    };
    for (const l of lines) {
      if (/^[-•]\s+/.test(l)) { if (para.length) flush(); items.push(l.replace(/^[-•]\s+/, '')); }
      else { if (items.length) flush(); para.push(l); }
    }
    flush();
    return out.join('');
  }).join('');
}

function head(b, cls = '') {
  if (!b.title && !b.intro) return '';
  return `<header class="sec-head${cls}">${b.title ? `<h2>${esc(b.title)}</h2>` : ''}${b.intro ? `<p>${esc(b.intro)}</p>` : ''}</header>`;
}

function cell(v) {
  const t = String(v || '').trim();
  if (YES.test(t)) return `<span class="yes">${icon('check')}<span class="sr">دارد</span></span>`;
  if (NO.test(t)) return `<span class="no">${icon('close')}<span class="sr">ندارد</span></span>`;
  return esc(t);
}

const ctx = { art: null }; // نگارهٔ کاشی‌های پهن را views می‌دهد (تا این دو فایل به هم وابستهٔ دوطرفه نشوند)
const R = {
  text: (b) => `${head(b, b.align === 'center' ? ' is-center' : '')}${b.body ? `<div class="prose${b.align === 'center' ? ' is-center' : ''}">${rich(b.body)}</div>` : ''}`,

  cards: (b) => {
    const items = (b.items || []).filter((i) => i && i.title);
    if (!items.length) return '';
    return `${head(b)}<ul class="tiles ${b.layout === 'grid' ? 'is-grid' : 'is-bento'}" data-n="${items.length}">${items.map((it, i) => `<li class="tile spot" style="--i:${i}">${it.icon && PICK[it.icon] ? `<span class="tile-ic">${icon(it.icon)}</span>` : ''}<h3>${esc(it.title)}</h3>${it.text ? `<p>${esc(it.text)}</p>` : ''}${it.icon && PICK[it.icon] ? `<span class="tile-wm" aria-hidden="true">${icon(it.icon)}</span>` : ''}${ctx.art ? ctx.art(i) : ''}</li>`).join('')}</ul>`;
  },

  table: (b) => {
    const cols = (b.head || []).length;
    const body = (b.rows || []).filter((r) => Array.isArray(r));
    if (!cols && !body.length) return '';
    const hasHead = (b.head || []).some((h) => String(h || '').trim());
    return `${head(b)}<div class="tbl-wrap" tabindex="0" role="region" aria-label="${esc(b.title || 'جدول')}"><table class="tbl${b.firstCol ? ' has-rowhead' : ''}">
${hasHead ? `<thead><tr>${b.head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>` : ''}
<tbody>${body.map((r) => `<tr>${r.map((c, i) => (b.firstCol && i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${cell(c)}</td>`)).join('')}</tr>`).join('')}</tbody>
</table></div>${b.note ? `<p class="tbl-note">${esc(b.note)}</p>` : ''}<p class="tbl-hint">برای دیدن ستون‌های دیگر، جدول را به پهلو بکشید.</p>`;
  },

  stats: (b) => {
    const items = (b.items || []).filter((i) => i && i.value && i.label);
    if (!items.length) return '';
    return `${head(b)}<ul class="stats" data-n="${items.length}">${items.map((it, i) => `<li style="--i:${i}"><b data-count>${esc(faDigits(it.value))}</b><span>${esc(it.label)}</span></li>`).join('')}</ul>`;
  },

  steps: (b) => {
    const items = (b.items || []).filter((i) => i && i.title);
    if (!items.length) return '';
    return `${head(b)}<ol class="steps" data-n="${items.length}">${items.map((it, i) => `<li style="--i:${i}"><span class="step-n" aria-hidden="true">${faDigits(i + 1)}</span><h3>${esc(it.title)}</h3>${it.text ? `<p>${esc(it.text)}</p>` : ''}</li>`).join('')}</ol>`;
  },

  image: (b) => {
    const im = b.image && b.image.file ? b.image : null;
    const copy = `${b.title ? `<h2>${esc(b.title)}</h2>` : ''}${b.intro ? `<p class="media-intro">${esc(b.intro)}</p>` : ''}${b.text ? `<div class="prose">${rich(b.text)}</div>` : ''}`;
    if (!im && !copy) return '';
    const fig = im ? `<figure class="media-img"><img src="/media/${esc(im.file)}" alt="${esc(b.alt || b.title || '')}"${Number(im.w) > 0 && Number(im.h) > 0 ? ` width="${Number(im.w)}" height="${Number(im.h)}"` : ''} loading="lazy" decoding="async"></figure>` : '';
    const side = ['start', 'end', 'full'].includes(b.side) ? b.side : 'start';
    return `<div class="media is-${im ? side : 'full'}${copy ? '' : ' is-bare'}">${fig}${copy ? `<div class="media-copy">${copy}</div>` : ''}</div>`;
  },

  // ویدیو تا وقتی کسی پخش را نزند دانلود نمی‌شود (preload=none)؛ بدون فایلِ ویدیو، بخش دیده نمی‌شود
  video: (b) => {
    const v = b.video && b.video.file ? b.video : null;
    if (!v) return '';
    const p = b.poster && b.poster.file ? b.poster : null;
    const size = p && Number(p.w) > 0 && Number(p.h) > 0 ? ` width="${Number(p.w)}" height="${Number(p.h)}"` : '';
    const mime = /\.webm$/.test(v.file) ? 'video/webm' : 'video/mp4';
    return `${head(b)}<figure class="vid"><div class="vid-frame"><video controls preload="none" playsinline${p ? ` poster="/media/${esc(p.file)}"` : ''}${size}${b.title ? ` aria-label="${esc(b.title)}"` : ''}><source src="/media/${esc(v.file)}" type="${mime}"></video></div>${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ''}</figure>`;
  },

  reviews: (b) => {
    const items = (b.items || []).filter((i) => i && i.text);
    if (!items.length) return '';
    return `${head(b)}<ul class="reviews" data-n="${items.length}">${items.map((it, i) => `<li class="review spot ring" style="--i:${i}"><blockquote>${rich(it.text)}</blockquote>${it.by ? `<footer><span class="review-av" aria-hidden="true">${esc(Array.from(String(it.by).trim())[0] || '')}</span><b>${esc(it.by)}</b>${it.role ? `<span>${esc(it.role)}</span>` : ''}</footer>` : ''}</li>`).join('')}</ul>`;
  },

  quote: (b) => (b.text ? `${head(b)}<figure class="pull"><blockquote>${rich(b.text)}</blockquote>${b.by ? `<figcaption><b>${esc(b.by)}</b>${b.role ? `<span>${esc(b.role)}</span>` : ''}</figcaption>` : ''}</figure>` : ''),

  cta: (b) => {
    if (!b.title && !b.text && !b.label) return '';
    const ext = /^(https?:)?[\/\\]{2}/i.test(b.href || '');
    return `<div class="cta-panel spot ring">${b.title ? `<h2>${esc(b.title)}</h2>` : ''}${b.text ? `<p>${esc(b.text)}</p>` : ''}${b.label && b.href ? `<a class="btn btn-main btn-xl" href="${esc(b.href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(b.label)}</a>` : ''}</div>`;
  },

  faq: (b) => {
    const items = (b.items || []).filter((i) => i && i.q && i.a);
    if (!items.length) return '';
    return `${head(b)}${faqList(items)}`;
  },
};

function faqList(items) {
  return `<div class="faq">${items.map((f) => `<details><summary><span>${esc(f.q)}</span>${icon('plus')}</summary><div class="faq-a">${rich(f.a)}</div></details>`).join('')}</div>`;
}

function renderBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((b) => {
    if (!b || !Object.prototype.hasOwnProperty.call(R, b.type)) return '';
    const inner = R[b.type](b);
    return inner ? `<section class="blk blk-${b.type}" id="b-${esc(b.id)}">${inner}</section>` : '';
  }).join('\n');
}

// پرسش‌وپاسخ‌های داخل بخش‌ها — برای دادهٔ ساختاریافتهٔ جست‌وجو
function faqFromBlocks(blocks) {
  const out = [];
  for (const b of Array.isArray(blocks) ? blocks : []) if (b && b.type === 'faq') for (const i of b.items || []) if (i && i.q && i.a) out.push({ q: i.q, a: i.a });
  return out;
}

module.exports = { renderBlocks, faqFromBlocks, faqList, rich, ctx };
