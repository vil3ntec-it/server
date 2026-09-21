// ---------------------------------------------------------------------------
//  ══ هر صفحهٔ «هر روز» زنده است ══════════════════════════════════════════════
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۰۹): «بخشِ هر روز هر شش‌تاشان لایو آپدیت
//  بشوند، یعنی بدون این‌که کاری بکنم درجا هر تغییری را نشانم بدهد.»
//
//  ── چرا این آزمون روی **سورس** است و نه روی مرورگر ─────────────────────
//  زنده بودن یک **ساختار** است، نه یک رفتارِ زمان‌دار: یا صفحه به گذرگاه
//  وصل است یا نیست. سنجیدنش با مرورگر یعنی منتظرِ ساعتِ دیوار ماندن —
//  همان چیزی که در این مخزن دو بار سنجه را دروغ کرد.
//
//  ── دو چیزی که قفل می‌شود ──────────────────────────────────────────────
//   ۱) هیچ صفحهٔ «هر روز» بی `useLive` نماند
//   ۲) و هیچ `setInterval`ِ کوری در آن صفحه‌ها برنگردد — نبضِ کور همان
//      چیزی بود که برداشتیم؛ تورِ ایمنی فقط از راهِ پارامترِ سومِ
//      `useLive` مجاز است.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.join(here, '..', '..', 'web', 'src');

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

const read = (p) => fs.readFileSync(path.join(webSrc, p), 'utf8');

console.log('\n══ صفحه‌های «هر روز» زنده‌اند ══\n');

/*
 *  ⛔ فهرست از خودِ منو خوانده می‌شود، نه از یک کپیِ دستی.
 *
 *  اگر فردا آیتمِ تازه‌ای به گروهِ «هر روز» اضافه شود، همین‌جا خودش
 *  خواسته می‌شود که زنده باشد — وگرنه این آزمون فردا کهنه می‌شد و
 *  سبزِ دروغ می‌داد.
 */
const layout = read('components/Layout.tsx');
const daily = layout.slice(layout.indexOf("id: 'daily'"), layout.indexOf("id: 'money'"));
const routes = [...daily.matchAll(/to: '([^']+)'/g)].map((m) => m[1]);
check('گروهِ «هر روز» از خودِ منو خوانده شد', routes.length >= 6, `${routes.length} آیتم`);

/** هر مسیرِ منو ⇒ فایلِ صفحه‌اش. مسیری که این‌جا نباشد، آزمون را سرخ می‌کند. */
const FILE_OF = {
  '/': 'pages/Dashboard.tsx',
  '/assistant': 'pages/Assistant.tsx',
  '/control': 'pages/control/Command.tsx',
  '/sites': 'pages/Sites.tsx',
  '/site-server': 'pages/SiteServer.tsx',
  '/stations': 'pages/Stations.tsx',
  '/customers?app=shop': 'pages/account/Customers.tsx',
  '/codes': 'pages/Codes.tsx',
};

for (const to of routes) {
  const file = FILE_OF[to];
  if (!file) { check(`صفحهٔ «${to}» در فهرستِ این آزمون هست`, false, 'به FILE_OF اضافه‌اش کنید'); continue; }
  const src = read(file);

  /*
   *  ⚠️ دو راهِ درستِ زنده بودن، و هر دو پذیرفته‌اند:
   *    · `useLive(...)` مستقیم
   *    · `useLoad(path, deps, 'موضوع')` — پارامترِ سومش همان کار را می‌کند
   *    · یا رویدادِ اختصاصیِ خودِ همان صفحه روی سوکت (مثلِ `control:alert`)
   */
  const live = /useLive\(/.test(src)
    || /useLoad<[^>]*>\([^;]*,\s*'[a-z]+'\s*\)/s.test(src)
    || /socket\.on\('[a-z]+:/.test(src);
  check(`«${to}» زنده است`, live, file);

  /*
   *  ⛔ و نبضِ **کور** برنگردد.
   *
   *  ⚠️ «کور» یعنی بی‌نام و بی‌دلیل. یک ساعتِ شمارشِ معکوس نبضِ داده نیست،
   *  و انتظارِ ورودِ کاربر در مرورگرِ بیرونی هیچ راهِ خبر دادنی ندارد. پس
   *  به‌جای شمردنِ خشکِ `setInterval`، هر کدام باید **آگاهانه اعلام** شده
   *  باشد: یک خطِ «نبضِ آگاهانه:» بالایش با دلیلش.
   *
   *  ⛔ این ضعیف کردنِ سنجه نیست، دقیق کردنش است: با این قاعده هیچ‌کس
   *  نمی‌تواند بی‌صدا یک نبضِ تازه اضافه کند — باید دلیلش را بنویسد، و
   *  دلیلِ نوشته‌شده در بازبینی دیده می‌شود.
   */
  const blind = [...src.matchAll(/setInterval\(/g)].length;
  const declared = [...src.matchAll(/نبضِ آگاهانه:/g)].length;
  check(`«${to}» نبضِ کور ندارد`, blind <= declared,
    blind ? `${blind} تا setInterval، ${declared} تا اعلام‌شده` : '');
}

/*
 *  ⛔ و نوشتنِ واقعی باید خبر بدهد، وگرنه «زنده» فقط یک واژه است.
 *
 *  این بند مهم‌ترینِ این پرونده است: صفحه‌ای که به موضوعی وصل شود که
 *  هیچ‌وقت بیدار نمی‌شود، از نبضِ کورِ قبلی **بدتر** است — آن دیر جواب
 *  می‌داد، این هیچ‌وقت.
 */
console.log('\n── نوشتنِ واقعی خبر می‌دهد ──\n');
const storeSrc = fs.readFileSync(path.join(here, '..', 'src', 'sitesync', 'store.js'), 'utf8');
check('دفتر یک جای خبر دادن دارد (onWrite)، نه ده جا',
  /onWrite/.test(storeSrc) && /function applyMutation/.test(storeSrc));
check('و خبر دادن هیچ‌وقت نوشتن را نمی‌خواباند',
  /if \(onWrite\) \{ try \{ onWrite\(/.test(storeSrc));

const stationsSrc = fs.readFileSync(path.join(here, '..', 'src', 'stations', 'index.js'), 'utf8');
check('هر نوشتنِ پمپ موضوعِ «پمپ‌ها» را بیدار می‌کند',
  /onWrite: \(\) => \{ bumpSoon\('stations'/.test(stationsSrc));

const syncSrc = fs.readFileSync(path.join(here, '..', 'src', 'sitesync', 'index.js'), 'utf8');
check('هر نوشتنِ سایت موضوعِ «سایت‌ها» را بیدار می‌کند',
  /onWrite: \(\) => \{ bumpSoon\('sites'/.test(syncSrc));

//  ⚠️ رگبار یک پیام است: یک عکسِ ایستگاه ده‌ها خانه می‌نویسد
check('و رگبار یک پیام است، نه ده تا',
  /bumpSoon\('stations', \d+\)/.test(stationsSrc) && /bumpSoon\('sites', \d+\)/.test(syncSrc));

/* ═══ بندهای ۲.۴ · ۲.۵ · ۲.۶ سند — صفحهٔ کدها ═══════════════════════════ */
console.log('\n── صفحهٔ کدها: شمارش، نامهٔ آماده، فرستادنِ دوباره ──\n');
const codes = read('pages/Codes.tsx');

//  ۲.۴ — شمارشِ معکوسِ زنده
check('۲.۴ شمارشِ معکوس تا انقضا روی ردیف است',
  /expiresAt - now\) \/ 1000/.test(codes) && /\{left\}s/.test(codes));
check('و ساعتش از حلقهٔ خواندن جداست',
  /setTick\(Date\.now\(\)\), 1000\)/.test(codes),
  'یکی بودنشان همان چیزی است که هر ثانیه یک درخواست می‌ساخت');

//  ۲.۵ — نامهٔ آماده با یک کلیک
check('۲.۵ نامهٔ آماده با گیرنده و موضوع و کد ساخته می‌شود',
  /mailto:\$\{encodeURIComponent\(item\.email\)\}/.test(codes)
  && /codesMailSubject/.test(codes) && /codesMailBody/.test(codes));
/*
 *  ⛔ و فقط وقتی کد روی صفحه است: نامهٔ آمادهٔ بی کد یک نامهٔ خالی است و
 *  از نبودنش بدتر — کاربر گمان می‌کند فرستاد.
 */
check('⛔ و بی کد ساخته نمی‌شود', /const mailHref = code\s*\n?\s*\?/.test(codes));

//  ۲.۶ — فرستادنِ دوباره
check('۲.۶ دکمهٔ «دوباره بفرست» هست', /codesSendAgain/.test(codes) && /const resend = async/.test(codes));
check('⛔ و کدِ خودِ پنل از این در نمی‌رود (صفِ خودش را دارد)',
  /item\.source !== 'panel'/.test(codes));
/*
 *  ⛔ مهم‌ترین بندِ این سه: «نرفت» نباید سبز شود. اگر خطا خورده شود، یک
 *  دکمه می‌ماند که می‌گوید «فرستادم» و هیچ ایمیلی نمی‌رود — همان «کلکِ
 *  دروغ»ی که در این مخزن قدغن است.
 */
check('⛔ و «نرفت» سرخ نشان داده می‌شود، نه بی‌صدا',
  /sendNote/.test(codes) && /status-critical/.test(codes));

//  ۲.۷ — داشبوردِ خودِ بخش
check('۲.۷ شمارندهٔ «نرفته‌های امروز» هست',
  /codesListFailed/.test(codes) && /tone=\{failed\.count > 0/.test(codes));
/*
 *  ⛔ مهم‌ترین بندِ ۲.۷: **عدد بی دلیل کسی را به کار نمی‌اندازد.**
 *  یک «۳ تا نرفت» خالی همان بن‌بستی است که یک بار ساعت‌ها وقت برد.
 */
check('⛔ و کنارش دلیلِ نرفتن نوشته می‌شود',
  /codesWhyLabel/.test(codes) && /failed\.reasons/.test(codes));
//  ⛔ «فقط در لاگ» باید در نرفته‌ها شمرده شود: مهرِ «رفت» دارد و ایمیلی نرفته
check('⛔ و «فقط در لاگ» نرفته شمرده می‌شود',
  /i\.sendState === 'failed' \|\| i\.logOnly/.test(codes));
//  ⚠️ و از خودِ همان فهرست شمرده می‌شود، نه از یک مسیرِ دوم
check('⚠️ و از خودِ فهرست شمرده می‌شود، نه مسیرِ دوم',
  !/api<[^>]*>\('\/api\/codes-admin\/stats/.test(codes));

//  ⛔ سه دفتر، سه در
check('⛔ هر دفترِ کد درِ خودش را دارد',
  /account-otp' \? 'otp' : 'logins'/.test(codes),
  'یکی کردنشان یعنی ۴۰۴ برای نیمی از ردیف‌ها');

/*
 *  ══ گامِ ۳ — پوشهٔ هر حساب، پشتیبان‌ها، و دادهٔ درجا ═════════════════════
 *
 *  صفحهٔ «پمپ‌بنزین‌ها» در فهرستِ بالا زنده شده بود، ولی صفحهٔ **پروفایلِ
 *  یک پمپ** — همان جایی که دادهٔ یک حساب دیده می‌شود — از فهرستِ منو
 *  درنمی‌آید (زیرصفحه است) و تا امروز یک نبضِ کورِ بیست‌ثانیه‌ای داشت.
 */
const profile = read('pages/StationProfile.tsx');

//  ۳.۳ — «به حسابش آمد ⇒ دادهٔ خودش درجا»، بی تازه کردنِ دستی
check('۳.۳ پروفایلِ پمپ زنده است', /useLive\('stations'/.test(profile));
check('۳.۳ و نبضِ کورِ بیست‌ثانیه‌ایش رفت',
  [...profile.matchAll(/setInterval\(/g)].length
    <= [...profile.matchAll(/نبضِ آگاهانه:/g)].length);

//  ۳.۱ — پوشهٔ هر حساب دیده می‌شود
check('۳.۱ «پوشهٔ این حساب» در پروفایل دیده می‌شود',
  /پوشهٔ این حساب/.test(profile) && /d\.folder/.test(profile));
/*
 *  ⛔ مهم‌ترین بندِ ۳.۱: فهرست از **سرور** می‌آید، نه از یک کپیِ دستی در
 *  این فایل. کپیِ دستی یعنی فایلی که فردا اضافه شود این‌جا بی‌صدا از قلم
 *  می‌افتد — همان تله‌ای که «یک دفتر را وصل کردم» سه بار در این مخزن زد.
 */
check('⛔ و فهرستِ فایل‌ها از سرور می‌آید، نه از کپیِ دستی',
  /d\.folder\.items\.map/.test(profile)
  && !/'station\.json'/.test(profile) && !/'readkey\.txt'/.test(profile));

//  ۳.۲ — پشتیبان‌ها با تاریخ و اندازه
check('۳.۲ فایل‌های پشتیبان با تاریخ و اندازه دیده می‌شوند',
  /فایل‌های پشتیبان/.test(profile) && /d\.backups/.test(profile)
  && /toLocaleString\('fa-IR'\)/.test(profile) && /fmtBytes\(b\.bytes\)/.test(profile));

//  ⛔ و سمتِ سرور: چیدمان یک جا نوشته شده و رمز از آن در بیرون نمی‌رود
const layoutSrc = fs.readFileSync(path.join(here, '..', 'src', 'stations', 'layout.js'), 'utf8');
check('⛔ چیدمانِ پوشه تنها یک جا نوشته شده', /export const LAYOUT = \[/.test(layoutSrc));
check('⛔ و این فایل هیچ‌وقت چیزی نمی‌نویسد',
  !/writeFile|mkdir|rmSync|unlink/.test(layoutSrc),
  'توصیف‌کننده است، نه سازنده');
check('⛔ و محتوای رمزها را نمی‌خواند',
  !/readFile/.test(layoutSrc), 'token.txt و readkey.txt فقط «هست/نیست»');

const stationsRoute = fs.readFileSync(path.join(here, '..', 'src', 'routes', 'stations.js'), 'utf8');
//  ⛔ درِ دوم ساخته نشد: همان مسیرِ جزئیات که از قبل `files` و `backups` می‌داد
check('⛔ درِ دومی برای پوشه ساخته نشد',
  /folder: describeFolder\(/.test(stationsRoute)
  && !/router\.get\('\/:code\/folder/.test(stationsRoute));

console.log('\n════════════════════════════════════');
console.log(`  ✅ ${pass} سبز، ${fail} قرمز`);
console.log('════════════════════════════════════\n');
process.exit(fail === 0 ? 0 : 1);
