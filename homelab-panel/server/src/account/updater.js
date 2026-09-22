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
import { accountDataDir, resolveAccountDir, restartAccountServer } from './supervisor.js';
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
 * ⚠️ `tar` روی هر دو سیستم هست — روی ویندوز ۱۰ به بعد `tar.exe` خودِ
 * ویندوز است. پس یک فرمان، نه دو راه.
 */
export async function apply({ fetchImpl = fetch, actor = 'admin', restart = true } = {}) {
  const info = await check({ fetchImpl });
  if (!info.ok) return info;
  if (!info.available) {
    return { ok: true, changed: false, current: info.current, latest: info.latest,
      why: 'سرورِ حساب همین حالا تازه‌ترین نسخه است' };
  }

  const root = accountDataDir();
  const next = path.join(root, 'app.next');
  const live = installedDir();
  const archive = path.join(root, `.${ASSET}.part`);

  try {
    await fsp.mkdir(root, { recursive: true });
    await fsp.rm(next, { recursive: true, force: true });
    await fsp.mkdir(next, { recursive: true });

    const res = await fetchImpl(info.url, { headers: { 'user-agent': 'control-center' } });
    if (!res.ok) return { ok: false, why: `دانلود نشد (${res.status})`, code: 'download' };
    await fsp.writeFile(archive, Buffer.from(await res.arrayBuffer()));

    const out = await run('tar', ['-xzf', archive, '-C', next, '--strip-components=1'], { timeout: 300000 });
    if (!out.ok) return { ok: false, why: 'بسته باز نشد', code: 'extract', detail: out.stderr.slice(0, 300) };

    //  ⛔ پیش از هر جابه‌جایی: واقعاً یک سرورِ حسابِ سالم است؟
    if (!usable(next)) return { ok: false, why: 'بستهٔ دانلودشده ناقص است', code: 'incomplete' };
    const got = versionAt(next);
    if (!got) return { ok: false, why: 'نسخهٔ بستهٔ دانلودشده خوانده نشد', code: 'incomplete' };

    //  جابه‌جاییِ آخر — و نسخهٔ قبلی تا دورِ بعد نگه داشته می‌شود
    const old = path.join(root, 'app.prev');
    await fsp.rm(old, { recursive: true, force: true });
    if (fs.existsSync(live)) await fsp.rename(live, old);
    await fsp.rename(next, live);

    logEvent('account.server.updated', { from: info.current, to: got, actor });
    if (restart) { try { restartAccountServer(); } catch { /* دورِ بعدِ ناظر */ } }
    return { ok: true, changed: true, from: info.current, to: got };
  } catch (e) {
    return { ok: false, why: 'به‌روزرسانی نشد', code: 'failed', detail: String(e?.message || e).slice(0, 300) };
  } finally {
    await fsp.rm(archive, { force: true }).catch(() => {});
    await fsp.rm(next, { recursive: true, force: true }).catch(() => {});
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
