// ---------------------------------------------------------------------------
//  آزمونِ سرتاسریِ مرکز فرمان — سرورِ واقعی بالا می‌آید و همه‌چیز سنجیده می‌شود
//      node test/control.mjs
//
//  چیزی «شبیه‌سازی» نمی‌شود: یک سرورِ HTTP و یک سرورِ WebSocket واقعی بالا
//  می‌آید تا بررسی‌های سلامت واقعاً چیزی برای سنجیدن داشته باشند.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.TEST_PORT || 4794);
const ORIGIN_PORT = PORT + 1;
const WS_PORT = PORT + 2;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-test-'));
const dataDir = path.join(tmp, 'data');
const storageRoot = path.join(tmp, 'Projects');
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

/* ───────── یک مبدأِ واقعی تا آزمونِ اتصال چیزی برای سنجیدن داشته باشد ───── */

const origin = http.createServer((req, res) => {
  if (req.url === '/secret') {
    res.writeHead(401).end('nope');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, path: req.url }));
});
await new Promise((r) => origin.listen(ORIGIN_PORT, '127.0.0.1', r));

const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });
wss.on('connection', (socket) => socket.close());

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
    HLP_METRICS_INTERVAL: '2000',
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
  if (token && !opts.noAuth) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    if (opts.raw) payload = body;
    else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
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

  console.log('\n── ورود ──');
  let r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' });
  check('ساختِ حسابِ مدیر', r.status === 200 && Boolean(r.json?.token), r.text);
  token = r.json?.token;

  r = await api('GET', '/api/control/overview', undefined, { noAuth: true });
  check('مرکز فرمان بدون توکن بسته است (۴۰۱)', r.status === 401);

  console.log('\n── انبار ──');
  r = await api('POST', '/api/control/storage/root', { path: storageRoot });
  check('انتخابِ محلِ انبار', r.status === 200 && r.json?.root === storageRoot, r.text);
  check('پوشهٔ انبار واقعاً ساخته شد', fs.existsSync(storageRoot));

  r = await api('POST', '/api/control/storage/root', { path: '/' });
  check('ریشهٔ دیسک به‌عنوان انبار رد می‌شود', r.status === 400, r.text);

  console.log('\n── سرورها ──');
  r = await api('GET', '/api/control/servers');
  check('سرورِ خانگی خودکار ثبت شده', r.status === 200 && r.json.servers.some((s) => s.is_local === 1), r.text);
  const localServer = r.json.servers.find((s) => s.is_local === 1);

  r = await api('POST', '/api/control/servers', { name: 'VPS آزمایشی', kind: 'vps', ip: '127.0.0.1', ssh_port: ORIGIN_PORT });
  check('افزودنِ VPS', r.status === 201 && Boolean(r.json?.server?.server_id), r.text);
  const vps = r.json.server;

  r = await api('POST', `/api/control/servers/${vps.server_id}/test`, { port: ORIGIN_PORT });
  check('آزمونِ اتصالِ سرور واقعی است', r.json?.result?.status === 'online', r.text);

  r = await api('POST', `/api/control/servers/${vps.server_id}/test`, { port: 9 });
  check('پورتِ بسته «online» گزارش نمی‌شود', r.json?.result?.status !== 'online', r.text);

  console.log('\n── Agent ──');
  r = await api('POST', `/api/control/servers/${vps.server_id}/agent/key`, { panelUrl: BASE });
  check('ساختِ کلیدِ Agent', r.status === 200 && typeof r.json?.key === 'string' && r.json.key.length === 64, r.text);
  const agentKey = r.json.key;

  r = await api('GET', `/api/control/servers/${vps.server_id}/agent`);
  check('کلید دیگر برنمی‌گردد', r.status === 200 && r.json?.hasKey === true && r.json.key === undefined);

  const report = {
    os: { platform: 'linux', hostname: 'test-vps' },
    uptime: 1234,
    cpu: { usage: 96, cores: 2 },
    memory: { total: 1000, free: 500, used: 500, usage: 50 },
    storage: [{ mount: '/', total: 100, free: 5, used: 95, usage: 95 }],
    services: [{ name: 'api', port: 3000, status: 'online' }],
  };
  const rawBody = JSON.stringify(report);
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', agentKey).update(`${ts}.${rawBody}`).digest('hex');

  r = await api('POST', '/api/control/agent/report', rawBody, {
    raw: true,
    noAuth: true,
    headers: {
      'content-type': 'application/json',
      'x-agent-server': vps.server_id,
      'x-agent-timestamp': String(ts),
      'x-agent-signature': sig,
    },
  });
  check('گزارشِ امضاشدهٔ Agent پذیرفته می‌شود', r.status === 200 && r.json?.ok === true, r.text);

  r = await api('POST', '/api/control/agent/report', rawBody, {
    raw: true,
    noAuth: true,
    headers: {
      'content-type': 'application/json',
      'x-agent-server': vps.server_id,
      'x-agent-timestamp': String(ts),
      'x-agent-signature': 'a'.repeat(64),
    },
  });
  check('امضای غلط رد می‌شود', r.status === 401, r.text);

  r = await api('POST', '/api/control/agent/report', rawBody, {
    raw: true,
    noAuth: true,
    headers: {
      'content-type': 'application/json',
      'x-agent-server': vps.server_id,
      'x-agent-timestamp': String(ts - 4000),
      'x-agent-signature': crypto.createHmac('sha256', agentKey).update(`${ts - 4000}.${rawBody}`).digest('hex'),
    },
  });
  check('گزارشِ کهنه (مهرِ زمانیِ قدیمی) رد می‌شود', r.status === 401, r.text);

  r = await api('GET', '/api/control/alerts');
  check('هشدارِ پردازندهٔ بالا از گزارشِ Agent ساخته شد', r.json.alerts.some((a) => a.kind === 'high_cpu'), r.text);
  check('هشدارِ کمبودِ فضا ساخته شد', r.json.alerts.some((a) => a.kind === 'storage_low'), r.text);

  console.log('\n── پروژه‌ها ──');
  r = await api('POST', '/api/control/projects', { name: 'فروشگاه من', type: 'nope' });
  check('نوعِ نامعتبرِ پروژه رد می‌شود', r.status === 400, r.text);

  r = await api('POST', '/api/control/projects', {
    name: 'ShopApp',
    type: 'api',
    version: '1.0.0',
    server_id: localServer.id,
    db_kind: 'postgres',
    db_host: '127.0.0.1',
    db_port: ORIGIN_PORT,
    db_name: 'shop',
  });
  check('ساختِ پروژه', r.status === 201 && /^prj_/.test(r.json?.project?.project_id || ''), r.text);
  const shop = r.json.project;
  check('پوشهٔ اختصاصیِ پروژه ساخته شد', fs.existsSync(path.join(storageRoot, shop.slug, 'backups')));
  check('شناسنامهٔ پروژه روی دیسک هست', fs.existsSync(path.join(storageRoot, shop.slug, 'project.json')));

  // پروژه بدون سرور: null نباید به صفر تبدیل شود و کلیدِ خارجی را بشکند
  r = await api('POST', '/api/control/projects', { name: 'NoServer', type: 'service', server_id: null, db_port: null });
  check('پروژه بدون سرور هم ساخته می‌شود', r.status === 201 && r.json?.project?.server_id === null, r.text);
  if (r.status === 201) await api('DELETE', `/api/control/projects/${r.json.project.project_id}?confirm=true`);

  r = await api('POST', '/api/control/projects', { name: 'EmptyServer', type: 'service', server_id: '' });
  check('رشته خالی هم به سرورِ ناموجود تبدیل نمی‌شود', r.status === 201 && r.json?.project?.server_id === null, r.text);
  if (r.status === 201) await api('DELETE', `/api/control/projects/${r.json.project.project_id}?confirm=true`);

  r = await api('POST', '/api/control/projects', { name: 'PumpStation', type: 'website', server_id: localServer.id });
  const pump = r.json.project;
  check('پروژهٔ دوم ساخته شد', r.status === 201 && pump.project_id !== shop.project_id);
  check('پوشه‌ها از هم جدا هستند', path.join(storageRoot, shop.slug) !== path.join(storageRoot, pump.slug));

  console.log('\n── پورت‌ها (هیچ پورتی بدون بررسی) ──');
  r = await api('POST', `/api/control/projects/${shop.project_id}/ports/inspect`, { port: ORIGIN_PORT, host: '127.0.0.1', server_id: localServer.id });
  check('بررسیِ پورت، بازبودنِ واقعی را می‌بیند', r.json?.probe?.status === 'online', r.text);

  r = await api('POST', `/api/control/projects/${shop.project_id}/ports`, { port: 3000, protocol: 'http', service: 'REST API', server_id: localServer.id });
  check('ثبتِ پورت ۳۰۰۰', r.status === 201, r.text);

  r = await api('POST', `/api/control/projects/${pump.project_id}/ports`, { port: 3000, protocol: 'http', service: 'REST API', server_id: localServer.id });
  check('پورتِ تکراری روی همان سرور جلویش گرفته می‌شود', r.status === 409 && r.json?.error === 'port_conflict', r.text);

  r = await api('POST', `/api/control/projects/${pump.project_id}/ports`, { port: 3000, protocol: 'http', service: 'REST API', server_id: localServer.id, force: true });
  check('با تأییدِ صریح ثبت می‌شود', r.status === 201, r.text);

  console.log('\n── IP و Endpoint ──');
  r = await api('POST', `/api/control/projects/${shop.project_id}/ips`, { address: '192.168.0.102', kind: 'lan', port: 3000 });
  check('ثبتِ IP داخلی', r.status === 201 && r.json.ip.family === 'ipv4', r.text);

  r = await api('POST', `/api/control/projects/${shop.project_id}/ips`, { address: '2001:db8::1', kind: 'public' });
  check('IPv6 خودش تشخیص داده می‌شود', r.json?.ip?.family === 'ipv6', r.text);

  r = await api('POST', `/api/control/projects/${shop.project_id}/endpoints`, {
    protocol: 'http',
    host: '127.0.0.1',
    port: ORIGIN_PORT,
    path: '/api',
    environment: 'development',
    name: 'API توسعه',
    is_primary: true,
  });
  check('ثبتِ Endpoint', r.status === 201 && r.json.endpoint.url === `http://127.0.0.1:${ORIGIN_PORT}/api`, r.text);
  const devEndpoint = r.json.endpoint;

  r = await api('POST', `/api/control/projects/${shop.project_id}/endpoints`, {
    protocol: 'ws',
    host: '127.0.0.1',
    port: WS_PORT,
    path: '/socket',
    environment: 'development',
    name: 'WebSocket',
  });
  const wsEndpoint = r.json.endpoint;
  check('ثبتِ WebSocket', r.status === 201 && r.json.endpoint.url === `ws://127.0.0.1:${WS_PORT}/socket`, r.text);

  r = await api('POST', `/api/control/projects/${shop.project_id}/endpoints/${devEndpoint.id}/test`);
  check('آزمونِ HTTP واقعی است', r.json?.result?.status === 'online' && r.json.result.code === 200, r.text);

  r = await api('POST', `/api/control/projects/${shop.project_id}/endpoints/${wsEndpoint.id}/test`);
  check('دست‌دادنِ واقعیِ WebSocket', r.json?.result?.status === 'online' && r.json.result.code === 101, r.text);

  r = await api('POST', `/api/control/projects/${shop.project_id}/endpoints`, {
    protocol: 'https',
    host: '127.0.0.1',
    port: ORIGIN_PORT,
    path: '/',
    environment: 'staging',
  });
  const badTls = r.json.endpoint;
  r = await api('POST', `/api/control/projects/${shop.project_id}/endpoints/${badTls.id}/test`);
  check('اتصالِ https به مبدأِ بدونِ TLS «online» گزارش نمی‌شود', r.json?.result?.status !== 'online', r.text);

  console.log('\n── مرزِ پروژه‌ها ──');
  r = await api('POST', `/api/control/projects/${pump.project_id}/endpoints/${devEndpoint.id}/test`);
  check('Endpoint پروژهٔ الف از مسیرِ پروژهٔ ب دیده نمی‌شود', r.status === 404, r.text);

  r = await api('DELETE', `/api/control/projects/${pump.project_id}/ips/1`);
  check('حذفِ IP پروژهٔ دیگر ممکن نیست', r.status === 404, r.text);

  console.log('\n── دامنه و مسیر ──');
  r = await api('POST', '/api/control/network/domains', { name: 'example.com', project_id: shop.id });
  check('ثبتِ دامنه', r.status === 201, r.text);
  const domain = r.json.domain;

  r = await api('POST', '/api/control/network/domains', { name: 'not a domain' });
  check('دامنهٔ نامعتبر رد می‌شود', r.status === 400, r.text);

  r = await api('POST', '/api/control/network/tunnels', {
    name: 'تونل API',
    server_id: localServer.id,
    project_id: shop.id,
    routes: [{ hostname: 'api.example.com', service: 'http://localhost:3000' }],
  });
  check('ثبتِ تونل با مسیرش', r.status === 201, r.text);
  const tunnel = r.json.tunnel;

  r = await api('POST', '/api/control/network/routes', {
    hostname: 'api.example.com',
    project_id: shop.id,
    server_id: localServer.id,
    tunnel_id: tunnel.id,
    service: 'http://localhost:3000',
    label: 'REST API',
  });
  check('مسیرِ ساب‌دامین به سرویس', r.status === 201, r.text);
  check('ساب‌دامین خودکار به دامنهٔ ریشه وصل شد', r.json?.route?.domain_id === domain.id, JSON.stringify(r.json?.route));

  r = await api('POST', '/api/control/network/routes', { hostname: 'api.example.com', project_id: pump.id });
  check('یک ساب‌دامین دوبار ثبت نمی‌شود', r.status === 409, r.text);

  r = await api('POST', '/api/control/network/routes', { hostname: 'socket.example.com', project_id: shop.id, tunnel_id: tunnel.id, service: 'http://localhost:4701', label: 'WebSocket' });
  check('یک دامنه برای چند سرویس', r.status === 201, r.text);

  r = await api('GET', '/api/control/network/routes');
  check('نقشهٔ مسیرها خوانده می‌شود', r.json.routes.length === 2 && r.json.routes.every((x) => x.domain_name === 'example.com'), r.text);

  console.log('\n── گاوصندوق ──');
  r = await api('POST', '/api/control/vault', { name: 'cf-token', kind: 'cf_token', scope: 'global', value: 'super-secret-value-1234' });
  check('ذخیرهٔ راز', r.status === 201, r.text);
  check('مقدارِ راز برنمی‌گردد', r.json?.secret?.value === undefined && r.json?.secret?.masked === '••••••••', r.text);
  check('فقط چهار نویسهٔ آخر به‌عنوان نشانه', r.json?.secret?.hint === '••••1234', r.text);

  r = await api('GET', '/api/control/vault');
  check('فهرستِ گاوصندوق بدونِ مقدار', r.json.secrets.every((s) => s.value === undefined && s.ciphertext === undefined), r.text);
  check('گاوصندوق سالم است', r.json?.health?.readable === r.json?.health?.total && r.json.health.total > 0, JSON.stringify(r.json?.health));

  const vaultKey = path.join(dataDir, 'vault.key');
  check('کلیدِ گاوصندوق روی دیسک ساخته شد', fs.existsSync(vaultKey));
  if (process.platform !== 'win32') {
    const mode = (fs.statSync(vaultKey).mode & 0o777).toString(8);
    check('کلید فقط برای خودِ کاربر خواندنی است', mode === '600', mode);
  }
  const raw = fs.readFileSync(path.join(dataDir, 'panel.db')).toString('latin1');
  check('مقدارِ خام در دیتابیس پیدا نمی‌شود', !raw.includes('super-secret-value-1234'));

  console.log('\n── پیکربندیِ مرکزی ──');
  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/config`, {
    environment: 'production',
    data: { API_BASE_URL: 'https://api.example.com/api', WS_URL: 'wss://socket.example.com/socket', API_VERSION: 2, DB_PASSWORD: 'nope' },
  });
  check('ذخیرهٔ نسخهٔ پیکربندی', r.status === 201 && r.json.version === 1, r.text);
  check('کلیدِ رمزمانند رد می‌شود', r.json.rejected.some((x) => x.key === 'DB_PASSWORD'), JSON.stringify(r.json.rejected));
  check('کلیدهای سالم می‌مانند', r.json.data.API_BASE_URL === 'https://api.example.com/api');

  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/config`, {
    environment: 'production',
    data: { API_BASE_URL: 'https://api2.example.com/api' },
  });
  check('نسخهٔ دوم ساخته شد', r.json?.version === 2, r.text);

  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/config/1/activate`);
  check('بازگشت به نسخهٔ قبلی', r.status === 200 && r.json.version.version === 1, r.text);

  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/config/token`);
  check('ساختِ توکنِ برنامه', r.status === 200 && typeof r.json?.token === 'string', r.text);
  const configToken = r.json.token;

  r = await api('GET', `/api/app-config/${shop.project_id}`, undefined, { noAuth: true });
  check('پیکربندی بدونِ توکن بسته است', r.status === 401, r.text);

  r = await api('GET', `/api/app-config/${shop.project_id}`, undefined, {
    noAuth: true,
    headers: { authorization: `Bearer ${configToken}` },
  });
  check('برنامه پیکربندی را می‌گیرد', r.status === 200 && r.json?.config?.API_BASE_URL === 'https://api.example.com/api', r.text);
  check('شناسهٔ پروژه در پاسخ هست', r.json?.config?.PROJECT_ID === shop.project_id);

  r = await api('GET', `/api/app-config/${pump.project_id}`, undefined, {
    noAuth: true,
    headers: { authorization: `Bearer ${configToken}` },
  });
  check('توکنِ یک پروژه برای پروژهٔ دیگر کار نمی‌کند', r.status === 401, r.text);

  console.log('\n── حساب‌ها ──');
  r = await api('POST', `/api/control/projects/${shop.project_id}/shops`, { name: 'شعبهٔ مرکزی', owner_name: 'علی' });
  check('ساختِ فروشگاه', r.status === 201 && /^shop_/.test(r.json.shop.shop_id), r.text);
  const shopRow = r.json.shop;

  r = await api('POST', `/api/control/projects/${shop.project_id}/users`, { name: 'کاربر یک', phone: '0912', role: 'manager', shop_id: shopRow.id });
  check('ساختِ کاربرِ پروژه', r.status === 201, r.text);
  const user = r.json.user;

  r = await api('POST', `/api/control/projects/${pump.project_id}/users`, { name: 'کاربر دو', shop_id: shopRow.id });
  check('فروشگاهِ پروژهٔ دیگر پذیرفته نمی‌شود', r.status === 400 && r.json.error === 'shop_not_in_project', r.text);

  r = await api('GET', `/api/control/projects/${pump.project_id}/users`);
  check('کاربرانِ پروژه‌ها قاطی نمی‌شوند', r.json.total === 0, r.text);

  r = await api('POST', `/api/control/projects/${shop.project_id}/subscriptions`, {
    plan: 'یک‌ساله',
    user_id: user.id,
    shop_id: shopRow.id,
    end_at: Date.now() + 86400000,
  });
  check('ساختِ اشتراک', r.status === 201, r.text);
  const sub = r.json.subscription;

  r = await api('POST', `/api/control/projects/${shop.project_id}/subscriptions/${sub.id}/extend`, { days: 30 });
  check('تمدیدِ اشتراک', r.status === 200 && r.json.subscription.end_at > sub.end_at, r.text);

  r = await api('POST', `/api/control/projects/${shop.project_id}/subscriptions/${sub.id}/suspend`);
  check('تعلیقِ اشتراک', r.json?.subscription?.status === 'suspended', r.text);

  console.log('\n── انتشار ──');
  const releaseDir = path.join(storageRoot, shop.slug, 'releases');
  const apk = path.join(releaseDir, 'shop-1.0.0.apk');
  await fsp.writeFile(apk, Buffer.alloc(2048, 3));
  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/releases`, {
    platform: 'android',
    version: '1.0.0',
    file_path: apk,
    published: true,
    notes: 'اولین نسخه',
  });
  check('ثبتِ انتشار با فایلِ واقعی', r.status === 201 && r.json.release.file_size === 2048, r.text);
  const release = r.json.release;

  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/releases/${release.id}/verify`);
  check('جمعِ کنترلیِ فایل درست است', r.json?.ok === true, r.text);

  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/releases`, {
    platform: 'android',
    version: '2.0.0',
    file_path: path.join(tmp, 'outside.apk'),
  });
  check('فایلِ بیرونِ پوشهٔ پروژه پذیرفته نمی‌شود', r.status === 400, r.text);

  r = await api('GET', `/api/app-config/${shop.project_id}?platform=android`, undefined, {
    noAuth: true,
    headers: { authorization: `Bearer ${configToken}` },
  });
  check('برنامه آخرین نسخه را می‌بیند', r.json?.update?.version === '1.0.0', r.text);

  console.log('\n── بکاپ و بازگردانی ──');
  const appDir = path.join(storageRoot, shop.slug, 'app');
  await fsp.writeFile(path.join(appDir, 'index.js'), 'console.log("v1");');
  await fsp.mkdir(path.join(appDir, 'lib'), { recursive: true });
  await fsp.writeFile(path.join(appDir, 'lib', 'db.js'), 'export const x = 1;');

  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/backups`, { note: 'آزمایشی' });
  check('گرفتنِ بکاپ', r.status === 201 && r.json.backup.status === 'ok' && r.json.backup.size > 0, r.text);
  const backup = r.json.backup;
  check('فایلِ بکاپ روی دیسک هست', fs.existsSync(backup.path));

  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/backups/${backup.id}/validate`);
  check('بکاپ سالم است', r.json?.ok === true && r.json.checksumOk === true, r.text);

  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/backups/${backup.id}/preview`);
  check('پیش‌نمایشِ بازگردانی', r.json?.preview?.totalFiles >= 3, r.text);
  check('پیش‌نمایش می‌گوید چه چیزی جایگزین می‌شود', Boolean(r.json?.preview?.willReplace?.directory), r.text);

  r = await api('POST', `/api/control/storage/projects/${pump.project_id}/backups/${backup.id}/validate`);
  check('بکاپِ پروژهٔ الف برای پروژهٔ ب نامعتبر است', r.json?.errors?.includes('wrong_project'), r.text);

  // فایل را خراب می‌کنیم و بعد برمی‌گردانیم
  await fsp.writeFile(path.join(appDir, 'index.js'), 'خراب شد');
  await fsp.rm(path.join(appDir, 'lib', 'db.js'), { force: true });

  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/backups/${backup.id}/restore`, {});
  check('بازگردانی بدونِ تأیید انجام نمی‌شود', r.status === 400, r.text);

  r = await api('POST', `/api/control/storage/projects/${shop.project_id}/backups/${backup.id}/restore`, { confirm: true });
  check('بازگردانی انجام شد', r.status === 200 && r.json.ok === true, r.text);
  check('پیش از بازگردانی، بکاپِ ایمنی گرفته شد', Boolean(r.json?.safetyBackupId), r.text);
  check('فایل برگشت', (await fsp.readFile(path.join(appDir, 'index.js'), 'utf8')) === 'console.log("v1");');
  check('فایلِ پاک‌شده هم برگشت', fs.existsSync(path.join(appDir, 'lib', 'db.js')));
  check('پوشهٔ موقتِ files باقی نمانده', !fs.existsSync(path.join(storageRoot, shop.slug, 'files')));

  console.log('\n── جابه‌جایی به VPS ──');
  r = await api('POST', `/api/control/projects/${shop.project_id}/migrate/plan`, { to_server_id: vps.id });
  check('نقشهٔ جابه‌جایی', r.status === 200 && r.json.to.server_id === vps.server_id, r.text);
  check('نقشه می‌گوید کدام Endpointها عوض می‌شوند', Array.isArray(r.json.endpoints), r.text);

  r = await api('POST', `/api/control/projects/${shop.project_id}/migrate`, { to_server_id: vps.id });
  check('جابه‌جایی بدونِ تأیید انجام نمی‌شود', r.status === 400, r.text);

  r = await api('POST', `/api/control/projects/${shop.project_id}/migrate`, { to_server_id: vps.id, confirm: true });
  check('جابه‌جایی انجام شد', r.status === 200 && Boolean(r.json.backup), r.text);
  const steps = Object.fromEntries((r.json.steps || []).map((s) => [s.name, s.status]));
  check('اول بکاپ گرفته شد', steps.backup === 'ok', JSON.stringify(steps));
  check('انتقالِ انجام‌نشده «موفق» ثبت نشد', steps.transfer === 'manual', JSON.stringify(steps));
  check('Health Check واقعاً اجرا شد', ['ok', 'warn'].includes(steps.health), JSON.stringify(steps));

  r = await api('GET', `/api/control/projects/${shop.project_id}`);
  check('پروژه روی سرورِ تازه نشست', r.json.project.server_id === vps.id, r.text);
  check('دامنهٔ ثابت دست‌نخورده ماند', r.json.routes.some((x) => x.hostname === 'api.example.com'), r.text);

  console.log('\n── مانیتورینگ ──');
  r = await api('POST', '/api/control/monitoring/sync');
  check('هماهنگیِ هدف‌ها', r.status === 200 && r.json.total > 0, r.text);

  r = await api('GET', '/api/control/monitoring');
  check('فهرستِ هدف‌ها', r.json.monitors.length > 0, r.text);
  const epMonitor = r.json.monitors.find((m) => m.kind === 'endpoint');
  check('هدفِ Endpoint ساخته شد', Boolean(epMonitor));

  if (epMonitor) {
    r = await api('POST', `/api/control/monitoring/${epMonitor.id}/check`);
    check('بررسیِ دستیِ یک هدف', r.status === 200 && Boolean(r.json.result.status), r.text);
    r = await api('GET', `/api/control/monitoring/${epMonitor.id}/history`);
    check('تاریخچهٔ بررسی ذخیره می‌شود', r.json.history.length > 0, r.text);
  }

  console.log('\n── دفترِ رخدادها ──');
  r = await api('GET', '/api/control/audit');
  check('رخدادها ثبت شده‌اند', r.json.total > 10, r.text);
  check('ساختِ پروژه در دفتر هست', r.json.rows.some((x) => x.action === 'project.create'), '');
  check('بازگردانی در دفتر هست', r.json.rows.some((x) => x.action === 'backup.restore'), '');
  const auditText = JSON.stringify(r.json.rows);
  check('هیچ رمزی داخلِ دفتر ننشسته', !auditText.includes('super-secret-value-1234') && !auditText.includes('ControlCenter!2026'));

  console.log('\n── به‌روزرسانی ──');
  r = await api('GET', '/api/control/update');
  check('وضعیتِ به‌روزرسانی', r.status === 200 && typeof r.json.status.repo === 'string', r.text);

  r = await api('POST', '/api/control/update/settings', { repo: 'bad repo name' });
  check('نامِ نامعتبرِ مخزن رد می‌شود', r.status === 400, r.text);

  r = await api('POST', '/api/control/update/settings', { repo: 'vil3ntec-it/server', channel: 'release', autoCheck: false });
  check('ذخیرهٔ تنظیماتِ به‌روزرسانی', r.status === 200 && r.json.status.repo === 'vil3ntec-it/server', r.text);

  r = await api('POST', '/api/control/update/install', {});
  check('نصب بدونِ تأیید انجام نمی‌شود', r.status === 400, r.text);

  console.log('\n── داشبورد ──');
  r = await api('GET', '/api/control/overview');
  check('داشبوردِ مرکز فرمان', r.status === 200 && r.json.counts.projects.total === 2, r.text);
  check('شمارشِ نوعِ پروژه‌ها', r.json.counts.projects.byType.api === 1 && r.json.counts.projects.byType.website === 1, JSON.stringify(r.json.counts.projects));
  check('وضعیتِ انبار در داشبورد', r.json.storage.root === storageRoot, r.text);

  console.log('\n── حذفِ پروژه ──');
  r = await api('DELETE', `/api/control/projects/${pump.project_id}`);
  check('حذف بدونِ تأیید انجام نمی‌شود', r.status === 400, r.text);

  r = await api('DELETE', `/api/control/projects/${pump.project_id}?confirm=true`);
  check('حذف با بکاپِ اجباری', r.status === 200 && Boolean(r.json.backup), r.text);
  check('پوشهٔ پروژه به‌صورت پیش‌فرض می‌ماند', fs.existsSync(path.join(storageRoot, pump.slug)));

  r = await api('GET', `/api/control/projects/${shop.project_id}`);
  check('پروژهٔ دیگر دست‌نخورده است', r.status === 200 && r.json.project.name === 'ShopApp', r.text);
}

try {
  await main();
} catch (e) {
  failed++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack}`);
  console.log(serverOut.slice(-3000));
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 900));
  child.kill('SIGKILL');
  origin.close();
  wss.close();
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
console.log('════════════════════════════════════\n');
process.exit(failed ? 1 : 0);
