// ---------------------------------------------------------------------------
//  Ollama — مغزِ محلیِ دستیار
//
//  چرا Ollama و نه چیزِ دیگری: روی ویندوز و لینوکس با یک نصب بالا می‌آید،
//  مدل‌ها را خودش نگه می‌دارد، `keep_alive` دارد (مدل وقتی کسی سؤالی ندارد از
//  رَم بیرون می‌رود) و هیچ کلیدِ خارجی و هیچ پولی در کار نیست — همان قاعدهٔ
//  پرامپت: «هوش مصنوعی خودِ من است، نه اجاره‌ای».
//
//  این فایل فقط با HTTPِ Ollama حرف می‌زند؛ هیچ تصمیمی نمی‌گیرد. جریانِ
//  پاسخ (NDJSON) همین‌جا خوانده می‌شود تا پنل بتواند حرف‌به‌حرف نشان بدهد.
// ---------------------------------------------------------------------------
import { config } from '../config.js';

export function ollamaUrl() {
  return String(config.agent?.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/+$/, '');
}

async function readLines(res, onLine) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj = null;
      try { obj = JSON.parse(line); } catch { continue; }
      await onLine(obj);
    }
  }
  if (buf.trim()) {
    try { await onLine(JSON.parse(buf)); } catch { /* دنبالهٔ ناقص */ }
  }
}

let availCache = { at: 0, ok: false };

/** آیا Ollama بالاست؟ (نتیجه ۱۵ ثانیه کش می‌شود) */
export async function available({ force = false } = {}) {
  if (!force && Date.now() - availCache.at < 15_000) return availCache.ok;
  try {
    const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(2500) });
    availCache = { at: Date.now(), ok: res.ok };
  } catch {
    availCache = { at: Date.now(), ok: false };
  }
  return availCache.ok;
}

/** مدل‌های نصب‌شده */
export async function tags() {
  const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = await res.json();
  return (data?.models || []).map((m) => ({
    name: m.name,
    sizeBytes: Number(m.size) || 0,
    modifiedAt: m.modified_at || null,
    family: m.details?.family || '',
    parameterSize: m.details?.parameter_size || '',
    quantization: m.details?.quantization_level || '',
  }));
}

/** مدل‌هایی که همین حالا در رَم‌اند */
export async function loaded() {
  try {
    const res = await fetch(`${ollamaUrl()}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.models || []).map((m) => ({
      name: m.name, sizeBytes: Number(m.size) || 0, vramBytes: Number(m.size_vram) || 0, expiresAt: m.expires_at || null,
    }));
  } catch {
    return [];
  }
}

export async function hasModel(name) {
  try {
    const list = await tags();
    const base = String(name).split(':')[0];
    return list.some((m) => m.name === name || (!String(name).includes(':') && m.name.split(':')[0] === base));
  } catch {
    return false;
  }
}

/**
 * گفت‌وگو با مدل — جریانی.
 *
 * `onToken` با هر تکهٔ متن صدا زده می‌شود. اگر مدل ابزار صدا بزند، Ollama
 * `message.tool_calls` را در یک تکه می‌فرستد و متن خالی می‌ماند.
 *
 * @returns {Promise<{text: string, toolCalls: {name: string, args: object}[], stats: object}>}
 */
export async function chat({ model, messages, tools = [], options = {}, keepAlive, signal, onToken }) {
  const body = {
    model,
    messages,
    stream: true,
    keep_alive: keepAlive ?? config.agent?.keepAlive ?? '10m',
    options: { temperature: 0.2, num_ctx: config.agent?.numCtx || 8192, ...options },
  };
  if (tools.length) body.tools = tools;

  const res = await fetch(`${ollamaUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(config.agent?.timeoutMs || 180_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`Ollama پاسخ نداد (${res.status})${detail ? ': ' + detail.slice(0, 200) : ''}`);
    e.code = res.status === 404 ? 'model_missing' : 'ollama_error';
    throw e;
  }

  let text = '';
  const toolCalls = [];
  let stats = {};
  await readLines(res, async (obj) => {
    if (obj.error) throw Object.assign(new Error(obj.error), { code: 'ollama_error' });
    const piece = obj?.message?.content || '';
    if (piece) {
      text += piece;
      if (onToken) await onToken(piece);
    }
    for (const tc of obj?.message?.tool_calls || []) {
      const fn = tc?.function || {};
      let args = fn.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      toolCalls.push({ name: String(fn.name || ''), args: args && typeof args === 'object' ? args : {} });
    }
    if (obj.done) {
      stats = {
        promptTokens: obj.prompt_eval_count || 0,
        tokens: obj.eval_count || 0,
        totalMs: Math.round((obj.total_duration || 0) / 1e6),
      };
    }
  });
  return { text, toolCalls, stats };
}

/** مدل را از رَم بیرون بفرست (keep_alive = 0) — برای بی‌کاری و نگهبانِ حرارتی */
export async function unload(model) {
  try {
    await fetch(`${ollamaUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * دانلودِ مدل با پیشرفت.
 * @param {string} name
 * @param {{onProgress?: Function, signal?: AbortSignal}} o
 */
export async function pull(name, { onProgress, signal } = {}) {
  const res = await fetch(`${ollamaUrl()}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, stream: true }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`دانلودِ مدل شروع نشد (${res.status})${detail ? ': ' + detail.slice(0, 200) : ''}`);
  }
  let last = null;
  await readLines(res, async (obj) => {
    if (obj.error) throw new Error(obj.error);
    last = {
      status: obj.status || '',
      total: Number(obj.total) || 0,
      completed: Number(obj.completed) || 0,
      percent: obj.total ? Math.min(100, Math.round((Number(obj.completed) || 0) / Number(obj.total) * 100)) : null,
    };
    if (onProgress) await onProgress(last);
  });
  return last;
}

export async function deleteModel(name) {
  const res = await fetch(`${ollamaUrl()}/api/delete`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok && res.status !== 404) throw new Error(`حذفِ مدل نشد (${res.status})`);
  return true;
}

export async function version() {
  try {
    const res = await fetch(`${ollamaUrl()}/api/version`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return (await res.json())?.version || null;
  } catch {
    return null;
  }
}
