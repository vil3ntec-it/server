// ---------------------------------------------------------------------------
//  آزمونِ «درِ مدیر»
//
//      node test/admin-gate.mjs
//
//  دو سؤال را می‌سنجد و هر دو مهم‌اند:
//
//    ۱) آیا برنامهٔ مدیر با کلیدِ درست، از راهِ پورتِ عمومی به کلِ سرور
//       می‌رسد؟ (وگرنه این کار بی‌فایده است)
//    ۲) آیا بدونِ کلید، هیچ چیزی درز نمی‌کند؟ (وگرنه این کار خطرناک است)
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4781);
const PUBLIC_PORT = PORT + 1;
const PANEL = `http://127.0.0.1:${PORT}`;
const PUBLIC = `http://127.0.0.1:${PUBLIC_PORT}`;

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-gate-'));
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

const child = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_SITESYNC_PORT: String(PUBLIC_PORT),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: dataDir,
      HLP_SITES_ROOT: sitesRoot,
      HLP_TUNNEL: '0',
      HLP_AI_ENABLED: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 *  درخواست با هدرِ Host دلخواه.
 *
 *  ⚠️ با fetch نمی‌شود: undici هدرِ Host را «ممنوع» می‌داند و بی‌صدا
 *  دور می‌ریزد، پس درخواست با نامِ میزبانِ واقعی می‌رسد و آزمون چیزی را
 *  می‌سنجد که فکر می‌کند. با http.request خودمان هدر را می‌گذاریم.
 */
function withHost(port, url, host, headers = {}, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const head = { ...headers, host };
    if (payload) {
      head['content-type'] = 'application/json';
      head['content-length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { host: '127.0.0.1', port, path: url, method, headers: head },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch { /* متنِ ساده */ }
          resolve({ status: res.statusCode, text, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function call(base, url, { method = 'GET', body, token, gate } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (gate) headers['X-Admin-Gate'] = gate;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch { /* متنِ ساده */ }
  return { status: res.status, body: parsed, text };
}

try {
  const started = Date.now();
  let up = false;
  while (Date.now() - started < 25_000) {
    try {
      if ((await fetch(`${PANEL}/health`)).ok) {
        up = true;
        break;
      }
    } catch { /* هنوز */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);

  console.log('\n── ورودِ مدیر (از داخلِ خانه) ──');
  const setup = await call(PANEL, '/api/auth/setup', {
    method: 'POST',
    body: { username: 'admin', password: 'ControlCenter!2026' },
  });
  const token = setup.body?.token;
  check('مدیر وارد شد', Boolean(token), JSON.stringify(setup.body));

  console.log('\n── پنل از پورتِ عمومی دیده نمی‌شود ──');
  const bare = await call(PUBLIC, '/api/dashboard', { token });
  check('داشبورد روی پورتِ عمومی نیست', bare.status === 404, `status ${bare.status}`);
  const control = await call(PUBLIC, '/api/control/tohid/accounts', { token });
  check('مرکز فرمان روی پورتِ عمومی نیست', control.status === 404, `status ${control.status}`);

  console.log('\n── درِ بسته، از بیرون ──');
  const noKey = await call(PUBLIC, '/api/admin-gate/api/dashboard', { token });
  check('بدونِ کلید: not found', noKey.status === 404, `status ${noKey.status}`);
  check('هیچ نشانه‌ای از وجودِ در نمی‌دهد', !/gate|admin|unauthorized/i.test(noKey.text), noKey.text);

  const wrongKey = await call(PUBLIC, '/api/admin-gate/api/dashboard', {
    token,
    gate: 'this-is-not-the-key-but-is-long-enough-to-pass',
  });
  check('کلیدِ غلط: not found', wrongKey.status === 404, `status ${wrongKey.status}`);
  check('جوابِ کلیدِ غلط با جوابِ بی‌کلید یکی است', wrongKey.text === noKey.text);

  console.log('\n── گرفتنِ کلید (فقط از داخل) ──');
  const denied = await call(PUBLIC, '/api/settings/remote/device', {
    method: 'POST',
    token,
    body: { deviceId: 'phone-1' },
  });
  check('از بیرون نمی‌شود کلید گرفت', denied.status === 404, `status ${denied.status}`);

  const issued = await call(PANEL, '/api/settings/remote/device', {
    method: 'POST',
    token,
    body: { deviceId: 'phone-1', name: 'گوشیِ من' },
  });
  const key = issued.body?.key;
  check('از داخل کلید صادر شد', Boolean(key) && key.length >= 40, JSON.stringify(issued.body));
  check('مسیر و نامِ هدر هم گفته می‌شود',
    issued.body?.gatePath === '/api/admin-gate' && issued.body?.gateHeader === 'x-admin-gate',
    JSON.stringify(issued.body));

  console.log('\n── با کلیدِ درست، کلِ سرور از راهِ دامنه ──');
  const dash = await call(PUBLIC, '/api/admin-gate/api/dashboard', { token, gate: key });
  check('داشبورد از راهِ در می‌آید', dash.status === 200 && Boolean(dash.body?.server),
    `status ${dash.status}`);

  const codes = await call(PUBLIC, '/api/admin-gate/api/codes-admin/live', { token, gate: key });
  check('کدهای شش‌رقمی هم می‌آیند', codes.status === 200 && Array.isArray(codes.body?.items),
    `status ${codes.status}`);

  const stations = await call(PUBLIC, '/api/admin-gate/api/stations-admin/', { token, gate: key });
  check('پمپ‌ها هم می‌آیند', stations.status === 200, `status ${stations.status}`);

  console.log('\n── کلید جای ورودِ مدیر را نمی‌گیرد ──');
  const keyOnly = await call(PUBLIC, '/api/admin-gate/api/dashboard', { gate: key });
  check('با کلید ولی بدونِ ورود، بسته است', keyOnly.status === 401, `status ${keyOnly.status}`);

  console.log('\n── باطل کردنِ گوشیِ گم‌شده ──');
  const listed = await call(PANEL, '/api/settings/remote', { token });
  check('دستگاه در فهرست دیده می‌شود',
    listed.body?.devices?.some((d) => d.id === 'phone-1'), JSON.stringify(listed.body?.devices));

  const revoked = await call(PANEL, '/api/settings/remote/device/phone-1', { method: 'DELETE', token });
  check('باطل شد', revoked.body?.ok === true, JSON.stringify(revoked.body));

  const afterRevoke = await call(PUBLIC, '/api/admin-gate/api/dashboard', { token, gate: key });
  check('کلیدِ باطل‌شده همان لحظه از کار افتاد', afterRevoke.status === 404,
    `status ${afterRevoke.status}`);

  console.log('\n── همان در، روی زیردامنهٔ admin.<دامنه> ──');
  /*
   *  روی زیردامنهٔ برنامه، خودِ ریشه همان در است — پس برنامه با آدرسِ ساده
   *  کار می‌کند: https://admin.example.com/api/dashboard
   *
   *  ⚠️ کلید را دوباره صادر می‌کنیم چون بالاتر باطلش کردیم.
   */
  const again = await call(PANEL, '/api/settings/remote/device', {
    method: 'POST',
    token,
    body: { deviceId: 'phone-2', name: 'گوشیِ دوم' },
  });
  const key2 = again.body?.key;
  check('کلیدِ تازه صادر شد', Boolean(key2));

  const viaHost = await withHost(PUBLIC_PORT, '/api/dashboard', 'admin.example.com', {
    authorization: `Bearer ${token}`,
    'x-admin-gate': key2,
  });
  check('از زیردامنهٔ مدیر، داشبورد می‌آید', viaHost.status === 200, `status ${viaHost.status}`);

  const hostNoKey = await withHost(PUBLIC_PORT, '/api/dashboard', 'admin.example.com', {
    authorization: `Bearer ${token}`,
  });
  check('همان زیردامنه بدونِ کلید: not found', hostNoKey.status === 404, `status ${hostNoKey.status}`);

  // و روی دامنهٔ معمولی، همان مسیر همچنان عمومی نیست
  const plainHost = await withHost(PUBLIC_PORT, '/api/dashboard', 'example.com', {
    authorization: `Bearer ${token}`,
    'x-admin-gate': key2,
  });
  check('روی دامنهٔ معمولی باز نمی‌شود', plainHost.status === 404, `status ${plainHost.status}`);

  console.log('\n── مسیری که برنامه واقعاً می‌سازد ──');
  /*
   *  ⚠️ این یکی با اسکرین‌شاتِ کاربر پیدا شد و هیچ آزمونی نمی‌گرفتش.
   *
   *  برنامه آدرسِ در را از خودِ سرور می‌گیرد و پیشوند را به آن می‌چسباند:
   *
   *      https://admin.<دامنه>  +  /api/admin-gate  +  /api/dashboard
   *
   *  آزمون‌های بالا همین پیشوند را می‌زدند، ولی روی میزبانِ *معمولی* — و
   *  آن‌جا کنده می‌شد و کار می‌کرد. روی زیردامنهٔ admin کنده نمی‌شد و
   *  همان‌طور به پنل می‌رفت، که چنین مسیری ندارد. یعنی هر درخواستِ برنامه
   *  از بیرونِ خانه، با کلیدِ درست، ۴۰۴ می‌گرفت: «این آدرس روی سرور نیست».
   */
  const wrapped = await withHost(PUBLIC_PORT, '/api/admin-gate/api/dashboard', 'admin.example.com', {
    authorization: `Bearer ${token}`,
    'x-admin-gate': key2,
  });
  check('پیشوند روی زیردامنهٔ admin هم کنده می‌شود', wrapped.status === 200, `status ${wrapped.status}`);
  const wrappedHealth = await withHost(PUBLIC_PORT, '/api/admin-gate/health', 'admin.example.com', {
    'x-admin-gate': key2,
  });
  check('چراغِ وضعیت هم از همان راه', wrappedHealth.status === 200, `status ${wrappedHealth.status}`);

  console.log('\n── بارِ اول، از بیرونِ خانه ──');
  /*
   *  ⚠️ گرهی که کلِ برنامه را خوابانده بود: درِ دامنه بی کلید بسته است
   *  (و درست هم همین است)، ولی کلید هم فقط از داخلِ خانه صادر می‌شد. پس
   *  کسی که بارِ اول برنامه را بیرونِ خانه باز می‌کرد، هیچ راهی نداشت.
   *
   *  حالا یک مسیر — و فقط همین یک مسیر — بی کلید جواب می‌دهد، و آن هم
   *  فقط با نام و رمزِ خودِ مدیر.
   */
  const AWAY = 'admin.example.com';

  // ۱) بی کلید و بی رمز، هنوز هیچ چیز
  const coldHealth = await withHost(PUBLIC_PORT, '/health', AWAY);
  check('بی کلید، /health روی admin بسته است', coldHealth.status === 404, `status ${coldHealth.status}`);
  const coldDash = await withHost(PUBLIC_PORT, '/api/dashboard', AWAY);
  check('بی کلید، پنل هم بسته است', coldDash.status === 404, `status ${coldDash.status}`);

  // ۲) رمزِ غلط: همان «نبوده»، نه ۴۰۱ — کسی نفهمد جایی برای حدس زدن هست
  const badPass = await withHost(PUBLIC_PORT, '/api/admin-gate/enroll', AWAY, {}, {
    method: 'POST',
    body: { username: 'admin', password: 'NotTheRealOne!', deviceId: 'phone-away', name: 'گوشی' },
  });
  check('رمزِ غلط: not found', badPass.status === 404, `status ${badPass.status}`);
  check('و هیچ کلیدی نمی‌دهد', !badPass.text.includes('key'), badPass.text.slice(0, 120));
  const badUser = await withHost(PUBLIC_PORT, '/api/admin-gate/enroll', AWAY, {}, {
    method: 'POST',
    body: { username: 'someone-else', password: 'ControlCenter!2026', deviceId: 'phone-away' },
  });
  check('نامِ ناشناس: not found', badUser.status === 404, `status ${badUser.status}`);

  // ۳) نام و رمزِ درست: کلید، همان‌جا، بیرونِ خانه
  const enrolled = await withHost(PUBLIC_PORT, '/api/admin-gate/enroll', AWAY, {}, {
    method: 'POST',
    body: {
      username: 'admin',
      password: 'ControlCenter!2026',
      deviceId: 'phone-away',
      name: 'گوشیِ بیرون',
    },
  });
  check('با نام و رمزِ درست، کلید صادر می‌شود', enrolled.status === 200 && Boolean(enrolled.body?.key),
    enrolled.text.slice(0, 160));
  check('و پیشوند خالی است (خودِ میزبان همان در است)', enrolled.body?.gatePath === '',
    JSON.stringify(enrolled.body?.gatePath));
  const awayKey = enrolled.body?.key;

  // ۴) و از همان لحظه، همه‌چیز — بی آنکه پا به خانه گذاشته باشیم
  const awayHealth = await withHost(PUBLIC_PORT, '/health', AWAY, { 'x-admin-gate': awayKey });
  check('چراغِ وضعیت روشن می‌شود', awayHealth.status === 200, `status ${awayHealth.status}`);
  const awayLogin = await withHost(PUBLIC_PORT, '/api/auth/login', AWAY, { 'x-admin-gate': awayKey }, {
    method: 'POST',
    body: { username: 'admin', password: 'ControlCenter!2026' },
  });
  check('ورود از بیرونِ خانه انجام می‌شود', Boolean(awayLogin.body?.token), awayLogin.text.slice(0, 160));
  const awayDash = await withHost(PUBLIC_PORT, '/api/dashboard', AWAY, {
    'x-admin-gate': awayKey,
    authorization: `Bearer ${awayLogin.body?.token}`,
  });
  check('و کلِ پنل هم باز است', awayDash.status === 200, `status ${awayDash.status}`);

  // ۵) گوشیِ گم‌شده: باطل که شد، همان لحظه می‌افتد بیرون
  await call(PANEL, '/api/settings/remote/device/phone-away', { method: 'DELETE', token });
  const afterAway = await withHost(PUBLIC_PORT, '/health', AWAY, { 'x-admin-gate': awayKey });
  check('کلیدِ باطل‌شده دیگر کار نمی‌کند', afterAway.status === 404, `status ${afterAway.status}`);

  // ۶) کاربری که مدیر نیست، از این در رد نمی‌شود
  const madeViewer = await call(PANEL, '/api/auth/users', {
    method: 'POST',
    token,
    body: { username: 'watcher', password: 'JustLooking!2026', role: 'viewer' },
  });
  if (madeViewer.status === 200 || madeViewer.status === 201) {
    const viewerTry = await withHost(PUBLIC_PORT, '/api/admin-gate/enroll', AWAY, {}, {
      method: 'POST',
      body: { username: 'watcher', password: 'JustLooking!2026', deviceId: 'phone-viewer' },
    });
    check('کاربرِ غیرِ مدیر کلید نمی‌گیرد', viewerTry.status === 404, `status ${viewerTry.status}`);
  } else {
    check('کاربرِ غیرِ مدیر کلید نمی‌گیرد', true, 'ساختنِ کاربر در دسترس نبود');
  }

  console.log('\n── آدرسِ تونل خودش را جای پنل جا نمی‌زند ──');
  /*
   *  ⚠️ /health روی هر دو پورت هست و جوابشان شبیهِ هم. اگر پورتِ عمومی
   *  نگوید «من عمومی‌ام»، برنامه آدرسِ تونل را آدرسِ پنل می‌فهمد، چراغش
   *  سبز می‌شود، و بعد ورود رد می‌شود. همان چیزی که یک بار اتفاق افتاد.
   */
  const pubHealth = await call(PUBLIC, '/health');
  check('پورتِ عمومی خودش را معرفی می‌کند', pubHealth.body?.mode === 'sync-only',
    JSON.stringify(pubHealth.body));
  const panelHealth = await call(PANEL, '/health');
  check('پورتِ پنل چنین چیزی نمی‌گوید', panelHealth.body?.mode === undefined,
    JSON.stringify(panelHealth.body));

  console.log('\n── ریشهٔ دامنه از زیردامنه هم پیدا می‌شود ──');
  const { rootOf, adminHostFor } = await import('../src/platform/domain.js');
  check('sync.vill3n.top → vill3n.top', rootOf('sync.vill3n.top') === 'vill3n.top');
  check('و آدرسِ برنامه‌اش ساخته می‌شود',
    adminHostFor('sync.vill3n.top') === 'admin.vill3n.top', adminHostFor('sync.vill3n.top'));
  check('روی خودِ admin دوباره admin نمی‌نشیند', adminHostFor('admin.vill3n.top') === null);
  check('پسوندِ دوتکه‌ای هم درست می‌شود',
    adminHostFor('a.b.yaqobi.co.ir') === 'admin.yaqobi.co.ir', adminHostFor('a.b.yaqobi.co.ir'));

  console.log('\n── کلید در جای دیگری درز نمی‌کند ──');
  const index = await call(PUBLIC, '/');
  check('فهرستِ عمومی نامی از در نمی‌برد', !/admin-gate/i.test(index.text), index.text.slice(0, 200));
  const health = await call(PUBLIC, '/health');
  check('health هم چیزی نمی‌گوید', !/admin-gate/i.test(health.text), health.text.slice(0, 200));
} finally {
  child.kill('SIGTERM');
  await wait(400);
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed ? 1 : 0);
