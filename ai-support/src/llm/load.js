// ═══════════════════════════════════════════════════════════════════════════
//  سنجشِ بارِ سیستم
//
//  چرا os.loadavg() کافی نیست: روی ویندوز همیشه [0,0,0] برمی‌گرداند. یعنی اگر
//  فقط به آن تکیه می‌کردیم، روی ویندوز — که سرورِ خانگیِ این پروژه است — نگهبانِ
//  بار هیچ‌وقت فعال نمی‌شد و دقیقاً همان چیزی که کاربر نگرانش بود اتفاق می‌افتاد.
//
//  پس درصدِ مشغولیِ CPU را خودمان از اختلافِ زمان‌های os.cpus() می‌گیریم. یک
//  نمونه‌برداریِ سبک هر چند ثانیه، با unref تا مانعِ بسته شدنِ پروسه نشود.
// ═══════════════════════════════════════════════════════════════════════════

import os from 'node:os';

const SAMPLE_MS = 3000;

let prev = null;
let busyRatio = 0;
let timer = null;

function snapshot() {
  let idle = 0, total = 0;
  for (const cpu of os.cpus() || []) {
    for (const [k, v] of Object.entries(cpu.times)) {
      total += v;
      if (k === 'idle') idle += v;
    }
  }
  return { idle, total };
}

function sample() {
  const now = snapshot();
  if (prev && now.total > prev.total) {
    const dIdle = now.idle - prev.idle;
    const dTotal = now.total - prev.total;
    const ratio = 1 - dIdle / dTotal;
    // میانگینِ نمایی — یک اسپایکِ لحظه‌ای نباید سرویس را به حالتِ تخفیف ببرد
    busyRatio = busyRatio ? busyRatio * 0.6 + ratio * 0.4 : ratio;
  }
  prev = now;
}

export function startLoadMonitor() {
  if (timer) return;
  prev = snapshot();
  timer = setInterval(sample, SAMPLE_MS);
  timer.unref?.();
}

export function stopLoadMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
  prev = null;
  busyRatio = 0;
}

/**
 * مشغولیِ CPU بینِ ۰ و ۱.
 * از loadavg هم استفاده می‌کنیم (وقتی معنادار است) و بدبینانه‌ترین را می‌گیریم —
 * چون در تردید، «فشار نیاور» جوابِ درست است.
 */
export function cpuBusy() {
  const cores = Math.max(1, os.cpus()?.length || 1);
  const [avg1] = os.loadavg();
  const loadRatio = avg1 > 0 ? avg1 / cores : 0;
  return Math.min(1, Math.max(busyRatio, loadRatio));
}

/** حافظهٔ آزاد به‌صورت نسبت */
export function memFree() {
  const total = os.totalmem() || 1;
  return os.freemem() / total;
}

/**
 * آیا سیستم آن‌قدر شلوغ است که نباید مدل را صدا زد؟
 * @param {number} limit آستانه از پیکربندی
 */
export function isSystemBusy(limit) {
  return cpuBusy() >= limit;
}

export function loadSnapshot() {
  return {
    cpuBusy: Number(cpuBusy().toFixed(2)),
    memFree: Number(memFree().toFixed(2)),
    cores: os.cpus()?.length || 1,
  };
}
