#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
//  تشخیصِ سخت‌افزار و پیشنهادِ مدل
//
//      node bin/detect-hardware.mjs            ← فقط گزارش
//      node bin/detect-hardware.mjs --apply    ← تنظیمات را هم بنویس
//      node bin/detect-hardware.mjs --json     ← خروجیِ ماشین‌خوان
//
//  ⚠️ چرا این فایل اجازهٔ اجرای دستور دارد ولی سرویس ندارد:
//
//     این اسکریپت **بخشی از سرویس نیست**. صاحبِ سرور خودش یک بار دستی اجرایش
//     می‌کند. سرویس (`src/`) هرگز آن را import نمی‌کند و نمی‌تواند صدایش بزند —
//     تستِ `no-shell.test.mjs` دقیقاً همین جدایی را بررسی می‌کند.
//
//     دستورهایی که اجرا می‌شوند ثابت و از پیش نوشته‌شده‌اند؛ هیچ ورودیِ کاربر
//     یا مدل داخلشان نمی‌رود، پس جای تزریقِ دستور وجود ندارد.
// ═══════════════════════════════════════════════════════════════════════════

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GB = 1024 ** 3;

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const apply = args.includes('--apply');
// فقط نامِ مدل را چاپ کن و هیچ چیزِ دیگر — تا اسکریپتِ نصب بتواند مستقیم
// بخواندش. بدونِ این، باید خروجیِ فارسی را با ابزارِ متنی تجزیه می‌کردیم که
// روی ویندوز و با یونیکد شکننده است.
const printModel = args.includes('--print-model');
const quiet = asJson || printModel;
const log = (...a) => { if (!quiet) console.log(...a); };

/** اجرای امنِ یک دستورِ ثابت — اگر نبود یا خطا داد، خالی برمی‌گردد */
async function tryRun(cmd, cmdArgs, timeout = 6000) {
  try {
    const { stdout } = await run(cmd, cmdArgs, { timeout, windowsHide: true });
    return String(stdout || '').trim();
  } catch {
    return '';
  }
}

// ── GPU ────────────────────────────────────────────────────────────────────
async function detectGpu() {
  // NVIDIA — دقیق‌ترین منبع، روی هر سه سیستم‌عامل یکی است
  const nv = await tryRun('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits']);
  if (nv) {
    const gpus = nv.split(/\r?\n/).map(line => {
      const [name, mb] = line.split(',').map(s => s.trim());
      return { vendor: 'nvidia', name, vramGb: Math.round((parseInt(mb, 10) || 0) / 1024 * 10) / 10 };
    }).filter(g => g.name);
    if (gpus.length) return gpus;
  }

  if (process.platform === 'win32') {
    const out = await tryRun('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress']);
    if (out) {
      try {
        const parsed = JSON.parse(out);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        return arr.map(g => ({
          vendor: guessVendor(g.Name),
          name: g.Name,
          // AdapterRAM روی کارت‌های بزرگ اشتباه گزارش می‌شود؛ عددِ منفی/صفر یعنی نامعلوم
          vramGb: g.AdapterRAM > 0 ? Math.round(g.AdapterRAM / GB * 10) / 10 : null,
        })).filter(g => g.name);
      } catch { /* ادامه */ }
    }
  }

  if (process.platform === 'linux') {
    const out = await tryRun('sh', ['-c', 'lspci 2>/dev/null | grep -Ei "vga|3d|display"']);
    if (out) {
      return out.split(/\r?\n/).filter(Boolean).map(line => {
        const name = line.replace(/^\S+\s+[^:]+:\s*/, '').trim();
        return { vendor: guessVendor(name), name, vramGb: null };
      });
    }
  }

  if (process.platform === 'darwin') {
    const out = await tryRun('system_profiler', ['SPDisplaysDataType', '-json']);
    if (out) {
      try {
        const j = JSON.parse(out);
        return (j.SPDisplaysDataType || []).map(g => ({
          vendor: guessVendor(g.sppci_model || ''),
          name: g.sppci_model || 'GPU',
          // روی اپل‌سیلیکون حافظه مشترک است — با رَم حساب می‌شود
          vramGb: null,
          unified: true,
        }));
      } catch { /* ادامه */ }
    }
  }

  return [];
}

function guessVendor(name = '') {
  const n = name.toLowerCase();
  if (n.includes('nvidia') || n.includes('geforce') || n.includes('rtx') || n.includes('gtx')) return 'nvidia';
  if (n.includes('amd') || n.includes('radeon')) return 'amd';
  if (n.includes('intel')) return 'intel';
  if (n.includes('apple')) return 'apple';
  return 'unknown';
}

// ── دیسک ───────────────────────────────────────────────────────────────────
async function detectStorage() {
  try {
    const s = fs.statfsSync(ROOT);
    return {
      freeGb: Math.round(s.bavail * s.bsize / GB * 10) / 10,
      totalGb: Math.round(s.blocks * s.bsize / GB * 10) / 10,
    };
  } catch {
    return { freeGb: null, totalGb: null };
  }
}

// ── Ollama ─────────────────────────────────────────────────────────────────
async function detectOllama() {
  const url = process.env.AI_OLLAMA_URL || 'http://127.0.0.1:11434';
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { installed: false, models: [] };
    const data = await res.json();
    return { installed: true, url, models: (data?.models || []).map(m => m.name) };
  } catch {
    return { installed: false, models: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  انتخابِ مدل
//
//  فلسفهٔ جدول: **یک اندازه پایین‌تر از حداکثرِ ممکن**. مدلی که رَم را لبه‌به‌لبه
//  پر کند، اولین باری که کاربر یک برنامهٔ دیگر باز کند به swap می‌افتد و کلِ
//  کامپیوتر کند می‌شود — دقیقاً همان چیزی که نمی‌خواهیم.
//
//  Qwen2.5 انتخاب شده چون در این اندازه‌ها بهترین فارسی را دارد. عوض کردنش یک
//  خط در .env است.
// ═══════════════════════════════════════════════════════════════════════════
const TABLE = [
  { minVram: 16, model: 'qwen2.5:14b-instruct-q4_K_M', ctx: 4096, why: 'VRAM زیاد — مدلِ بزرگ کاملاً روی کارت جا می‌شود' },
  { minVram: 10, model: 'qwen2.5:7b-instruct-q4_K_M',  ctx: 4096, why: 'VRAM خوب — مدلِ ۷ب با سرعتِ بالا' },
  { minVram: 6,  model: 'qwen2.5:7b-instruct-q4_K_M',  ctx: 2048, why: 'VRAM متوسط — ۷ب با پنجرهٔ کوچک‌تر' },
  { minVram: 4,  model: 'qwen2.5:3b-instruct-q4_K_M',  ctx: 2048, why: 'VRAM کم — ۳ب راحت جا می‌شود' },
];

// آستانه‌ها عمداً کمی زیرِ عددِ اسمی‌اند: سیستم‌عامل بخشی از رَم را برای خودش
// برمی‌دارد، پس کامپیوترِ «۱۶ گیگ» معمولاً ۱۵٫۶ گزارش می‌دهد. با آستانهٔ ۱۶، هر
// کامپیوترِ ۱۶ گیگی یک پله پایین‌تر می‌افتاد.
const CPU_TABLE = [
  { minRam: 30,  model: 'qwen2.5:7b-instruct-q4_K_M',   ctx: 2048, why: 'رَمِ زیاد — روی CPU کند ولی قابلِ استفاده' },
  { minRam: 15,  model: 'qwen2.5:3b-instruct-q4_K_M',   ctx: 2048, why: 'بدونِ کارتِ گرافیک — ۳ب تعادلِ خوبی است' },
  { minRam: 7.5, model: 'qwen2.5:1.5b-instruct-q4_K_M', ctx: 2048, why: 'رَمِ محدود — مدلِ کوچک تا سیستم کند نشود' },
];

function recommend({ gpus, ramGb, cores }) {
  const best = gpus.reduce((max, g) => Math.max(max, g.vramGb || 0), 0);
  const apple = gpus.some(g => g.unified);

  // اپل‌سیلیکون: حافظه مشترک است، حدود نیمی از رَم عملاً برای مدل در دسترس است
  const effectiveVram = apple ? ramGb * 0.5 : best;

  if (effectiveVram >= 4) {
    const row = TABLE.find(r => effectiveVram >= r.minVram);
    if (row) return { ...row, mode: apple ? 'apple-unified' : 'gpu', vramGb: Math.round(effectiveVram * 10) / 10 };
  }

  const row = CPU_TABLE.find(r => ramGb >= r.minRam);
  if (row) return { ...row, mode: 'cpu', threads: Math.max(2, Math.floor(cores / 2)) };

  return {
    mode: 'none',
    model: null,
    ctx: 2048,
    why: 'رَم برای اجرای مدلِ محلی کافی نیست — سرویس در حالتِ «فقط بازیابی» کار می‌کند یا از API ابری استفاده کن',
  };
}

// ═══════════════════════════════════════════════════════════════════════════

const cpus = os.cpus() || [];
const ramGb = Math.round(os.totalmem() / GB * 10) / 10;
const freeRamGb = Math.round(os.freemem() / GB * 10) / 10;

const [gpus, storage, ollama] = await Promise.all([detectGpu(), detectStorage(), detectOllama()]);

const report = {
  os: { platform: process.platform, release: os.release(), arch: os.arch() },
  cpu: { model: cpus[0]?.model?.trim() || 'نامعلوم', cores: cpus.length, speedMhz: cpus[0]?.speed || null },
  ram: { totalGb: ramGb, freeGb: freeRamGb },
  gpu: gpus,
  storage,
  ollama,
  node: process.version,
};

report.recommendation = recommend({ gpus, ramGb, cores: cpus.length });

if (printModel) {
  // خالی یعنی «این کامپیوتر کِشش ندارد» — اسکریپتِ نصب همین را می‌فهمد
  console.log(report.recommendation.model || '');
} else if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const r = report.recommendation;
  log('\n🖥️  سخت‌افزارِ این کامپیوتر\n');
  log(`   سیستم‌عامل   : ${report.os.platform} ${report.os.release} (${report.os.arch})`);
  log(`   پردازنده     : ${report.cpu.model}`);
  log(`   هسته         : ${report.cpu.cores}${report.cpu.speedMhz ? ` @ ${report.cpu.speedMhz} مگاهرتز` : ''}`);
  log(`   حافظه (RAM)  : ${ramGb} گیگ (${freeRamGb} گیگ آزاد)`);
  log(`   کارت گرافیک  : ${gpus.length ? gpus.map(g => `${g.name}${g.vramGb ? ` — ${g.vramGb} گیگ` : ''}`).join(' | ') : 'پیدا نشد'}`);
  log(`   دیسکِ آزاد    : ${storage.freeGb ?? '؟'} گیگ`);
  log(`   Ollama       : ${ollama.installed ? `نصب است (${ollama.models.length} مدل)` : 'نصب نیست'}`);

  log('\n🧠 پیشنهاد\n');
  if (r.mode === 'none') {
    log('   ⚠️  ' + r.why);
    log('\n   سرویس باز هم کار می‌کند: جواب‌ها مستقیم از مستندات در می‌آیند.');
    log('   اگر مدلِ ابری می‌خواهی، در .env بگذار: AI_LLM_PROVIDER=openai-compat');
  } else {
    log(`   مدل         : ${r.model}`);
    log(`   حالت        : ${r.mode === 'gpu' ? 'روی کارتِ گرافیک' : r.mode === 'apple-unified' ? 'حافظهٔ یکپارچهٔ اپل' : 'روی پردازنده'}`);
    log(`   پنجرهٔ متن   : ${r.ctx}`);
    if (r.threads) log(`   نخ‌ها        : ${r.threads}`);
    log(`   دلیل        : ${r.why}`);
    log('\n   نصبِ مدل:');
    log(`      ollama pull ${r.model}`);
    log(`      ollama pull nomic-embed-text     ← برای جست‌وجوی معنایی`);
  }

  if (report.cpu.cores <= 2) {
    log('\n   ⚠️  فقط ۲ هسته: حتی مدلِ کوچک هم کامپیوتر را کند می‌کند.');
    log('      پیشنهاد: AI_MAX_CONCURRENT=1 و AI_LOAD_LIMIT=0.6 بگذار.');
  }
  if (storage.freeGb !== null && storage.freeGb < 10) {
    log(`\n   ⚠️  فقط ${storage.freeGb} گیگ دیسکِ آزاد — مدل‌ها ۲ تا ۹ گیگ جا می‌خواهند.`);
  }

  log('\n   برای نوشتنِ همین تنظیمات در config.local.json:');
  log('      node bin/detect-hardware.mjs --apply\n');
}

// ── نوشتنِ تنظیمات ─────────────────────────────────────────────────────────
if (apply) {
  const r = report.recommendation;
  const cfgPath = path.join(ROOT, 'config.local.json');
  let existing = {};
  try { if (fs.existsSync(cfgPath)) existing = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch { /* از نو */ }

  const next = {
    ...existing,
    _note: 'ساختهٔ خودکارِ bin/detect-hardware.mjs — دستی هم می‌شود عوضش کرد. هیچ رمزی این‌جا نگذار؛ رمزها در .env.',
    _detectedAt: new Date().toISOString(),
    llm: {
      ...(existing.llm || {}),
      ...(r.model ? { model: r.model } : { provider: 'none' }),
      numCtx: r.ctx,
    },
    load: {
      ...(existing.load || {}),
      maxConcurrent: 1,
      // روی سیستمِ ضعیف زودتر به حالتِ تخفیف برو
      loadLimit: report.cpu.cores <= 2 ? 0.6 : report.cpu.cores <= 4 ? 0.75 : 0.85,
    },
  };

  fs.writeFileSync(cfgPath, JSON.stringify(next, null, 2));
  log(`✅ نوشته شد: ${path.relative(process.cwd(), cfgPath)}\n`);
}
