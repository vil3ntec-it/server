// ---------------------------------------------------------------------------
// مدیریت پروسهٔ هر سایت: Start / Stop / Restart + گرفتن لاگ زندهٔ همان سایت
// هر سایت پروسه، پورت، متغیرهای محیطی و فایل لاگِ کاملاً جدا دارد.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { ensureWorkspace, workspacePaths, siteEnv } from './workspace.js';
import { staticRootOf } from './detect.js';
import { logEvent } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_SERVER = path.join(__dirname, 'static-server.js');
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const RING = 400;

export const processEvents = new EventEmitter();

/** slug -> { child, startedAt, port, ring: string[], restarts } */
const running = new Map();

function classify(line) {
  const l = line.toLowerCase();
  if (/\b(error|err!|fatal|exception|eaddrinuse|econnrefused|\[500\]|\[404\])\b/.test(l)) return 'error';
  if (/\b(warn|warning|deprecated|\[403\])\b/.test(l)) return 'warn';
  return 'info';
}

function appendLog(slug, level, text) {
  const p = ensureWorkspace(slug);
  const stamp = new Date().toISOString();
  const line = `${stamp}\t${level}\t${text}`;
  try {
    // چرخش ساده وقتی فایل بزرگ شد
    if (fs.existsSync(p.logFile) && fs.statSync(p.logFile).size > MAX_LOG_BYTES) {
      fs.renameSync(p.logFile, path.join(p.logs, 'site.1.log'));
    }
    fs.appendFileSync(p.logFile, line + '\n', 'utf8');
  } catch { /* لاگ نباید برنامه را بخواباند */ }

  const state = running.get(slug);
  if (state) {
    state.ring.push(line);
    if (state.ring.length > RING) state.ring.shift();
  }
  processEvents.emit('log', { slug, level, text, at: Date.now() });
}

function pumpStream(slug, stream) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      appendLog(slug, classify(line), line.slice(0, 2000));
    }
  });
  stream.on('end', () => {
    if (buffer.trim()) appendLog(slug, classify(buffer), buffer.slice(0, 2000));
  });
}

export function isRunning(slug) {
  const s = running.get(slug);
  return Boolean(s && s.child && s.child.exitCode === null && !s.child.killed);
}

export function processInfo(slug) {
  const s = running.get(slug);
  if (!s || !isRunning(slug)) return null;
  return {
    pid: s.child.pid,
    startedAt: s.startedAt,
    uptimeSeconds: Math.floor((Date.now() - s.startedAt) / 1000),
    restarts: s.restarts,
    managed: true,
  };
}

export function tailLog(slug, limit = 200) {
  const s = running.get(slug);
  if (s?.ring?.length) return s.ring.slice(-limit);
  const p = workspacePaths(slug);
  try {
    const txt = fs.readFileSync(p.logFile, 'utf8');
    return txt.split('\n').filter(Boolean).slice(-limit);
  } catch {
    return [];
  }
}

export function clearLog(slug) {
  const p = ensureWorkspace(slug);
  try {
    fs.writeFileSync(p.logFile, '', 'utf8');
  } catch { /* بی‌خیال */ }
  const s = running.get(slug);
  if (s) s.ring = [];
}

// آیا پورت واقعاً پاسخ می‌دهد؟ (وضعیت آنلاین/آفلاین واقعی)
export function probePort(port, host = '127.0.0.1', timeout = 1200) {
  return new Promise((resolve) => {
    if (!port) return resolve(false);
    const socket = new net.Socket();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

function buildCommand(site) {
  const port = String(site.port || '');
  if (site.start_command && site.start_command.trim()) {
    return {
      command: site.start_command.replaceAll('${PORT}', port).replaceAll('$PORT', port),
      cwd: site.root_path,
      builtinStatic: false,
    };
  }
  if (site.kind === 'static' || !site.kind) {
    return {
      command: null,
      cwd: site.root_path,
      builtinStatic: true,
      staticRoot: staticRootOf(site.root_path),
    };
  }
  return { command: null, cwd: site.root_path, builtinStatic: false };
}

export async function startSite(site) {
  if (isRunning(site.slug)) return { ok: true, already: true, ...processInfo(site.slug) };
  if (!fs.existsSync(site.root_path)) {
    return { ok: false, error: 'path_missing' };
  }
  if (!site.port) return { ok: false, error: 'no_port' };

  ensureWorkspace(site.slug);
  const plan = buildCommand(site);

  let child;
  const env = siteEnv(site);
  const options = {
    cwd: plan.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  };

  if (plan.builtinStatic) {
    child = spawn(process.execPath, [STATIC_SERVER, plan.staticRoot, String(site.port)], options);
  } else if (plan.command) {
    child = spawn(plan.command, { ...options, shell: true });
  } else {
    return { ok: false, error: 'no_start_command' };
  }

  const prev = running.get(site.slug);
  const state = {
    child,
    startedAt: Date.now(),
    port: site.port,
    ring: prev?.ring || [],
    restarts: prev?.restarts || 0,
  };
  running.set(site.slug, state);

  pumpStream(site.slug, child.stdout);
  pumpStream(site.slug, child.stderr);

  child.on('error', (e) => {
    appendLog(site.slug, 'error', `اجرای پروسه ناموفق بود: ${e.message}`);
    logEvent('error', 'process', `سایت ${site.name}: ${e.message}`, site.id);
    processEvents.emit('status', { slug: site.slug, running: false });
  });

  child.on('exit', (code, signal) => {
    const level = code === 0 || signal ? 'info' : 'error';
    appendLog(site.slug, level, `پروسه پایان یافت (کد ${code ?? '-'}${signal ? `, سیگنال ${signal}` : ''})`);
    if (level === 'error') {
      logEvent('error', 'process', `سایت ${site.name} با کد ${code} متوقف شد`, site.id);
    }
    processEvents.emit('status', { slug: site.slug, running: false });
  });

  appendLog(site.slug, 'info', plan.builtinStatic
    ? `اجرای سرور استاتیک روی پورت ${site.port}`
    : `اجرای دستور: ${plan.command}`);
  logEvent('info', 'process', `سایت ${site.name} اجرا شد`, site.id);
  processEvents.emit('status', { slug: site.slug, running: true });

  return { ok: true, ...processInfo(site.slug) };
}

function killTree(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    child.once('exit', done);

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      } else {
        // پروسه در گروه جدا اجرا شده؛ کل گروه را می‌بندیم تا فرزندها هم بسته شوند
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      }
    } catch { /* شاید همین حالا بسته شده */ }

    setTimeout(() => {
      try {
        if (child.exitCode === null) {
          if (process.platform === 'win32') child.kill();
          else {
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {
              child.kill('SIGKILL');
            }
          }
        }
      } catch { /* بی‌خیال */ }
      setTimeout(done, 300);
    }, 3000);
  });
}

export async function stopSite(site) {
  const state = running.get(site.slug);
  if (!state || !isRunning(site.slug)) {
    running.delete(site.slug);
    return { ok: true, already: true };
  }
  await killTree(state.child);
  running.delete(site.slug);
  logEvent('info', 'process', `سایت ${site.name} متوقف شد`, site.id);
  processEvents.emit('status', { slug: site.slug, running: false });
  return { ok: true };
}

export async function restartSite(site) {
  const prev = running.get(site.slug);
  const restarts = (prev?.restarts || 0) + 1;
  await stopSite(site);
  const res = await startSite(site);
  const state = running.get(site.slug);
  if (state) state.restarts = restarts;
  return res;
}

export async function stopAll() {
  for (const [slug, state] of [...running]) {
    await killTree(state.child);
    running.delete(slug);
  }
}

export function runningSlugs() {
  return [...running.keys()].filter(isRunning);
}
