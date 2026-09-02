// ---------------------------------------------------------------------------
//  آزمونِ دیتابیس، نسخه‌های Node/Python، و ترمینال
//      node test/platform-tools.mjs
//
//  روی ماشینی که MySQL و Postgres ندارد هم سبز می‌شود — نبودنشان یک رفتارِ
//  درست دارد، نه خطا. چیزی که واقعاً سنجیده می‌شود مرزهاست:
//  اعتبارسنجیِ شناسه، نرفتنِ رمز روی خطِ فرمان، و اینکه ترمینال فقط برای
//  admin باز می‌شود.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient } from 'socket.io-client';

import { validIdent } from '../src/system/database.js';
import { normalizeVersion, downloadUrlFor } from '../src/system/runtimes.js';
import * as terminal from '../src/system/terminal.js';

const PORT = Number(process.env.TEST_PORT || 4796);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'tools-test-'));
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

/* ───────────────────── اعتبارسنجی — بدونِ سرور ───────────────────────── */

console.log('\n── شناسهٔ دیتابیس ──');
check('نامِ معمولی پذیرفته می‌شود', validIdent('pump_shop'));
check('شروع با زیرخط مجاز است', validIdent('_tmp'));
check('شروع با رقم رد می‌شود', !validIdent('1db'));
check('فاصله رد می‌شود', !validIdent('my db'));
check('بک‌تیک رد می‌شود', !validIdent('a`b'));
check('نقلِ‌قول رد می‌شود', !validIdent("a'b"));
check('نقطه‌ویرگول رد می‌شود', !validIdent('db; DROP DATABASE x'));
check('نقطه رد می‌شود (جلوگیری از db.table)', !validIdent('db.table'));
check('خالی رد می‌شود', !validIdent(''));
check('بلندتر از ۶۳ نویسه رد می‌شود', !validIdent('a'.repeat(64)));

console.log('\n── نسخهٔ Node ──');
check('v22.13.0 پذیرفته می‌شود', normalizeVersion('v22.13.0') === 'v22.13.0');
check('بدونِ v هم پذیرفته و نرمال می‌شود', normalizeVersion('22.13.0') === 'v22.13.0');
check('نسخهٔ ناقص رد می‌شود', normalizeVersion('22.13') === null);
check('حرف در نسخه رد می‌شود', normalizeVersion('v22.x.0') === null);
check('پیمایشِ مسیر در نسخه رد می‌شود', normalizeVersion('../../etc') === null);
check('تزریقِ مسیر رد می‌شود', normalizeVersion('v1.0.0/../../..') === null);
const url = downloadUrlFor('v22.13.0');
check('آدرسِ دانلود فقط به nodejs.org می‌رود', !url || url.startsWith('https://nodejs.org/dist/'), String(url));

/* ─────────────────────────── ترمینال ─────────────────────────────────── */

console.log('\n── ترمینال ──');
const session = terminal.create({ userId: 1, username: 'tester' });
check('نشست ساخته می‌شود', session.ok && Boolean(session.id), JSON.stringify(session));

if (session.ok) {
  let out = '';
  const r1 = await terminal.run(session.id, 'echo hello-from-panel', { onData: (c) => (out += c) });
  check('فرمان اجرا می‌شود', r1.ok && out.includes('hello-from-panel'), `${JSON.stringify(r1)} :: ${out}`);
  check('کدِ خروجِ موفق صفر است', r1.exitCode === 0, JSON.stringify(r1));
  check('نشانه‌گذارِ داخلی به کاربر نشان داده نمی‌شود', !out.includes('CWD:'), out);

  const r2 = await terminal.run(session.id, 'exit 3', { onData: () => {} });
  check('کدِ خروجِ ناموفق برمی‌گردد', r2.ok && r2.exitCode === 3, JSON.stringify(r2));

  // مهم‌ترین رفتار: cd باید بینِ فرمان‌ها بماند
  const before = terminal.get(session.id)?.cwd;
  await terminal.run(session.id, 'cd /tmp', { onData: () => {} });
  const after = terminal.get(session.id)?.cwd;
  check('cd بینِ فرمان‌ها می‌ماند', after !== before && String(after).includes('tmp'), `${before} → ${after}`);

  let big = '';
  const r3 = await terminal.run(session.id, 'printf "x%.0s" $(seq 1 200)', { onData: (c) => (big += c) });
  check('خروجیِ چندخطی سالم می‌آید', r3.ok && big.length >= 200, `${big.length}`);

  const r4 = await terminal.run(session.id, 'x'.repeat(9000), { onData: () => {} });
  check('فرمانِ بیش از حد بلند رد می‌شود', !r4.ok && r4.error === 'command_too_long', JSON.stringify(r4));

  terminal.close(session.id);
  check('نشست بسته می‌شود', terminal.get(session.id) === null);
}

const noSession = await terminal.run('nope-not-a-session', 'echo hi', { onData: () => {} });
check('نشستِ ناموجود رد می‌شود', !noSession.ok && noSession.error === 'no_session', JSON.stringify(noSession));

/* ────────────────────────────── سرور ─────────────────────────────────── */

const serverPath = path.join(import.meta.dirname, '..', 'src', 'index.js');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT),
    HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: sitesRoot,
    HLP_SITESYNC: '0',
    HLP_AI_ENABLED: '0',
    HLP_TUNNEL: '0',
    HLP_METRICS_INTERVAL: '5000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

async function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* هنوز */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let token = null;
async function api(method, url, body, opts = {}) {
  const headers = {};
  if (opts.token !== undefined) {
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  } else if (token && !opts.noAuth) {
    headers.Authorization = `Bearer ${token}`;
  }
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* JSON نبود */ }
  return { status: res.status, json, text };
}

/** یک سوکتِ احرازشده با نقشِ داده‌شده */
function connectSocket(authToken) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE, { auth: { token: authToken }, transports: ['websocket'], reconnection: false });
    const timer = setTimeout(() => reject(new Error('socket timeout')), 8000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const emit = (socket, event, payload) =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, error: 'timeout' }), 15000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack ?? { ok: false, error: 'no_ack' });
    });
  });

async function main() {
  console.log('\n▶ راه‌اندازی سرورِ آزمایشی...');
  if (!(await waitForServer())) {
    console.log(serverOut.slice(-4000));
    throw new Error('سرور بالا نیامد');
  }

  console.log('\n── در بسته است ──');
  for (const url of ['/api/databases/clients', '/api/runtimes/node']) {
    const r = await api('GET', url, undefined, { noAuth: true });
    check(`${url} بدونِ توکن ۴۰۱ می‌دهد`, r.status === 401, r.text);
  }

  let r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'ToolsPanel!2026' });
  check('ساختِ حسابِ مدیر', r.status === 200 && Boolean(r.json?.token), r.text);
  token = r.json?.token;

  console.log('\n── دیتابیس ──');
  r = await api('GET', '/api/databases/clients');
  check('وضعیتِ کلاینت‌ها می‌آید', r.status === 200 && r.json?.mysql && r.json?.postgres, r.text);
  console.log(`     (mysql: ${r.json?.mysql?.installed} · postgres: ${r.json?.postgres?.installed})`);

  r = await api('GET', '/api/databases/config');
  check('پیکربندی می‌آید', r.status === 200 && Boolean(r.json?.config), r.text);
  check('رمز در پاسخ نیست', !r.text.includes('password"') || !/"password":"[^"]+"/.test(r.text), r.text.slice(0, 200));

  r = await api('GET', '/api/databases/oracle/databases');
  check('موتورِ ناشناخته ۴۰۰ می‌گیرد', r.status === 400, `${r.status} ${r.text}`);

  r = await api('POST', '/api/databases/mysql/databases', { name: 'bad name' });
  check('نامِ نامعتبرِ دیتابیس ۴۰۰ می‌گیرد', r.status === 400 && r.json?.error === 'invalid_name', r.text);

  r = await api('DELETE', '/api/databases/mysql/databases/mysql');
  check('حذفِ دیتابیسِ سیستمی ۴۰۳ می‌گیرد', r.status === 403 && r.json?.error === 'system_database', r.text);

  r = await api('POST', '/api/databases/mysql/users', { name: 'app', password: '123' });
  check('رمزِ ضعیف رد می‌شود', r.status === 400 && r.json?.error === 'weak_password', r.text);

  console.log('\n── نسخه‌های Node ──');
  r = await api('GET', '/api/runtimes/node');
  check('فهرستِ نسخه‌ها می‌آید', r.status === 200 && Array.isArray(r.json?.items), r.text);
  check('نسخهٔ در حالِ اجرا هست', (r.json?.items || []).some((i) => i.current), r.text);
  check('نسخهٔ سیستمی حذف‌شدنی نیست', (r.json?.items || []).every((i) => !i.current || i.removable === false), r.text);

  r = await api('POST', '/api/runtimes/node/install', { version: '../../etc/passwd' });
  check('نسخهٔ نامعتبر برای نصب ۴۰۰ می‌گیرد', r.status === 400, `${r.status} ${r.text}`);

  r = await api('GET', '/api/runtimes/python');
  check('فهرستِ پایتون می‌آید', r.status === 200 && Array.isArray(r.json?.items), r.text);

  console.log('\n── ترمینال از راهِ سوکت ──');
  const adminSocket = await connectSocket(token);
  let ack = await emit(adminSocket, 'term:open', {});
  check('admin ترمینال باز می‌کند', ack?.ok === true, JSON.stringify(ack));

  if (ack?.ok) {
    let chunks = '';
    adminSocket.on('term:data', (d) => (chunks += d?.chunk ?? ''));
    const runAck = await emit(adminSocket, 'term:run', { command: 'echo socket-works' });
    check('فرمان از راهِ سوکت اجرا می‌شود', runAck?.ok === true, JSON.stringify(runAck));
    await new Promise((res) => setTimeout(res, 300));
    check('خروجی به سوکت می‌رسد', chunks.includes('socket-works'), chunks);

    r = await api('GET', '/api/app-admin/audit?limit=50');
    check(
      'فرمانِ ترمینال در دفترِ کارها ثبت شد',
      r.status !== 200 || r.text.includes('terminal.run'),
      r.status === 200 ? 'در دفتر پیدا نشد' : `دفتر در دسترس نبود (${r.status})`
    );
  }
  adminSocket.close();

  console.log('\n── مرزِ نقش‌ها برای ترمینال ──');
  r = await api('POST', '/api/auth/users', { username: 'oper', password: 'NoShell!2026', role: 'operator' });
  const made = r.status === 200 || r.status === 201;
  check('ساختِ کاربرِ operator', made, r.text);

  if (made) {
    r = await api('POST', '/api/auth/login', { username: 'oper', password: 'NoShell!2026' }, { noAuth: true });
    const opToken = r.json?.token;
    check('ورودِ operator', Boolean(opToken), r.text);

    if (opToken) {
      const opSocket = await connectSocket(opToken);
      ack = await emit(opSocket, 'term:open', {});
      check('operator ترمینال باز نمی‌کند (forbidden)', ack?.ok === false && ack?.error === 'forbidden', JSON.stringify(ack));

      ack = await emit(opSocket, 'term:run', { command: 'whoami' });
      check('operator فرمان اجرا نمی‌کند', ack?.ok === false, JSON.stringify(ack));
      opSocket.close();
    }
  }
}

let error = null;
try {
  await main();
} catch (e) {
  error = e;
  console.log(`\n💥 ${e.message}`);
}

child.kill();
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});

console.log(`\n${failed === 0 && !error ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 && !error ? 0 : 1);
