// ═══════════════════════════════════════════════════════════════════════════
//  انبارِ ایندکس — ساخت، ذخیره، خواندن
//
//  دو فایلِ جدا، عمداً:
//    • kb-index.json   → چانک‌ها و متادیتا. سبک. **به مرورگر هم داده می‌شود**
//                        (فیلترشده بر اساسِ سطحِ دسترسی) تا ویجت آفلاین کار کند.
//    • kb-vectors.json → بردارها. سنگین. فقط سرور می‌خواندش و هرگز بیرون نمی‌رود.
//
//  اگر بردارها نباشند سرویس کار می‌کند؛ اگر ایندکس نباشد، همان لحظه از روی
//  فایل‌های md ساخته می‌شود. یعنی «فراموش کردنِ build» به خرابی ختم نمی‌شود.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import config, { DATA_DIR } from '../config.js';
import { assertWritable, assertReadable } from '../security/guard.js';
import { loadKnowledgeBase } from '../kb/loader.js';
import { searchableText } from './lexical.js';
import { embed, embeddingsAvailable } from './vector.js';
import { canAccess } from '../security/auth.js';

const INDEX_FILE = path.join(DATA_DIR, 'kb-index.json');
const VECTOR_FILE = path.join(DATA_DIR, 'kb-vectors.json');
export const INDEX_FORMAT = 2;

/**
 * ساختِ ایندکس از روی فایل‌های md.
 * @param {{withVectors?: boolean, log?: Function}} opts
 */
export async function buildIndex({ withVectors = true, log = console.log } = {}) {
  const { docs, chunks, problems } = loadKnowledgeBase();

  for (const p of problems) log('   ⚠️  ' + p);
  log(`   📚 ${docs.length} سند → ${chunks.length} چانک`);

  const index = {
    format: INDEX_FORMAT,
    builtAt: new Date().toISOString(),
    docs: docs.map(d => ({
      id: d.id, title: d.title, feature: d.feature, version: d.version,
      access: d.access, updated: d.updated, kind: d.kind,
      links: d.links, shortcuts: d.shortcuts, permissions: d.permissions,
      qr: d.qr, tags: d.tags, synonyms: d.synonyms,
    })),
    chunks,
  };

  assertWritable(INDEX_FILE);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index));
  log(`   💾 ${path.basename(INDEX_FILE)} — ${(fs.statSync(INDEX_FILE).size / 1024).toFixed(0)} کیلوبایت`);

  if (!withVectors) return { index, vectors: null };

  if (!(await embeddingsAvailable())) {
    log('   ℹ️  مدلِ امبدینگ در دسترس نیست — ایندکس بدونِ بردار ساخته شد.');
    log('      جست‌وجو با کلمه و سه‌گرام و مترادف‌ها کار می‌کند؛ برای معنای کامل‌تر:');
    log(`      ollama pull ${config.llm.embedModel}`);
    return { index, vectors: null };
  }

  log('   🧠 ساختنِ بردارها…');
  const ids = [];
  const vectors = [];
  let done = 0;
  for (const c of chunks) {
    const v = await embed(searchableText(c));
    if (v) { ids.push(c.id); vectors.push(v); }
    if (++done % 20 === 0) log(`      ${done}/${chunks.length}`);
  }

  const store = { model: config.llm.embedModel, dim: vectors[0]?.length || 0, ids, vectors };
  assertWritable(VECTOR_FILE);
  fs.writeFileSync(VECTOR_FILE, JSON.stringify(store));
  log(`   💾 ${path.basename(VECTOR_FILE)} — ${vectors.length} بردارِ ${store.dim} بُعدی`);

  return { index, vectors: store };
}

/**
 * خواندنِ ایندکس. اگر نبود یا کهنه بود، همان لحظه از روی md می‌سازد (بدونِ بردار).
 */
export function loadIndex({ log = console.log } = {}) {
  let index = null;
  try {
    assertReadable(INDEX_FILE);
    if (fs.existsSync(INDEX_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      if (parsed?.format === INDEX_FORMAT && Array.isArray(parsed.chunks)) index = parsed;
      else log('   ⚠️  قالبِ ایندکس قدیمی است — از نو ساخته می‌شود');
    }
  } catch (e) {
    log('   ⚠️  ایندکس خوانده نشد: ' + e.message);
  }

  if (!index) {
    const { docs, chunks, problems } = loadKnowledgeBase();
    for (const p of problems) log('   ⚠️  ' + p);
    index = { format: INDEX_FORMAT, builtAt: new Date().toISOString(), docs, chunks, ephemeral: true };
    log(`   📚 ایندکسِ موقت در حافظه: ${chunks.length} چانک (برای بردارها: npm run build-index)`);
  }

  let vectors = null;
  try {
    assertReadable(VECTOR_FILE);
    if (fs.existsSync(VECTOR_FILE)) {
      const v = JSON.parse(fs.readFileSync(VECTOR_FILE, 'utf8'));
      // بردارهایی که با مدلِ دیگری ساخته شده‌اند بی‌معنی‌اند — قاطی کردنشان یعنی
      // نتیجهٔ تصادفی، که از «نداشتنِ بردار» بدتر است
      if (v?.model !== config.llm.embedModel) {
        log(`   ⚠️  بردارها با مدلِ «${v?.model}» ساخته شده‌اند ولی تنظیمِ فعلی «${config.llm.embedModel}» است — نادیده گرفته شدند`);
      } else if (Array.isArray(v.vectors) && v.vectors.length) {
        vectors = v;
      }
    }
  } catch (e) {
    log('   ⚠️  بردارها خوانده نشدند: ' + e.message);
  }

  return { index, vectors };
}

/**
 * نسخهٔ سبکِ ایندکس برای فرستادن به مرورگر.
 * فیلترِ سطحِ دسترسی این‌جا اعمال می‌شود — مرورگر هرگز چیزی را که اجازه‌اش را
 * ندارد **دریافت** هم نمی‌کند، نه اینکه بگیرد و نشان ندهد.
 */
export function clientIndex(index, level) {
  const chunks = index.chunks
    .filter(c => canAccess(level, c.access))
    .map(c => ({
      id: c.id, docId: c.docId, title: c.title, heading: c.heading,
      feature: c.feature, version: c.version, tags: c.tags,
      synonyms: c.synonyms, text: c.text,
    }));
  const allowedDocs = new Set(chunks.map(c => c.docId));
  return {
    format: INDEX_FORMAT,
    builtAt: index.builtAt,
    level,
    docs: (index.docs || []).filter(d => allowedDocs.has(d.id)),
    chunks,
  };
}

export const paths = { INDEX_FILE, VECTOR_FILE };
