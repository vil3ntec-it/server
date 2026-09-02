// ---------------------------------------------------------------------------
//  آزمونِ Process Manager
//      node test/processes.mjs
//
//  مهم‌ترین چیزی که این‌جا سنجیده می‌شود، محافظ‌هاست — نه اینکه فهرست می‌آید
//  یا نه. اگر روزی کسی isProtectedPid را بردارد، این آزمون قرمز می‌شود، نه
//  سروری که وسطِ کار خودش را کشته است.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validPid, isProtectedPid, kill, list } from '../src/system/processes.js';

const PORT = Number(process.env.TEST_PORT || 4798);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'proc-test-'));
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

/* ─────────────────────── محافظ‌ها — بدونِ سرور ───────────────────────── */

console.log('\n── اعتبارسنجیِ PID ──');
check('PID عادی پذیرفته می‌شود', validPid(4321));
check('صفر رد می‌شود', !validPid(0));
check('منفی رد می‌شود — در kill(2) یعنی کلِ گروه', !validPid(-1));
check('اعشاری رد می‌شود', !validPid(12.5));
check('رشته رد می‌شود', !validPid('abc'));
check('خالی رد می‌شود', !validPid(''));

console.log('\n── پروسه‌های محافظت‌شده ──');
check('PID ۱ محافظت‌شده است', isProtectedPid(1));
check('خودِ پنل محافظت‌شده است', isProtectedPid(process.pid));
check('والدِ پنل محافظت‌شده است', isProtectedPid(process.ppid));
check('یک PID عادی محافظت‌شده نیست', !isProtectedPid(999999));

console.log('\n── کشتن ──');
let r = kill(1, 'TERM');
check('کشتنِ init رد می‌شود', !r.ok && r.error === 'protected_pid', JSON.stringify(r));
r = kill(process.pid, 'KILL');
check('پنل نمی‌تواند خودش را بکشد', !r.ok && r.error === 'protected_pid', JSON.stringify(r));
r = kill(4321, 'HUP');
check('سیگنالِ خارج از فهرست رد می‌شود', !r.ok && r.error === 'invalid_signal', JSON.stringify(r));
r = kill(-1, 'TERM');
check('PID منفی رد می‌شود', !r.ok && r.error === 'invalid_pid', JSON.stringify(r));
r = kill(999999, 'TERM');
check('PIDِ ناموجود «پیدا نشد» می‌دهد', !r.ok && ['not_found', 'forbidden_by_os'].includes(r.error), JSON.stringify(r));

/* --- کشتنِ واقعیِ یک پروسهٔ آزمایشیِ خودمان --- */
console.log('\n── کشتنِ واقعی ──');
const victim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 400));
const killed = kill(victim.pid, 'TERM');
check('یک پروسهٔ واقعی کشته می‌شود', killed.ok, JSON.stringify(killed));
const exited = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 4000);
  victim.on('exit', () => {
    clearTimeout(timer);
    resolve(true);
  });
});
check('پروسه واقعاً تمام شد', exited);

console.log('\n── فهرست ──');
const listed = await list({ limit: 50 });
check('فهرست می‌آید', listed.ok, JSON.stringify(listed).slice(0, 200));
if (listed.ok) {
  check('حداقل یک پروسه هست', listed.items.length > 0);
  check('هر ردیف PID عددی دارد', listed.items.every((p) => Number.isInteger(p.pid) && p.pid > 0));
  check('سقفِ تعداد رعایت می‌شود', listed.items.length <= 50);
  const self = (await list({ query: String(process.pid), limit: 20 })).items.find((p) => p.pid === process.pid);
  check('خودِ آزمون در فهرست هست و علامتِ محافظت دارد', Boolean(self?.protectedPid), JSON.stringify(self ?? null));
}

/* ────────────────────────── مرزِ دسترسی ─────────────────────────────── */

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
  try {
    json = JSON.parse(text);
  } catch { /* JSON نبود */ }
  return { status: res.status, json, text };
}

async function main() {
  console.log('\n▶ راه‌اندازی سرورِ آزمایشی...');
  if (!(await waitForServer())) {
    console.log(serverOut.slice(-4000));
    throw new Error('سرور بالا نیامد');
  }

  console.log('\n── در بسته است ──');
  let res = await api('GET', '/api/processes', undefined, { noAuth: true });
  check('فهرست بدونِ توکن ۴۰۱ می‌دهد', res.status === 401, res.text);

  res = await api('POST', '/api/auth/setup', { username: 'admin', password: 'ProcPanel!2026' });
  check('ساختِ حسابِ مدیر', res.status === 200 && Boolean(res.json?.token), res.text);
  token = res.json?.token;

  console.log('\n── فهرست از راهِ API ──');
  res = await api('GET', '/api/processes?limit=25');
  check('فهرست می‌آید', res.status === 200 && Array.isArray(res.json?.items), res.text);
  check('شمارِ کل هم برمی‌گردد', typeof res.json?.total === 'number', res.text);

  res = await api('GET', '/api/processes?q=node&limit=10');
  check('جست‌وجو کار می‌کند', res.status === 200 && Array.isArray(res.json?.items), res.text);

  res = await api('GET', '/api/processes/summary');
  check('خلاصه می‌آید', res.status === 200 && res.json?.ok === true, res.text);

  console.log('\n── مرزِ کشتن از راهِ API ──');
  res = await api('POST', '/api/processes/1/kill', { signal: 'TERM' });
  check('کشتنِ init از API هم رد می‌شود (۴۰۹)', res.status === 409, `${res.status} ${res.text}`);

  res = await api('POST', '/api/processes/abc/kill', { signal: 'TERM' });
  check('PID غیرعددی ۴۰۰ می‌گیرد', res.status === 400, `${res.status} ${res.text}`);

  res = await api('POST', '/api/processes/4321/kill', { signal: 'HUP' });
  check('سیگنالِ غیرمجاز ۴۰۰ می‌گیرد', res.status === 400, `${res.status} ${res.text}`);

  console.log('\n── مرزِ نقش‌ها ──');
  res = await api('POST', '/api/auth/users', { username: 'looker', password: 'ReadOnly!2026', role: 'operator' });
  const made = res.status === 200 || res.status === 201;
  check('ساختِ کاربرِ operator', made, res.text);

  if (made) {
    res = await api('POST', '/api/auth/login', { username: 'looker', password: 'ReadOnly!2026' }, { noAuth: true });
    const opToken = res.json?.token;
    check('ورودِ operator', Boolean(opToken), res.text);

    if (opToken) {
      res = await api('GET', '/api/processes?limit=5', undefined, { token: opToken });
      check('operator فهرست را می‌بیند', res.status === 200, res.text);

      res = await api('POST', '/api/processes/4321/kill', { signal: 'TERM' }, { token: opToken });
      check('operator نمی‌تواند سیگنال بفرستد (۴۰۳)', res.status === 403, `${res.status} ${res.text}`);
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
try { victim.kill('SIGKILL'); } catch { /* رفته */ }
await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});

console.log(`\n${failed === 0 && !error ? '✅' : '❌'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed === 0 && !error ? 0 : 1);
