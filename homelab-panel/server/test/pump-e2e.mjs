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
 */
const codeFromMail = async () => {
  const dig = (raw) => {
    const parts = [raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=')];
    for (const m of raw.matchAll(/^([A-Za-z0-9+/=]{16,})$/gm)) {
      try { parts.push(Buffer.from(m[1], 'base64').toString('utf8')); } catch { /* base64 نبود */ }
    }
    for (const text of parts) {
      const hit = /(?:^|[^\d])(\d{6})(?:[^\d]|$)/.exec(text);
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
