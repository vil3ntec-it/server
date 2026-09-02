// ---------------------------------------------------------------------------
//  آزمونِ مدیریتِ دامنه‌ها
//      node test/domains-tunnel.mjs
//
//  دو چیزی که این‌جا سنجیده می‌شود، همان دو مشکلی است که گزارش شد:
//
//    ۱) عوض کردنِ آدرسِ اصلی نباید کلِ تونل را بازنشانی کند. مسیرِ تازه باید
//       وجود داشته باشد و ورودیِ نامعتبر را رد کند.
//    ۲) هر دامنه باید همان جزئیاتی را بدهد که تا امروز فقط دامنهٔ اصلی
//       داشت — پورت، منبع، وضعیتِ DNS، و آدرسِ https.
//
//  تونلِ واقعی بالا نمی‌آید (نه حسابِ Cloudflare هست نه اینترنت)، پس آن‌چه
//  سنجیده می‌شود قرارداد و مرزهاست، نه خودِ cloudflared.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4793);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dom-test-'));
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

async function main() {
  console.log('\n▶ راه‌اندازی سرورِ آزمایشی...');
  if (!(await waitForServer())) {
    console.log(serverOut.slice(-4000));
    throw new Error('سرور بالا نیامد');
  }

  let r = await api('GET', '/api/site-server/domains', undefined, { noAuth: true });
  check('بدونِ توکن ۴۰۱ می‌دهد', r.status === 401, r.text);

  r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'DomainPanel!2026' });
  check('ساختِ حسابِ مدیر', r.status === 200 && Boolean(r.json?.token), r.text);
  token = r.json?.token;

  console.log('\n── نمای دامنه‌ها ──');
  r = await api('GET', '/api/site-server/domains');
  check('فهرستِ دامنه‌ها می‌آید', r.status === 200 && Array.isArray(r.json?.items), r.text);
  check('حالتِ تونل گزارش می‌شود', typeof r.json?.mode === 'string', r.text);
  check('نامِ تونل گزارش می‌شود', typeof r.json?.tunnelName === 'string', r.text);

  // هر ردیف باید همان چیزهایی را داشته باشد که کارتِ دامنهٔ اصلی نشان می‌دهد
  const rows = r.json?.items ?? [];
  const shaped = rows.every(
    (row) =>
      typeof row.hostname === 'string' &&
      typeof row.port === 'number' &&
      typeof row.url === 'string' &&
      row.url.startsWith('https://') &&
      typeof row.dnsRouted === 'boolean' &&
      typeof row.protected === 'boolean' &&
      typeof row.servedByTunnel === 'boolean' &&
      ['main', 'site', 'api', 'manual'].includes(row.source)
  );
  check('هر دامنه جزئیاتِ کامل دارد', rows.length === 0 || shaped, JSON.stringify(rows.slice(0, 2)));

  console.log('\n── عوض کردنِ آدرسِ اصلی ──');
  // مسیر باید وجود داشته باشد — نبودنش همان باگی بود که گزارش شد
  r = await api('POST', '/api/site-server/tunnel/named/main', { hostname: 'vill3n.top' });
  check('مسیرِ عوض کردنِ آدرسِ اصلی وجود دارد (۴۰۴ نیست)', r.status !== 404, `${r.status} ${r.text}`);
  check(
    'بدونِ تونلِ نام‌دار، دلیلِ روشن می‌دهد',
    r.status === 400 && r.json?.error === 'not_named_mode',
    `${r.status} ${r.text}`
  );

  r = await api('POST', '/api/site-server/tunnel/named/main', { hostname: 'بدون-نقطه' });
  check('نامِ نامعتبر رد می‌شود', r.status === 400 && r.json?.error === 'invalid_hostname', r.text);

  r = await api('POST', '/api/site-server/tunnel/named/main', { hostname: '' });
  check('نامِ خالی رد می‌شود', r.status === 400 && r.json?.error === 'invalid_hostname', r.text);

  r = await api('POST', '/api/site-server/tunnel/named/main', { hostname: 'a b.com' });
  check('نامِ دارای فاصله رد می‌شود', r.status === 400 && r.json?.error === 'invalid_hostname', r.text);

  console.log('\n── مرزِ نقش‌ها ──');
  r = await api('POST', '/api/auth/users', { username: 'oper', password: 'NoDomain!2026', role: 'operator' });
  const made = r.status === 200 || r.status === 201;
  check('ساختِ کاربرِ operator', made, r.text);

  if (made) {
    r = await api('POST', '/api/auth/login', { username: 'oper', password: 'NoDomain!2026' }, { noAuth: true });
    const opToken = r.json?.token;

    r = await api('GET', '/api/site-server/domains', undefined, { token: opToken });
    check('operator دامنه‌ها را می‌بیند', r.status === 200, r.text);

    r = await api('POST', '/api/site-server/tunnel/named/main', { hostname: 'vill3n.top' }, { token: opToken });
    check('operator آدرسِ اصلی را عوض نمی‌کند (۴۰۳)', r.status === 403, `${r.status} ${r.text}`);
  }

  console.log('\n── بازنشانی هنوز جای خودش هست ──');
  r = await api('POST', '/api/site-server/tunnel/named/reset');
  check('مسیرِ بازنشانی دست‌نخورده مانده', r.status !== 404, `${r.status}`);
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
