// ═══════════════════════════════════════════════════════════════════════════
//  لایهٔ مدل — قابلِ تعویض
//
//  کلِ سرویس فقط این قرارداد را می‌شناسد:
//      chat({messages, tools, signal}) → {text, toolCalls[], usage}
//
//  یعنی عوض کردنِ مدل یا حتی عوض کردنِ کلِ سرویس‌دهنده، یک خط در .env است و
//  هیچ‌جای دیگری دست نمی‌خورد. این خواستهٔ صریحِ پروژه بود: «معماری نباید به یک
//  مدل خاص وابسته باشد.»
// ═══════════════════════════════════════════════════════════════════════════

import config from '../config.js';
import { OllamaProvider } from './ollama.js';
import { OpenAICompatProvider } from './openai.js';

/** وقتی هیچ مدلی در دسترس نیست — سرویس باید کار کند، نه بایستد */
class NoProvider {
  get name() { return 'none'; }
  async available() { return false; }
  async chat() {
    const e = new Error('هیچ مدلی پیکربندی نشده است');
    e.code = 'NO_MODEL';
    throw e;
  }
}

let instance = null;

export function getProvider() {
  if (instance) return instance;
  switch (config.llm.provider) {
    case 'ollama': instance = new OllamaProvider(config); break;
    case 'openai-compat': instance = new OpenAICompatProvider(config); break;
    default: instance = new NoProvider();
  }
  return instance;
}

/** فقط برای تست‌ها */
export function setProvider(p) { instance = p; }
export function resetProvider() { instance = null; }
