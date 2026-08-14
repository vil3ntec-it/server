// ---------------------------------------------------------------------------
// خواندن وضعیت واقعی سیستم: CPU، RAM، دیسک، دما، مدت روشن بودن
// همه‌چیز از خودِ سیستم‌عامل خوانده می‌شود — هیچ داده‌ی نمونه‌ای در کار نیست.
// ---------------------------------------------------------------------------
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { run } from '../lib/exec.js';
import { winSample } from './win-sampler.js';

const isLinux = process.platform === 'linux';
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// ---------------------------------------------------------------------------
// CPU — از اختلاف زمان‌های تجمعی هسته‌ها
// ---------------------------------------------------------------------------
function cpuSnapshot() {
  return os.cpus().map((c) => {
    const t = c.times;
    const idle = t.idle;
    const total = t.user + t.nice + t.sys + t.irq + t.idle;
    return { idle, total };
  });
}

let prevCpu = cpuSnapshot();
let prevCpuAt = Date.now();

export function readCpu() {
  const now = cpuSnapshot();
  const cores = [];
  let idleDelta = 0;
  let totalDelta = 0;

  for (let i = 0; i < now.length; i++) {
    const p = prevCpu[i] || now[i];
    const dIdle = now[i].idle - p.idle;
    const dTotal = now[i].total - p.total;
    idleDelta += dIdle;
    totalDelta += dTotal;
    cores.push(dTotal > 0 ? Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100)) : 0);
  }

  prevCpu = now;
  prevCpuAt = Date.now();

  const usage = totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;
  const list = os.cpus();

  return {
    usage: Math.round(Math.min(100, Math.max(0, usage)) * 10) / 10,
    cores: cores.map((c) => Math.round(c * 10) / 10),
    count: list.length,
    model: list[0]?.model?.trim() || null,
    speedMhz: list[0]?.speed || null,
    loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
  };
}

// ---------------------------------------------------------------------------
// حافظه (RAM)
// ---------------------------------------------------------------------------
export async function readMemory() {
  const total = os.totalmem();
  let free = os.freemem();
  let available = free;
  let swapTotal = null;
  let swapUsed = null;

  if (isLinux) {
    try {
      const txt = await fsp.readFile('/proc/meminfo', 'utf8');
      const kv = {};
      for (const line of txt.split('\n')) {
        const m = line.match(/^(\w+):\s+(\d+)\s*kB/);
        if (m) kv[m[1]] = Number(m[2]) * 1024;
      }
      if (kv.MemAvailable != null) available = kv.MemAvailable;
      if (kv.MemFree != null) free = kv.MemFree;
      if (kv.SwapTotal != null) {
        swapTotal = kv.SwapTotal;
        swapUsed = kv.SwapTotal - (kv.SwapFree || 0);
      }
    } catch { /* از مقادیر os استفاده می‌کنیم */ }
  }

  const used = total - available;
  return {
    total,
    free,
    available,
    used,
    usage: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
    swapTotal,
    swapUsed,
  };
}

// ---------------------------------------------------------------------------
// دیسک‌ها
// ---------------------------------------------------------------------------
async function linuxMounts() {
  const out = [];
  try {
    const txt = await fsp.readFile('/proc/mounts', 'utf8');
    const seen = new Set();
    for (const line of txt.split('\n')) {
      const [dev, mount, type] = line.split(/\s+/);
      if (!dev || !mount) continue;
      if (!dev.startsWith('/dev/')) continue;
      if (['squashfs', 'iso9660'].includes(type)) continue;
      const mp = mount.replace(/\\040/g, ' ');
      if (seen.has(mp)) continue;
      seen.add(mp);
      out.push({ device: dev, mount: mp, fs: type });
    }
  } catch { /* بی‌خیال */ }
  if (!out.length) out.push({ device: null, mount: '/', fs: null });
  return out;
}

async function statfsInfo(mount) {
  try {
    const s = await fsp.statfs(mount);
    const total = s.blocks * s.bsize;
    const freeForUser = s.bavail * s.bsize;
    const used = total - s.bfree * s.bsize;
    if (!total) return null;
    return {
      total,
      free: freeForUser,
      used,
      usage: Math.round((used / total) * 1000) / 10,
    };
  } catch {
    return null;
  }
}

// فضای دیسک تقریباً ثابت است؛ خواندنش هر ۲ ثانیه فقط پردازنده را مشغول می‌کند
const DISK_CACHE_MS = 30000;
let diskCache = { at: 0, value: null };

export async function readDisks({ force = false } = {}) {
  if (!force && diskCache.value && Date.now() - diskCache.at < DISK_CACHE_MS) return diskCache.value;

  const disks = [];

  if (isWin) {
    // از نمونه‌بردارِ همیشه‌روشن خوانده می‌شود — بدون باز کردن PowerShell تازه
    const sample = winSample();
    if (sample?.disk?.length) disks.push(...sample.disk);
  } else {
    const mounts = isLinux ? await linuxMounts() : [{ device: null, mount: '/', fs: null }];
    if (isMac) {
      const r = await run('df', ['-kP']);
      if (r.ok) {
        for (const line of r.stdout.split('\n').slice(1)) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 6) continue;
          const mount = parts.slice(5).join(' ');
          if (!mount.startsWith('/')) continue;
          if (!parts[0].startsWith('/dev/')) continue;
          const total = Number(parts[1]) * 1024;
          const used = Number(parts[2]) * 1024;
          const free = Number(parts[3]) * 1024;
          if (!total) continue;
          disks.push({
            mount,
            device: parts[0],
            fs: null,
            label: null,
            total,
            free,
            used,
            usage: Math.round((used / total) * 1000) / 10,
          });
        }
      }
    } else {
      for (const m of mounts) {
        const info = await statfsInfo(m.mount);
        if (!info) continue;
        disks.push({ mount: m.mount, device: m.device, fs: m.fs, label: null, ...info });
      }
    }
  }

  // حذف تکراری‌ها (bind mount ها) بر اساس اندازه + فضای آزاد + دستگاه
  const uniq = [];
  const seen = new Set();
  for (const d of disks) {
    const key = `${d.device || ''}|${d.total}|${d.free}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(d);
  }
  uniq.sort((a, b) => b.total - a.total);

  const totals = uniq.reduce(
    (acc, d) => ({ total: acc.total + d.total, used: acc.used + d.used, free: acc.free + d.free }),
    { total: 0, used: 0, free: 0 }
  );

  const value = {
    disks: uniq,
    total: totals.total,
    used: totals.used,
    free: totals.free,
    usage: totals.total > 0 ? Math.round((totals.used / totals.total) * 1000) / 10 : 0,
  };
  // روی ویندوز تا اولین نمونهٔ سنجشگر نرسیده، نتیجهٔ خالی را کش نمی‌کنیم
  diskCache = { at: isWin && !uniq.length ? 0 : Date.now(), value };
  return value;
}

// ---------------------------------------------------------------------------
// دما — اگر سیستم پشتیبانی نکند null برمی‌گردد (چیزی از خودمان نمی‌سازیم)
// ---------------------------------------------------------------------------
async function linuxTemps() {
  const out = [];
  // thermal zones
  try {
    for (const entry of await fsp.readdir('/sys/class/thermal')) {
      if (!entry.startsWith('thermal_zone')) continue;
      try {
        const raw = await fsp.readFile(`/sys/class/thermal/${entry}/temp`, 'utf8');
        const value = Number(raw.trim()) / 1000;
        if (!Number.isFinite(value) || value <= 0 || value > 150) continue;
        let label = entry;
        try {
          label = (await fsp.readFile(`/sys/class/thermal/${entry}/type`, 'utf8')).trim() || entry;
        } catch { /* بدون برچسب */ }
        out.push({ label, celsius: Math.round(value * 10) / 10 });
      } catch { /* این zone خوانده نشد */ }
    }
  } catch { /* thermal وجود ندارد */ }

  // hwmon (بیشتر روی سرورها و لپ‌تاپ‌ها)
  if (!out.length) {
    try {
      for (const dir of await fsp.readdir('/sys/class/hwmon')) {
        const base = `/sys/class/hwmon/${dir}`;
        let chip = dir;
        try {
          chip = (await fsp.readFile(`${base}/name`, 'utf8')).trim() || dir;
        } catch { /* بدون نام */ }
        let files = [];
        try {
          files = await fsp.readdir(base);
        } catch { continue; }
        for (const f of files) {
          if (!/^temp\d+_input$/.test(f)) continue;
          try {
            const value = Number((await fsp.readFile(`${base}/${f}`, 'utf8')).trim()) / 1000;
            if (!Number.isFinite(value) || value <= 0 || value > 150) continue;
            let label = `${chip}/${f.replace('_input', '')}`;
            try {
              const l = await fsp.readFile(`${base}/${f.replace('_input', '_label')}`, 'utf8');
              if (l.trim()) label = `${chip} — ${l.trim()}`;
            } catch { /* بدون برچسب */ }
            out.push({ label, celsius: Math.round(value * 10) / 10 });
          } catch { /* رد شو */ }
        }
      }
    } catch { /* hwmon وجود ندارد */ }
  }
  return out;
}

const TEMP_CACHE_MS = 15000;
let tempCache = { at: 0, value: null };

export async function readTemperature() {
  // خواندن دما گران است (فایل‌های sysfs یا WMI)؛ هر ۱۵ ثانیه کافی است
  if (Date.now() - tempCache.at < TEMP_CACHE_MS) return tempCache.value;

  let sensors = [];
  if (isLinux) {
    sensors = await linuxTemps();
  } else if (isWin) {
    // از نمونه‌بردارِ همیشه‌روشن — بدون باز کردن PowerShell تازه
    sensors = winSample()?.temp ?? [];
  }

  const value = sensors.length
    ? {
        supported: true,
        sensors,
        max: Math.max(...sensors.map((s) => s.celsius)),
      }
    : { supported: false, sensors: [], max: null };

  tempCache = { at: Date.now(), value };
  return value;
}

// ---------------------------------------------------------------------------
// اطلاعات میزبان
// ---------------------------------------------------------------------------
export function readHost() {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    release: os.release(),
    type: os.type(),
    arch: os.arch(),
    uptimeSeconds: Math.floor(os.uptime()),
    processUptimeSeconds: Math.floor(process.uptime()),
    nodeVersion: process.version,
    bootTime: Date.now() - Math.floor(os.uptime()) * 1000,
  };
}

// پوشه‌هایی که ده‌ها هزار فایل دارند و شمردنشان فقط دیسک و پردازنده را می‌سوزاند
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', '.cache', 'vendor', '.venv']);

// اندازهٔ پوشه (واقعی) — برای «حجم فایل‌های سایت»
export async function dirSize(dir, { maxEntries = 60000 } = {}) {
  let total = 0;
  let files = 0;
  let newest = 0;
  let skipped = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      // نوعِ فایل از خودِ readdir می‌آید، پس برای هر فایل یک stat جدا لازم نیست
      entries = await fsp.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (files > maxEntries) return { bytes: total, files, newest, skipped, truncated: true };
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) {
          skipped++;
          continue;
        }
        stack.push(full);
      } else if (e.isFile()) {
        try {
          const st = await fsp.stat(full);
          total += st.size;
          files++;
          if (st.mtimeMs > newest) newest = st.mtimeMs;
        } catch { /* فایل ناپدید شد */ }
      }
    }
  }
  return { bytes: total, files, newest, skipped, truncated: false };
}

export function pathExists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}
