// ---------------------------------------------------------------------------
//  آزمونِ سرویسِ اعلان — همان کاری که ntfy می‌کند
//
//      node test/notify.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = Number(process.env.TEST_PORT || 4870);
const PUBLIC_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-ntf-'));

let passed = 0;
let failed = 0;
const check = (n, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${n}`); }
  else { failed++; console.log(`  ❌ ${n}${extra ? ' — ' + extra : ''}`); }
};

// سرویسِ پوشِ ساختگی — جای سرور نوتیفیکیشنِ مرورگر
const pushHits = [];
const pushServer = http.createServer((req, res) => {
  const c = [];
  req.on('data', (x) => c.push(x));
  req.on('end', () => { pushHits.push({ url: req.url, bytes: Buffer.concat(c).length }); res.writeHead(201).end(); });
});
await new Promise((r) => pushServer.listen(0, '127.0.0.1', r));
const pushPort = pushServer.address().port;

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PUBLIC_PORT), HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_METRICS_INTERVAL: '3000', HLP_TUNNEL: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, url, body, { token, type, base = BASE } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (type) headers['Content-Type'] = type;
  else if (body !== undefined && typeof body !== 'string') headers['Content-Type'] = 'application/json';
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* متن ساده */ }
  return { status: res.status, json, text };
}

async function waitForServer(ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* هنوز */ }
    await sleep(250);
  }
  return false;
}

function listen(topic) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/notify?topic=${encodeURIComponent(topic)}`);
    const inbox = [];
    const timer = setTimeout(() => reject(new Error('timeout')), 6000);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      inbox.push(m);
      if (m.op === 'ready') { clearTimeout(timer); resolve({ ws, inbox }); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

const waitMsg = async (inbox, match, ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const f = inbox.find((m) => m.op === 'message' && match(m));
    if (f) return f;
    await sleep(100);
  }
  return null;
};

async function main() {
  console.log('\n▶ راه‌اندازی سرور آزمایشی...');
  if (!(await waitForServer())) { console.log(out); throw new Error('سرور بالا نیامد'); }
  const admin = (await req('POST', '/api/auth/setup', { username: 'admin', password: 'HomeServer!2026' })).json?.token;

  console.log('\n── فرستادن با یک درخواست ساده (مثل curl) ──');
  let r = await req('POST', '/api/notify/pump', 'تیل مخزن ۲ کم شد', { type: 'text/plain' });
  check('متن ساده پذیرفته شد', r.json?.ok === true, r.text.slice(0, 120));
  check('و ذخیره شد', r.json?.message?.body === 'تیل مخزن ۲ کم شد', String(r.json?.message?.body));
  check('موضوع خودکار ساخته شد', r.json?.message?.topic === 'pump');

  r = await req('GET', '/api/notify/pump/json');
  check('در تاریخچه هست', r.json?.messages?.length === 1, String(r.json?.messages?.length));

  console.log('\n── عنوان، اولویت و برچسب ──');
  r = await fetch(`${BASE}/api/notify/pump`, {
    method: 'POST',
    // عنوانِ فارسی در هدر باید درصدی‌کد شود — هدرهای HTTP فارسی نمی‌پذیرند
    headers: {
      'Content-Type': 'text/plain',
      'X-Title': encodeURIComponent('هشدار'),
      'X-Priority': '5',
      'X-Tags': 'fuel,urgent',
    },
    body: 'مخزن خالی شد',
  }).then((x) => x.json());
  check('عنوان از هدر خوانده شد', r.message?.title === 'هشدار', String(r.message?.title));
  check('اولویت از هدر خوانده شد', r.message?.priority === 5, String(r.message?.priority));
  check('برچسب‌ها خوانده شدند', r.message?.tags?.join(',') === 'fuel,urgent', String(r.message?.tags));

  r = await req('POST', '/api/notify/pump', { title: 'گزارش', message: 'فروش امروز ثبت شد', tags: ['sale'] });
  check('حالت JSON هم کار می‌کند', r.json?.message?.title === 'گزارش' && r.json?.message?.body === 'فروش امروز ثبت شد');

  r = await req('POST', '/api/notify/pump', '', { type: 'text/plain' });
  check('پیام خالی رد می‌شود', r.status === 400);

  console.log('\n── رسیدنِ زنده به برنامه ──');
  const app = await listen('pump');
  check('برنامه به موضوع وصل شد', app.inbox[0]?.op === 'ready');
  check('و تاریخچه را همان اول گرفت', app.inbox[0]?.messages?.length === 3, String(app.inbox[0]?.messages?.length));

  await req('POST', '/api/notify/pump', 'یک خبر تازه', { type: 'text/plain' });
  const live = await waitMsg(app.inbox, (m) => m.body === 'یک خبر تازه');
  check('پیام تازه فوری رسید', Boolean(live), 'نرسید');

  console.log('\n── آمارِ آنلاین/عضو ──');
  r = await req('GET', '/api/notify/pump/stats');
  check('یک نفر همین الان آنلاین است', r.json?.online === 1, String(r.json?.online));
  check('هنوز هیچ عضوی ثبت نشده', r.json?.members === 0, String(r.json?.members));

  console.log('\n── وقتی برنامه بسته است ──');
  const key = crypto.createECDH('prime256v1');
  key.generateKeys();
  r = await req('POST', '/api/notify/pump/devices', {
    subscription: {
      endpoint: `http://127.0.0.1:${pushPort}/push/haroon`,
      keys: { p256dh: key.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') },
    },
    label: 'گوشی هارون',
  });
  check('دستگاه ثبت شد', r.json?.ok === true, r.text.slice(0, 100));

  const before = pushHits.length;
  await req('POST', '/api/notify/pump', 'این باید روی گوشیِ قفل هم بیاید', { type: 'text/plain' });
  await sleep(1200);
  check('نوتیفیکیشن فرستاده شد', pushHits.length > before, `${before} → ${pushHits.length}`);
  check('به همان دستگاه', pushHits.at(-1)?.url === '/push/haroon', String(pushHits.at(-1)?.url));

  console.log('\n── موضوع خصوصی با رمزِ نوشتن ──');
  r = await req('POST', '/api/notify-admin/private-alerts/token', {}, { token: admin });
  const writeToken = r.json?.token;
  check('رمزِ نوشتن ساخته شد', Boolean(writeToken));

  r = await req('POST', '/api/notify/private-alerts', 'بدون رمز', { type: 'text/plain' });
  check('بدون رمز پذیرفته نمی‌شود', r.status === 403, String(r.status));

  r = await req('POST', '/api/notify/private-alerts', 'با رمز', { type: 'text/plain', token: writeToken });
  check('با رمز پذیرفته می‌شود', r.json?.ok === true, r.text.slice(0, 100));

  console.log('\n── مدیریت از پنل ──');
  r = await req('GET', '/api/notify-admin', undefined, { token: admin });
  check('فهرست موضوع‌ها در پنل هست', r.json?.topics?.some((t) => t.name === 'pump'));
  check('و تعداد پیام‌ها را می‌شمارد', r.json?.topics?.find((t) => t.name === 'pump')?.messages >= 5);
  r = await req('GET', '/api/notify-admin');
  check('بدون حساب مدیر بسته است', r.status === 401);

  r = await req('POST', '/api/notify-admin/pump/send', { title: 'از پنل', message: 'سلام کارکنان' }, { token: admin });
  check('مدیر می‌تواند از پنل بفرستد', r.json?.ok === true, r.text.slice(0, 100));

  console.log('\n── از راه تونل (پورت عمومی) ──');
  r = await req('POST', '/api/notify/pump', 'از بیرونِ خانه', { type: 'text/plain', base: `http://127.0.0.1:${PUBLIC_PORT}` });
  check('اعلان از پورت عمومی هم می‌رسد', r.json?.ok === true, r.text.slice(0, 100));
  r = await req('GET', '/api/notify-admin', undefined, { token: admin, base: `http://127.0.0.1:${PUBLIC_PORT}` });
  check('ولی مدیریت روی پورت عمومی نیست', r.status === 404, String(r.status));

  app.ws.close();
  console.log('\n════════════════════════════════════');
  console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
  console.log('════════════════════════════════════\n');
}

try { await main(); }
catch (e) { failed++; console.error('\n❌ آزمون شکست:', e.message); console.error(out.slice(-1200)); }
finally {
  child.kill('SIGTERM'); pushServer.close();
  await sleep(400); await fsp.rm(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
