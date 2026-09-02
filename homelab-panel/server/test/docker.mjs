// ---------------------------------------------------------------------------
//  آزمونِ سرتاسریِ مدیریتِ Docker
//      node test/docker.mjs
//
//  یک سرورِ واقعی بالا می‌آید. آزمون روی ماشینی که داکر ندارد هم باید سبز
//  شود — چون همان حالت هم یک رفتارِ درست دارد: «نصب نیست»، نه خطای ۵۰۰.
//
//  چیزی که این‌جا واقعاً سنجیده می‌شود، مرزِ دسترسی است. اگر روزی کسی
//  requireAuth یا requireWriteRole را از مسیرها بردارد، همین آزمون قرمز
//  می‌شود — نه کاربری که ماه‌ها بعد می‌فهمد کانتینرهایش را یک viewer پاک
//  کرده است.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { validId, validImage } from '../src/system/docker.js';

const PORT = Number(process.env.TEST_PORT || 4797);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'docker-test-'));
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

/* ───────────────── اعتبارسنجیِ شناسه — بدونِ سرور هم سنجیدنی است ────────── */

console.log('\n── اعتبارسنجیِ شناسه ──');
check('شناسهٔ معمولی پذیرفته می‌شود', validId('a3f19c2b4d5e'));
check('نامِ کانتینر با خط تیره و نقطه', validId('deploy-panel-1.0'));
check('فاصله رد می‌شود', !validId('my container'));
check('نقطه‌ویرگول رد می‌شود', !validId('x; rm -rf /'));
check('آرگومانِ جعلی رد می‌شود', !validId('--force'));
check('رشتهٔ خالی رد می‌شود', !validId(''));
check('خطِ جدید رد می‌شود', !validId('abc\nrm'));
check('ایمیجِ با تگ پذیرفته می‌شود', validImage('caddy:2-alpine'));
check('ایمیجِ با مخزن پذیرفته می‌شود', validImage('ghcr.io/org/app:1.2.3'));
check('ایمیجِ با فاصله رد می‌شود', !validImage('caddy 2'));

/* ────────────────────────────── سرورِ پنل ───────────────────────────────── */

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
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let token = null;
async function api(method, url, body, opts = {}) {
  const headers = { ...(opts.headers || {}) };
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
  for (const url of ['/api/docker/status', '/api/docker/containers', '/api/docker/images']) {
    const r = await api('GET', url, undefined, { noAuth: true });
    check(`${url} بدونِ توکن ۴۰۱ می‌دهد`, r.status === 401, r.text);
  }

  let r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'DockerPanel!2026' });
  check('ساختِ حسابِ مدیر', r.status === 200 && Boolean(r.json?.token), r.text);
  token = r.json?.token;

  console.log('\n── وضعیتِ داکر ──');
  r = await api('GET', '/api/docker/status');
  check('وضعیت جواب می‌دهد', r.status === 200, r.text);
  const installed = r.json?.installed === true;
  const running = r.json?.running === true;
  check(
    'وضعیت هر دو کلیدِ installed و running را دارد',
    typeof r.json?.installed === 'boolean' && typeof r.json?.running === 'boolean',
    r.text
  );
  console.log(`     (داکر: نصب=${installed} در دسترس=${running})`);

  // نبودنِ داکر یک خطا نیست — داشبورد نباید به‌خاطرش قرمز شود
  r = await api('GET', '/api/docker/summary');
  check('خلاصه همیشه ۲۰۰ می‌دهد، حتی بدونِ داکر', r.status === 200 && r.json?.ok === true, r.text);
  check('خلاصه شمارِ عددی دارد', typeof r.json?.containers === 'number', r.text);

  console.log('\n── فهرست‌ها ──');
  for (const [name, url] of [
    ['کانتینرها', '/api/docker/containers'],
    ['ایمیج‌ها', '/api/docker/images'],
    ['حجم‌ها', '/api/docker/volumes'],
    ['شبکه‌ها', '/api/docker/networks'],
  ]) {
    r = await api('GET', url);
    if (running) {
      check(`${name}: آرایه برمی‌گردد`, r.status === 200 && Array.isArray(r.json?.items), r.text);
    } else {
      // بدونِ داکر باید ۵۰۳ بدهد، نه ۵۰۰ — یعنی «سرویس نیست»، نه «خراب شدم»
      check(`${name}: بدونِ داکر ۵۰۳ می‌دهد`, r.status === 503, `${r.status} ${r.text}`);
    }
  }

  console.log('\n── ورودیِ نامعتبر ──');
  r = await api('GET', '/api/docker/containers/not%20valid');
  check('شناسهٔ دارای فاصله ۴۰۰ می‌گیرد', r.status === 400 && r.json?.error === 'invalid_id', r.text);

  r = await api('POST', '/api/docker/containers/abc123/destroy');
  check('کارِ ناشناخته ۴۰۰ می‌گیرد', r.status === 400 && r.json?.error === 'unknown_action', r.text);

  console.log('\n── مرزِ نقش‌ها ──');
  // یک کاربرِ viewer می‌سازیم و می‌بینیم واقعاً نمی‌تواند دست بزند
  r = await api('POST', '/api/auth/users', { username: 'watcher', password: 'JustLooking!2026', role: 'viewer' });
  const madeViewer = r.status === 200 || r.status === 201;
  check('ساختِ کاربرِ viewer', madeViewer, r.text);

  if (madeViewer) {
    r = await api('POST', '/api/auth/login', { username: 'watcher', password: 'JustLooking!2026' }, { noAuth: true });
    const viewerToken = r.json?.token;
    check('ورودِ viewer', Boolean(viewerToken), r.text);

    if (viewerToken) {
      r = await api('GET', '/api/docker/summary', undefined, { token: viewerToken });
      check('viewer می‌تواند ببیند', r.status === 200, r.text);

      r = await api('POST', '/api/docker/containers/abc123/stop', undefined, { token: viewerToken });
      check('viewer نمی‌تواند stop کند (۴۰۳)', r.status === 403, `${r.status} ${r.text}`);

      r = await api('DELETE', '/api/docker/containers/abc123', undefined, { token: viewerToken });
      check('viewer نمی‌تواند حذف کند (۴۰۳)', r.status === 403, `${r.status} ${r.text}`);
    }
  }

  console.log('\n── دفترِ کارها ──');
  // یک کارِ ناموفق هم باید ثبت شود
  await api('POST', '/api/docker/containers/nosuchcontainer/stop');
  r = await api('GET', '/api/app-admin/audit?limit=50');
  const auditText = r.text || '';
  check(
    'کارِ داکر در دفترِ کارها ثبت شد',
    r.status !== 200 || auditText.includes('docker.container.stop'),
    r.status === 200 ? 'در دفتر پیدا نشد' : `دفتر در دسترس نبود (${r.status})`
  );
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
