// ---------------------------------------------------------------------------
//  آزمونِ «نگو فرستادم وقتی نفرستادی»
//      node test/codes-delivery.mjs
//
//  ⚠️ این آزمون از یک گزارشِ واقعی درآمد: «۵ تا تست زدم، ۲ ایمیل رفت و سه
//  تای دیگر اصلاً نیامد، در حالی که می‌گوید فرستادم.»
//
//  علتش هم همین بود: API همان میلی‌ثانیه‌ای که *کد* ساخته می‌شد ok برمی‌گرداند
//  و پنل می‌نوشت «فرستاده شد» — ولی ایمیل تازه پشتِ سر، در صف، می‌رفت. اگر
//  سرورِ ایمیل آن‌جا نه می‌گفت (ایمیلِ اشتباه، سقفِ روزانهٔ جیمیل، بسته‌شدنِ
//  در)، هیچ‌کس خبردار نمی‌شد. پیام «فرستاده شد» همان‌جا روی صفحه مانده بود.
//
//  این‌جا سرورِ ایمیلِ قلابی عمداً به سه نفر «نه» می‌گوید. انتظار داریم پنل
//  دقیقاً همان سه تا را «نرفت» نشان دهد، با دلیل.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4796);
const SMTP_PORT = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-delivery-'));
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
    console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 400) : ''}`);
  }
};

/* ------------------------- سرورِ ایمیلِ قلابی ----------------------------- */
/*
 *  دو نفر را قبول می‌کند، سه نفر را رد. دقیقاً همان کاری که یک سرورِ
 *  واقعی با ایمیلِ اشتباه یا مسدود می‌کند.
 */
const GOOD = ['ok1@example.com', 'ok2@example.com'];
const BAD = ['no1@example.com', 'no2@example.com', 'no3@example.com'];

const delivered = [];
const smtpServer = net.createServer((socket) => {
  let stage = 'cmd';
  let message = '';
  let rcpt = '';
  socket.setEncoding('utf8');
  socket.write('220 fake ESMTP\r\n');
  socket.on('data', (chunk) => {
    if (stage === 'data') {
      message += chunk;
      if (message.includes('\r\n.\r\n')) {
        delivered.push(rcpt);
        message = '';
        stage = 'cmd';
        socket.write('250 2.0.0 OK 1699999999 fake-queue-id - gsmtp\r\n');
      }
      return;
    }
    for (const line of chunk.split('\r\n').filter(Boolean)) {
      const cmd = line.toUpperCase();
      if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (cmd.startsWith('AUTH')) socket.write('235 ok\r\n');
      else if (cmd.startsWith('MAIL FROM')) socket.write('250 ok\r\n');
      else if (cmd.startsWith('RCPT TO')) {
        rcpt = (line.match(/<([^>]*)>/) || [, ''])[1].toLowerCase();
        if (BAD.includes(rcpt)) socket.write('550 5.1.1 The email account that you tried to reach does not exist\r\n');
        else socket.write('250 ok\r\n');
      } else if (cmd === 'DATA') {
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

/* ------------------------------ خودِ سرور -------------------------------- */

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_SITESYNC_PORT: String(PORT + 1),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: dataDir,
      HLP_SITES_ROOT: sitesRoot,
      HLP_TUNNEL: '0',
      HLP_AI_ENABLED: '0',
      HLP_SITESYNC: '0',
      OTP_EMAIL_HOST: '127.0.0.1',
      OTP_EMAIL_PORT: String(SMTP_PORT),
      OTP_EMAIL_SECURE: '0',
      OTP_EMAIL_FROM: 'robot@test.local',
      CODES_RESEND_SECONDS: '0',
      // تلاشِ دوباره این‌جا فقط آزمون را کُند می‌کند؛ «نه» یعنی «نه»
      CODES_SEND_RETRIES: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

let token = null;
const call = async (method, url, body, headers = {}) => {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (token && !headers.noAuth) h.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const started = Date.now();
  let up = false;
  while (Date.now() - started < 25000) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) { up = true; break; }
    } catch { /* هنوز */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);

  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' });
  token = setup.body?.token
    || (await call('POST', '/api/auth/login', { username: 'admin', password: 'ControlCenter!2026' })).body?.token;
  if (!token) throw new Error('ورودِ مدیر نشد');

  console.log('\n── پنج ایمیل، مثلِ همان تستی که خودتان زدید ──');
  const results = new Map();
  for (const email of [...GOOD, ...BAD]) {
    const r = await call('POST', '/api/codes-admin/send', { app: 'main', email, name: 'کاربر' });
    results.set(email, r);
  }

  for (const email of GOOD) {
    const r = results.get(email);
    check(`${email} — سرور می‌گوید رفت`,
      r.body.ok === true && r.body.delivery?.state === 'sent', JSON.stringify(r.body));
  }

  /*
   *  ⚠️ قلبِ آزمون. پیش از این، هر پنج تا ok:true می‌گرفتند — چون پاسخ
   *  پیش از خودِ ارسال برمی‌گشت.
   */
  for (const email of BAD) {
    const r = results.get(email);
    check(`${email} — سرور نمی‌گوید رفت`,
      r.body.delivery?.state === 'failed', JSON.stringify(r.body));
    check(`${email} — و دلیلش را می‌گوید`,
      /550|does not exist|قبول نکرد/i.test(String(r.body.delivery?.error || '')),
      r.body.delivery?.error);
  }

  console.log('\n── و سرورِ ایمیل هم همین را می‌گوید ──');
  check('فقط دو ایمیل واقعاً تحویل شد', delivered.length === 2, delivered.join(', '));
  check('و همان دو تا بودند',
    GOOD.every((e) => delivered.includes(e)) && !BAD.some((e) => delivered.includes(e)),
    delivered.join(', '));

  console.log('\n── در فهرستِ پنل هم پیداست ──');
  const live = await call('GET', '/api/codes-admin/live');
  const byEmail = new Map((live.body.items || []).map((i) => [i.email, i]));
  for (const email of BAD) {
    check(`${email} — در فهرست «نرفت» است`, byEmail.get(email)?.sendState === 'failed',
      JSON.stringify(byEmail.get(email)));
  }
  for (const email of GOOD) {
    check(`${email} — در فهرست «رفت» است`, byEmail.get(email)?.sendState === 'sent',
      JSON.stringify(byEmail.get(email)));
    check(`${email} — رسیدِ سرورِ ایمیل ثبت شده`,
      String(byEmail.get(email)?.sendResponse || '').includes('fake-queue-id'),
      byEmail.get(email)?.sendResponse);
  }
} finally {
  child.kill('SIGTERM');
  smtpServer.close();
  await wait(300);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
