// ═══════════════════════════════════════════════════════════════════════════
//  Ollama — سرویس‌دهندهٔ پیش‌فرضِ محلی
//
//  چرا پیش‌فرض: روی ویندوز و لینوکس با یک نصب بالا می‌آید، مدل‌ها را خودش
//  مدیریت می‌کند، و مهم‌تر از همه `keep_alive` دارد — یعنی وقتی کسی سؤالی
//  ندارد، مدل از رَم بیرون می‌رود. روی کامپیوترِ خانگی این تفاوتِ بینِ
//  «۴ گیگ رَمِ همیشه اشغال» و «صفر» است.
// ═══════════════════════════════════════════════════════════════════════════

import config from '../config.js';

export class OllamaProvider {
  constructor(cfg = config) {
    this.cfg = cfg;
    this.base = cfg.llm.ollamaUrl.replace(/\/+$/, '');
    this._availableAt = 0;
    this._available = false;
  }

  get name() { return `ollama:${this.cfg.llm.model}`; }
  get model() { return this.cfg.llm.model; }

  /** نتیجه ۳۰ ثانیه کش می‌شود — هر پیام نباید یک درخواستِ اضافه بزند */
  async available() {
    const now = Date.now();
    if (now < this._availableAt) return this._available;
    try {
      const res = await fetch(`${this.base}/api/tags`, { signal: AbortSignal.timeout(2500) });
      this._available = res.ok;
    } catch {
      this._available = false;
    }
    this._availableAt = now + 30_000;
    return this._available;
  }

  /** آیا مدلِ تنظیم‌شده واقعاً pull شده است؟ */
  async modelReady() {
    try {
      const res = await fetch(`${this.base}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return false;
      const data = await res.json();
      const names = (data?.models || []).map(m => String(m.name || ''));
      // ollama نامِ مدل را با تگ برمی‌گرداند؛ مقایسهٔ دقیق و پیشوندی هر دو
      return names.some(n => n === this.model || n.split(':')[0] === this.model.split(':')[0]);
    } catch {
      return false;
    }
  }

  /**
   * @param {{messages: object[], tools?: object[], signal?: AbortSignal, temperature?: number}} req
   * @returns {Promise<{text: string, toolCalls: object[], usage: object}>}
   */
  async chat({ messages, tools = [], signal, temperature }) {
    const body = {
      model: this.model,
      messages,
      stream: false,
      keep_alive: this.cfg.llm.keepAlive,
      options: {
        temperature: temperature ?? this.cfg.llm.temperature,
        num_ctx: this.cfg.llm.numCtx,
        num_predict: this.cfg.llm.maxTokens,
      },
    };
    if (tools.length) body.tools = tools;

    const res = await fetch(`${this.base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(this.cfg.llm.timeoutMs),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const e = new Error(`Ollama پاسخ نداد (${res.status})${detail ? ': ' + detail.slice(0, 200) : ''}`);
      e.code = res.status === 404 ? 'MODEL_MISSING' : 'PROVIDER_ERROR';
      throw e;
    }

    const data = await res.json();
    const msg = data?.message || {};
    return {
      text: String(msg.content || '').trim(),
      toolCalls: (msg.tool_calls || []).map(tc => ({
        name: tc?.function?.name,
        // بعضی نسخه‌ها رشته می‌دهند و بعضی شیء — هر دو را می‌پذیریم
        args: typeof tc?.function?.arguments === 'string'
          ? safeParse(tc.function.arguments)
          : (tc?.function?.arguments || {}),
      })).filter(t => t.name),
      usage: {
        promptTokens: data?.prompt_eval_count || 0,
        completionTokens: data?.eval_count || 0,
        totalMs: Math.round((data?.total_duration || 0) / 1e6),
      },
    };
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
