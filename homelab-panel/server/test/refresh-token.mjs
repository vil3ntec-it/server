// ---------------------------------------------------------------------------
//  آزمونِ تمدیدِ ورود
//      node test/refresh-token.mjs
//
//  ⚠️ چرا این بخش ساخته شد: توکنِ برنامه ۳۰ روزه بود و راهِ تمدید نداشت.
//  یعنی یا بلند می‌ماند — و توکنِ دزدیده‌شده یک ماه کار می‌کرد — یا کوتاه
//  می‌شد و کاربر هر چند روز دوباره کدِ ایمیلی می‌خواست (که سهمیهٔ ایمیل را
//  هم می‌سوزاند).
//
//  آنچه این‌جا سنجیده می‌شود همان چیزهایی است که اگر بشکنند، یا کاربر
//  بی‌دلیل بیرون می‌افتد یا یک کلیدِ دزدیده‌شده برای همیشه کار می‌کند.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4799);
const SMTP_PORT = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-refresh-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

/* سرورِ ایمیلِ قلابی — فقط تا کد جایی برود */
const inbox = [];
const smtp = net.createServer((socket) => {
  let stage = 'cmd';
  let message = '';
  socket.setEncoding('utf8');
  socket.write('220 fake ESMTP\r\n');
  socket.on('data', (chunk) => {
    if (stage === 'data') {
      message += chunk;
      if (message.includes('\r\n.\r\n')) { inbox.push(message); message = ''; stage = 'cmd'; socket.write('250 ok\r\n'); }
      return;
    }
    for (const line of chunk.split('\r\n').filter(Boolean)) {
      const c = line.toUpperCase();
      if (c.startsWith('EHLO') || c.startsWith('HELO')) socket.write('250-fake\r\n250 AUTH PLAIN LOGIN\r\n');
      else if (c === 'DATA') { stage = 'data'; socket.write('354 go\r\n'); }
      else if (c === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
      else socket.write('250 ok\r\n');
    }
  });
  socket.on('error', () => {});
});
await new Promise((r) => smtp.listen(SMTP_PORT, '127.0.0.1', r));

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '0',
      OTP_EMAIL_HOST: '127.0.0.1', OTP_EMAIL_PORT: String(SMTP_PORT), OTP_EMAIL_SECURE: '0',
      OTP_EMAIL_FROM: 'robot@test.local',
      CODES_RESEND_SECONDS: '0',
      /*
       *  ⚠️ عمرِ توکن کفِ ۳۰۰ ثانیه دارد و عمدی است — توکنِ چندثانیه‌ای
       *  به درد نمی‌خورد و یک اشتباهِ تایپی در تنظیمات نباید همهٔ کاربران
       *  را هر ثانیه بیرون بیندازد. پس این آزمون منتظرِ انقضا نمی‌ماند؛
       *  نشست را مستقیم در دیتابیس منقضی می‌کند. که سنجهٔ بهتری هم هست:
       *  ابطالِ سمتِ سرور را می‌سنجد، نه فقط exp داخلِ خودِ توکن را.
       */
      OTP_ACCESS_TTL: '300',
      OTP_TOKEN_TTL: '3600',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

const J = (h = {}) => ({ 'content-type': 'application/json', ...h });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (url, body, headers = {}) =>
  fetch(BASE + url, { method: 'POST', headers: J(headers), body: JSON.stringify(body) });

try {
  const started = Date.now();
  let up = false;
  while (Date.now() - started < 25000) {
    try { if ((await fetch(`${BASE}/health`)).ok) { up = true; break; } } catch { /* هنوز */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);

  const token = (await post('/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' })
    .then((r) => r.json())).token;
  const admin = { authorization: `Bearer ${token}` };

  console.log('\n── ورود با کد، و کلیدِ تمدید ──');
  await post('/api/app/auth/request-code', { email: 'ali@example.com' });
  const live = await fetch(`${BASE}/api/codes-admin/live`, { headers: admin }).then((r) => r.json());
  const code = live.items?.[0]?.code;
  check('کد ساخته شد', /^\d{6}$/.test(String(code)), JSON.stringify(live.items?.[0]));

  const login = await post('/api/app/auth/verify-code', { email: 'ali@example.com', code })
    .then((r) => r.json());
  check('ورود انجام شد', login.ok === true, JSON.stringify(login).slice(0, 200));
  check('توکن داده شد', typeof login.token === 'string' && login.token.length > 20);
  check('کلیدِ تمدید هم داده شد', typeof login.refreshToken === 'string' && login.refreshToken.length > 20);
  check('عمرِ توکن کوتاه است، نه ۳۰ روز', login.expiresIn === 300, String(login.expiresIn));
  check('ولی تا یک ساعت قابلِ تمدید است', login.refreshExpiresIn > 3000, String(login.refreshExpiresIn));
  check('و عمرِ توکن از مهلتِ تمدید کوتاه‌تر است', login.expiresIn < login.refreshExpiresIn);

  const me = (u, t) => fetch(`${BASE}/api/app/me`, { headers: { authorization: `Bearer ${t}` } });
  check('با توکن می‌شود وارد شد', (await me(null, login.token)).status === 200);

  console.log('\n── توکن که منقضی شد، تمدید کار می‌کند ──');
  /*
   *  نشست را از خودِ دیتابیس منقضی می‌کنیم — بی‌آنکه پنج دقیقه صبر کنیم.
   *
   *  ⚠️ این تکه یک بار روی CI قرمز شد با «database is locked» و همان‌جا
   *  یک اشتباهِ واقعی را نشان داد: busy_timeout را به اتصالِ *سرور*
   *  اضافه کرده بودم، ولی این‌جا اتصالِ دومی باز می‌شود که آن تنظیم را
   *  ندارد. بی busy_timeout، SQLite همان لحظه که قفل ببیند می‌افتد —
   *  صبر نمی‌کند.
   *
   *  و سرور همان لحظه بی‌کار نیست: صفِ کدها هر ۱٫۵ ثانیه می‌نویسد. پس
   *  بسته به اینکه این خط کجای آن تیک بیفتد، گاهی می‌گذشت و گاهی نه.
   *  همان کامیت روی یک اجرا سبز شد و روی اجرای دیگر قرمز — آزمونی که
   *  به شانسِ زمان‌بندی بسته باشد از آزمونِ نداشته هم بدتر است.
   *
   *  اثبات شد: با قفلِ نگه‌داشته، بدونِ busy_timeout همان لحظه
   *  «database is locked»؛ با آن، صبر می‌کند.
   */
  {
    const dbFile = path.join(tmp, 'data', 'panel.db');
    let done = false;
    let lastError = null;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      const handle = new DatabaseSync(dbFile);
      try {
        handle.exec('PRAGMA busy_timeout = 5000');
        handle.exec(`UPDATE app_sessions SET expires_at = ${Date.now() - 1000}`);
        done = true;
      } catch (e) {
        lastError = e;
        await wait(300);
      } finally {
        try { handle.close(); } catch { /* بسته شده */ }
      }
    }
    check('نشست از دیتابیس منقضی شد', done, lastError?.message);
  }
  check('توکنِ منقضی رد می‌شود', (await me(null, login.token)).status === 401);

  const r1 = await post('/api/app/auth/refresh', { refreshToken: login.refreshToken });
  const b1 = await r1.json();
  check('تمدید جواب داد', r1.status === 200 && b1.ok === true, JSON.stringify(b1).slice(0, 200));
  check('توکنِ تازه داد', b1.token && b1.token !== login.token);
  check('و با آن می‌شود وارد شد', (await me(null, b1.token)).status === 200);
  check('کاربر همان است', b1.user?.email === 'ali@example.com', JSON.stringify(b1.user));

  console.log('\n── کلیدِ تمدید یک‌بارمصرف است ──');
  /*
   *  ⚠️ مهم‌ترین سنجهٔ این فایل. اگر کلیدِ کهنه باز هم کار کند، کسی که
   *  یک بار آن را دزدیده تا ابد می‌تواند توکنِ تازه بگیرد و صاحبِ حساب
   *  هیچ‌وقت نمی‌فهمد.
   */
  check('کلیدِ تازه با قبلی فرق دارد', b1.refreshToken && b1.refreshToken !== login.refreshToken);
  const reuse = await post('/api/app/auth/refresh', { refreshToken: login.refreshToken });
  check('کلیدِ سوخته دیگر کار نمی‌کند', reuse.status === 401, `status ${reuse.status}`);

  console.log('\n── سقفِ تمدید از سرِ نو شروع نمی‌شود ──');
  /*
   *  ⚠️ وگرنه یک نشست با تمدیدهای پشتِ هم برای همیشه زنده می‌ماند و
   *  «۳۰ روز» عملاً بی‌معنا می‌شد.
   */
  check('مهلتِ تمدید همان قبلی ماند',
    Math.abs(b1.refreshExpiresAt - login.refreshExpiresAt) < 2000,
    `${login.refreshExpiresAt} → ${b1.refreshExpiresAt}`);

  console.log('\n── چیزهایی که باید رد شوند ──');
  check('کلیدِ ساختگی رد می‌شود',
    (await post('/api/app/auth/refresh', { refreshToken: 'x'.repeat(43) })).status === 401);
  check('بدونِ کلید رد می‌شود', (await post('/api/app/auth/refresh', {})).status === 401);

  console.log('\n── خروج، کلیدِ تمدید را هم می‌سوزاند ──');
  const r2 = await post('/api/app/auth/refresh', { refreshToken: b1.refreshToken }).then((r) => r.json());
  check('یک تمدیدِ دیگر هم جواب می‌دهد', r2.ok === true);
  await post('/api/app/auth/logout', {}, { authorization: `Bearer ${r2.token}` });
  check('بعد از خروج توکن باطل است', (await me(null, r2.token)).status === 401);
  check('و کلیدِ تمدیدش هم باطل است',
    (await post('/api/app/auth/refresh', { refreshToken: r2.refreshToken })).status === 401);

  console.log('\n── حسابِ مسدود، تمدید نمی‌گیرد ──');
  await post('/api/app/auth/request-code', { email: 'blocked@example.com' });
  const l2 = await fetch(`${BASE}/api/codes-admin/live`, { headers: admin }).then((r) => r.json());
  const c2 = l2.items?.find((i) => i.email === 'blocked@example.com')?.code;
  const s2 = await post('/api/app/auth/verify-code', { email: 'blocked@example.com', code: c2 })
    .then((r) => r.json());
  check('کاربرِ دوم وارد شد', s2.ok === true, JSON.stringify(s2).slice(0, 150));
  await fetch(`${BASE}/api/app-admin/users/${s2.user.id}/block`, { method: 'POST', headers: J(admin) })
    .catch(() => {});
  const blockedTry = await post('/api/app/auth/refresh', { refreshToken: s2.refreshToken });
  check('حسابِ مسدود تمدید نمی‌گیرد', blockedTry.status !== 200, `status ${blockedTry.status}`);
} finally {
  child.kill('SIGTERM');
  smtp.close();
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
