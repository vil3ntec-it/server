// ═══════════════════════════════════════════════════════════════════════════
//  خواندن و چانک کردنِ Knowledge Base
//
//  چانک از روی سرتیترها بریده می‌شود، نه از روی شمارشِ کورِ نویسه. دلیلش ساده
//  است: «مرحله ۲» بدونِ «مرحله ۱» بی‌معنی است. هر چانک عنوانِ سندش و مسیرِ
//  سرتیترش را با خودش دارد تا وقتی جدا از متن پیشِ مدل می‌رود، هنوز بفهمد
//  دربارهٔ چیست.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import config, { KB_DIR } from '../config.js';
import { assertReadable } from '../security/guard.js';
import { parseFrontmatter, itemText } from './frontmatter.js';
import { LEVELS } from '../security/auth.js';

/** سندهای بدونِ سطحِ دسترسی محافظه‌کارانه USER در نظر گرفته می‌شوند، نه PUBLIC */
const DEFAULT_ACCESS = 'USER';

function splitBySections(body) {
  const out = [];
  const lines = body.split(/\r?\n/);
  let heading = '';
  let buf = [];

  const flush = () => {
    const text = buf.join('\n').trim();
    if (text) out.push({ heading, text });
    buf = [];
  };

  for (const line of lines) {
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) { flush(); heading = h[2].trim(); continue; }
    buf.push(line);
  }
  flush();
  return out;
}

/** بخشِ بلند را با هم‌پوشانی می‌شکند تا جمله وسطِ چانک نصف نشود */
function splitLong(text, maxChars, overlap) {
  if (text.length <= maxChars) return [text];
  const parts = [];
  const paras = text.split(/\n{2,}/);
  let cur = '';
  for (const p of paras) {
    if (cur && (cur.length + p.length + 2) > maxChars) {
      parts.push(cur.trim());
      cur = cur.slice(Math.max(0, cur.length - overlap)) + '\n\n' + p;
    } else {
      cur = cur ? cur + '\n\n' + p : p;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  // پاراگرافِ تکیِ خیلی بلند — این‌جا دیگر ناچاریم کور ببریم
  const out = [];
  for (const part of parts) {
    if (part.length <= maxChars * 1.5) { out.push(part); continue; }
    for (let i = 0; i < part.length; i += maxChars - overlap) out.push(part.slice(i, i + maxChars));
  }
  return out;
}

/**
 * همهٔ اسناد را می‌خواند و به چانک تبدیل می‌کند.
 * @returns {{docs: object[], chunks: object[], problems: string[]}}
 */
export function loadKnowledgeBase(dir = KB_DIR) {
  assertReadable(dir);
  const problems = [];
  const docs = [];
  const chunks = [];

  let files = [];
  try {
    files = fs.readdirSync(dir).filter(f => /\.md$/i.test(f)).sort();
  } catch (e) {
    problems.push(`پوشهٔ دانش خوانده نشد: ${e.message}`);
    return { docs, chunks, problems };
  }

  for (const file of files) {
    const full = assertReadable(path.join(dir, file));
    let raw = '';
    try { raw = fs.readFileSync(full, 'utf8'); }
    catch (e) { problems.push(`${file}: خوانده نشد (${e.message})`); continue; }

    const { meta, body } = parseFrontmatter(raw);

    const id = meta.id || file.replace(/\.md$/i, '');
    if (!meta.title) problems.push(`${file}: فیلدِ title ندارد`);
    if (!meta.version) problems.push(`${file}: فیلدِ version ندارد — نسخه‌دار نبودنِ سند یعنی نمی‌شود فهمید کهنه است یا نه`);

    const access = String(meta.access || DEFAULT_ACCESS).toUpperCase();
    if (!LEVELS.includes(access)) {
      problems.push(`${file}: سطحِ دسترسیِ ناشناخته «${access}» — به INTERNAL تبدیل شد تا نشت نکند`);
    }

    const doc = {
      id,
      file,
      title: meta.title || id,
      feature: meta.feature || '',
      version: String(meta.version || ''),
      minVersion: String(meta.minVersion || ''),
      access: LEVELS.includes(access) ? access : 'INTERNAL',
      updated: String(meta.updated || ''),
      kind: meta.kind || 'doc',
      tags: (meta.tags || []).map(itemText).filter(Boolean),
      synonyms: (meta.synonyms || []).map(itemText).filter(Boolean),
      links: (meta.links || []).filter(l => l && typeof l === 'object' && l.url),
      shortcuts: (meta.shortcuts || []).map(s => (typeof s === 'object' ? { keys: s.text, does: s.value } : { keys: String(s), does: '' })),
      permissions: (meta.permissions || []).map(itemText).filter(Boolean),
      qr: meta.qr || '',
    };
    docs.push(doc);

    const sections = splitBySections(body);
    let n = 0;
    for (const sec of sections) {
      for (const piece of splitLong(sec.text, config.rag.chunkChars, config.rag.chunkOverlap)) {
        chunks.push({
          id: `${doc.id}#${n}`,
          docId: doc.id,
          title: doc.title,
          heading: sec.heading,
          feature: doc.feature,
          access: doc.access,
          version: doc.version,
          updated: doc.updated,
          kind: doc.kind,
          tags: doc.tags,
          // مترادف‌ها فقط روی چانکِ اولِ هر سند می‌نشینند؛ اگر روی همه بنشینند،
          // یک سندِ بلند فقط به‌خاطرِ تکرارِ مترادف‌هایش بقیه را کنار می‌زند
          synonyms: n === 0 ? doc.synonyms : [],
          text: piece,
        });
        n++;
      }
    }

    if (!sections.length) problems.push(`${file}: بدنهٔ سند خالی است`);
  }

  return { docs, chunks, problems };
}
