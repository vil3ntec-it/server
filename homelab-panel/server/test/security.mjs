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
import { DatabaseSync } from 'node:sqlite';
import { io as ioClient } from 'socket.io-client';

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
    //  رمزِ ارشدِ سرورِ حساب از محیط — تا «پنهان در وضعیت، نمایشِ یک‌باره فقط مالک» سنجیده شود (۶-۴)
    HLP_ACCOUNT_ADMIN_USER: 'bridge-root',
    HLP_ACCOUNT_ADMIN_PASSWORD: 'Br1dge-Secret-Never-In-Status',
    HLP_ACCOUNT_AUTOSTART: '0',
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

  /* ═══════════════ فاز ۱ ِ ممیزیِ پنلِ مرکزی (۱۴۰۵/۰۸/۰۹) ═══════════════ */
  const j = (r) => r.json().catch(() => ({}));
  const get = (p, headers = {}) => fetch(`${BASE}${p}`, { headers });
  const post = (p, body, headers = auth) => fetch(`${BASE}${p}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  /** نشست را «کهنه» می‌کند — همان که ده دقیقه بی رمز بگذرد */
  const staleAll = () => {
    const d = new DatabaseSync(path.join(dataDir, 'panel.db'));
    try { d.exec('PRAGMA busy_timeout = 5000'); d.exec('UPDATE sessions SET auth_at = 0'); } finally { d.close(); }
  };

  console.log('\n▶ CSP ِ پنل (۶-۶)');
  const homeRes = await get('/');
  const csp = homeRes.headers.get('content-security-policy') || '';
  const scriptSrc = (/script-src ([^;]*)/.exec(csp) || [])[1] || '';
  check('صفحهٔ پنل سرآیندِ CSP دارد', csp.includes("default-src 'self'"), csp);
  check("⛔ script-src فقط 'self' — نه درون‌خطی، نه eval، نه بیرون", scriptSrc.trim() === "'self'", scriptSrc);
  check("object-src 'none' و frame-ancestors 'self'", csp.includes("object-src 'none'") && csp.includes("frame-ancestors 'self'"), csp);
  check('وب‌سوکتِ همان میزبان در connect-src', csp.includes(`ws://127.0.0.1:${PORT}`), csp);
  check('پاسخِ API هم همان CSP را دارد', ((await get('/api/auth/status')).headers.get('content-security-policy') || '') === csp);
  const indexHtml = await fsp.readFile(path.join(import.meta.dirname, '..', 'public', 'index.html'), 'utf8');
  check('⛔ باندلِ ساخته‌شده هیچ <script> ِ درون‌خطی ندارد (وگرنه CSP پنل را سفید می‌کرد)',
    [...indexHtml.matchAll(/<script\b([^>]*)>/g)].every((m) => /\bsrc=/.test(m[1])), indexHtml.slice(0, 300));
  const connect = await get('/connect');
  const connectCsp = connect.headers.get('content-security-policy') || '';
  const connectHtml = await connect.text();
  const inline = /<script>([\s\S]*?)<\/script>/.exec(connectHtml)?.[1] ?? '';
  const { createHash } = await import('node:crypto');
  check('صفحهٔ اتصال: اسکریپتِ درون‌خطی فقط با هشِ خودش، نه unsafe-inline',
    connectCsp.includes(`'sha256-${createHash('sha256').update(inline, 'utf8').digest('base64')}'`)
    && !/script-src[^;]*unsafe-inline/.test(connectCsp), connectCsp);

  console.log('\n▶ توکنِ نشست در نشانی پذیرفته نیست (۶-۶)');
  const tokenQs = `token=${encodeURIComponent(setup.token)}`;
  for (const p of ['/api/dashboard', '/api/live/stream', `/api/files/download?path=${encodeURIComponent(path.join(sitesRoot, 'shop', 'index.html'))}`]) {
    const r = await get(`${p}${p.includes('?') ? '&' : '?'}${tokenQs}`);
    check(`⛔ ${p.split('?')[0]} با ‎?token=‎ ⇒ ۴۰۱`, r.status === 401, String(r.status));
    await r.body?.cancel?.().catch(() => {});
  }
  check('همان توکن در سرآیند کار می‌کند', (await get('/api/dashboard', auth)).status === 200);
  const sockQuery = await new Promise((resolve) => {
    const so = ioClient(BASE, { query: { token: setup.token }, transports: ['websocket'], reconnection: false });
    so.on('connect', () => { so.close(); resolve('connected'); });
    so.on('connect_error', () => { so.close(); resolve('refused'); });
    setTimeout(() => { so.close(); resolve('timeout'); }, 4000);
  });
  check('⛔ Socket.IO با ‎?token=‎ ِ نشانی وصل نمی‌شود', sockQuery === 'refused', sockQuery);
  const sockAuth = await new Promise((resolve) => {
    const so = ioClient(BASE, { auth: { token: setup.token }, transports: ['websocket'], reconnection: false });
    so.on('connect', () => { so.close(); resolve('connected'); });
    so.on('connect_error', (e) => { so.close(); resolve(`refused ${e.message}`); });
    setTimeout(() => { so.close(); resolve('timeout'); }, 4000);
  });
  check('و با `auth` ِ دست‌دادن (رابطِ وب) وصل می‌شود', sockAuth === 'connected', sockAuth);

  console.log('\n▶ بلیتِ یک‌بارمصرفِ نشانی (۶-۶)');
  const filePath = `/api/files/download?path=${encodeURIComponent(path.join(sitesRoot, 'shop', 'index.html'))}`;
  let tk = await j(await post('/api/auth/ticket', { path: filePath }));
  check('بلیت صادر می‌شود و کوتاه‌عمر است', typeof tk.ticket === 'string' && tk.expiresIn <= 60, JSON.stringify(tk));
  let dl = await get(`${filePath}&ticket=${encodeURIComponent(tk.ticket)}`);
  check('دانلود با بلیت ۲۰۰ و همان فایل', dl.status === 200 && (await dl.text()).includes('<h1>shop</h1>'), String(dl.status));
  dl = await get(`${filePath}&ticket=${encodeURIComponent(tk.ticket)}`);
  check('⛔ بارِ دوم ۴۰۱ (یک‌بارمصرف)', dl.status === 401, String(dl.status));
  tk = await j(await post('/api/auth/ticket', { path: '/api/dashboard' }));
  dl = await get(`${filePath}&ticket=${encodeURIComponent(tk.ticket)}`);
  check('⛔ بلیتِ مسیرِ دیگر این‌جا ۴۰۱', dl.status === 401, String(dl.status));
  tk = await j(await post('/api/auth/ticket', { path: '/api/auth/logout' }));
  const viaPost = await fetch(`${BASE}/api/auth/logout?ticket=${encodeURIComponent(tk.ticket)}`, { method: 'POST' });
  check('⛔ بلیت برای نوشتن (POST) کار نمی‌کند', viaPost.status === 401, String(viaPost.status));
  tk = await j(await post('/api/auth/ticket', { path: '/api/dashboard' }));
  await wait(1700);
  check('⛔ بلیتِ منقضی ۴۰۱', (await get(`/api/dashboard?ticket=${encodeURIComponent(tk.ticket)}`)).status === 401);
  for (const bad of ['https://evil.example/api/x', '/etc/passwd', '']) {
    const r = await post('/api/auth/ticket', { path: bad });
    check(`مسیرِ نامعتبر «${bad || '∅'}» بلیت نمی‌گیرد`, r.status === 400, String(r.status));
  }
  check('بی نشست بلیت نمی‌دهد', (await post('/api/auth/ticket', { path: '/api/dashboard' }, { 'Content-Type': 'application/json' })).status === 401);

  console.log('\n▶ رمزِ ارشدِ سرورِ حساب: نه در وضعیت، فقط نمایشِ یک‌بارهٔ مالک (۶-۴، ۶-۵)');
  const SECRET = 'Br1dge-Secret-Never-In-Status';
  const ownerStatus = await get('/api/account-server/status', auth);
  const ownerStatusText = await ownerStatus.text();
  check('⛔ وضعیت برای خودِ مالک هم رمز را ندارد', ownerStatus.status === 200 && !ownerStatusText.includes(SECRET)
    && /"passwordSet":true/.test(ownerStatusText), ownerStatusText.slice(0, 200));
  const mk2 = await post('/api/auth/users', { username: 'admin2', password: 'Second-Admin-2026', role: 'admin' });
  const mkV = await post('/api/auth/users', { username: 'viewer9', password: 'Viewer-Only-2026', role: 'viewer' });
  check('مدیرِ دوم و بیننده ساخته شدند', mk2.status === 201 && mkV.status === 201, `${mk2.status} ${mkV.status}`);
  const a2 = await j(await post('/api/auth/login', { username: 'admin2', password: 'Second-Admin-2026' }, { 'Content-Type': 'application/json' }));
  const vw = await j(await post('/api/auth/login', { username: 'viewer9', password: 'Viewer-Only-2026' }, { 'Content-Type': 'application/json' }));
  const auth2 = { Authorization: `Bearer ${a2.token}`, 'Content-Type': 'application/json' };
  const authV = { Authorization: `Bearer ${vw.token}`, 'Content-Type': 'application/json' };
  const st2 = await (await get('/api/account-server/status', auth2)).text();
  check('⛔ مدیرِ دوم هم رمز را در وضعیت نمی‌بیند (تا ۱.۵۰.۶۱ می‌دید)', !st2.includes(SECRET), st2.slice(0, 160));
  const rev2 = await post('/api/account-server/admin-password/reveal', {}, auth2);
  check('⛔ مدیرِ دوم نمایشِ یک‌باره نمی‌گیرد (۴۰۳ owner_only)', rev2.status === 403 && (await j(rev2)).error === 'owner_only', String(rev2.status));
  const revV = await post('/api/account-server/admin-password/reveal', {}, authV);
  check('⛔ بیننده هم نه', revV.status === 403, String(revV.status));
  const revOk = await post('/api/account-server/admin-password/reveal', {}, auth);
  const revOkBody = await j(revOk);
  check('مالک با نشستِ تازه یک بار می‌بیند (no-store)', revOk.status === 200 && revOkBody.password === SECRET
    && /no-store/.test(revOk.headers.get('cache-control') || ''), `${revOk.status}`);
  staleAll();
  const revStale = await post('/api/account-server/admin-password/reveal', {}, auth);
  check('⛔ نشستِ کهنهٔ مالک ⇒ ۴۰۳ reauth_required', revStale.status === 403 && (await j(revStale)).error === 'reauth_required', String(revStale.status));
  const reWrong = await post('/api/auth/reauth', { password: 'not-my-password' });
  check('احرازِ دوباره با رمزِ غلط ۴۰۰ (نشست بیرون نمی‌افتد)', reWrong.status === 400 && (await get('/api/auth/me', auth)).status === 200, String(reWrong.status));
  const reOk = await post('/api/auth/reauth', { password: 'a-very-long-password' });
  check('احرازِ دوباره با رمزِ درست', reOk.status === 200 && (await j(reOk)).freshUntil > Date.now());
  check('و حالا نمایش دوباره کار می‌کند', (await post('/api/account-server/admin-password/reveal', {}, auth)).status === 200);
  const ua = await j(await get('/api/audit?source=panel&q=admin_password&limit=50', auth));
  const revRows = (ua.rows || []).filter((r) => r.action === 'account.admin_password.reveal');
  check('هر نمایش و هر تلاشِ ردشده در دفتر (۲ موفق + ۱ ردِ مدیرِ دوم)',
    revRows.filter((r) => r.result === 'ok').length === 2 && revRows.filter((r) => r.result === 'forbidden').length === 1,
    JSON.stringify(revRows.map((r) => `${r.actor}:${r.result}`)));
  check('⛔ و دفترِ یکپارچه خودش فقط admin است', (await get('/api/audit', authV)).status === 403);
  check('⛔ و فقط‌خواندنی (DELETE ⇒ ۴۰۵)', (await fetch(`${BASE}/api/audit`, { method: 'DELETE', headers: auth })).status === 405);

  console.log('\n▶ جزئیاتِ دفترِ کارهای حساس «[object Object]» نیست (۶-۷)');
  await post('/api/auth/logout-all', {});
  const sensitive = await j(await get('/api/audit?source=panel&q=panel.logout_all', auth));
  const la = (sensitive.rows || []).find((r) => r.action === 'panel.logout_all');
  check('جزئیاتِ شیء JSON نوشته می‌شود', la && la.detail && !la.detail.includes('[object Object]')
    && Number.isInteger(JSON.parse(la.detail).revoked), JSON.stringify(la));
  const dbRaw = new DatabaseSync(path.join(dataDir, 'panel.db'));
  const objRows = dbRaw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE detail = '[object Object]'").get().n;
  dbRaw.close();
  check('⛔ هیچ ردیفی در audit_log «[object Object]» ندارد', objRows === 0, String(objRows));

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
    body: JSON.stringify({ email: 'ws@example.com', app: 'main' }),
  });
  check('کد ساخته شد', codeReq.ok, `status ${codeReq.status}`);

  /*
   *  ⚠️ کد دیگر در خروجیِ سرور چاپ نمی‌شود.
   *
   *  جایش «پنل ← کدهای شش‌رقمی» است و همان‌جا هم فقط پشتِ ورودِ مدیر دیده
   *  می‌شود. آزمون هم از همان راه می‌خواندش — همان راهی که خودِ صاحبِ سرور
   *  می‌رود.
   */
  const liveList = await (await fetch(`${BASE}/api/codes-admin/live`, { headers: auth })).json();
  const codeMatch = [null, liveList.items?.find((i) => i.email === 'ws@example.com')?.code];
  check('کد از راهِ پنل خوانده می‌شود', /^\d{6}$/.test(String(codeMatch[1])), String(codeMatch[1]));

  if (codeMatch[1]) {
    const verify = await (await fetch(`${BASE}/api/app/auth/verify-code`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ws@example.com', code: codeMatch[1], app: 'main' }),
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
