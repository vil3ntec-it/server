// ---------------------------------------------------------------------------
//  آزمونِ دفترِ ورود — «هر برنامه در بخشِ خودش»
//      node test/app-logins.mjs
//
//  ⚠️ چرا این بخش ساخته شد: تا امروز هیچ تاریخچه‌ای از ورود نبود، فقط یک
//  «آخرین ورود» روی خودِ کاربر. یعنی نمی‌شد فهمید کی، کِی، از کجا و به
//  کدام برنامه وارد شده — و اگر حسابی دستِ کسِ دیگری می‌افتاد، هیچ ردی
//  نمی‌ماند.
//
//  آنچه سنجیده می‌شود:
//    • ورودِ هر برنامه فقط در بخشِ خودش دیده شود، نه در بخشِ بقیه
//    • تلاشِ ناموفق هم ثبت شود (همان‌ها می‌گویند کسی دارد حدس می‌زند)
//    • کد، توکن و کلیدِ تمدید هیچ‌وقت در دفتر ننشینند
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4804);
const SMTP_PORT = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-logins-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const smtp = net.createServer((sock) => {
  let stage = 'cmd';
  let msg = '';
  sock.setEncoding('utf8');
  sock.write('220 fake\r\n');
  sock.on('data', (c) => {
    if (stage === 'data') { msg += c; if (msg.includes('\r\n.\r\n')) { msg = ''; stage = 'cmd'; sock.write('250 ok\r\n'); } return; }
    for (const l of c.split('\r\n').filter(Boolean)) {
      const u = l.toUpperCase();
      if (u.startsWith('EHLO') || u.startsWith('HELO')) sock.write('250-f\r\n250 AUTH PLAIN\r\n');
      else if (u === 'DATA') { stage = 'data'; sock.write('354 go\r\n'); }
      else if (u === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 ok\r\n');
    }
  });
  sock.on('error', () => {});
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
      OTP_EMAIL_FROM: 'robot@test.local', CODES_RESEND_SECONDS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

const J = (h = {}) => ({ 'content-type': 'application/json', ...h });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (u, b, h = {}) => fetch(BASE + u, { method: 'POST', headers: J(h), body: JSON.stringify(b) });

try {
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 25000) {
    try { if ((await fetch(`${BASE}/health`)).ok) { up = true; break; } } catch { /* هنوز */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);

  const setup = await post('/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' })
    .then((r) => r.json());
  const admin = setup.token;
  check('مدیر ساخته شد', Boolean(admin), JSON.stringify(setup).slice(0, 200));
  const A = { authorization: `Bearer ${admin}` };

  console.log('\n── سه برنامه، سه کاربر ──');
  const keys = {};
  for (const [slug, name, kind] of [['shop-app', 'فروشگاه', 'app'], ['pump-app', 'پمپ', 'app'], ['my-site', 'سایت', 'site']]) {
    const r = await post('/api/codes-admin/apps', { slug, name, kind }, A).then((x) => x.json());
    keys[slug] = r.app?.apiKey;
  }
  check('سه برنامه ثبت شدند', Object.values(keys).every(Boolean), JSON.stringify(keys));

  /** یک ورودِ کامل: کد بخواه، کد را از پنل بردار، وارد شو */
  async function login(app, email, { wrong = false } = {}) {
    await post('/api/codes/request', { app, email, name: 'کاربر' }, { 'x-api-key': keys[app] });
    await wait(150);
    const live = await fetch(`${BASE}/api/codes-admin/live`, { headers: A }).then((r) => r.json());
    if (!Array.isArray(live.items)) throw new Error('live جواب نداد: ' + JSON.stringify(live).slice(0, 300));
    const row = live.items.find((i) => i.app === app && i.email === email);
    const code = wrong ? '000000' : row?.code;
    return post('/api/app/auth/verify-code', { app, email, code }, { 'x-api-key': keys[app] })
      .then((r) => r.json());
  }

  const a = await login('shop-app', 'ali@example.com');
  const b = await login('pump-app', 'reza@example.com');
  const c = await login('my-site', 'sara@example.com');
  check('هر سه وارد شدند', a.ok && b.ok && c.ok, JSON.stringify({ a: a.error, b: b.error, c: c.error }));

  console.log('\n── ورودِ هر برنامه فقط در بخشِ خودش ──');
  const shop = await fetch(`${BASE}/api/app-admin/logins?app=shop-app`, { headers: A }).then((r) => r.json());
  check('بخشِ فروشگاه یک ورود دارد', shop.logins.length === 1, JSON.stringify(shop.logins));
  check('و همان کاربرِ خودش است', shop.logins[0]?.email === 'ali@example.com', JSON.stringify(shop.logins[0]));
  /*  ⚠️ قلبِ آزمون: ورودِ یک برنامه نباید در بخشِ برنامهٔ دیگر دیده شود.  */
  check('ورودِ پمپ در بخشِ فروشگاه نیست',
    !shop.logins.some((l) => l.email === 'reza@example.com'), JSON.stringify(shop.logins));

  const pump = await fetch(`${BASE}/api/app-admin/logins?app=pump-app`, { headers: A }).then((r) => r.json());
  check('بخشِ پمپ هم فقط مالِ خودش است',
    pump.logins.length === 1 && pump.logins[0].email === 'reza@example.com', JSON.stringify(pump.logins));

  const all = await fetch(`${BASE}/api/app-admin/logins`, { headers: A }).then((r) => r.json());
  check('بی فیلتر، هر سه دیده می‌شوند', all.logins.length === 3, String(all.logins.length));

  console.log('\n── جزئیاتی که ثبت شده ──');
  const one = shop.logins[0];
  check('برنامه ثبت شده', one?.app === 'shop-app');
  check('موفق بودن ثبت شده', one?.ok === true);
  check('زمان ثبت شده', typeof one?.at === 'number' && one.at > 0);
  check('شناسهٔ کاربر ثبت شده', typeof one?.userId === 'number');
  check('«اولین ورود» علامت خورده', one?.isNew === true);

  console.log('\n── تلاشِ ناموفق هم ثبت می‌شود ──');
  /*
   *  ⚠️ این مهم‌تر از ورودِ موفق است: چند کدِ غلط پشتِ هم روی یک ایمیل،
   *  تنها نشانه‌ای است که کسی دارد حدس می‌زند.
   */
  for (let i = 0; i < 3; i++) await login('shop-app', 'ali@example.com', { wrong: true });
  const failedOnly = await fetch(`${BASE}/api/app-admin/logins?app=shop-app&only=failed`, { headers: A })
    .then((r) => r.json());
  check('تلاش‌های ناموفق ثبت شدند', failedOnly.logins.length === 3, String(failedOnly.logins.length));
  check('و دلیلشان معلوم است', failedOnly.logins.every((l) => l.reason === 'wrong_code'),
    JSON.stringify(failedOnly.logins.map((l) => l.reason)));
  const okOnly = await fetch(`${BASE}/api/app-admin/logins?app=shop-app&only=ok`, { headers: A })
    .then((r) => r.json());
  check('فیلترِ «موفق» فقط موفق‌ها را می‌دهد', okOnly.logins.length === 1);

  console.log('\n── خلاصهٔ هر برنامه ──');
  const sum = await fetch(`${BASE}/api/app-admin/logins/summary`, { headers: A }).then((r) => r.json());
  const shopSum = sum.apps.find((x) => x.slug === 'shop-app');
  check('خلاصه برای هر برنامه جدا می‌آید', sum.apps.length >= 3, String(sum.apps.length));
  check('ورودِ موفقِ امروز درست شمرده شده', shopSum?.today === 1, JSON.stringify(shopSum));
  check('ناموفقِ امروز هم شمرده شده', shopSum?.failedToday === 3, JSON.stringify(shopSum));
  check('حسابِ تازهٔ امروز شمرده شده', shopSum?.newToday === 1, JSON.stringify(shopSum));

  console.log('\n── یک ثبت، هر دو مسیرِ ورود، یک کلید ──');
  /*
   *  ⚠️ این بخش از یک باگِ واقعی درآمد. سرور دو دفترِ برنامه دارد
   *  (code_apps و app_clients) و دو مسیرِ ورود که هر کدام فقط یکی را
   *  می‌شناختند. تا دیروز پنهان بود، چون هر مسیر برنامهٔ ناشناخته را
   *  خودش خاموشی ثبت می‌کرد؛ وقتی آن ثبتِ بی‌حساب بسته شد، برنامه‌ای که
   *  در پنل ثبت می‌شد روی نصفِ سرور «unknown_app» می‌گرفت.
   */
  const solo = await post('/api/codes-admin/apps',
    { slug: 'only-codes', name: 'فقط در دفترِ کدها', kind: 'app' }, A).then((r) => r.json());
  const soloKey = solo.app?.apiKey;
  check('برنامه از بخشِ کدها ثبت شد', Boolean(soloKey), JSON.stringify(solo).slice(0, 150));

  //  همان کلید، روی مسیرِ *دیگر*
  const viaOther = await post('/api/app/auth/request-code',
    { app: 'only-codes', email: 'x@example.com' }, { 'x-api-key': soloKey });
  check('مسیرِ ورود هم می‌شناسدش', viaOther.status === 200, `status ${viaOther.status}`);
  check('و همان یک کلید روی هر دو مسیر کار می‌کند',
    (await post('/api/codes/request', { app: 'only-codes', email: 'y@example.com' },
      { 'x-api-key': soloKey })).status === 200);

  //  و برعکس: ثبت از بخشِ برنامه‌ها
  const solo2 = await post('/api/app-admin/clients',
    { slug: 'only-clients', name: 'فقط در دفترِ ورود', kind: 'app' }, A).then((r) => r.json());
  check('برنامه از بخشِ برنامه‌ها ثبت شد', solo2.ok === true, JSON.stringify(solo2).slice(0, 150));
  const key2 = solo2.client?.apiKey;
  check('مسیرِ کدها هم می‌شناسدش',
    (await post('/api/codes/request', { app: 'only-clients', email: 'z@example.com' },
      { 'x-api-key': key2 })).status === 200, String(key2));

  console.log('\n── نوعِ برنامه در پل گم نمی‌شود ──');
  /*
   *  ⚠️ دو دفتر واژگانِ متفاوتی برای «نوع» داشتند (app|site در برابر
   *  android|web|desktop). موقعِ پل زدن، «app» بی‌صدا به «web» می‌افتاد و
   *  «پمپ بنزین» در فهرستِ ورودها «سایت» نشان داده می‌شد. در عکسِ صفحه
   *  دیده شد، نه در هیچ خطایی.
   */
  const kinds = await fetch(`${BASE}/api/app-admin/logins/summary`, { headers: A }).then((r) => r.json());
  const pumpRow = kinds.apps.find((x) => x.slug === 'pump-app');
  const siteRow = kinds.apps.find((x) => x.slug === 'my-site');
  check('برنامه، «برنامه» می‌ماند نه «سایت»', pumpRow?.kindLabel === 'برنامه', JSON.stringify(pumpRow));
  check('و سایت، «سایت»', siteRow?.kindLabel === 'سایت', JSON.stringify(siteRow));

  console.log('\n── دفتر نباید خودش گاوصندوقِ باز باشد ──');
  /*
   *  ⚠️ کد، توکن و کلیدِ تمدید هیچ‌وقت نباید در دفتر بنشینند. اگر روزی
   *  کسی این جدول را بخواند، نباید بتواند با آن وارد شود.
   */
  const raw = JSON.stringify(all.logins);
  check('کدِ شش‌رقمی در دفتر نیست', !/\b\d{6}\b/.test(raw.replace(/\d{10,}/g, '')), raw.slice(0, 200));
  check('توکن در دفتر نیست', !raw.includes(String(a.token).slice(0, 20)));
  check('کلیدِ تمدید در دفتر نیست', !raw.includes(String(a.refreshToken).slice(0, 20)));
} finally {
  child.kill('SIGTERM');
  smtp.close();
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 ? 0 : 1);
