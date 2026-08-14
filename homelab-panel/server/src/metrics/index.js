// ---------------------------------------------------------------------------
// جمع‌آوری دوره‌ای معیارها + تاریخچهٔ کوتاه‌مدت (برای نمودارهای زنده)
// ---------------------------------------------------------------------------
import { readCpu, readMemory, readDisks, readTemperature, readHost } from './system.js';
import { readThroughput, readNetwork, readInterfaces, readPing, readGateway, readPublicIp } from './network.js';
import { config } from '../config.js';

const HISTORY = 180; // حدود ۶ دقیقه با بازهٔ ۲ ثانیه
const history = [];

let latest = null;

export async function collect() {
  const [memory, disk, temperature, throughput] = await Promise.all([
    readMemory(),
    readDisks(),
    readTemperature(),
    readThroughput(),
  ]);
  const cpu = readCpu();
  const host = readHost();

  const snapshot = {
    at: Date.now(),
    cpu,
    memory,
    disk,
    temperature,
    network: throughput,
    host,
  };

  latest = snapshot;
  history.push({
    at: snapshot.at,
    cpu: cpu.usage,
    memory: memory.usage,
    disk: disk.usage,
    rx: throughput.rxBytesPerSec,
    tx: throughput.txBytesPerSec,
    temp: temperature.max,
  });
  if (history.length > HISTORY) history.shift();

  return snapshot;
}

export function getLatest() {
  return latest;
}

export function getHistory() {
  return history.slice();
}

// ---------------------------------------------------------------------------
// چرخهٔ جمع‌آوری — «حالت بی‌کار»
//
// وقتی هیچ مرورگری پنل را باز نکرده (یا همهٔ تب‌ها پشت‌زمینه‌اند)، جمع‌آوری هر ۲
// ثانیه هیچ فایده‌ای ندارد و فقط پردازنده را مشغول نگه می‌دارد. در آن حالت خودکار
// به ۳۰ ثانیه می‌رود و به‌محض باز شدن پنل دوباره سریع می‌شود.
// ---------------------------------------------------------------------------
const IDLE_INTERVAL_MS = 30000;

let timer = null;
let tickFn = null;
let currentInterval = 0;
let viewers = 0;

function schedule(intervalMs) {
  if (timer && currentInterval === intervalMs) return;
  if (timer) clearInterval(timer);
  currentInterval = intervalMs;
  timer = setInterval(tickFn, intervalMs);
  timer.unref?.();
}

function desiredInterval() {
  return viewers > 0 ? config.metricsIntervalMs : Math.max(IDLE_INTERVAL_MS, config.metricsIntervalMs);
}

export function startCollector(onTick) {
  if (timer) return;
  tickFn = async () => {
    try {
      const snap = await collect();
      onTick?.(snap);
    } catch { /* یک چرخهٔ ناموفق نباید سرور را بخواباند */ }
  };
  tickFn();
  schedule(desiredInterval());
}

/** تعداد پنل‌های واقعاً باز — از realtime.js صدا زده می‌شود */
export function setViewers(n) {
  const next = Math.max(0, n | 0);
  if (next === viewers) return;
  const wasIdle = viewers === 0;
  viewers = next;
  if (!tickFn) return;
  schedule(desiredInterval());
  // تازه یک نفر پنل را باز کرد: فوراً یک نمونهٔ تازه بگیر تا منتظر نماند
  if (wasIdle && viewers > 0) tickFn();
}

export function collectorStatus() {
  return { viewers, intervalMs: currentInterval, idle: viewers === 0 };
}

export function stopCollector() {
  if (timer) clearInterval(timer);
  timer = null;
  tickFn = null;
  currentInterval = 0;
}

export { readNetwork, readInterfaces, readPing, readGateway, readPublicIp };
