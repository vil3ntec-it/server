// ---------------------------------------------------------------------------
//  به‌روزرسانیِ سرورِ حساب — بی نصبِ دوبارهٔ مرکز فرمان
//
//  گزارشِ صاحب سامانه (۱۴۰۵/۰۷/۱۱) با عکس: برنامهٔ پمپ می‌گفت
//  «✅ سرورِ حساب جواب داد (نسخهٔ 2.7.0)» در حالی که `shop` روی ۲.۹.۰ بود،
//  و روی ۲.۷.۰ **فروشِ اشتراک کار نمی‌کند**: جست‌وجوی مشتری با ایمیل چیزی
//  پیدا نمی‌کند، دادنِ اشتراک `400 bad_id` می‌گیرد، پلنِ محدود **کامل**
//  داده می‌شود و مسیرِ `addons` اصلاً نیست. (هر چهارتا با
//  `npm run test:pump-e2e` روی خودِ ۲.۷.۰ سنجیده شد.)
//
//  ⛔ **ریشه ساختاری بود، نه یک باگ**: کدِ سرورِ حساب فقط از راهِ فایلِ
//  نصبِ مرکز فرمان می‌آمد (`windows-app.yml` ریپوی shop را کلون و داخلِ
//  `resources/account-server` می‌گذارد). برنامهٔ پمپ، اپِ کارمندان و خودِ
//  مرکز فرمان هر سه خودشان را به‌روز می‌کنند — ولی سرورِ حساب، که **ورود و
//  اشتراکِ همه** به آن بند است، در لحظهٔ ساختِ نصاب **یخ می‌زد**. پوشهٔ
//  `<dataDir>/account-server/app` از روزِ اول در فهرستِ جست‌وجوی
//  `resolveAccountDir` بود و **هیچ‌کس نمی‌نوشتش**: طرحش دیده شده بود و
//  ساخته نشده بود. این ماژول همان جای خالی است.
//
//  ⛔ و کلِ بسته ۳۴ مگابایت است (سورس + `node_modules`)، در برابرِ ۹۰
//  مگابایتِ نصابِ مرکز فرمان. پس به‌روز کردنِ سرورِ حساب دیگر یعنی یک
//  دانلودِ کوچک، نه نصبِ دوبارهٔ همه‌چیز.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { logEvent } from '../db.js';
import {
  accountDataDir, resolveAccountDir, restartAccountServer, stopAccountServer, waitAccountServerExit,
} from './supervisor.js';
import { repoSlug } from '../update/github.js';
import { usable, versionAt, newer } from './bundle.js';

/** برچسبِ انتشاری که بستهٔ آماده رویش می‌نشیند. */
export const RELEASE_TAG = 'account-server';

/** نامِ فایلِ بسته در همان انتشار. */
export const ASSET = 'account-server.tar.gz';

const API = 'https://api.github.com';

/**
 * پوشه‌ای که بستهٔ دانلودشده در آن می‌نشیند.
 *
 * ⚠️ **در پوشهٔ داده است، نه کنارِ برنامه** — و همین است که آن را از
 * به‌روزرسانیِ خودِ مرکز فرمان مستقل می‌کند: نصابِ تازه `resources/` را
 * عوض می‌کند و این دست‌نخورده می‌ماند، و برعکس.
 */
export function installedDir() {
  return path.join(accountDataDir(), 'app');
}

/**
 * چه چیزی روی انتشار هست.
 *
 * ⚠️ هیچ‌وقت استثنا بیرون نمی‌دهد: بی‌اینترنت بودن نباید صفحهٔ تنظیمات را
 * بشکند.
 */
export async function latest({ fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${API}/repos/${repoSlug()}/releases/tags/${RELEASE_TAG}`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'control-center' },
    });
    if (!res.ok) {
      return res.status === 404
        ? { ok: false, why: 'بستهٔ آمادهٔ سرورِ حساب هنوز منتشر نشده است', code: 'no_release' }
        : { ok: false, why: `گیت‌هاب جواب نداد (${res.status})`, code: 'http' };
    }
    const body = await res.json();
    const asset = (body.assets || []).find((a) => a.name === ASSET);
    if (!asset) return { ok: false, why: 'فایلِ بسته در انتشار نیست', code: 'no_asset' };

    //  نسخه از نامِ انتشار می‌آید («سرورِ حساب — ۲.۹.۰»)، و اگر نبود از بدنه.
    const hit = /(\d+(?:\.\d+)+)/.exec(`${body.name || ''} ${body.body || ''}`);
    return {
      ok: true,
      version: hit ? hit[1] : '',
      url: asset.browser_download_url,
      size: Number(asset.size) || 0,
      at: body.published_at || '',
    };
  } catch (e) {
    return { ok: false, why: 'به گیت‌هاب نرسیدیم', code: 'offline', detail: String(e?.message || e).slice(0, 200) };
  }
}

/** نسخه‌ای که همین حالا اجرا می‌شود (هر کدام از پوشه‌ها که برنده شده). */
export function current() {
  const dir = resolveAccountDir();
  return { dir, version: dir ? versionAt(dir) : '' };
}

/**
 * هست، و تازه‌تر است؟
 */
export async function check({ fetchImpl = fetch } = {}) {
  const now = current();
  const up = await latest({ fetchImpl });
  if (!up.ok) return { ...up, current: now.version, dir: now.dir };
  return {
    ok: true,
    current: now.version,
    dir: now.dir,
    latest: up.version,
    url: up.url,
    size: up.size,
    at: up.at,
    available: !!up.version && newer(up.version, now.version),
  };
}

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', (e) => resolve({ ok: false, stderr: String(e?.message || e) }));
  p.on('close', (code) => resolve({ ok: code === 0, stderr: err }));
});

/**
 * کدام `tar`.
 *
 * ⛔ روی ویندوز **همیشه `tar.exe`ِ خودِ ویندوز** (System32). اگر گیت نصب
 * باشد، `tar`ِ گیت (GNU/msys) ممکن است زودتر در `PATH` بیاید و آن
 * `C:\…` را «میزبانِ دور به نامِ C» می‌خواند — بسته هیچ‌وقت باز نمی‌شد.
 */
export function tarCommand() {
  if (process.platform !== 'win32') return 'tar';
  const sys = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(sys) ? sys : 'tar';
}

/**
 * ⛔ `node_modules/.bin` باز نمی‌شود: پیوندِ نمادین است و `tar.exe`ِ ویندوز
 * بی دسترسیِ مدیر یا «حالتِ توسعه‌دهنده» نمی‌سازدش — و **کلِ** باز کردن با
 * کدِ خطا تمام می‌شد، یعنی «بسته باز نشد» روی هر ویندوزِ معمولی. سرورِ حساب
 * هیچ‌وقت از `.bin` چیزی اجرا نمی‌کند.
 */
export const TAR_EXCLUDES = ['--exclude=node_modules/.bin'];

// ══ کارِ پس‌زمینه ═════════════════════════════════════════════════════════
//
//  ⛔ **ریشهٔ «دانلود کنسل می‌شود، از سر می‌شود، با رفتن به بخشِ دیگر از سر
//  می‌شود و نشان نمی‌دهد چند مگابایت است»** (گزارشِ صاحب سامانه،
//  ۱۴۰۵/۰۷/۱۳): کلِ دانلود و باز کردن و جابه‌جایی **داخلِ یک درخواستِ HTTP**
//  بود. صفحه هیچ عددی نمی‌گرفت، رفتن به بخشِ دیگر دکمه را از نو می‌ساخت، و
//  کلیکِ دوباره یک `apply`ِ دوم راه می‌انداخت که `app.next` و فایلِ نیمه‌کارهٔ
//  اولی را **پاک می‌کرد** — پس هیچ‌کدام تمام نمی‌شد.
//
//  حالا: یک کار، روی سرور، یکی در هر لحظه. صفحه فقط شروعش می‌کند و هر ثانیه
//  `progress()` را می‌خواند. رفتن و برگشتن هیچ چیزی را از سر نمی‌کند.
const job = {
  running: false,
  phase: 'idle', // idle · check · download · extract · swap · restart · done · error
  got: 0,
  total: 0,
  from: '',
  to: '',
  why: '',
  code: '',
  attempt: 0,
  startedAt: 0,
  endedAt: 0,
};
let jobPromise = null;

const setJob = (patch) => Object.assign(job, patch);

/** حالِ کارِ جاری — بی هیچ درخواستی به بیرون. */
export function progress() {
  return { ...job };
}

/**
 * کار را در پس‌زمینه شروع می‌کند و همان لحظه برمی‌گردد.
 * کارِ در جریان را **هرگز** دوباره شروع نمی‌کند.
 */
export function start(opts = {}) {
  if (jobPromise) return { ok: true, started: false, progress: progress() };
  jobPromise = apply(opts)
    .catch((e) => ({ ok: false, code: 'failed', why: 'به‌روزرسانی نشد', detail: String(e?.message || e).slice(0, 300) }))
    .then((out) => {
      setJob({
        running: false,
        endedAt: Date.now(),
        phase: out.ok ? 'done' : 'error',
        why: out.ok ? (out.changed ? `به ${out.to} به‌روز شد` : (out.why || 'تازه‌ترین است')) : (out.why || 'به‌روزرسانی نشد'),
        code: out.code || '',
        to: out.to || job.to,
      });
      return out;
    })
    .finally(() => { jobPromise = null; });
  return { ok: true, started: true, progress: progress() };
}

/** فقط برای آزمون: منتظرِ پایانِ کارِ جاری. */
export function settled() {
  return jobPromise || Promise.resolve(null);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** نامِ فایلِ نیمه‌کاره — به نسخه بسته است تا نیمهٔ نسخهٔ دیگر ادامه داده نشود. */
function partFile(root, version) {
  return path.join(root, `.account-server-${String(version || 'x').replace(/[^\w.-]/g, '')}.tar.gz.part`);
}

/**
 * ⛔ دانلودِ **ادامه‌دار**: هر چه آمده روی دیسک می‌ماند و تلاشِ بعدی با
 * `Range` از همان‌جا ادامه می‌دهد — چه تلاشِ دوباره داخلِ همین کار، چه
 * کلیکِ بعدیِ کاربر پس از قطعِ اینترنت. پاسخِ ۲۰۰ (سروری که `Range` نفهمد)
 * یعنی از صفر.
 */
async function downloadTo(file, url, size, fetchImpl) {
  let have = 0;
  try { have = fs.statSync(file).size; } catch { have = 0; }
  if (size && have > size) { await fsp.rm(file, { force: true }); have = 0; }
  if (size && have === size) { setJob({ got: have, total: size }); return; }

  const headers = { 'user-agent': 'control-center' };
  if (have > 0) headers.range = `bytes=${have}-`;
  const res = await fetchImpl(url, { headers });
  if (!res.ok && res.status !== 206) {
    const e = new Error(`http_${res.status}`);
    e.status = res.status;
    throw e;
  }
  const resumed = res.status === 206 && have > 0;
  if (!resumed) have = 0;
  const len = Number(res.headers?.get?.('content-length')) || 0;
  const total = size || (len ? have + len : 0);
  setJob({ got: have, total });

  const out = fs.createWriteStream(file, { flags: resumed ? 'a' : 'w' });
  const wrote = new Promise((resolve, reject) => { out.on('finish', resolve); out.on('error', reject); });
  try {
    if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
      for await (const chunk of res.body) {
        const buf = Buffer.from(chunk);
        if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
        job.got += buf.length;
      }
    } else {
      //  پیاده‌سازی‌هایی که بدنهٔ جریانی ندارند (آزمون‌ها)
      const buf = Buffer.from(await res.arrayBuffer());
      out.write(buf);
      job.got += buf.length;
    }
  } finally {
    out.end();
    await wrote.catch(() => {});
  }
  if (size && fs.statSync(file).size !== size) {
    const e = new Error('short');
    e.short = true;
    throw e;
  }
}

/** جابه‌جایی با چند تلاش — ضدِ ویروس یک لحظه فایل‌های تازه را نگه می‌دارد. */
async function renameRetry(from, to, tries = 12) {
  for (let i = 0; ; i++) {
    try { await fsp.rename(from, to); return; } catch (e) {
      if (i >= tries - 1 || !/EBUSY|EPERM|EACCES|ENOTEMPTY/.test(e.code || '')) throw e;
      await sleep(500);
    }
  }
}

/**
 * ══ گرفتن و نشاندنِ بستهٔ تازه ═══════════════════════════════════════════
 *
 * ⛔ **پوشهٔ در حالِ اجرا تا آخرین لحظه دست نمی‌خورد.** بسته در
 * `app.next` باز می‌شود، آن‌جا سنجیده می‌شود، و فقط وقتی سالم بود جای
 * `app` را می‌گیرد. یک دانلودِ نیمه‌کاره یا یک آرشیوِ خراب نباید سرورِ
 * حسابِ کارکنِ مشتری را از کار بیندازد.
 *
 * ⛔ و **پوشهٔ داده دست نمی‌خورد**: دیتابیسِ PGlite و `secrets.json` در
 * `<dataDir>/account-server/` هستند و این فقط `app` را عوض می‌کند. عوض
 * شدنِ `API_SECRET` یعنی همهٔ نشست‌های همهٔ برنامه‌ها یک‌شبه بی‌اعتبار.
 *
 * ⛔ **روی ویندوز پوشه‌ای که `cwd`ِ سرورِ حسابِ زنده است جابه‌جا نمی‌شود**
 * (`EBUSY`). پس سرورِ حساب درست پیش از جابه‌جایی خاموش و بعدش روشن
 * می‌شود — و اگر جابه‌جایی نشد، همان نسخهٔ قبلی دوباره روشن می‌شود.
 */
export async function apply({ fetchImpl = fetch, actor = 'admin', restart = true, retryDelays = [2000, 5000, 10000] } = {}) {
  setJob({ running: true, phase: 'check', got: 0, total: 0, from: '', to: '', why: '', code: '', attempt: 0, startedAt: Date.now(), endedAt: 0 });
  const info = await check({ fetchImpl });
  if (!info.ok) return info;
  setJob({ from: info.current, to: info.latest, total: info.size || 0 });
  if (!info.available) {
    return { ok: true, changed: false, current: info.current, latest: info.latest,
      why: 'سرورِ حساب همین حالا تازه‌ترین نسخه است' };
  }

  const root = accountDataDir();
  const next = path.join(root, 'app.next');
  const live = installedDir();
  const archive = partFile(root, info.latest);
  let stopped = false;

  try {
    await fsp.mkdir(root, { recursive: true });
    //  نیمه‌کاره‌های نسخه‌های دیگر به کاری نمی‌آیند
    for (const f of await fsp.readdir(root).catch(() => [])) {
      const full = path.join(root, f);
      if (/^\.account-server-.*\.part$/.test(f) && full !== archive) await fsp.rm(full, { force: true }).catch(() => {});
    }

    // ── ۱) دانلود، با ادامه و چند تلاش
    setJob({ phase: 'download' });
    for (let i = 0; ; i++) {
      setJob({ attempt: i + 1 });
      try {
        await downloadTo(archive, info.url, info.size, fetchImpl);
        break;
      } catch (e) {
        //  ۴xx (جز ۴۰۸/۴۲۹) تلاشِ دوباره نمی‌خواهد
        const fatal = e.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429 && e.status !== 416;
        if (e.status === 416) await fsp.rm(archive, { force: true }).catch(() => {});
        if (fatal || i >= retryDelays.length) {
          return { ok: false, code: 'download',
            why: e.status ? `دانلود نشد (${e.status})` : 'دانلود قطع شد — دوباره بزنید، از همان‌جا ادامه می‌دهد',
            detail: String(e?.message || e).slice(0, 200) };
        }
        await sleep(retryDelays[i]);
      }
    }

    // ── ۲) باز کردن کنارِ نصبِ فعلی
    setJob({ phase: 'extract' });
    await fsp.rm(next, { recursive: true, force: true });
    await fsp.mkdir(next, { recursive: true });
    const out = await run(tarCommand(), ['-xzf', archive, '-C', next, '--strip-components=1', ...TAR_EXCLUDES], { timeout: 300000 });
    if (!out.ok) {
      //  آرشیوِ خراب را نگه نمی‌داریم، وگرنه تلاشِ بعدی همان را «کامل» می‌بیند
      await fsp.rm(archive, { force: true }).catch(() => {});
      return { ok: false, why: 'بسته باز نشد', code: 'extract', detail: out.stderr.slice(0, 300) };
    }

    //  ⛔ پیش از هر جابه‌جایی: واقعاً یک سرورِ حسابِ سالم است؟
    if (!usable(next)) return { ok: false, why: 'بستهٔ دانلودشده ناقص است', code: 'incomplete' };
    const got = versionAt(next);
    if (!got) return { ok: false, why: 'نسخهٔ بستهٔ دانلودشده خوانده نشد', code: 'incomplete' };

    // ── ۳) جابه‌جایی — سرورِ حساب یک لحظه خاموش
    setJob({ phase: 'swap' });
    if (restart && fs.existsSync(live)) {
      stopAccountServer();
      await waitAccountServerExit(10000);
      stopped = true;
    }
    const old = path.join(root, 'app.prev');
    await fsp.rm(old, { recursive: true, force: true });
    if (fs.existsSync(live)) await renameRetry(live, old);
    try {
      await renameRetry(next, live);
    } catch (e) {
      //  برگرداندنِ نسخهٔ قبلی — سرورِ حساب نباید بی پوشه بماند
      if (!fs.existsSync(live) && fs.existsSync(old)) await renameRetry(old, live).catch(() => {});
      throw e;
    }

    logEvent('account.server.updated', { from: info.current, to: got, actor });
    if (restart) {
      setJob({ phase: 'restart' });
      stopped = false;
      try { await restartAccountServer(); } catch { /* دورِ بعدِ ناظر */ }
    }
    await fsp.rm(archive, { force: true }).catch(() => {});
    return { ok: true, changed: true, from: info.current, to: got };
  } catch (e) {
    return { ok: false, why: 'به‌روزرسانی نشد', code: 'failed', detail: String(e?.message || e).slice(0, 300) };
  } finally {
    //  ⚠️ فایلِ نیمه‌کارهٔ دانلود عمداً پاک نمی‌شود — ادامهٔ دانلود از همان است.
    await fsp.rm(next, { recursive: true, force: true }).catch(() => {});
    if (!jobPromise) job.running = false;
    if (stopped) { try { await restartAccountServer(); } catch { /* دورِ بعدِ ناظر */ } }
  }
}

/**
 * نسخهٔ نصب‌شده در پوشهٔ داده — برای `resolveAccountDir`.
 *
 * ⚠️ این تابع عمداً این‌جاست و نه در ناظر: ناظر نباید بداند که
 * به‌روزرسانی‌ای در کار هست.
 */
export function dataDirCandidate() {
  const dir = installedDir();
  return usable(dir) ? { dir, version: versionAt(dir) } : null;
}

//  ⚠️ یک در برای همه: هر کسی این سه را لازم دارد از همین‌جا برمی‌دارد،
//  نه با یک نسخهٔ دومِ خودش.
export { usable, versionAt, newer };
