// ---------------------------------------------------------------------------
//  ══ خبرِ پمپ به گوشیِ بسته — پوشِ خودِ سرورِ خانگی ══════════════════════════
//
//  خواستهٔ صاحب ریپو (۱۴۰۵/۰۷/۱۳): «برنامه بسته باشه پیام میره برای کاربر؟…
//  توی برنامه ایفون و اندروید هم به خوبی تست‌شون کن.»
//
//  سنجیده شد، نه حدس زده: تا امروز **هیچ راهی** نبود. برنامهٔ کامپیوتر فهرستِ
//  خبرها را داخلِ عکسِ زنده (‎live.alerts‎) می‌گذاشت، ولی
//    • سرویس‌ورکرِ اپِ کارمندان (‎kar/sw.js‎) رویدادِ ‎push‎ نداشت، و
//    • هیچ گوشی‌ای جایی برای پوش ثبت نمی‌شد،
//  پس آیفونِ بسته هیچ‌وقت خبری نمی‌گرفت (روی آیفون کارِ پس‌زمینه‌ای جز پوش
//  نیست). این فایل همان حلقهٔ گم‌شده است:
//
//      برنامهٔ کامپیوتر ──set live──▶ دفترِ همین پمپ ──(این فایل)──▶ پوشِ مرورگر
//                                                                 ▲
//      اپِ کارمندان ──POST /api/stations/<کد>/push (رمزِ خواندن)──┘
//
//  ⛔ **فهرستِ خبر این‌جا ساخته نمی‌شود** — همان ‎StationSnapshot.Alerts‎ی
//  برنامهٔ کامپیوتر است، و کلیدِ ‎k‎ همان قاعدهٔ گیرنده‌های دیگر را دارد: هر
//  کلید یک بار، و کلیدی که از فهرست بیفتد فراموش می‌شود تا حسابِ خراب‌شدهٔ
//  دوباره ساکت نماند. دو قاعده یعنی روزی کارت سرخ است و گوشی ساکت.
//
//  ⛔ **موضوعِ پوش در به است**: رمزِ خواندن و نوشتنِ تصادفی می‌گیرد، پس از
//  درِ همگانیِ ‎/api/notify‎ نه خوانده می‌شود، نه دستگاهی رویش ثبت می‌شود، نه
//  کسی رویش پیام می‌گذارد. تنها درِ ثبت همین مسیرِ پمپ است، با رمزِ همان پمپ.
//
//  ⚠️ **پوش از راهِ سرویسِ پوشِ خودِ مرورگر می‌رود** (اپل/گوگل/موزیلا) — نه
//  سرویسِ پیام‌رسانِ بیرونی؛ همان چیزی که پیام‌رسانِ این پنل از روزِ اول دارد
//  (‎messenger/push.js‎، VAPID، بی هیچ کلیدِ بیرونی).
// ---------------------------------------------------------------------------
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as notify from '../notify/index.js';
import { vapidPublicKey } from '../messenger/push.js';

/** نامِ موضوعِ پوشِ یک پمپ. */
export function topicOf(code) {
  return notify.cleanTopic(`stn-alerts-${code}`);
}

/**
 * موضوع را می‌سازد و درش را می‌بندد (رمزِ خواندن و نوشتنِ تصادفی).
 * ⚠️ رمزی که از قبل هست دست نمی‌خورد — عوض شدنش هیچ سودی ندارد.
 */
export function ensureTopic(code, title = '') {
  const name = topicOf(code);
  if (!name) return null;
  let row = notify.ensureTopic(name, { title: title ? `خبرهای ${title}` : 'خبرهای پمپ' });
  if (!row) return null;
  if (!row.read_token) notify.setReadToken(name, crypto.randomBytes(18).toString('base64url'));
  if (!row.write_token) notify.setWriteToken(name, crypto.randomBytes(18).toString('base64url'));
  row = notify.getTopic(name);
  return row;
}

/** ثبتِ یک گوشی. ورودی همان ‎PushSubscription.toJSON()‎ی مرورگر است. */
export function register(code, subscription, label = '') {
  const sub = subscription && typeof subscription === 'object' ? subscription : {};
  if (!ensureTopic(code)) return { ok: false, error: 'invalid' };
  const r = notify.subscribeDevice(topicOf(code), {
    label: String(label || '').slice(0, 60) || null,
    endpoint: sub.endpoint,
    p256dh: sub.keys?.p256dh,
    auth: sub.keys?.auth,
  });
  return r.ok ? { ok: true, devices: notify.deviceCount(topicOf(code)) } : r;
}

export function unregister(code, endpoint) {
  return notify.unsubscribeDevice(topicOf(code), endpoint);
}

export const deviceCount = (code) => notify.deviceCount(topicOf(code));
export const publicKey = () => vapidPublicKey();

/**
 * تازه‌ها را از فهرست جدا می‌کند — **خالص**، تا آزمون بی سرور هم بسنجدش.
 *
 * @param {Array} alerts فهرستِ ‎live.alerts‎
 * @param {string[]|null} told کلیدهای خبرداده‌شده؛ ‎null‎ یعنی «هنوز هیچ‌وقت
 *   ندیده‌ایم» ⇒ خطِ پایه: هیچ خبری نمی‌رود، فقط به یاد سپرده می‌شود. وگرنه
 *   هر بار که سرور بالا می‌آمد یا پمپِ تازه ثبت می‌شد، همهٔ خبرهای کهنه یک‌جا
 *   روی گوشیِ همه می‌ریخت.
 */
export function freshAlerts(alerts, told) {
  const list = Array.isArray(alerts) ? alerts : [];
  const now = [];
  const fresh = [];
  const seen = new Set(Array.isArray(told) ? told : []);
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const k = String(a.k || '').trim();
    const t = String(a.t || '').trim();
    if (!k || !t) continue;
    now.push(k);
    if (told && !seen.has(k)) fresh.push({ k, t, s: a.s === 'out' ? 'out' : 'low' });
  }
  //  ⚠️ کلیدِ افتاده فراموش می‌شود — همان قاعدهٔ ‎k‎ی گیرنده‌های دیگر
  return { fresh, told: [...new Set(now)] };
}

/** یک پیام برای یک دسته — نه ده زنگ پشتِ سرِ هم. */
export function messageOf(fresh) {
  if (!fresh.length) return null;
  const urgent = fresh.some((f) => f.s === 'out');
  if (fresh.length === 1) {
    return { title: urgent ? '⛔ اضافه نده' : '⚠️ کم مانده', body: fresh[0].t, priority: urgent ? 5 : 4 };
  }
  return {
    title: urgent ? `⛔ ${fresh.length} خبرِ تازه — اضافه نده` : `⚠️ ${fresh.length} خبرِ تازه`,
    body: fresh.map((f) => f.t).join(' · '),
    priority: urgent ? 5 : 4,
  };
}

/**
 * نگهبانِ یک پمپ: هر بار که ‎live‎ نوشته شد صدا زده می‌شود و تازه‌ها را
 * پوش می‌کند. «کلیدهای گفته‌شده» روی دیسکِ همان پمپ می‌ماند
 * (‎alerts-told.json‎) تا بالا آمدنِ دوبارهٔ سرور خبرِ کهنه را تکرار نکند.
 */
export function createAlertPusher({ dirFor, read, log = () => {} }) {
  const timers = new Map();
  const toldOf = (code) => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dirFor(code), 'alerts-told.json'), 'utf8'));
      return Array.isArray(raw?.told) ? raw.told : null;
    } catch { return null; }
  };
  const saveTold = (code, told) => {
    try {
      fs.writeFileSync(path.join(dirFor(code), 'alerts-told.json'),
        JSON.stringify({ told, at: Date.now() }), { mode: 0o600 });
    } catch { /* دیسکِ پر پوش را نمی‌خواباند */ }
  };

  async function check(code) {
    const live = read(code);
    if (!live || typeof live !== 'object') return { sent: 0 };
    const { fresh, told } = freshAlerts(live.alerts, toldOf(code));
    saveTold(code, told);
    const msg = messageOf(fresh.slice(0, 20));
    if (!msg) return { sent: 0, fresh: 0 };
    const row = ensureTopic(code, live?.station?.name || '');
    if (!row) return { sent: 0 };
    //  ⚠️ پیام همیشه ذخیره می‌شود (تاریخچهٔ همان موضوع)، حتی بی گوشی
    const r = await notify.publish(topicOf(code), { ...msg, token: row.write_token });
    log(`خبرِ پمپِ ${code}: ${fresh.length} تازه، به ${r?.push?.sent ?? 0} گوشی`);
    return { sent: r?.push?.sent ?? 0, fresh: fresh.length };
  }

  /**
   * ⚠️ یک عکسِ زنده ده‌ها خانه را پشتِ سرِ هم می‌نویسد و `onWrite` **پیش از**
   * نشستنِ مقدار شلیک می‌شود؛ پس یک مکثِ کوتاه و یک بار برای همه.
   */
  function onLiveWrite(code, delayMs = 700) {
    if (timers.has(code)) return;
    const t = setTimeout(() => {
      timers.delete(code);
      check(code).catch(() => { /* پوش دفتر را نمی‌خواباند */ });
    }, delayMs);
    t.unref?.();
    timers.set(code, t);
  }

  return { onLiveWrite, check };
}
