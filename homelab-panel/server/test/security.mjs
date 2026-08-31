// ---------------------------------------------------------------------------
//  آزمونِ امنیت — هر محافظ باید واقعاً جلوی حمله را بگیرد
//      node test/security.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import dgram from 'node:dgram';

const PORT = Number(process.env.TEST_PORT || 4786);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-sec-'));
const dataDir = path.join(tmp, 'data');
const sitesRoot = path.join(tmp, 'sites');
const outside = path.join(tmp, 'SECRET-OUTSIDE');

fs.mkdirSync(path.join(sitesRoot, 'shop'), { recursive: true });
fs.writeFileSync(path.join(sitesRoot, 'shop', 'index.html'), '<h1>shop</h1>');
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(outside, 'passwords.txt'), 'TOP-SECRET-DATA');

// یک لینک *داخلِ* پوشهٔ مجاز که به بیرون اشاره می‌کند — همان حقه‌ای که
// فیلترِ متنیِ «../» را دور می‌زند
let linkMade = false;
try {
  fs.symlinkSync(outside, path.join(sitesRoot, 'shop', 'escape'), 'junction');
  linkMade = true;
} catch {
  try {
    fs.symlinkSync(outside, path.join(sitesRoot, 'shop', 'escape'), 'dir');
    linkMade = true;
  } catch { /* اجازهٔ ساختِ لینک نبود */ }
}

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: sitesRoot, HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
    HLP_SITESYNC_PORT: String(PORT + 1),
    HLP_WS_PING_MS: '400',
    HLP_DISCOVERY_PORT: String(PORT + 2),
    HLP_WS_TICKET_TTL: '1500',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* هنوز */ }
    await wait(250);
  }
  return false;
}

try {
  if (!await up()) throw new Error(`سرور بالا نیامد:\n${out.slice(-1500)}`);

  // حسابِ مدیر تا بشود فایل‌منیجر را آزمود
  const setup = await (await fetch(`${BASE}/api/auth/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'mirza', password: 'a-very-long-password' }),
  })).json();
  const auth = { Authorization: `Bearer ${setup.token}`, 'Content-Type': 'application/json' };

  console.log('\n▶ فرار از پوشهٔ مجاز');
  const dotdot = await fetch(`${BASE}/api/files/list?path=${encodeURIComponent(path.join(sitesRoot, '..', 'SECRET-OUTSIDE'))}`, { headers: auth });
  check('«../» رد می‌شود', dotdot.status === 403, `status=${dotdot.status}`);

  const absolute = await fetch(`${BASE}/api/files/list?path=${encodeURIComponent(os.platform() === 'win32' ? 'C:\\Windows' : '/etc')}`, { headers: auth });
  check('مسیرِ مطلقِ بیرونی رد می‌شود', absolute.status === 403, `status=${absolute.status}`);

  if (linkMade) {
    const viaLink = path.join(sitesRoot, 'shop', 'escape');
    const listed = await fetch(`${BASE}/api/files/list?path=${encodeURIComponent(viaLink)}`, { headers: auth });
    check('لینک/junction به بیرون رد می‌شود', listed.status === 403, `status=${listed.status}`);

    const read = await fetch(`${BASE}/api/files/read?path=${encodeURIComponent(path.join(viaLink, 'passwords.txt'))}`, { headers: auth });
    check('خواندنِ فایلِ بیرونی از راهِ لینک رد می‌شود', read.status === 403, `status=${read.status}`);
  } else {
    console.log('  (ساختِ لینک ممکن نبود — این دو بررسی رد شد)');
  }

  const ok = await fetch(`${BASE}/api/files/list?path=${encodeURIComponent(path.join(sitesRoot, 'shop'))}`, { headers: auth });
  check('پوشهٔ مجاز همچنان باز است', ok.ok, `status=${ok.status}`);

  console.log('\n▶ نامِ فایل');
  const rename = await fetch(`${BASE}/api/files/rename`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ path: path.join(sitesRoot, 'shop', 'index.html'), newName: '../../evil.html' }),
  });
  check('نامِ حاویِ مسیر رد می‌شود', rename.status === 400, `status=${rename.status}`);

  console.log('\n▶ CORS');
  const evil = await fetch(`${BASE}/api/dashboard`, { headers: { ...auth, Origin: 'https://evil.example.com' } });
  check('سایتِ ناشناس هدرِ CORS نمی‌گیرد', evil.headers.get('access-control-allow-origin') === null,
    String(evil.headers.get('access-control-allow-origin')));

  const home = await fetch(`${BASE}/api/dashboard`, { headers: { ...auth, Origin: 'http://192.168.1.50:3000' } });
  check('شبکهٔ خانگی اجازه دارد', home.headers.get('access-control-allow-origin') === 'http://192.168.1.50:3000');

  const appApi = await fetch(`${BASE}/api/app/config`, { headers: { Origin: 'https://my-shop.example.com' } });
  check('API برنامه‌ها برای همه باز است', appApi.headers.get('access-control-allow-origin') === 'https://my-shop.example.com');
  check('ولی بدونِ credentials', appApi.headers.get('access-control-allow-credentials') === null);

  console.log('\n▶ محدودیتِ نرخ');
  let limited = 0;
  let lastBody = null;
  for (let i = 0; i < 14; i++) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mirza', password: 'wrong' }),
    });
    if (r.status === 429) { limited++; lastBody = await r.json().catch(() => ({})); }
  }
  check('حدس‌زدنِ رمز متوقف می‌شود', limited > 0, `${limited} بار ۴۲۹`);
  check('و می‌گوید چقدر صبر کند', lastBody && typeof lastBody.retryAfter === 'number');

  console.log('\n▶ رمزِ ثابت');
  const source = await fsp.readFile(path.join(import.meta.dirname, '..', 'src', 'sitesync', 'index.js'), 'utf8');
  check('رمزِ ثابتِ قدیمی از کد حذف شده', !source.includes('3f25db6ea9ff8ea4e8089a66cc7492f5f017'));

  const token = await fsp.readFile(path.join(dataDir, 'site-sync', 'token.txt'), 'utf8').catch(() => '');
  check('هر نصب رمزِ خودش را می‌سازد', token.trim().length >= 16, `${token.trim().length} نویسه`);

  console.log('\n▶ ضربانِ وب‌سوکت');
  const wsToken = (await fsp.readFile(path.join(dataDir, 'site-sync', 'token.txt'), 'utf8')).trim();
  const live = new WebSocket(`ws://127.0.0.1:${PORT}/?token=${encodeURIComponent(wsToken)}`);
  let pings = 0;
  live.on('ping', () => pings++);
  const opened = await new Promise((resolve) => {
    live.on('open', () => resolve(true));
    live.on('error', () => resolve(false));
    setTimeout(() => resolve(false), 4000);
  });
  check('اتصالِ وب‌سوکت برقرار می‌شود', opened);

  if (opened) {
    await wait(1400);
    check('سرور ضربان می‌فرستد', pings >= 2, `${pings} ping`);
    check('اتصالِ زنده بسته نمی‌شود', live.readyState === WebSocket.OPEN);

    // حالا وانمود می‌کنیم مُرده‌ایم: دیگر pong نمی‌دهیم
    live.pong = () => {};
    live._receiver.removeAllListeners('ping');
    await wait(1400);
    check('اتصالِ بی‌جواب بسته می‌شود', live.readyState !== WebSocket.OPEN, `state=${live.readyState}`);
  }
  try { live.terminate(); } catch { /* بسته */ }

  console.log('\n▶ نسخه‌بندیِ دیتابیس و دفترِ کارها');
  const health = await (await fetch(`${BASE}/health`)).json();
  check('نسخهٔ دیتابیس گزارش می‌شود', health.db && health.db.current === health.db.latest, JSON.stringify(health.db));

  const localKey = fs.readFileSync(path.join(dataDir, 'local-admin.key'), 'utf8').trim();
  const auditRes = await (await fetch(`${BASE}/api/app-admin/audit`, { headers: { 'X-Local-Key': localKey } })).json();
  const actions = (auditRes.entries || []).map((e) => e.action);
  check('ورودِ ناموفق ثبت شده', actions.includes('panel.login'), actions.join(', '));
  const failedLogin = (auditRes.entries || []).find((e) => e.action === 'panel.login' && e.ok === false);
  check('و «ناموفق» بودنش هم ثبت شده', Boolean(failedLogin));
  check('ساختِ حسابِ مدیر ثبت شده', actions.includes('panel.setup'));

  const backupsDir = path.join(dataDir, 'backups');
  check('پوشهٔ پشتیبانِ دیتابیس آماده است', !fs.existsSync(backupsDir) || fs.statSync(backupsDir).isDirectory());

  console.log('\n▶ پیدا شدنِ خودکارِ سرور');
  const card = await new Promise((resolve) => {
    const probe = dgram.createSocket('udp4');
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      try { probe.close(); } catch { /* بسته */ }
      resolve(value);
    };
    probe.on('message', (msg) => {
      try { finish(JSON.parse(String(msg))); } catch { finish(null); }
    });
    probe.on('error', () => finish(null));
    probe.bind(0, () => {
      probe.send(Buffer.from('PUMP-SERVER-DISCOVER?'), PORT + 2, '127.0.0.1');
    });
    setTimeout(() => finish(null), 3000);
  });
  check('سرور به پرسشِ شبکه جواب می‌دهد', card && card.reply === 'PUMP-SERVER-HERE', JSON.stringify(card).slice(0, 100));
  check('آدرس و پورتش را می‌گوید', card && card.port === PORT && typeof card.id === 'string');
  check('هیچ رمزی در پاسخ نیست', card && !JSON.stringify(card).toLowerCase().includes('token'));

  const silent = await new Promise((resolve) => {
    const probe = dgram.createSocket('udp4');
    let got = false;
    probe.on('message', () => { got = true; });
    probe.bind(0, () => probe.send(Buffer.from('HELLO-RANDOM'), PORT + 2, '127.0.0.1'));
    setTimeout(() => { try { probe.close(); } catch { /* بسته */ } resolve(got); }, 800);
  });
  check('به بستهٔ بی‌ربط جواب نمی‌دهد', silent === false);

  const httpCard = await (await fetch(`${BASE}/api/app/discover`)).json();
  check('از راهِ HTTP هم پیدا می‌شود', httpCard.ok === true && httpCard.port === PORT);

  console.log('\n▶ بلیتِ کوتاه‌عمرِ وب‌سوکت');
  const codeReq = await fetch(`${BASE}/api/app/auth/request-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '09121110000', app: 'main' }),
  });
  check('کد ساخته شد', codeReq.ok);
  const codeMatch = out.match(/کد ورود برای \+\d+\s+→\s+(\d{6})/);
  if (codeMatch) {
    const verify = await (await fetch(`${BASE}/api/app/auth/verify-code`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '09121110000', code: codeMatch[1], app: 'main' }),
    })).json();
    check('ورود انجام شد', verify.ok === true);

    const ticketRes = await (await fetch(`${BASE}/api/app/ws-ticket`, {
      method: 'POST', headers: { Authorization: `Bearer ${verify.token}` },
    })).json();
    check('بلیت صادر می‌شود', ticketRes.ok === true && typeof ticketRes.ticket === 'string');
    check('و عمرش کوتاه است', ticketRes.expiresIn <= 60);

    const noAuth = await fetch(`${BASE}/api/app/ws-ticket`, { method: 'POST' });
    check('بدونِ ورود بلیت نمی‌دهد', noAuth.status === 401);
  } else {
    console.log('  (کد در خروجی پیدا نشد — این بخش رد شد)');
  }

  console.log('\n▶ جداییِ توکن‌ها');
  const panelWithLocal = await fetch(`${BASE}/api/dashboard`, { headers: { 'X-Local-Key': 'wrong-key-here-1234567890' } });
  check('کلیدِ محلیِ غلط رد می‌شود', panelWithLocal.status === 401, `status=${panelWithLocal.status}`);
} catch (e) {
  failed++;
  console.log(`\n❌ ${e.message}`);
  console.log(out.slice(-1200));
} finally {
  child.kill('SIGTERM');
  await wait(400);
  child.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} تست درست، ${failed} تست خراب\n`);
process.exit(failed === 0 ? 0 : 1);
