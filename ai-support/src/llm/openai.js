// ═══════════════════════════════════════════════════════════════════════════
//  سرویس‌دهندهٔ سازگار با OpenAI — برای وقتی سخت‌افزار کِشش ندارد
//
//  ⚠️ نکتهٔ حریمِ خصوصی که در خواستهٔ پروژه هم آمده بود:
//     در این حالت، متنِ سؤالِ کاربر و بخشی از مستندات به یک سرویسِ بیرونی
//     می‌رود. برای همین:
//       • پیش‌فرض خاموش است.
//       • فقط چیزی می‌رود که از لایهٔ redact رد شده باشد.
//       • داده‌های واقعیِ برنامه (حساب، عدد، نام) اصلاً در دسترسِ سرویس نیست،
//         پس نمی‌تواند برود — این یکی را معماری تضمین می‌کند نه احتیاط.
// ═══════════════════════════════════════════════════════════════════════════

import config from '../config.js';
import { redactText } from '../security/redact.js';

export class OpenAICompatProvider {
  constructor(cfg = config) {
    this.cfg = cfg;
    this.base = (cfg.llm.openaiBaseUrl || '').replace(/\/+$/, '');
    this.model = cfg.llm.openaiModel || cfg.llm.model;
  }

  get name() { return `openai-compat:${this.model}`; }

  async available() {
    return !!(this.base && this.cfg.llm.openaiApiKey);
  }

  async modelReady() { return this.available(); }

  async chat({ messages, tools = [], signal, temperature }) {
    if (!this.base) {
      const e = new Error('AI_OPENAI_BASE_URL تنظیم نشده است');
      e.code = 'NO_MODEL';
      throw e;
    }

    // آخرین تور پیش از رفتن به بیرون
    const safeMessages = messages.map(m => ({ ...m, content: typeof m.content === 'string' ? redactText(m.content) : m.content }));

    const body = {
      model: this.model,
      messages: safeMessages,
      temperature: temperature ?? this.cfg.llm.temperature,
      max_tokens: this.cfg.llm.maxTokens,
      stream: false,
    };
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const res = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cfg.llm.openaiApiKey}`,
      },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(this.cfg.llm.timeoutMs),
    });

    if (!res.ok) {
      const e = new Error(`سرویسِ مدل پاسخ نداد (${res.status})`);
      e.code = 'PROVIDER_ERROR';
      throw e;
    }

    const data = await res.json();
    const msg = data?.choices?.[0]?.message || {};
    return {
      text: String(msg.content || '').trim(),
      toolCalls: (msg.tool_calls || []).map(tc => ({
        name: tc?.function?.name,
        args: safeParse(tc?.function?.arguments),
      })).filter(t => t.name),
      usage: {
        promptTokens: data?.usage?.prompt_tokens || 0,
        completionTokens: data?.usage?.completion_tokens || 0,
      },
    };
  }
}

function safeParse(s) {
  if (!s) return {};
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return {}; }
}
