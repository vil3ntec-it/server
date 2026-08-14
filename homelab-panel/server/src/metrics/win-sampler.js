// ---------------------------------------------------------------------------
// نمونه‌بردار ویندوز — فقط **یک** پروسهٔ PowerShell که زنده می‌ماند
//
// چرا: باز کردن PowerShell گران است (چند صد میلی‌ثانیه CPU برای هر بار).
// اگر برای هر معیار و هر چند ثانیه یک PowerShell باز کنیم، روی کامپیوتر ضعیف
// پردازنده مدام مشغول و داغ می‌شود. به‌جای آن یک پروسه باز می‌کنیم که خودش
// داخل حلقه هر چند ثانیه یک خط JSON چاپ می‌کند و ما فقط می‌خوانیم.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
while ($true) {
  $net = @(Get-NetAdapterStatistics | Select-Object ReceivedBytes, SentBytes)
  $disk = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' |
            Select-Object DeviceID, Size, FreeSpace, VolumeName, FileSystem)
  $temp = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature |
            Select-Object InstanceName, CurrentTemperature)
  $out = [PSCustomObject]@{ net = $net; disk = $disk; temp = $temp }
  $out | ConvertTo-Json -Compress -Depth 4
  [Console]::Out.Flush()
  Start-Sleep -Seconds INTERVAL
}
`;

let state = {
  started: false,
  available: null, // null = هنوز نمی‌دانیم، false = PowerShell کار نکرد
  at: 0,
  net: null,
  disk: null,
  temp: null,
};

let child = null;
let restarts = 0;

function parseLine(line) {
  let data;
  try {
    data = JSON.parse(line);
  } catch {
    return;
  }

  const netList = Array.isArray(data.net) ? data.net : data.net ? [data.net] : [];
  let rx = 0;
  let tx = 0;
  for (const a of netList) {
    rx += Number(a.ReceivedBytes || 0);
    tx += Number(a.SentBytes || 0);
  }

  const diskList = Array.isArray(data.disk) ? data.disk : data.disk ? [data.disk] : [];
  const disks = [];
  for (const d of diskList) {
    const total = Number(d.Size || 0);
    const free = Number(d.FreeSpace || 0);
    if (!total) continue;
    disks.push({
      mount: d.DeviceID,
      device: d.DeviceID,
      fs: d.FileSystem || null,
      label: d.VolumeName || null,
      total,
      free,
      used: total - free,
      usage: Math.round(((total - free) / total) * 1000) / 10,
    });
  }

  const tempList = Array.isArray(data.temp) ? data.temp : data.temp ? [data.temp] : [];
  const sensors = [];
  for (const z of tempList) {
    const celsius = Number(z.CurrentTemperature) / 10 - 273.15; // دهم کلوین
    if (!Number.isFinite(celsius) || celsius <= 0 || celsius > 150) continue;
    sensors.push({ label: String(z.InstanceName || 'ThermalZone'), celsius: Math.round(celsius * 10) / 10 });
  }

  state = {
    started: true,
    available: true,
    at: Date.now(),
    net: netList.length ? { rx, tx } : null,
    disk: disks,
    temp: sensors,
  };
}

export function startWinSampler({ intervalSeconds = 4 } = {}) {
  if (process.platform !== 'win32' || state.started) return;
  state.started = true;

  const script = SCRIPT.replace('INTERVAL', String(Math.max(2, intervalSeconds)));
  try {
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }
    );
  } catch {
    state.available = false;
    return;
  }

  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    // خروجی ConvertTo-Json فشرده است: هر نمونه یک خط
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim().startsWith('{')) parseLine(line.trim());
    }
    if (buffer.length > 200000) buffer = '';
  });

  child.on('error', () => {
    state.available = false;
  });

  child.on('exit', () => {
    child = null;
    // اگر پروسه مرد، یک‌بار دوباره تلاش می‌کنیم (نه بی‌نهایت)
    if (restarts < 3) {
      restarts++;
      state.started = false;
      setTimeout(() => startWinSampler({ intervalSeconds }), 5000).unref?.();
    } else {
      state.available = false;
    }
  });

  child.unref?.();
}

export function stopWinSampler() {
  try {
    child?.kill();
  } catch { /* بسته شده */ }
  child = null;
}

/** آخرین نمونه؛ اگر خیلی کهنه یا در دسترس نبود، null */
export function winSample() {
  if (process.platform !== 'win32') return null;
  if (state.available === false) return null;
  if (!state.at) return null;
  return state;
}

export function winSamplerReady() {
  return process.platform === 'win32' && state.available === true;
}
