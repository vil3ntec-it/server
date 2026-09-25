// ---------------------------------------------------------------------------
//  آزمون: خبرِ پمپ به گوشیِ **بسته** می‌رسد — پوشِ خودِ سرورِ خانگی
//
//  زنجیرهٔ واقعی، بی هیچ میان‌بُری:
//    ۱) برنامهٔ کامپیوتر ثبت می‌شود و از وب‌سوکت ‎live‎ را می‌نویسد
//    ۲) «گوشی» با رمزِ **خواندن** یک اشتراکِ پوش ثبت می‌کند (کلیدهای واقعیِ
//       P-256 و رمزِ auth، همان که مرورگر می‌سازد)
//    ۳) خبرِ تازه ⇒ سرور به «سرویسِ پوش» (یک سرورِ کوچکِ محلی) می‌فرستد و
//       همین آزمون بسته را با کلیدِ خصوصیِ گوشی **باز می‌کند** (RFC 8291)
//
//      node test/station-push.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { freshAlerts, messageOf } from '../src/stations/alert-push.js';

const PORT = Number(process.env.TEST_PORT || 4891);
const PUBLIC = `http://127.0.0.1:${PORT + 1}`;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-stpush-'));
const dataDir = path.join(tmp, 'data');

let passed = 0;
let failed = 0;
const check = (n, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${n}`); }
  else { failed++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── ۰) قاعدهٔ خالص ──────────────────────────────────────────────────────────
console.log('\n۰) قاعدهٔ «تازه» — بی سرور');
{
  const A = [{ k: 'd1-out', t: 'کریم اضافه برد', s: 'out' }, { k: 'd2-low', t: 'حسن کم مانده', s: 'low' }];
  const base = freshAlerts(A, null);
  check('بارِ اول خطِ پایه است، نه سیلِ خبرِ کهنه', base.fresh.length === 0 && base.told.length === 2);
  const same = freshAlerts(A, base.told);
  check('همان حال دوباره خبر نمی‌دهد', same.fresh.length === 0);
  const next = freshAlerts([...A, { k: 'd3-out', t: 'ولی اضافه برد', s: 'out' }], base.told);
  check('فقط تازه خبر می‌دهد', next.fresh.length === 1 && next.fresh[0].k === 'd3-out');
  const gone = freshAlerts([A[1]], next.told);
  check('کلیدِ افتاده فراموش می‌شود', !gone.told.includes('d1-out'));
  const back = freshAlerts(A, gone.told);
  check('حسابی که دوباره خراب شد دوباره خبر می‌دهد', back.fresh.length === 1 && back.fresh[0].k === 'd1-out');
  const one = messageOf([{ k: 'x', t: 'کریم اضافه برد', s: 'out' }]);
  check('یک خبر ⇒ «⛔ اضافه نده» با همان متن', one.title === '⛔ اضافه نده' && one.body === 'کریم اضافه برد');
  const many = messageOf([{ k: 'a', t: 'الف', s: 'low' }, { k: 'b', t: 'ب', s: 'out' }]);
  check('چند خبر ⇒ یک پیام با شمار، نه چند زنگ', /۲|2/.test(many.title) && many.body.includes('الف') && many.body.includes('ب'));
}

// ── سرویسِ پوشِ ساختگی ─────────────────────────────────────────────────────
const pushHits = [];
const pushServer = http.createServer((req, res) => {
  const c = [];
  req.on('data', (x) => c.push(x));
  req.on('end', () => { pushHits.push({ url: req.url, body: Buffer.concat(c), headers: req.headers }); res.writeHead(201).end(); });
});
await new Promise((r) => pushServer.listen(0, '127.0.0.1', r));
const pushPort = pushServer.address().port;

// کلیدهای «گوشی» — همان چیزی که PushManager.subscribe می‌سازد
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const authSecret = crypto.randomBytes(16);
const b64u = (b) => Buffer.from(b).toString('base64url');
const subscription = {
  endpoint: `http://127.0.0.1:${pushPort}/push/iphone-1`,
  keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(authSecret) },
};

/** بازکردنِ بستهٔ aes128gcm با کلیدِ خصوصیِ گوشی (RFC 8291) */
function openPush(buf) {
  const salt = buf.subarray(0, 16);
  const idlen = buf.readUInt8(20);
  const serverPub = buf.subarray(21, 21 + idlen);
  const ct = buf.subarray(21 + idlen);
  const shared = ecdh.computeSecret(serverPub);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let end = plain.length - 1;
  while (end > 0 && plain[end] === 0) end--;
  return JSON.parse(plain.subarray(0, end).toString('utf8'));
}

function startServer() {
  const c = spawn(process.execPath, ['--disable-warning=ExperimentalWarning',
    path.join(import.meta.dirname, '..', 'src', 'index.js')], {
    env: {
      ...process.env,
      HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0', HLP_METRICS_INTERVAL: '5000', HLP_PUSH_TEST_HOSTS: '127.0.0.1',
      HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: '0', HLP_AUTOMATION: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { out += d; });
  return c;
}
let out = '';
let child = startServer();
async function waitUp() {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* هنوز */ } await sleep(250); }
  return false;
}

async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : BASE + url, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* غیرِ JSON */ }
  return { status: res.status, json };
}

function connect(code, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/station?station=${code}&token=${encodeURIComponent(token)}`);
    const inbox = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.op === 'connected' || m.op === 'error') return resolve({ ws, hello: m, inbox });
      inbox.push(m);
    });
    ws.on('error', reject);
  });
}

async function waitFor(fn, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return true; await sleep(100); }
  return false;
}

try {
  if (!(await waitUp())) throw new Error('سرور بالا نیامد\n' + out.slice(-2000));

  console.log('\n۱) پمپ ثبت می‌شود و گوشی برای خبر ثبت‌نام می‌کند');
  const en = await api('POST', '/api/stations/enroll', { code: 'yaqobi', name: 'پمپ یعقوبی' });
  check('پمپ ثبت شد', en.json?.ok === true && en.json.readKey);
  const { token, readKey } = en.json;

  const cfg = await api('GET', `${PUBLIC}/api/stations/yaqobi/push?token=${readKey}`);
  check('کلیدِ عمومیِ VAPID از پورتِ عمومی (همان درِ تونل) می‌آید', cfg.status === 200 && (cfg.json?.vapidPublicKey || '').length > 60);

  const bad = await api('POST', `${PUBLIC}/api/stations/yaqobi/push?token=wrong`, { subscription });
  check('⛔ بی رمزِ همان پمپ هیچ گوشی‌ای ثبت نمی‌شود', bad.status === 404);
  const foreign = await api('POST', `${PUBLIC}/api/stations/yaqobi/push?token=${readKey}`,
    { subscription: { ...subscription, endpoint: 'https://evil.example.com/steal' } });
  check('⛔ نشانیِ پوشِ ناشناس رد می‌شود', foreign.status === 400);

  const reg = await api('POST', `${PUBLIC}/api/stations/yaqobi/push?token=${readKey}`, { subscription, label: 'آیفونِ کارمند' });
  check('گوشی با رمزِ خواندن ثبت شد', reg.json?.ok === true && reg.json.devices === 1, JSON.stringify(reg.json));

  console.log('\n۲) ⛔ موضوعِ پوش از درِ همگانی بسته است');
  const topic = 'stn-alerts-yaqobi';
  const pubRead = await api('GET', `${PUBLIC}/api/notify/${topic}/json`);
  check('خواندنِ پیام‌ها از /api/notify رد شد', pubRead.status === 403);
  const pubDev = await api('POST', `${PUBLIC}/api/notify/${topic}/devices`, subscription);
  check('ثبتِ گوشی از /api/notify رد شد', pubDev.status === 403);
  const pubWrite = await api('POST', `${PUBLIC}/api/notify/${topic}`, { message: 'جعلی' });
  check('پیامِ جعلی روی موضوع رد شد', pubWrite.status === 403);

  console.log('\n۳) برنامهٔ کامپیوتر خبر می‌نویسد ⇒ گوشیِ بسته پوش می‌گیرد');
  const app = await connect('yaqobi', token);
  check('برنامهٔ کامپیوتر وصل شد', app.hello.op === 'connected');
  const live = (alerts, seq) => ({ op: 'set', id: seq, path: 'live',
    value: { seq, at: Date.now(), station: { name: 'پمپ یعقوبی' }, alerts } });

  // خطِ پایه — خبرِ کهنه‌ای که پیش از ثبتِ گوشی بوده
  app.ws.send(JSON.stringify(live([{ k: 'd1-out', t: 'کریم — ۲۰ لیتر اضافه برد', s: 'out' }], 1)));
  await sleep(1500);
  check('خطِ پایه: خبرِ کهنه دوباره زنگ نمی‌زند', pushHits.length === 0, String(pushHits.length));
  check('کلیدهای گفته‌شده روی دیسکِ همان پمپ نشستند',
    fs.existsSync(path.join(dataDir, 'stations', 'yaqobi', 'alerts-told.json')));

  app.ws.send(JSON.stringify(live([
    { k: 'd1-out', t: 'کریم — ۲۰ لیتر اضافه برد', s: 'out' },
    { k: 'd7-low', t: 'حسن — فقط ۱۵ لیتر مانده', s: 'low' },
  ], 2)));
  check('خبرِ تازه به سرویسِ پوشِ گوشی رفت', await waitFor(() => pushHits.length === 1), String(pushHits.length));
  const hit = pushHits[0];
  check('به همان گوشی', hit?.url === '/push/iphone-1');
  check('با امضای VAPID (بی هیچ کلیدِ بیرونی)', /^vapid t=/.test(String(hit?.headers?.authorization || '')));
  let payload = null;
  try { payload = openPush(hit.body); } catch (e) { payload = { error: e.message }; }
  check('بسته با کلیدِ خصوصیِ گوشی باز شد و متن همان است',
    payload?.title === '⚠️ کم مانده' && payload?.body === 'حسن — فقط ۱۵ لیتر مانده', JSON.stringify(payload));
  check('⛔ خبرِ کهنه همراهش دوباره نیامد', !String(payload?.body || '').includes('کریم'));

  app.ws.send(JSON.stringify(live([
    { k: 'd1-out', t: 'کریم — ۲۰ لیتر اضافه برد', s: 'out' },
    { k: 'd7-low', t: 'حسن — فقط ۱۵ لیتر مانده', s: 'low' },
  ], 3)));
  await sleep(1500);
  check('همان حال (عکسِ بی‌تغییر) دوباره زنگ نمی‌زند', pushHits.length === 1, String(pushHits.length));

  // «کم مانده» ⇒ «تمام شد»: کلید حال را هم دارد
  app.ws.send(JSON.stringify(live([
    { k: 'd1-out', t: 'کریم — ۲۰ لیتر اضافه برد', s: 'out' },
    { k: 'd7-out', t: 'حسن — ۵ لیتر اضافه برد', s: 'out' },
  ], 4)));
  check('«کم مانده ⇒ اضافه برد» خبرِ تازه است', await waitFor(() => pushHits.length === 2));
  const p2 = openPush(pushHits[1].body);
  check('و فوری است', p2.title === '⛔ اضافه نده' && p2.body.includes('حسن'), JSON.stringify(p2));

  console.log('\n۴) سرور واقعاً دوباره بالا می‌آید ⇒ خبرِ کهنه تکرار نمی‌شود');
  app.ws.close();
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
  child = startServer();
  check('سرور دوباره بالا آمد', await waitUp());
  const app2 = await connect('yaqobi', token);
  app2.ws.send(JSON.stringify(live([
    { k: 'd1-out', t: 'کریم — ۲۰ لیتر اضافه برد', s: 'out' },
    { k: 'd7-out', t: 'حسن — ۵ لیتر اضافه برد', s: 'out' },
  ], 5)));
  await sleep(1800);
  check('همان خبرها پس از بالا آمدنِ دوباره زنگ نزدند', pushHits.length === 2, String(pushHits.length));
  app2.ws.send(JSON.stringify(live([{ k: 'd9-low', t: 'ولی — ۸ لیتر مانده', s: 'low' }], 6)));
  check('و خبرِ تازه پس از بالا آمدن هنوز می‌رسد (گوشی ثبت مانده)', await waitFor(() => pushHits.length === 3));
  app2.ws.close();

  console.log('\n۵) گوشی خودش را برمی‌دارد');
  const un = await fetch(`${PUBLIC}/api/stations/yaqobi/push?token=${readKey}&endpoint=${encodeURIComponent(subscription.endpoint)}`,
    { method: 'DELETE' }).then((r) => r.json());
  check('برداشته شد', un.ok === true);
  const after = await api('GET', `${PUBLIC}/api/stations/yaqobi/push?token=${readKey}`);
  check('دیگر گوشی‌ای نیست', after.json?.devices === 0);
} catch (e) {
  failed++;
  console.log('  ❌ خطا:', e.message);
} finally {
  child.kill('SIGTERM');
  pushServer.close();
  await sleep(300);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
