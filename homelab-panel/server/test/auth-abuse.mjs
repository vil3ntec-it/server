// ---------------------------------------------------------------------------
//  آزمونِ سوءاستفاده — سه سوراخی که با اندازه‌گیری پیدا شدند
//      node test/auth-abuse.mjs
//
//  ⚠️ هر سه از یک بررسیِ واقعیِ سرور درآمدند، نه از فهرستِ تئوری. پیش از
//  اصلاح، این فایل کاملاً قرمز بود:
//
//    ۱) ۲۵ تلاشِ ورود با X-Forwarded-Forِ جعلی → ۰ تا مسدود
//    ۲) ۶۰ ایمیلِ متفاوت از یک IP            → ۶۰ تا در صفِ ارسال
//    ۳) ۲۰ نامِ برنامهٔ ساختگیِ بی‌کلید        → ۲۰ ردیفِ تازه در دفتر
//
//  هر سه یک ریشه داشتند: چیزی که از خودِ درخواست می‌آمد، باور می‌شد.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as totpLib from '../src/lib/totp.js';

const PORT = Number(process.env.TEST_PORT || 4798);
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-abuse-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '0',
      HLP_MAX_UPLOAD: String(64 * 1024),   // سقفِ کوچک تا بتوان از آن گذشت و سنجید
      CODES_RESEND_SECONDS: '0',   // فاصله را برمی‌داریم تا *سقفِ ساعتی* سنجیده شود
      CODES_MAX_PER_EMAIL_HOUR: '6',
      CODES_MAX_PER_IP_HOUR: '10',
      HLP_AUTO_REGISTER_PER_HOUR: '3',
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

  /* ------------------------------------------------------------------ */
  console.log('\n── ۱) سقفِ ورود با هدرِ جعلی دور نمی‌خورد ──');
  /*
   *  ⚠️ HLP_TRUST_PROXY تنظیم نشده. ولی خودِ اتصال از ۱۲۷.۰.۰.۱ است
   *  (آزمون روی همین دستگاه اجرا می‌شود)، پس سرور هدر را باور می‌کند —
   *  همان رفتاری که با تونل لازم است. یعنی این‌جا بدترین حالت را
   *  می‌سنجیم: جایی که هدر *پذیرفته* می‌شود.
   *
   *  انتظار: حتی با IPهای متفاوت، هر IP سقفِ خودش را دارد و یک IP
   *  نمی‌تواند بی‌نهایت تلاش کند.
   */
  let blockedSame = 0;
  for (let i = 0; i < 25; i++) {
    const r = await post('/api/auth/login', { username: 'x', password: 'y' },
      { 'x-forwarded-for': '203.0.113.7' });
    if (r.status === 429) blockedSame++;
  }
  check('۲۵ تلاش از یک IP → مسدود می‌شود', blockedSame > 0, `${blockedSame} مسدود`);

  /*
   *  و مهم‌تر: وقتی هدر باور *نمی‌شود* (اتصالِ غیرِمحلی)، نباید بشود با
   *  عوض کردنش سطلِ تازه گرفت. این را مستقیم روی خودِ تابع می‌سنجیم،
   *  چون از این‌جا نمی‌شود اتصالِ غیرِلوکال ساخت.
   */
  const { clientIp } = await import('../src/platform/security.js');
  const fake = (sock, h = {}) => ({ socket: { remoteAddress: sock }, headers: h });
  check('از اینترنت، هدرِ جعلی نادیده گرفته می‌شود',
    clientIp(fake('203.0.113.9', { 'x-forwarded-for': '1.1.1.1' })) === '203.0.113.9');
  check('از تونلِ محلی، هدرِ کلودفلر باور می‌شود',
    clientIp(fake('127.0.0.1', { 'cf-connecting-ip': '8.8.8.8' })) === '8.8.8.8');
  check('کلودفلر بر X-Forwarded-For مقدم است',
    clientIp(fake('127.0.0.1', { 'cf-connecting-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1' })) === '8.8.8.8');

  /*  و «فقط از شبکهٔ خانگی» هم با همان هدر دور می‌خورد — دور نخورد  */
  const { isLocalRequest } = await import('../src/stations/index.js');
  check('ثبتِ پمپ: مهاجمِ اینترنتی با هدرِ 192.168 رد می‌شود',
    isLocalRequest(fake('203.0.113.9', { 'x-forwarded-for': '192.168.1.5' })) === false);
  check('ثبتِ پمپ: شبکهٔ خانگیِ واقعی همچنان باز است',
    isLocalRequest(fake('192.168.1.5', {})) === true);
  check('ثبتِ پمپ: کاربرِ اینترنتی از تونل رد می‌شود',
    isLocalRequest(fake('127.0.0.1', { 'cf-connecting-ip': '8.8.8.8' })) === false);

  /* ------------------------------------------------------------------ */
  console.log('\n── ۲) سهمیهٔ ایمیل نمی‌سوزد ──');
  const setup = await post('/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' })
    .then((r) => r.json());
  const token = setup.token;
  const made = await post('/api/codes-admin/apps', { slug: 'app-a', name: 'برنامه A', kind: 'app' },
    { authorization: `Bearer ${token}` }).then((r) => r.json());
  const key = made.app?.apiKey;
  check('برنامهٔ آزمون ساخته شد', Boolean(key), JSON.stringify(made).slice(0, 120));

  //  یک ایمیل، پشتِ هم — سقفِ ۶ تایی
  let ok1 = 0;
  let capped1 = 0;
  for (let i = 0; i < 12; i++) {
    const r = await post('/api/codes/request', { app: 'app-a', email: 'victim@example.com' },
      { 'x-api-key': key });
    const b = await r.json();
    if (b.ok) ok1++;
    else if (b.error === 'too_many_requests') { capped1++; check.status = r.status; }
  }
  check('برای یک ایمیل بیش از سقف ساخته نمی‌شود', ok1 <= 6, `${ok1} ساخته شد`);
  check('و مازاد با «زیاد شد» رد می‌شود', capped1 > 0, `${capped1} رد شد`);

  //  ایمیل‌های متفاوت از یک IP — سقفِ ۱۰ تایی
  let ok2 = 0;
  for (let i = 0; i < 40; i++) {
    const b = await post('/api/codes/request', { app: 'app-a', email: `t${i}@example.com` },
      { 'x-api-key': key }).then((r) => r.json());
    if (b.ok) ok2++;
  }
  /*
   *  ⚠️ قلبِ این آزمون. پیش از اصلاح این عدد ۴۰ می‌شد — یعنی یک نفر
   *  می‌توانست در چند ثانیه سهمیهٔ روزانهٔ جیمیل را بسوزاند.
   */
  check('۴۰ ایمیلِ متفاوت از یک IP → سقفِ IP می‌خورد', ok1 + ok2 <= 10,
    `${ok1} + ${ok2} = ${ok1 + ok2} کد ساخته شد، سقف ۱۰ بود`);

  const after = await fetch(`${BASE}/api/codes-admin/live`, {
    headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
  const total = (after.items || []).length;
  check('در مجموع کدهای ساخته‌شده محدود ماند', total <= 20, `${total} ردیف`);

  /* ------------------------------------------------------------------ */
  console.log('\n── ۳) دفترِ برنامه‌ها با نامِ ساختگی پر نمی‌شود ──');
  for (let i = 0; i < 20; i++) {
    await post('/api/codes/request', { app: `junk-${i}`, email: 'a@b.co' });
  }
  const apps = await fetch(`${BASE}/api/codes-admin/apps`, {
    headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
  const junk = (apps.apps || []).filter((a) => a.slug.startsWith('junk-')).length;
  check('۲۰ نامِ ساختگی → حداکثر سهمیهٔ ساعتی ثبت می‌شود', junk <= 3, `${junk} ردیف ساخته شد`);

  /*
   *  ⚠️ و این نیمهٔ دومِ همان قانون است: بستنِ کامل، برنامه‌هایی را که
   *  نامِ برنامه نمی‌فرستند می‌شکست. «main» باید همیشه کار کند.
   */
  const main = await post('/api/app/auth/request-code', { email: 'someone@example.com' });
  const mainBody = await main.json().catch(() => ({}));
  check('برنامه‌ای که نامِ برنامه نمی‌فرستد همچنان کار می‌کند',
    main.status !== 404 && mainBody.error !== 'unknown_app',
    `status ${main.status} ${JSON.stringify(mainBody).slice(0, 200)}`);

  /* ------------------------------------------------------------------ */
  console.log('\n── ۴) «تغییرِ رمز» با نشستِ دزدیده رمزِ فعلی را بی‌سقف حدس نمی‌زند (S13 ِ ممیزی) ──');
  /*
   *  ⛔ تا ۱.۵۰.۷۲ `authLimiter` پس از روترِ ‎/api/auth‎ سوار بود و روی ‎change-password‎ نمی‌دوید: نشستِ دزدیده
   *  (یا مرورگرِ بازِ رهاشده) رمزِ فعلی را بی‌پایان حدس می‌زد — همان چیزی که احرازِ دوباره سقف داشت.
   */
  //  همان نشستِ مدیری که بخشِ ۲ ساخت (رمزش ‎ControlCenter!2026‎)
  const authH = { authorization: `Bearer ${token || ''}` };
  const tries = [];
  for (let i = 0; i < 6; i++) {
    tries.push((await post('/api/auth/change-password', { oldPassword: `guess-${i}-x`, newPassword: 'Brand-New-2026-x' }, authH)).status);
  }
  check('⛔ پنج حدسِ غلط ۴۰۰ و ششمی ۴۲۹ (سقفِ خودِ نشست)', Boolean(token) && tries.slice(0, 5).every((x) => x === 400) && tries[5] === 429, tries.join(' '));
  const forged = await post('/api/auth/change-password', { oldPassword: 'ControlCenter!2026', newPassword: 'Brand-New-2026-x' }, { ...authH, 'x-forwarded-for': '203.0.113.77' });
  check('⛔ X-Forwarded-For ِ جعلی سقف را باز نمی‌کند (و رمز عوض نشد)', forged.status === 429, `status ${forged.status}`);
  const v1 = await post('/api/panel/v1/auth/change-password', { oldPassword: 'guess-v1', newPassword: 'Brand-New-2026-x' }, authH);
  check('⛔ درِ ‎/api/panel/v1‎ همان سقف را دارد', v1.status === 429, `status ${v1.status}`);

  /* ------------------------------------------------------------------ */
  console.log('\n── ۵) سقفِ آپلودِ خام با بدنهٔ بی‌طول (chunked) دور نمی‌خورد (۱.۵۰.۸۲) ──');
  /*
   *  ⛔ تا ۱.۵۰.۸۱ سقفِ آپلود فقط `content-length` را می‌سنجید. درخواستِ
   *  ‎Transfer-Encoding: chunked‎ طول نمی‌فرستد ⇒ `0 > max` نادرست ⇒ بی‌سقف روی
   *  دیسک. این‌جا سقف ۶۴ کیلوبایت است و ۳۰۰ کیلوبایت فرستاده می‌شود.
   */
  const uploadToken = token;
  const sitesDir = path.join(tmp, 'sites');
  const big = Buffer.alloc(300 * 1024, 0x61);
  const withLen = await fetch(`${BASE}/api/files/upload?dir=${encodeURIComponent(sitesDir)}&name=len.bin`, {
    method: 'PUT', headers: { authorization: `Bearer ${uploadToken}` }, body: big,
  });
  check('با content-length، ۳۰۰ کیلوبایت رد می‌شود (۴۱۳)', withLen.status === 413, `status ${withLen.status}`);
  const chunked = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method: 'PUT',
      path: `/api/files/upload?dir=${encodeURIComponent(sitesDir)}&name=chunk.bin`,
      headers: { authorization: `Bearer ${uploadToken}`, 'transfer-encoding': 'chunked', 'content-type': 'application/octet-stream' } },
      (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    r.on('error', () => resolve({ status: 0, body: 'reset' }));
    for (let i = 0; i < big.length; i += 16 * 1024) r.write(big.subarray(i, i + 16 * 1024));
    r.end();
  });
  await wait(200);
  const chunkPath = path.join(sitesDir, 'chunk.bin');
  const onDisk = fs.existsSync(chunkPath) ? fs.statSync(chunkPath).size : -1;
  check('⛔ chunked ِ ۳۰۰ کیلوبایت نوشته نمی‌شود (رد یا ۴۱۳، نه ۲۰۰)', chunked.status !== 200, `status ${chunked.status}`);
  check('⛔ و پروندهٔ نیمه‌نوشته روی دیسک نمی‌ماند', onDisk <= 64 * 1024, `on disk ${onDisk}`);

  /* ------------------------------------------------------------------ */
  console.log('\n── ۶) «خاموش کردنِ دوعاملی» رمزِ فعلی را بی‌سقف حدس نمی‌زند (۱.۵۰.۸۲) ──');
  /*
   *  ⛔ تا ۱.۵۰.۸۱ ‎/api/auth/totp/disable‎ رمزِ فعلی را می‌خواست ولی هیچ سقفی نداشت:
   *  نشستِ دزدیده‌شده رمز را از این در بی‌پایان حدس می‌زد، در حالی که ‎/reauth‎ و
   *  ‎change-password‎ سقفِ نشست دارند. حالا همان سقف (۵ ناموفق در ربع ساعت، به نشست بسته).
   */
  const s = await post('/api/auth/totp/setup', {}, authH).then((r) => r.json());
  const en = await post('/api/auth/totp/enable', { code: totpLib.totp(s.secret) }, authH);
  check('دوعاملیِ آزمون روشن شد', en.status === 200, JSON.stringify(en).slice(0, 120));
  const dtries = [];
  for (let i = 0; i < 6; i++) dtries.push((await post('/api/auth/totp/disable', { password: `wrong-${i}`, code: '000000' }, authH)).status);
  check('⛔ پنج حدسِ غلط ۴۰۰ و ششمی ۴۲۹ (سقفِ خودِ نشست)', dtries.slice(0, 5).every((x) => x === 400) && dtries[5] === 429, dtries.join(' '));
  const dForged = await post('/api/auth/totp/disable', { password: 'wrong-x', code: '000000' }, { ...authH, 'x-forwarded-for': '203.0.113.88' });
  check('⛔ X-Forwarded-For ِ جعلی سقفِ نشست را باز نمی‌کند', dForged.status === 429, `status ${dForged.status}`);
} finally {
  child.kill('SIGTERM');
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
