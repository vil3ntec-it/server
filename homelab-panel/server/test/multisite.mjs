// ---------------------------------------------------------------------------
//  آزمونِ چندسایتی — همان چهار مشکلی که باید حل می‌شد:
//    ۱) هر سایت پوشه و رمزِ دادهٔ جدا دارد و داده‌ها قاطی نمی‌شوند
//    ۲) دامنه واقعاً روی سایت می‌نشیند و چند دامنه برای یک سایت ممکن است
//    ۳) همان دامنه را می‌شود به سایتِ دیگری منتقل کرد
//    ۴) سایتی که واقعاً بالاست «آفلاین» نشان داده نمی‌شود
//
//      node test/multisite.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const PORT = Number(process.env.TEST_PORT || 4793);
const SYNC_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-multi-'));
const dataDir = path.join(tmp, 'data');
const sitesRoot = path.join(tmp, 'sites');

for (const name of ['alpha', 'beta', 'alpha2']) {
  fs.mkdirSync(path.join(sitesRoot, name), { recursive: true });
  fs.writeFileSync(path.join(sitesRoot, name, 'index.html'), `<h1>${name}</h1>`, 'utf8');
}

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`);
  }
};

// یک «سایتِ اینترنتی» ساختگی که واقعاً جواب می‌دهد — برای تستِ آنلاین بودن
const remote = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('up');
});
await new Promise((r) => remote.listen(0, '127.0.0.1', r));
const remotePort = remote.address().port;

const serverPath = path.join(import.meta.dirname, '..', 'src', 'index.js');
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverPath], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT),
    HLP_SITESYNC_PORT: String(SYNC_PORT),
    HLP_HOST: '127.0.0.1',
    HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: sitesRoot,
    HLP_METRICS_INTERVAL: '1000',
    HLP_TUNNEL: '0',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
child.stdout.on('data', (d) => (serverOut += d));
child.stderr.on('data', (d) => (serverOut += d));

async function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return true;
    } catch { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

let token = null;
async function api(method, url, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch { /* JSON نبود */ }
  return { status: res.status, json, text };
}

/** یک اتصال سایت‌مانند به سرورِ داده */
function connect(query) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${SYNC_PORT}/${query}`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout'));
    }, 6000);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.op === 'connected') {
        clearTimeout(timer);
        resolve(ws);
      } else if (m.op === 'error') {
        clearTimeout(timer);
        ws.close();
        reject(new Error(m.msg));
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function rpc(ws, msg) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const onMsg = (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id === id) {
        ws.off('message', onMsg);
        resolve(m);
      }
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ ...msg, id }));
  });
}

/**
 * تشخیصِ آنلاین بودن را مستقیم صدا می‌زند — در پروسهٔ جدا، تا دیتابیسِ پنل
 * در پوشهٔ همین آزمون ساخته شود و به سرورِ در حال اجرا دست نخورد.
 */
function probeHealth(url) {
  return new Promise((resolve) => {
    const code = `
      const { checkSiteOnline } = await import(${JSON.stringify(
        path.join(import.meta.dirname, '..', 'src', 'sites', 'health.js')
      )});
      const res = await checkSiteOnline({ slug: 'probe', port: null }, { urls: [${JSON.stringify(url)}], wait: true });
      console.log('RESULT' + JSON.stringify(res));
    `;
    const proc = spawn(process.execPath, ['--input-type=module', '--eval', code], {
      env: { ...process.env, HLP_DATA_DIR: path.join(tmp, 'probe-data') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (out += d));
    proc.on('exit', () => {
      const m = out.match(/RESULT(\{.*\})/);
      resolve(m ? JSON.parse(m[1]) : null);
    });
  });
}

async function main() {
  console.log('\n▶ راه‌اندازی سرور آزمایشی...');
  if (!(await waitForServer())) {
    console.log(serverOut);
    throw new Error('سرور بالا نیامد');
  }

  let r = await api('POST', '/api/auth/setup', { username: 'admin', password: 'HomeServer!2026' });
  token = r.json?.token;
  check('ورود به پنل', Boolean(token));

  console.log('\n── دو سایت با پوشهٔ دادهٔ کاملاً جدا ──');
  r = await api('POST', '/api/sites', { path: path.join(sitesRoot, 'alpha'), name: 'Alpha' });
  const alpha = r.json?.site;
  r = await api('POST', '/api/sites', { path: path.join(sitesRoot, 'beta'), name: 'Beta' });
  const beta = r.json?.site;
  check('دو سایت اضافه شد', Boolean(alpha?.id && beta?.id));

  const alphaSrv = (await api('GET', `/api/sites/${alpha.id}/server`)).json;
  const betaSrv = (await api('GET', `/api/sites/${beta.id}/server`)).json;
  check('پوشهٔ دادهٔ Alpha ساخته شد', fs.existsSync(alphaSrv?.dataDir || ''), alphaSrv?.dataDir);
  check('پوشهٔ دادهٔ Beta ساخته شد', fs.existsSync(betaSrv?.dataDir || ''), betaSrv?.dataDir);
  check('پوشه‌ها یکی نیستند', alphaSrv.dataDir !== betaSrv.dataDir);
  check(
    'پوشه‌ها داخل پوشهٔ سرور هستند',
    alphaSrv.dataDir.includes(path.join('site-sync', 'sites')) &&
      betaSrv.dataDir.includes(path.join('site-sync', 'sites'))
  );

  const alphaToken = (await api('GET', `/api/sites/${alpha.id}/server/token`)).json?.token;
  const betaToken = (await api('GET', `/api/sites/${beta.id}/server/token`)).json?.token;
  const mainToken = (await api('GET', '/api/site-server/token')).json?.token;
  check('هر سایت رمز خودش را دارد', Boolean(alphaToken && betaToken) && alphaToken !== betaToken);
  check('رمز سایت‌ها با رمز سرور اصلی فرق دارد', alphaToken !== mainToken && betaToken !== mainToken);

  console.log('\n── دادهٔ سایت‌ها با هم قاطی نمی‌شود ──');
  const wsA = await connect(`?site=${alpha.slug}&token=${alphaToken}`);
  const wsB = await connect(`?site=${beta.slug}&token=${betaToken}`);
  await rpc(wsA, { op: 'set', path: 'ledger/owner', value: 'alpha-data' });
  await rpc(wsB, { op: 'set', path: 'ledger/owner', value: 'beta-data' });

  const readA = await rpc(wsA, { op: 'get', path: 'ledger/owner' });
  const readB = await rpc(wsB, { op: 'get', path: 'ledger/owner' });
  check('Alpha دادهٔ خودش را می‌بیند', readA.value === 'alpha-data', String(readA.value));
  check('Beta دادهٔ خودش را می‌بیند', readB.value === 'beta-data', String(readB.value));
  check('هیچ‌کدام دادهٔ دیگری را نمی‌بیند', readA.value !== readB.value);

  // اتصال بدون معرفی، فقط با رمز — باید به دفترِ همان سایت برود
  const wsAgain = await connect(`?token=${betaToken}`);
  const viaToken = await rpc(wsAgain, { op: 'get', path: 'ledger/owner' });
  check('رمز به‌تنهایی هم سایت را پیدا می‌کند', viaToken.value === 'beta-data', String(viaToken.value));
  wsAgain.close();

  // رمز سایت دیگر نباید در پوشهٔ این سایت کار کند
  let crossed = false;
  try {
    const bad = await connect(`?site=${alpha.slug}&token=${betaToken}`);
    crossed = true;
    bad.close();
  } catch { /* درست است که رد شود */ }
  check('رمز یک سایت روی پوشهٔ سایت دیگر کار نمی‌کند', !crossed);

  wsA.close();
  wsB.close();
  await new Promise((r) => setTimeout(r, 800)); // فرصت نوشتن روی دیسک

  const alphaFiles = fs.readdirSync(alphaSrv.dataDir).filter((f) => f.endsWith('.json'));
  const betaFiles = fs.readdirSync(betaSrv.dataDir).filter((f) => f.endsWith('.json'));
  check('دادهٔ Alpha در پوشهٔ خودش نوشته شد', alphaFiles.includes('ledger.json'), alphaFiles.join(','));
  check('دادهٔ Beta در پوشهٔ خودش نوشته شد', betaFiles.includes('ledger.json'), betaFiles.join(','));
  check(
    'محتوای دو پوشه یکی نیست',
    fs.readFileSync(path.join(alphaSrv.dataDir, 'ledger.json'), 'utf8') !==
      fs.readFileSync(path.join(betaSrv.dataDir, 'ledger.json'), 'utf8')
  );

  console.log('\n── دامنه: نوشتن، چندتایی، و جابه‌جایی بین سایت‌ها ──');
  r = await api('PUT', `/api/sites/${alpha.id}`, { domain: 'yaqobipump.top' });
  check('دامنه روی سایت ذخیره شد', r.status === 200 && r.json?.site?.domain === 'yaqobipump.top');

  r = await api('GET', `/api/sites/${alpha.id}/domains`);
  check('دامنه در فهرست دامنه‌های سایت آمد', r.json?.domains?.includes('yaqobipump.top'));

  r = await api('GET', '/api/domains');
  const registered = r.json?.domains?.find((d) => d.name === 'yaqobipump.top');
  check('دامنه در بخش دامنه‌ها هم ثبت شد', Boolean(registered));
  check('دامنه به سایت Alpha وصل است', registered?.siteName === 'Alpha', String(registered?.siteName));

  r = await api('POST', `/api/sites/${alpha.id}/domains`, { domain: 'https://Shop.Yaqobipump.top/' });
  check('دامنهٔ دوم برای همان سایت اضافه شد', r.json?.domains?.length === 2, JSON.stringify(r.json?.domains));
  check('آدرس با https و اسلش هم درست خوانده می‌شود', r.json?.domains?.includes('shop.yaqobipump.top'));

  r = await api('POST', `/api/sites/${alpha.id}/domains`, { domain: 'نه یک دامنه' });
  check('دامنهٔ نامعتبر رد می‌شود', r.status === 400);

  // همان دامنه، سایتِ دیگر
  r = await api('PUT', `/api/domains/${registered.id}`, { siteId: beta.id });
  check('دامنه به سایت دیگر منتقل شد', r.status === 200);
  r = await api('GET', '/api/domains');
  const moved = r.json?.domains?.find((d) => d.name === 'yaqobipump.top');
  check('حالا دامنه روی Beta است', moved?.siteName === 'Beta', String(moved?.siteName));
  check('دامنه به پورت سایت تازه اشاره می‌کند', moved?.sitePort === beta.port, String(moved?.sitePort));

  r = await api('GET', `/api/sites/${alpha.id}/domains`);
  check('دامنه از سایت قبلی برداشته شد', !r.json?.domains?.includes('yaqobipump.top'));
  r = await api('GET', `/api/sites/${alpha.id}`);
  check('دامنهٔ اصلیِ سایت قبلی جایگزین شد', r.json?.site?.domain === 'shop.yaqobipump.top', String(r.json?.site?.domain));

  // تغییر نامِ خودِ دامنه
  r = await api('PUT', `/api/domains/${registered.id}`, { name: 'panel.yaqobipump.top' });
  check('نام دامنه عوض می‌شود', r.status === 200 && r.json?.domain?.name === 'panel.yaqobipump.top');

  console.log('\n── آنلاین/آفلاینِ درست ──');
  r = await api('GET', '/api/sites');
  let betaRow = r.json?.sites?.find((s) => s.id === beta.id);
  check('سایتِ خاموش، آفلاین گزارش می‌شود', betaRow?.online === false);

  await api('POST', `/api/sites/${beta.id}/start`);
  await new Promise((r) => setTimeout(r, 900));
  r = await api('GET', '/api/sites');
  betaRow = r.json?.sites?.find((s) => s.id === beta.id);
  check('سایتِ اجراشده آنلاین است', betaRow?.online === true);
  check('دلیل آنلاین بودن گزارش می‌شود', betaRow?.onlineVia === 'process' || betaRow?.onlineVia === 'port');
  await api('POST', `/api/sites/${beta.id}/stop`);

  // سایتی که فقط روی اینترنت بالاست (پورت محلی ندارد) باید آنلاین دیده شود
  r = await api('POST', '/api/sites/create', { name: 'Hosted', kind: 'static' });
  const hosted = r.json?.site;
  await api('PUT', `/api/sites/${hosted.id}`, { port: null });
  await api('POST', `/api/sites/${hosted.id}/domains`, { domain: 'hosted.example.test' });
  r = await api('GET', `/api/sites/${hosted.id}`);
  check('سایتِ بدون پورت که دامنه‌اش جواب نمی‌دهد، آفلاین است', r.json?.site?.online === false);
  check('آدرس عمومی سایت گزارش می‌شود', r.json?.site?.publicUrls?.includes('https://hosted.example.test'));

  // همان چیزی که خراب بود: سایتی که پورت محلی ندارد ولی آدرس عمومی‌اش
  // واقعاً جواب می‌دهد، باید «آنلاین» باشد — نه آفلاین.
  const verdict = await probeHealth(`http://127.0.0.1:${remotePort}`);
  check('سایتی که فقط از اینترنت بالاست، آنلاین شمرده می‌شود', verdict?.online === true, JSON.stringify(verdict));
  check('دلیلش «آدرس عمومی» گزارش می‌شود', verdict?.via === 'public', String(verdict?.via));
  const down = await probeHealth('http://127.0.0.1:1/');
  check('آدرس عمومیِ خاموش، آنلاین شمرده نمی‌شود', down?.online === false, JSON.stringify(down));

  console.log('\n── هر سایت آدرس اینترنتی خودش را دارد ──');
  r = await api('GET', `/api/sites/${alpha.id}/tunnel`);
  check('وضعیت تونلِ اختصاصی سایت خوانده می‌شود', r.status === 200 && r.json?.slug === alpha.slug);
  r = await api('GET', '/api/sites');
  const withTunnel = r.json?.sites?.every((s) => s.tunnel && typeof s.tunnel.status === 'string');
  check('هر سایت وضعیت تونل خودش را دارد', withTunnel === true);
  const addrs = (await api('GET', `/api/sites/${alpha.id}/server`)).json?.addresses || [];
  check('آدرس اتصال هر سایت شامل نام خودش است', addrs.every((a) => a.ws.includes(`site=${alpha.slug}`)));

  console.log('\n── افزودن سایت: همه‌چیزش خودکار ثبت می‌شود ──');
  // دامنهٔ پایه را می‌گذاریم؛ از این به بعد هر سایت تازه زیردامنهٔ خودش را می‌گیرد
  r = await api('PUT', '/api/settings', { sitesBaseDomain: 'yaqobipump.top' });
  check('دامنهٔ پایه ذخیره شد', r.status === 200);
  r = await api('GET', '/api/settings');
  check('راه‌اندازی خودکار روشن است', r.json?.settings?.siteAutoSetup === true);
  check('دامنهٔ پایه برگشت داده می‌شود', r.json?.settings?.sitesBaseDomain === 'yaqobipump.top');

  r = await api('POST', '/api/sites/create', { name: 'Karkhane', kind: 'static' });
  const auto = r.json?.site;
  check('سایت تازه ساخته شد', Boolean(auto?.id));
  check('دامنه‌اش خودکار ساخته شد', auto?.domain === 'karkhane.yaqobipump.top', String(auto?.domain));
  check('پورت خودکار گرفت', Number.isFinite(auto?.port));

  r = await api('GET', `/api/sites/${auto.id}`);
  const autoInfo = r.json?.site;
  check('پوشهٔ دادهٔ اختصاصی‌اش خودکار ساخته شد', fs.existsSync(autoInfo?.dataDir || ''), String(autoInfo?.dataDir));
  check('رمز اختصاصی‌اش ساخته شد', Boolean((await api('GET', `/api/sites/${auto.id}/server/token`)).json?.token));

  r = await api('GET', '/api/domains');
  const autoDomain = r.json?.domains?.find((d) => d.name === 'karkhane.yaqobipump.top');
  check('دامنه در بخش دامنه‌ها هم خودکار ثبت شد', autoDomain?.siteName === 'Karkhane');

  // سایت دوم با همان نام نباید دامنهٔ سایت اول را بدزدد
  r = await api('POST', '/api/sites', { path: path.join(sitesRoot, 'alpha2'), name: 'Karkhane' });
  const twin = r.json?.site;
  check('سایت هم‌نام هم دامنهٔ جدا می‌گیرد', Boolean(twin?.domain) && twin.domain !== auto.domain, String(twin?.domain));

  console.log('\n── سایتِ خودم و دامنه‌اش خودکار ثبت می‌شوند ──');
  // فقط آدرس سایت را می‌دهیم؛ نه سایتی دستی می‌سازیم، نه دامنه‌ای
  r = await api('PUT', '/api/site-server/site-url', { siteUrl: 'https://yaqobipump.top' });
  check('آدرس سایت ذخیره شد', r.status === 200);
  check('سایت خودکار ثبت شد', r.json?.registered?.ok === true, JSON.stringify(r.json?.registered));

  r = await api('GET', '/api/domains');
  const mine = r.json?.domains?.find((d) => d.name === 'yaqobipump.top');
  check('دامنه‌ام خودکار در بخش دامنه‌ها آمد', Boolean(mine), JSON.stringify(r.json?.domains?.map((d) => d.name)));
  check('و به سایت خودش وصل است', Boolean(mine?.siteName), String(mine?.siteName));

  r = await api('GET', '/api/sites');
  const mainSite = r.json?.sites?.find((s) => s.domains?.includes('yaqobipump.top'));
  check('سایتم خودکار در بخش سایت‌ها آمد', Boolean(mainSite), String(mainSite?.name));
  check('به‌عنوان سایتِ اصلی علامت خورده', mainSite?.isMainSite === true);
  check('پوشه‌اش ساخته شد', Boolean(mainSite?.path) && fs.existsSync(mainSite.path), String(mainSite?.path));
  check(
    'دادهٔ سایتِ اصلی همان دفترِ اصلی است (پوشهٔ دوم نمی‌سازد)',
    Boolean(mainSite?.dataDir) && !mainSite.dataDir.includes(path.join('site-sync', 'sites')),
    String(mainSite?.dataDir)
  );

  // دوباره صدا زدن نباید سایت تکراری بسازد
  const before = (await api('GET', '/api/sites')).json?.sites?.length;
  await api('PUT', '/api/site-server/site-url', { siteUrl: 'https://yaqobipump.top' });
  const after = (await api('GET', '/api/sites')).json?.sites?.length;
  check('دوباره اجرا شدن، سایت تکراری نمی‌سازد', before === after, `${before} → ${after}`);

  console.log('\n── ریشهٔ سایت‌ها از داخل پنل جابه‌جا می‌شود ──');
  const newRoot = path.join(tmp, 'drive2', 'my-sites');
  r = await api('PUT', '/api/settings', { sitesRoot: newRoot });
  check('ریشهٔ تازه پذیرفته شد', r.status === 200, r.text.slice(0, 120));
  check('پوشهٔ ریشه واقعاً روی دیسک ساخته شد', fs.existsSync(newRoot));

  r = await api('GET', '/api/settings');
  check('پنل ریشهٔ تازه را گزارش می‌کند', r.json?.paths?.sitesRoot === newRoot, String(r.json?.paths?.sitesRoot));
  check('پیشنهادِ «کنار سرور» هم داده می‌شود', Boolean(r.json?.paths?.sitesRootNextToServer));

  r = await api('POST', '/api/sites/create', { name: 'Anbar', kind: 'static' });
  const inNewRoot = r.json?.site;
  check(
    'سایت تازه داخل ریشهٔ تازه ساخته شد',
    String(inNewRoot?.root_path || '').startsWith(newRoot),
    String(inNewRoot?.root_path)
  );
  check('فایلش هم واقعاً آنجاست', fs.existsSync(path.join(newRoot, 'anbar', 'index.html')));

  r = await api('GET', '/api/sites');
  check('فهرست سایت‌ها ریشهٔ تازه را نشان می‌دهد', r.json?.sitesRoot === newRoot);

  // مسیری که نمی‌شود پوشه ساخت (زیرِ یک فایل) — باید سریع و تمیز رد شود
  const aFile = path.join(tmp, 'not-a-folder.txt');
  fs.writeFileSync(aFile, 'x', 'utf8');
  const started = Date.now();
  r = await api('PUT', '/api/settings', { sitesRoot: path.join(aFile, 'sub') });
  check('ریشهٔ ناممکن رد می‌شود', r.status === 400, String(r.status));
  check('و سرور را قفل نمی‌کند', Date.now() - started < 6000, `${Date.now() - started}ms`);
  r = await api('GET', '/api/settings');
  check('ریشه بعد از رد شدن دست‌نخورده مانده', r.json?.paths?.sitesRoot === newRoot);

  console.log('\n── حذف سایت، دادهٔ سایت‌های دیگر را نمی‌برد ──');
  await api('DELETE', `/api/sites/${alpha.id}`);
  check('پوشهٔ دادهٔ سایتِ حذف‌شده پاک شد', !fs.existsSync(alphaSrv.dataDir));
  check('پوشهٔ دادهٔ سایت دیگر دست‌نخورده است', fs.existsSync(betaSrv.dataDir));

  console.log('\n════════════════════════════════════');
  console.log(`  موفق: ${passed}    ناموفق: ${failed}`);
  console.log('════════════════════════════════════\n');
}

try {
  await main();
} catch (e) {
  failed++;
  console.error('\n❌ آزمون شکست:', e.message);
  console.error(serverOut.slice(-2000));
} finally {
  child.kill('SIGTERM');
  remote.close();
  await new Promise((r) => setTimeout(r, 400));
  await fsp.rm(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
