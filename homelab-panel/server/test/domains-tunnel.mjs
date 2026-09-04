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

  console.log('\n── نامی که آدم واقعاً می‌نویسد ──');
  // کسی که آدرس را از نوارِ مرورگر کپی می‌کند، «https://…/» می‌آورد. تا امروز
  // فقط invalid_hostname می‌گرفت و دلیلش را نمی‌دید.
  const { normalizeHostname } = await import('../src/tunnel.js');
  check('پیشوندِ https برداشته می‌شود', normalizeHostname('https://api.vill3n.top') === 'api.vill3n.top');
  check('اسلشِ آخر برداشته می‌شود', normalizeHostname('https://api.vill3n.top/') === 'api.vill3n.top');
  check('مسیر برداشته می‌شود', normalizeHostname('http://api.vill3n.top/panel?x=1') === 'api.vill3n.top');
  check('پورت برداشته می‌شود', normalizeHostname('api.vill3n.top:8443') === 'api.vill3n.top');
  check('فاصله و حروفِ بزرگ', normalizeHostname('  API.Vill3n.TOP  ') === 'api.vill3n.top');
  check('نقطهٔ پایانی برداشته می‌شود', normalizeHostname('api.vill3n.top.') === 'api.vill3n.top');
  check('نامِ سالم دست‌نخورده می‌ماند', normalizeHostname('api.vill3n.top') === 'api.vill3n.top');
  check('خالی، خالی می‌ماند', normalizeHostname('') === '' && normalizeHostname(null) === '');

  // و همان نام باید از مسیرِ واقعی هم رد شود
  r = await api('POST', '/api/site-server/tunnel/named/main', { hostname: 'https://vill3n.top/' });
  check(
    'آدرسِ کپی‌شده از مرورگر دیگر invalid_hostname نمی‌گیرد',
    r.json?.error !== 'invalid_hostname',
    `${r.status} ${r.text}`
  );

  console.log('\n── شناسهٔ تونل از خروجیِ cloudflared ──');
  /*
   *  باگِ واقعی: کدِ قبلی JSON را از out.slice(out.indexOf('[')) می‌خواند،
   *  روی خروجیِ مخلوطِ stdout و stderr. cloudflared لاگش را روی stderr
   *  می‌ریزد و آن لاگ‌ها کروشه دارند، پس پارس می‌افتاد؛ و چون تونل از قبل
   *  ساخته شده بود، «create» هم شناسه نمی‌داد. نتیجه tunnel_id_not_found
   *  بود و آدرسِ ثابت هرگز ساخته نمی‌شد.
   */
  const { tunnelIdFrom } = await import('../src/tunnel.js');
  const ID = '11111111-2222-3333-4444-555555555555';
  const JSON_OUT = `[{"id":"${ID}","name":"control-center"}]`;
  const NOISE = 'Using [default] config from D:\\server\\New folder (2)\\config.yml';

  check('JSONِ تمیز', tunnelIdFrom(JSON_OUT, 'control-center') === ID);
  check('لاگِ کروشه‌دار پیش از JSON', tunnelIdFrom(`${NOISE}\n${JSON_OUT}`, 'control-center') === ID);
  check('چند لاگِ کروشه‌دار', tunnelIdFrom(`[a] [b]\n${NOISE}\n${JSON_OUT}`, 'control-center') === ID);
  check('لاگ بعد از JSON هم', tunnelIdFrom(`${JSON_OUT}\n${NOISE}`, 'control-center') === ID);
  check(
    'جدولِ متنی وقتی JSON نیست',
    tunnelIdFrom(`NAME              ID\ncontrol-center    ${ID}`, 'control-center') === ID
  );
  check('نامِ دیگری بود، شناسه نده', tunnelIdFrom(JSON_OUT, 'other-tunnel') === null);
  check('خروجیِ خالی', tunnelIdFrom('', 'control-center') === null);
  check('خروجیِ بی‌ربط', tunnelIdFrom('login required\n[error]', 'control-center') === null);
  check(
    'میانِ چند تونل، همان که خواستیم',
    tunnelIdFrom(
      `[{"id":"99999999-9999-9999-9999-999999999999","name":"other"},{"id":"${ID}","name":"control-center"}]`,
      'control-center'
    ) === ID
  );

  console.log('\n── رکوردی که جای غلط ساخته می‌شود ──');
  /*
   *  خرابیِ بی‌صدا: گواهیِ ورود مالِ یک دامنه است. نامی بیرون از آن بدهی،
   *  cloudflared اعتراض نمی‌کند — نامِ دامنهٔ مجاز را به دُم می‌چسباند و با
   *  کدِ صفر برمی‌گردد. پنل «انجام شد» می‌گفت و مرورگر NXDOMAIN.
   */
  const { misroutedHost } = await import('../src/tunnel.js');
  const REAL =
    '2026-09-03T01:59:37Z INF api.vill3n.top.yaqobipump.top is already configured '
    + 'to route to your tunnel tunnelID=aa3c0363-464c-4102-8da6-34cde69f3f3b';

  check(
    'پسوندِ چسبیده گرفته می‌شود',
    misroutedHost(REAL, 'api.vill3n.top') === 'api.vill3n.top.yaqobipump.top',
    misroutedHost(REAL, 'api.vill3n.top')
  );
  check(
    'خروجیِ سالم، هشدارِ الکی نمی‌دهد',
    misroutedHost('Added CNAME api.vill3n.top which will route to this tunnel', 'api.vill3n.top') === null
  );
  check(
    'همان نام، بدونِ پسوند',
    misroutedHost('api.vill3n.top is already configured to route to your tunnel', 'api.vill3n.top') === null
  );
  check(
    'دو تکه پسوند',
    misroutedHost('api.srv.top.example.co.uk created', 'api.srv.top') === 'api.srv.top.example.co.uk'
  );
  check('خروجیِ خالی', misroutedHost('', 'api.vill3n.top') === null);
  check('نامِ خالی', misroutedHost(REAL, '') === null);
  // نقطه در نامِ میزبان نباید در الگو نقشِ «هر نویسه» بازی کند
  check(
    'نقطه‌ها واقعاً نقطه‌اند',
    misroutedHost('apiXvill3nXtop.example.com', 'api.vill3n.top') === null
  );

  console.log('\n── شناسهٔ کهنهٔ تونل ──');
  /*
   *  رکوردِ DNS به شناسه اشاره می‌کند نه به نام. اگر تونلِ هم‌نام در حسابِ
   *  دیگری ساخته شود، شناسه فرق می‌کند ولی config.yml کهنه می‌ماند و پنل تا
   *  ابد تونلِ اشتباه را اجرا می‌کند ⇒ Error 1033 بی‌هیچ پیامی.
   */
  const { reconcileNamedTunnel } = await import('../src/tunnel.js');
  const rec = await reconcileNamedTunnel();
  check('در حالتِ غیرِ نام‌دار، دست به چیزی نمی‌زند', rec.ok && rec.skipped === 'not_named', JSON.stringify(rec));

  console.log('\n── پیکربندیِ آدرسِ ثابت روی دیسک، ولی حالت «سریع» ──');
  /*
   *  ⚠️ باگی که یک شب دیگر برد: startTunnel وقتی سراغِ config.yml می‌رود که
   *  tunnel_mode برابرِ «named» باشد. تعمیرِ دستیِ فایل، این تنظیم را عوض
   *  نمی‌کرد — پس پنل تونلِ سریع بالا می‌آورد، config.yml نادیده می‌ماند، و
   *  api.<دامنه> برای همیشه Error 1033 می‌داد. هر بار هم فایل «درست» بود.
   */
  const fsm = await import('node:fs');
  const pathm = await import('node:path');
  /*
   *  ⚠️ این تکه در‌جا اجرا می‌شود، نه در سرورِ فرزند. پس باید در پوشهٔ دادهٔ
   *  همین پروسه نوشته شود — نه آنِ فرزند — وگرنه tunnel.js فایلی را می‌بیند
   *  که آن‌جا نیست و آزمون بی‌دلیل قرمز می‌شود.
   */
  const { config: cfgm } = await import('../src/config.js');
  const cfDir = pathm.join(cfgm.dataDir, 'cloudflared');
  const uuid = '99999999-8888-7777-6666-555555555555';
  fsm.mkdirSync(cfDir, { recursive: true });
  fsm.writeFileSync(pathm.join(cfDir, `${uuid}.json`), JSON.stringify({ TunnelID: uuid }));
  fsm.writeFileSync(
    pathm.join(cfDir, 'config.yml'),
    [
      `tunnel: ${uuid}`,
      `credentials-file: ${pathm.join(cfDir, `${uuid}.json`).replaceAll('\\', '/')}`,
      'ingress:',
      '  - hostname: api.vill3n.top',
      '    service: http://127.0.0.1:4701',
      '  - service: http_status:404',
    ].join('\n'),
  );

  const { reconcileNamedTunnel: reconcile2 } = await import('../src/tunnel.js');
  const { getSetting: get2 } = await import('../src/db.js');
  check('پیش از تعمیر، حالت سریع است', get2('tunnel_mode', 'quick') !== 'named');

  await reconcile2().catch(() => null);
  check('حالت به «آدرسِ ثابت» برگشت', get2('tunnel_mode', 'quick') === 'named', get2('tunnel_mode', 'quick'));
  check('زیردامنه از فایل خوانده شد', get2('tunnel_hostname', null) === 'api.vill3n.top', get2('tunnel_hostname', null));

  // فایلِ نیمه‌کاره نباید تونلِ سریعِ سالم را از کار بیندازد
  const { setSetting: set2 } = await import('../src/db.js');
  set2('tunnel_mode', 'quick');
  set2('tunnel_hostname', null);
  fsm.writeFileSync(pathm.join(cfDir, 'config.yml'), 'ingress:\n  - service: http_status:404\n');
  await reconcile2().catch(() => null);
  check('فایلِ نیمه‌کاره پذیرفته نمی‌شود', get2('tunnel_mode', 'quick') === 'quick', get2('tunnel_mode', 'quick'));

  /*
   *  ── تونلِ توکنی نباید ربوده شود ─────────────────────────────────────
   *
   *  این همان خطایی است که سرورِ واقعی را خواباند: شرطِ «حالت ≠ named»
   *  حالتِ «token» را هم می‌گرفت. تونلِ توکنی سالم بود و اصلاً کاری به
   *  config.yml نداشت، ولی یک config.yml کهنه روی دیسک باعث می‌شد حالت
   *  بی‌صدا به «named» برگردد و از راه‌اندازیِ بعدی تونلِ مرده اجرا شود
   *  — Error 1033، بدونِ آنکه جایی خطایی چاپ شود.
   */
  fsm.writeFileSync(pathm.join(cfDir, `${uuid}.json`), JSON.stringify({ TunnelID: uuid }));
  fsm.writeFileSync(
    pathm.join(cfDir, 'config.yml'),
    [
      `tunnel: ${uuid}`,
      `credentials-file: ${pathm.join(cfDir, `${uuid}.json`).replaceAll('\\', '/')}`,
      'ingress:',
      '  - hostname: api.vill3n.top',
      '    service: http://127.0.0.1:4701',
      '  - service: http_status:404',
    ].join('\n'),
  );
  set2('tunnel_mode', 'token');
  set2('tunnel_token', 'a-real-token');
  set2('tunnel_hostname', 'api.vill3n.top');
  const recToken = await reconcile2().catch(() => null);
  check('حالتِ توکنی دست‌نخورده می‌ماند', get2('tunnel_mode', 'quick') === 'token', get2('tunnel_mode', 'quick'));
  check('و می‌گوید چرا کاری نکرد', recToken?.skipped === 'token_mode', JSON.stringify(recToken));
  check('توکن پاک نمی‌شود', get2('tunnel_token', null) === 'a-real-token');

  //  و نصب‌هایی که پیش از این فیکس ربوده شده‌اند باید برگردند — ولی فقط وقتی
  //  «named» ثابتاً شدنی نیست، وگرنه آدرسِ ثابتِ عمدیِ کاربر را خراب می‌کنیم.
  set2('tunnel_mode', 'named');
  fsm.rmSync(pathm.join(cfDir, `${uuid}.json`), { force: true });   // فایلِ اعتبار نیست
  const recBack = await reconcile2().catch(() => null);
  check('نصبِ ربوده‌شده به حالتِ توکنی برمی‌گردد', get2('tunnel_mode', 'quick') === 'token', get2('tunnel_mode', 'quick'));
  check('و دلیلش را می‌گوید', recBack?.restored === 'token', JSON.stringify(recBack));

  //  ولی آدرسِ ثابتِ سالم نباید دست بخورد، حتی اگر توکنی هم ذخیره باشد
  fsm.writeFileSync(pathm.join(cfDir, `${uuid}.json`), JSON.stringify({ TunnelID: uuid }));
  set2('tunnel_mode', 'named');
  await reconcile2().catch(() => null);
  check('آدرسِ ثابتِ سالم دست‌نخورده می‌ماند', get2('tunnel_mode', 'quick') === 'named', get2('tunnel_mode', 'quick'));
  set2('tunnel_token', null);

  /*
   *  ── تونلِ کهنه‌ای که هنوز در حساب هست ─────────────────────────────────
   *
   *  همان چیزی که سرورِ واقعی را قفل کرد. حساب دو تونل دارد: یکی قدیمی که
   *  هنوز پاک نشده و config.yml به آن اشاره می‌کند، و control-center که
   *  رکوردِ DNS به آن اشاره دارد. نسخهٔ ۱.۸.۷ می‌گفت «هر دو هستند، دست نزن»
   *  و پنل تا ابد تونلِ قدیمی را اجرا می‌کرد — Error 1033 برای همیشه.
   */
  const OLD_ID = 'aa3c0363-1111-2222-3333-444444444444';
  const NEW_ID = 'eeb76414-5555-6666-7777-888888888888';
  const stateFile = pathm.join(cfgm.dataDir, 'fake-cf-state.json');
  fsm.writeFileSync(stateFile, JSON.stringify({
    tunnels: [
      { uuid: OLD_ID, name: 'old-one', created: new Date().toISOString() },
      { uuid: NEW_ID, name: 'control-center', created: new Date().toISOString() },
    ],
    dns: [],
  }));
  process.env.FAKE_CF_STATE = stateFile;

  // cloudflaredِ ساختگی همان‌جایی که پنل دنبالش می‌گردد
  const binDir = pathm.join(cfgm.dataDir, 'bin');
  fsm.mkdirSync(binDir, { recursive: true });
  const fakeBin = pathm.join(binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  fsm.writeFileSync(
    fakeBin,
    `#!/bin/sh\nexec "${process.execPath}" "${pathm.join(import.meta.dirname, 'fake-cloudflared.mjs')}" "$@"\n`,
    'utf8'
  );
  fsm.chmodSync(fakeBin, 0o755);
  fsm.writeFileSync(pathm.join(cfDir, 'cert.pem'), 'fake-origin-cert');
  fsm.writeFileSync(pathm.join(cfDir, `${NEW_ID}.json`), JSON.stringify({ TunnelID: NEW_ID }));
  fsm.writeFileSync(pathm.join(cfDir, `${OLD_ID}.json`), JSON.stringify({ TunnelID: OLD_ID }));
  fsm.writeFileSync(
    pathm.join(cfDir, 'config.yml'),
    [
      `tunnel: ${OLD_ID}`,
      `credentials-file: ${pathm.join(cfDir, `${OLD_ID}.json`).replaceAll('\\', '/')}`,
      'ingress:',
      '  - hostname: api.vill3n.top',
      '    service: http://127.0.0.1:4701',
      '  - service: http_status:404',
    ].join('\n'),
  );
  set2('tunnel_mode', 'named');
  set2('tunnel_hostname', 'api.vill3n.top');
  set2('tunnel_name', 'control-center');
  set2('tunnel_token', null);
  set2('tunnel_routed_dns', []);

  const recStale = await reconcile2().catch((e) => ({ error: e.message }));
  const afterCfg = fsm.readFileSync(pathm.join(cfDir, 'config.yml'), 'utf8');
  check('به تونلی که DNS به آن اشاره دارد سوئیچ می‌کند', afterCfg.includes(`tunnel: ${NEW_ID}`), afterCfg.split('\n')[0]);
  check('تونلِ کهنه رها می‌شود', !afterCfg.includes(OLD_ID), afterCfg.split('\n').slice(0, 2).join(' / '));
  check('و گزارش می‌دهد که عوض شد', recStale?.changed === true, JSON.stringify(recStale));

  //  و رکوردهای DNS هم باید به همان تونلِ تازه برگردند، وگرنه همان ۱۰۳۳
  //  می‌شود که از آن می‌ترسیدیم — فقط این بار خودمان ساخته‌ایمش.
  const cfState = JSON.parse(fsm.readFileSync(stateFile, 'utf8'));
  const dnsNames = (cfState.dns || []).map((d) => (typeof d === 'string' ? d : d.hostname));
  check('رکوردِ DNS هم دوباره ساخته می‌شود', dnsNames.includes('api.vill3n.top'), JSON.stringify(cfState.dns));
  check('و پنل می‌داند کدام نام‌ها را دوباره وصل کرده',
    (recStale?.rerouted || []).includes('api.vill3n.top'), JSON.stringify(recStale?.rerouted));

  /*
   *  ── فایلِ اعتبارِ گم‌شده باید بازیابی شود، نه اینکه تسلیم شویم ─────────
   *
   *  این همان چیزی است که سرورِ واقعی را بعد از ۱.۸.۵ خواباند. فایلِ اعتبار
   *  به‌سادگی گم می‌شود (نصبِ دوباره، جابه‌جاییِ پوشه، پاک شدنِ داده). اگر
   *  توکنی هم از تنظیمِ قدیمی ذخیره مانده باشد، پنل بدونِ هیچ تلاشی نتیجه
   *  می‌گرفت که «آدرسِ ثابت شدنی نیست» و به تونلِ توکنیِ کهنه برمی‌گشت:
   *
   *      DNS  →  تونلِ نام‌دار      (همانی که کاربر ساخته)
   *      پنل  →  تونلِ توکنیِ قدیمی (مرده)   ⇒ Error 1033، برای همیشه
   *
   *  و چون از آن به بعد حالت «token» بود، هیچ راه‌اندازیِ دوباره‌ای هم
   *  درستش نمی‌کرد. حالا اول بازیابی، بعد تسلیم.
   */
  console.log('\n── فایلِ اعتبارِ گم‌شده، با توکنِ کهنه در تنظیمات ──');
  fsm.writeFileSync(
    pathm.join(cfDir, 'config.yml'),
    [
      `tunnel: ${NEW_ID}`,
      `credentials-file: ${pathm.join(cfDir, `${NEW_ID}.json`).replaceAll('\\', '/')}`,
      'ingress:',
      '  - hostname: api.vill3n.top',
      '    service: http://127.0.0.1:4701',
      '  - service: http_status:404',
    ].join('\n'),
  );
  fsm.rmSync(pathm.join(cfDir, `${NEW_ID}.json`), { force: true }); // فایلِ اعتبار گم شد
  set2('tunnel_mode', 'named');
  set2('tunnel_token', 'a-stale-token');
  set2('tunnel_name', 'control-center');

  const recLost = await reconcile2().catch((e) => ({ error: e.message }));
  check('فایلِ اعتبار دوباره ساخته می‌شود',
    fsm.existsSync(pathm.join(cfDir, `${NEW_ID}.json`)), JSON.stringify(recLost));
  check('و حالت روی «آدرسِ ثابت» می‌ماند',
    get2('tunnel_mode', 'quick') === 'named', get2('tunnel_mode', 'quick'));
  check('به تونلِ توکنیِ کهنه برنمی‌گردد', recLost?.restored !== 'token', JSON.stringify(recLost));
  //  و بازیابی نباید ingress را قربانی کند: مشکل «مسیرِ فایلِ اعتبار» بود، نه
  //  زیردامنه‌ها. بازنویسیِ کلِ فایل از روی دیتابیس، نامی را که فقط در فایل
  //  هست می‌انداخت — همان «کار می‌کرد، حالا نمی‌کند».
  const cfgAfterLost = fsm.readFileSync(pathm.join(cfDir, 'config.yml'), 'utf8');
  check('زیردامنه‌های داخلِ پیکربندی سرِ جایشان می‌مانند',
    cfgAfterLost.includes('hostname: api.vill3n.top'), cfgAfterLost.replaceAll('\n', ' | ').slice(0, 200));
  check('و شناسهٔ تونل عوض نمی‌شود',
    cfgAfterLost.includes(`tunnel: ${NEW_ID}`), cfgAfterLost.split('\n')[0]);
  set2('tunnel_token', null);

  /*
   *  ── زیردامنه‌هایی که فقط در فایل هستند نباید بیفتند ──────────────────
   *
   *  این همان چیزی است که همهٔ برنامه‌ها را یک‌جا خواباند. writeIngress فایل
   *  را از روی دیتابیس بازمی‌سازد؛ اگر پنل دوباره نصب شود یا panel.db از
   *  بکاپِ قدیمی برگردد و config.yml سرِ جایش بماند، دیتابیس هیچ زیردامنه‌ای
   *  نمی‌شناسد و اولین بازنویسی — که در هر بار بالا آمدنِ پنل رخ می‌دهد —
   *  فایل را به «فقط http_status:404» تبدیل می‌کرد.
   *
   *  دو علامت با هم، از یک ریشه:
   *      ingress خالی           ⇒ هر درخواستی ۴۰۴
   *      هیچ رکوردی دوباره وصل نشد ⇒ DNS روی تونلِ مرده می‌ماند ⇒ ۱۰۳۳
   */
  console.log('\n── پنل زیردامنه‌ها را نمی‌شناسد ولی فایل می‌شناسد ──');
  fsm.writeFileSync(
    pathm.join(cfDir, 'config.yml'),
    [
      `tunnel: ${OLD_ID}`,
      `credentials-file: ${pathm.join(cfDir, `${OLD_ID}.json`).replaceAll('\\', '/')}`,
      'ingress:',
      '  - hostname: api.vill3n.top',
      '    service: http://127.0.0.1:4701',
      '  - hostname: shop.vill3n.top',
      '    service: http://127.0.0.1:4702',
      '  - service: http_status:404',
    ].join('\n'),
  );
  fsm.writeFileSync(pathm.join(cfDir, `${OLD_ID}.json`), JSON.stringify({ TunnelID: OLD_ID }));
  fsm.writeFileSync(pathm.join(cfDir, `${NEW_ID}.json`), JSON.stringify({ TunnelID: NEW_ID }));
  set2('tunnel_mode', 'named');
  set2('tunnel_name', 'control-center');
  set2('tunnel_token', null);
  set2('tunnel_hostname', null);      // دیتابیس هیچ‌چیز نمی‌داند
  set2('tunnel_hostnames', []);
  set2('tunnel_routed_dns', []);
  fsm.writeFileSync(stateFile, JSON.stringify({
    tunnels: [
      { uuid: OLD_ID, name: 'old-one' },
      { uuid: NEW_ID, name: 'control-center' },
    ],
    dns: [],
  }));

  const recKeep = await reconcile2().catch((e) => ({ error: e.message }));
  const keptCfg = fsm.readFileSync(pathm.join(cfDir, 'config.yml'), 'utf8');
  check('زیردامنهٔ اصلی نمی‌افتد', keptCfg.includes('hostname: api.vill3n.top'), keptCfg.replaceAll('\n', ' | ').slice(0, 200));
  check('زیردامنهٔ دوم هم نمی‌افتد', keptCfg.includes('hostname: shop.vill3n.top'), keptCfg.replaceAll('\n', ' | ').slice(0, 200));
  check('و پنل از این به بعد می‌شناسدشان',
    get2('tunnel_hostname', null) === 'api.vill3n.top', get2('tunnel_hostname', null));
  //  و چون دیگر می‌شناسدشان، رکوردهای DNS هم به تونلِ تازه برمی‌گردند —
  //  همان چیزی که نبودنش ۱۰۳۳ می‌ساخت.
  check('رکوردهای DNS هم به تونلِ زنده برمی‌گردند',
    (recKeep?.rerouted || []).includes('api.vill3n.top')
      && (recKeep?.rerouted || []).includes('shop.vill3n.top'),
    JSON.stringify(recKeep?.rerouted));

  //  ⚠️ محافظ: این ثبتِ خودکار نباید «حذفِ زیردامنه» را از کار بیندازد.
  //  اگر داخلِ writeIngress می‌نشست، هر حذفی بلافاصله از روی فایل برمی‌گشت.
  const { removeHostname } = await import('../src/tunnel.js');
  await removeHostname('shop.vill3n.top').catch(() => null);
  const afterRemove = fsm.readFileSync(pathm.join(cfDir, 'config.yml'), 'utf8');
  check('حذفِ زیردامنه هنوز واقعاً حذف می‌کند',
    !afterRemove.includes('shop.vill3n.top'), afterRemove.replaceAll('\n', ' | ').slice(0, 200));
  check('و بقیه سرِ جایشان می‌مانند',
    afterRemove.includes('api.vill3n.top'), afterRemove.replaceAll('\n', ' | ').slice(0, 200));
  const { stopTunnel: stopT } = await import('../src/tunnel.js');
  stopT();

  fsm.rmSync(stateFile, { force: true });
  fsm.rmSync(fakeBin, { force: true });
  fsm.rmSync(pathm.join(cfDir, 'cert.pem'), { force: true });
  fsm.rmSync(pathm.join(cfDir, `${NEW_ID}.json`), { force: true });
  fsm.rmSync(pathm.join(cfDir, `${OLD_ID}.json`), { force: true });
  delete process.env.FAKE_CF_STATE;
  set2('tunnel_routed_dns', []);
  set2('tunnel_hostname', null);
  set2('tunnel_mode', 'quick');

  // این تکه در پوشهٔ دادهٔ واقعیِ همین پروسه نوشت — جمعش می‌کنیم
  fsm.rmSync(pathm.join(cfDir, 'config.yml'), { force: true });
  fsm.rmSync(pathm.join(cfDir, `${uuid}.json`), { force: true });
  set2('tunnel_mode', 'quick');
  set2('tunnel_hostname', null);

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
