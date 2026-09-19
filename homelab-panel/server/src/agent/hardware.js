// ---------------------------------------------------------------------------
//  سخت‌افزارِ همین کامپیوتر و «قوی‌ترین مدلی که می‌کِشد»
//
//  قاعدهٔ پرامپت (بخشِ ۹): با GPU → ۱۴B یا ۳۲B؛ CPU با رَمِ ۱۶ به بالا → ۷B؛
//  رَمِ ۸ → ۳B؛ کمتر → ۱.۵B. مدل باید فارسی را خوب بفهمد — Qwen2.5 اولویت.
//
//  هیچ چیزی این‌جا حدس نیست: رَم و هسته از خودِ سیستم‌عامل، کارتِ گرافیک از
//  `nvidia-smi` (اگر باشد). کارتِ AMD/Intel شناخته نمی‌شود و همان مسیرِ CPU
//  پیشنهاد می‌شود — بهتر از پیشنهادِ مدلی که بالا نمی‌آید.
// ---------------------------------------------------------------------------
import os from 'node:os';
import { run } from '../lib/exec.js';

const GB = 1024 ** 3;

/** فهرستِ مدل‌های سازگار — همه رایگان و متن‌باز، همه فارسی‌دان */
export const CATALOG = Object.freeze([
  { name: 'qwen2.5:1.5b-instruct', params: '1.5B', downloadGb: 1.0, ramGb: 4, vramGb: 2, tier: 1,
    label: 'خیلی سبک — برای کامپیوترِ ضعیف؛ جواب‌های کوتاه' },
  { name: 'qwen2.5:3b-instruct', params: '3B', downloadGb: 1.9, ramGb: 8, vramGb: 3, tier: 2,
    label: 'سبک — رَمِ ۸ گیگ؛ فارسیِ قابلِ قبول' },
  { name: 'qwen2.5:7b-instruct', params: '7B', downloadGb: 4.7, ramGb: 16, vramGb: 6, tier: 3,
    label: 'متوسط — رَمِ ۱۶ گیگ؛ فارسیِ خوب، ابزارها را درست صدا می‌زند' },
  { name: 'qwen2.5:14b-instruct', params: '14B', downloadGb: 9.0, ramGb: 32, vramGb: 12, tier: 4,
    label: 'قوی — کارتِ گرافیکِ ۱۲ گیگ یا رَمِ ۳۲ گیگ' },
  { name: 'qwen2.5:32b-instruct', params: '32B', downloadGb: 20, ramGb: 64, vramGb: 24, tier: 5,
    label: 'خیلی قوی — کارتِ گرافیکِ ۲۴ گیگ' },
]);

async function detectGpu() {
  const out = await run('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 6000 });
  if (!out.ok || !out.stdout.trim()) return [];
  return out.stdout.trim().split(/\r?\n/).map((line) => {
    const [name, mb] = line.split(',').map((s) => s.trim());
    return { vendor: 'nvidia', name: name || 'NVIDIA', vramGb: Math.round(((parseInt(mb, 10) || 0) / 1024) * 10) / 10 };
  }).filter((g) => g.name);
}

let cache = null;

/** یک بار خوانده می‌شود؛ سخت‌افزار وسطِ کار عوض نمی‌شود */
export async function detectHardware({ force = false } = {}) {
  if (cache && !force) return cache;
  const cpus = os.cpus() || [];
  const gpus = await detectGpu();
  cache = {
    platform: process.platform,
    arch: os.arch(),
    cpu: { model: cpus[0]?.model?.trim() || '', cores: cpus.length },
    ramGb: Math.round((os.totalmem() / GB) * 10) / 10,
    gpus,
    vramGb: gpus.reduce((m, g) => Math.max(m, g.vramGb || 0), 0),
  };
  return cache;
}

/** آیا این مدل روی این سخت‌افزار بالا می‌آید؟ */
export function fits(entry, hw) {
  if (hw.vramGb && hw.vramGb >= entry.vramGb) return true;
  return hw.ramGb >= entry.ramGb;
}

/**
 * قوی‌ترین مدلی که این سخت‌افزار می‌کشد، با دلیلش.
 * @returns {{model: string|null, reason: string, options: object[]}}
 */
export function recommend(hw) {
  const options = CATALOG.map((e) => ({ ...e, fits: fits(e, hw) }));
  const ok = options.filter((o) => o.fits);
  const best = ok.length ? ok[ok.length - 1] : null;
  let reason;
  if (!best) reason = `رَمِ این کامپیوتر (${hw.ramGb} گیگ) برای هیچ مدلِ محلی کافی نیست؛ دستیار بی مدل هم جواب می‌دهد، ولی از روی داده‌ها و مستندات، نه با فکر کردن.`;
  else if (hw.vramGb && hw.vramGb >= best.vramGb) reason = `کارتِ گرافیکِ ${hw.gpus[0]?.name || ''} با ${hw.vramGb} گیگ حافظه ⇒ ${best.params}`;
  else reason = `${hw.ramGb} گیگ رَم و ${hw.cpu.cores} هسته، بی کارتِ گرافیکِ شناخته‌شده ⇒ ${best.params}`;
  return { model: best?.name || null, reason, options };
}
