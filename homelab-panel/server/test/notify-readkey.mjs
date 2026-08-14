// ---------------------------------------------------------------------------
//  آزمونِ «رمزِ خواندن» — تا هر کس نامِ موضوع را دانست نتواند پیام‌ها را بخواند
//      node test/notify-readkey.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = Number(process.env.TEST_PORT || 4890);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-key-'));

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${n}`); }
  else { failed++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
         HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
         HLP_METRICS_INTERVAL: '3000', HLP_TUNNEL: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(method, url, body, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
/** وصل شدن به موضوع و برگرداندنِ اولین پیامِ سرور */
function wsFirst(topic, key) {
  return new Promise(resolve => {
    const q = '?topic=' + encodeURIComponent(topic) + (key ? '&key=' + encodeURIComponent(key) : '');
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/notify${q}`);
    const done = v => { try { ws.close(); } catch {} resolve(v); };
    ws.on('message', d => { try { done(JSON.parse(d)); } catch { done(null); } });
    ws.on('error', () => done({ op: 'socket-error' }));
    setTimeout(() => done({ op: 'timeout' }), 4000);
  });
}

// صبر تا بالا آمدن سرور
for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/api/notify/config'); if (r.ok) break; } catch {} await sleep(400); }

try {
  console.log('\n── پیش از گذاشتنِ رمز: همه‌چیز باز است ──');
  await req('POST', '/api/notify/mirza', { message: 'خبرِ محرمانه' });
  let m = await wsFirst('mirza');
  check('بدون رمز هم وصل می‌شود', m && m.op === 'ready');
  check('و پیام را می‌بیند', m && (m.messages || []).some(x => x.body === 'خبرِ محرمانه'));
  let cfg = (await req('GET', '/api/notify/config')).json;
  check('config می‌گوید رمز لازم نیست', cfg.readKeyRequired === false);

  console.log('\n── ورود مدیر و ساختنِ رمزِ خواندن ──');
  const setup = await req('POST', '/api/auth/setup', { username: 'admin', password: 'pw-12345678' });
  const login = setup.json?.token ? setup : await req('POST', '/api/auth/login', { username: 'admin', password: 'pw-12345678' });
  const token = login.json?.token;
  check('مدیر وارد شد', !!token, JSON.stringify(login.json).slice(0, 120));
  const gen = await req('POST', '/api/notify-admin/read-key', {}, token);
  const KEY = gen.json?.key;
  check('رمزِ خواندن ساخته شد', !!KEY);
  check('بدون حساب مدیر نمی‌شود رمز ساخت', (await req('POST', '/api/notify-admin/read-key', {})).status === 401);

  console.log('\n── بعد از رمز: در قفل است ──');
  cfg = (await req('GET', '/api/notify/config')).json;
  check('config می‌گوید رمز لازم است', cfg.readKeyRequired === true);
  check('کلیدِ VAPID هنوز عمومی است', !!cfg.vapidPublicKey);
  check('خودِ رمز در config لو نمی‌رود', !JSON.stringify(cfg).includes(KEY));

  m = await wsFirst('mirza');
  check('وب‌سوکت بدون رمز رد می‌شود', m && m.op === 'error' && m.msg === 'forbidden', JSON.stringify(m));
  m = await wsFirst('mirza', 'رمزِ-غلط');
  check('وب‌سوکت با رمزِ غلط رد می‌شود', m && m.op === 'error' && m.msg === 'forbidden', JSON.stringify(m));
  m = await wsFirst('mirza', KEY);
  check('با رمزِ درست وصل می‌شود', m && m.op === 'ready');
  check('و پیام‌ها را می‌بیند', m && (m.messages || []).some(x => x.body === 'خبرِ محرمانه'));

  check('خواندنِ تاریخچه بدون رمز بسته است', (await req('GET', '/api/notify/mirza/json')).status === 403);
  check('با رمز باز است', (await req('GET', '/api/notify/mirza/json?key=' + encodeURIComponent(KEY))).status === 200);

  console.log('\n── ثبتِ دستگاه هم «خواندن» است ──');
  const dev = { subscription: { endpoint: 'https://example.invalid/x', keys: { p256dh: 'a', auth: 'b' } }, label: 'تست' };
  check('ثبتِ دستگاه بدون رمز رد می‌شود', (await req('POST', '/api/notify/mirza/devices', dev)).status === 403);
  check('ثبتِ دستگاه با رمز قبول می‌شود', (await req('POST', '/api/notify/mirza/devices', { ...dev, key: KEY })).status === 200);

  console.log('\n── فرستادن همچنان باز است (مثل قبل) ──');
  check('هر برنامه‌ای می‌تواند خبر بدهد', (await req('POST', '/api/notify/staff', { message: 'سلام' })).status === 200);

  console.log('\n── برداشتنِ رمز: همه‌چیز به حالتِ قبل برمی‌گردد ──');
  await req('POST', '/api/notify-admin/read-key', { clear: true }, token);
  m = await wsFirst('mirza');
  check('دوباره بدون رمز وصل می‌شود', m && m.op === 'ready');
} catch (e) {
  failed++; console.log('  ❌ خطای غیرمنتظره:', e.message);
} finally {
  console.log('\n════════════════════════════════════');
  console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
  console.log('════════════════════════════════════');
  if (failed) console.log(out.slice(-1500));
  child.kill('SIGTERM');
  await sleep(400);
  await fsp.rm(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
