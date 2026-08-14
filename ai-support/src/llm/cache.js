// ═══════════════════════════════════════════════════════════════════════════
//  کشِ پاسخ — ارزان‌ترین بهینه‌سازیِ ممکن
//
//  در پشتیبانی، سؤال‌ها به‌شدت تکراری‌اند: «میانبرها چیست»، «رمزم یادم نیست»،
//  «چطور پی‌دی‌اف بگیرم». اگر ده نفر همین را بپرسند، نُه بارش نباید مدل روشن شود.
//
//  کلیدِ کش از متنِ **نرمال‌شده** ساخته می‌شود، پس «میانبرها چیست؟» و «میانبر ها
//  چیست» یک کلید می‌گیرند. سطحِ دسترسی هم در کلید هست — وگرنه جوابِ مدیر ممکن
//  بود به کارمند برسد. این یک باگِ امنیتیِ کلاسیکِ کش است و عمداً بسته شده.
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'node:crypto';
import config from '../config.js';
import { tokenize } from '../rag/normalize.js';

class LruCache {
  constructor(max, ttlMs) {
    this.max = max;
    this.ttl = ttlMs;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  // کلید از **توکن‌های** نرمال‌شده ساخته می‌شود، نه از رشتهٔ نرمال‌شده. تفاوتش
  // مهم است: «میانبرها چیست؟» و «میانبر ها چیست» رشتهٔ نرمالِ متفاوت دارند
  // (نیم‌فاصله در یکی به فاصله تبدیل شده) ولی توکن‌هایشان یکی است. با کلیدِ
  // رشته‌ای، همان سؤالِ پرتکرار هر بار دوباره مدل را روشن می‌کرد.
  _key(question, level, kbVersion) {
    return crypto.createHash('sha256')
      .update(`${level}|${kbVersion}|${tokenize(question).join(' ')}`)
      .digest('hex')
      .slice(0, 32);
  }

  get(question, level, kbVersion) {
    const k = this._key(question, level, kbVersion);
    const hit = this.map.get(k);
    if (!hit) { this.misses++; return null; }
    if (Date.now() > hit.expires) { this.map.delete(k); this.misses++; return null; }
    // تازه‌ترین استفاده می‌رود ته صف (LRU با ترتیبِ درجِ Map)
    this.map.delete(k);
    this.map.set(k, hit);
    this.hits++;
    return hit.value;
  }

  set(question, level, kbVersion, value) {
    const k = this._key(question, level, kbVersion);
    if (this.map.size >= this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(k, { value, expires: Date.now() + this.ttl });
  }

  clear() { this.map.clear(); }

  snapshot() {
    const total = this.hits + this.misses;
    return {
      size: this.map.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total ? Number((this.hits / total).toFixed(2)) : 0,
    };
  }
}

export const answerCache = new LruCache(config.load.cacheSize, config.load.cacheTtlMs);
export { LruCache };
