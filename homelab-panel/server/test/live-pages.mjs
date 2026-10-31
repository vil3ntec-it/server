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
//  ── کدها یک بخش، داشبوردِ کار — ۱۴۰۵/۰۷/۱۳ (۱.۵۰.۱۶) ──────────────────────
//  ── و بخشِ جدای «اشتراک‌ها» برداشته شد — ۱۴۰۵/۰۸/۰۹ (دستورِ صاحب محصول) ──
{
  const app = read('App.tsx');
  const stations = read('pages/Stations.tsx');
  const dash = read('pages/Dashboard.tsx');
  const codes = read('pages/Codes.tsx');
  const subs = read('pages/account/AppSubscriptions.tsx');
  check('⛔ منو درِ «اشتراک‌ها» ندارد — نه «مشتری‌ها» و نه «پلن‌ها»ی جدا',
    !/to: '\/subscriptions'/.test(layout) && !/to: '\/customers'/.test(layout) && !/to: '\/plans'/.test(layout));
  check('⛔ صفحهٔ بخشِ جدا (SubscriptionsHub) دیگر نیست',
    !fs.existsSync(path.join(webSrc, 'pages', 'account', 'SubscriptionsHub.tsx')) && !/SubscriptionsHub/.test(app));
  check('⇒ نشانی‌های کهنه ۴۰۴ نمی‌شوند — هر کدام با زبانهٔ خودش به «کدام برنامه؟» یا مستقیم به بخشِ درست',
    /path="\/subscriptions" element=\{<SubscriptionsMoved \/>/.test(app)
    && /path="\/customers" element=\{<SubscriptionsMoved defaultView="subs"/.test(app)
    && /path="\/plans" element=\{<SubscriptionsMoved defaultView="plans"/.test(app)
    && /path="\/vip-codes" element=\{<SubscriptionsMoved defaultView="codes"/.test(app)
    && /path="\/discounts" element=\{<SubscriptionsMoved defaultView="discounts"/.test(app)
    && /path="\/visitors" element=\{<SubscriptionsMoved defaultView="visitors"/.test(app));
  check('⇒ پمپ‌بنزین‌ها و فروشگاه‌ها خودشان اشتراکِ خودشان را دارند — همان صفحه، با بخشِ ثابت',
    /<AppSubscriptions app="pump" \/>/.test(stations) && !/\/subscriptions/.test(stations)
    //  (فاز ۲: «فروش و درآمد»ِ دکان زبانهٔ «مالی» ِ همان میز است ⇒ `omit`، و ‎view=sales‎ به آن‌جا می‌رود)
    && /<AppSubscriptions app="shop" groups=\{<SubGroups \/>\}( omit=\{\['sales'\]\})? \/>/.test(shopDesk) && !/\/subscriptions/.test(shopDesk));
  /*
   *  ⛔ «هیچ قابلیتی از دست نرود»: هر زبانهٔ بخشِ کهنه (و فروش) همین‌جا با
   *  `fixedApp` است — نه رونوشت. درخواستِ خرید فقط دکان (جدولش به shops بند است).
   */
  check('⛔ همهٔ قابلیت‌های بخشِ کهنه در بخشِ هر برنامه هست، با بخشِ ثابت',
    /<Customers fixedApp=\{app\} embedded \/>/.test(subs) && /<Plans fixedApp=\{app\} \/>/.test(subs)
    && /<Discounts fixedApp=\{app\} \/>/.test(subs) && /<VipCodes fixedApp=\{app\} \/>/.test(subs)
    && /app === 'shop' && <PurchaseRequests \/>/.test(subs) && /<Visitors fixedApp=\{app\} \/>/.test(subs)
    && /<SalesReps fixedApp=\{app\} \/>/.test(subs) && /<Sales fixedApp=\{app\} \/>/.test(subs));
  check('⇒ دادن، حذفِ حساب و کدِ آفلاین همان درهای پیشین‌اند',
    /import GrantSub from '\.\/GrantSub'/.test(read('pages/account/Customers.tsx'))
    && /import DeleteAccount from '\.\/DeleteAccount'/.test(read('pages/account/Customers.tsx'))
    && /<OfflineCodes key=\{app\} app=\{app\} \/>/.test(read('pages/account/VipCodes.tsx')));
  /*
   *  ⛔ هیچ لینکِ داخلیِ تازه‌ای به بخشِ برداشته‌شده نرود — جز خودِ مسیرِ
   *  سازگاری در App.tsx. لینکِ اشتراک فقط از `subsPath`.
   */
  const stray = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.tsx?$/.test(e.name) && !/App\.tsx$|subsPath\.ts$/.test(f)) {
        //  فقط کد، نه یادداشت‌ها — تاریخچهٔ نوشته‌شده در یادداشت لینک نیست
        const src = fs.readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/.*$/gm, '$1');
        if (/['"`]\/(subscriptions|customers|plans|vip-codes|discounts|visitors)\b/.test(src)) stray.push(path.relative(webSrc, f));
      }
    }
  };
  walk(webSrc);
  check('⛔ هیچ لینکِ داخلی به نشانی‌های کهنهٔ اشتراک نمانده', stray.length === 0, stray.join(', '));
  check('⇒ «مدیریتِ اشتراک»ِ جدولِ پمپ به زبانهٔ اشتراکِ همان بخش می‌رود',
    /subsPath\('pump', 'subs', q\)/.test(read('pages/StationsCloud.tsx')));
  check('⇒ جست‌وجوی Ctrl+K «اشتراک» را به هر دو بخش می‌برد',
    /PALETTE_EXTRA/.test(layout) && /subsPath\('pump'\)/.test(layout) && /subsPath\('shop'\)/.test(layout));
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

/*
 *  ⛔ رفتارِ نشانی‌ها، نه فقط متنشان: خودِ `subsPath.ts` با Node اجرا می‌شود
 *  (فایل عمداً بی import و فقط با نحوِ حذف‌شدنیِ TypeScript نوشته شده).
 */
{
  let m = null;
  try { m = await import(new URL('file://' + path.join(webSrc, 'pages', 'account', 'subsPath.ts')).href); }
  catch (e) { console.log('   ', e.message); }
  check('subsPath.ts با Node اجرا می‌شود', Boolean(m && m.legacySubsTarget && m.subsPath));
  if (m) {
    const CASES = [
      //  [search, defaultView, انتظار]
      ['?app=pump', 'subs', '/stations#subs'],
      ['?app=pump&q=a%40b.af', 'subs', '/stations?q=a%40b.af#subs'],
      ['?app=shop', 'subs', '/shop?tab=subs'],
      ['?app=shop&tab=plans', 'subs', '/shop?tab=subs&view=plans'],
      ['?tab=plans&app=pump', 'subs', '/stations?view=plans#subs'],
      ['?app=pump', 'codes', '/stations?view=codes#subs'],          // /vip-codes?app=pump
      ['?app=shop&tab=visitors', 'subs', '/shop?tab=subs&view=visitors'], // /customers?tab=visitors&app=shop
      ['?app=pump&tab=reps', 'subs', '/stations?view=reps#subs'],
      ['?tab=requests', 'plans', '/shop?tab=subs&view=requests'],     // درخواستِ خرید فقط دکان
      ['?app=pump&tab=requests', 'subs', '/stations#subs'],          // پمپ درخواستِ خرید ندارد ⇒ اشتراک‌ها
      ['?app=shop&tab=bogus', 'discounts', '/shop?tab=subs&view=discounts'],
      ['?app=station', 'subs', null],                                // بخشِ ناشناخته ⇒ «کدام برنامه؟»
      ['', 'subs', null],
      ['?tab=plans', 'subs', null],
    ];
    const bad = CASES.filter(([s, d, want]) => m.legacySubsTarget(s, d) !== want)
      .map(([s, d, want]) => `${s || '∅'}|${d} ⇒ ${m.legacySubsTarget(s, d)} (باید ${want})`);
    check(`⛔ هر نشانیِ کهنه به همان برنامه و همان زبانه می‌رسد (${CASES.length} حالت)`, bad.length === 0, bad.join(' · '));
    check('⇒ پمپ «درخواستِ خرید» و «سه گروه» ندارد؛ دکان دارد',
      !m.viewsOf('pump').includes('requests') && !m.viewsOf('pump').includes('groups')
      && m.viewsOf('shop').includes('requests') && m.viewsOf('shop').includes('groups'));
    check('⇒ هر دو بخش پلن، تخفیف، کد، بازدیدکننده، نماینده و فروش دارند',
      ['subs', 'plans', 'discounts', 'codes', 'visitors', 'reps', 'sales']
        .every((v) => m.viewsOf('pump').includes(v) && m.viewsOf('shop').includes(v)));
  }
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

/*
 *  ══ 🏪 کنسولِ فروشگاه — فاز ۲ ِ پنلِ مرکزیِ مالک (OWNER-CONSOLE-AUDIT §۸) ══
 *  ⛔ «نیامده = —، نه صفر» روی **خودِ کد** (`consoleData.ts` با Node اجرا می‌شود)، و صفحه عددی نمی‌سازد.
 *  نسخهٔ کرومیومیِ همین قاعده‌ها: `test/shop-console-ui.mjs` (محلی، مثلِ `control-ui`).
 */
{
  console.log('\n── کنسولِ فروشگاه (فاز ۲) ──');
  let m = null;
  try { m = await import(new URL('file://' + path.join(webSrc, 'pages', 'account', 'consoleData.ts')).href); }
  catch (e) { console.log('   ', e.message); }
  check('consoleData.ts با Node اجرا می‌شود', Boolean(m && m.shown && m.stampOf && m.CONSOLE));
  if (m) {
    const absent = [undefined, null, '', NaN, 'abc', true, Infinity];
    check('⛔ نیامده «—» است: undefined · null · \'\' · NaN · متن · بولی · بی‌نهایت',
      absent.every((v) => m.shown(v) === '—' && m.num(v) === null), absent.map((v) => m.shown(v)).join(' '));
    check('⛔ و صفرِ واقعی «۰» است، نه «—»', m.shown(0) === '۰' && m.num(0) === 0 && m.shown('0') === '۰', m.shown(0));
    check('⇒ بایتِ نیامده «—»، نه «0 B»', m.bytes(undefined) === '—' && m.bytes(null) === '—' && m.bytes(0) !== '—');
    const st1 = m.stampOf({ checkedAt: 100, fetchedAt: 900 });
    const st2 = m.stampOf({ fetchedAt: 900 });
    const st3 = m.stampOf({ serverTime: 50 });
    check('⛔ زمان: سنجیدهٔ سرورِ حساب جلوتر از رسیدن به پنل؛ هیچ‌کدام ⇒ null (نه «همین حالا»)',
      st1?.kind === 'server' && st1.at === 100 && st2?.kind === 'panel' && st2.at === 900 && st3?.kind === 'server'
        && m.stampOf({}) === null && m.stampOf(null) === null && m.stampOf({ checkedAt: 0 }) === null, JSON.stringify([st1, st2, st3]));
    check('⇒ «چند دقیقه پیش» برای زمانِ نیامده null است', m.minutesAgo(undefined, 1e6) === null && m.minutesAgo(1e6 - 180e3, 1e6) === 3);
    check('⛔ «ناشناخته» هرگز سبز نیست؛ فقط live ِ سرویس سبز است',
      m.healthTone('unknown') === 'neutral' && m.healthTone(undefined) === 'neutral' && m.healthTone('ok') === 'good'
        && m.providerTone('mock') !== 'good' && m.providerTone('none') !== 'good' && m.providerTone('live') === 'good');
    check('⇒ «داده در دسترس نیست» با `available: false` شناخته می‌شود، نه با نبودِ داده',
      m.isUnavailable({ available: false, capability: 'x' }) && !m.isUnavailable({}) && !m.isUnavailable(null) && !m.isUnavailable({ available: true }));
    check('⛔ شناسه در نشانیِ پل کدگذاری می‌شود', m.CONSOLE.shopHealth('a/b') === '/api/account-admin/console/shops/a%2Fb/health'
      && m.CONSOLE.liftHold('a/b', 'h/1') === '/api/account-admin/console/shops/a%2Fb/holds/h%2F1/lift');
    //  چسبِ فاز ۳ — همان قاعده‌های سرورِ حساب، روی خودِ کد
    check('⛔ چهار حالت + بایگانی، همان نام‌های ‎lib/shop-holds.js‎؛ «پایانِ اشتراک» پول‌مجاور است',
      JSON.stringify(m.HOLD_KINDS) === JSON.stringify(['access_suspended', 'service_disabled', 'subscription_ended', 'deletion_requested', 'archived'])
        && JSON.stringify(m.MONEY_HOLDS) === JSON.stringify(['subscription_ended']) && m.HOLD_SERVICES.length === 5);
    check('⛔ دلیل ۳ تا ۲۰۰ نویسه (همان مرزِ سرورِ حساب)',
      !m.reasonOk('') && !m.reasonOk('  ab  ') && m.reasonOk('abc') && m.reasonOk('x'.repeat(200)) && !m.reasonOk('x'.repeat(201)) && !m.reasonOk(undefined));
    const k1 = m.newIdemKey();
    check('کلیدِ یکتایی: شکلِ پذیرفتهٔ سرورِ حساب و هر بار تازه', /^[A-Za-z0-9_.:-]{8,128}$/.test(k1) && k1 !== m.newIdemKey(), k1);
    check('⛔ صفحهٔ بعدیِ تاریخچه فقط وقتی صفحه پر آمده؛ وگرنه null',
      m.nextBefore([{ at: 9 }, { at: 5 }], 2) === 5 && m.nextBefore([{ at: 9 }], 2) === null && m.nextBefore(undefined, 2) === null
        && m.nextBefore([{ at: 9 }, {}], 2) === null);
    check('⛔ مقدارِ پرچمِ نیامده «—»؛ false و null و ۰ همان خودشان',
      m.flagValue(undefined) === '—' && m.flagValue(false) === 'false' && m.flagValue(null) === 'null' && m.flagValue(0) === '0');
    check('⇒ «انجام‌دهنده»: آدمِ پشتِ پنل اگر سرورِ حساب گفته؛ وگرنه شناسهٔ مدیر؛ هیچ ⇒ «—»',
      m.actorLabel({ name: 'کریم', id: 'panel:2' }, 'svk1') === 'کریم' && m.actorLabel(null, 'adm1') === 'adm1' && m.actorLabel(undefined, '') === '—');
    //  هر درِ کنسول که صفحه صدا می‌زند، در فهرستِ سفیدِ پل هست
    const bridge = fs.readFileSync(path.join(here, '..', 'src', 'routes', 'account-admin.js'), 'utf8');
    const wanted = ['system/health', 'system/providers', 'system/versions', 'system/chain-verify', 'release/beta', 'capabilities',
      'version-health', 'live-config', 'shops/:id/health', 'shops/:id/holds', 'shops/:id/holds/:holdId/lift', 'flags', 'flags/history',
      'service-key', 'service-key/revoke'];
    const lost = wanted.filter((w) => !bridge.includes(`'/console/${w}'`));
    check('هر درِ کنسول یک خطِ فهرستِ سفید دارد', lost.length === 0, lost.join(' '));
    check('⛔ درِ پیش‌نویسِ ‎/suspension‎ (هرگز در سرورِ حساب ساخته نشد) نه در پل است نه در صفحه',
      !bridge.includes("'/console/shops/:id/suspension'") && !('shopSuspension' in m.CONSOLE));
  }
  const con = read('pages/account/ShopConsole.tsx');
  check('⛔ کنسول خودش جمع نمی‌زند و نیامده را صفر نمی‌کند (نه reduce، نه «|| 0»، نه «?? 0»)',
    !/\.reduce\(/.test(con) && !/\|\|\s*0\b/.test(con) && !/\?\?\s*0\b/.test(con));
  check('⛔ هر کارت منبع و زمان دارد (SourceLine)، و خطا کدِ خودش را (Problem)',
    (con.match(/<SourceLine /g) || []).length >= 12 && /scErrorCode/.test(con) && /load\.code/.test(con));
  check('⛔ فاز ۳ ِ نیامده «داده در دسترس نیست» است (isUnavailable ⇒ NotAvailable)',
    (con.match(/isUnavailable\(/g) || []).length >= 3 && /NotAvailable/.test(con));
  check('⛔ کارِ پرهزینه تأیید می‌خواهد و نتیجهٔ سرور «تأییدشده» است', /ConfirmDialog/.test(con) && /scServerConfirmed/.test(con));
  check('⛔ کانالِ آزمایشی فقط برای admin درخواست می‌شود', /can\('admin'\) \? CONSOLE\.releaseBeta : null/.test(con));
  check('⛔ حالتِ دکان: پنجره با دلیلِ اجباری، اثرِ همان حالت، و یک کلیدِ یکتایی برای هر پنجره (نه هر کلیک)',
    /disabled=\{!reasonOk\(reason\) \|\| busy\}/.test(con) && /useState\(newIdemKey\)/.test(con) && /HOLD_EFFECT\[effective\]/.test(con)
      && /confirm: true, idempotencyKey: idem/.test(con));
  check('⛔ کلیدِ سرویس: صفحه هرگز خودِ کلید را نمی‌خواهد یا نشان نمی‌دهد (فقط فراداده) و ساختن رمزِ پنل می‌خواهد',
    !/vsk_/.test(con) && /type="password"/.test(con) && /d\.owner \?/.test(con));
  const tabs = ['dash', 'shops', 'subs', 'finance', 'versions', 'health', 'settings', 'integrations', 'audit', 'codes'];
  check(`میزِ فروشگاه همهٔ ${tabs.length} زبانه را دارد`, tabs.every((x) => shopDesk.includes(`'${x}'`)), tabs.filter((x) => !shopDesk.includes(`'${x}'`)).join(' '));
  check('⛔ «فروش و درآمد»ِ دکان یک در دارد: ‎view=sales‎ ⇒ زبانهٔ «مالی»',
    /omit=\{\['sales'\]\}/.test(shopDesk) && /tab=finance/.test(shopDesk));
  //  سه‌زبانه: هر کلیدِ کنسول در فارسی، انگلیسی و پشتو
  const i18n = read('i18n.ts');
  const keys = [...new Set([...con.matchAll(/t\('(sc[A-Za-z0-9]+)'\)/g), ...shopDesk.matchAll(/t\('(sc[A-Za-z0-9]+)'\)/g)].map((x) => x[1]))];
  const thin = keys.filter((k) => (i18n.match(new RegExp(`\\n  ${k}: '`, 'g')) || []).length < 3);
  check(`سه‌زبانه (فارسی، انگلیسی، پشتو): ${keys.length} کلیدِ کنسول`, keys.length > 50 && thin.length === 0, thin.join(' '));
}

/*
 *  ══ 🛠 ماژول‌های عملیات (۴.۸ · ۴.۹ · ۴.۱۰ · ۴.۱۱ · ۴.۱۳) — ‎ConsoleOps.tsx‎ و ‎routes/console-ops.js‎ ══
 *  همان قاعده‌های کنسول روی خودِ کد: عددی ساخته نمی‌شود، هر کارت منبع دارد، «توانایی» نیامده «در دسترس نیست»،
 *  نوشتنِ حساس با دلیل/تأیید/رمز، «برگشت» وانمود نمی‌شود، توکن در نشانی نمی‌رود، سه‌زبانه.
 */
{
  console.log('\n── کنسولِ فروشگاه: ماژول‌های عملیات ──');
  const ops = read('pages/account/ConsoleOps.tsx');
  const desk = read('pages/account/ShopDesk.tsx');
  const bridgeOps = fs.readFileSync(path.join(here, '..', 'src', 'routes', 'console-ops.js'), 'utf8');
  check('⛔ عملیات خودش جمع نمی‌زند و نیامده را صفر نمی‌کند (نه reduce، نه «|| 0»، نه «?? 0»)',
    !/\.reduce\(/.test(ops) && !/\|\|\s*0\b/.test(ops) && !/\?\?\s*0\b/.test(ops));
  check('⛔ هر کارت منبع و زمان (SourceLine) و خطا با کد (Problem)', (ops.match(/<SourceLine /g) || []).length >= 7 && (ops.match(/<Problem /g) || []).length >= 6);
  check('⛔ «توانایی» نیامده ⇒ «داده در دسترس نیست»', (ops.match(/isUnavailable\(/g) || []).length >= 5 && /capabilityMissing/.test(ops));
  check('⛔ انتشارِ مرحله‌ای: دلیل + رمز + confirm: true؛ دکمه فقط برای مالک/فنی (canChange)؛ «برگشت» فقط متنِ «پشتیبانی نمی‌شود»',
    /confirm: true, password/.test(ops) && /reasonOk\(reason\) && Boolean\(password\)/.test(ops) && /canChange/.test(ops)
      && /rollbackNo/.test(ops) && !/rollback'/.test(ops) && !/\/rollback/.test(ops));
  check('⛔ یادداشتِ رخداد با یک کلیدِ یکتایی برای هر یادداشت', /useState\(\(\) => newIdemKey\(\)\)/.test(ops) && /idempotencyKey: noteKey/.test(ops));
  check('⛔ بستنِ هشدار دلیل می‌خواهد', /ready=\{resolveOf \? reasonOk\(text\) : true\}/.test(ops));
  check('⛔ خروجیِ CSV با سرآیندِ Authorization، نه ‎?token=‎ در نشانی', /Authorization: `Bearer/.test(ops) && !/[?&]token=\$\{/.test(ops) && !/downloadUrl\(/.test(ops));
  const opsPaths = ['ops/releases', 'ops/health', 'ops/integrations', 'ops/incidents', 'ops/incidents.csv', 'ops/incidents/:id',
    'ops/incidents/:id/status', 'ops/incidents/:id/priority', 'ops/incidents/:id/notes', 'ops/incidents/:id/link', 'ops/alerts',
    'ops/alerts/evaluate', 'ops/alerts/:id/ack', 'ops/alerts/:id/resolve', 'ops/alerts/telegram', 'release/stage', 'release/stage/end'];
  const lostOps = opsPaths.filter((w) => !bridgeOps.includes(`'/console/${w}'`));
  check('هر درِ عملیات یک خطِ فهرستِ سفید در پل دارد', lostOps.length === 0, lostOps.join(' '));
  check('⛔ رمزِ احرازِ دوباره به سرورِ حساب نمی‌رود (بدنهٔ بالادستِ مرحله فقط همان چهار فیلد)',
    /cloudRaw\('PUT', '\/api\/admin\/release\/stage', \{ body: input \}\)/.test(bridgeOps) && /return \{ tag, version, percent, reason \}/.test(bridgeOps));
  check('میزِ فروشگاه زبانه‌های «رخدادها» و «هشدارها» را دارد', ["'incidents'", "'alerts'"].every((x) => desk.includes(x)) && /<IncidentsTab /.test(desk) && /<AlertsTab /.test(desk));
  let tr = null;
  try { tr = await import(new URL('file://' + path.join(webSrc, 'pages', 'account', 'consoleOpsI18n.ts')).href); }
  catch (e) { console.log('   ', e.message); }
  const used = [...new Set([...ops.matchAll(/\bt\('([A-Za-z_0-9]+)'/g)].map((x) => x[1]))];
  const dyn = ['st_ok', 'st_warn', 'st_down', 'st_unknown', 'inc_open', 'inc_investigating', 'inc_resolved', 'al_open', 'al_acknowledged',
    'al_resolved', 'sev_critical', 'sev_high', 'sev_medium', 'sev_low', 'rs_ok', 'rs_unavailable', 'rs_error', 'wh_live', 'wh_blocked',
    'wh_unknown', 'ev_created', 'ev_status', 'ev_priority', 'ev_note', 'ev_link', 'ev_reopened'];
  const thinOps = tr ? [...used, ...dyn].filter((k) => ['fa', 'en', 'ps'].some((l) => {
    const v = tr.opsText(l, k);
    return !v || (l !== 'en' && v === k) || (l !== 'en' && v === tr.opsText('en', k) && !/^[A-Za-z0-9 ()·.,%‎-]+$/.test(v));
  })) : ['(import failed)'];
  check(`سه‌زبانه (فارسی، انگلیسی، پشتو): ${used.length + dyn.length} کلیدِ عملیات`, used.length > 60 && thinOps.length === 0, thinOps.join(' '));
}

console.log('\n════════════════════════════════════');
console.log(`  ✅ ${pass} سبز، ${fail} قرمز`);
console.log('════════════════════════════════════\n');
process.exit(fail === 0 ? 0 : 1);
