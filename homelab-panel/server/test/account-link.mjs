// ---------------------------------------------------------------------------
//  پلِ «پمپ‌ها» به سرورِ حساب — از همین کامپیوتر، با ورودِ خودکار
//      node test/account-link.mjs
//
//  چرا این آزمون هست: اپِ مدیریت روی گوشی «از ابر جواب نگرفتیم — هنوز به
//  سرورِ ابر وصل نشده‌اید» نشان می‌داد، در حالی که سرورِ حساب روی همان
//  کامپیوترِ خانگی روشن بود. دو ریشه داشت: پل از راهِ اینترنت و تونل به
//  خودش برمی‌گشت، و توکنِ مدیر دوازده‌ساعته بود و کسی نبود دوباره وارد شود.
//
//  این‌جا خودِ پنل بالا می‌آید با یک سرورِ حسابِ ساختگی که ورودِ مدیر، توکنِ
//  منقضی، رمزِ غلط و خاموش بودن را بازی می‌کند.
// ---------------------------------------------------------------------------
import http from 'node:http';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PANEL = Number(process.env.TEST_PORT || 4881);
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'acct-link-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 240)}`);
};

/** کلیدِ همهٔ ردیف‌های عیب‌یابی — فقط برای پیامِ خطا، وقتی ردیف پیدا نشد. */
const diagKeys = (d) => (d.json?.checks || []).map((c) => c.key);

// ── ۰) قاعدهٔ نشانی — بی سرور ───────────────────────────────────────────────
console.log('\n── نشانی‌ای که پل می‌زند ──');
{
  process.env.HLP_DATA_DIR = path.join(tmp, 'unit');
  process.env.HLP_ACCOUNT_API = '0';
  const { cloudTarget, CLOUD_BASE } = await import('../src/stations/cloud.js');
  check('درگاه خاموش ⇒ راهِ تونل، همان نشانیِ قفل', cloudTarget() === CLOUD_BASE, cloudTarget());
  check('نشانیِ عمومی همچنان قفل است', CLOUD_BASE === 'https://api.vill3n.top');
}

// ── ۱) سرورِ حسابِ ساختگی ───────────────────────────────────────────────────
const seen = { logins: [], calls: [] };
let valid = new Set();     // توکن‌های زنده
let rejectLogin = false;   // رمز را رد کن
let limitLogin = false;    // سقفِ نرخ را پر کن (۴۲۹)
let limitRetryAfter = 1;   // ثانیه‌ای که سرور می‌گوید
/*
 *  ⛔ **ورودِ ساختگی عمداً مکث می‌کند** — وگرنه پنجرهٔ هم‌زمانی هیچ‌وقت
 *  دیده نمی‌شود و بندِ «ازدحامِ سرد» سبزِ دروغ می‌دهد.
 *
 *  سنجیده شد، فرض نشد: با ورودِ آنی، همان شش درخواست بی هیچ مهاری گاهی
 *  ۲ ورود می‌زدند و گاهی ۳ — یعنی نتیجه به سرعتِ ماشین بند بود و روی
 *  رانرِ CI می‌توانست ۱ بشود. با مکث، بی مهار همیشه ۶ است و با مهار
 *  همیشه ۱. همان درسِ `_slowMs`ِ ابرِ ساختگی در ریپوی پمپ.
 */
let loginDelayMs = 0;
/*  ۴۰۱ِ دیررس — فقط برای مسیرِ `users`، تا بندِ «۴۰۱ِ دیررس» قطعی باشد. */
let slow401Ms = 0;
let n = 0;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const p = req.url.split('?')[0];
    res.setHeader('content-type', 'application/json');
    if (p === '/api/health') return res.end(JSON.stringify({ ok: true, server: 'online', version: '9.9.9' }));
    if (p === '/api/admin/login' && req.method === 'POST') {
      const b = JSON.parse(body || '{}');
      seen.logins.push(b);
      //  سقفِ نرخِ واقعیِ سرورِ حساب: ۴۲۹ با `rate_limited` و `Retry-After`
      if (limitLogin) {
        res.statusCode = 429;
        res.setHeader('Retry-After', String(limitRetryAfter));
        return res.end(JSON.stringify({ error: { code: 'rate_limited', message: 'تعداد درخواست بیش از حد مجاز است' } }));
      }
      if (rejectLogin || b.username !== 'boss' || b.password !== 'top-secret') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: { code: 'bad_credentials', message: 'نام کاربری یا رمز درست نیست' } }));
      }
      const token = `tok-${++n}`;
      valid.add(token);
      const done = () => res.end(JSON.stringify({ token, expiresAt: Date.now() + 12 * 3600e3, admin: { username: 'boss' } }));
      return loginDelayMs ? setTimeout(done, loginDelayMs) : done();
    }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    seen.calls.push({ path: p, bearer });
    if (!valid.has(bearer)) {
      res.statusCode = 401;
      const deny = () => res.end(JSON.stringify({ error: { code: 'unauthorized', message: 'احراز هویت لازم است' } }));
      return slow401Ms && p === '/api/admin/pump/users' ? setTimeout(deny, slow401Ms) : deny();
    }
    if (p === '/api/admin/pump/stats') return res.end(JSON.stringify({ stations: 3, users: 5, files: 7 }));
    if (p === '/api/admin/pump/users') return res.end(JSON.stringify({ users: [{ id: 'u1', name: 'کریم' }] }));
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { code: 'not_found', message: 'این مسیر وجود ندارد' } }));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const FAKE_URL = `http://127.0.0.1:${fake.address().port}`;

// ── ۲) خودِ پنل، با ورودِ خودکار ────────────────────────────────────────────
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  env: { ...process.env, HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PANEL + 1),
         HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
         HLP_ACCOUNT_API: FAKE_URL,
         HLP_ACCOUNT_ADMIN_USER: 'boss', HLP_ACCOUNT_ADMIN_PASSWORD: 'top-secret' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const BASE = `http://127.0.0.1:${PANEL}`;
async function api(method, p, body, headers = {}) {
  const res = await fetch(BASE + p, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* بدنهٔ غیرِ JSON */ }
  return { status: res.status, json };
}

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  await api('POST', '/api/auth/setup', { username: 'admin', password: 'Link-1405-test' });
  const login = await api('POST', '/api/auth/login', { username: 'admin', password: 'Link-1405-test' });
  const auth = { Authorization: `Bearer ${login.json?.token}` };
  check('ورود به پنل', Boolean(login.json?.token), JSON.stringify(login.json));

  console.log('\n── حالِ پل ──');
  const st = await api('GET', '/api/stations-admin/cloud/status', undefined, auth);
  check('linked بی هیچ ورودِ دستی راست است (ورودِ خودکار)', st.json?.linked === true && st.json?.auto === true, JSON.stringify(st.json));
  check('پل از همین کامپیوتر می‌زند، نه از تونل', st.json?.local === true && st.json?.target === FAKE_URL, JSON.stringify(st.json));
  check('نشانیِ عمومی همچنان قفل است', st.json?.base === 'https://api.vill3n.top');
  check('هیچ توکنی در گاوصندوق ننشسته — ورودِ خودکار فقط در حافظه است', !st.json?.updatedAt, JSON.stringify(st.json));

  console.log('\n── خواندن با ورودِ خودکار ──');
  const stats = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  check('آمار از سرورِ حساب آمد', stats.status === 200 && stats.json?.stations === 3, `${stats.status} ${JSON.stringify(stats.json)}`);
  check('پل خودش یک بار وارد شد، با همان نام و رمزِ .env',
    seen.logins.length === 1 && seen.logins[0].username === 'boss' && seen.logins[0].password === 'top-secret');
  check('و درخواست با همان توکن رفت', seen.calls.at(-1)?.bearer === 'tok-1' && seen.calls.at(-1)?.path === '/api/admin/pump/stats');
  const users = await api('GET', '/api/stations-admin/cloud/users?limit=5', undefined, auth);
  check('بارِ دوم دوباره وارد نمی‌شود — توکن در حافظه است', users.status === 200 && seen.logins.length === 1, `${seen.logins.length} ورود`);

  console.log('\n── توکنِ مدیر مرد (دوازده ساعت گذشت) ──');
  valid.clear();
  const again = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  check('۴۰۱ ⇒ یک بار دوباره وارد می‌شود و جواب می‌آید', again.status === 200 && again.json?.users === 5, `${again.status} ${JSON.stringify(again.json)}`);
  check('دقیقاً یک ورودِ تازه، نه حلقه', seen.logins.length === 2, `${seen.logins.length} ورود`);
  check('و با توکنِ تازه', seen.calls.at(-1)?.bearer === 'tok-2');

  console.log('\n── رمزِ .env غلط است ──');
  valid.clear();
  rejectLogin = true;
  const bad = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  check('«ورودِ خودکار رد شد» با راهِ درست کردن، نه ۴۰۱ِ گنگ',
    bad.status === 409 && bad.json?.error === 'auto_login_rejected' && /HLP_ACCOUNT_ADMIN/.test(bad.json?.message || ''),
    `${bad.status} ${JSON.stringify(bad.json)}`);
  check('پیام نمی‌گوید «ابر»', !/ابر/.test(bad.json?.message || ''), bad.json?.message);
  rejectLogin = false;
  const back = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  check('رمز که درست شد، بی راه‌اندازیِ دوباره وصل می‌شود', back.status === 200, String(back.status));

  // ── سقفِ نرخ: پنل نباید خودش را بیرون بگذارد ───────────────────────────
  //  گزارشِ صاحب سامانه با عکس: «ورود خودکار به سرور حساب نشد: تعداد
  //  درخواست بیش از حد مجاز است» و هر چهار شمارندهٔ کدها صفر.
  //
  //  زنجیرهٔ مرگ: هر خطا کَشِ توکن را پاک می‌کرد ⇒ درخواستِ بعدی لاگینِ
  //  تازه می‌زد ⇒ ۴۲۹ ⇒ کَش پاک… و پنجرهٔ ربع‌ساعته هیچ‌وقت خالی نمی‌شد.
  console.log('\n── سقفِ نرخِ سرورِ حساب ──');

  //  توکنِ سالمی در حافظه هست (بندهای بالا). حالا سقف پر می‌شود و
  //  توکن هم باطل — پس پل مجبور است دوباره وارد شود.
  valid.clear();
  limitLogin = true;
  limitRetryAfter = 1;
  const before = seen.logins.length;
  const r1 = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  check('۴۲۹ِ سقفِ نرخ «رمز را بسنج» نمی‌گوید — آدم را گمراه نکند',
    !/HLP_ACCOUNT_ADMIN/.test(r1.json?.message || '') && /سقفِ نرخ/.test(r1.json?.message || ''),
    `${r1.status} ${JSON.stringify(r1.json)}`);

  //  ⛔ قلبِ ماجرا: ده درخواستِ پشتِ سرِ هم داخلِ مهلت **یک** لاگین هم
  //  اضافه نمی‌کند. پیش از اصلاح، هر کدام یک لاگینِ تازه می‌زد و سقف
  //  هیچ‌وقت خالی نمی‌شد.
  for (let i = 0; i < 10; i++) {
    await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  }
  const added = seen.logins.length - before;
  check('⛔ داخلِ مهلت، ده درخواست حتی یک لاگینِ تازه نمی‌زند',
    added <= 1, `${added} لاگین در ۱۱ درخواست`);

  //  و مهلت از حرفِ خودِ سرور می‌آید: Retry-After یک ثانیه بود، پس
  //  کمی بعد باید دوباره تلاش کند — نه دو دقیقهٔ پیش‌فرض.
  limitLogin = false;
  await new Promise((r) => setTimeout(r, 2200));
  const r2 = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  check('Retry-Afterِ سرور محترم است — پس از آن خودش وصل می‌شود',
    r2.status === 200 && r2.json?.stations === 3, `${r2.status} ${JSON.stringify(r2.json)}`);

  //  ⛔ و ۴۲۹ توکنِ سالمِ حافظه را نمی‌سوزاند: سقف که پر شود ولی توکن
  //  زنده باشد، درخواست باید همان‌طور جواب بگیرد.
  limitLogin = true;
  const r3 = await api('GET', '/api/stations-admin/cloud/users', undefined, auth);
  check('۴۲۹ توکنِ زندهٔ حافظه را پاک نمی‌کند', r3.status === 200, `${r3.status} ${JSON.stringify(r3.json)}`);
  limitLogin = false;

  // ── ازدحامِ سرد: چند درخواستِ هم‌زمان، یک ورود ────────────────────────
  /*
   *  گزارشِ صاحب سامانه با عکس (۱۴۰۵/۰۷/۱۰): «کدها لایو آپدیت نمی‌شوند»
   *  و «فروشگاه هر سه تا بخشش را نشان نمی‌دهد» — و روی **هر دو** صفحه
   *  همان نوارِ «تعداد درخواست بیش از حد مجاز است».
   *
   *  ⛔ مهلتِ بالا تلاش‌های **پشتِ سرِ هم** را مهار می‌کرد و تلاش‌های
   *  **هم‌زمان** را نه. با توکنِ مرده، هر درخواستی که همان لحظه در راه
   *  بود خودش یک ورود می‌زد — و پنل با باز شدنِ یک صفحه چند درخواست
   *  هم‌زمان دارد (دو دفترِ کد، حالِ رباتِ ایمیل، میزِ فروشگاه، دیدبانِ
   *  ده‌ثانیه‌ای، سه ربات). سقفِ سرورِ حساب ده در ربع ساعت است، پس یک
   *  ازدحام آن را پر می‌کرد و پنجره هیچ‌وقت خالی نمی‌شد.
   *
   *  ⚠️ و این با **آهنگِ واقعیِ همان مشتری** سنجیده می‌شود، نه با یک
   *  حلقهٔ دستی: درخواست‌ها با `Promise.all` هم‌زمان می‌روند، همان‌طور
   *  که مرورگر و ربات‌ها می‌فرستند. همان درسِ «نبضِ کلیدِ مرده».
   */
  console.log('\n── ازدحامِ سرد ──');
  valid.clear();                       //  توکنِ حافظه مرد (دوازده ساعت گذشت)
  loginDelayMs = 300;                  //  ⛔ پنجره واقعاً باز باشد، وگرنه سبزِ دروغ
  const beforeRush = seen.logins.length;
  const rush = await Promise.all([
    api('GET', '/api/stations-admin/cloud/stats', undefined, auth),
    api('GET', '/api/stations-admin/cloud/users', undefined, auth),
    api('GET', '/api/stations-admin/cloud/stats', undefined, auth),
    api('GET', '/api/stations-admin/cloud/users', undefined, auth),
    api('GET', '/api/stations-admin/cloud/stats', undefined, auth),
    api('GET', '/api/stations-admin/cloud/users', undefined, auth),
  ]);
  const rushLogins = seen.logins.length - beforeRush;
  check('⛔ شش درخواستِ هم‌زمان با توکنِ مرده ⇒ فقط **یک** ورود',
    rushLogins === 1, `${rushLogins} ورود در ۶ درخواستِ هم‌زمان`);
  check('و هر شش‌تا جواب گرفتند — تک‌پروازی چیزی را نخواباند',
    rush.every((r) => r.status === 200), rush.map((r) => r.status).join(','));

  //  ⛔ و ازدحامِ دوم هم همان یک ورود را بس می‌داند: توکنِ تازه در حافظه
  //  است و هیچ‌کس دوباره وارد نمی‌شود.
  loginDelayMs = 0;
  const beforeRush2 = seen.logins.length;
  await Promise.all([
    api('GET', '/api/stations-admin/cloud/stats', undefined, auth),
    api('GET', '/api/stations-admin/cloud/users', undefined, auth),
    api('GET', '/api/stations-admin/cloud/stats', undefined, auth),
  ]);
  check('ازدحامِ دوم هیچ ورودی نمی‌زند — توکن در حافظه است',
    seen.logins.length === beforeRush2, `${seen.logins.length - beforeRush2} ورود`);

  /*
   *  ⛔ **۴۰۱ِ دیررس هم ورودِ دوم نمی‌سازد.**
   *
   *  تک‌پروازیِ بالا فقط درخواست‌هایی را جمع می‌کند که **وسطِ** یک ورود
   *  برسند. ولی `force` سنجشِ تازگی را دور می‌زند، پس درخواستی که ۴۰۱ش
   *  **پس از** پایانِ آن ورود برسد، برای توکنی که چند میلی‌ثانیه پیش
   *  ساخته شده باز هم وارد می‌شد. (سنجیده شد: پیش از نگهبانِ `stale`،
   *  همین بند دو ورود می‌داد.)
   *
   *  ⚠️ این‌جا ۴۰۱ِ مسیرِ `users` عمداً دیر می‌آید، وگرنه این پنجره به
   *  سرعتِ ماشین بند می‌شد — همان قاعدهٔ «ساعتِ دیوار را از سنجه بیرون
   *  کنید».
   */
  valid.clear();
  slow401Ms = 400;
  const beforeLate = seen.logins.length;
  const late = await Promise.all([
    api('GET', '/api/stations-admin/cloud/stats', undefined, auth),  // ۴۰۱ِ فوری ⇒ ورود
    api('GET', '/api/stations-admin/cloud/users', undefined, auth),  // ۴۰۱ِ دیررس
  ]);
  slow401Ms = 0;
  check('⛔ ۴۰۱ِ دیررس توکنِ تازه را دور نمی‌ریزد — باز هم یک ورود',
    seen.logins.length - beforeLate === 1, `${seen.logins.length - beforeLate} ورود`);
  check('و هر دو جواب گرفتند', late.every((r) => r.status === 200), late.map((r) => r.status).join(','));

  console.log('\n── سنجهٔ «چرا کار نمی‌کند» ──');
  const row = async () => {
    const d = await api('GET', '/api/diagnostics', undefined, auth);
    return (d.json?.checks || []).find((c) => c.key === 'accountServer');
  };

  /*
   *  ⛔ **دو حال، و هر دو سنجیده می‌شود.**
   *
   *  تا ۱۴۰۵/۰۷/۰۷ این ردیف با رباتِ ایمیلِ تنظیم‌نشده هم **سبز** بود —
   *  همان «کلکِ دروغ»ی که در این ریپو قدغن است: کدِ شش‌رقمیِ ثبت‌نام و
   *  ورود ساخته می‌شود و به دستِ هیچ‌کس نمی‌رسد، و عیب‌یابی می‌گفت
   *  همه‌چیز خوب است. حالا `warn` می‌دهد.
   *
   *  ⚠️ **و همان اصلاح این سنجه را سرخ کرد** و درست هم کرد: این آزمون
   *  SMTP ندارد، پس حالِ **درستش** `warn` است و ادعای «سبز است» کهنه
   *  شده بود. ⛔ ولی پاک کردنش غلط بود — با آن، هیچ آزمونی راهِ **سبز**
   *  را نمی‌سنجید. پس هر دو حال این‌جا می‌آید.
   */
  const warnRow = await row();
  check('سرورِ حساب یک ردیف در عیب‌یابی دارد', Boolean(warnRow), JSON.stringify(diagKeys(await api('GET', '/api/diagnostics', undefined, auth))));
  check('بی SMTP، هشدار می‌دهد — نه سبزِ دروغ',
    warnRow?.state === 'warn' && /9\.9\.9/.test(warnRow?.value || '') && /ایمیل/.test(warnRow?.value || ''),
    JSON.stringify(warnRow));
  check('و راهِ درست کردنش را می‌گوید', /کدهای شش‌رقمی/.test(warnRow?.hint || ''), warnRow?.hint);

  //  ⛔ حالا SMTPِ خودِ پنل نوشته می‌شود — همان چیزی که سرورِ حساب هم از
  //  آن می‌گیرد (`mailEnvForChild`). از این پس ردیف باید **واقعاً** سبز شود.
  const setMail = await api('PUT', '/api/codes-admin/settings', {
    email: { host: 'smtp.example.com', port: 587, secure: false, username: 'u', password: 'p', from: 'codes@example.com', fromName: 'کدها' },
  }, auth);
  check('SMTPِ پنل نوشته شد', setMail.status === 200, JSON.stringify(setMail.json));

  const goodRow = await row();
  check('با SMTP، سبز می‌شود و نسخهٔ واقعیِ سرور را می‌گوید',
    goodRow?.state === 'good' && /9\.9\.9/.test(goodRow?.value || ''), JSON.stringify(goodRow));
  check('و پیامِ سبز از «ایمیل تنظیم نیست» حرفی نمی‌زند',
    !/ایمیل تنظیم نیست/.test(goodRow?.value || ''), goodRow?.value);

  console.log('\n── سرورِ حساب خاموش شد ──');
  await new Promise((r) => fake.close(r));
  const down = await api('GET', '/api/stations-admin/cloud/stats', undefined, auth);
  //  ⚠️ «docker compose» دیگر در پیام نیست (۱.۳۸.۰): ناظرِ سرورِ حساب می‌گوید
  //  چرا — این‌جا «نصب نیست»، چون HLP_ACCOUNT_DIR داده نشده.
  check('۵۰۳ِ account_server_down با راهِ درست کردنش',
    down.status === 503 && down.json?.error === 'account_server_down' && /سرورِ حساب/.test(down.json?.message || '') && !/docker/.test(down.json?.message || ''),
    `${down.status} ${JSON.stringify(down.json)}`);
  const diag2 = await api('GET', '/api/diagnostics', undefined, auth);
  const acct2 = (diag2.json?.checks || []).find((c) => c.key === 'accountServer');
  check('عیب‌یابی هم سرخ می‌شود و همان راه را می‌گوید', acct2?.state === 'bad' && /نصب نیست/.test(acct2?.hint || ''), JSON.stringify(acct2));
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} سبز، ${fail} سرخ`);
if (fail) { console.log(out.slice(-3000)); process.exit(1); }
