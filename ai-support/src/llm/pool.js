// ═══════════════════════════════════════════════════════════════════════════
//  صف و کنترلِ بار — این فایل همان چیزی است که نمی‌گذارد کامپیوتر داغ کند
//
//  چهار قاعده، به ترتیبِ اجرا:
//    ۱) اگر سیستم از قبل شلوغ است → اصلاً وارد صف نشو. جوابِ استخراجی بده.
//    ۲) اگر صف پر است → منتظر نگذار. جوابِ استخراجی بده.
//    ۳) هر لحظه فقط `maxConcurrent` تولید (روی کامپیوترِ خانگی: یکی).
//    ۴) اگر انتظار از حدی گذشت → بی‌خیالِ صف. جوابِ استخراجی بده.
//
//  در هر چهار حالت **کاربر جواب می‌گیرد** — فقط جوابِ ساده‌تر. این تفاوتِ بینِ
//  «سرویسِ کند» و «سرویسِ خراب» است.
// ═══════════════════════════════════════════════════════════════════════════

import config from '../config.js';
import { isSystemBusy, loadSnapshot } from './load.js';

export class OverloadedError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'OverloadedError';
    this.code = 'OVERLOADED';
    this.degrade = true;   // یعنی: به‌جای خطا، جوابِ بدونِ مدل بده
  }
}

class Pool {
  constructor(cfg = config) {
    this.cfg = cfg;
    this.active = 0;
    this.queue = [];
    this.stats = { served: 0, shed: 0, timedOut: 0, peakQueue: 0 };
  }

  get depth() { return this.queue.length; }

  /**
   * @param {Function} fn کارِ اصلی (فراخوانیِ مدل)
   * @param {{bypassLoadCheck?: boolean}} opts
   */
  async run(fn, { bypassLoadCheck = false } = {}) {
    const { maxConcurrent, maxQueue, queueTimeoutMs, loadLimit } = this.cfg.load;

    // قاعدهٔ ۱ — نگهبانِ بار. فقط وقتی چیزی در صف نیست معنی دارد که سخت‌گیر
    // باشیم؛ اگر خودمان مشغولِ تولیدیم، بالا بودنِ CPU طبیعی است و نباید باعثِ
    // ردِ نفرِ بعدی شود.
    if (!bypassLoadCheck && this.active === 0 && isSystemBusy(loadLimit)) {
      this.stats.shed++;
      throw new OverloadedError('کامپیوتر همین حالا مشغولِ کارِ دیگری است');
    }

    // قاعدهٔ ۲
    if (this.queue.length >= maxQueue) {
      this.stats.shed++;
      throw new OverloadedError('صفِ پرسش‌ها پر است');
    }

    // قاعدهٔ ۳
    if (this.active >= maxConcurrent) {
      await this._waitTurn(queueTimeoutMs);
    }

    this.active++;
    try {
      const out = await fn();
      this.stats.served++;
      return out;
    } finally {
      this.active--;
      this._next();
    }
  }

  _waitTurn(timeoutMs) {
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        const i = this.queue.indexOf(entry);
        if (i >= 0) this.queue.splice(i, 1);
        this.stats.timedOut++;
        reject(new OverloadedError('انتظار در صف طولانی شد'));
      }, timeoutMs);
      entry.timer.unref?.();
      this.queue.push(entry);
      this.stats.peakQueue = Math.max(this.stats.peakQueue, this.queue.length);
    });
  }

  _next() {
    if (this.active >= this.cfg.load.maxConcurrent) return;
    const entry = this.queue.shift();
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.resolve();
  }

  snapshot() {
    return {
      active: this.active,
      queued: this.queue.length,
      ...this.stats,
      system: loadSnapshot(),
    };
  }
}

export const llmPool = new Pool();
export { Pool };
