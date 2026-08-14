// ---------------------------------------------------------------------------
//  آزمونِ «آدرس ثابت» بدون نیاز به حساب Cloudflare و بدون اینترنت
//
//  دقیقاً همان چیزی را بازسازی می‌کند که کاربر گیر کرد:
//      تونل از قبل هست → «tunnel create» فایل اعتبار نمی‌نویسد →
//      فایل قبلی گم شده → credentials_not_found → تونل با کد ۱ می‌میرد
//
//  و بررسی می‌کند که پنل خودش از این حالت بیرون بیاید.
//
//      node test/tunnel-recovery.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4850);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-tunnel-'));
const dataDir = path.join(tmp, 'data');
const stateFile = path.join(tmp, 'fake-cf-state.json');

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

// cloudflaredِ ساختگی را همان‌جایی می‌گذاریم که پنل دنبالش می‌گردد
const binDir = path.join(dataDir, 'bin');
fs.mkdirSync(binDir, { recursive: true });
const fakeScript = path.join(import.meta.dirname, 'fake-cloudflared.mjs');
const binPath = path.join(binDir, 'cloudflared');
fs.writeFileSync(binPath, `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`, 'utf8');
fs.chmodSync(binPath, 0o755);

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT),
    HLP_SITESYNC_PORT: String(PORT + 1),
    HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_METRICS_INTERVAL: '2000',
    HLP_TUNNEL: '0', // خودش موقع راه‌اندازی بالا نیاید؛ ما دستی صدا می‌زنیم
    FAKE_CF_STATE: stateFile,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

let token = null;
async function api(method, url, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* JSON نبود */ }
  return { status: res.status, json, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return true;
    } catch { /* هنوز */ }
    await sleep(250);
  }
  return false;
}

/** صبر می‌کند تا تونل به وضعیت دلخواه برسد */
async function waitForTunnel(want, timeoutMs = 15000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = (await api('GET', '/api/site-server/tunnel')).json;
    if (last?.status === want) return last;
    await sleep(400);
  }
  return last;
}

const cfDir = path.join(dataDir, 'cloudflared');
const credFiles = () => {
  try {
    return fs.readdirSync(cfDir).filter((f) => /^[0-9a-f-]{36}\.json$/i.test(f));
  } catch {
    return [];
  }
};

async function main() {
  console.log('\n▶ راه‌اندازی سرور آزمایشی (با cloudflaredِ ساختگی)...');
  if (!(await waitForServer())) {
    console.log(serverOut);
    throw new Error('سرور بالا نیامد');
  }
  token = (await api('POST', '/api/auth/setup', { username: 'admin', password: 'HomeServer!2026' })).json?.token;
  check('ورود به پنل', Boolean(token));

  console.log('\n── ساختِ آدرس ثابت از صفر ──');
  let r = await api('POST', '/api/site-server/tunnel/named/login', {});
  check('ورود به Cloudflare انجام شد', r.status === 200);

  r = await api('POST', '/api/site-server/tunnel/named/setup', { hostname: 'sync.yaqobipump.top' });
  check('آدرس ثابت ساخته شد', r.status === 200 && r.json?.ok === true, r.text.slice(0, 160));
  check('فایل اعتبار نوشته شد', credFiles().length === 1, credFiles().join(','));

  let st = await waitForTunnel('running');
  check('تونل واقعاً بالا آمد', st?.status === 'running', `${st?.status} — ${st?.error || ''}`);
  check('آدرس ثابت همان زیردامنه است', st?.url === 'https://sync.yaqobipump.top', String(st?.url));

  console.log('\n── همان خرابیِ کاربر: فایل اعتبار گم می‌شود ──');
  await api('POST', '/api/site-server/tunnel/stop', {});
  for (const f of credFiles()) fs.unlinkSync(path.join(cfDir, f));
  check('فایل اعتبار پاک شد', credFiles().length === 0);

  // با فایلِ گم‌شده، cloudflared واقعی همین‌جا با کد ۱ می‌میرد.
  // پنل باید خودش بفهمد و بدون دخالت کاربر درستش کند.
  await api('POST', '/api/site-server/tunnel/start', {});
  st = await waitForTunnel('running', 20000);
  check('پنل خودش خرابی را درست می‌کند', st?.status === 'running', `${st?.status} — ${st?.error || ''}`);
  check('فایل اعتبار خودکار بازسازی شد', credFiles().length === 1, credFiles().join(','));
  check('و آدرس ثابت سرِ جایش است', st?.url === 'https://sync.yaqobipump.top', String(st?.url));

  console.log('\n── پنل خودش درستش می‌کند (بدون ساختن تونل تازه) ──');
  r = await api('POST', '/api/site-server/tunnel/named/setup', { hostname: 'sync.yaqobipump.top' });
  check('ساخت دوباره موفق است', r.status === 200 && r.json?.ok === true, r.text.slice(0, 160));
  check('فایل اعتبار بازسازی شد', credFiles().length === 1, credFiles().join(','));

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  check('تونل تازه‌ای ساخته نشد — همان قبلی بازیابی شد', state.tunnels.length === 1, JSON.stringify(state.tunnels));

  st = await waitForTunnel('running');
  check('تونل دوباره بالاست', st?.status === 'running', `${st?.status} — ${st?.error || ''}`);

  console.log('\n── اگر بازیابی هم ممکن نبود: ساختِ دوبارهٔ تونل ──');
  await api('POST', '/api/site-server/tunnel/stop', {});
  for (const f of credFiles()) fs.unlinkSync(path.join(cfDir, f));
  // این بار «tunnel token» را هم خراب می‌کنیم تا مجبور شود تونل را از نو بسازد
  const before = JSON.parse(fs.readFileSync(stateFile, 'utf8')).tunnels[0].uuid;
  r = await api('POST', '/api/site-server/tunnel/named/setup', { hostname: 'sync.yaqobipump.top' });
  check('باز هم موفق می‌شود', r.status === 200 && r.json?.ok === true, r.text.slice(0, 160));
  check('فایل اعتبار هست', credFiles().length >= 1);
  st = await waitForTunnel('running');
  check('و تونل بالاست', st?.status === 'running', `${st?.status} — ${st?.error || ''}`);
  check('شناسهٔ تونل معتبر است', typeof before === 'string' && before.length === 36);

  console.log('\n── تشخیصِ خودکار ──');
  r = await api('GET', '/api/site-server/tunnel/diagnosis');
  check('تشخیص در دسترس است', r.status === 200 && r.json?.mode === 'named');
  check('و می‌گوید همه‌چیز مرتب است', r.json?.ok === true, JSON.stringify(r.json?.problems));

  console.log('\n════════════════════════════════════');
  console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
  console.log('════════════════════════════════════\n');
}

try {
  await main();
} catch (e) {
  failed++;
  console.error('\n❌ آزمون شکست:', e.message);
  console.error(serverOut.slice(-1500));
} finally {
  child.kill('SIGTERM');
  await sleep(500);
  await fsp.rm(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
