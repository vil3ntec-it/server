// ---------------------------------------------------------------------------
//  آزمونِ «ورود برنامه‌ها با کدِ شش‌رقمی»
//    node test/app-auth.mjs
//
//  یک سرویسِ پیامکِ قلابی و یک سرورِ ایمیلِ قلابی بالا می‌آید تا کلِ مسیر —
//  از فرستادنِ کد تا گرفتنِ توکن — واقعاً آزمایش شود.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4796);
const PUBLIC_PORT = PORT + 1;
const SMS_PORT = PORT + 2;
const SMTP_PORT = PORT + 3;
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-otp-'));
const dataDir = path.join(tmp, 'data');
const sitesRoot = path.join(tmp, 'sites');
fs.mkdirSync(sitesRoot, { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

// ------------------------- سرویسِ پیامکِ قلابی ------------------------------
const smsInbox = [];
const smsServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed = null;
    try {
      parsed = JSON.parse(body);
      smsInbox.push(parsed);
    } catch {
      smsInbox.push({ raw: body });
    }
    // شمارهٔ ۰۹۹۹… را عمداً رد می‌کنیم تا «سرویسِ پیامک خراب است» هم آزموده شود
    if (parsed?.to?.startsWith('0999')) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end('{"status":"credit_finished"}');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":"ok"}');
  });
});
await new Promise((r) => smsServer.listen(SMS_PORT, '127.0.0.1', r));

// -------------------------- سرورِ ایمیلِ قلابی ------------------------------
const mailInbox = [];
const smtpServer = net.createServer((socket) => {
  let stage = 'cmd';
  let message = '';
  socket.setEncoding('utf8');
  socket.write('220 fake ESMTP\r\n');
  socket.on('data', (chunk) => {
    if (stage === 'data') {
      message += chunk;
      if (message.includes('\r\n.\r\n')) {
        mailInbox.push(message);
        stage = 'cmd';
        socket.write('250 stored\r\n');
      }
      return;
    }
    for (const line of chunk.split('\r\n').filter(Boolean)) {
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd.startsWith('AUTH')) socket.write('235 ok\r\n');
      else if (cmd.startsWith('MAIL FROM') || cmd.startsWith('RCPT TO')) socket.write('250 ok\r\n');
      else if (cmd === 'DATA') {
        stage = 'data';
        socket.write('354 go ahead\r\n');
      } else if (cmd === 'QUIT') {
        socket.write('221 bye\r\n');
        socket.end();
      } else socket.write('250 ok\r\n');
    }
  });
  socket.on('error', () => {});
});
await new Promise((r) => smtpServer.listen(SMTP_PORT, '127.0.0.1', r));

// ------------------------------ خودِ سرور ----------------------------------
const serverPath = path.join(import.meta.dirname, '..', 'src', 'index.js');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT),
    HLP_SITESYNC_PORT: String(PUBLIC_PORT),
    HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: sitesRoot,
    HLP_TUNNEL: '0',
    HLP_AI_ENABLED: '0',
    // پیامک: سرویسِ «هر جای دیگر» (webhook) به سرویسِ قلابیِ بالا
    OTP_SMS_PROVIDER: 'webhook',
    OTP_SMS_URL: `http://127.0.0.1:${SMS_PORT}/send`,
    OTP_SMS_BODY: '{"to":"{to0}","code":"{code}","text":"{text}"}',
    // ایمیل: SMTPِ قلابی، بدون رمزنگاری
    OTP_EMAIL_HOST: '127.0.0.1',
    OTP_EMAIL_PORT: String(SMTP_PORT),
    OTP_EMAIL_SECURE: '0',
    OTP_EMAIL_USER: 'robot@test.local',
    OTP_EMAIL_PASS: 'secret',
    OTP_EMAIL_FROM: 'robot@test.local',
    OTP_RESEND_SECONDS: '2',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

async function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return true;
    } catch { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

const post = async (path, body, headers = {}) => {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  if (!(await waitForServer())) throw new Error(`سرور بالا نیامد:\n${serverOut}`);
  console.log('\n▶ شناسنامهٔ سرور');

  const cfg = await (await fetch(`${BASE}/api/app/config`)).json();
  check('GET /api/app/config جواب می‌دهد', cfg.ok === true);
  check('پیامک روشن گزارش می‌شود', cfg.login?.smsReady === true);
  check('ایمیل روشن گزارش می‌شود', cfg.login?.emailReady === true);
  check('طولِ کد ۶ است', cfg.login?.codeLength === 6);

  const ping = await (await fetch(`${BASE}/api/app/ping`)).json();
  check('GET /api/app/ping جواب می‌دهد', ping.ok === true);

  console.log('\n▶ ورود با شمارهٔ موبایل');
  const phone = '۰۹۱۲۱۲۳۴۵۶۷'; // عمداً با ارقامِ فارسی
  const req1 = await post('/api/app/auth/request-code', { phone, app: 'my-app' });
  check('درخواستِ کد قبول شد', req1.status === 200 && req1.body.sent === true, JSON.stringify(req1.body));
  check('کد از راهِ سرویسِ پیامک رفت', req1.body.via === 'webhook');
  check('کد در پاسخِ HTTP لو نمی‌رود', req1.body.code === undefined);

  const sms = smsInbox[smsInbox.length - 1];
  check('سرویسِ پیامک پیام گرفت', Boolean(sms), JSON.stringify(smsInbox));
  check('شمارهٔ فارسی درست تبدیل شد', sms?.to === '09121234567', sms?.to);
  const code = sms?.code;
  check('کد شش‌رقمی است', /^\d{6}$/.test(String(code)), String(code));

  const tooSoon = await post('/api/app/auth/request-code', { phone: '09121234567', app: 'my-app' });
  check('درخواستِ پشتِ‌سرهم جلویش گرفته می‌شود', tooSoon.status === 429 && tooSoon.body.error === 'too_soon');

  const wrong = await post('/api/app/auth/verify-code', { phone: '09121234567', code: '000000', app: 'my-app' });
  check('کدِ غلط رد می‌شود', wrong.status === 400 && wrong.body.error === 'wrong_code', JSON.stringify(wrong.body));
  check('تعدادِ تلاشِ باقی‌مانده گفته می‌شود', typeof wrong.body.triesLeft === 'number');

  const ok = await post('/api/app/auth/verify-code', { phone: '0912 123 4567', code, app: 'my-app', name: 'یعقوبی' });
  check('کدِ درست توکن می‌دهد', ok.status === 200 && typeof ok.body.token === 'string', JSON.stringify(ok.body));
  check('کاربر تازه شناخته می‌شود', ok.body.isNew === true);
  check('شماره به شکلِ جهانی ذخیره شد', ok.body.user?.phone === '+989121234567', ok.body.user?.phone);

  const token = ok.body.token;
  const me = await (await fetch(`${BASE}/api/app/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
  check('GET /api/app/me با توکن کار می‌کند', me.ok === true && me.user.phone === '+989121234567');
  check('نامِ کاربر ذخیره شد', me.user.name === 'یعقوبی');

  const again = await post('/api/app/auth/verify-code', { phone: '09121234567', code, app: 'my-app' });
  check('کدِ مصرف‌شده دوباره کار نمی‌کند', again.status === 400 && again.body.error === 'no_code');

  console.log('\n▶ جداییِ توکنِ برنامه از پنل');
  const panel = await fetch(`${BASE}/api/dashboard`, { headers: { Authorization: `Bearer ${token}` } });
  check('توکنِ برنامه به پنل راه ندارد', panel.status === 401, `status=${panel.status}`);
  const noToken = await fetch(`${BASE}/api/app/me`);
  check('بدونِ توکن، /api/app/me بسته است', noToken.status === 401);

  console.log('\n▶ ورود با ایمیل');
  const req2 = await post('/api/app/auth/request-code', { email: 'Ali@Gmail.COM', app: 'my-app' });
  check('درخواستِ کدِ ایمیل قبول شد', req2.status === 200 && req2.body.sent === true, JSON.stringify(req2.body));
  check('از راهِ SMTP رفت', req2.body.via === 'smtp');
  const mail = mailInbox[mailInbox.length - 1] || '';
  check('ایمیل به سرورِ ایمیل رسید', mail.includes('robot@test.local'));
  // بدنهٔ ایمیل base64 است — هر تکهٔ base64 را جدا باز می‌کنیم
  const decoded = mail
    .split(/\r?\n/)
    .reduce((runs, line) => {
      if (/^[A-Za-z0-9+/=]{20,}$/.test(line)) runs[runs.length - 1] += line;
      else if (runs[runs.length - 1] !== '') runs.push('');
      return runs;
    }, [''])
    .map((chunk) => Buffer.from(chunk, 'base64').toString('utf8'))
    .join('\n');
  const mailCode = (decoded.match(/(\d{6})/) || [])[1];
  check('کدِ شش‌رقمی داخلِ ایمیل هست', Boolean(mailCode), decoded.slice(0, 120));

  const okMail = await post('/api/app/auth/verify-code', { email: 'ali@gmail.com', code: mailCode, app: 'my-app' });
  check('ورود با ایمیل توکن می‌دهد', okMail.status === 200 && typeof okMail.body.token === 'string');
  check('ایمیل با حروفِ کوچک ذخیره شد', okMail.body.user?.email === 'ali@gmail.com');

  console.log('\n▶ هر برنامه، کاربرانِ خودش');
  await wait(2100);
  const otherApp = await post('/api/app/auth/request-code', { phone: '09121234567', app: 'shop' });
  check('همان شماره در برنامهٔ دیگر هم کد می‌گیرد', otherApp.status === 200, JSON.stringify(otherApp.body));
  const codeShop = smsInbox[smsInbox.length - 1]?.code;
  const shopLogin = await post('/api/app/auth/verify-code', { phone: '09121234567', code: codeShop, app: 'shop' });
  check('کاربرِ برنامهٔ دوم جداست', shopLogin.body.user?.id !== ok.body.user?.id && shopLogin.body.isNew === true);

  console.log('\n▶ برنامه‌هایی که فرمِ ساده می‌فرستند (نه JSON)');
  await wait(2100);
  const formRes = await fetch(`${BASE}/api/app/auth/request-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ phone: '09350001122', app: 'my-app' }),
  });
  const formBody = await formRes.json().catch(() => ({}));
  check('فرمِ ساده هم قبول می‌شود', formRes.status === 200 && formBody.sent === true, JSON.stringify(formBody));

  console.log('\n▶ وقتی سرویسِ پیامک خراب است');
  await wait(2100);
  const broken = await post('/api/app/auth/request-code', { phone: '09990000000', app: 'my-app' });
  check('خطای سرویسِ پیامک به برنامه گفته می‌شود', broken.status === 502 && broken.body.error === 'not_sent', JSON.stringify(broken.body));
  check('متنِ خطا هم می‌آید', typeof broken.body.deliveryError === 'string');

  console.log('\n▶ فرمی که هر دو فیلد را می‌فرستد');
  await wait(2100);
  const bothFields = await post('/api/app/auth/request-code', { phone: '', email: 'zahra@example.com', app: 'my-app' });
  check('فیلدِ خالی نادیده گرفته می‌شود', bothFields.status === 200 && bothFields.body.channel === 'email', JSON.stringify(bothFields.body));

  console.log('\n▶ ورودی‌های غلط');
  const bad1 = await post('/api/app/auth/request-code', { phone: '12' });
  check('شمارهٔ خراب رد می‌شود', bad1.status === 400 && bad1.body.error === 'bad_phone');
  const bad2 = await post('/api/app/auth/request-code', { email: 'not-an-email' });
  check('ایمیلِ خراب رد می‌شود', bad2.status === 400 && bad2.body.error === 'bad_email');
  const bad3 = await post('/api/app/auth/request-code', {});
  check('ورودیِ خالی رد می‌شود', bad3.status === 400 && bad3.body.error === 'empty');

  console.log('\n▶ صفحهٔ راهنما و پورتِ عمومی');
  const page = await fetch(`${BASE}/connect`);
  const html = await page.text();
  check('صفحهٔ /connect باز می‌شود', page.ok && html.includes('اتصال برنامه‌ها به این سرور'));

  const pub = await fetch(`http://127.0.0.1:${PUBLIC_PORT}/api/app/config`);
  const pubBody = await pub.json().catch(() => ({}));
  check('ورودِ برنامه‌ها روی پورتِ عمومی هم هست', pub.ok && pubBody.ok === true);
  const pubPanel = await fetch(`http://127.0.0.1:${PUBLIC_PORT}/api/files/list?path=.`);
  check('پنل روی پورتِ عمومی نیست', pubPanel.status === 404, `status=${pubPanel.status}`);
  const pubPage = await fetch(`http://127.0.0.1:${PUBLIC_PORT}/connect`);
  check('صفحهٔ راهنما از پورتِ عمومی هم باز می‌شود', pubPage.ok);

  console.log('\n▶ خروج');
  const out = await post('/api/app/auth/logout', {}, { Authorization: `Bearer ${token}` });
  check('خروج انجام شد', out.status === 200 && out.body.ok === true);
  const afterOut = await fetch(`${BASE}/api/app/me`, { headers: { Authorization: `Bearer ${token}` } });
  check('توکن بعد از خروج باطل است', afterOut.status === 401);
} catch (e) {
  failed++;
  console.log(`\n❌ آزمون شکست: ${e.message}`);
  console.log(serverOut.slice(-2000));
} finally {
  child.kill('SIGTERM');
  smsServer.close();
  smtpServer.close();
  await new Promise((r) => setTimeout(r, 400));
  child.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} تست درست، ${failed} تست خراب\n`);
process.exit(failed === 0 ? 0 : 1);
