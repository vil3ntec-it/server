// ---------------------------------------------------------------------------
//  آپلودِ خام با سقفِ واقعی — ۱.۵۰.۸۲ (بازبینیِ خصمانه)
//
//  ⛔ تا ۱.۵۰.۸۱ مسیرهای آپلودِ خام (`/api/files/upload`، `/api/settings/logo`)
//  فقط سرآیندِ `content-length` را می‌سنجیدند و بعد با `pipeline(req, …)` بی‌سقف
//  روی دیسک می‌ریختند. درخواستِ `Transfer-Encoding: chunked` (یا هر درخواستی که
//  `content-length` نفرستد) از آن سنجش رد می‌شد: `Number(undefined||0)=0`، و
//  `0 > max` نادرست — پس یک کاربرِ operator می‌توانست پرونده‌ای بزرگ‌تر از سقف،
//  حتی تا پر شدنِ دیسک، بنویسد. سقفِ واقعی شمارشِ بایت در جریان است، نه باورِ
//  سرآیند. همان درسِ `account/bridge-body.js` (۱.۵۰.۷۷) برای درهای آپلودِ محلی.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';

/**
 * بدنهٔ خامِ `req` را به `targetPath` می‌ریزد و اگر از `maxBytes` گذشت، همان‌جا
 * می‌بُرد و پروندهٔ نیمه‌نوشته را پاک می‌کند. `content-length` فقط برای ردِ زودهنگام
 * است؛ این شمارش حتی بی `content-length` (chunked) هم سقف را نگه می‌دارد.
 *
 * @returns {Promise<number>} شمارِ بایتِ نوشته‌شده
 * @throws {Error & {code:'TOO_LARGE'}} اگر از سقف گذشت
 */
export function streamToFileCapped(req, targetPath, maxBytes) {
  return new Promise((resolve, reject) => {
    const sink = fs.createWriteStream(targetPath, { mode: 0o600 });
    let total = 0;
    let stopped = false;
    const cleanup = () => fsp.rm(targetPath, { force: true }).catch(() => {});
    const bail = (err) => {
      if (stopped) return;
      stopped = true;
      try { req.unpipe(sink); } catch { /* */ }
      sink.destroy();
      try { req.destroy(); } catch { /* */ }
      cleanup().finally(() => reject(err));
    };
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) bail(Object.assign(new Error('too_large'), { code: 'TOO_LARGE', max: maxBytes }));
    });
    req.on('error', (e) => bail(e));
    sink.on('error', (e) => bail(e));
    sink.on('finish', () => { if (!stopped) resolve(total); });
    req.pipe(sink);
  });
}
