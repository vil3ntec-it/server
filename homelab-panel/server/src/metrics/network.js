// ---------------------------------------------------------------------------
// شبکه: IP داخلی/عمومی، MAC، Gateway، پینگ و سرعت واقعی دانلود/آپلود کارت شبکه
// ---------------------------------------------------------------------------
import os from 'node:os';
import net from 'node:net';
import fsp from 'node:fs/promises';
import https from 'node:https';
import http from 'node:http';
// powershell فقط برای Gateway استفاده می‌شود که هر ۵ دقیقه یک‌بار خوانده می‌شود
import { run, powershell } from '../lib/exec.js';
import { winSample } from './win-sampler.js';
import { config } from '../config.js';

const isLinux = process.platform === 'linux';
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// ---------------------------------------------------------------------------
// کارت‌های شبکه: IP داخلی + MAC
// ---------------------------------------------------------------------------
export function readInterfaces() {
  const ifaces = os.networkInterfaces();
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const ni of list || []) {
      if (ni.internal) continue;
      if (ni.family !== 'IPv4' && ni.family !== 4) continue;
      out.push({
        name,
        address: ni.address,
        netmask: ni.netmask,
        mac: ni.mac && ni.mac !== '00:00:00:00:00:00' ? ni.mac : null,
        cidr: ni.cidr,
      });
    }
  }
  // آی‌پی‌های خانگی معمول اول
  out.sort((a, b) => Number(b.address.startsWith('192.168.')) - Number(a.address.startsWith('192.168.')));
  return out;
}

export function primaryInterface() {
  return readInterfaces()[0] || null;
}

export function internalIp() {
  return primaryInterface()?.address || null;
}

export function lanAddresses() {
  return readInterfaces().map((i) => i.address);
}

// ---------------------------------------------------------------------------
// سرعت لحظه‌ای شبکه — اختلاف بایت‌های ارسال/دریافت کارت شبکه
// ---------------------------------------------------------------------------
async function counters() {
  // خروجی: { rx, tx } به بایت (مجموع کارت‌های غیر لوپ‌بک)
  if (isLinux) {
    try {
      const txt = await fsp.readFile('/proc/net/dev', 'utf8');
      let rx = 0;
      let tx = 0;
      for (const line of txt.split('\n').slice(2)) {
        const [nameRaw, rest] = line.split(':');
        if (!rest) continue;
        const name = nameRaw.trim();
        if (name === 'lo' || name.startsWith('veth') || name.startsWith('docker') || name.startsWith('br-')) continue;
        const f = rest.trim().split(/\s+/).map(Number);
        rx += f[0] || 0;
        tx += f[8] || 0;
      }
      return { rx, tx };
    } catch {
      return null;
    }
  }

  if (isWin) {
    // از نمونه‌بردارِ همیشه‌روشن خوانده می‌شود، نه با باز کردن PowerShell تازه
    const sample = winSample();
    return sample?.net ?? null;
  }

  if (isMac) {
    const r = await run('netstat', ['-ibn']);
    if (!r.ok) return null;
    let rx = 0;
    let tx = 0;
    const seen = new Set();
    for (const line of r.stdout.split('\n').slice(1)) {
      const p = line.trim().split(/\s+/);
      if (p.length < 10) continue;
      const name = p[0];
      if (name === 'lo0' || seen.has(name)) continue;
      seen.add(name);
      rx += Number(p[6]) || 0;
      tx += Number(p[9]) || 0;
    }
    return { rx, tx };
  }

  return null;
}

let prevCounters = null;
let prevCountersAt = 0;

export async function readThroughput() {
  const now = await counters();
  const at = Date.now();
  if (!now) {
    return { supported: false, rxBytesPerSec: null, txBytesPerSec: null, totalRx: null, totalTx: null };
  }
  let rxRate = 0;
  let txRate = 0;
  if (prevCounters && at > prevCountersAt) {
    const dt = (at - prevCountersAt) / 1000;
    rxRate = Math.max(0, (now.rx - prevCounters.rx) / dt);
    txRate = Math.max(0, (now.tx - prevCounters.tx) / dt);
  }
  prevCounters = now;
  prevCountersAt = at;
  return {
    supported: true,
    rxBytesPerSec: Math.round(rxRate),
    txBytesPerSec: Math.round(txRate),
    totalRx: now.rx,
    totalTx: now.tx,
  };
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------
let gatewayCache = { at: 0, value: null };

export async function readGateway() {
  if (Date.now() - gatewayCache.at < 5 * 60 * 1000) return gatewayCache.value;
  let gw = null;

  if (isLinux) {
    try {
      const txt = await fsp.readFile('/proc/net/route', 'utf8');
      for (const line of txt.split('\n').slice(1)) {
        const f = line.trim().split(/\s+/);
        if (f.length < 3) continue;
        if (f[1] !== '00000000') continue; // مقصد پیش‌فرض
        const hex = f[2];
        const b = hex.match(/../g).reverse().map((h) => parseInt(h, 16));
        if (b.length === 4) {
          gw = b.join('.');
          break;
        }
      }
    } catch { /* بی‌خیال */ }
  } else if (isWin) {
    const r = await powershell(
      "(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop"
    );
    if (r.ok) {
      const v = r.stdout.trim();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) gw = v;
    }
  } else if (isMac) {
    const r = await run('route', ['-n', 'get', 'default']);
    if (r.ok) {
      const m = r.stdout.match(/gateway:\s*([0-9.]+)/);
      if (m) gw = m[1];
    }
  }

  gatewayCache = { at: Date.now(), value: gw };
  return gw;
}

// ---------------------------------------------------------------------------
// پینگ — زمان برقراری اتصال TCP (بدون نیاز به دستور ping و بدون دسترسی ویژه)
// ---------------------------------------------------------------------------
export function tcpPing(hostPort, timeout = 3000) {
  const [host, portStr] = String(hostPort).split(':');
  const port = Number(portStr || 443);
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const socket = new net.Socket();
    let done = false;
    const finish = (ms) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ms);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      finish(Math.round(ms * 10) / 10);
    });
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
    socket.connect(port, host);
  });
}

let pingCache = { at: 0, value: null };

export async function readPing() {
  if (Date.now() - pingCache.at < 20000) return pingCache.value;
  const ms = await tcpPing(config.pingTarget);
  pingCache = { at: Date.now(), value: { target: config.pingTarget, ms } };
  return pingCache.value;
}

// ---------------------------------------------------------------------------
// IP عمومی — اگر اینترنت نبود null (چیزی از خودمان نمی‌سازیم)
// ---------------------------------------------------------------------------
let publicIpCache = { at: 0, value: null };

function fetchText(url, timeout = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    try {
      const mod = url.startsWith('https:') ? https : http;
      const req = mod.get(url, { timeout }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return done(null);
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          body += c;
          if (body.length > 4096) req.destroy();
        });
        res.on('end', () => done(body));
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => done(null));
    } catch {
      done(null);
    }
  });
}

export async function readPublicIp({ force = false } = {}) {
  if (!force && Date.now() - publicIpCache.at < 5 * 60 * 1000) return publicIpCache.value;
  const body = await fetchText(config.publicIpUrl);
  let ip = null;
  if (body) {
    const trimmed = body.trim();
    if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
      ip = trimmed;
    } else {
      try {
        const j = JSON.parse(trimmed);
        if (typeof j.ip === 'string') ip = j.ip;
      } catch { /* پاسخ قابل‌فهم نبود */ }
    }
  }
  publicIpCache = { at: Date.now(), value: ip };
  return ip;
}

// ---------------------------------------------------------------------------
// خلاصهٔ کامل شبکه (برای صفحهٔ «شبکه»)
// ---------------------------------------------------------------------------
export async function readNetwork() {
  const [throughput, gateway, ping, publicIp] = await Promise.all([
    readThroughput(),
    readGateway(),
    readPing(),
    readPublicIp(),
  ]);
  const interfaces = readInterfaces();
  return {
    interfaces,
    primary: interfaces[0] || null,
    internalIp: interfaces[0]?.address || null,
    mac: interfaces[0]?.mac || null,
    gateway,
    publicIp,
    ping,
    throughput,
  };
}
