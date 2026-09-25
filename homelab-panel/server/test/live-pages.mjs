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
  '/shop': 'pages/account/ShopDesk.tsx',
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
  //  ⚠️ از ۱۴۰۵/۰۷/۱۳ مسیرِ نوشته‌شده را هم می‌گیرد (پوشِ خبرها)؛ نبض همچنان
  //  **اولین** کارِ هر نوشتن است، بی هیچ شرطی
  /onWrite: \(p?\) => \{\s*bumpSoon\('stations'/.test(stationsSrc));

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
 *  ══ بندِ ۱.۵-الف — دو نبضِ باقی‌مانده هم رفتند ═══════════════════════════
 *
 *  ⛔ این دو تا از گامِ ۱ باقی مانده بودند و **پنهان نشدند**: با خطِ
 *  «نبضِ آگاهانه» اعلام شده بودند و در سند «نشد» نوشته بودیم. حالا
 *  دفترِ خودشان به گذرگاه وصل است.
 */
const siteServer = read('pages/SiteServer.tsx');
check('۱.۵-الف کدهای پیام‌رسان زنده شد', /useLive\('messenger'/.test(siteServer));
check('۱.۵-الف اعلان‌ها زنده شدند', /useLive\('notify'/.test(siteServer));
//  ⛔ و نبضِ پنج و شش ثانیه‌ای واقعاً رفت — وگرنه «زنده شد» فقط یک واژه است
check('⛔ و نبضِ ۵ و ۶ ثانیه‌ای برداشته شد',
  !/setInterval\(load, 5000\)/.test(siteServer) && !/setInterval\(load, 6000\)/.test(siteServer));

const messengerSrc = fs.readFileSync(path.join(here, '..', 'src', 'messenger', 'index.js'), 'utf8');
const notifySrc = fs.readFileSync(path.join(here, '..', 'src', 'notify', 'index.js'), 'utf8');
//  ⛔ و نوشتنِ واقعی خبر می‌دهد، وگرنه صفحه‌ای که به موضوعِ بیدارنشدنی
//  وصل شود از نبضِ کورِ قبلی **بدتر** است.
check('⛔ دفترِ پیام‌رسان با نوشتن خبر می‌دهد',
  /bumpSoon\('messenger'/.test(messengerSrc) && /codes\.set\([\s\S]{0,80}touched\(\)/.test(messengerSrc));
check('⛔ دفترِ اعلان‌ها هم', /bumpSoon\('notify'/.test(notifySrc)
  && (notifySrc.match(/\n\s*touched\(\);/g) || []).length >= 5);

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

/*
 *  ══ گامِ ۴ — میزِ فروشگاه، تمام‌صفحه ═══════════════════════════════════
 */
const shopDesk = read('pages/account/ShopDesk.tsx');

//  ۴.۱ — صفحهٔ خودش، با سه تب
check('۴.۱ میزِ فروشگاه سه تب دارد',
  /shopDeskDash/.test(shopDesk) && /shopDeskGroups/.test(shopDesk) && /shopDeskCodes/.test(shopDesk));

//  ۴.۲ — شش عدد و فهرستِ رو به پایان با ایمیل
/*
 *  ⚠️ از ۱.۵۰.۳ خانه‌ها از یک `counts`ِ **سنجیده‌شده** خوانده می‌شوند
 *  (`d.counts || {}`)، نه مستقیم از `d.counts.…` — وگرنه سرورِ حسابِ کهنه
 *  کلِ صفحه را می‌شکست. ادعا همان است، از درِ تازه: هر شش عدد هست **و**
 *  سرچشمه‌شان همان پاسخِ بالادست است.
 */
check('۴.۲ داشبورد هر شش عدد را نشان می‌دهد',
  ['shops', 'customers', 'subscribed', 'online', 'supportUnread', 'supportOpen']
    .every((k) => shopDesk.includes(`counts.${k}`))
  && /const counts = d\.counts \|\|/.test(shopDesk));
//  ── اشتراک‌ها یک بخش، کدها یک بخش، داشبوردِ کار — ۱۴۰۵/۰۷/۱۳ (۱.۵۰.۱۶) ────
{
  const app = read('App.tsx');
  const hub = read('pages/account/SubscriptionsHub.tsx');
  const stations = read('pages/Stations.tsx');
  const dash = read('pages/Dashboard.tsx');
  const codes = read('pages/Codes.tsx');
  check('⛔ منو یک درِ «اشتراک‌ها» دارد، نه «مشتری‌ها» و «پلن‌ها»ی جدا',
    /to: '\/subscriptions', key: 'acSubscriptions'/.test(layout)
    && !/to: '\/customers'/.test(layout) && !/to: '\/plans'/.test(layout));
  check('⇒ نشانی‌های قدیمی به تبِ خودشان در اشتراک‌ها می‌روند',
    /path="\/customers" element=\{<ToSubscriptions tab="subs"/.test(app)
    && /path="\/plans" element=\{<ToSubscriptions tab="plans"/.test(app)
    && /path="\/vip-codes" element=\{<ToSubscriptions tab="codes"/.test(app));
  check('⇒ همان صفحه‌ها داخلِ تب‌های هاب — نه رونوشت',
    /<Customers key=/.test(hub) && /<Plans \/>/.test(hub) && /<VipCodes \/>/.test(hub) && /<PurchaseRequests \/>/.test(hub));
  check('⇒ پمپ‌بنزین‌ها و فروشگاه‌ها فقط درِ همان بخش‌اند، با بخشِ خودشان',
    /to="\/subscriptions\?app=pump"/.test(stations) && !/<Customers/.test(stations)
    && /to="\/subscriptions\?app=shop"/.test(shopDesk) && !/<Customers/.test(shopDesk));
  check('⇒ «مدیریتِ اشتراک»ِ جدولِ پمپ هم به همان‌جا می‌رود',
    /\/subscriptions\?app=pump&q=/.test(read('pages/StationsCloud.tsx')));
  check('⇒ تمدید و دادنِ اشتراک مدتِ دلخواه دارند',
    /function ExtendDialog/.test(read('pages/account/Customers.tsx'))
    && /customSpan/.test(read('pages/account/GrantSub.tsx')) && /endsAt/.test(read('pages/account/GrantSub.tsx')));
  check('⛔ داشبورد حالِ سرور را نشان نمی‌دهد — مانیتورینگ جای خودش است',
    !/cpu\.usage|memory\.usage|disk\.usage|temperature/.test(dash) && /to="\/monitoring"/.test(dash));
  check('⇒ داشبورد فروش و اشتراکِ هر برنامه و پشتیبانی را می‌خواند',
    /sales\/summary/.test(dash) && /sales\/expiring/.test(dash) && /support\/threads/.test(dash) && /codes-admin\/live/.test(dash));
  check('⇒ کدها: تبِ هر برنامه در نشانی، و ساختِ کد از همان صفحه',
    /TAB_APPS/.test(codes) && /'pump-station'/.test(codes) && /\/api\/codes-admin\/send/.test(codes) && /params\.get\('app'\)/.test(codes));
  check('⇒ صفحهٔ جدای «کدِ پمپ» رفت؛ پمپ‌بنزین‌ها به تبِ پمپِ کدها می‌رود',
    !fs.existsSync(path.join(webSrc, 'pages', 'PumpCodes.tsx')) && /to="\/codes\?app=pump"/.test(stations));
}

check('۴.۲ و «رو به پایان» ایمیل و روزِ مانده دارد',
  /r\.ownerEmail/.test(shopDesk) && /r\.daysLeft/.test(shopDesk));

/*
 *  ⛔ مهم‌ترین بندِ گامِ ۴: **پنل هیچ عددی حساب نمی‌کند.** اگر صفحه خودش
 *  گروه‌بندی یا جمع می‌کرد، همان «دفترِ دوم» بود که سه بار در این مخزن
 *  زد: مدیر «فعال» می‌دید و مشتری «تمام شده».
 */
check('⛔ و صفحه خودش گروه‌بندی نمی‌کند',
  !/\.filter\(\s*\(?[a-z]\)?\s*=>\s*[a-z]\.status/.test(shopDesk)
  && !/daysLeft\s*=\s*Math\./.test(shopDesk),
  'گروه‌بندی و جمع کارِ سرورِ حساب است');

//  ۴.۳ — سه گروه، و هر سه نام‌دار
check('۴.۳ سه گروهِ اشتراک هست',
  /shopDeskHas/.test(shopDesk) && /shopDeskNone/.test(shopDesk) && /shopDeskExpired/.test(shopDesk));

//  ۴.۴ — کدِ شاگرد و شمارِ شاگردها
check('۴.۴ کدِ شاگرد و شمارِ شاگردها هست',
  /shopDeskStudents/.test(shopDesk) && /staff-codes/.test(shopDesk));
/*
 *  ⛔ و نمایشِ کد با یک کلیکِ **جدا** است، نه با باز شدنِ صفحه — همان
 *  قاعدهٔ میزِ کدها. بی آن، هر تازه‌شدنِ صفحه یک ردیفِ «کد دیده شد» برای
 *  هر دکان می‌ساخت و آن دفتر بی‌معنا می‌شد.
 */
check('⛔ و کد با کلیکِ جدا می‌آید، نه با باز شدنِ صفحه',
  /staff-codes\/reveal/.test(shopDesk) && /onClick=\{reveal\}/.test(shopDesk));
check('⛔ و هیچ کدِ شاگردی در خودِ صفحه نوشته نشده',
  !/SHG-/.test(shopDesk));

//  ⛔ و درِ منو یکی است: آیتم به `/shop` می‌رود، نه دو در برای یک موضوع
check('⛔ آیتمِ منوی فروشگاه یک در دارد',
  /\{ to: '\/shop', key: 'navShops'/.test(layout)
  && !/to: '\/customers\?app=shop'/.test(layout));

/* =========================================================================
 *  ۵) یک صفحهٔ شکسته کلِ پنل را نمی‌اندازد
 *
 *  گزارشِ صاحب سامانه: «بخشِ فروشگاه رو اصلاً باز نمی‌کنه، می‌زنم روش از
 *  برنامه می‌ندازه بیرون.»
 *
 *  ⛔ ریشه: در کلِ این پنل **هیچ `ErrorBoundary`ی نبود**. یک استثنا وسطِ
 *  رندر یعنی React کلِ درخت را باز می‌کند — یعنی صفحهٔ سفید، یعنی «از
 *  برنامه می‌ندازه بیرون». و `ShopDesk` شکلِ پاسخِ بالادست را بی سنجش
 *  می‌خواند، پس سرورِ حسابِ کهنه (پیش از ۲.۹.۰) دقیقاً همان استثنا را
 *  می‌ساخت.
 * ========================================================================= */
const boundary = read('components/PageBoundary.tsx');
check('۵) پنل نگهبانِ خطای صفحه دارد',
  /getDerivedStateFromError/.test(boundary) && /componentDidCatch/.test(boundary));
check('۵) و هر صفحه داخلِ همان نگهبان رندر می‌شود',
  /<PageBoundary[^>]*>\s*<Outlet/.test(layout),
  'بی این، یک استثنا کلِ پنل را سفید می‌کند');
/*
 *  ⚠️ `key` روی نگهبان لازم است، نه تجمل: بی آن، صفحه‌ای که یک بار شکست
 *  تا تازه‌سازیِ دستی شکسته می‌ماند — حتی وقتی کاربر به صفحهٔ سالمِ دیگری
 *  رفته باشد.
 */
check('⚠️ و با عوض شدنِ نشانی خودش را از نو می‌سازد',
  /<PageBoundary key=\{location\.pathname\}/.test(layout));

/*
 *  ⛔ و خودِ صفحه هم شکلِ بالادست را کورکورانه باور نمی‌کند. نگهبان تورِ
 *  آخر است، نه جانشینِ سنجش.
 */
check('⛔ میزِ فروشگاه شکلِ پاسخِ سرورِ حساب را می‌سنجد',
  /Array\.isArray\(d\.expiring\)/.test(shopDesk)
  && /d\.counts \|\|/.test(shopDesk),
  'سرورِ حسابِ کهنه نباید صفحه را بشکند');

/*
 *  ⚠️ و فیلترِ میزِ کدها دو نامِ **سرورِ حساب** را هم دارد: بیشترِ کدهای
 *  این فهرست مالِ آن دفترند و سرور `?app=pump|shop` را می‌پذیرد، ولی تا
 *  ۱.۵۰.۲ هیچ راهی نبود که از صفحه انتخابشان کنی — یعنی فیلتر دقیقاً
 *  برای آن‌هایی که بیشتر لازم بودند کار نمی‌کرد.
 */
const codesPage = read('pages/Codes.tsx');
check('⚠️ فیلترِ کدها «پمپ‌بنزین» و «فروشگاه» را هم دارد',
  /value: 'pump'/.test(codesPage) && /value: 'shop'/.test(codesPage));


/*
 *  ⛔ «برنامه روشن است» یک قاعده دارد، نه دو. فهرستِ پمپ‌ها فقط `liveAt` را
 *  می‌سنجید و پروفایل اتصالِ زنده را؛ برنامه عکسِ بی‌تغییر را دوباره
 *  نمی‌فرستد، پس پمپِ وصل در فهرست «خبری نیست» می‌گرفت.
 */
const stationsPage = read('pages/Stations.tsx');
const profilePage = read('pages/StationProfile.tsx');
const liveRule = read('stationLive.ts');
check('⛔ فهرست و پروفایلِ پمپ هر دو از `stationOnline` می‌خوانند',
  /stationOnline\(/.test(stationsPage) && /stationOnline\(/.test(profilePage));
check('⛔ و هیچ‌کدام مرزِ زمانیِ خودش را ندارد',
  !/LIVE_WINDOW_MS\s*=/.test(stationsPage) && !/LIVE_WINDOW_MS\s*=/.test(profilePage));
check('⚠️ قاعده اتصالِ زنده را هم می‌شمارد، نه فقط عکس',
  /liveConnections/.test(liveRule) && /lastActivity/.test(liveRule) && /liveAt/.test(liveRule));
{
  // رفتاری: همان تابع، با سه حالتِ واقعی
  // تنها سه جای نوع‌دارِ همان فایل، صریح برداشته می‌شوند (بی وابستگی به کامپایلر)
  const body = liveRule
    .replace(/export type StationLiveSignals = \{[^}]*\};/, '')
    .replace(/export /g, '')
    .replace('(s: StationLiveSignals, now = Date.now()): boolean', '(s, now = Date.now())')
    .replace('(t?: number | null)', '(t)');
  let fn = null;
  try { fn = new Function(body + '\nreturn stationOnline;')(); } catch (e) { console.log('   ', e.message); }
  const now = 10_000_000;
  check('⛔ پمپِ وصل با عکسِ کهنه «روشن» است',
    fn && fn({ liveConnections: 1, lastActivity: null, liveAt: now - 10 * 60_000 }, now) === true);
  check('⛔ پمپِ بی اتصال و بی خبر «خاموش» است',
    fn && fn({ liveConnections: 0, lastActivity: now - 5 * 60_000, liveAt: now - 5 * 60_000 }, now) === false);
  check('⚠️ عکسِ تازه به‌تنهایی «روشن» است',
    fn && fn({ liveConnections: 0, lastActivity: null, liveAt: now - 30_000 }, now) === true);
}

console.log('\n════════════════════════════════════');
console.log(`  ✅ ${pass} سبز، ${fail} قرمز`);
console.log('════════════════════════════════════\n');
process.exit(fail === 0 ? 0 : 1);
