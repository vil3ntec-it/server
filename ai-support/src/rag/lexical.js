// ═══════════════════════════════════════════════════════════════════════════
//  بازیابیِ واژگانی — BM25 روی دو نما
//
//  دو ایندکسِ جدا از یک متن ساخته می‌شود:
//    • نمای کلمه   → دقت. «فیصدی» را دقیقاً پیدا می‌کند.
//    • نمای سه‌گرام → پوشش. «میانبر» و «میان بر» و «مینبر» را به هم می‌رساند.
//
//  چرا BM25 و نه شمارشِ ساده: در سندی که صد بار «برنامه» دارد، «برنامه» ارزشی
//  ندارد؛ «فیصدی» که در یک سند آمده طلاست. BM25 دقیقاً همین را حساب می‌کند
//  (IDF) و اثرِ طولِ سند را هم خنثی می‌کند تا سندِ بلند بی‌دلیل برنده نشود.
// ═══════════════════════════════════════════════════════════════════════════

import { tokenize, trigrams } from './normalize.js';

const K1 = 1.5;
const B = 0.75;

/**
 * متنِ قابلِ جست‌وجوی یک چانک. عنوان و سرتیتر و برچسب‌ها عمداً تکرار می‌شوند تا
 * وزنشان بیشتر از متنِ بدنه باشد — کاربر معمولاً کلماتِ عنوان را می‌نویسد.
 */
export function searchableText(chunk) {
  const parts = [
    chunk.title, chunk.title,
    chunk.heading, chunk.heading,
    chunk.feature,
    (chunk.tags || []).join(' '),
    (chunk.synonyms || []).join(' '), (chunk.synonyms || []).join(' '),
    chunk.text,
  ];
  return parts.filter(Boolean).join('\n');
}

function buildOne(docsTerms) {
  const df = new Map();
  const lengths = new Array(docsTerms.length);
  const tfs = new Array(docsTerms.length);

  docsTerms.forEach((terms, i) => {
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    tfs[i] = tf;
    lengths[i] = terms.length || 1;
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  });

  const avgLen = lengths.reduce((a, b) => a + b, 0) / (lengths.length || 1);
  return { df, tfs, lengths, avgLen, N: docsTerms.length };
}

/**
 * ساختِ ایندکسِ واژگانی.
 * @param {object[]} chunks
 */
export function buildLexicalIndex(chunks) {
  const texts = chunks.map(searchableText);
  return {
    word: buildOne(texts.map(t => tokenize(t))),
    tri: buildOne(texts.map(t => trigrams(t))),
    size: chunks.length,
  };
}

function bm25(idx, queryTerms, limit) {
  const scores = new Map();
  const { df, tfs, lengths, avgLen, N } = idx;
  if (!N) return [];

  // پرسشِ تکراری وزنِ دوچندان نگیرد
  const seen = new Map();
  for (const t of queryTerms) seen.set(t, (seen.get(t) || 0) + 1);

  for (const [term, qtf] of seen) {
    const n = df.get(term);
    if (!n) continue;
    // IDF نسخهٔ BM25 — با max جلوی منفی شدن برای کلماتِ خیلی پرتکرار گرفته می‌شود
    const idf = Math.max(0.05, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
    const qWeight = 1 + Math.log(qtf);

    for (let i = 0; i < N; i++) {
      const tf = tfs[i].get(term);
      if (!tf) continue;
      const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * lengths[i] / avgLen));
      scores.set(i, (scores.get(i) || 0) + idf * norm * qWeight);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([i, score]) => ({ i, score }));
}

/**
 * جست‌وجوی واژگانی. دو فهرستِ جدا برمی‌گرداند تا ادغام‌کننده (RRF) خودش
 * تصمیم بگیرد — چون نمرهٔ کلمه و نمرهٔ سه‌گرام هم‌مقیاس نیستند و جمعِ مستقیمشان
 * غلط است.
 */
export function lexicalSearch(index, query, limit = 24) {
  return {
    word: bm25(index.word, tokenize(query), limit),
    tri: bm25(index.tri, trigrams(query), limit),
  };
}
