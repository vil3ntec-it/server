// ---------------------------------------------------------------------------
//  آزمونِ سرتاسریِ «کدهای شش‌رقمی» — روی سرورِ واقعی
//
//      node test/codes-api.mjs
//
//  سرور بالا می‌آید، یک برنامه از راهِ پنل ثبت می‌شود، یک برنامهٔ بیرونی با
//  همان کلید کد می‌خواهد، ایمیل واقعاً به سرورِ SMTPِ قلابی می‌رسد، و همان
//  کد در فهرستِ پنل — همان چیزی که با دکمهٔ کپی برداشته می‌شود — دیده می‌شود.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4788);
const SMTP_PORT = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-codes-api-'));
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
    console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`);
  }
};

/* ------------------------- سرورِ ایمیلِ قلابی ----------------------------- */

const inbox = [];
const smtpServer = net.createServer((socket) => {
  let stage = 'cmd';
  let message = '';
  socket.setEncoding('utf8');
  socket.write('220 fake ESMTP\r\n');
  socket.on('data', (chunk) => {
    if (stage === 'data') {
      message += chunk;
      if (message.includes('\r\n.\r\n')) {
        inbox.push(message);
        message = '';
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
      if ((await fetch(`${BASE}/health`)).ok) {
        up = true;
        break;
      }
    } catch { /* هنوز */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);

  console.log('\n── ورودِ مدیر ──');
  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' });
  token = setup.body?.token || null;
  if (!token) {
    const login = await call('POST', '/api/auth/login', { username: 'admin', password: 'ControlCenter!2026' });
    token = login.body?.token || null;
  }
  check('مدیر وارد شد', Boolean(token), JSON.stringify(setup.body));

  console.log('\n── ثبتِ برنامه از راهِ پنل ──');
  const made = await call('POST', '/api/codes-admin/apps', {
    slug: 'app-fuel-001',
    name: 'پمپ بنزین',
    kind: 'app',
  });
  check('برنامه ساخته شد', made.status === 200 && made.body.ok, JSON.stringify(made.body));
  const apiKey = made.body?.app?.apiKey;
  check('کلید ساخته شد', /^code_[0-9a-f]{40}$/.test(String(apiKey)), String(apiKey));

  console.log('\n── برنامهٔ بیرونی کد می‌خواهد ──');
  const noKey = await call('POST', '/api/codes/request', { app: 'app-fuel-001', email: 'ali@example.com' }, { noAuth: true });
  check('بدونِ کلید رد می‌شود', noKey.status === 401, JSON.stringify(noKey.body));

  const asked = await call(
    'POST',
    '/api/codes/request',
    { app: 'app-fuel-001', email: 'Ali@Example.com', userId: 'FUEL-001' },
    { 'X-Api-Key': apiKey, noAuth: true },
  );
  check('با کلید، کد ساخته شد', asked.status === 200 && asked.body.ok === true, JSON.stringify(asked.body));
  check('کد در پاسخِ عمومی لو نمی‌رود', asked.body.code === undefined);
  check('ایمیل ماسک شده برمی‌گردد', String(asked.body.email).includes('•'), asked.body.email);

  console.log('\n── ایمیل واقعاً رفت ──');
  let mail = null;
  for (let i = 0; i < 40 && !mail; i++) {
    await wait(250);
    mail = inbox[inbox.length - 1] || null;
  }
  check('سرورِ ایمیل پیام گرفت', Boolean(mail), `${inbox.length} پیام`);

  console.log('\n── همان کد در پنل دیده می‌شود ──');
  const live = await call('GET', '/api/codes-admin/live');
  check('فهرست جواب می‌دهد', live.status === 200 && Array.isArray(live.body.items));
  const row = live.body.items?.[0];
  check('ایمیل درست نشسته', row?.email === 'ali@example.com', JSON.stringify(row));
  check('نامِ برنامه نشان داده می‌شود', row?.appName === 'پمپ بنزین');
  check('شناسهٔ کاربر ثبت شده', row?.subjectId === 'FUEL-001');
  check('کدِ شش‌رقمی برای کپی آماده است', /^\d{6}$/.test(String(row?.code)), String(row?.code));
  check('وضعیتِ ارسال گزارش می‌شود', ['sent', 'sending', 'queued'].includes(row?.sendState), row?.sendState);

  console.log('\n── همان کد کار می‌کند ──');
  const wrong = await call(
    'POST',
    '/api/codes/verify',
    { app: 'app-fuel-001', email: 'ali@example.com', code: '000000' },
    { 'X-Api-Key': apiKey, noAuth: true },
  );
  check('کدِ غلط رد می‌شود', wrong.status === 400 && wrong.body.error === 'wrong_code', JSON.stringify(wrong.body));

  const right = await call(
    'POST',
    '/api/codes/verify',
    { app: 'app-fuel-001', email: 'ali@example.com', code: row.code },
    { 'X-Api-Key': apiKey, noAuth: true },
  );
  check('کدِ درست قبول می‌شود', right.status === 200 && right.body.ok === true, JSON.stringify(right.body));
  check('شناسهٔ کاربر برمی‌گردد', right.body.subjectId === 'FUEL-001');

  const twice = await call(
    'POST',
    '/api/codes/verify',
    { app: 'app-fuel-001', email: 'ali@example.com', code: row.code },
    { 'X-Api-Key': apiKey, noAuth: true },
  );
  check('بارِ دوم کار نمی‌کند', twice.body.ok !== true, JSON.stringify(twice.body));

  console.log('\n── برنامهٔ ناشناس خودش ثبت می‌شود ولی در باز نمی‌ماند ──');
  const stranger = await call(
    'POST',
    '/api/codes/request',
    { app: 'brand-new-shop', email: 'x@example.com' },
    { noAuth: true },
  );
  check('بدونِ کلید کاری نمی‌کند', stranger.status === 401, JSON.stringify(stranger.body));
  const list = await call('GET', '/api/codes-admin/apps');
  check('ولی در پنل دیده می‌شود', list.body.apps?.some((a) => a.slug === 'brand-new-shop'));

  console.log('\n── گزارشِ پوشهٔ قابلِ حمل ──');
  const portable = await call('GET', '/api/settings/portable');
  check('گزارش جواب می‌دهد', portable.status === 200 && portable.body.ok === true);
  check('دیتابیس داخلِ پوشه است', portable.body.items?.find((i) => i.key === 'db')?.inside === true);
} finally {
  child.kill('SIGTERM');
  smtpServer.close();
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed ? 1 : 0);
