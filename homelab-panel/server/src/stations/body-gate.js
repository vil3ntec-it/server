// ---------------------------------------------------------------------------
//  🚦 سقفِ سراسریِ بدنه‌های بزرگِ پل (۱.۵۰.۷۹، ممیزی §۹ «بی سقفِ هم‌زمانی»)
//
//  `readCapped` (`stations/cloud.js`) هر بدنه را تا ۳۲ مگابایت نگه می‌دارد (و هنگامِ چسباندن و خواندنِ JSON تا دو برابر)،
//  ولی **چند** بدنهٔ بزرگ هم‌زمان سقف نداشت: n خواندنِ بزرگِ هم‌زمان ⇒ n × ۶۴ مگابایت.
//
//  ⛔ بودجهٔ بایت به شکلِ «جا» (slot)، نه شمارشِ تکه‌به‌تکه: خواندنی که از ‎FREE‎ (۱ مگابایت) بگذرد یک جا می‌گیرد = سهمِ کاملِ
//     یک بدنه (سقف × ۲). شمارشِ تکه‌ای بن‌بست می‌سازد: چند خواندنِ نیمه‌کاره هر کدام بخشی از بودجه را نگه می‌دارند و همه
//     منتظرِ بقیه می‌مانند تا مهلت. این‌جا دارندهٔ جا **هرگز** منتظر نمی‌ماند (فقط بایتِ سرورِ حساب را می‌خواند) ⇒ بن‌بست نیست.
//  ⛔ نبودِ جا ⇒ **صف** (به ترتیبِ رسیدن)، نه شکست. خواندنِ در صف بیش از ‎FREE‎ نگه نمی‌دارد و مهلتِ خودش سرِ جایش است
//     (مهلت ⇒ همان ‎504 account_server_timeout‎ و بیرون از صف). فقط وقتی صف از سقفِ بالا گذشت ⇒ `busy` (⇒ ‎503‎ ِ صداکننده).
//  ⛔ این سقف فقط مالِ **خواندنِ تکرارپذیر** است — صداکننده تصمیم می‌گیرد (`stations/cloud.js`): نوشتن و رسانهٔ یک‌بارمصرف
//     هرگز به این‌جا نمی‌رسند و جا هم نمی‌گیرند (پس هیچ‌کدام را پشتِ خودشان منتظر نمی‌گذارند).
// ---------------------------------------------------------------------------

/** تا این اندازه هر بدنه بی جا خوانده می‌شود — هر صفحهٔ JSON، بندانگشتی (۱۵۰ کیلوبایت) و عکسِ نمایش (۶۰۰ کیلوبایت). */
export const BODY_FREE_BYTES = 1024 * 1024;
/** جاهای هم‌زمانِ بدنهٔ بزرگ (هر جا تا ۳۲ × ۲ مگابایت). */
export const BODY_SLOTS = 4;
/** سقفِ صف — بالای بزرگ‌ترین بارِ درستِ شناخته (۵۰ اصلِ عکس در یک صفحهٔ بانک، دو مدیر با هم = ۱۰۰). */
export const BODY_QUEUE = 128;

const intEnv = (name, def, min, max) => {
  const raw = process.env[name];
  const n = Number(raw);
  return raw !== undefined && raw !== '' && Number.isInteger(n) && n >= min && n <= max ? n : def;
};

/** پیکربندی از محیط (آزمون و صاحب سامانه): ‎HLP_BRIDGE_BODY_SLOTS‎ ۱ تا ۶۴، ‎HLP_BRIDGE_BODY_QUEUE‎ ۰ تا ۴۰۹۶. */
export function bodyGateConfig() {
  return {
    slots: intEnv('HLP_BRIDGE_BODY_SLOTS', BODY_SLOTS, 1, 64),
    queue: intEnv('HLP_BRIDGE_BODY_QUEUE', BODY_QUEUE, 0, 4096),
  };
}

/** صف پر است — صداکننده به ‎503 account_server_busy‎ برش می‌گرداند. */
export class BodyGateBusy extends Error {
  constructor() { super('body gate queue full'); this.busy = true; }
}

const abortReason = (signal) => signal?.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' });

/**
 * @param {{ slots?: number, queue?: number }} [opts]
 * @returns {{ acquire(signal?: AbortSignal|null): Promise<() => void>, stats(): object }}
 *   `acquire` ⇒ تابعِ رها کردن (یک‌بارمصرف؛ بارِ دوم بی‌اثر). صفِ پر ⇒ `BodyGateBusy`؛ ‎signal‎ ِ بریده ⇒ دلیلِ همان.
 */
export function makeBodyGate({ slots = BODY_SLOTS, queue = BODY_QUEUE } = {}) {
  let inUse = 0;
  /** @type {{ grant: () => void, signal: AbortSignal|null, onAbort: (() => void)|null }[]} */
  const waiting = [];
  const counts = { granted: 0, queued: 0, busy: 0, aborted: 0, peakInUse: 0, peakWaiting: 0 };

  function releaser() {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      //  جا مستقیم به نخستینِ صف می‌رسد (‎inUse‎ همان می‌ماند) — کسی میانِ رها کردن و رسیدن جا را نمی‌قاپد
      const next = waiting.shift();
      if (next) {
        next.signal?.removeEventListener('abort', next.onAbort);
        next.grant();
      } else {
        inUse -= 1;
      }
    };
  }

  function acquire(sig = null) {
    if (sig?.aborted) return Promise.reject(abortReason(sig));
    //  فقط ‎AbortSignal‎ ِ واقعی گوش داده می‌شود (‎ctx‎ ِ پیش‌فرضِ `readBody` یک شیءِ ساده است)
    const signal = typeof sig?.addEventListener === 'function' ? sig : null;
    if (inUse < slots) {
      inUse += 1;
      counts.granted += 1;
      counts.peakInUse = Math.max(counts.peakInUse, inUse);
      return Promise.resolve(releaser());
    }
    if (waiting.length >= queue) {
      counts.busy += 1;
      return Promise.reject(new BodyGateBusy());
    }
    return new Promise((resolve, reject) => {
      const w = {
        signal,
        onAbort: null,
        grant: () => { counts.granted += 1; resolve(releaser()); },
      };
      if (signal) {
        w.onAbort = () => {
          const i = waiting.indexOf(w);
          if (i >= 0) waiting.splice(i, 1);
          counts.aborted += 1;
          reject(abortReason(signal));
        };
        signal.addEventListener('abort', w.onAbort, { once: true });
      }
      waiting.push(w);
      counts.queued += 1;
      counts.peakWaiting = Math.max(counts.peakWaiting, waiting.length);
    });
  }

  const stats = () => ({ slots, queue, inUse, waiting: waiting.length, ...counts });
  return { acquire, stats };
}
