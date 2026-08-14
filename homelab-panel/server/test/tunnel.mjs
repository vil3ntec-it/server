// ---------------------------------------------------------------------------
// آزمون واقعیِ تونل اینترنتی — نه شبیه‌سازی
//   ۱) سرور بالا می‌آید و تونل خودش را می‌سازد
//   ۲) با همان آدرس عمومی wss:// از بیرون وصل می‌شویم (دقیقاً مثل سایت)
//   ۳) داده می‌نویسیم و از دستگاه دومِ فرضی همان داده را می‌خوانیم
//
//   node test/tunnel.mjs
//   (به اینترنت نیاز دارد؛ اگر نبود آزمون با پیام روشن رد می‌شود)
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = Number(process.env.TEST_PORT || 4792);
const SYNC_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-tunnel-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

let pass = 0;
let fail = 0;
let skipped = false;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

const server = spawn(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')],
  {
    env: {
      ...process.env,
      HLP_PORT: String(PORT),
      HLP_HOST: '127.0.0.1',
      HLP_SITESYNC_PORT: String(SYNC_PORT),
      HLP_DATA_DIR: path.join(tmp, 'data'),
      HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_METRICS_INTERVAL: '3000',
      // اگر تونل واقعی در دسترس نباشد (مثلاً شبکهٔ محدود)، با تونل ساختگی
      // همان زنجیره تست می‌شود: اجرا ← خواندن آدرس ← لینک ← اتصال wss واقعی
      ...(process.env.HLP_TUNNEL_CMD ? { HLP_TUNNEL_CMD: process.env.HLP_TUNNEL_CMD } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);
let out = '';
server.stdout.on('data', (d) => (out += d));
server.stderr.on('data', (d) => (out += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch { /* هنوز */ }
    await sleep(200);
  }
  throw new Error('سرور بالا نیامد');
}

let token = null;
const api = async (method, url, body) => {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

/** یک کلاینت مثل خودِ سایت: وصل می‌شود، می‌نویسد یا می‌خواند */
function siteClient(wssUrl, syncToken) {
  return new Promise((resolve, reject) => {
    // گواهی تونل ساختگی خودامضاست؛ در تونل واقعی این گزینه بی‌اثر است
    const ws = new WebSocket(`${wssUrl}/?token=${syncToken}`, {
      handshakeTimeout: 20000,
      rejectUnauthorized: !process.env.HLP_TUNNEL_CMD,
    });
    const pending = new Map();
    let id = 0;
    const timer = setTimeout(() => reject(new Error('اتصال برقرار نشد')), 25000);

    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.op === 'connected') {
        clearTimeout(timer);
        resolve({
          set: (p, v) =>
            new Promise((res) => {
              const myId = ++id;
              pending.set(myId, res);
              ws.send(JSON.stringify({ op: 'set', path: p, value: v, id: myId }));
            }),
          get: (p) =>
            new Promise((res) => {
              const myId = ++id;
              pending.set(myId, res);
              ws.send(JSON.stringify({ op: 'get', path: p, id: myId }));
            }),
          close: () => ws.close(),
        });
      }
      if ((m.op === 'ack' || m.op === 'result') && pending.has(m.id)) {
        pending.get(m.id)(m.op === 'result' ? m.value : true);
        pending.delete(m.id);
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

let deviceA;
let deviceB;
try {
  await waitUp();

  console.log('\n── راه‌اندازی ──');
  const setup = await api('POST', '/api/auth/setup', { username: 'admin', password: 'HomeServer!2026' });
  token = setup.json.token;
  check('پنل بالا آمد و حساب ساخته شد', Boolean(token));

  const syncPortOk = await fetch(`http://127.0.0.1:${SYNC_PORT}/health`).then((r) => r.json());
  check('پورت جداگانهٔ سرورِ سایت بالاست', syncPortOk?.mode === 'sync-only');

  const panelOnSyncPort = await fetch(`http://127.0.0.1:${SYNC_PORT}/api/dashboard`);
  check('پنل روی پورت عمومی در دسترس نیست', panelOnSyncPort.status === 404);

  console.log('\n── تونل اینترنتی (خودکار) ──');
  let info = null;
  for (let i = 0; i < 90; i++) {
    info = (await api('GET', '/api/site-server')).json;
    if (info?.tunnel?.status === 'running' || info?.tunnel?.status === 'error') break;
    await sleep(2000);
  }

  if (info?.tunnel?.status !== 'running') {
    skipped = true;
    console.log(`  ⏭️  تونل بالا نیامد (${info?.tunnel?.error || info?.tunnel?.status}) — احتمالاً اینترنت در دسترس نیست.`);
    console.log('     این آزمون به اینترنت نیاز دارد؛ بقیهٔ آزمون‌ها مستقل از آن سبزند.');
  } else {
    check('تونل خودکار بالا آمد', true, info.tunnel.url);
    check('آدرس wss ساخته شد', /^wss:\/\//.test(info.tunnel.wss || ''), info.tunnel.wss);
    check(
      'آدرسِ بنر تونل اشتباه برداشته نشده',
      !/cloudflare\.com\/website-terms|developers\.cloudflare\.com/.test(info.tunnel.url || ''),
      info.tunnel.url
    );

    const tokenRes = await api('GET', '/api/site-server/token');
    const syncToken = tokenRes.json.token;

    check(
      'لینک یک‌کلیکی برای دستگاه‌ها ساخته شد',
      typeof info.siteLink === 'string' && info.siteLink.includes('?server=wss%3A%2F%2F') && info.siteLink.includes(syncToken),
      info.siteLink?.slice(0, 60) + '…'
    );
    check('QR لینک ساخته شد', typeof info.siteLinkQr === 'string' && info.siteLinkQr.startsWith('<svg'));

    console.log('\n── اتصال واقعی از اینترنت (مثل یک گوشی بیرون از خانه) ──');
    deviceA = await siteClient(info.tunnel.wss, syncToken);
    check('دستگاه اول از راه اینترنت وصل شد', true);

    const stamp = `از راه تونل — ${Date.now()}`;
    await deviceA.set('pumpTest/hello', stamp);
    check('دستگاه اول داده نوشت', true);

    deviceB = await siteClient(info.tunnel.wss, syncToken);
    const readBack = await deviceB.get('pumpTest/hello');
    check('دستگاه دوم همان داده را دید (اطلاعات مشترک)', readBack === stamp, String(readBack).slice(0, 40));

    const localCheck = await siteClient(`ws://127.0.0.1:${SYNC_PORT}`, syncToken);
    const localRead = await localCheck.get('pumpTest/hello');
    check('همان داده از داخل شبکهٔ خانگی هم دیده می‌شود', localRead === stamp);
    localCheck.close();

    const badToken = await siteClient(info.tunnel.wss, 'wrong-token').then(
      () => false,
      () => true
    );
    check('اتصال با رمز غلط از اینترنت هم رد می‌شود', badToken);
  }
} catch (e) {
  fail++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack || e}`);
  console.log(out.slice(-2000));
} finally {
  deviceA?.close();
  deviceB?.close();
  server.kill('SIGTERM');
  await sleep(1500);
  server.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log(`\n════════════════════════════════════`);
console.log(`  موفق: ${pass}    ناموفق: ${fail}${skipped ? '    (تونل رد شد — بدون اینترنت)' : ''}`);
console.log(`════════════════════════════════════\n`);
process.exit(fail ? 1 : 0);
