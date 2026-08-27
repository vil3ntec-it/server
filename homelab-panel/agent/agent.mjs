#!/usr/bin/env node
// ---------------------------------------------------------------------------
//  Agent سرور — سبک، بدون هیچ وابستگی، فقط با Node
//
//  کارش یک چیز است: هر چند ثانیه یک‌بار وضعیتِ واقعیِ همین ماشین را برای
//  Control Center می‌فرستد. هیچ درگاهی باز نمی‌کند و هیچ دستوری از بیرون
//  نمی‌پذیرد — پس حتی اگر پنل هک شود، از این‌جا کاری از دستش برنمی‌آید.
//
//  اجرا:
//      CC_PANEL_URL=https://panel.example.com \
//      CC_SERVER_ID=srv_1a2b3c4d \
//      CC_AGENT_KEY=<کلیدی که پنل یک‌بار نشان داد> \
//      node agent.mjs
// ---------------------------------------------------------------------------
import os from 'node:os';
import fsp from 'node:fs/promises';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';

const PANEL_URL = (process.env.CC_PANEL_URL || '').replace(/\/+$/, '');
const SERVER_ID = process.env.CC_SERVER_ID || '';
const AGENT_KEY = process.env.CC_AGENT_KEY || '';
const INTERVAL = Math.max(10, Number(process.env.CC_INTERVAL || 30)) * 1000;
const INSECURE = process.env.CC_INSECURE === '1';

if (!PANEL_URL || !SERVER_ID || !AGENT_KEY) {
  console.error('❌ CC_PANEL_URL و CC_SERVER_ID و CC_AGENT_KEY لازم‌اند.');
  console.error('   این سه مقدار را در صفحهٔ «سرورها» ی پنل، هنگام ساختنِ کلیدِ Agent می‌بینید.');
  process.exit(1);
}

if (INSECURE) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/* --------------------------- ابزارهای کوچک ----------------------------- */

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : String(stdout || ''));
    });
  });
}

function tcpOpen(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port: Number(port), timeout });
    const done = (ok) => {
      try {
        socket.destroy();
      } catch { /* بسته شد */ }
      resolve({ ok, ms: Date.now() - started });
    };
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

/* ------------------------------ پردازنده ------------------------------- */

let lastCpu = null;

function cpuSnapshot() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    for (const [key, value] of Object.entries(c.times)) {
      total += value;
      if (key === 'idle') idle += value;
    }
  }
  return { idle, total, cores: cpus.length, model: cpus[0]?.model?.trim() || null, speed: cpus[0]?.speed || null };
}

function cpuUsage() {
  const snap = cpuSnapshot();
  let usage = null;
  if (lastCpu) {
    const idleDiff = snap.idle - lastCpu.idle;
    const totalDiff = snap.total - lastCpu.total;
    if (totalDiff > 0) usage = Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
  }
  lastCpu = snap;
  return { usage, cores: snap.cores, model: snap.model, speed: snap.speed, load: os.loadavg() };
}

/* -------------------------------- دیسک --------------------------------- */

async function storage() {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress",
    ]);
    if (!out) return [];
    try {
      const parsed = JSON.parse(out);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list
        .filter((d) => Number(d.Size) > 0)
        .map((d) => {
          const total = Number(d.Size);
          const free = Number(d.FreeSpace);
          return {
            mount: d.DeviceID,
            total,
            free,
            used: total - free,
            usage: Math.round(((total - free) / total) * 100),
          };
        });
    } catch {
      return [];
    }
  }

  const out = await run('df', ['-kP']);
  if (!out) return [];
  const rows = [];
  for (const line of out.trim().split('\n').slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const [filesystem, blocks, used, available, , mount] = parts;
    if (/^(tmpfs|devtmpfs|overlay|squashfs|udev)$/.test(filesystem)) continue;
    if (mount.startsWith('/snap') || mount.startsWith('/sys') || mount.startsWith('/proc')) continue;
    const total = Number(blocks) * 1024;
    if (!total) continue;
    rows.push({
      mount,
      filesystem,
      total,
      used: Number(used) * 1024,
      free: Number(available) * 1024,
      usage: Math.round((Number(used) / (Number(used) + Number(available) || 1)) * 100),
    });
  }
  return rows.slice(0, 12);
}

/* ------------------------------- شبکه ---------------------------------- */

let lastNet = null;

async function network() {
  const addresses = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.internal) continue;
      addresses.push({ name, address: item.address, family: item.family, mac: item.mac });
    }
  }

  let rx = null;
  let tx = null;
  if (process.platform === 'linux') {
    try {
      const dev = await fsp.readFile('/proc/net/dev', 'utf8');
      let totalRx = 0;
      let totalTx = 0;
      for (const line of dev.split('\n').slice(2)) {
        const [iface, rest] = line.split(':');
        if (!rest || /^\s*lo\s*$/.test(iface)) continue;
        const cols = rest.trim().split(/\s+/).map(Number);
        totalRx += cols[0] || 0;
        totalTx += cols[8] || 0;
      }
      const now = Date.now();
      if (lastNet) {
        const seconds = (now - lastNet.at) / 1000;
        if (seconds > 0) {
          rx = Math.max(0, Math.round((totalRx - lastNet.rx) / seconds));
          tx = Math.max(0, Math.round((totalTx - lastNet.tx) / seconds));
        }
      }
      lastNet = { rx: totalRx, tx: totalTx, at: now };
    } catch { /* در دسترس نبود */ }
  }

  return { addresses, rxBytesPerSec: rx, txBytesPerSec: tx };
}

/* ----------------------------- زمانِ اجرا ------------------------------ */

async function runtimes() {
  const [pg, docker, nginx] = await Promise.all([
    run('psql', ['--version'], 4000),
    run('docker', ['--version'], 4000),
    run('nginx', ['-v'], 4000),
  ]);
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    postgres: pg ? pg.trim().split('\n')[0] : null,
    docker: docker ? docker.trim() : null,
    nginx: nginx ? nginx.trim() : null,
  };
}

/* --------------------------- سرویس‌ها و سلامت --------------------------- */

/** CC_SERVICES="api:3000,websocket:4701,postgres:5432" */
async function services() {
  const spec = String(process.env.CC_SERVICES || '').trim();
  if (!spec) return [];
  const items = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
  const out = [];
  for (const item of items) {
    const [name, portRaw, hostRaw] = item.split(':');
    const port = Number(portRaw);
    if (!Number.isFinite(port)) continue;
    const host = hostRaw || '127.0.0.1';
    const res = await tcpOpen(host, port);
    out.push({ name: name || `port-${port}`, host, port, status: res.ok ? 'online' : 'offline', latencyMs: res.ms });
  }
  return out;
}

/** CC_HEALTH_HTTP و CC_HEALTH_WS — آدرس‌هایی که Agent باید بسنجد */
async function health() {
  const out = {};
  const httpUrl = process.env.CC_HEALTH_HTTP;
  if (httpUrl) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(httpUrl, { signal: controller.signal, redirect: 'manual' });
      clearTimeout(timer);
      out.http = { url: httpUrl, status: res.status < 500 ? 'online' : 'offline', code: res.status, latencyMs: Date.now() - started };
    } catch (e) {
      out.http = { url: httpUrl, status: e.name === 'AbortError' ? 'timeout' : 'connection_error', code: null, latencyMs: Date.now() - started };
    }
  }

  const wsUrl = process.env.CC_HEALTH_WS;
  if (wsUrl) {
    // بدونِ کتابخانه: خودِ دست‌دادنِ WebSocket با یک سوکتِ خام
    out.ws = await wsHandshake(wsUrl);
  }

  const tunnelPort = process.env.CC_TUNNEL_PORT;
  if (tunnelPort) {
    const res = await tcpOpen('127.0.0.1', Number(tunnelPort));
    out.tunnel = { port: Number(tunnelPort), status: res.ok ? 'online' : 'offline', latencyMs: res.ms };
  }

  return Object.keys(out).length ? out : null;
}

/** دست‌دادنِ WebSocket با سوکتِ خام — فقط برای دانستنِ «بالاست یا نه» */
function wsHandshake(url, timeout = 6000) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve({ url, status: 'unknown', error: 'invalid_url' });
    }
    const secure = target.protocol === 'wss:';
    const port = Number(target.port) || (secure ? 443 : 80);
    const started = Date.now();
    const key = crypto.randomBytes(16).toString('base64');
    const request =
      `GET ${target.pathname}${target.search} HTTP/1.1\r\n` +
      `Host: ${target.hostname}\r\n` +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`;

    const finish = (v) => {
      try {
        socket.destroy();
      } catch { /* بسته شد */ }
      resolve({ url, latencyMs: Date.now() - started, ...v });
    };

    const onConnect = () => socket.write(request);
    const socket = secure
      ? tls.connect(
          { host: target.hostname, port, servername: target.hostname, timeout, rejectUnauthorized: !INSECURE },
          onConnect
        )
      : net.createConnection({ host: target.hostname, port, timeout }, onConnect);

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      if (!buffer.includes('\r\n\r\n')) return;
      const statusLine = buffer.split('\r\n')[0] || '';
      const code = Number(statusLine.split(' ')[1]);
      finish({
        status: code === 101 ? 'online' : code === 401 || code === 403 ? 'unauthorized' : 'offline',
        code: Number.isFinite(code) ? code : null,
      });
    });
    socket.on('timeout', () => finish({ status: 'timeout', code: null }));
    socket.on('error', (e) => finish({ status: 'connection_error', code: null, error: e.code || e.message }));
  });
}

/* ------------------------------ ارسال ---------------------------------- */

async function buildReport() {
  const [disk, net, rt, svc, hl] = await Promise.all([storage(), network(), runtimes(), services(), health()]);
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    os: {
      platform: process.platform,
      type: os.type(),
      release: os.release(),
      hostname: os.hostname(),
      arch: os.arch(),
    },
    uptime: Math.round(os.uptime()),
    cpu: cpuUsage(),
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      usage: totalMem ? Math.round(((totalMem - freeMem) / totalMem) * 100) : null,
    },
    storage: disk,
    network: net,
    runtimes: rt,
    services: svc,
    health: hl,
    agent: { version: '1.0.0', interval: INTERVAL / 1000, pid: process.pid },
  };
}

async function send(report) {
  const body = JSON.stringify(report);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', AGENT_KEY).update(`${timestamp}.${body}`).digest('hex');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${PANEL_URL}/api/control/agent/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-agent-server': SERVER_ID,
        'x-agent-timestamp': String(timestamp),
        'x-agent-signature': signature,
      },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`⚠️  پنل گزارش را نپذیرفت (${res.status}): ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`⚠️  ارسالِ گزارش ناموفق بود: ${e.message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let stopping = false;

async function loop() {
  cpuUsage(); // نمونهٔ اول تا درصدِ پردازنده از دورِ دوم درست باشد
  console.log(`✅ Agent بالا آمد — سرور ${SERVER_ID}، هر ${INTERVAL / 1000} ثانیه به ${PANEL_URL}`);
  while (!stopping) {
    try {
      const report = await buildReport();
      const ok = await send(report);
      if (ok && process.env.CC_VERBOSE === '1') {
        console.log(`[${new Date().toISOString()}] گزارش رفت — CPU ${report.cpu.usage}٪، RAM ${report.memory.usage}٪`);
      }
    } catch (e) {
      console.error(`⚠️  ساختِ گزارش ناموفق بود: ${e.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL));
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    console.log('\nAgent خاموش شد.');
    process.exit(0);
  });
}

loop();
