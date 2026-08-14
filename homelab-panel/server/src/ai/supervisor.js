// ---------------------------------------------------------------------------
//  ناظرِ دستیارِ پشتیبانیِ هوشمند
//
//  سرویسِ ai-support یک پروسهٔ جداست (پوشهٔ ai-support/ کنارِ همین پنل). این
//  ماژول کاری می‌کند که با بالا آمدنِ پنل، خودش هم بالا بیاید و اگر افتاد
//  دوباره برگردد — تا صاحبِ سرور مجبور نباشد جداگانه چیزی را روشن کند.
//
//  چرا پروسهٔ جدا و نه import مستقیم:
//    • مرزِ امنیتیِ آن سرویس روی «پروسهٔ جدا» بنا شده. اگر داخلِ پنل import شود،
//      به دیتابیسِ پنل، به توکن‌ها و به فایل‌سیستم دسترسی پیدا می‌کند — دقیقاً
//      همان چیزی که کلِ آن معماری برای جلوگیری‌اش ساخته شد.
//    • اگر مدل حافظه بخورد یا گیر کند، فقط همان پروسه می‌افتد. پنل و سرورِ
//      همگام‌سازیِ سایت دست‌نخورده می‌مانند.
//
//  ⚠️ این ماژول عمداً هیچ‌چیزی از ai-support را import نمی‌کند.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, SERVER_ROOT } from '../config.js';
import { logEvent } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const aiEvents = new EventEmitter();

const RING = 200;
const ring = [];

let child = null;
let startedAt = 0;
let restarts = 0;
let stopping = false;
let backoffTimer = null;
let lastError = '';

/**
 * پیدا کردنِ پوشهٔ ai-support.
 * ترتیب: تنظیمِ صریح → کنارِ پنل در همان ریپو → یک پله بالاتر.
 */
export function resolveAiDir() {
  const candidates = [
    config.aiDir,
    // homelab-panel/server/src/ai → ../../../../ai-support
    path.resolve(SERVER_ROOT, '..', '..', 'ai-support'),
    path.resolve(SERVER_ROOT, '..', 'ai-support'),
    path.resolve(SERVER_ROOT, 'ai-support'),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'src', 'index.js'))) return dir;
    } catch { /* بعدی */ }
  }
  return null;
}

function push(level, text) {
  const line = `${new Date().toISOString()}\t${level}\t${text}`;
  ring.push(line);
  if (ring.length > RING) ring.shift();
  aiEvents.emit('log', { level, text, at: Date.now() });
  // خطاها و رویدادهای مهمِ خودِ ناظر در پنجرهٔ پنل هم دیده شوند — وگرنه اگر
  // دستیار بالا نیاید، هیچ نشانه‌ای نیست و آدم دنبالِ چیزِ اشتباه می‌گردد.
  // (سطرهای عادیِ خودِ سرویس ساکت می‌مانند تا پنجره شلوغ نشود.)
  if (level === 'error' || level === 'warn') console.error(`  [دستیار] ${text}`);
}

/** پیام‌های خودِ ناظر — همیشه در پنجره دیده شوند */
function announce(text) {
  console.log(`  🤖 ${text}`);
  push('info', text);
}

/** وضعیتِ فعلی — برای صفحهٔ پنل و برای /health */
export function aiStatus() {
  const dir = resolveAiDir();
  return {
    enabled: config.aiEnabled,
    installed: !!dir,
    dir: dir || null,
    running: !!child && !child.killed,
    pid: child?.pid || null,
    port: config.aiPort,
    startedAt: startedAt || null,
    uptimeMs: startedAt ? Date.now() - startedAt : 0,
    restarts,
    lastError: lastError || null,
  };
}

export function aiLogs(limit = 100) {
  return ring.slice(-Math.max(1, Math.min(RING, limit)));
}

/**
 * روشن کردنِ سرویس.
 * @returns {{ok: boolean, reason?: string}}
 */
export function startAi() {
  if (child) return { ok: true, reason: 'از قبل در حال اجراست' };
  if (!config.aiEnabled) return { ok: false, reason: 'در تنظیمات خاموش است (HLP_AI_ENABLED=0)' };

  const dir = resolveAiDir();
  if (!dir) {
    lastError = 'پوشهٔ ai-support پیدا نشد';
    push('warn', `${lastError} — دستیار بالا نیامد. کنارِ پنل باید پوشهٔ ai-support باشد.`);
    return { ok: false, reason: lastError };
  }

  stopping = false;
  const entry = path.join(dir, 'src', 'index.js');

  // متغیرهای محیطیِ سرویس. عمداً محدود: هیچ‌کدام از رمزهای پنل پاس داده نمی‌شود.
  const env = {
    ...process.env,
    AI_PORT: String(config.aiPort),
    // فقط روی خودِ دستگاه گوش می‌دهد؛ راهِ رسیدنِ دنیای بیرون، پراکسیِ همین پنل است
    AI_HOST: '127.0.0.1',
    AI_DATA_DIR: path.join(config.dataDir, 'ai-support'),
    // گاردِ خودِ سرویس، پوشهٔ دادهٔ بیرون از خودش را رد می‌کند — و درست هم
    // می‌کند. این‌جا عمدی است: پنل همهٔ دادهٔ سرویس‌هایش را زیرِ یک پوشه جمع
    // می‌کند تا پشتیبان‌گیری و پاک‌سازی یک‌جا باشد. مسیرِ داده‌شده هم زیرِ
    // پوشهٔ دادهٔ خودِ پنل است، نه جای حساسی.
    AI_ALLOW_EXTERNAL_DATA_DIR: '1',
  };
  if (config.aiAdminToken) env.AI_ADMIN_TOKEN = config.aiAdminToken;
  if (config.aiModel) env.AI_LLM_MODEL = config.aiModel;
  if (config.aiOllamaUrl) env.AI_OLLAMA_URL = config.aiOllamaUrl;

  try {
    child = spawn(process.execPath, [entry], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (e) {
    lastError = e.message;
    child = null;
    push('error', `اجرا نشد: ${e.message}`);
    return { ok: false, reason: e.message };
  }

  startedAt = Date.now();
  lastError = '';
  announce(`دستیارِ پشتیبانی روشن شد (پورت ${config.aiPort}) — سایت از راهِ /ai/support به آن می‌رسد`);
  logEvent('info', 'ai', `دستیار روشن شد روی پورت ${config.aiPort}`);

  const wire = (stream, level) => {
    stream.setEncoding('utf8');
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';
      for (const l of lines) if (l.trim()) push(level, l.trim());
    });
  };
  wire(child.stdout, 'info');
  wire(child.stderr, 'error');

  child.on('exit', (code, signal) => {
    const was = child;
    child = null;
    startedAt = 0;
    if (stopping) {
      push('info', 'دستیار خاموش شد');
      return;
    }
    lastError = `پروسه بسته شد (کد ${code ?? signal})`;
    push('warn', lastError);
    logEvent('warn', 'ai', lastError);

    // برگشتِ خودکار با تأخیرِ فزاینده — تا اگر مدام می‌افتد، سیستم را نچرخاند
    restarts++;
    const delay = Math.min(60_000, 2000 * Math.pow(2, Math.min(restarts, 5)));
    push('info', `${Math.round(delay / 1000)} ثانیهٔ دیگر دوباره تلاش می‌کنم…`);
    clearTimeout(backoffTimer);
    backoffTimer = setTimeout(() => { if (!stopping && was) startAi(); }, delay);
    backoffTimer.unref?.();
  });

  child.on('error', (e) => {
    lastError = e.message;
    push('error', `خطای پروسه: ${e.message}`);
  });

  return { ok: true };
}

/** خاموش کردن — بدونِ تلاشِ دوبارهٔ خودکار */
export function stopAi() {
  stopping = true;
  clearTimeout(backoffTimer);
  if (!child) return { ok: true, reason: 'در حال اجرا نبود' };
  try {
    child.kill('SIGTERM');
    // اگر خوش‌رفتار نبود، بعد از سه ثانیه قطعی
    const c = child;
    setTimeout(() => { try { if (c && !c.killed) c.kill('SIGKILL'); } catch { /* رفته */ } }, 3000).unref?.();
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  return { ok: true };
}

export function restartAi() {
  stopAi();
  restarts = 0;
  return new Promise((resolve) => {
    setTimeout(() => resolve(startAi()), 800);
  });
}

/** با بالا آمدنِ پنل صدا زده می‌شود */
export function autostartAi() {
  if (!config.aiEnabled) {
    announce('دستیارِ پشتیبانی در تنظیمات خاموش است (HLP_AI_ENABLED=0)');
    return;
  }
  const dir = resolveAiDir();
  if (!dir) {
    announce('پوشهٔ ai-support کنارِ پنل نیست — دستیار روشن نشد (بقیهٔ پنل عادی کار می‌کند)');
    return;
  }
  startAi();
}
