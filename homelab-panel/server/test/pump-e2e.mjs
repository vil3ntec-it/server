// ---------------------------------------------------------------------------
//  برنامهٔ پمپ، از راهِ تونل — هر درخواستی که واقعاً می‌زند
//      node test/pump-e2e.mjs
//
//  ── چرا این آزمون لازم بود ──────────────────────────────────────────────
//  صاحب سامانه چند سیزن پشتِ سرِ هم یک جمله را گفت: «برنامهٔ پمپ به سرور
//  وصل نمی‌شود.» و هر بار دو طرف **جدا** سبز بودند:
//
//    • ریپوی پمپ همان درخواست‌ها را روی shop/serverِ **مستقیم** می‌زد ⇒ ۱۳ سبز
//    • این ریپو درگاه را با یک سرورِ حسابِ **ساختگی** می‌سنجید ⇒ سبز
//    • و ‎account-supervisor.mjs‎ با shopِ واقعی فقط دو مسیر را می‌زد
//      (‎register/start‎ و یک ورودِ غلط)
//
//  یعنی هیچ‌کس **کلِ زنجیره** را با **همهٔ** مسیرهای واقعیِ آن برنامه
//  نسنجیده بود. و شکافِ واقعی هم همان‌جا بود: فهرستِ سفیدِ درگاه با
//  ‎apiRouter‎ی shop یکی نبود، پس چند مسیر از تونل «not found» می‌گرفتند
//  در حالی که خودِ سرورِ حساب سالم بود و هیچ آزمونی در هیچ‌یک از دو ریپو
//  نمی‌توانست ببیندش.
//
//  این‌جا پنلِ واقعی بالا می‌آید، خودش سرورِ حسابِ **واقعی** را روی PGlite
//  روشن می‌کند، و بعد هر مسیری که ‎CloudLink.cs‎ می‌زند از **پورتِ عمومی**
//  — همان چیزی که تونل می‌بیند — با همان بدنه و همان سرآیندها زده می‌شود.
//
//  ⛔ و بندِ آخر خودنگهدار است: فهرستِ پیشوندهای درگاه با خودِ
//  ‎shop/server/src/app.js‎ سنجیده می‌شود، نه با یک کپیِ دستی. پیشوندِ
//  تازه‌ای که آن‌طرف سوار شود، همین‌جا سرخ می‌شود.
//
//  ⚠️ کدِ سرورِ حساب از ACCOUNT_SERVER_DIR یا HLP_ACCOUNT_DIR می‌آید، یا از
//  ریپوی خواهرِ shop کنارِ این ریپو. نبودش این سنجه را «رد» می‌کند، نه قرمز.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNT_PREFIXES } from '../src/api/account-proxy.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const candidates = [
  process.env.ACCOUNT_SERVER_DIR,
  process.env.HLP_ACCOUNT_DIR,
  path.resolve(here, '..', '..', 'account-server'),
  path.resolve(here, '..', '..', '..', '..', 'shop', 'server'),
  path.resolve(here, '..', '..', '..', '..', 'vil3ntec-it', 'shop', 'server'),
].filter(Boolean);
const ACCOUNT_DIR = candidates.find(
  (d) => fs.existsSync(path.join(d, 'src', 'index.js')) && fs.existsSync(path.join(d, 'node_modules')));

if (!ACCOUNT_DIR) {
  console.log('⚠️  کدِ سرورِ حساب پیدا نشد (HLP_ACCOUNT_DIR یا ../shop/server با node_modules) — این سنجه رد شد.');
  process.exit(0);
}

const PANEL = Number(process.env.TEST_PORT || 4901);
const PUBLIC = PANEL + 1;
const ACCOUNT_PORT = PANEL + 2;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'pump-e2e-'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 260)}`);
};

//  ══ همان سرآیندهایی که `CloudLink.Stamp(req)` روی **هر** درخواست می‌گذارد ══
//  ⛔ هیچ چیزِ شناسایی‌کنندهٔ کاربر این‌جا نیست — همان قاعدهٔ خودِ آن فایل.
const STAMP = {
  'user-agent': 'PumpYaqobi/3.1.148',
  'x-app-version': '3.1.148',
  'x-app-platform': 'windows',
  'x-app-id': 'tohid-pump-app',
};

//  ══ رباتِ ایمیلِ ساختگی — چرا این‌جا لازم شد ═══════════════════════════════
//
//  ⛔ **این خودش یک یافته است، نه یک ابزار.** بی هیچ SMTPی، زنجیرهٔ ثبت‌نام
//  روی سرورِ خانگی **بن‌بست** است و هیچ‌جا هم نمی‌گوید چرا:
//
//    • ناظر فرزند را با ‎NODE_ENV=production‎ بالا می‌آورد (درست است)
//    • پس ‎devCode‎ در پاسخِ HTTP برنمی‌گردد (درست است — از تونل درز می‌کرد)
//    • و رباتِ ایمیلِ سرورِ حساب روی ‎log‎ می‌ماند، که در production کد را
//      **حتی در لاگ هم نمی‌نویسد** («لاگ جای راز نیست»)
//    • ولی ‎register/start‎ همچنان ۲۰۰ می‌دهد (عمدی: وجودِ حساب لو نرود)
//
//  یعنی کاربر می‌بیند «کد فرستاده شد» و هیچ کدی هیچ‌وقت به دستِ کسی
//  نمی‌رسد. بندِ «ربات ایمیل» پایینِ همین فایل همین را صریح می‌سنجد.
//
//  پس این‌جا یک سرورِ SMTPِ کوچک بالا می‌آید تا **راهِ درست** هم سنجیده
//  شود: با ربات ایمیلِ تنظیم‌شده، هر هجده مرحله واقعاً کار می‌کند.
//  ⚠️ ساده و بی TLS است و ‎SMTP_SECURE=none‎ می‌خواهد؛ فقط ۱۲۷.۰.۰.۱.
const mailbox = [];
const smtp = net.createServer((sock) => {
  let data = false;
  let auth = 0;          // ۰ بیرون · ۱ منتظرِ نام · ۲ منتظرِ رمز
  let body = '';
  let buf = '';
  sock.setEncoding('utf8');
  sock.write('220 fake ESMTP\r\n');
  sock.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (data) {
        if (line === '.') { data = false; mailbox.push(body); body = ''; sock.write('250 OK\r\n'); }
        else body += line + '\n';
        continue;
      }
      if (auth) { sock.write(auth === 1 ? '334 UGFzc3dvcmQ6\r\n' : '235 ok\r\n'); auth = auth === 1 ? 2 : 0; continue; }
      if (!line) continue;
      const cmd = line.split(' ')[0].toUpperCase();
      //  ⚠️ رباتِ ایمیلِ سرورِ حساب بی نام و رمز راه نمی‌افتد
      //  («تنظیمات ایمیل کامل نیست») — پس AUTH LOGIN اعلام می‌شود.
      if (cmd === 'EHLO' || cmd === 'HELO') sock.write('250-fake\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 10240000\r\n');
      else if (cmd === 'AUTH') {
        if (/LOGIN\s*$/i.test(line)) { auth = 1; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else sock.write('235 ok\r\n');
      }
      else if (cmd === 'DATA') { data = true; sock.write('354 go\r\n'); }
      else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => {});
});
await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
const SMTP_PORT = smtp.address().port;

/**
 * شش‌رقمیِ داخلِ تازه‌ترین ایمیل — همان کدی که به دستِ کاربر می‌رسید.
 * ⚠️ بدنه چندبخشی و base64 است (عنوان و متنِ فارسی)، پس هر بلوکِ base64
 * هم باز می‌شود؛ گشتنِ خامِ متن شش‌رقمی پیدا نمی‌کرد.
 *
 * ⛔ **و دو نگهبان که با یک سرخیِ CI به دست آمدند** (اجرای ۱۸:۱۱ روی
 * `b05bffe`): پیامِ «کد واقعاً به ایمیل رفت» سبز بود ولی
 * `register/verify` `otp_wrong` می‌گرفت — یعنی کد پیدا شده بود، **غلط**.
 * ریشه: مرزِ MIMEی nodemailer (`--_NmP-<هگز>-Part_1`) تصادفی است و
 * هر از گاهی شش رقمِ پشتِ سرِ هم در خودش دارد. آن رشته پیش از متنِ نامه
 * می‌آمد، پس «اولین شش‌رقمی» مرز بود نه کد.
 *
 *   ۱) **سرآیندها اصلاً گشته نمی‌شوند** — فقط بدنهٔ بعد از خطِ خالی.
 *   ۲) **مرزِ شش‌رقمی باید نویسهٔ غیرِ الفبا‌عددی دو طرفش باشد**، پس
 *      شش رقمِ وسطِ یک رشتهٔ هگز دیگر قبول نمی‌شود.
 *
 * ⚠️ این «ضعیف کردنِ سنجه» نیست، درست کردنِ خودِ ابزارِ سنجه است: آن
 * سیزده سرخ رفتارِ سالمِ سرور را «خراب» نشان می‌دادند.
 */
const codeFromMail = async () => {
  /** سرآیندهای هر بخش را می‌اندازد و فقط بدنه را می‌دهد. */
  const bodyOnly = (raw) => {
    const at = raw.indexOf('\n\n');
    return at < 0 ? raw : raw.slice(at + 2);
  };
  const dig = (raw) => {
    const stripped = bodyOnly(raw);
    const parts = [];
    for (const m of stripped.matchAll(/^([A-Za-z0-9+/=]{16,})$/gm)) {
      try { parts.push(Buffer.from(m[1], 'base64').toString('utf8')); } catch { /* base64 نبود */ }
    }
    //  ⚠️ بلوک‌های باز‌شده **اول**: متنِ نامه آن‌جاست، نه در خامِ MIME
    parts.push(stripped.replace(/=\r?\n/g, '').replace(/=3D/g, '='));
    for (const text of parts) {
      const hit = /(?:^|[^A-Za-z0-9])(\d{6})(?:[^A-Za-z0-9]|$)/.exec(text);
      if (hit) return hit[1];
    }
    return '';
  };
  for (let i = 0; i < 80; i++) {
    for (let k = mailbox.length - 1; k >= 0; k--) {
      const got = dig(mailbox[k]);
      if (got) return got;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return '';
};

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/index.js'], {
  cwd: path.resolve(here, '..'),
  env: {
    ...process.env,
    HLP_PORT: String(PANEL), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC),
    HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
    HLP_ACCOUNT_API: `http://127.0.0.1:${ACCOUNT_PORT}`,
    HLP_ACCOUNT_DIR: ACCOUNT_DIR, HLP_ACCOUNT_AUTOSTART: '1',
    HLP_ACCOUNT_ADMIN_USER: '', HLP_ACCOUNT_ADMIN_PASSWORD: '',
    //  ⚠️ `mailEnvForChild()` وقتی SMTPِ پنل تنظیم نباشد `{}` می‌دهد، و چون
    //  محیطِ خودِ پنل اول spread می‌شود، همین‌ها به فرزند می‌رسند.
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(SMTP_PORT), SMTP_SECURE: 'none',
    SMTP_USER: 'e2e', SMTP_PASS: 'e2e', EMAIL_FROM: 'pump@example.com',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

/** یک درخواست، دقیقاً از راهِ پورتِ عمومی (همان چیزی که تونل می‌بیند). */
const call = async (method, p, { body, token = '', headers = {} } = {}) => {
  const res = await fetch(`http://127.0.0.1:${PUBLIC}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...STAMP,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* غیرِ JSON */ }
  return { status: res.status, json, text };
};

/** «سرورِ ما جواب داد» — همان قاعدهٔ `CloudLink.Reach`: ۲xx یا خطای شکل‌دارِ خودمان. */
const ours = (r) => (r.status >= 200 && r.status < 300) || Boolean(r.json?.error?.code);

const uid = 'e2e-' + crypto.randomBytes(6).toString('hex');
const email = `${uid}@example.com`;
const password = 'Pump!1405test';

try {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PANEL}/health`)).ok) break; } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  let health = null;
  for (let i = 0; i < 200; i++) {
    const h = await call('GET', '/api/health').catch(() => null);
    if (h?.status === 200 && h.json?.server === 'online') { health = h; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!health) { console.log(out.slice(-2000)); throw new Error('سرورِ حساب از راهِ درگاه بالا نیامد'); }

  /*
   *  ⚠️ یک نشستِ مدیرِ **خودِ پنل** هم لازم است — برای بندِ ۸ب، که همان
   *  دری را می‌زند که صاحبِ سامانه در مرورگر می‌زند. این نشست فقط روی
   *  پورتِ پنل کار می‌کند و هیچ‌وقت از پورتِ عمومی نمی‌رود.
   */
  const panelHit = async (method, p2, body) => {
    const res = await fetch(`http://127.0.0.1:${PANEL}${p2}`, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* غیرِ JSON */ }
    return { status: res.status, json, text };
  };
  await panelHit('POST', '/api/auth/setup', { username: 'admin', password: 'E2e-1405-panel' });
  const panelToken =
    (await panelHit('POST', '/api/auth/login', { username: 'admin', password: 'E2e-1405-panel' })).json?.token || '';

  // ── ۱) دو مسیرِ بی‌توکن که برنامه سرِ باز شدن می‌زند ──────────────────────
  console.log('\n── ۱) پیش از هر ورودی ──');
  check('GET /api/health — سرورِ حسابِ واقعی، از راهِ درگاه',
    health.json?.server === 'online' && !!health.json?.version, JSON.stringify(health.json));
  check('⛔ و جوابِ خودِ پنل نیست (control-center)',
    health.json?.service !== 'control-center', JSON.stringify(health.json));
  const cfg = await call('GET', '/api/config');
  check('GET /api/config', cfg.status === 200, `${cfg.status} ${cfg.text.slice(0, 160)}`);
  const terms = await call('GET', '/api/auth/terms');
  check('GET /api/auth/terms', ours(terms), `${terms.status} ${terms.text.slice(0, 160)}`);

  // ── ۲) ثبت‌نامِ سه‌پله‌ای ─────────────────────────────────────────────────
  console.log('\n── ۲) ثبت‌نام، همان سه پله ──');
  const start = await call('POST', '/api/auth/register/start',
    { body: { name: 'سنجهٔ پمپ', email, password, passwordConfirm: password, app: 'pump' } });
  check('POST /api/auth/register/start', start.status === 200 || start.status === 201,
    `${start.status} ${start.text.slice(0, 200)}`);
  //  ⛔ کد **در پاسخ برنمی‌گردد** و نباید برگردد — از تونل درز می‌کرد.
  check('⛔ کد در پاسخِ HTTP نیست', !start.json?.devCode, JSON.stringify(start.json));
  const devCode = await codeFromMail();
  check('کد واقعاً به ایمیل رفت (رباتِ ایمیل تنظیم است)', /^\d{6}$/.test(devCode),
    'صندوق: ' + mailbox.length + ' نامه');
  if (process.env.PUMP_E2E_DEBUG) console.log(out.split('\n').filter((l) => /otp|mail|ایمیل|smtp/i.test(l)).slice(-12).join('\n'));

  const verify = await call('POST', '/api/auth/register/verify',
    { body: { email, code: devCode, app: 'pump' } });
  const ticket = verify.json?.ticket || '';
  check('POST /api/auth/register/verify ⇒ بلیت', ticket.length > 0,
    `${verify.status} ${verify.text.slice(0, 200)}`);

  const complete = await call('POST', '/api/auth/register/complete', {
    body: {
      ticket, name: 'سنجهٔ پمپ', password,
      terms: { accepted: true, version: verify.json?.terms?.version || '' },
      device: { uid, name: 'E2E', platform: 'windows' },
      app: 'pump',
    },
  });
  //  ⛔ نامِ فیلد `accessToken` است، نه `token` — قاعدهٔ ۱۴۰۵/۰۶/۲۹
  let access = complete.json?.accessToken || '';
  const refreshTok = complete.json?.refreshToken || '';
  check('POST /api/auth/register/complete ⇒ نشست', access.length > 0 && refreshTok.length > 0,
    `${complete.status} ${complete.text.slice(0, 200)}`);

  // ── ۳) ورود، تازه‌سازی ───────────────────────────────────────────────────
  console.log('\n── ۳) ورود و تازه‌سازیِ نشست ──');
  const badLogin = await call('POST', '/api/auth/login',
    { body: { email, password: 'Wrong!1405test', app: 'pump' } });
  check('رمزِ غلط ⇒ ۴۰۱ِ خودِ سرورِ حساب (نه ۵۰۳ِ درگاه، نه ۴۰۴)',
    badLogin.status === 401 && !!badLogin.json?.error?.code, `${badLogin.status} ${badLogin.text.slice(0, 160)}`);
  const login = await call('POST', '/api/auth/login', { body: { email, password, app: 'pump' } });
  access = login.json?.accessToken || access;
  check('POST /api/auth/login', login.status === 200 && (login.json?.accessToken || '').length > 0,
    `${login.status} ${login.text.slice(0, 200)}`);
  const refreshed = await call('POST', '/api/auth/refresh',
    { body: { refreshToken: login.json?.refreshToken || refreshTok } });
  check('POST /api/auth/refresh', refreshed.status === 200 && !!refreshed.json?.accessToken,
    `${refreshed.status} ${refreshed.text.slice(0, 200)}`);
  if (refreshed.json?.accessToken) access = refreshed.json.accessToken;

  // ── ۴) پمپ: ساختن و بند شدنِ دستگاه ─────────────────────────────────────
  console.log('\n── ۴) پمپ و دستگاه — همان ‎EnsureStationAsync‎ ──');
  const me0 = await call('GET', '/api/pump/me', { token: access });
  check('GET /api/pump/me', me0.status === 200, `${me0.status} ${me0.text.slice(0, 200)}`);
  check('حسابِ تازه هنوز پمپی ندارد', !me0.json?.station?.id && !me0.json?.station,
    JSON.stringify(me0.json?.station));
  const made = await call('POST', '/api/pump', { token: access, body: { name: 'پمپِ سنجه' } });
  check('POST /api/pump ⇒ پمپ ساخته شد',
    made.status === 200 || made.status === 201 || made.json?.error?.code === 'already_member',
    `${made.status} ${made.text.slice(0, 200)}`);
  const bind = await call('POST', '/api/pump/device/bind', {
    token: access, body: { device: { uid, name: 'E2E', platform: 'windows' } },
  });
  const devTok = bind.json?.token || bind.json?.deviceToken || '';
  check('POST /api/pump/device/bind ⇒ توکنِ دستگاه', devTok.length > 0,
    `${bind.status} ${bind.text.slice(0, 220)}`);
  check('و کلیدِ عمومی همراهش آمد (قفلِ TOFU)', (bind.json?.publicKey || '').length > 0,
    JSON.stringify(Object.keys(bind.json || {})));

  // ── ۵) هر مسیرِ دستگاه ──────────────────────────────────────────────────
  console.log('\n── ۵) مسیرهای دستگاه، با توکنِ دستگاه ──');
  const devMe = await call('GET', '/api/pump/device/me', { token: devTok });
  check('GET /api/pump/device/me', devMe.status === 200, `${devMe.status} ${devMe.text.slice(0, 160)}`);
  const lic = await call('POST', '/api/pump/device/license', { token: devTok, body: {} });
  check('POST /api/pump/device/license', lic.status === 200, `${lic.status} ${lic.text.slice(0, 160)}`);
  const code = await call('GET', '/api/pump/device/access-code', { token: devTok });
  check('GET /api/pump/device/access-code ⇒ کدِ اپِ کارمندان',
    code.status === 200 && (code.json?.code || '').length >= 4, `${code.status} ${code.text.slice(0, 160)}`);
  const home = await call('POST', '/api/pump/device/home',
    { token: devTok, body: { homeUrl: 'http://192.168.1.50:4700', readKey: 'rk-e2e' } });
  check('POST /api/pump/device/home ⇒ نشانیِ سرورِ خانگی', home.status === 200,
    `${home.status} ${home.text.slice(0, 160)}`);
  const put = await call('PUT', '/api/pump/device/files/acct-1',
    { token: devTok, body: { data: { v: 1, at: Date.now(), d: 'x' } } });
  check('PUT /api/pump/device/files/… (کیو‌آرِ زنده) — جوابِ شکل‌دارِ خودمان', ours(put),
    `${put.status} ${put.text.slice(0, 160)}`);
  const events = await call('POST', '/api/pump/device/events',
    { token: devTok, body: { events: [{ clientId: 'k1', kind: 'debt_out', title: 'سنجه' }] } });
  check('POST /api/pump/device/events (خبرِ اپِ بسته)', ours(events), `${events.status} ${events.text.slice(0, 160)}`);
  const backups = await call('POST', '/api/pump/device/backups', { token: devTok, body: {} });
  check('POST /api/pump/device/backups', ours(backups), `${backups.status} ${backups.text.slice(0, 160)}`);
  const threads = await call('GET', '/api/pump/device/chat/threads', { token: devTok });
  check('GET /api/pump/device/chat/threads (چتِ پشتیبانی)', ours(threads), `${threads.status} ${threads.text.slice(0, 160)}`);
  const support = await call('GET', '/api/pump/device/support/messages', { token: devTok });
  check('GET /api/pump/device/support/messages', ours(support), `${support.status} ${support.text.slice(0, 160)}`);
  const redeem = await call('POST', '/api/pump/device/redeem', { token: devTok, body: { code: '000000' } });
  check('POST /api/pump/device/redeem (کدِ اشتراک) — کدِ غلط، جوابِ خودمان', ours(redeem),
    `${redeem.status} ${redeem.text.slice(0, 160)}`);

  // ── ۶) تپش و همگام‌سازی ─────────────────────────────────────────────────
  console.log('\n── ۶) تپش و Sync v1 ──');
  const beat = await call('POST', '/api/pump/heartbeat', { token: devTok, body: {} });
  check('POST /api/pump/heartbeat (نه /api/me/heartbeat)', ours(beat), `${beat.status} ${beat.text.slice(0, 160)}`);
  const push = await call('POST', '/api/sync/v1/push', { token: devTok, body: { ops: [] } });
  check('POST /api/sync/v1/push', ours(push), `${push.status} ${push.text.slice(0, 160)}`);
  const pull = await call('GET', '/api/sync/v1/pull?since=0', { token: devTok });
  check('GET /api/sync/v1/pull', ours(pull), `${pull.status} ${pull.text.slice(0, 160)}`);

  // ── ۶ب) رفت‌وبرگشتِ **واقعی** — نوشتنِ این‌جا ⇒ خواندنِ آن‌جا ─────────────
  //
  //  ⛔ تا دیروز این بخش فقط `ops: []` می‌فرستاد. آن ثابت می‌کرد «مسیر
  //  جواب می‌دهد»، نه «اطلاعات واقعاً می‌رود و برمی‌گردد» — یعنی اگر
  //  فردا سرور opها را بی‌صدا دور می‌ریخت، همین سنجه سبز می‌ماند.
  //
  //  حالا یک ردیفِ واقعیِ گاوصندوق با توکنِ **دستگاه** نوشته می‌شود و با
  //  سه هویتِ مختلف خوانده می‌شود. شکلِ op مو‌به‌مو همان است که
  //  `CloudLink.Sync.Wire` می‌فرستد.
  console.log('\n── ۶ب) رفت‌وبرگشتِ واقعیِ Sync v1 ──');
  const rowUid = 'E2E' + crypto.randomBytes(8).toString('hex').toUpperCase();
  const opId = crypto.randomUUID();
  const mark = 'نشانهٔ رفت‌وبرگشت ' + rowUid.slice(-6);
  const wrote = await call('POST', '/api/sync/v1/push', {
    token: devTok,
    body: {
      device_id: uid,
      schema_version: 1,
      queued: 1,
      ops: [{
        op_id: opId, table: 'SafeEntry', row_id: rowUid, type: 'insert',
        ts: Date.now(), fields: { Title: mark, Amount: '1405', MonthKey: '1405-07' },
      }],
    },
  });
  check('یک ردیفِ واقعی با توکنِ دستگاه نوشته شد',
    wrote.status === 200 && Number(wrote.json?.applied) === 1,
    `${wrote.status} ${wrote.text.slice(0, 220)}`);

  /** opهای این دفتر پس از cursor، از دیدِ همان هویت و همان دستگاه. */
  const pullAs = async (token, device) => {
    const r = await call('GET', `/api/sync/v1/pull?device_id=${encodeURIComponent(device)}&since=0&limit=500`,
      { token });
    return { r, hit: (r.json?.ops || []).find((o) => o.row_id === rowUid) || null };
  };

  //  ۱) دستگاهِ **دیگرِ همان پمپ** — همان چیزی که کامپیوترِ دومِ پمپ است
  const asOther = await pullAs(devTok, uid + '-B');
  check('⇒ دستگاهِ دیگرِ همان پمپ آن ردیف را می‌گیرد',
    !!asOther.hit, `${asOther.r.status} ${asOther.r.text.slice(0, 220)}`);
  check('⇒ و فیلدهایش مو‌به‌مو همان است که فرستاده شد',
    asOther.hit?.fields?.Title === mark && String(asOther.hit?.fields?.Amount) === '1405',
    JSON.stringify(asOther.hit?.fields));

  //  ۲) توکنِ **حساب** — قاعدهٔ `CloudLink.Sync`: هر دو توکن به همان پمپ
  const asAccount = await pullAs(access, uid + '-C');
  check('⇒ توکنِ حساب و توکنِ دستگاه به **همان** دفترِ پمپ می‌رسند',
    !!asAccount.hit, `${asAccount.r.status} ${asAccount.r.text.slice(0, 220)}`);

  //  ۳) خودِ همان دستگاه — سرور opهای خودش را پس نمی‌دهد (بی پژواک)
  const asSelf = await pullAs(devTok, uid);
  check('⛔ و به خودِ همان دستگاه پژواک نمی‌شود',
    asSelf.r.status === 200 && !asSelf.hit, `${asSelf.r.status} ${asSelf.r.text.slice(0, 220)}`);

  //  ۴) **حسابِ دیگر، پمپِ دیگر** — هیچ ردیفی از این پمپ نمی‌بیند.
  //
  //  ⛔ این مهم‌ترین بندِ این بخش است: نگهبانِ سرور
  //  (`lib/sync-v1-auth.js`) حساب را **فقط از توکن** درمی‌آورد و
  //  `account` در بدنه یا نشانی را اصلاً نمی‌خواند. بی این سنجه،
  //  «دفترِ هر پمپ مالِ خودش است» فقط یک ادعا بود.
  const uid2 = 'e2e2-' + crypto.randomBytes(6).toString('hex');
  const email2 = `${uid2}@example.com`;
  const seen = mailbox.length;
  const start2 = await call('POST', '/api/auth/register/start',
    { body: { name: 'پمپِ همسایه', email: email2, password, passwordConfirm: password, app: 'pump' } });
  check('حسابِ دومِ سنجه ساخته می‌شود', start2.status === 200 || start2.status === 201,
    `${start2.status} ${start2.text.slice(0, 160)}`);
  for (let i = 0; i < 80 && mailbox.length === seen; i++) await new Promise((r) => setTimeout(r, 250));
  const code2 = await codeFromMail();
  const verify2 = await call('POST', '/api/auth/register/verify',
    { body: { email: email2, code: code2, app: 'pump' } });
  const complete2 = await call('POST', '/api/auth/register/complete', {
    body: {
      ticket: verify2.json?.ticket || '', name: 'پمپِ همسایه', password,
      terms: { accepted: true, version: verify2.json?.terms?.version || '' },
      device: { uid: uid2, name: 'E2E-2', platform: 'windows' },
      app: 'pump',
    },
  });
  const access2 = complete2.json?.accessToken || '';
  await call('POST', '/api/pump', { token: access2, body: { name: 'پمپِ همسایه' } });
  const bind2 = await call('POST', '/api/pump/device/bind',
    { token: access2, body: { device: { uid: uid2, name: 'E2E-2', platform: 'windows' } } });
  const devTok2 = bind2.json?.token || bind2.json?.deviceToken || '';
  check('و پمپِ خودش را دارد', devTok2.length > 0, `${bind2.status} ${bind2.text.slice(0, 200)}`);

  const neighbour = await pullAs(devTok2, uid2);
  check('⛔ پمپِ همسایه **هیچ** ردیفی از دفترِ این پمپ نمی‌بیند',
    neighbour.r.status === 200 && !neighbour.hit && (neighbour.r.json?.ops || []).length === 0,
    `${neighbour.r.status} ${(neighbour.r.json?.ops || []).length} op`);

  //  ۵) و عوض کردنِ شناسه در خودِ درخواست هیچ دری باز نمی‌کند
  const spoof = await call('GET',
    `/api/sync/v1/pull?device_id=${encodeURIComponent(uid2)}&since=0&limit=500&account=${encodeURIComponent(uid)}`,
    { token: devTok2 });
  check('⛔ و `account`ِ دستی در نشانی نادیده می‌رود (حساب فقط از توکن)',
    spoof.status === 200 && !(spoof.json?.ops || []).some((o) => o.row_id === rowUid),
    `${spoof.status} ${spoof.text.slice(0, 200)}`);

  // ── ۷) ورود با کدِ ایمیلی — درِ سومِ برنامه ──────────────────────────────
  console.log('\n── ۷) ورود با کدِ ایمیلی ──');
  const mailsBefore = mailbox.length;
  const req = await call('POST', '/api/auth/pump/request-code',
    { body: { email, device_id: uid, device_name: 'E2E' } });
  check('POST /api/auth/pump/request-code — همیشه ۲۰۰ مگر سقفِ نرخ',
    req.status === 200 || req.status === 429, `${req.status} ${req.text.slice(0, 160)}`);
  const reqId = req.json?.request_id || '';
  check('شناسهٔ درخواست آمد', reqId.length > 0, JSON.stringify(req.json));
  //  ⚠️ کلیدِ پرس‌وجو `request_id` است، نه ایمیل — همان چیزی که
  //  `CloudLink.RequestStatusAsync` می‌فرستد.
  const stat = await call('GET', `/api/auth/pump/request-status?request_id=${encodeURIComponent(reqId)}`);
  check('GET /api/auth/pump/request-status ⇒ حالِ ارسال',
    stat.status === 200 && !!stat.json?.state, `${stat.status} ${stat.text.slice(0, 160)}`);
  let codeLogin = '';
  for (let i = 0; i < 80 && !codeLogin; i++) {
    if (mailbox.length > mailsBefore) codeLogin = await codeFromMail();
    else await new Promise((r) => setTimeout(r, 250));
  }
  const vr = await call('POST', '/api/auth/pump/verify',
    { body: { request_id: reqId, code: codeLogin, device_id: uid, device_name: 'E2E' } });
  check('POST /api/auth/pump/verify ⇒ نشست (درِ سوم کامل کار می‌کند)',
    vr.status === 200 && (vr.json?.accessToken || vr.json?.token || '').length > 0,
    `${vr.status} ${vr.text.slice(0, 200)}`);

  // ── ۸) گزارشِ خطا — همان پیشوندی که یک بار از فهرست جا افتاده بود ───────
  console.log('\n── ۸) گزارشِ خطا و خروج ──');
  const err = await call('POST', '/api/errors',
    { body: { app: 'pump', message: 'سنجهٔ پایان‌به‌پایان', stack: 'x', version: '3.1.148' } });
  check('POST /api/errors از تونل می‌رسد (نه ۴۰۴ِ درگاه)', ours(err), `${err.status} ${err.text.slice(0, 160)}`);
  const bye = await call('POST', '/api/auth/logout',
    { token: access, body: { refreshToken: refreshed.json?.refreshToken || refreshTok } });
  check('POST /api/auth/logout', ours(bye), `${bye.status} ${bye.text.slice(0, 160)}`);

  // ── ۸ب) اشتراک از پنل ⇒ قفل‌های برنامه، بی نصبِ چیزی ────────────────────
  //
  //  بندهای ۳.۴ و ۳.۵ی `docs/REMAKE-fa.md`. خواستهٔ صاحب سامانه:
  //  «از سرور اشتراکشان یا تخفیفشان را عوض کنم، اتومات برود روی
  //  برنامه‌شان و لازم نباشد چیزی نصب کنند.»
  //
  //  ⛔ این‌جا **همان** دری زده می‌شود که خودِ پنل می‌زند
  //  (`/api/account-admin/subs/pump/…`) و بعد **همان** دری که برنامه
  //  می‌زند (`/api/pump/device/license` از پورتِ عمومی). یعنی زنجیره
  //  کامل سنجیده می‌شود، نه دو نیمهٔ جدا — همان درسی که این پرونده از
  //  روزِ اول رویش ساخته شد.
  //
  //  ⚠️ و ملاک **فهرستِ قابلیتِ مجوز** است، نه «اشتراک فعال شد»: قفل‌های
  //  برنامه از `feat`ِ داخلِ مجوز باز و بسته می‌شوند، و پاسخِ `me` آن
  //  فهرست را به `LicenseGuard` نمی‌رساند (درسِ ۱۴۰۵/۰۷/۰۸ ریپوی پمپ).
  console.log('\n── ۸ب) اشتراک و افزونه از پنل ⇒ مجوزِ برنامه ──');
  {
    const panel = async (method, p2, body) => {
      const res = await fetch(`http://127.0.0.1:${PANEL}${p2}`, {
        method,
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${panelToken}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* غیرِ JSON */ }
      return { status: res.status, json, text };
    };

    // ── ۸الف) حسابی که ثبت شده ولی هنوز چیزی نخریده کجا دیده می‌شود؟ ────
    //
    //  گزارشِ صاحب سامانه (۱۴۰۵/۰۷/۱۱): «توی سرور حساب‌های ثبت‌شده رو هم
    //  بالا نمیاره — نمی‌دونم به خاطر اینه که به سرور وصل نیست یا چی.»
    //
    //  ⚠️ این‌جا همان پمپی سنجیده می‌شود که **همین الان** ثبت شد و هنوز
    //  هیچ اشتراکی ندارد — یعنی دقیقاً همان کسی که قرار است به او اشتراک
    //  فروخته شود.
    {
      const subs = await panel('GET', '/api/account-admin/customers?app=pump&limit=300');
      //  ⚠️ کلیدِ پاسخ `subscriptions` است — همان که `Customers.tsx`
      //  می‌خواند. بارِ اول `items`/`rows` نوشته شد و سنجه **سبزِ دروغ**
      //  می‌داد: فهرست همیشه خالی دیده می‌شد، حتی وقتی پر بود.
      const rows = subs.json?.subscriptions || [];
      const inSubs = rows.some((r) => JSON.stringify(r).includes(email));

      const targets = await panel('GET',
        `/api/account-admin/grant-targets?app=pump&q=${encodeURIComponent('')}`);
      const picks = targets.json?.items || [];
      const inTargets = picks.length > 0;

      check('«مشتری‌ها» پاسخ می‌دهد (پنل به سرورِ حساب وصل است)',
        subs.status === 200, `${subs.status} ${subs.text.slice(0, 200)}`);

      //  ⛔ ریشهٔ گزارش: فهرستِ «مشتری‌ها» از `sales/subscriptions` می‌آمد،
      //  یعنی فقط حساب‌هایی که **ردیفِ اشتراک** دارند. پمپِ تازه‌ای که
      //  هنوز نخریده — دقیقاً همان کسی که قرار است به او اشتراک فروخته
      //  شود — آن‌جا نبود. حالا دفترِ خودِ حساب‌ها هم ادغام می‌شود و
      //  ردیفش نشانِ صریحِ `neverSubscribed` دارد.
      const never = rows.filter((r) => r.neverSubscribed);
      console.log(`     ⓘ پمپِ بی‌اشتراک در «مشتری‌ها»: ${inSubs ? 'هست' : 'نیست'}`
        + ` · در «اشتراک بده»: ${inTargets ? 'هست' : 'نیست'} (${picks.length} ردیف)`);
      console.log(`     ⓘ «مشتری‌ها» ${rows.length} ردیف داد، ${never.length} تایش بی‌اشتراک`
        + ` · نمونه: ${JSON.stringify(never[0] || picks[0] || null).slice(0, 220)}`);

      check('⛔ حسابِ بی‌اشتراک در «مشتری‌ها» دیده می‌شود',
        inSubs, `مشتری‌ها=${rows.length} ردیف، ${never.length} بی‌اشتراک`);
      check('⛔ و نشانِ صریحِ «هیچ‌وقت اشتراک نداشته» دارد، نه فیلدهای خالی',
        never.some((r) => JSON.stringify(r).includes(email)),
        `${never.length} ردیفِ بی‌اشتراک`);
      check('⛔ و در «اشتراک بده» هم هست — وگرنه نمی‌شود به او اشتراک فروخت',
        inTargets, `اشتراک‌بده=${picks.length} ردیف`);
    }

    //  حالِ امروز: پمپِ تازه در دورهٔ آزمایشی است، پس مجوز دارد ولی پلنش «آزمایشی»
    const before = await call('POST', '/api/pump/device/license', { token: devTok, body: {} });
    const featsBefore = before.json?.features || [];
    check('پیش از اشتراک، مجوزِ دورهٔ آزمایشی می‌آید',
      before.status === 200 && Array.isArray(featsBefore) && featsBefore.length > 0,
      `${before.status} ${before.text.slice(0, 160)}`);

    //  صاحبِ سامانه این پمپ را در فهرستِ «اشتراک بده» پیدا می‌کند — با ایمیل
    const targets = await panel('GET', `/api/account-admin/grant-targets?app=pump&q=${encodeURIComponent(email)}`);
    const target = (targets.json?.items || [])[0];
    check('پمپِ این حساب با ایمیل در فهرستِ «اشتراک بده» پیدا می‌شود',
      Boolean(target?.tenantId), `${targets.status} ${targets.text.slice(0, 200)}`);

    //  ⛔ اشتراک با فهرستِ **محدود** داده می‌شود، نه پلنِ کامل: وگرنه
    //  «باز شد» را نمی‌شد از «از اول باز بود» جدا کرد.
    const grant = await panel('POST', '/api/account-admin/subs/pump/grant', {
      tenantId: target?.tenantId, plan: 'standard', features: ['kar_app'],
      endsAt: Date.now() + 90 * 86400000,
    });
    check('اشتراک از پنل داده شد', grant.status === 200 && Boolean(grant.json?.subscription),
      `${grant.status} ${grant.text.slice(0, 220)}`);

    //  ⚠️ هیچ نصبی، هیچ ورودِ دوباره‌ای: همان توکنِ دستگاهِ قبلی
    const after = await call('POST', '/api/pump/device/license', { token: devTok, body: {} });
    const featsAfter = after.json?.features || [];
    check('۳.۴ بی نصبِ چیزی، همان دستگاه مجوزِ اشتراک را گرفت',
      after.status === 200 && featsAfter.includes('kar_app'),
      `${after.status} ${JSON.stringify(featsAfter).slice(0, 200)}`);
    //  و «محدود» واقعاً محدود است — وگرنه سنجهٔ بعدی بی‌معنا می‌شد
    check('و فهرستِ محدود واقعاً محدود است (پلنِ کامل نیامد)',
      !featsAfter.includes('cloud'), JSON.stringify(featsAfter).slice(0, 200));

    //  ── ۳.۵ افزونه («تخفیف»/قابلیتِ اضافه) هم از همان راه می‌رسد ──────────
    const subId = grant.json?.subscription?.id || '';
    const addon = await panel('POST', `/api/account-admin/subs/pump/${encodeURIComponent(subId)}/addons`,
      { feature: 'cloud', note: 'سنجهٔ ۳.۵' });
    check('افزونه از پنل روی همان اشتراک نشست', addon.status === 200,
      `${addon.status} ${addon.text.slice(0, 220)}`);

    const withAddon = await call('POST', '/api/pump/device/license', { token: devTok, body: {} });
    const featsAddon = withAddon.json?.features || [];
    check('۳.۵ و همان لحظه در مجوزِ برنامه دیده می‌شود',
      withAddon.status === 200 && featsAddon.includes('cloud') && featsAddon.includes('kar_app'),
      JSON.stringify(featsAddon).slice(0, 200));

    //  ⛔ و برداشتنش هم می‌رسد: «بتونم اشتراکشو بردارم یا روش اضافه کنم»
    const addonId = addon.json?.addon?.id || '';
    const gone = await panel('DELETE',
      `/api/account-admin/subs/pump/${encodeURIComponent(subId)}/addons/${encodeURIComponent(addonId)}`);
    const afterGone = await call('POST', '/api/pump/device/license', { token: devTok, body: {} });
    check('⛔ و برداشتنِ افزونه هم همان لحظه می‌رسد',
      gone.status === 200 && !(afterGone.json?.features || []).includes('cloud'),
      `${gone.status} ${JSON.stringify(afterGone.json?.features || []).slice(0, 160)}`);

    //  ⚠️ و مجوز همچنان امضاشده است — «باز شد» بی امضا یعنی قفل دور خورد
    check('⚠️ و مجوز همچنان امضاشده و کلیددار است',
      String(afterGone.json?.license || '').split('.').length === 3
      && String(afterGone.json?.publicKey || '').length > 0);
  }

  // ── ۹) فهرستِ سفید، از خودِ shop خوانده می‌شود ───────────────────────────
  console.log('\n── ۹) ⛔ فهرستِ درگاه با ‎apiRouter‎ی خودِ سرورِ حساب یکی است ──');
  {
    const appJs = fs.readFileSync(path.join(ACCOUNT_DIR, 'src', 'app.js'), 'utf8');
    const found = new Set();
    //  api.use('/pump/device', …)  و  api.get('/health', …)
    for (const m of appJs.matchAll(/\bapi\.(?:use|get|post|put|delete|patch)\(\s*'\/([a-zA-Z0-9_-]+)/g))
      found.add(m[1]);
    const missing = [...found].filter((p) => !ACCOUNT_PREFIXES.includes(p)).sort();
    check(`هر ${found.size} پیشوندِ سرورِ حساب در فهرستِ درگاه هست`,
      missing.length === 0, 'جا افتاده: ' + missing.join(' · '));
    //  و برعکس: نامی در فهرست که آن‌طرف وجود ندارد فقط گمراه‌کننده است
    const phantom = ACCOUNT_PREFIXES.filter((p) => !found.has(p)).sort();
    check('و نامِ بی‌صاحبی در فهرست نمانده', phantom.length === 0, 'بی‌صاحب: ' + phantom.join(' · '));
  }
} catch (e) {
  check('اجرا تا آخر رفت', false, e.message);
  console.log(out.slice(-1500));
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 600));
  server.kill('SIGKILL');
  smtp.close();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${pass} سبز، ${fail} سرخ`);
process.exit(fail === 0 ? 0 : 1);
