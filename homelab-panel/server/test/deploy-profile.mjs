// ---------------------------------------------------------------------------
//  آزمونِ نمایهٔ استقرار — «برنامهٔ سرور هر جا، فقط با تنظیم» (۱۴۰۵/۰۸/۰۹)
//      node test/deploy-profile.mjs
//
//  ۱) خواندنِ تنظیم (src/deploy.js) — خالص، هر ترکیب:
//     • home دقیقاً همان رفتارِ امروز (همهٔ قابلیت‌ها، همان شبکه‌ها، همان معنای
//       متغیرهای قدیمی که فقط «0» خاموششان می‌کند)
//     • vps/docker/paas: درهای «کنترلِ کاملِ همین کامپیوتر» پیش‌فرض خاموش
//     • تنظیمِ ناامن پذیرفته نمی‌شود (پنلِ بی TLS، ثبتِ پمپِ باز، هاستِ اشتراکی)
//  ۲) نگهبانِ درِ پنل با فهرستِ هر نمایه — روی سوکتِ ساختگی، همان کدِ واقعی
//  ۳) پنلِ واقعی با HLP_DEPLOY=vps: فایل/دیتابیس/دستیار ۴۰۳ِ feature_disabled،
//     /api/auth/me نمایه را می‌گوید، و درِ پنل از نشانیِ غیرِ خودی بسته است
//  ۴) پنلِ عمومی پشتِ پراکسی: ورودِ بی کدِ دومرحله‌ای و «ساختِ نخستین مدیر»
//     از راهِ پراکسی رد؛ راهِ خصوصی همیشه باز (مالک هرگز بیرون نمی‌ماند)
//  ۵) ترمینال، اجرای سایت و به‌روزرسانیِ درجا در سطحِ خودِ تابع خاموش‌اند
//  ۶) تنظیمِ ناامن ⇒ پنل اصلاً بالا نمی‌آید (کدِ ۷۸)
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { resolveDeploy, viaProxy, NETS, FEATURE_NAMES, deploySummary } from '../src/deploy.js';
import { LOCAL_NETS, guardServer, isLocalPeer } from '../src/lib/lan-guard.js';

const SRC = path.join(import.meta.dirname, '..', 'src');
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 400) : ''}`); }
};
const allOn = (f) => FEATURE_NAMES.every((k) => f[k] === true);

/* ─────────────────────────── ۱) خواندنِ تنظیم ─────────────────────────── */
console.log('── ۱) home همان رفتارِ امروز ──');
{
  const d = resolveDeploy({});
  check('بی HLP_DEPLOY ⇒ home', d.profile === 'home' && d.home === true);
  check('home: همهٔ قابلیت‌ها روشن', allOn(d.features), JSON.stringify(d.features));
  check('home: پراکسی باور نمی‌شود (همان پیش‌فرضِ HLP_TRUST_PROXY)', d.trustProxy === false);
  check('home: ثبتِ پمپ فقط از شبکهٔ خانه (lan)', d.enroll === 'lan');
  check('home: درِ پنل همان فهرستِ LOCAL_NETS، خودِ همان', JSON.stringify(d.panel.nets) === JSON.stringify(LOCAL_NETS) && NETS.lan === LOCAL_NETS);
  check('home: نگهبان روشن، پنل عمومی نیست', d.panel.guard === true && d.panel.public === false);
  check('home: نه خطا نه هشدار', d.errors.length === 0 && d.warnings.length === 0, JSON.stringify([d.errors, d.warnings]));
  check('HLP_DEPLOY=HOME (حروفِ بزرگ) ⇒ home', resolveDeploy({ HLP_DEPLOY: ' HOME ' }).profile === 'home');

  //  ⛔ متغیرهای قدیمی با همان معنای قدیم: فقط «0» خاموش است
  check('HLP_TUNNEL=0 ⇒ تونل خاموش', resolveDeploy({ HLP_TUNNEL: '0' }).features.tunnel === false);
  check('HLP_TUNNEL=false ⇒ همان رفتارِ امروز: روشن', resolveDeploy({ HLP_TUNNEL: 'false' }).features.tunnel === true);
  check('HLP_DISCOVERY=0 ⇒ کشف خاموش', resolveDeploy({ HLP_DISCOVERY: '0' }).features.discovery === false);
  check('HLP_AGENT=0 ⇒ دستیار خاموش', resolveDeploy({ HLP_AGENT: '0' }).features.agent === false);
  check('HLP_TRUST_PROXY=1 ⇒ پراکسی', resolveDeploy({ HLP_TRUST_PROXY: '1' }).trustProxy === true);
  check('HLP_TRUST_PROXY="" ⇒ همان رفتارِ امروز (روشن)', resolveDeploy({ HLP_TRUST_PROXY: '' }).trustProxy === true);
  check('HLP_STATIONS_ENROLL=open روی home پذیرفته (آزمون‌ها)', resolveDeploy({ HLP_STATIONS_ENROLL: 'open' }).errors.length === 0);
  check('HLP_STATIONS_ENROLL=bogus ⇒ پیش‌فرضِ نمایه', resolveDeploy({ HLP_STATIONS_ENROLL: 'bogus' }).enroll === 'lan');
  check('HLP_PANEL_LAN_ONLY=0 روی home پذیرفته (همان امروز)', resolveDeploy({ HLP_PANEL_LAN_ONLY: '0' }).errors.length === 0);
  check('HLP_FEATURE_TUNNEL=0 از HLP_TUNNEL=1 جلوتر است', resolveDeploy({ HLP_TUNNEL: '1', HLP_FEATURE_TUNNEL: '0' }).features.tunnel === false);
}

console.log('── ۱ب) میزبان‌های عمومی ──');
{
  const vps = resolveDeploy({ HLP_DEPLOY: 'vps', HLP_DOMAIN: 'example.com', HLP_SECRET_KEY: 'x'.repeat(40) });
  check('vps: ترمینال/فایل/دیتابیس/سایت/داکر خاموش', ['terminal', 'files', 'databases', 'sites', 'docker'].every((k) => vps.features[k] === false), JSON.stringify(vps.features));
  check('vps: دستیار، کشف و تونل خاموش', !vps.features.agent && !vps.features.discovery && !vps.features.tunnel);
  check('vps: به‌روزرسانیِ درجا روشن (کد روی دیسکِ خودِ سرور است)', vps.features.update === true);
  check('vps: ثبتِ پمپ خاموش (شبکهٔ خانه‌ای نیست)', vps.enroll === 'off');
  check('vps: درِ پنل فقط خودِ سرور و Tailscale', vps.panel.netsName === 'tailscale' && !vps.panel.nets.includes('10.0.0.0/8') && vps.panel.nets.includes('100.64.0.0/10'));
  check('vps: بی خطا و بی هشدار وقتی دامنه و راز هست', vps.errors.length === 0 && vps.warnings.length === 0, JSON.stringify([vps.errors, vps.warnings]));

  const dk = resolveDeploy({ HLP_DEPLOY: 'docker', HLP_DOMAIN: 'example.com', HLP_SECRET_KEY: 'x'.repeat(40) });
  check('docker: به‌روزرسانیِ درجا خاموش (ایمیجِ تازه)', dk.features.update === false);
  check('docker: پراکسی پیش‌فرض باور می‌شود (Caddy جلوست)', dk.trustProxy === true);
  check('docker: شبکهٔ خصوصیِ داکر به درِ پنل می‌رسد (Caddy از 172.x)', dk.panel.netsName === 'lan');
  const dk0 = resolveDeploy({ HLP_DEPLOY: 'docker', HLP_TRUST_PROXY: '0', HLP_DOMAIN: 'e.com', HLP_SECRET_KEY: 'k' });
  check('docker + HLP_TRUST_PROXY=0 ⇒ خاموش، با هشدار', dk0.trustProxy === false && dk0.warnings.some((w) => w.includes('HLP_TRUST_PROXY=0')));

  const paas = resolveDeploy({ HLP_DEPLOY: 'paas' });
  check('paas: درِ پنل فقط خودِ کانتینر', paas.panel.netsName === 'loopback' && JSON.stringify(paas.panel.nets) === JSON.stringify(['127.0.0.0/8', '::1/128']));
  check('paas بی دامنه ⇒ هشدارِ «برنامه‌ها نشانی را از کجا بدانند»', paas.warnings.some((w) => w.includes('HLP_DOMAIN')));

  const on = resolveDeploy({ HLP_DEPLOY: 'vps', HLP_FEATURE_TERMINAL: '1', HLP_DOMAIN: 'e.com', HLP_SECRET_KEY: 'k' });
  check('vps + HLP_FEATURE_TERMINAL=1 ⇒ روشن، با هشدار', on.features.terminal === true && on.sources.terminal === 'HLP_FEATURE_TERMINAL' && on.warnings.some((w) => w.includes('terminal')));
  const bad = resolveDeploy({ HLP_DEPLOY: 'vps', HLP_FEATURE_FILES: 'maybe' });
  check('مقدارِ نامفهوم روی قابلیتِ خطرناک ⇒ خاموش (بسته، نه باز)', bad.features.files === false && bad.sources.files === 'invalid');
  const badHome = resolveDeploy({ HLP_FEATURE_FILES: 'maybe' });
  check('… حتی روی home', badHome.features.files === false);
  check('HLP_TUNNEL=1 روی vps ⇒ تونل روشن (VPS پشتِ Cloudflare)', resolveDeploy({ HLP_DEPLOY: 'vps', HLP_TUNNEL: '1' }).features.tunnel === true);
}

console.log('── ۱ج) تنظیمِ ناامن پذیرفته نیست ──');
{
  for (const name of ['shared', 'cpanel', 'shared-hosting', 'passenger']) {
    const d = resolveDeploy({ HLP_DEPLOY: name });
    check(`HLP_DEPLOY=${name} ⇒ خطای روشن (پنل روی هاستِ اشتراکی نیست)`, d.errors.length === 1 && d.errors[0].includes('هاستِ اشتراکی'), d.errors[0]);
  }
  check('نمایهٔ ناشناخته ⇒ خطا', resolveDeploy({ HLP_DEPLOY: 'mars' }).errors.some((e) => e.includes('mars')));
  check('vps + ثبتِ پمپِ باز ⇒ خطا', resolveDeploy({ HLP_DEPLOY: 'vps', HLP_STATIONS_ENROLL: 'open' }).errors.some((e) => e.includes('HLP_STATIONS_ENROLL=open')));
  check('vps + HLP_PANEL_LAN_ONLY=0 بی TLS ⇒ خطا', resolveDeploy({ HLP_DEPLOY: 'vps', HLP_PANEL_LAN_ONLY: '0' }).errors.some((e) => e.includes('HLP_PANEL_LAN_ONLY=0')));
  check('vps + HLP_PANEL_LAN_ONLY=0 با TLSِ خودِ پنل ⇒ پذیرفته', resolveDeploy({ HLP_DEPLOY: 'vps', HLP_PANEL_LAN_ONLY: '0', HLP_TLS_CERT: '/c', HLP_TLS_KEY: '/k' }).errors.length === 0);
  const pubNoUrl = resolveDeploy({ HLP_DEPLOY: 'vps', HLP_PANEL_PUBLIC: '1', HLP_TRUST_PROXY: '1' });
  check('پنلِ عمومی بی HLP_PANEL_URL ⇒ خطا', pubNoUrl.errors.some((e) => e.includes('HLP_PANEL_URL')));
  const pubHttp = resolveDeploy({ HLP_DEPLOY: 'vps', HLP_PANEL_PUBLIC: '1', HLP_TRUST_PROXY: '1', HLP_PANEL_URL: 'http://panel.example.com' });
  check('پنلِ عمومی با http:// ⇒ خطا (هرگز بی TLS)', pubHttp.errors.some((e) => e.includes('TLS')));
  const pubNoProxy = resolveDeploy({ HLP_DEPLOY: 'vps', HLP_PANEL_PUBLIC: '1', HLP_PANEL_URL: 'https://panel.example.com' });
  check('پنلِ عمومی بی HLP_TRUST_PROXY ⇒ خطا', pubNoProxy.errors.some((e) => e.includes('HLP_TRUST_PROXY=1')));
  const pubNoGuard = resolveDeploy({ HLP_DEPLOY: 'docker', HLP_PANEL_PUBLIC: '1', HLP_PANEL_URL: 'https://panel.example.com', HLP_PANEL_LAN_ONLY: '0', HLP_TLS_CERT: '/c', HLP_TLS_KEY: '/k' });
  check('پنلِ عمومی با نگهبانِ خاموش ⇒ خطا', pubNoGuard.errors.some((e) => e.includes('مستقیم به پورتِ پنل')));
  const pubOk = resolveDeploy({ HLP_DEPLOY: 'docker', HLP_PANEL_PUBLIC: '1', HLP_PANEL_URL: 'https://panel.example.com/', HLP_DOMAIN: 'e.com', HLP_SECRET_KEY: 'k' });
  check('پنلِ عمومیِ درست (docker، https، پراکسی) ⇒ پذیرفته', pubOk.errors.length === 0 && pubOk.panel.public && pubOk.panel.url === 'https://panel.example.com', JSON.stringify(pubOk.errors));
  const sum = deploySummary(pubOk);
  check('خلاصهٔ رابط بی هیچ مقدارِ محیطی (نه نشانی، نه راز)', !JSON.stringify(sum).includes('example.com') && sum.profile === 'docker' && sum.panelPublic === true);
}

console.log('── ۱د) راهِ پراکسی ──');
check('X-Forwarded-For ⇒ از پراکسی', viaProxy({ headers: { 'x-forwarded-for': '1.2.3.4' } }) === true);
check('CF-Connecting-IP ⇒ از پراکسی', viaProxy({ headers: { 'cf-connecting-ip': '1.2.3.4' } }) === true);
check('بی سرآیند ⇒ راهِ خصوصی', viaProxy({ headers: {} }) === false);

/* ────────────────── ۲) نگهبانِ درِ پنل با فهرستِ هر نمایه ────────────────── */
console.log('── ۲) نگهبانِ درِ پنل ──');
function guarded(base, address) {
  const server = new EventEmitter();
  guardServer(server, { extra: [], base });
  let destroyed = false;
  server.emit('connection', { remoteAddress: address, destroy() { destroyed = true; } });
  return !destroyed;
}
check('home: 10.0.0.5 (شبکهٔ خانه) می‌رسد', guarded(NETS.lan, '10.0.0.5'));
check('vps: 10.0.0.5 (شبکهٔ خصوصیِ دیتاسنتر) بسته', !guarded(NETS.tailscale, '10.0.0.5'));
check('vps: 192.168.1.9 بسته', !guarded(NETS.tailscale, '::ffff:192.168.1.9'));
check('vps: Tailscale (100.101.1.1) می‌رسد', guarded(NETS.tailscale, '100.101.1.1'));
check('vps: Tailscale IPv6 می‌رسد', guarded(NETS.tailscale, 'fd7a:115c:a1e0::1234'));
check('vps: خودِ سرور (Caddy/تونلِ SSH) می‌رسد', guarded(NETS.tailscale, '127.0.0.1') && guarded(NETS.tailscale, '::1'));
check('paas: 172.17.0.2 بسته', !guarded(NETS.loopback, '172.17.0.2'));
check('docker: 172.18.0.3 (Caddy) می‌رسد', guarded(NETS.lan, '172.18.0.3'));
check('همه: اینترنت (8.8.8.8) بسته', !guarded(NETS.lan, '8.8.8.8') && !guarded(NETS.tailscale, '8.8.8.8') && !guarded(NETS.loopback, '8.8.8.8'));
check('isLocalPeer بی base همان LOCAL_NETS (رفتارِ امروز)', isLocalPeer('10.1.1.1') === true && isLocalPeer('10.1.1.1', [], NETS.tailscale) === false);

/* ─────────────────── ۳ و ۴) پنلِ واقعی روی نمایهٔ vps ─────────────────── */
const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-deploy-'));
const children = [];
const closers = [];
function startPanel(name, port, env) {
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(path.join(dir, 'sites'), { recursive: true });
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SRC, 'index.js')], {
    env: {
      ...process.env,
      HLP_PORT: String(port), HLP_DATA_DIR: dir, HLP_SITES_ROOT: path.join(dir, 'sites'),
      HLP_SITESYNC: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_ACCOUNT_API: '0', HLP_RATE_LOGIN: '1000',
      HLP_AUTOMATION: '0', HLP_BACKUP_SCHEDULE: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const handle = { child, out: '', base: `http://127.0.0.1:${port}`, port };
  child.stdout.on('data', (d) => (handle.out += d));
  child.stderr.on('data', (d) => (handle.out += d));
  children.push(child);
  return handle;
}
async function up(h) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${h.base}/health`)).ok) return true; } catch { /* هنوز نه */ }
    if (h.child.exitCode !== null) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
async function call(h, method, url, body, token, headers = {}) {
  const hd = { 'Content-Type': 'application/json', ...headers };
  if (token) hd.Authorization = `Bearer ${token}`;
  const r = await fetch(h.base + url, { method, headers: hd, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { /* بی JSON */ }
  return { status: r.status, json };
}
/** اتصالِ TCP از نشانیِ محلیِ داده‌شده — نگهبان پیش از هر بایتی می‌بندد */
function tcpFrom(localAddress, host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, localAddress });
    let data = '';
    s.setTimeout(3000, () => { s.destroy(); resolve({ ok: false, why: 'timeout' }); });
    s.on('connect', () => s.write('GET /health HTTP/1.0\r\nHost: x\r\n\r\n'));
    s.on('data', (d) => (data += d));
    s.on('close', () => resolve({ ok: data.startsWith('HTTP/1.1 200') || data.startsWith('HTTP/1.0 200'), data: data.slice(0, 40) }));
    s.on('error', (e) => resolve({ ok: false, why: e.code }));
  });
}
const outer = Object.values(os.networkInterfaces()).flat()
  .find((i) => i && !i.internal && i.family === 'IPv4' && !isLocalPeer(i.address, [], NETS.tailscale))?.address || null;

try {
  console.log('── ۳) پنلِ واقعی با HLP_DEPLOY=vps ──');
  //  سرورِ حسابِ ساختگی — فقط تا ببینیم درگاهِ فروشگاه/اشتراک روی vps همان‌طور رد می‌کند
  const { createServer } = await import('node:http');
  const fake = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, fake: true, path: req.url, xff: req.headers['x-forwarded-for'] || null }));
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  closers.push(() => fake.close());
  const PUBLIC_PORT = Number(process.env.TEST_PORT3 || 4975);
  const vps = startPanel('vps', Number(process.env.TEST_PORT || 4972), {
    HLP_DEPLOY: 'vps', HLP_HOST: '0.0.0.0', HLP_DOMAIN: 'example.com', HLP_SECRET_KEY: 'k'.repeat(48),
    HLP_ADMIN_USER: 'owner', HLP_ADMIN_PASSWORD: 'Owner-pass-123',
    HLP_SITESYNC: '1', HLP_SITESYNC_PORT: String(PUBLIC_PORT),
    HLP_ACCOUNT_API: `http://127.0.0.1:${fake.address().port}`,
  });
  check('پنل روی vps بالا آمد', await up(vps), vps.out.slice(-600));
  check('در لاگِ شروع نمایه و درهای خاموش دیده می‌شود', vps.out.includes('نمایهٔ استقرار: vps') && vps.out.includes('terminal'), vps.out.slice(-800));
  const login = await call(vps, 'POST', '/api/auth/login', { username: 'owner', password: 'Owner-pass-123' });
  check('ورودِ مدیرِ خودساخته از محیط', login.status === 200 && login.json?.token, JSON.stringify(login.json));
  const tok = login.json?.token;
  const me = await call(vps, 'GET', '/api/auth/me', undefined, tok);
  check('/api/auth/me نمایه را می‌گوید', me.json?.deploy?.profile === 'vps' && me.json.deploy.features.terminal === false && me.json.deploy.features.update === true, JSON.stringify(me.json?.deploy));
  const files = await call(vps, 'GET', '/api/files/roots', undefined, tok);
  check('فایل‌منیجر ⇒ ۴۰۳ feature_disabled', files.status === 403 && files.json?.error === 'feature_disabled' && files.json?.feature === 'files', JSON.stringify(files));
  const filesV1 = await call(vps, 'GET', '/api/panel/v1/files/roots', undefined, tok);
  check('… از راهِ /api/panel/v1 هم', filesV1.status === 403 && filesV1.json?.error === 'feature_disabled');
  const dbs = await call(vps, 'GET', '/api/databases/clients', undefined, tok);
  check('دیتابیس‌های همین کامپیوتر ⇒ ۴۰۳ feature_disabled', dbs.status === 403 && dbs.json?.feature === 'databases', JSON.stringify(dbs));
  const ollama = await call(vps, 'POST', '/api/agent/ollama/install', {}, tok);
  check('نصبِ Ollama از پنل ⇒ ۴۰۳ (دستیار خاموش)', ollama.status === 403 && ollama.json?.feature === 'agent', JSON.stringify(ollama));
  const agentStatus = await call(vps, 'GET', '/api/agent/status', undefined, tok);
  check('وضعیتِ دستیار هنوز خواندنی (صفحه می‌گوید چرا خاموش است)', agentStatus.status === 200, JSON.stringify(agentStatus).slice(0, 200));
  const noAuth = await call(vps, 'GET', '/api/dashboard');
  check('بقیهٔ پنل دست‌نخورده: بی توکن همان ۴۰۱', noAuth.status === 401);
  const pubBase = `http://127.0.0.1:${PUBLIC_PORT}`;
  const shop = await fetch(`${pubBase}/api/shop/ping`, { headers: { 'CF-Connecting-IP': '198.51.100.7' } }).then((r) => r.json()).catch((e) => ({ e: e.message }));
  check('درگاهِ فروشگاه روی vps همان‌طور به سرورِ حساب می‌رسد (پورتِ عمومی)', shop.fake === true && shop.path === '/api/shop/ping', JSON.stringify(shop));
  check('… و IPِ واقعیِ کاربر را می‌برد', shop.xff === '198.51.100.7', JSON.stringify(shop));
  const leak = await fetch(`${pubBase}/api/files/roots`).then((r) => r.status).catch(() => 0);
  check('فایل‌منیجر هرگز روی پورتِ عمومی نیست', leak === 404, String(leak));
  if (outer) {
    const blocked = await tcpFrom(outer, outer, vps.port);
    check(`درِ پنل از ${outer} (نه خودِ سرور، نه Tailscale) بسته`, blocked.ok === false, JSON.stringify(blocked));
  } else {
    console.log('  ⏭ نشانیِ بیرونی روی این ماشین نیست — سنجهٔ TCP رد شد (بخشِ ۲ همان نگهبان را می‌سنجد)');
  }
  const local = await tcpFrom('127.0.0.1', '127.0.0.1', vps.port);
  check('درِ پنل از خودِ سرور باز', local.ok === true, JSON.stringify(local));

  console.log('── ۴) پنلِ عمومی پشتِ پراکسی ──');
  const pub = startPanel('public', Number(process.env.TEST_PORT2 || 4973), {
    HLP_DEPLOY: 'vps', HLP_HOST: '127.0.0.1', HLP_DOMAIN: 'example.com', HLP_SECRET_KEY: 'p'.repeat(48),
    HLP_PANEL_PUBLIC: '1', HLP_PANEL_URL: 'https://panel.example.com', HLP_TRUST_PROXY: '1',
  });
  check('پنلِ عمومی بالا آمد', await up(pub), pub.out.slice(-600));
  const XFF = { 'X-Forwarded-For': '203.0.113.9' };
  const s1 = await call(pub, 'POST', '/api/auth/setup', { username: 'owner', password: 'Owner-pass-123' }, null, XFF);
  check('ساختِ نخستین مدیر از راهِ پراکسی ⇒ ۴۰۳ setup_private_only', s1.status === 403 && s1.json?.error === 'setup_private_only', JSON.stringify(s1));
  const s2 = await call(pub, 'POST', '/api/auth/setup', { username: 'owner', password: 'Owner-pass-123' });
  check('… از راهِ خصوصی (تونلِ SSH) ساخته می‌شود', s2.status === 200 && s2.json?.token, JSON.stringify(s2));
  const l1 = await call(pub, 'POST', '/api/auth/login', { username: 'owner', password: 'Owner-pass-123' }, null, XFF);
  check('ورودِ بی کدِ دومرحله‌ای از راهِ پراکسی ⇒ ۴۰۳ totp_required_public', l1.status === 403 && l1.json?.error === 'totp_required_public' && !l1.json?.token, JSON.stringify(l1));
  const l1b = await call(pub, 'POST', '/api/auth/login', { username: 'owner', password: 'wrong-pass-xx' }, null, XFF);
  check('رمزِ غلط همان ۴۰۱ (اول رمز سنجیده می‌شود — نامِ کاربر لو نمی‌رود)', l1b.status === 401);
  const l2 = await call(pub, 'POST', '/api/auth/login', { username: 'owner', password: 'Owner-pass-123' });
  check('… از راهِ خصوصی وارد می‌شود (مالک هرگز بیرون نمی‌ماند)', l2.status === 200 && l2.json?.token, JSON.stringify(l2));
  const { totp } = await import('../src/lib/totp.js');
  const st = await call(pub, 'POST', '/api/auth/totp/setup', {}, l2.json.token);
  const en = await call(pub, 'POST', '/api/auth/totp/enable', { code: totp(st.json.secret) }, l2.json.token);
  check('کدِ دومرحله‌ای از راهِ خصوصی روشن شد', en.status === 200, JSON.stringify(en.json).slice(0, 200));
  const l3 = await call(pub, 'POST', '/api/auth/login', { username: 'owner', password: 'Owner-pass-123' }, null, XFF);
  check('حالا از راهِ پراکسی: رمز ⇒ بلیتِ کدِ دومرحله‌ای (نه نشست)', l3.status === 200 && l3.json?.totpRequired === true && !l3.json?.token, JSON.stringify(l3));
  const l4 = await call(pub, 'POST', '/api/auth/login/totp', { ticket: l3.json.ticket, code: totp(st.json.secret) }, null, XFF);
  check('… و با کد وارد می‌شود', l4.status === 200 && l4.json?.token, JSON.stringify(l4).slice(0, 200));

  console.log('── ۵) خاموشی در سطحِ خودِ تابع ──');
  const probe = (env, code) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], {
    env: { ...process.env, HLP_DATA_DIR: path.join(tmpRoot, 'fn'), HLP_SITES_ROOT: path.join(tmpRoot, 'fn-sites'), ...env },
    encoding: 'utf8', cwd: path.join(SRC, '..'),
  });
  const term = probe({ HLP_DEPLOY: 'vps' }, `const t = await import('./src/system/terminal.js'); console.log(JSON.stringify(t.create({ userId: 1 })));`);
  check('ترمینال: create روی vps ⇒ feature_disabled (هیچ پوسته‌ای ساخته نمی‌شود)', /"error":"feature_disabled"/.test(term.stdout) && /"feature":"terminal"/.test(term.stdout), term.stdout + term.stderr);
  const termHome = probe({}, `const t = await import('./src/system/terminal.js'); const r = t.create({ userId: 1 }); console.log(JSON.stringify({ ok: r.ok })); t.close(r.id);`);
  check('ترمینال: روی home همان امروز (نشست ساخته می‌شود)', /"ok":true/.test(termHome.stdout), termHome.stdout + termHome.stderr);
  const site = probe({ HLP_DEPLOY: 'docker' }, `const p = await import('./src/sites/process.js'); console.log(JSON.stringify(await p.startSite({ slug: 'x', root_path: '.', port: 1 })));`);
  check('اجرای سایت روی docker ⇒ feature_disabled', /"feature":"sites"/.test(site.stdout), site.stdout + site.stderr);
  const dock = probe({ HLP_DEPLOY: 'paas' }, `const d = await import('./src/system/docker.js'); console.log(JSON.stringify([await d.available({ force: true }), await d.listContainers()]));`);
  check('داکر روی paas ⇒ «نیست»، بی اجرای docker', /"reason":"feature_disabled"/.test(dock.stdout) && /"ok":false/.test(dock.stdout), dock.stdout + dock.stderr);
  const upd = probe({ HLP_DEPLOY: 'docker' }, `const u = await import('./src/update/github.js'); console.log(JSON.stringify([await u.installLatest({}), await u.autoUpdateOnce({}), await u.rollback({})]));`);
  check('به‌روزرسانیِ درجا روی docker ⇒ نصب/خودکار/برگشت هر سه خاموش', /"reason":"feature_disabled"/.test(upd.stdout) && /"skipped":true/.test(upd.stdout) && (upd.stdout.match(/feature_disabled/g) || []).length >= 2, upd.stdout + upd.stderr);

  console.log('── ۶) تنظیمِ ناامن ⇒ بالا نمی‌آید ──');
  for (const [label, env] of [
    ['پنلِ بی TLS در اینترنت (vps + HLP_PANEL_LAN_ONLY=0)', { HLP_DEPLOY: 'vps', HLP_PANEL_LAN_ONLY: '0' }],
    ['هاستِ اشتراکی (HLP_DEPLOY=cpanel)', { HLP_DEPLOY: 'cpanel' }],
    ['پنلِ عمومی با http://', { HLP_DEPLOY: 'vps', HLP_PANEL_PUBLIC: '1', HLP_PANEL_URL: 'http://p.example.com', HLP_TRUST_PROXY: '1' }],
  ]) {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SRC, 'index.js')], {
      env: { ...process.env, HLP_PORT: '4974', HLP_DATA_DIR: path.join(tmpRoot, 'refuse'), HLP_SITES_ROOT: path.join(tmpRoot, 'refuse-sites'), ...env },
      encoding: 'utf8', timeout: 20000,
    });
    check(`${label} ⇒ خروج با کدِ ۷۸ و پیامِ روشن`, r.status === 78 && r.stderr.includes('پنل بالا نمی‌آید'), `status=${r.status} ${r.stderr.slice(0, 300)}`);
  }
} finally {
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* رفته */ } }
  for (const close of closers) { try { close(); } catch { /* بسته */ } }
  await new Promise((r) => setTimeout(r, 600));
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} نمایهٔ استقرار: ${passed} درست، ${failed} نادرست`);
process.exit(failed ? 1 : 0);
