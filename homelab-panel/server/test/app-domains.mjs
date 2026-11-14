// ---------------------------------------------------------------------------
//  آزمونِ «چند دامنه برای هر برنامه» (۱.۵۰.۹۹)
//      node test/app-domains.mjs
//
//  • سنجشِ خالصِ نام (‎lib/hostname.js‎): نام‌های خصمانه — ستاره، تزریقِ خط در ‎config.yml‎، پورت، ‎user@‎، IP، نامِ درونی،
//    ‎trycloudflare‎، نامِ هم‌شکل (سیریلیک + لاتین)، punycode ِ نادرست، ایموجی، نویسهٔ نامرئی؛ و یونیکد ⇒ punycode.
//  • یک پنلِ واقعی با تونلِ نام‌دارِ ساختگی (‎test/fake-cloudflared.mjs‎) و سرورِ حسابِ ساختگی که ‎PUBLIC_BASE_URLS‎ ِ محیطش را
//    می‌نویسد — همه از راهِ HTTP، مثلِ صاحب‌کار:
//      فقط مالک (مدیرِ دوم ۴۰۳ پیش از رمز، کارگزار ۴۰۳، بی ورود ۴۰۱)، بی احرازِ دوباره رد، دفتر برای هر کار (موفق و ناموفق)؛
//      سایت با چند نام ⇒ همه در ingress به پورتِ سایت و DNS ِ ساختگی؛ نامِ اصلی؛ نامِ فارسی ⇒ punycode؛
//      نامِ تکراری و مالِ برنامهٔ دیگر (هر چهار در: app-domains، دامنه‌های سایت، PUT ِ سایت، دامنه‌ها، زیردامنهٔ دستیِ تونل) رد،
//      دو درخواستِ هم‌زمان برای یک نام ⇒ فقط یکی؛ نام‌های سرورِ حساب ⇒ ingress به پورتِ عمومی و ‎PUBLIC_BASE_URLS‎ ِ فرزند
//      (بی ساختِ دوباره، نامِ اصلی اول)؛ پمپ‌ها فقط داده؛ آخرین نامِ برنامهٔ روشن رد (سایت، سرورِ حساب، پمپ‌ها)؛
//      نوشتنِ ناموفقِ ingress و DNS ِ ناموفق ⇒ برگشتِ کامل (دیتابیس، ‎config.yml‎ همان بایت‌ها، فرزند دوباره بالا نمی‌آید).
//  جابه‌جاییِ «همه یا هیچ» ِ چند نام از راهِ مرکز: ‎test/app-placement.mjs‎.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseHostname } from '../src/lib/hostname.js';

const BASE_PORT = Number(process.env.TEST_PORT || 5455);
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 600) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-app-domains-'));
const SERVER_DIR = path.join(import.meta.dirname, '..');

/* ══════════════ ۱) سنجشِ خالصِ نام ══════════════ */
console.log('── نام‌های خصمانه (lib/hostname.js) ──');
const hostile = [
  ['*.shop.example', 'wildcard'],
  ['shop.*.example', 'wildcard'],
  ['*', 'wildcard'],
  ['a.example\n  - hostname: evil.example\n    service: http://127.0.0.1:22', 'bad_chars'],
  ['a.example\r\nX: y', 'bad_chars'],
  ['a.example evil.example', 'bad_chars'],
  ['​a.example', 'bad_chars'],
  ['a.ex‮ample', 'bad_chars'],
  ['evil.example:8443', 'port'],
  ['https://evil.example:22/', 'port'],
  ['user:pass@evil.example', 'userinfo'],
  ['https://good.example@evil.example/', 'userinfo'],
  ['127.0.0.1', 'ip_address'],
  ['[::1]', 'ip_address'],
  ['fe80::1', 'ip_address'],
  ['localhost', 'single_label'],
  ['printer.local', 'reserved'],
  ['db.internal', 'reserved'],
  ['x.localhost', 'reserved'],
  ['q.trycloudflare.com', 'reserved'],
  ['u.cfargotunnel.com', 'reserved'],
  ['аpple.example', 'mixed_script'],
  ['xn--a.example', 'bad_punycode'],
  ['💩.example', 'bad_punycode'],
  ['-bad.example', 'bad_label'],
  ['bad-.example', 'bad_label'],
  ['ab--cd.example', 'bad_label'],
  ['under_score.example', 'bad_label'],
  ['a..example', 'bad_label'],
  [`${'a'.repeat(64)}.example`, 'label_too_long'],
  [`${'abcdefghij.'.repeat(24)}example`, 'too_long'],
  ['ftp://evil.example', 'bad_scheme'],
  ['javascript://evil.example', 'bad_scheme'],
  ['a%2eexample.com', 'bad_chars'],
  ['a.example;rm -rf', 'bad_chars'],
  ['', 'empty'],
];
for (const [raw, reason] of hostile) {
  const r = parseHostname(raw);
  check(`رد: ${JSON.stringify(raw).slice(0, 48)} ⇒ ${reason}`, !r.ok && r.error === 'invalid_hostname' && r.reason === reason, JSON.stringify(r));
}
check('رد: نوعِ غیرِ رشته', !parseHostname(42).ok && !parseHostname(null).ok && !parseHostname(['a.example']).ok);
const good = [
  ['https://Shop.Example.com/', 'shop.example.com'],
  ['shop.example.com.', 'shop.example.com'],
  ['  shop.example.com  ', 'shop.example.com'],
  ['فروشگاه.example.com', 'xn--mgbtj4c7ad63e.example.com'],
  ['日本語.jp', 'xn--wgv71a119e.jp'],
  ['shop.multi-test.example', 'shop.multi-test.example'],
];
for (const [raw, want] of good) {
  const r = parseHostname(raw);
  check(`پذیرفته: ${JSON.stringify(raw)} ⇒ ${want}`, r.ok && r.hostname === want, JSON.stringify(r));
}
check('یونیکد ⇒ نمای خواندنی هم برمی‌گردد (idn)', parseHostname('فروشگاه.example.com').display === 'فروشگاه.example.com' && parseHostname('فروشگاه.example.com').idn === true);

/* ══════════════ ۲) یک پنلِ واقعی ══════════════ */
const ACCT = path.join(tmp, 'acct');
fs.mkdirSync(path.join(ACCT, 'src'), { recursive: true });
fs.mkdirSync(path.join(ACCT, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(ACCT, 'package.json'), JSON.stringify({ name: 'fake-account', version: '9.9.9', type: 'module' }));
fs.writeFileSync(path.join(ACCT, 'src', 'index.js'), `
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const dir = String(process.env.DATABASE_URL || '').replace(/^pglite:/, '');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'public-urls'), process.env.PUBLIC_BASE_URLS ?? '<none>');
fs.appendFileSync(path.join(dir, 'starts'), process.pid + '\\n');
http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, status: 'ok', publicBaseUrls: String(process.env.PUBLIC_BASE_URLS || '').split(',').filter(Boolean) })); })
  .listen(Number(process.env.PORT), process.env.HOST || '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
`);

const P_PORT = BASE_PORT;
const PUBLIC_PORT = BASE_PORT + 1;
const ACCT_PORT = BASE_PORT + 3;
const SITE_PORT = BASE_PORT + 10;
const DATA = path.join(tmp, 'p', 'data');
const CF = path.join(DATA, 'cloudflared');
const CF_STATE = path.join(tmp, 'fake-cf-state.json');
const UUID = 'c0c0c0c0-1111-2222-3333-444444444444';
const ENV = {
  HLP_ACCOUNT_AUTOSTART: '1', HLP_ACCOUNT_API: `http://127.0.0.1:${ACCT_PORT}`, FAKE_CF_STATE: CF_STATE,
};

async function boot(port, dataDir, env = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const sitesRoot = path.join(path.dirname(dataDir), 'sites');
  fs.mkdirSync(sitesRoot, { recursive: true });
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SERVER_DIR, 'src', 'index.js')], {
    env: {
      ...process.env, HLP_PORT: String(port), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: sitesRoot,
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0', HLP_AUTOMATION: '0',
      HLP_SITESYNC_PORT: String(port + 1), HLP_DISCOVERY_PORT: String(port + 2), HLP_RATE_LOGIN: '1000', HLP_AUTH_RATE_LIMIT: '100000',
      HLP_ACCOUNT_DIR: ACCT, HLP_UPDATE_AUTO: '0', HLP_PROTECTED_DOMAINS: 'public-site.example',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const BASE = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 160 && !up; i++) {
    try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* هنوز */ }
    if (!up) await wait(250);
  }
  const call = async (method, url, body, token, headers = {}) => {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    const r = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await r.json(); } catch { /* */ }
    return { status: r.status, json };
  };
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise((r) => { child.once('exit', r); setTimeout(r, 10000); });
  };
  return { up, out: () => out, call, stop, BASE, port, dataDir, sitesRoot };
}

const dbRun = (sql, ...args) => {
  const d = new DatabaseSync(path.join(DATA, 'panel.db'));
  try { d.exec('PRAGMA busy_timeout = 3000'); return d.prepare(sql).run(...args); } finally { d.close(); }
};
const readDb = (sql, ...args) => {
  const d = new DatabaseSync(path.join(DATA, 'panel.db'), { readOnly: true });
  try { d.exec('PRAGMA busy_timeout = 3000'); return d.prepare(sql).all(...args); } finally { d.close(); }
};
const setSettings = (kv) => {
  for (const [k, v] of Object.entries(kv)) dbRun('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(v));
};
const cfg = () => { try { return fs.readFileSync(path.join(CF, 'config.yml'), 'utf8'); } catch { return ''; } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const routesTo = (text, host, port) => new RegExp(`hostname: ${host.replace(/\./g, '\\.')}\\s*\\n\\s*service: http://127\\.0\\.0\\.1:${port}\\b`).test(text);
const inIngress = (text, host) => new RegExp(`hostname: ${host.replace(/\./g, '\\.')}\\s*\\n`).test(text);
const cfState = () => { try { return JSON.parse(fs.readFileSync(CF_STATE, 'utf8')); } catch { return {}; } };
const setCf = (patch) => fs.writeFileSync(CF_STATE, JSON.stringify({ ...cfState(), ...patch }, null, 2));
const acctDir = path.join(DATA, 'account-server', 'pg');
const envUrls = () => { try { return fs.readFileSync(path.join(acctDir, 'public-urls'), 'utf8'); } catch { return null; } };
const starts = () => { try { return fs.readFileSync(path.join(acctDir, 'starts'), 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } };
const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); resolve(true); });
  s.once('error', () => resolve(false));
  s.setTimeout(1000, () => { s.destroy(); resolve(false); });
});
async function until(fn, ms = 15000, step = 200) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    await wait(step);
  }
  return v;
}
const auditRows = (action) => readDb('SELECT action, ok, target, detail FROM audit_log WHERE action = ? ORDER BY id', action);

const H = (n) => `${n}.multi-test.example`;
const pw = { owner: 'Owner-Pass-2026', admin2: 'Admin2-Pass-2026', op: 'Operator-Pass-2026' };
let P = null;
try {
  console.log('── یک پنل با تونلِ نام‌دارِ ساختگی و سرورِ حسابِ ساختگی ──');
  P = await boot(P_PORT, DATA, ENV);
  let owner = (await P.call('POST', '/api/auth/setup', { username: 'owner', password: pw.owner })).json?.token;
  await P.call('POST', '/api/auth/users', { username: 'admin2', password: pw.admin2, role: 'admin' }, owner);
  await P.call('POST', '/api/auth/users', { username: 'operator1', password: pw.op, role: 'operator' }, owner);
  await P.call('PUT', '/api/settings', { siteAutoSetup: false }, owner);
  await P.stop();
  fs.mkdirSync(path.join(DATA, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'bin', 'cloudflared'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(SERVER_DIR, 'test', 'fake-cloudflared.mjs')}" "$@"\n`);
  fs.chmodSync(path.join(DATA, 'bin', 'cloudflared'), 0o755);
  fs.mkdirSync(CF, { recursive: true });
  fs.writeFileSync(path.join(CF, 'cert.pem'), 'fake-origin-cert');
  fs.writeFileSync(path.join(CF, `${UUID}.json`), JSON.stringify({ TunnelID: UUID }));
  fs.writeFileSync(path.join(CF, 'config.yml'), [`tunnel: ${UUID}`, `credentials-file: ${path.join(CF, `${UUID}.json`)}`, 'ingress:',
    `  - hostname: ${H('main')}`, `    service: http://127.0.0.1:${PUBLIC_PORT}`, '  - service: http_status:404', ''].join('\n'));
  fs.writeFileSync(CF_STATE, JSON.stringify({ tunnels: [{ uuid: UUID, name: 'md-tunnel' }], dns: [] }));
  setSettings({ tunnel_mode: 'named', tunnel_name: 'md-tunnel', tunnel_hostname: H('main'), tunnel_routed_dns: [H('main')] });
  P = await boot(P_PORT, DATA, ENV);
  owner = (await P.call('POST', '/api/auth/login', { username: 'owner', password: pw.owner })).json?.token;
  const admin2 = (await P.call('POST', '/api/auth/login', { username: 'admin2', password: pw.admin2 })).json?.token;
  const op = (await P.call('POST', '/api/auth/login', { username: 'operator1', password: pw.op })).json?.token;
  check('پنل با تونلِ نام‌دار بالا آمد؛ مالک، مدیرِ دوم، کارگزار', P.up && Boolean(owner && admin2 && op), P.out().slice(-400));
  check('سرورِ حسابِ ساختگی روشن است (بی نامی: PUBLIC_BASE_URLS نیست)', await until(() => envUrls() === '<none>'), envUrls());

  /* ── فقط مالک + احرازِ دوباره ── */
  console.log('── فقط مالک، احرازِ دوباره، دفتر ──');
  let r = await P.call('GET', '/api/app-domains');
  check('بی ورود ⇒ ۴۰۱', r.status === 401, r.status);
  r = await P.call('GET', '/api/app-domains', undefined, op);
  check('کارگزار ⇒ ۴۰۳', r.status === 403, JSON.stringify(r.json));
  r = await P.call('GET', '/api/app-domains', undefined, admin2);
  check('مدیرِ دوم ⇒ ۴۰۳ owner_only', r.status === 403 && r.json?.error === 'owner_only', JSON.stringify(r.json));
  r = await P.call('POST', '/api/app-domains', { app: 'account-server', hostname: H('steal') }, admin2);
  check('مدیرِ دوم نام نمی‌افزاید ⇒ ۴۰۳ owner_only (پیش از رمز)', r.status === 403 && r.json?.error === 'owner_only', JSON.stringify(r.json));
  r = await P.call('POST', '/api/app-domains', { app: 'account-server', hostname: H('steal') }, op);
  check('کارگزار نام نمی‌افزاید ⇒ ۴۰۳', r.status === 403);
  const lk = fs.readFileSync(path.join(DATA, 'local-admin.key'), 'utf8').trim();
  r = await P.call('POST', '/api/app-domains', { app: 'account-server', hostname: H('steal') }, null, { 'x-local-key': lk });
  check('کلیدِ محلی این در را ندارد ⇒ ۴۰۱/۴۰۳', r.status === 401 || r.status === 403, r.status);
  check('دفتر: ردِ «فقط مالک» ثبت شد', auditRows('panel.domains.owner_only').length >= 1);
  check('… و هیچ نامی ننشست', readDb('SELECT COUNT(*) AS n FROM app_hostnames')[0].n === 0);
  r = await P.call('GET', '/api/app-domains', undefined, owner);
  check('مالک فهرست را می‌بیند: سرورِ حساب، پمپ‌ها (فقط داده)', r.status === 200 && r.json.apps.some((a) => a.app === 'account-server') && r.json.apps.some((a) => a.app === 'stations' && a.dataOnly), JSON.stringify(r.json).slice(0, 300));
  check('… حالتِ تونل: نام‌دار و خودکار', r.json?.route?.mode === 'named' && r.json.route.auto === true, JSON.stringify(r.json?.route));
  dbRun('UPDATE sessions SET auth_at = 1 WHERE user_id = (SELECT id FROM users WHERE username = ?)', 'owner');
  r = await P.call('POST', '/api/app-domains', { app: 'account-server', hostname: H('acct') }, owner);
  check('مالکِ بی احرازِ دوباره ⇒ ۴۰۳ reauth_required', r.status === 403 && r.json?.error === 'reauth_required', JSON.stringify(r.json));
  r = await P.call('POST', '/api/auth/reauth', { password: pw.owner }, owner);
  check('احرازِ دوباره', r.status === 200, JSON.stringify(r.json));

  /* ── سایت با چند نام ── */
  console.log('── سایت با چند نام: همه در ingress، DNS ِ همه، نامِ اصلی ──');
  const siteDir = path.join(P.sitesRoot, 'shop');
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'server.js'), `require('node:http').createServer((q, s) => s.end('shop')).listen(Number(process.env.PORT), '127.0.0.1');`);
  const mk = await P.call('POST', '/api/sites', { path: siteDir, name: 'Shop', kind: 'node', startCommand: 'node server.js', port: SITE_PORT, domain: H('shop') }, owner);
  const site = mk.json?.site;
  check('سایت با نامِ اصلی ساخته شد', mk.status === 200 && site?.domain === H('shop'), JSON.stringify(mk.json).slice(0, 300));
  const app = `site:${site?.slug}`;
  r = await P.call('POST', '/api/app-domains', { app, hostname: `https://WWW.${H('shop')}/` }, owner);
  check('نامِ دوم (از نوارِ مرورگر) ⇒ ۲۰۰', r.status === 200 && r.json?.hostname === `www.${H('shop')}`, JSON.stringify(r.json));
  r = await P.call('POST', '/api/app-domains', { app, hostname: H('shop-alt') }, owner);
  check('نامِ سوم ⇒ ۲۰۰ و گامِ مسیر «خودکار»', r.status === 200 && r.json?.route?.steps?.[0]?.how === 'auto', JSON.stringify(r.json?.route));
  r = await P.call('POST', '/api/app-domains', { app, hostname: `فروشگاه.multi-test.example` }, owner);
  const faHost = r.json?.hostname;
  check('نامِ فارسی ⇒ punycode در دیتابیس، نمای فارسی در پاسخ', r.status === 200 && /^xn--/.test(faHost || '') && r.json?.display === 'فروشگاه.multi-test.example', JSON.stringify(r.json));
  const allShop = [H('shop'), `www.${H('shop')}`, H('shop-alt'), faHost];
  let text = cfg();
  check('ingress: هر چهار نام ⇒ پورتِ سایت', allShop.every((h) => routesTo(text, h, SITE_PORT)), text);
  check('… و نامِ اصلیِ تونل سرِ جایش', routesTo(text, H('main'), PUBLIC_PORT));
  check('DNS ِ ساختگی: هر نامِ تازه با ‎--overwrite-dns‎', allShop.slice(1).every((h) => (cfState().dns || []).includes(h)), JSON.stringify(cfState().dns));
  r = await P.call('PUT', '/api/app-domains/primary', { app, hostname: H('shop-alt') }, owner);
  const sRow = readDb('SELECT domain FROM sites WHERE id = ?', site.id)[0];
  check('نامِ اصلی عوض شد (sites.domain)', r.status === 200 && r.json?.app?.primary === H('shop-alt') && sRow?.domain === H('shop-alt'), JSON.stringify(r.json?.app));
  r = await P.call('GET', '/api/app-domains', undefined, owner);
  const shopView = r.json?.apps?.find((a) => a.app === app);
  check('فهرست: چهار نام، اصلی اول', shopView?.hostnames?.length === 4 && shopView.hostnames[0].hostname === H('shop-alt') && shopView.hostnames[0].primary, JSON.stringify(shopView));

  /* ── خصمانه از راهِ در ── */
  console.log('── نامِ خصمانه از راهِ در ⇒ ۴۰۰، هیچ چیز عوض نمی‌شود ──');
  const before = sha(cfg());
  const rowsBefore = readDb('SELECT COUNT(*) AS n FROM domains')[0].n + readDb('SELECT COUNT(*) AS n FROM app_hostnames')[0].n;
  let allBad = true;
  for (const bad of ['*.multi-test.example', `x.multi-test.example\n  - hostname: evil.example\n    service: http://127.0.0.1:22`, 'evil.example:2222', 'u@evil.example', '10.0.0.1', 'nas.local', 'аpple.multi-test.example', 'xn--a.multi-test.example']) {
    const x = await P.call('POST', '/api/app-domains', { app, hostname: bad }, owner);
    if (!(x.status === 400 && x.json?.error === 'invalid_hostname' && x.json?.reason)) { allBad = false; console.log('     ', JSON.stringify(bad), x.status, JSON.stringify(x.json)); }
  }
  check('هشت نامِ خصمانه ⇒ ۴۰۰ invalid_hostname با دلیل', allBad);
  r = await P.call('POST', `/api/sites/${site.id}/domains`, { domain: '*.multi-test.example' }, owner);
  check('… از درِ قدیمیِ سایت هم ⇒ ۴۰۰ invalid_domain', r.status === 400 && r.json?.error === 'invalid_domain', JSON.stringify(r.json));
  r = await P.call('POST', '/api/domains', { name: 'evil.example\n- hostname: x.example' }, owner);
  check('… و از درِ «دامنه‌ها» ⇒ ۴۰۰', r.status === 400, JSON.stringify(r.json));
  check('… config.yml همان بایت‌ها، ردیفی اضافه نشد', sha(cfg()) === before && readDb('SELECT COUNT(*) AS n FROM domains')[0].n + readDb('SELECT COUNT(*) AS n FROM app_hostnames')[0].n === rowsBefore);
  check('… هیچ «evil» در config.yml', !/evil/.test(cfg()));

  /* ── یک نام، یک صاحب ── */
  console.log('── تکراری و مالِ برنامهٔ دیگر ⇒ ۴۰۹ (نه ربودن) ──');
  r = await P.call('POST', '/api/app-domains', { app: 'account-server', hostname: `www.${H('shop')}` }, owner);
  check('نامِ سایت برای سرورِ حساب ⇒ ۴۰۹ hostname_taken با نامِ صاحب', r.status === 409 && r.json?.error === 'hostname_taken' && /Shop/.test(r.json?.message || ''), JSON.stringify(r.json));
  r = await P.call('POST', '/api/app-domains', { app, hostname: `www.${H('shop')}` }, owner);
  check('همان نام دوباره برای همان سایت ⇒ ۴۰۹ already_attached', r.status === 409 && r.json?.error === 'already_attached');
  r = await P.call('POST', '/api/app-domains', { app, hostname: H('main') }, owner);
  check('نشانیِ اصلیِ تونل برای سایت ⇒ ۴۰۹', r.status === 409 && r.json?.error === 'hostname_taken', JSON.stringify(r.json));
  const blogDir = path.join(P.sitesRoot, 'blog');
  fs.mkdirSync(blogDir, { recursive: true });
  fs.writeFileSync(path.join(blogDir, 'index.html'), 'blog');
  const blog = (await P.call('POST', '/api/sites', { path: blogDir, name: 'Blog', kind: 'static', port: SITE_PORT + 1 }, owner)).json?.site;
  r = await P.call('POST', `/api/sites/${blog?.id}/domains`, { domain: H('shop') }, owner);
  check('درِ قدیمیِ سایت: نامِ سایتِ دیگر ⇒ ۴۰۹ domain_taken (پیش‌تر بی‌صدا ربوده می‌شد)', r.status === 409 && r.json?.error === 'domain_taken', JSON.stringify(r.json));
  r = await P.call('PUT', `/api/sites/${blog?.id}`, { domain: `www.${H('shop')}` }, owner);
  check('PUT ِ سایت با نامِ سایتِ دیگر ⇒ ۴۰۹', r.status === 409, JSON.stringify(r.json));
  r = await P.call('POST', '/api/domains', { name: H('shop'), siteId: blog?.id }, owner);
  check('درِ «دامنه‌ها» با نامِ ثبت‌شده ⇒ ۴۰۹', r.status === 409, JSON.stringify(r.json));
  r = await P.call('POST', '/api/site-server/tunnel/hostname', { hostname: H('shop-alt'), port: 22 }, owner);
  check('زیردامنهٔ دستیِ تونل با نامِ یک سایت (پورتِ دیگر) ⇒ ۴۰۹', r.status === 409 && r.json?.error === 'hostname_taken', JSON.stringify(r.json));
  const owners = readDb('SELECT d.name, s.slug FROM domains d JOIN sites s ON s.id = d.site_id WHERE d.name IN (?, ?)', H('shop'), `www.${H('shop')}`);
  check('… هر دو نام هنوز مالِ Shop', owners.length === 2 && owners.every((o) => o.slug === site.slug), JSON.stringify(owners));
  const race = await Promise.all([
    P.call('POST', '/api/app-domains', { app: 'stations', hostname: H('race') }, owner),
    P.call('POST', '/api/app-domains', { app: 'account-server', hostname: H('race') }, owner),
    P.call('POST', '/api/app-domains', { app: `site:${blog?.slug}`, hostname: H('race') }, owner),
  ]);
  check('سه درخواستِ هم‌زمان برای یک نام ⇒ فقط یکی ۲۰۰، بقیه ۴۰۹', race.filter((x) => x.status === 200).length === 1 && race.filter((x) => x.status === 409).length === 2, race.map((x) => x.status).join(','));
  check('… و فقط یک صاحب در دیتابیس', readDb('SELECT COUNT(*) AS n FROM domains WHERE name = ? AND site_id IS NOT NULL', H('race'))[0].n + readDb('SELECT COUNT(*) AS n FROM app_hostnames WHERE hostname = ?', H('race'))[0].n === 1);
  //  برنده هر که بود، نام برداشته می‌شود تا بقیهٔ آزمون از حالِ معلوم برود (هیچ‌کدام روشن نیست)
  const raceOwner = readDb('SELECT app_id FROM app_hostnames WHERE hostname = ?', H('race'))[0]?.app_id || `site:${blog?.slug}`;
  r = await P.call('DELETE', '/api/app-domains', { app: raceOwner, hostname: H('race') }, owner);
  check('… برنده نامش را برمی‌دارد (برنامهٔ خاموش)', r.status === 200, JSON.stringify(r.json));
  let trig = null;
  try { dbRun('INSERT INTO app_hostnames(app_id, hostname, is_primary, created_at) VALUES (?, ?, 0, ?)', 'stations', H('shop'), Date.now()); } catch (e) { trig = e.message; }
  check('نگهبانِ SQLite: نوشتنِ مستقیمِ نامِ سایت در app_hostnames ⇒ hostname_taken', /hostname_taken/.test(trig || ''), trig);

  /* ── سرورِ حساب: ingress و PUBLIC_BASE_URLS ── */
  console.log('── نام‌های سرورِ حساب ⇒ پورتِ عمومی و PUBLIC_BASE_URLS ِ فرزند (بی ساختِ دوباره) ──');
  const s0 = starts();
  r = await P.call('POST', '/api/app-domains', { app: 'account-server', hostname: H('api-shop'), primary: true }, owner);
  check('نامِ اصلیِ سرورِ حساب ⇒ ۲۰۰، فرزند دوباره بالا می‌آید', r.status === 200 && r.json?.accountRestarted === true, JSON.stringify(r.json).slice(0, 300));
  check('… PUBLIC_BASE_URLS ِ فرزند = همان نام', await until(() => envUrls() === `https://${H('api-shop')}`, 15000), envUrls());
  r = await P.call('POST', '/api/app-domains', { app: 'account-server', hostname: 'api.other-test.example' }, owner);
  check('نامِ دوم ⇒ هر دو در PUBLIC_BASE_URLS، اصلی اول', r.status === 200 && await until(() => envUrls() === `https://${H('api-shop')},https://api.other-test.example`, 15000), envUrls());
  check('… فرزند دو بار دوباره بالا آمد (هر تغییر یک بار)', starts() === s0 + 2, `${s0} ⇒ ${starts()}`);
  const probe = await until(async () => (await fetch(`http://127.0.0.1:${ACCT_PORT}/`)).json(), 10000);
  check('… و همان را به برنامه‌ها می‌گوید (config/server ِ ساختگی)', probe?.publicBaseUrls?.join(',') === `https://${H('api-shop')},https://api.other-test.example`, JSON.stringify(probe));
  text = cfg();
  check('ingress: هر دو نامِ سرورِ حساب ⇒ پورتِ عمومی', routesTo(text, H('api-shop'), PUBLIC_PORT) && routesTo(text, 'api.other-test.example', PUBLIC_PORT), text);
  r = await P.call('GET', '/api/app-domains', undefined, owner);
  check('فهرست: publicBaseUrls همان، بی هیچ راز', r.json?.publicBaseUrls?.join(',') === `https://${H('api-shop')},https://api.other-test.example`
    && !/secret|password|token|credentials|cert/i.test(JSON.stringify(r.json)), JSON.stringify(r.json).slice(0, 400));
  r = await P.call('PUT', '/api/app-domains/primary', { app: 'account-server', hostname: 'api.other-test.example' }, owner);
  check('نامِ اصلیِ تازه ⇒ ترتیبِ PUBLIC_BASE_URLS عوض', r.status === 200 && await until(() => envUrls() === `https://api.other-test.example,https://${H('api-shop')}`, 15000), envUrls());
  check('… config.yml رازی ندارد جز مسیرِ فایلِ اعتبار (همان قبلی)', !/Owner-Pass|ADMIN_BOOTSTRAP|API_SECRET|JWT_SECRET/.test(cfg()));

  /* ── پمپ‌ها: فقط داده ── */
  console.log('── پمپ‌ها (تانک‌تیل) فقط داده: نام ⇒ پورتِ عمومی ──');
  r = await P.call('POST', '/api/app-domains', { app: 'stations', hostname: H('pumps') }, owner);
  check('نامِ پمپ‌ها ⇒ ۲۰۰ و اصلی', r.status === 200 && r.json?.app?.primary === H('pumps'), JSON.stringify(r.json?.app));
  check('… ingress ⇒ پورتِ عمومی', routesTo(cfg(), H('pumps'), PUBLIC_PORT), cfg());
  const pump = await fetch(`${P.BASE}/api/stations/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'pump-md-1', name: 'پمپ یک' }) });
  check('یک پمپ ثبت شد (پمپ‌ها «روشن»)', pump.status === 200, String(pump.status));
  r = await P.call('DELETE', '/api/app-domains', { app: 'stations', hostname: H('pumps') }, owner);
  check('⛔ آخرین نامِ پمپ‌های روشن ⇒ ۴۰۹ last_hostname_running', r.status === 409 && r.json?.error === 'last_hostname_running', JSON.stringify(r.json));

  /* ── آخرین نامِ برنامهٔ روشن ── */
  console.log('── آخرین نامِ برنامهٔ روشن ⇒ رد، از هر دری ──');
  r = await P.call('POST', `/api/sites/${site.id}/start`, {}, owner);
  const up = await until(() => portOpen(SITE_PORT));
  check('سایت روشن شد', r.status === 200 && up, JSON.stringify(r.json).slice(0, 200));
  for (const h of [`www.${H('shop')}`, faHost, H('shop')]) {
    const x = await P.call('DELETE', '/api/app-domains', { app, hostname: h }, owner);
    if (x.status !== 200) console.log('     ', h, x.status, JSON.stringify(x.json));
  }
  r = await P.call('GET', '/api/app-domains', undefined, owner);
  check('سه نام برداشته شد، یکی ماند (و اصلی شد)', r.json?.apps?.find((a) => a.app === app)?.hostnames?.map((h) => h.hostname).join(',') === H('shop-alt'));
  check('… برداشته‌ها از ingress رفتند', !inIngress(cfg(), `www.${H('shop')}`) && !inIngress(cfg(), H('shop')));
  r = await P.call('DELETE', '/api/app-domains', { app, hostname: H('shop-alt') }, owner);
  check('⛔ آخرین نامِ سایتِ روشن ⇒ ۴۰۹ last_hostname_running', r.status === 409 && r.json?.error === 'last_hostname_running', JSON.stringify(r.json));
  r = await P.call('DELETE', `/api/sites/${site.id}/domains?domain=${H('shop-alt')}`, undefined, owner);
  check('⛔ … از درِ قدیمیِ سایت هم ⇒ ۴۰۹', r.status === 409 && r.json?.error === 'last_hostname_running', JSON.stringify(r.json));
  r = await P.call('PUT', `/api/sites/${site.id}`, { domain: '' }, owner);
  check('⛔ … با PUT ِ «بی دامنه» هم ⇒ ۴۰۹', r.status === 409, JSON.stringify(r.json));
  const dRow = readDb('SELECT id FROM domains WHERE name = ?', H('shop-alt'))[0];
  r = await P.call('DELETE', `/api/domains/${dRow?.id}`, undefined, owner);
  check('⛔ … با حذف از «دامنه‌ها» هم ⇒ ۴۰۹', r.status === 409, JSON.stringify(r.json));
  r = await P.call('PUT', `/api/domains/${dRow?.id}`, { siteId: blog?.id }, owner);
  check('⛔ … با بردن به سایتِ دیگر هم ⇒ ۴۰۹', r.status === 409, JSON.stringify(r.json));
  check('… نام هنوز مالِ سایت و در ingress', readDb('SELECT s.slug FROM domains d JOIN sites s ON s.id = d.site_id WHERE d.name = ?', H('shop-alt'))[0]?.slug === site.slug && routesTo(cfg(), H('shop-alt'), SITE_PORT));
  await P.call('DELETE', '/api/app-domains', { app: 'account-server', hostname: H('api-shop') }, owner);
  r = await P.call('DELETE', '/api/app-domains', { app: 'account-server', hostname: 'api.other-test.example' }, owner);
  check('⛔ آخرین نامِ سرورِ حسابِ روشن ⇒ ۴۰۹', r.status === 409 && r.json?.error === 'last_hostname_running', JSON.stringify(r.json));
  await P.call('POST', `/api/sites/${site.id}/stop`, {}, owner);
  await until(async () => !(await portOpen(SITE_PORT)));
  r = await P.call('DELETE', '/api/app-domains', { app, hostname: H('shop-alt') }, owner);
  check('سایتِ خاموش ⇒ آخرین نام برداشته می‌شود', r.status === 200, JSON.stringify(r.json));
  await P.call('POST', '/api/app-domains', { app, hostname: H('shop') }, owner);

  /* ── برگشت ── */
  console.log('── نوشتنِ ناموفقِ ingress ⇒ برگشتِ کامل ──');
  await until(() => envUrls() === 'https://api.other-test.example' && !/restarting/.test('x'), 15000);
  await wait(500);
  const snapCfg = cfg();
  const snapRows = JSON.stringify(readDb('SELECT name, site_id FROM domains ORDER BY name')) + JSON.stringify(readDb('SELECT app_id, hostname, is_primary FROM app_hostnames ORDER BY hostname'));
  const startsBefore = starts();
  fs.mkdirSync(path.join(CF, 'config.yml.next')); //  جای فایلِ کناری یک پوشه ⇒ نوشتن شکست می‌خورد (مثلِ دیسکِ پر/دسترسی)
  r = await P.call('POST', '/api/app-domains', { app: `site:${blog?.slug}`, hostname: H('fail-write') }, owner);
  check('افزودن ⇒ ۵۰۲ route_write_failed، rolledBack', r.status === 502 && r.json?.error === 'route_write_failed' && r.json?.rolledBack === true, JSON.stringify(r.json));
  r = await P.call('POST', '/api/app-domains', { app: 'account-server', hostname: H('fail-write2') }, owner);
  check('… برای سرورِ حساب هم', r.status === 502 && r.json?.rolledBack === true, JSON.stringify(r.json));
  r = await P.call('DELETE', '/api/app-domains', { app: 'stations', hostname: H('pumps') }, owner);
  check('… (و برداشتن هم: آخرین نامِ پمپ‌ها همچنان ۴۰۹ پیش از هر نوشتن)', r.status === 409);
  check('… config.yml همان بایت‌ها', cfg() === snapCfg);
  check('… دیتابیس همان (دامنه‌ها و app_hostnames)', JSON.stringify(readDb('SELECT name, site_id FROM domains ORDER BY name')) + JSON.stringify(readDb('SELECT app_id, hostname, is_primary FROM app_hostnames ORDER BY hostname')) === snapRows);
  check('… سرورِ حساب دوباره بالا نیامد', starts() === startsBefore);
  fs.rmSync(path.join(CF, 'config.yml.next'), { recursive: true, force: true });

  console.log('── DNS ِ ناموفقِ همان نام ⇒ برگشتِ کامل، تونل دوباره راه نمی‌افتد ──');
  setCf({ failDns: [H('fail-dns')] });
  r = await P.call('POST', '/api/app-domains', { app: 'account-server', hostname: H('fail-dns') }, owner);
  check('افزودن ⇒ ۵۰۲ با نامِ ناموفق', r.status === 502 && r.json?.failures?.some((f) => f.hostname === H('fail-dns')), JSON.stringify(r.json));
  check('… config.yml همان بایت‌ها (نامِ ناموفق در ingress نماند)', cfg() === snapCfg && !inIngress(cfg(), H('fail-dns')));
  check('… دیتابیس همان', JSON.stringify(readDb('SELECT name, site_id FROM domains ORDER BY name')) + JSON.stringify(readDb('SELECT app_id, hostname, is_primary FROM app_hostnames ORDER BY hostname')) === snapRows);
  check('… PUBLIC_BASE_URLS ِ فرزند همان و دوباره بالا نیامد', starts() === startsBefore && envUrls() === 'https://api.other-test.example', envUrls());
  setCf({ failDns: [] });
  r = await P.call('POST', '/api/app-domains', { app: 'account-server', hostname: H('fail-dns') }, owner);
  check('DNS درست شد ⇒ همان نام ⇒ ۲۰۰', r.status === 200 && routesTo(cfg(), H('fail-dns'), PUBLIC_PORT), JSON.stringify(r.json));

  /* ── دفتر ── */
  console.log('── دفتر ──');
  const adds = auditRows('panel.domains.add');
  check('دفتر: افزودن‌های موفق و ناموفق (با دلیل)', adds.some((a) => a.ok === 1) && adds.some((a) => a.ok === 0 && /route_write_failed/.test(a.detail || '')) && adds.some((a) => a.ok === 0 && /hostname_taken/.test(a.detail || '')), JSON.stringify(adds.slice(-4)));
  check('دفتر: برداشتن‌ها و نامِ اصلی', auditRows('panel.domains.remove').some((a) => a.ok === 1) && auditRows('panel.domains.remove').some((a) => a.ok === 0) && auditRows('panel.domains.primary').some((a) => a.ok === 1));
  check('دفتر: نام و برنامه در هدف (مثلاً ‎account-server …‎)', adds.some((a) => a.target === `account-server ${H('api-shop')}`), JSON.stringify(adds.map((a) => a.target)));
  const allAudit = JSON.stringify(readDb('SELECT * FROM audit_log'));
  check('دفتر هیچ رمزی ندارد', !allAudit.includes(pw.owner) && !allAudit.includes(pw.admin2));
  check('لاگِ پنل هیچ رمزی ندارد', !P.out().includes(pw.owner));
} catch (e) {
  check('بی خطای پیش‌بینی‌نشده', false, e.stack);
} finally {
  await P?.stop();
  if (failed && process.env.KEEP_LOGS) fs.writeFileSync(path.join(os.tmpdir(), 'app-domains-P.log'), P?.out() || '');
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} دامنه‌های هر برنامه: ${passed} سبز، ${failed} قرمز`);
process.exit(failed ? 1 : 0);
