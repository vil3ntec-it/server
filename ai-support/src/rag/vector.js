// ═══════════════════════════════════════════════════════════════════════════
//  بازیابیِ معنایی (embeddings)
//
//  این لایه **اختیاری** است و باید اختیاری بماند: اگر مدلِ امبدینگ نصب نباشد،
//  سرویس باید کار کند، نه اینکه بایستد. بدونِ آن، «معنا» از دو جای دیگر می‌آید:
//  مترادف‌هایی که در سربرگِ اسناد نوشته شده و بسطِ پرسش توسطِ خودِ مدل.
//
//  بردارها در ساختِ ایندکس یک بار حساب می‌شوند و روی دیسک می‌مانند. در زمانِ
//  پاسخ فقط بردارِ خودِ پرسش حساب می‌شود — یک فراخوانیِ کوچک، حدود ۲۰ میلی‌ثانیه.
// ═══════════════════════════════════════════════════════════════════════════

import config from '../config.js';

/** بردارها را واحد می‌کنیم تا شباهتِ کسینوسی به یک ضربِ داخلیِ ساده تبدیل شود */
export function normalizeVector(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum) || 1;
  return v.map(x => x / len);
}

/** بردارها از قبل واحد شده‌اند، پس این فقط ضربِ داخلی است */
export function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * گرفتنِ بردار از Ollama.
 * @returns {Promise<number[]|null>} در صورتِ هر خطایی null — سرویس نباید بایستد
 */
export async function embed(text, { signal } = {}) {
  if (!config.rag.useEmbeddings) return null;
  if (config.llm.provider !== 'ollama') return null;

  try {
    const res = await fetch(`${config.llm.ollamaUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.llm.embedModel, prompt: String(text).slice(0, 4000) }),
      signal: signal ?? AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data?.embedding) || !data.embedding.length) return null;
    return normalizeVector(data.embedding);
  } catch {
    return null;
  }
}

/** آیا مدلِ امبدینگ واقعاً در دسترس است؟ (یک بار، هنگامِ ساختِ ایندکس) */
export async function embeddingsAvailable() {
  const v = await embed('آزمایش');
  return Array.isArray(v) && v.length > 0;
}

/**
 * جست‌وجوی برداری.
 * @param {{dim:number, ids:string[], vectors:number[][]}} store
 * @param {number[]} queryVec
 */
export function vectorSearch(store, queryVec, limit = 24) {
  if (!store || !queryVec || !store.vectors?.length) return [];
  const out = [];
  for (let i = 0; i < store.vectors.length; i++) {
    out.push({ id: store.ids[i], score: cosine(store.vectors[i], queryVec) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
