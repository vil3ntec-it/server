// ═══════════════════════════════════════════════════════════════════════════
//  بازیابِ هیبرید — قلبِ RAG
//
//  سه بازیاب کار می‌کنند و نتیجه‌شان با RRF ادغام می‌شود.
//
//  چرا RRF و نه جمعِ وزن‌دارِ نمره‌ها: نمرهٔ BM25 عددی بی‌کران است و نمرهٔ
//  کسینوسی بینِ ۰ و ۱. جمعشان یعنی هر بار که یک بازیاب نمرهٔ بزرگ بدهد، بقیه
//  بی‌اثر می‌شوند. RRF فقط به **رتبه** نگاه می‌کند، پس مقیاس اهمیتی ندارد و
//  هیچ ضریبِ جادوییِ دستی لازم نیست.
//
//      RRF(d) = Σ  وزنِ بازیاب / (k + رتبهٔ d در آن بازیاب)
// ═══════════════════════════════════════════════════════════════════════════

import config from '../config.js';
import { buildLexicalIndex, lexicalSearch } from './lexical.js';
import { embed, vectorSearch } from './vector.js';
import { canAccess } from '../security/auth.js';

const RRF_K = 60;

const WEIGHTS = {
  word: 1.0,    // دقیق‌ترین سیگنال
  tri: 0.6,     // تورِ نجات — نباید بر دقت غلبه کند
  vec: 0.9,     // معنا
};

export class Retriever {
  /**
   * @param {object[]} chunks
   * @param {{ids: string[], vectors: number[][], model?: string}|null} vectorStore
   */
  constructor(chunks, vectorStore = null) {
    this.chunks = chunks;
    this.byId = new Map(chunks.map((c, i) => [c.id, i]));
    this.lexical = buildLexicalIndex(chunks);
    this.vectors = vectorStore;
    this.hasVectors = !!(vectorStore?.vectors?.length);
  }

  /**
   * @param {string} query
   * @param {{level?: string, topK?: number, expansions?: string[], signal?: AbortSignal}} opts
   * @returns {Promise<{results: object[], usedVectors: boolean}>}
   */
  async search(query, { level = 'PUBLIC', topK = config.rag.topK, expansions = [], signal } = {}) {
    const q = String(query || '').trim();
    if (!q) return { results: [], usedVectors: false };

    const limit = config.rag.candidateK;
    const ranks = [];   // [{weight, order: [chunkIndex,…]}]

    // ── ۱و۲) واژگانی: پرسشِ اصلی + بسط‌هایی که مدل پیشنهاد داده ─────────────
    const queries = [q, ...expansions.filter(Boolean).slice(0, 3)];
    for (let qi = 0; qi < queries.length; qi++) {
      // بسط‌ها نباید هم‌وزنِ خودِ پرسش باشند — پرسشِ کاربر همیشه حقیقتِ اصلی است
      const decay = qi === 0 ? 1 : 0.5;
      const { word, tri } = lexicalSearch(this.lexical, queries[qi], limit);
      ranks.push({ weight: WEIGHTS.word * decay, order: word.map(r => r.i) });
      ranks.push({ weight: WEIGHTS.tri * decay, order: tri.map(r => r.i) });
    }

    // ── ۳) برداری ─────────────────────────────────────────────────────────
    let usedVectors = false;
    if (this.hasVectors) {
      const qv = await embed(q, { signal });
      if (qv && qv.length === (this.vectors.vectors[0]?.length || 0)) {
        usedVectors = true;
        const hits = vectorSearch(this.vectors, qv, limit);
        ranks.push({
          weight: WEIGHTS.vec,
          order: hits.map(h => this.byId.get(h.id)).filter(i => i !== undefined),
        });
      }
    }

    // ── ادغامِ RRF ─────────────────────────────────────────────────────────
    const fused = new Map();
    for (const { weight, order } of ranks) {
      order.forEach((idx, rank) => {
        fused.set(idx, (fused.get(idx) || 0) + weight / (RRF_K + rank + 1));
      });
    }

    const ranked = [...fused.entries()].sort((a, b) => b[1] - a[1]);

    // ── فیلترِ سطحِ دسترسی ─────────────────────────────────────────────────
    // این‌جا فیلتر می‌شود، نه در نمایش. سندی که کاربر اجازه‌اش را ندارد اصلاً
    // نباید واردِ prompt شود — وگرنه مدل می‌تواند محتوایش را لو بدهد.
    const results = [];
    let bestScore = 0;
    for (const [idx, score] of ranked) {
      const chunk = this.chunks[idx];
      if (!chunk || !canAccess(level, chunk.access)) continue;
      if (!bestScore) bestScore = score;
      // نمرهٔ نسبی: چانکی که کمتر از ۲۵٪ بهترین نتیجه است، نویز است
      if (score < bestScore * 0.25) break;
      results.push({ ...chunk, score, relScore: score / bestScore });
      if (results.length >= topK) break;
    }

    return { results, usedVectors };
  }

  /**
   * آیا بازیابی آن‌قدر یکدست است که پاسخِ استخراجی (بدونِ مدل) قابلِ اتکا باشد؟
   *
   * معیار عمداً «فاصلهٔ نمره‌ها» نیست: نمرهٔ RRF فشرده است و اختلافِ رتبهٔ اول و
   * دوم همیشه کوچک در می‌آید، پس آستانهٔ نمره‌ای چیزی نمی‌گوید. معیارِ واقعی
   * این است که نتایجِ بالا **از یک سند** بیایند — یعنی همه دربارهٔ یک موضوعند و
   * چسباندنشان به هم جوابِ منسجم می‌دهد. اگر از سه سندِ متفاوت آمده باشند،
   * سؤال چندوجهی است و بدونِ مدل نباید جوابِ قطعی داد.
   */
  static isConfident(results) {
    if (!results.length) return false;
    if (results.length === 1) return true;
    return results[0].docId === results[1].docId;
  }
}

/** آماده کردنِ متنِ بازیابی‌شده با بودجهٔ نویسه — جلوی prompt غول‌پیکر را می‌گیرد */
export function packContext(results, maxChars = config.rag.maxContextChars) {
  const out = [];
  let used = 0;
  for (const r of results) {
    const header = `[${r.title}${r.heading ? ' ← ' + r.heading : ''}] (نسخه ${r.version || '؟'})`;
    const body = r.text;
    const piece = `${header}\n${body}`;
    if (used + piece.length > maxChars) {
      const room = maxChars - used;
      if (room > 200) out.push(piece.slice(0, room) + '…');
      break;
    }
    out.push(piece);
    used += piece.length;
  }
  return out;
}
