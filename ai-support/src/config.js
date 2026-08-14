// ═══════════════════════════════════════════════════════════════════════════
//  پیکربندیِ سرویس
//
//  ترتیبِ اولویت (هرچه پایین‌تر، قوی‌تر):
//     ۱) پیش‌فرض‌های همین فایل
//     ۲) config.local.json  (خروجیِ اسکریپتِ تشخیصِ سخت‌افزار می‌نشیند این‌جا)
//     ۳) متغیرهای محیطی / فایلِ .env
//
//  چرا رمزها فقط از محیط می‌آیند: تا هیچ رمزی داخلِ فایلی که ممکن است کامیت شود
//  ننشیند. `config.local.json` هم در .gitignore هست، ولی رمز آن‌جا هم نمی‌گذاریم.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.AI_DATA_DIR
  ? path.resolve(process.env.AI_DATA_DIR)
  : path.join(ROOT, 'data');
export const KB_DIR = path.join(ROOT, 'knowledge');

// ── خواندنِ .env (اختیاری، بدونِ وابستگی) ───────────────────────────────────
(function loadEnv() {
  try {
    const p = path.join(ROOT, '.env');
    if (!fs.existsSync(p)) return;
    for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch { /* بی‌خیال — پیش‌فرض‌ها کافی‌اند */ }
})();

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v)));
const list = (v, d) => (v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : d);

const defaults = {
  server: {
    port: 8788,
    host: '127.0.0.1',
    allowedOrigins: [],          // خالی = فقط same-origin
    maxBodyBytes: 32 * 1024,     // سؤالِ چت هیچ‌وقت بزرگ نیست
  },

  auth: {
    sessionSecret: '',           // خالی → ساخته و در data/session-key.txt ذخیره می‌شود
    sessionTtlMs: 12 * 60 * 60 * 1000,
    appToken: '',                // خالی → توکنِ داخلیِ برنامه پذیرفته می‌شود
  },

  llm: {
    provider: 'ollama',          // ollama | openai-compat | none
    ollamaUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5:3b-instruct-q4_K_M',
    embedModel: 'nomic-embed-text',
    openaiBaseUrl: '',
    openaiApiKey: '',
    openaiModel: '',
    temperature: 0.2,            // پشتیبانی جای خلاقیت نیست
    numCtx: 2048,
    maxTokens: 400,
    keepAlive: '5m',
    timeoutMs: 60000,
  },

  // ترمزهای بار — قلبِ «کامپیوتر نسوزد»
  load: {
    maxConcurrent: 1,
    maxQueue: 8,
    queueTimeoutMs: 45000,
    loadLimit: 0.85,             // میانگینِ بار به‌ازای هر هسته
    cacheSize: 300,
    cacheTtlMs: 6 * 60 * 60 * 1000,
  },

  rag: {
    topK: 6,                     // چند چانک پیشِ مدل برود
    candidateK: 24,              // چند تا از هر بازیاب پیش از ادغام
    maxContextChars: 4500,       // بودجهٔ متنِ بازیابی‌شده
    minScore: 0.02,
    useEmbeddings: true,         // اگر مدلِ امبدینگ نبود، خودکار خاموش می‌شود
    chunkChars: 900,
    chunkOverlap: 120,
  },

  agent: {
    maxSteps: 2,                 // سقفِ دورِ ابزار — هم امنیت هم مصرف
    historyTurns: 6,
  },

  tools: {
    // ابزارِ تازه تا نامش این‌جا نیاید اجرا نمی‌شود، هرچقدر هم درست تعریف شده باشد
    whitelist: [
      'search_knowledge_base',
      'search_documentation',
      'search_faq',
      'get_feature_info',
      'get_shortcuts',
      'get_supported_links',
      'get_account_help',
      'generate_qr',
      // ابزارهای «سمتِ دستگاه» — اعدادِ واقعیِ حساب‌ها. سرور اجرایشان نمی‌کند؛
      // مرورگرِ خودِ کاربر حسابشان می‌کند و فقط نتیجه برمی‌گردد.
      'get_account_balance',
      'list_accounts',
      'get_fuel_stock',
      'get_app_totals',
      'search_app_data',
    ],
  },

  memory: {
    enabled: true,
    maxItems: 40,
    maxValueChars: 300,
  },

  rateLimit: {
    windowMs: 60_000,
    maxRequests: 30,             // سؤال در دقیقه، به‌ازای هر دستگاه
    maxLlmRequests: 12,          // از آن‌ها چند تا اجازهٔ رفتن پیشِ مدل دارند
  },

  audit: {
    enabled: true,
    maxFileBytes: 5 * 1024 * 1024,
    keepFiles: 3,
  },
};

// ── config.local.json ───────────────────────────────────────────────────────
function deepMerge(base, extra) {
  if (!extra || typeof extra !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined && v !== null) {
      out[k] = v;
    }
  }
  return out;
}

let cfg = defaults;
try {
  const p = path.join(ROOT, 'config.local.json');
  if (fs.existsSync(p)) cfg = deepMerge(cfg, JSON.parse(fs.readFileSync(p, 'utf8')));
} catch (e) {
  console.error('⚠️  config.local.json خوانده نشد:', e.message);
}

// ── متغیرهای محیطی (قوی‌ترین) ───────────────────────────────────────────────
const E = process.env;
cfg = deepMerge(cfg, {
  server: {
    port: num(E.AI_PORT, cfg.server.port),
    host: E.AI_HOST || cfg.server.host,
    allowedOrigins: list(E.AI_ALLOWED_ORIGINS, cfg.server.allowedOrigins),
  },
  auth: {
    sessionSecret: E.AI_SESSION_SECRET || cfg.auth.sessionSecret,
    appToken: E.AI_APP_TOKEN || cfg.auth.appToken,
  },
  llm: {
    provider: E.AI_LLM_PROVIDER || cfg.llm.provider,
    ollamaUrl: E.AI_OLLAMA_URL || cfg.llm.ollamaUrl,
    model: E.AI_LLM_MODEL || cfg.llm.model,
    embedModel: E.AI_EMBED_MODEL || cfg.llm.embedModel,
    openaiBaseUrl: E.AI_OPENAI_BASE_URL || cfg.llm.openaiBaseUrl,
    openaiApiKey: E.AI_OPENAI_API_KEY || cfg.llm.openaiApiKey,
    openaiModel: E.AI_OPENAI_MODEL || cfg.llm.openaiModel,
    numCtx: num(E.AI_NUM_CTX, cfg.llm.numCtx),
    maxTokens: num(E.AI_MAX_TOKENS, cfg.llm.maxTokens),
    keepAlive: E.AI_KEEP_ALIVE || cfg.llm.keepAlive,
  },
  load: {
    maxConcurrent: num(E.AI_MAX_CONCURRENT, cfg.load.maxConcurrent),
    maxQueue: num(E.AI_MAX_QUEUE, cfg.load.maxQueue),
    loadLimit: num(E.AI_LOAD_LIMIT, cfg.load.loadLimit),
  },
  memory: { enabled: bool(E.AI_MEMORY, cfg.memory.enabled) },
});

// ── رمزِ نشست: اگر تنظیم نشده، یکی بساز و نگه دار ───────────────────────────
if (!cfg.auth.sessionSecret) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const keyPath = path.join(DATA_DIR, 'session-key.txt');
    if (fs.existsSync(keyPath)) {
      cfg.auth.sessionSecret = fs.readFileSync(keyPath, 'utf8').trim();
    } else {
      cfg.auth.sessionSecret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(keyPath, cfg.auth.sessionSecret, { mode: 0o600 });
    }
  } catch {
    // حتی اگر دیسک نوشتنی نبود، سرویس باید بالا بیاید؛ نشست‌ها با هر ری‌استارت باطل می‌شوند
    cfg.auth.sessionSecret = crypto.randomBytes(32).toString('hex');
  }
}

cfg.paths = { ROOT, DATA_DIR, KB_DIR };
cfg.cpuCount = Math.max(1, os.cpus()?.length || 1);

export const config = cfg;
export default cfg;
