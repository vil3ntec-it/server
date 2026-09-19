// ---------------------------------------------------------------------------
//  ══ آینهٔ ابر در پوشهٔ داده ═════════════════════════════════════════════════
//
//  خواستهٔ صاحب مخزن: «حسابِ کاربری توی سرور ذخیره می‌شه و از سرور به فولدرِ
//  خودِ سرور ثبت می‌شه یا نه؟ فولدرِ سرور جوری باشه که همه‌چی از حساب‌ها رو —
//  چه از این چه از اپِ شاپ — توی فولدر داشته باشه.»
//
//  حساب‌ها و اشتراک‌ها روی ابر (‎api.vill3n.top‎) ساخته می‌شوند، نه این‌جا.
//  این آینه هر چند وقت یک‌بار همان‌ها را از ابر می‌گیرد و در پوشهٔ داده
//  می‌نویسد:
//
//      <dataDir>/cloud/pump/stations.json · users.json · subscriptions.json
//                        · expiring.json · vip-codes.json · stats.json · plans.json
//      <dataDir>/cloud/shop/users.json · shops.json · subscriptions.json
//      <dataDir>/cloud/mirror.json       ← کِی، چه رفت، چه نرفت
//
//  پس پوشه‌ای که به کامپیوترِ دیگر می‌رود، حساب‌ها را هم با خودش دارد —
//  فقط‌خواندنی و برای نگهداری؛ منبعِ حقیقت همچنان ابر است.
//
//  ⚠️ هیچ رمزی این‌جا نمی‌نشیند: ابر در این فهرست‌ها رمز یا توکنی نمی‌دهد و
//  توکنِ مدیرِ خودِ پل در گاوصندوق می‌ماند، نه در این پوشه.
//  ⚠️ هر خطایی بلعیده می‌شود و در ‎mirror.json‎ نوشته می‌شود — ابرِ قطع نباید
//  سرورِ خانگی را بلرزاند.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { cloudCall, cloudStatus } from './cloud.js';

/** هر چند وقت یک‌بار (میلی‌ثانیه) — همان که ‎index.js‎ می‌گذارد. */
export const MIRROR_EVERY_MS = 30 * 60 * 1000;

/** چه چیزهایی، از کدام مسیر، در کدام فایل. */
export const MIRROR_PLAN = [
  { group: 'pump', file: 'stations',      name: 'stations',      query: { limit: 200 } },
  { group: 'pump', file: 'users',         name: 'users',         query: { limit: 200 } },
  { group: 'pump', file: 'subscriptions', name: 'subscriptions', query: { limit: 200 } },
  { group: 'pump', file: 'expiring',      name: 'expiring',      query: {} },
  { group: 'pump', file: 'vip-codes',     name: 'vipCodes',      query: { limit: 300 } },
  { group: 'pump', file: 'stats',         name: 'stats',         query: {} },
  { group: 'pump', file: 'plans',         name: 'plans',         query: {} },
  { group: 'shop', file: 'users',         name: 'shopUsers',     query: { limit: 200 } },
  { group: 'shop', file: 'shops',         name: 'shops',         query: { limit: 200 } },
  { group: 'shop', file: 'subscriptions', name: 'shopSubs',      query: { limit: 200 } },
];

/** پوشهٔ آینه — کنارِ ‎stations/‎، داخلِ همان پوشهٔ داده. */
export function mirrorDir(dataDir) {
  return path.join(dataDir, 'cloud');
}

/** وضعیتِ آخرین آینه (‎mirror.json‎) یا ‎null‎. */
export function readMirrorStatus(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(mirrorDir(dataDir), 'mirror.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** نوشتنِ اتمی: اول فایلِ موقت، بعد جابه‌جایی — نصفه‌نویسی روی برق‌رفتگی نماند. */
async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

/**
 * یک دورِ آینه.
 *
 * @param {object} o
 * @param {string} o.dataDir       پوشهٔ داده (نه پوشهٔ پمپ‌ها).
 * @param {Function} [o.call]      برای آزمون: جای ‎cloudCall‎.
 * @param {Function} [o.status]    برای آزمون: جای ‎cloudStatus‎.
 * @param {string} [o.reason]      ‎scheduled‎ یا ‎manual‎ — فقط برای گزارش.
 * @returns {Promise<object>} همان چیزی که در ‎mirror.json‎ می‌نشیند.
 */
export async function runMirror({ dataDir, call = cloudCall, status = cloudStatus, reason = 'scheduled' } = {}) {
  if (!dataDir) throw new Error('dataDir لازم است');
  const dir = mirrorDir(dataDir);
  const st = status();
  const report = { at: Date.now(), reason, linked: !!st.linked, base: st.base, ok: [], failed: [] };

  if (!st.linked) {
    report.skipped = 'not_linked';
    await writeJson(path.join(dir, 'mirror.json'), report);
    return report;
  }

  for (const item of MIRROR_PLAN) {
    const file = path.join(dir, item.group, `${item.file}.json`);
    try {
      const data = await call(item.name, { query: item.query });
      await writeJson(file, { at: report.at, source: item.name, data });
      report.ok.push(`${item.group}/${item.file}`);
    } catch (err) {
      //  یک مسیرِ خراب بقیه را نمی‌خواباند؛ فایلِ قبلی همان‌جا می‌ماند.
      report.failed.push({ file: `${item.group}/${item.file}`, error: String(err.message || err).slice(0, 200) });
    }
  }

  await writeJson(path.join(dir, 'mirror.json'), report);
  return report;
}

/**
 * زمان‌بندِ آینه — مثلِ بکاپِ خودکار با شمارنده، نه ساعت: سرورِ خانگی مرتب
 * خاموش و روشن می‌شود و «هر نیم ساعت از آخرین بار» با هر الگویی کار می‌کند.
 * اولین دور کمی بعد از بالا آمدن است تا وصل شدن به ابر جلوی راه‌اندازی را نگیرد.
 */
export function startMirror({ dataDir, log = () => {}, every = MIRROR_EVERY_MS } = {}) {
  let busy = false;
  const tick = async (reason) => {
    if (busy) return null;
    busy = true;
    try {
      const last = readMirrorStatus(dataDir);
      if (reason === 'scheduled' && last && Date.now() - Number(last.at || 0) < every) return null;
      const rep = await runMirror({ dataDir, reason });
      if (rep.skipped) return rep;
      log(rep.failed.length
        ? `آینهٔ سرورِ حساب: ${rep.ok.length} رفت، ${rep.failed.length} نرفت (${rep.failed.map((f) => f.file).join('، ')})`
        : `آینهٔ سرورِ حساب در پوشهٔ داده تازه شد (${rep.ok.length} فایل)`);
      return rep;
    } catch (e) {
      log(`آینهٔ سرورِ حساب ناموفق بود: ${e.message}`);
      return null;
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(() => tick('scheduled'), 20 * 1000);
  first.unref?.();
  const timer = setInterval(() => tick('scheduled'), Math.min(every, 5 * 60 * 1000));
  timer.unref?.();
  return { now: () => tick('manual'), stop: () => { clearTimeout(first); clearInterval(timer); } };
}
