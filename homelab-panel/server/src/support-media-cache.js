// ---------------------------------------------------------------------------
//  رسانهٔ پشتیبانیِ پمپ — نسخهٔ مدیر روی دیسکِ همین کامپیوتر
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۵): «عکس، صدا و ویدیو در پشتیبانی برود…
//  ولی روی سرور نماند — سرور فقط به طرفِ دیگر می‌رساند و هر طرف روی
//  دستگاهِ خودش نگه می‌دارد. نه سرور سنگین شود، نه برنامه.»
//
//      سرورِ حساب ──(GET یک‌بارمصرف: پس از رسیدن پاک)──▶ همین پوشه ──▶ مرورگرِ مدیر
//      مدیر ──(POST)──▶ سرورِ حساب   و همان بایت‌ها ──▶ همین پوشه
//
//  قاعده‌ها:
//  ⛔ **پیش از هر درخواست به سرورِ حساب، اول همین پوشه.** رسانه‌ای که یک
//     بار آمد، آن‌طرف دیگر نیست؛ درخواستِ دوم فقط ۴۰۴ِ ‎media_gone‎ می‌گیرد.
//  ⛔ **یک رسانه، یک دانلود** (`fetchOnce`): تگِ ‎<video>‎ دو درخواستِ هم‌زمان
//     می‌زند؛ بی این، دومی رسانه را «رفته» می‌دید.
//  ⛔ **این هم بایگانی نیست**: فایلِ کهنه‌تر از ‎KEEP_DAYS‎ می‌رود و کلِ پوشه
//     از ‎MAX_BYTES‎ بالاتر نمی‌رود (کهنه‌ترها اول). پاک‌سازی ارزان است و
//     فقط هنگامِ نوشتن، حداکثر ساعتی یک بار، می‌دود — بی هیچ زمان‌سنجی.
//  ⚠️ نامِ فایل همان شناسهٔ رسانه است و فقط ‎[A-Za-z0-9_-]‎ — هیچ مسیری از
//     ورودی ساخته نمی‌شود.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

export const KEEP_DAYS = 15;
const DAY = 24 * 3600 * 1000;
export const MAX_BYTES = Math.max(50, Number(process.env.HLP_SUPPORT_MEDIA_MAX_MB) || 1024) * 1024 * 1024;
const SWEEP_EVERY = 3600 * 1000;

export function cacheDir() {
  return path.join(config.dataDir, 'support-media');
}

const safeId = (mid) => /^[A-Za-z0-9_-]{1,80}$/.test(String(mid || ''));
const fileOf = (mid) => path.join(cacheDir(), String(mid));
const metaOf = (mid) => path.join(cacheDir(), `${mid}.json`);

/** نسخهٔ روی دیسک، یا ‎null‎. */
export async function readCached(mid) {
  if (!safeId(mid)) return null;
  try {
    const meta = JSON.parse(await fsp.readFile(metaOf(mid), 'utf8'));
    const st = await fsp.stat(fileOf(mid));
    if (!st.isFile() || st.size !== Number(meta.size)) return null;
    return { file: fileOf(mid), mime: String(meta.mime || 'application/octet-stream'), size: st.size };
  } catch {
    return null;
  }
}

/** نوشتن — اتمی: اول فایلِ موقت، بعد جابه‌جایی؛ فراداده آخر. */
export async function writeCached(mid, buffer, mime) {
  if (!safeId(mid) || !Buffer.isBuffer(buffer)) return null;
  await fsp.mkdir(cacheDir(), { recursive: true });
  const tmp = `${fileOf(mid)}.${process.pid}.${Date.now()}.part`;
  await fsp.writeFile(tmp, buffer);
  await fsp.rename(tmp, fileOf(mid));
  const meta = { mime: String(mime || 'application/octet-stream').split(';')[0].trim().slice(0, 80), size: buffer.length, at: Date.now() };
  await fsp.writeFile(metaOf(mid), JSON.stringify(meta));
  maybeSweep();
  return { file: fileOf(mid), mime: meta.mime, size: buffer.length };
}

const inflight = new Map();

/**
 * از دیسک، وگرنه **یک** دانلود از سرورِ حساب (که آن‌جا پاکش می‌کند) و
 * نوشتن روی دیسک. ‎download(mid)‎ ⇒ ‎{ buffer, contentType }‎.
 */
export async function fetchOnce(mid, download) {
  const hit = await readCached(mid);
  if (hit) return hit;
  if (inflight.has(mid)) return inflight.get(mid);
  const job = (async () => {
    try {
      const { buffer, contentType } = await download(mid);
      return await writeCached(mid, buffer, contentType);
    } finally {
      inflight.delete(mid);
    }
  })();
  inflight.set(mid, job);
  return job;
}

let lastSweep = 0;
function maybeSweep() {
  const t = Date.now();
  if (t - lastSweep < SWEEP_EVERY) return;
  lastSweep = t;
  sweepCache().catch((err) => console.error('[support-media]', err.message));
}

/**
 * پاک‌سازی: کهنه‌تر از ‎KEEP_DAYS‎ می‌رود، و اگر کلِ پوشه از ‎MAX_BYTES‎
 * بالاتر بود کهنه‌ترها تا زیرِ سقف. خروجی: ‎{ removed, bytes }‎.
 */
export async function sweepCache({ at = Date.now(), maxBytes = MAX_BYTES } = {}) {
  let names;
  try { names = await fsp.readdir(cacheDir()); } catch { return { removed: 0, bytes: 0 }; }
  const items = [];
  for (const n of names) {
    if (n.endsWith('.json') || n.endsWith('.part')) {
      //  فایلِ موقتِ نیمه‌کاره از یک ساعت پیش: مالِ نوشتنی است که هرگز تمام نشد
      if (n.endsWith('.part')) {
        const st = await fsp.stat(path.join(cacheDir(), n)).catch(() => null);
        if (st && at - st.mtimeMs > 3600e3) await fsp.rm(path.join(cacheDir(), n), { force: true });
      }
      continue;
    }
    if (!safeId(n)) continue;
    const st = await fsp.stat(fileOf(n)).catch(() => null);
    if (!st) continue;
    let when = st.mtimeMs;
    try { when = Number(JSON.parse(fs.readFileSync(metaOf(n), 'utf8')).at) || when; } catch { /* بی فراداده */ }
    items.push({ mid: n, size: st.size, at: when });
  }
  items.sort((a, b) => a.at - b.at);
  let total = items.reduce((s, x) => s + x.size, 0);
  let removed = 0;
  for (const x of items) {
    const old = at - x.at > KEEP_DAYS * DAY;
    if (!old && total <= maxBytes) continue;
    await fsp.rm(fileOf(x.mid), { force: true });
    await fsp.rm(metaOf(x.mid), { force: true });
    total -= x.size;
    removed += 1;
  }
  return { removed, bytes: total };
}
