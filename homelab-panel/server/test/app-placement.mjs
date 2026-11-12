// ---------------------------------------------------------------------------
//  آزمونِ «این برنامه/سایت روی کدام سرور» (۱.۵۰.۹۵، گامِ ۳ ِ docs/MULTI-SERVER-fa.md)
//      node test/app-placement.mjs
//
//  سه پنلِ واقعیِ هم‌زمان روی همین کامپیوتر با پورت و پوشهٔ دادهٔ جدا — مرکز (C)، گرهٔ ۱ (N1) و گرهٔ ۲ (N2)، هر کدام با
//  سرورِ حسابِ ساختگیِ همان قراردادِ supervisor؛ N2 تونلِ نام‌دارِ ساختگی (‎test/fake-cloudflared.mjs‎) دارد — و یک
//  «گرهٔ ساختگی» (T) که خودِ آزمون است و فقط قراردادِ پیام‌ها را حرف می‌زند. همه از راهِ HTTP، مثلِ صاحب‌کار:
//    • قراردادِ «عوض شدنِ مسیر» (route-plan.js) با ورودیِ ساختگی: خودکار/CNAME/Public Hostname/A/بی‌نام
//    • جدولِ جا: پیش‌فرض همان که رویش روشن است؛ پمپ «فقط با پنلِ بسته از CLI»
//    • فقط مالک (مدیرِ دوم ۴۰۳ پیش از رمز)، بی احرازِ دوباره رد، تأییدِ نادرست رد، پمپ رد
//    • مقصدی که بسته را رد کند (T) ⇒ مبدأ دوباره روشن، جدول بی تغییر؛ دو کارِ هم‌زمان روی یک برنامه ⇒ دومی رد؛
//      نگه‌داریِ سرورِ درگیر در میانهٔ کار رد
//    • جابه‌جاییِ یک سایت N1 ⇒ N2 از راهِ مرکز: جدولِ جا عوض، داده در مقصد همان هش، مبدأ ایستاده و کنار (پاک نه)،
//      روشن کردنش روی مبدأ رد، مسیر به تونلِ N2 (‎cloudflared tunnel route dns --overwrite-dns‎ ِ ساختگی) خودکار
//    • برگشتِ N2 ⇒ N1 که مقصد ردش کند (دامنهٔ مالِ سایتِ دیگر) ⇒ N2 دوباره روشن، جدول بی تغییر
//    • سرورِ حساب N1 ⇒ N2 (کامل)؛ گرهٔ در نگه‌داری/آفلاین ⇒ رد
//    • هیچ کلیدِ بسته‌ای (که T به‌عنوانِ مقصد گرفت) در دیتابیس، دفتر، لاگ یا پاسخِ مالک نیست
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generateKeys, signEnvelope, readEnvelope, verifyEnvelope, ephemeralKey, unwrapSecret } from '../src/fleet/crypto.js';
import { planRoute } from '../src/fleet/route-plan.js';
import { inspectBundle } from '../scripts/move-server.mjs';

const BASE_PORT = Number(process.env.TEST_PORT || 5355);
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 600) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-app-placement-'));
const SERVER_DIR = path.join(import.meta.dirname, '..');

/* ───────── سرورِ حسابِ ساختگی (همان قراردادِ supervisor، مثلِ my-servers) ───────── */
const ACCT = path.join(tmp, 'acct');
fs.mkdirSync(path.join(ACCT, 'src'), { recursive: true });
fs.mkdirSync(path.join(ACCT, 'node_modules'), { recursive: true });
fs.writeFileSync(path.join(ACCT, 'package.json'), JSON.stringify({ name: 'fake-account', version: '9.9.9', type: 'module' }));
fs.writeFileSync(path.join(ACCT, 'src', 'index.js'), `
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const dir = String(process.env.DATABASE_URL || '').replace(/^pglite:/, '');
fs.mkdirSync(dir, { recursive: true });
let n = 0;
const beat = () => fs.writeFileSync(path.join(dir, 'heartbeat'), String(++n).padStart(12, '0') + ':' + process.pid);
beat(); setInterval(beat, 25);
http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, status: 'ok', version: '9.9.9' })); })
  .listen(Number(process.env.PORT), process.env.HOST || '127.0.0.1');
process.on('SIGTERM', () => process.exit(0));
`);

async function boot(port, dataDir, env = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const sitesRoot = path.join(path.dirname(dataDir), 'sites');
  fs.mkdirSync(sitesRoot, { recursive: true });
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SERVER_DIR, 'src', 'index.js')], {
    env: {
      ...process.env, HLP_PORT: String(port), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: sitesRoot,
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0',
      HLP_SITESYNC_PORT: String(port + 1), HLP_DISCOVERY_PORT: String(port + 2), HLP_RATE_LOGIN: '1000', HLP_AUTH_RATE_LIMIT: '100000',
      HLP_ACCOUNT_DIR: ACCT, HLP_UPDATE_AUTO: '0',
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
  const call = async (method, url, body, token) => {
    const h = { 'Content-Type': 'application/json' };
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

const staleSession = (dataDir, username) => {
  const d = new DatabaseSync(path.join(dataDir, 'panel.db'));
  try { d.exec('PRAGMA busy_timeout = 3000'); d.prepare('UPDATE sessions SET auth_at = 1 WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username); } finally { d.close(); }
};
const readDb = (dataDir, sql, ...args) => {
  const d = new DatabaseSync(path.join(dataDir, 'panel.db'), { readOnly: true });
  try { d.exec('PRAGMA busy_timeout = 3000'); return d.prepare(sql).all(...args); } finally { d.close(); }
};
const setSettings = (dataDir, kv) => {
  const d = new DatabaseSync(path.join(dataDir, 'panel.db'));
  try {
    d.exec('PRAGMA busy_timeout = 3000');
    for (const [k, v] of Object.entries(kv)) d.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, JSON.stringify(v));
  } finally { d.close(); }
};
const beatOf = (dataDir) => { try { return fs.readFileSync(path.join(dataDir, 'account-server', 'pg', 'heartbeat'), 'utf8'); } catch { return null; } };
async function accountAlive(dataDir) {
  const a = beatOf(dataDir);
  await wait(300);
  const b = beatOf(dataDir);
  return Boolean(a && b && a !== b);
}
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
function tree(dir, skip = () => false) {
  const out = {};
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n);
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (skip(rel)) continue;
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out[rel] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return out;
}
const sameTree = (a, b) => JSON.stringify(a) === JSON.stringify(b) && Object.keys(a).length > 0;
const treeDiff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).slice(0, 8).join(' ');
function filesContain(dir, needles) {
  const hits = [];
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = path.join(d, n);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (n !== 'node_modules') walk(p); continue; }
      if (st.size > 50 * 1024 * 1024) continue;
      const buf = fs.readFileSync(p);
      for (const x of needles) if (x && buf.includes(Buffer.from(x))) hits.push(`${path.relative(dir, p)}∋${x.slice(0, 10)}…`);
    }
  };
  walk(dir);
  return hits;
}

const DATA_C = path.join(tmp, 'center', 'data');
const DATA_1 = path.join(tmp, 'node1', 'data');
const DATA_2 = path.join(tmp, 'node2', 'data');
const C_PORT = BASE_PORT;
const N1_PORT = BASE_PORT + 10;
const N2_PORT = BASE_PORT + 20;
const SITE_PORT = BASE_PORT + 40;
const CF_STATE = path.join(tmp, 'fake-cf-state.json');
const N2_UUID = 'b0b0b0b0-1111-2222-3333-444444444444';
const C_ENV = { HLP_FLEET_OFFLINE_MS: '4000' };
const N1_ENV = { HLP_ACCOUNT_AUTOSTART: '1', HLP_ACCOUNT_API: `http://127.0.0.1:${BASE_PORT + 30}`, HLP_FLEET_HEARTBEAT_MS: '300' };
const N2_ENV = { HLP_ACCOUNT_AUTOSTART: '1', HLP_ACCOUNT_API: `http://127.0.0.1:${BASE_PORT + 31}`, HLP_FLEET_HEARTBEAT_MS: '300', FAKE_CF_STATE: CF_STATE };
const SHOP_HOSTS = ['shop.fleet-test.example', 'www.shop.fleet-test.example'];
const pw = { c: 'Owner-Pass-2026', n1: 'Node1-Pass-2026', n2: 'Node2-Pass-2026' };

let C = null;
let N1 = null;
let N2 = null;
const tBeat = { on: true };
let tLoopDone = Promise.resolve();
const keysSeen = [];
const oldLogs = [];
try {
  /* ══════════════ قراردادِ «عوض شدنِ مسیر» با ورودیِ ساختگی ══════════════ */
  console.log('── قراردادِ مسیر (route-plan.js) ──');
  const from = { name: 'خانه', route: { mode: 'quick' } };
  const auto = planRoute({ hostnames: ['a.x.example'], from, to: { name: 'VPS', route: { mode: 'named', tunnelName: 'vps-t' } }, claim: { applied: ['a.x.example'] } });
  check('تونلِ نام‌دارِ مقصد که گرفت ⇒ «خودکار»، بی گامِ دستی', auto.auto && auto.steps[0].how === 'auto' && auto.steps[0].tunnel === 'vps-t');
  const cname = planRoute({ hostnames: ['a.x.example'], from, to: { name: 'VPS', route: { mode: 'named', tunnelName: 'vps-t' } }, claim: { applied: [], failures: [{ hostname: 'a.x.example', detail: 'dns_failed' }] } });
  check('تونلِ نام‌دار ولی نشد ⇒ CNAME با فرمانِ دقیقِ cloudflared و خطا', !cname.auto && cname.steps[0].how === 'cname'
    && cname.steps[0].command === 'cloudflared tunnel route dns --overwrite-dns vps-t a.x.example' && cname.steps[0].detail === 'dns_failed', JSON.stringify(cname));
  const tok = planRoute({ hostnames: ['a.x.example'], from: { name: 'خانه', route: { mode: 'token' } }, to: { name: 'VPS', route: { mode: 'token' } }, claim: { port: 8123 } });
  check('تونلِ توکنی ⇒ Public Hostname در داشبورد با پورت، و برداشتن از تونلِ مبدأ', tok.steps[0].how === 'public-hostname' && tok.steps[0].port === 8123 && tok.steps[0].fromServer === 'خانه');
  const arec = planRoute({ hostnames: ['a.x.example'], from, to: { name: 'VPS', route: { mode: 'none' } } });
  check('مقصدِ بی تونل ⇒ رکوردِ A (پنل DNS نمی‌نویسد)', arec.manual === 1 && arec.steps[0].how === 'a-record');
  const nohost = planRoute({ hostnames: [], from, to: { name: 'VPS', route: { mode: 'quick' } }, claim: { quickUrl: 'https://q.trycloudflare.com' } });
  check('بی نامِ ثابت ⇒ نشانیِ تازهٔ تونلِ سریع', nohost.auto && nohost.steps[0].how === 'no-hostname' && nohost.steps[0].url === 'https://q.trycloudflare.com');

  /* ══════════════ سه پنل ══════════════ */
  console.log('── سه پنلِ هم‌زمان: مرکز، گرهٔ ۱، گرهٔ ۲ (تونلِ نام‌دارِ ساختگی) ──');
  [C, N1, N2] = await Promise.all([boot(C_PORT, DATA_C, C_ENV), boot(N1_PORT, DATA_1, N1_ENV), boot(N2_PORT, DATA_2, N2_ENV)]);
  check('سه پنل بالا آمدند، پورت و پوشهٔ جدا', C.up && N1.up && N2.up, [C, N1, N2].filter((x) => !x.up).map((x) => x.out().slice(-500)).join('\n'));
  const owner = (await C.call('POST', '/api/auth/setup', { username: 'owner', password: pw.c })).json?.token;
  await C.call('POST', '/api/auth/users', { username: 'admin2', password: 'Admin2-Pass-2026', role: 'admin' }, owner);
  const admin2 = (await C.call('POST', '/api/auth/login', { username: 'admin2', password: 'Admin2-Pass-2026' })).json?.token;
  let o1 = (await N1.call('POST', '/api/auth/setup', { username: 'n1owner', password: pw.n1 })).json?.token;
  let o2 = (await N2.call('POST', '/api/auth/setup', { username: 'n2owner', password: pw.n2 })).json?.token;
  check('مالکِ مرکز، مدیرِ دوم، مالکِ هر گره', Boolean(owner && admin2 && o1 && o2));

  //  N2: تونلِ نام‌دار با cloudflared ِ ساختگی (همان راهِ test/domains-tunnel.mjs) — پنل بسته، فایل‌ها، دوباره بالا
  await N2.stop();
  fs.mkdirSync(path.join(DATA_2, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(DATA_2, 'bin', 'cloudflared'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(SERVER_DIR, 'test', 'fake-cloudflared.mjs')}" "$@"\n`);
  fs.chmodSync(path.join(DATA_2, 'bin', 'cloudflared'), 0o755);
  const CF2 = path.join(DATA_2, 'cloudflared');
  fs.mkdirSync(CF2, { recursive: true });
  fs.writeFileSync(path.join(CF2, 'cert.pem'), 'fake-origin-cert');
  fs.writeFileSync(path.join(CF2, `${N2_UUID}.json`), JSON.stringify({ TunnelID: N2_UUID }));
  fs.writeFileSync(path.join(CF2, 'config.yml'), [`tunnel: ${N2_UUID}`, `credentials-file: ${path.join(CF2, `${N2_UUID}.json`)}`, 'ingress:',
    '  - hostname: n2.fleet-test.example', `    service: http://127.0.0.1:${N2_PORT + 1}`, '  - service: http_status:404', ''].join('\n'));
  fs.writeFileSync(CF_STATE, JSON.stringify({ tunnels: [{ uuid: N2_UUID, name: 'n2-tunnel' }], dns: [] }));
  setSettings(DATA_2, { tunnel_mode: 'named', tunnel_name: 'n2-tunnel', tunnel_hostname: 'n2.fleet-test.example', tunnel_routed_dns: [] });
  N2 = await boot(N2_PORT, DATA_2, N2_ENV);
  o2 = (await N2.call('POST', '/api/auth/login', { username: 'n2owner', password: pw.n2 })).json?.token;
  check('N2 با تونلِ نام‌دارِ ساختگی دوباره بالا آمد', N2.up && Boolean(o2), N2.out().slice(-400));
  check('سرورِ حسابِ هر دو گره روشن است', await until(() => accountAlive(DATA_1)) && await until(() => accountAlive(DATA_2)));

  //  وصلِ دو گره به مرکز با کدِ یک‌باره
  const join = async (N, tok, name, kind) => {
    const k = await C.call('POST', '/api/fleet/codes', {}, owner);
    const r = await N.call('POST', '/api/fleet/link', { center: C.BASE, code: k.json?.code, name, kind }, tok);
    return r.json?.link?.nodeId;
  };
  const id1 = await join(N1, o1, 'خانه', 'home');
  const id2 = await join(N2, o2, 'VPS آلمان', 'vps');
  check('N1 («خانه») و N2 («VPS آلمان») به مرکز وصل شدند', Boolean(id1 && id2));

  //  سایتِ پویا روی N1 با دو دامنه؛ دادهٔ خودش را در ‎SITE_DB_DIR‎ می‌نویسد و می‌گوید از کدام پوشه اجرا شده
  await N1.call('PUT', '/api/settings', { siteAutoSetup: false }, o1);
  await N2.call('PUT', '/api/settings', { siteAutoSetup: false }, o2);
  const siteDir = path.join(N1.sitesRoot, 'shopapi');
  fs.mkdirSync(path.join(siteDir, 'public'), { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'package.json'), JSON.stringify({ name: 'shopapi', scripts: { start: 'node server.js' } }));
  fs.writeFileSync(path.join(siteDir, 'public', 'logo.bin'), crypto.randomBytes(300_000));
  fs.writeFileSync(path.join(siteDir, 'server.js'), `const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path');
const f = path.join(process.env.SITE_DB_DIR, 'hits.json');
http.createServer((q, s) => {
  let n = 0; try { n = JSON.parse(fs.readFileSync(f, 'utf8')).n; } catch {}
  if (q.url === '/hit') { n++; fs.writeFileSync(f, JSON.stringify({ n })); }
  s.setHeader('content-type', 'application/json'); s.end(JSON.stringify({ n, dataDir: process.env.SITE_DATA_DIR }));
}).listen(Number(process.env.PORT), '127.0.0.1');
`);
  const mk = await N1.call('POST', '/api/sites', { path: siteDir, name: 'Shop API', kind: 'node', startCommand: 'node server.js', port: SITE_PORT, domain: SHOP_HOSTS[0] }, o1);
  const site1 = mk.json?.site;
  await N1.call('POST', `/api/sites/${site1?.id}/domains`, { domain: SHOP_HOSTS[1] }, o1);
  const domRows = readDb(DATA_1, 'SELECT name FROM domains WHERE site_id = ? ORDER BY name', site1?.id).map((r) => r.name);
  if (domRows.length < 2) {
    //  (درِ دامنه‌ها شاید نامِ دیگری دارد — همان کارِ attachDomain مستقیم در دیتابیس)
    const d = new DatabaseSync(path.join(DATA_1, 'panel.db'));
    try { d.exec('PRAGMA busy_timeout = 3000'); d.prepare('INSERT OR IGNORE INTO domains(name, site_id, created_at) VALUES(?, ?, ?)').run(SHOP_HOSTS[1], site1.id, Date.now()); } finally { d.close(); }
  }
  const st = site1 ? await N1.call('POST', `/api/sites/${site1.id}/start`, {}, o1) : null;
  const hit = async (n = 1) => { let j = null; for (let i = 0; i < n; i++) j = await (await fetch(`http://127.0.0.1:${SITE_PORT}/hit`)).json(); return j; };
  const siteUp = await until(() => portOpen(SITE_PORT));
  const h1 = siteUp ? await hit(7) : null;
  check('سایتِ پویا روی N1 روشن است و دادهٔ خودش را نوشت (۷ بازدید)', st?.status === 200 && h1?.n === 7 && String(h1.dataDir).startsWith(DATA_1), JSON.stringify(mk.json).slice(0, 300) + JSON.stringify(st?.json));
  check('… با دو دامنه', readDb(DATA_1, 'SELECT COUNT(*) AS n FROM domains WHERE site_id = ?', site1?.id)[0]?.n === 2);
  const pump = await fetch(`${N1.BASE}/api/stations/enroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'pump-yaqobi-1', name: 'پمپ یک' }) });
  check('یک پمپ روی N1 ثبت شد (تانک‌تیل)', pump.status === 200, String(pump.status));

  //  گرهٔ ساختگیِ T — خودِ آزمون؛ فقط پیام‌های امضاشدهٔ همان قرارداد
  const T = generateKeys();
  const kT = await C.call('POST', '/api/fleet/codes', {}, owner);
  const jt = await fetch(`${C.BASE}/api/fleet/hub/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signEnvelope({ purpose: 'join', node: '', payload: { code: kT.json.code, publicKey: T.publicKey, name: 'گرهٔ آزمون', kind: 'foreign' }, privateKey: T.privateKeyPem })),
  }).then((r) => r.json());
  const jr = readEnvelope(jt?.reply, 'reply');
  const centerKey = jr.ok ? jr.env.body.centerKey : null;
  const idT = jr.ok ? jr.env.node : null;
  check('گرهٔ ساختگیِ T وصل شد (پاسخِ امضاشدهٔ مرکز)', Boolean(idT && centerKey && verifyEnvelope(jr.env, centerKey)));
  const hub = async (purpose, payload) => {
    const env = signEnvelope({ purpose, node: idT, payload, privateKey: T.privateKeyPem });
    const r = await fetch(`${C.BASE}/api/fleet/hub/${purpose === 'chunk-get' ? 'chunk/get' : purpose}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env) });
    if (purpose === 'chunk-get') return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
    const j = await r.json().catch(() => null);
    const rep = readEnvelope(j?.reply, 'reply');
    const body = rep.ok && verifyEnvelope(rep.env, centerKey) && rep.env.nonce === env.nonce ? rep.env.body : null;
    return { status: r.status, json: j, body };
  };
  const tState = { tasks: false, seen: [], refused: 0 };
  //  T پیش از ردِ بسته صبر می‌کند تا آزمون «مبدأ ایستاده» را ببیند (بی مسابقه)
  tState.gate = new Promise((r) => { tState.open = r; });
  tLoopDone = (async () => {
    while (tBeat.on) {
      const r = await hub('heartbeat', { report: { name: 'گرهٔ آزمون', kind: 'foreign', version: '1.50.95', apps: [], metrics: { cpu: 1 }, maintenance: {}, tunnel: { mode: 'none' } } }).catch(() => null);
      if (r?.body?.tasks) {
        //  کار دارد: مثلِ ‎src/fleet/node.js‎ — نتیجه‌ها می‌روند، فرمان می‌آید (با کلیدِ پیچیده برای همین درخواست)
        const results = [];
        for (let i = 0; i < 40; i++) {
          const eph = ephemeralKey();
          const p = await hub('task', { results: results.splice(0), eph: eph.publicKey, wait: 1500 }).catch(() => null);
          const cmd = p?.body?.command;
          if (!cmd) { if (!p?.body?.active) break; continue; }
          tState.seen.push(cmd.op);
          if (cmd.op === 'import') {
            const raw = cmd.key ? unwrapSecret(cmd.key, eph.privateKey, `${cmd.move}|${idT}`) : null;
            tState.key = raw ? raw.toString('base64url') : null;
            tState.wrongInfo = cmd.key ? unwrapSecret(cmd.key, eph.privateKey, `${cmd.move}|someone-else`) : 'nokey';
            const parts = [];
            for (let c = 0; c < (cmd.args.chunks || []).length; c++) parts.push((await hub('chunk-get', { job: cmd.move, index: c })).buf);
            tState.bundle = Buffer.concat(parts);
            tState.chunksOk = (cmd.args.chunks || []).every((c, i) => crypto.createHash('sha256').update(parts[i]).digest('hex') === c.sha256);
            tState.sha = crypto.createHash('sha256').update(tState.bundle).digest('hex') === cmd.args.sha256;
            await Promise.race([tState.gate, wait(20000)]);
            tState.refused++;
            results.push({ move: cmd.move, seq: cmd.seq, ok: false, error: { code: 'refused_by_test', message: 'مقصدِ آزمون بسته را رد کرد' } });
          } else {
            results.push({ move: cmd.move, seq: cmd.seq, ok: true, data: {} });
          }
        }
        if (results.length) await hub('task', { results, eph: ephemeralKey().publicKey }).catch(() => null);
      }
      await wait(300);
    }
  })();

  /* ══════════════ جدولِ «جا» ══════════════ */
  console.log('── جدولِ «جا» در مرکز: پیش‌فرض از گزارشِ تپش ──');
  const placed = await until(async () => {
    const r = await C.call('GET', '/api/fleet', undefined, owner);
    const p = r.json?.placement || [];
    return p.find((a) => a.id === `site:${site1?.slug}`)?.node?.id === id1 && p.some((a) => a.type === 'pump') && r.json.nodes.find((n) => n.id === idT)?.online ? r.json : null;
  }, 15000);
  const pSite = placed?.placement?.find((a) => a.id === `site:${site1?.slug}`);
  check('سایت: روی «خانه» (دیده‌شده از تپش، هنوز بی ردیف در جدول)', pSite?.node?.id === id1 && pSite.source === 'observed' && pSite.movable && !pSite.move, JSON.stringify(pSite));
  const pPump = placed?.placement?.find((a) => a.type === 'pump');
  check('⛔ پمپ (تانک‌تیل): جابه‌جاشدنی از صفحه نیست — «فقط با پنلِ بسته از CLI»', pPump && pPump.movable === false && pPump.why === 'pump_cli_only', JSON.stringify(pPump));
  const pAcct = placed?.placement?.find((a) => a.id === 'account-server');
  check('سرورِ حساب روی هر دو گره روشن ⇒ «نامعلوم» (دو دفتر)، نه حدس', pAcct && pAcct.node === null && pAcct.source === 'unknown' && pAcct.holders.filter((h) => h.running).length === 2, JSON.stringify(pAcct));
  check('ردیفی در جدولِ جا نیست تا جابه‌جاییِ موفق', readDb(DATA_C, 'SELECT COUNT(*) AS n FROM fleet_placement')[0].n === 0);

  /* ══════════════ مرزها ══════════════ */
  console.log('── فقط مالک، احرازِ دوباره، تأییدِ صریح، پمپ ──');
  const SLUG = site1?.slug;
  const appId = `site:${SLUG}`;
  const confirm = (to) => ({ app: 'Shop API', from: 'خانه', to });
  const body = (to, extra = {}) => ({ app: appId, from: id1, to, confirm: confirm(to === id2 ? 'VPS آلمان' : 'گرهٔ آزمون'), ...extra });
  staleSession(DATA_C, 'admin2');
  const a2 = await C.call('POST', '/api/fleet/moves', body(id2), admin2);
  check('⛔ مدیرِ دوم ⇒ ۴۰۳ owner_only پیش از رمز (نشستِ کهنه هم reauth نمی‌گیرد)', a2.status === 403 && a2.json?.error === 'owner_only', JSON.stringify(a2));
  staleSession(DATA_C, 'owner');
  const ra = await C.call('POST', '/api/fleet/moves', body(id2), owner);
  check('⛔ مالک بی احرازِ دوباره ⇒ reauth_required', ra.status === 403 && ra.json?.error === 'reauth_required', JSON.stringify(ra));
  await C.call('POST', '/api/auth/reauth', { password: pw.c }, owner);
  const bad = await C.call('POST', '/api/fleet/moves', { ...body(id2), confirm: { app: 'Shop', from: 'خانه', to: 'VPS آلمان' } }, owner);
  check('⛔ تأییدِ نادرست (نامِ برنامه ناقص) ⇒ ۴۰۰ confirm_mismatch', bad.status === 400 && bad.json?.error === 'confirm_mismatch', JSON.stringify(bad));
  const same = await C.call('POST', '/api/fleet/moves', { ...body(id2), to: id1 }, owner);
  check('⛔ مبدأ = مقصد ⇒ ۴۰۰', same.status === 400 && same.json?.error === 'same_node', JSON.stringify(same));
  const pm = await C.call('POST', '/api/fleet/moves', { app: pPump?.id, from: id1, to: id2, confirm: { app: pPump?.name, from: 'خانه', to: 'VPS آلمان' } }, owner);
  check('⛔ پمپ ⇒ ۴۰۹ pump_cli_only با راهِ خطِ فرمان', pm.status === 409 && pm.json?.error === 'pump_cli_only' && /--only stations/.test(pm.json?.message || ''), JSON.stringify(pm));
  const none = await C.call('POST', '/api/fleet/moves', { app: 'site:nothere', from: id1, to: id2, confirm: confirm('VPS آلمان') }, owner);
  check('⛔ برنامه‌ای که روی مبدأ نیست ⇒ ۴۰۴', none.status === 404 && none.json?.error === 'app_not_on_source', JSON.stringify(none));
  check('… هیچ‌کدام کاری نساخت', readDb(DATA_C, 'SELECT COUNT(*) AS n FROM fleet_moves')[0].n === 0);

  /* ══════════════ مقصدی که بسته را رد کند (T) ══════════════ */
  console.log('── مقصد بسته را رد می‌کند ⇒ مبدأ دوباره روشن، جدول بی تغییر ──');
  const mT = await C.call('POST', '/api/fleet/moves', body(idT), owner);
  check('کار آغاز شد (N1 ⇒ T)', mT.status === 200 && mT.json?.move?.id, JSON.stringify(mT));
  const busy = await C.call('POST', '/api/fleet/moves', body(id2), owner);
  check('⛔ کارِ دوم روی همان برنامه هم‌زمان ⇒ ۴۰۹ move_busy (یک نویسنده)', busy.status === 409 && busy.json?.error === 'move_busy', JSON.stringify(busy));
  const maintBusy = await C.call('POST', `/api/fleet/nodes/${id1}/maintenance`, { on: true }, owner);
  check('⛔ نگه‌داریِ سرورِ درگیر در میانهٔ کار ⇒ ۴۰۹ move_in_progress', maintBusy.status === 409 && maintBusy.json?.error === 'move_in_progress', JSON.stringify(maintBusy));
  const frozenSeen = await until(async () => !(await portOpen(SITE_PORT)), 15000);
  const tryStart = await N1.call('POST', `/api/sites/${site1?.id}/start`, {}, o1);
  check('… در میانهٔ کار سایتِ مبدأ «فقط‌خواندنی» شد (ایستاد) و روشن کردنش رد می‌شود', frozenSeen && tryStart.json?.ok !== true && !(await portOpen(SITE_PORT)), JSON.stringify(tryStart));
  tState.open();
  const mTdone = await until(async () => {
    const r = await C.call('GET', `/api/fleet/moves/${mT.json?.move?.id}`, undefined, owner);
    return r.json?.move && !r.json.move.active ? r.json.move : null;
  }, 40000, 300);
  check('کار شکست خورد با ردِ مقصد و برگشت کامل شد', mTdone?.state === 'failed' && /refused_by_test/.test(mTdone.error || '')
    && mTdone.steps.some((s) => s.op === 'import' && s.state === 'failed') && mTdone.steps.some((s) => s.op === 'rollback:unfreeze' && s.state === 'done'), JSON.stringify(mTdone).slice(0, 800));
  check('… T فقط «import» و «discard» گرفت (بسته از مرکز، نه از N1)', JSON.stringify(tState.seen) === JSON.stringify(['import', 'discard']), JSON.stringify(tState.seen));
  check('… هر تکه و کلِ بسته با sha256 ِ فرمانِ امضاشده می‌خواند', tState.chunksOk === true && tState.sha === true);
  check('⛔ کلیدِ پیچیده فقط برای همین کار و همین گره باز می‌شود', Boolean(tState.key) && tState.wrongInfo === null);
  keysSeen.push(tState.key);
  const tb = path.join(tmp, 't-bundle.vmove');
  fs.writeFileSync(tb, tState.bundle || Buffer.alloc(0));
  const tIns = await inspectBundle({ file: tb, pass: tState.key }).catch((e) => ({ err: e.message }));
  check('… بسته با همان کلید باز می‌شود و «فقط همان سایت» است', tIns.ok && tIns.manifest?.only === appId && tIns.manifest.files.every((f) => f.name.startsWith('data/site-root/') || f.name.startsWith(`data/sites/${SLUG}/`) || f.name.startsWith(`data/site-sync/sites/${SLUG}/`)), JSON.stringify(tIns).slice(0, 300));
  check('⛔ بستهٔ روی سیم رمزشده است (نامِ فایلِ سایت در بایت‌ها نیست)', tState.bundle && !tState.bundle.includes(Buffer.from('server.js')) && !tState.bundle.includes(Buffer.from('hits.json')));
  const peek = async () => (await fetch(`http://127.0.0.1:${SITE_PORT}/`)).json();
  const back1 = await until(async () => (await portOpen(SITE_PORT)) ? (await peek()) : null, 15000);
  check('مبدأ دوباره روشن است، همان داده (۷ بازدید)، از پوشهٔ خودِ N1', back1?.n === 7 && String(back1.dataDir).startsWith(DATA_1), JSON.stringify(back1));
  check('… جدولِ جا بی تغییر (هیچ ردیفی)', readDb(DATA_C, 'SELECT COUNT(*) AS n FROM fleet_placement')[0].n === 0);
  check('… و هیچ‌جای کار باز نمانده (قفل آزاد)', readDb(DATA_C, 'SELECT COUNT(*) AS n FROM fleet_moves WHERE active = 1')[0].n === 0);

  /* ══════════════ مرکز وسطِ کار دوباره بالا می‌آید ══════════════ */
  console.log('── مرکز وسطِ کار دوباره بالا می‌آید ⇒ کلید (فقط در حافظه) رفته ⇒ برگشت ──');
  tState.gate = new Promise((r) => { tState.open = r; });
  const seenBefore = tState.seen.length;
  const mR = await C.call('POST', '/api/fleet/moves', body(idT), owner);
  const gotImport = await until(() => tState.seen.length > seenBefore && tState.seen[tState.seen.length - 1] === 'import', 30000);
  check('کار آغاز شد و بسته به T رسید (T هنوز جواب نداده)', mR.status === 200 && Boolean(gotImport), JSON.stringify(mR) + JSON.stringify(tState.seen));
  await C.stop();
  oldLogs.push(C.out());
  C = await boot(C_PORT, DATA_C, C_ENV);
  tState.open();
  check('مرکز دوباره بالا آمد', C.up, C.out().slice(-400));
  const mRdone = await until(async () => {
    const r = await C.call('GET', `/api/fleet/moves/${mR.json?.move?.id}`, undefined, owner);
    return r.json?.move && !r.json.move.active ? r.json.move : null;
  }, 40000, 300);
  check('… کارِ نیمه‌کاره برگشت خورد (center_restarted)، نه رها', mRdone?.state === 'failed' && /center_restarted/.test(mRdone.error || '')
    && mRdone.steps.some((s) => s.op === 'rollback:unfreeze' && s.state === 'done'), JSON.stringify(mRdone).slice(0, 600));
  const backR = await until(async () => (await portOpen(SITE_PORT)) ? (await peek()) : null, 15000);
  check('… سایت روی N1 دوباره روشن، همان داده؛ جدول بی ردیف؛ قفل آزاد', backR?.n === 7 && String(backR.dataDir).startsWith(DATA_1)
    && readDb(DATA_C, 'SELECT COUNT(*) AS n FROM fleet_placement')[0].n === 0 && readDb(DATA_C, 'SELECT COUNT(*) AS n FROM fleet_moves WHERE active = 1')[0].n === 0, JSON.stringify(backR));
  check('… و بستهٔ رمزشدهٔ نیمه‌کاره در کارگاهِ مرکز نماند', !fs.existsSync(path.join(DATA_C, '.vmove-panel', 'fleet')) || fs.readdirSync(path.join(DATA_C, '.vmove-panel', 'fleet')).length === 0);
  if (tState.key) keysSeen.push(tState.key);

  /* ══════════════ نگه‌داری ══════════════ */
  console.log('── مقصدِ در نگه‌داری ⇒ رد ──');
  await C.call('POST', `/api/fleet/nodes/${id2}/maintenance`, { on: true }, owner);
  const mM = await C.call('POST', '/api/fleet/moves', body(id2), owner);
  check('⛔ N2 در نگه‌داری ⇒ ۴۰۹ node_maintenance', mM.status === 409 && mM.json?.error === 'node_maintenance', JSON.stringify(mM));
  await C.call('POST', `/api/fleet/nodes/${id2}/maintenance`, { on: false }, owner);
  const n2Free = await until(async () => {
    const r = await C.call('GET', '/api/fleet', undefined, owner);
    const n = r.json?.nodes?.find((x) => x.id === id2);
    return n && !n.maintenance.wanted && !n.maintenance.applied && n.online ? true : null;
  }, 20000);
  check('… N2 دوباره فعال', Boolean(n2Free));
  await until(() => accountAlive(DATA_2), 15000);

  /* ══════════════ جابه‌جاییِ واقعی N1 ⇒ N2 ══════════════ */
  console.log('── جابه‌جاییِ سایت از «خانه» به «VPS آلمان» از راهِ مرکز ──');
  await hit(3);
  const mv = await C.call('POST', '/api/fleet/moves', body(id2), owner);
  check('کار آغاز شد (N1 ⇒ N2)', mv.status === 200 && mv.json?.move?.id, JSON.stringify(mv));
  const mvId = mv.json?.move?.id;
  const seenSteps = new Set();
  const done = await until(async () => {
    const r = await C.call('GET', `/api/fleet/moves/${mvId}`, undefined, owner);
    if (r.json?.move?.step) seenSteps.add(r.json.move.step);
    return r.json?.move && !r.json.move.active ? r.json.move : null;
  }, 90000, 150);
  check('کار تمام شد: freeze ⇒ export ⇒ import ⇒ start ⇒ route ⇒ retire', done?.state === 'done'
    && ['freeze', 'export', 'import', 'start', 'route', 'retire'].every((op) => done.steps.some((s) => s.op === op && s.state === 'done')), JSON.stringify(done).slice(0, 900));
  check('وضعیتِ کار در صفحه دیده می‌شد (گام‌ها پیش از پایان)', seenSteps.size >= 2, [...seenSteps].join(','));
  const ov = await C.call('GET', '/api/fleet', undefined, owner);
  const pAfter = ov.json?.placement?.find((a) => a.id === appId);
  check('جدولِ جا: سایت ⇒ «VPS آلمان» (ردیفِ جدول)', pAfter?.node?.id === id2 && pAfter.source === 'table'
    && readDb(DATA_C, 'SELECT node_id FROM fleet_placement WHERE app_id = ?', appId)[0]?.node_id === id2, JSON.stringify(pAfter));
  const onN2 = await until(async () => (await portOpen(SITE_PORT)) ? (await (await fetch(`http://127.0.0.1:${SITE_PORT}/`)).json()) : null, 15000);
  check('سایت روی N2 روشن است، از پوشهٔ دادهٔ N2، با همان داده (۱۰ بازدید)', onN2?.n === 10 && String(onN2.dataDir).startsWith(DATA_2), JSON.stringify(onN2));
  const row2 = readDb(DATA_2, 'SELECT * FROM sites WHERE slug = ?', SLUG)[0];
  const doms2 = readDb(DATA_2, 'SELECT name FROM domains WHERE site_id = ? ORDER BY name', row2?.id).map((r) => r.name);
  check('… ردیف و هر دو دامنه روی N2، روشن', row2?.enabled === 1 && doms2.join(',') === [...SHOP_HOSTS].sort().join(','), JSON.stringify(row2) + doms2);
  const asideRoot1 = path.join(DATA_1, '.vmove-aside');
  const moved1 = fs.existsSync(asideRoot1) ? fs.readdirSync(asideRoot1).filter((n) => n.includes(`moved-site-${SLUG}`)) : [];
  const aside1 = moved1.length ? path.join(asideRoot1, moved1[0]) : '';
  const noLogs = (rel) => rel === 'logs' || rel.startsWith('logs/');
  check('مبدأ کنار، پاک نه: ریشه، فضای کاری و دفترِ سایت در ‎.vmove-aside/‎ ِ N1', Boolean(aside1) && fs.existsSync(path.join(aside1, 'root', 'server.js'))
    && fs.existsSync(path.join(aside1, 'workspace', 'db', 'hits.json')) && !fs.existsSync(siteDir), moved1.join(','));
  check('داده در مقصد همان هش: ریشهٔ سایت', sameTree(tree(path.join(aside1, 'root')), tree(row2?.root_path || '/nonexistent')), treeDiff(tree(path.join(aside1, 'root')), tree(row2?.root_path || '/x')));
  check('… و فضای کاری (دیتابیسِ سایت، کلیدِ پنل)', sameTree(tree(path.join(aside1, 'workspace'), noLogs), tree(path.join(DATA_2, 'sites', SLUG), noLogs)),
    treeDiff(tree(path.join(aside1, 'workspace'), noLogs), tree(path.join(DATA_2, 'sites', SLUG), noLogs)));
  if (fs.existsSync(path.join(aside1, 'store'))) {
    check('… و دفترِ سرورِ سایت (توکن و داده)', sameTree(tree(path.join(aside1, 'store')), tree(path.join(DATA_2, 'site-sync', 'sites', SLUG))));
  }
  const row1 = readDb(DATA_1, 'SELECT * FROM sites WHERE slug = ?', SLUG)[0];
  check('مبدأ ایستاده: ردیفِ N1 خاموش، بی «اجرای خودکار»، رویدادهایش سرِ جا (پاک نه)', row1?.enabled === 0 && row1?.autostart === 0
    && readDb(DATA_1, 'SELECT COUNT(*) AS n FROM events WHERE site_id = ?', row1.id)[0].n > 0, JSON.stringify(row1));
  o1 = (await N1.call('POST', '/api/auth/login', { username: 'n1owner', password: pw.n1 })).json?.token;
  const restart1 = await N1.call('POST', `/api/sites/${row1?.id}/start`, {}, o1);
  check('⛔ روشن کردنِ نسخهٔ کنارگذاشته روی N1 رد می‌شود (دو دفتر)', restart1.status !== 200 || restart1.json?.ok === false, JSON.stringify(restart1));
  const ovGone = await until(async () => {
    const r = await C.call('GET', '/api/fleet', undefined, owner);
    return !r.json?.conflicts?.some((c) => c.id === appId) && r.json?.nodes?.find((n) => n.id === id1)?.apps && !r.json.nodes.find((n) => n.id === id1).apps.some((a) => a.id === appId) ? r.json : null;
  }, 10000);
  check('… و N1 آن را دیگر در گزارشش ندارد (هشدارِ «دو دفتر» نیست؛ برنامه فقط روی N2)', Boolean(ovGone)
    && ovGone.nodes.find((n) => n.id === id2).apps.some((a) => a.id === appId && a.running), JSON.stringify(ov.json?.nodes?.find((n) => n.id === id1)?.apps));
  const cfg2 = fs.readFileSync(path.join(CF2, 'config.yml'), 'utf8');
  const cfState = JSON.parse(fs.readFileSync(CF_STATE, 'utf8'));
  check('مسیر خودکار: ingress ِ تونلِ N2 هر دو دامنه را به پورتِ سایتِ N2 می‌برد', SHOP_HOSTS.every((h) => new RegExp(`hostname: ${h.replace(/\./g, '\\.')}\\s*\\n\\s*service: http://127\\.0\\.0\\.1:${row2?.port}`).test(cfg2)), cfg2);
  check('… و ‎cloudflared tunnel route dns --overwrite-dns‎ برای هر دو (ساختگی) زده شد', SHOP_HOSTS.every((h) => (cfState.dns || []).includes(h)), JSON.stringify(cfState.dns));
  check('… و گزارشِ کار: هر دو نام «خودکار»، بی گامِ دستی', done?.route?.auto === true && done.route.steps.length === 2 && done.route.steps.every((s) => s.how === 'auto' && s.tunnel === 'n2-tunnel'), JSON.stringify(done?.route));

  /* ══════════════ برگشتی که مقصد ردش کند ══════════════ */
  console.log('── N2 ⇒ N1 با دامنهٔ مالِ سایتِ دیگرِ N1 ⇒ رد، N2 دوباره روشن ──');
  const blogDir = path.join(N1.sitesRoot, 'blog');
  fs.mkdirSync(blogDir, { recursive: true });
  fs.writeFileSync(path.join(blogDir, 'index.html'), 'blog');
  const blog = (await N1.call('POST', '/api/sites', { path: blogDir, name: 'Blog', kind: 'static', port: SITE_PORT + 1 }, o1)).json?.site;
  {
    const d = new DatabaseSync(path.join(DATA_1, 'panel.db'));
    try { d.exec('PRAGMA busy_timeout = 3000'); d.prepare('UPDATE domains SET site_id = ? WHERE name = ?').run(blog.id, SHOP_HOSTS[1]); } finally { d.close(); }
  }
  const n1Aside0 = fs.readdirSync(asideRoot1).sort().join(',');
  const bk = await C.call('POST', '/api/fleet/moves', { app: appId, from: id2, to: id1, confirm: { app: 'Shop API', from: 'VPS آلمان', to: 'خانه' } }, owner);
  check('کارِ برگشت آغاز شد', bk.status === 200, JSON.stringify(bk));
  const bkDone = await until(async () => {
    const r = await C.call('GET', `/api/fleet/moves/${bk.json?.move?.id}`, undefined, owner);
    return r.json?.move && !r.json.move.active ? r.json.move : null;
  }, 60000, 300);
  check('مقصد (N1) رد کرد: domain_taken، و برگشت انجام شد', bkDone?.state === 'failed' && /domain_taken/.test(bkDone.error || '')
    && bkDone.steps.some((s) => s.op === 'rollback:unfreeze' && s.state === 'done'), JSON.stringify(bkDone).slice(0, 700));
  const onN2b = await until(async () => (await portOpen(SITE_PORT)) ? (await (await fetch(`http://127.0.0.1:${SITE_PORT}/`)).json()) : null, 15000);
  check('… سایت دوباره روی N2 روشن است (همان داده)', onN2b?.n === 10 && String(onN2b.dataDir).startsWith(DATA_2), JSON.stringify(onN2b));
  check('… جدولِ جا بی تغییر (N2)', readDb(DATA_C, 'SELECT node_id FROM fleet_placement WHERE app_id = ?', appId)[0]?.node_id === id2);
  check('… و N1 هیچ پوشهٔ تازه‌ای نگرفت؛ ردیفِ کنارِ آن همان ماند', fs.readdirSync(asideRoot1).sort().join(',') === n1Aside0
    && readDb(DATA_1, 'SELECT enabled FROM sites WHERE slug = ?', SLUG)[0]?.enabled === 0 && !fs.existsSync(siteDir));
  check('… مسیر هنوز روی N2 (ingress دست نخورد)', fs.readFileSync(path.join(CF2, 'config.yml'), 'utf8').includes(SHOP_HOSTS[0]));

  /* ══════════════ سرورِ حساب N1 ⇒ N2 ══════════════ */
  console.log('── سرورِ حساب از «خانه» به «VPS آلمان» (همیشه کامل) ──');
  const marker = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(path.join(DATA_1, 'account-server', 'pg', 'marker.txt'), marker);
  const n2AcctBefore = tree(path.join(DATA_2, 'account-server'), (r) => r === 'pg/heartbeat');
  const ma = await C.call('POST', '/api/fleet/moves', { app: 'account-server', from: id1, to: id2, confirm: { app: 'سرورِ حساب', from: 'خانه', to: 'VPS آلمان' } }, owner);
  check('کارِ سرورِ حساب آغاز شد', ma.status === 200, JSON.stringify(ma));
  const maDone = await until(async () => {
    const r = await C.call('GET', `/api/fleet/moves/${ma.json?.move?.id}`, undefined, owner);
    return r.json?.move && !r.json.move.active ? r.json.move : null;
  }, 90000, 300);
  check('تمام شد', maDone?.state === 'done', JSON.stringify(maDone).slice(0, 700));
  check('… سرورِ حسابِ N2 با دادهٔ N1 روشن است (نشانهٔ N1 در pg ِ N2)', fs.readFileSync(path.join(DATA_2, 'account-server', 'pg', 'marker.txt'), 'utf8') === marker && await until(() => accountAlive(DATA_2), 15000));
  check('… سرورِ حسابِ N1 خاموش ماند', !(await accountAlive(DATA_1)));
  const asA = fs.readdirSync(asideRoot1).filter((n) => n.includes('moved-account-server'));
  check('… دادهٔ N1 کنار رفت، پاک نشد', asA.length === 1 && fs.readFileSync(path.join(asideRoot1, asA[0], 'account-server', 'pg', 'marker.txt'), 'utf8') === marker);
  const as2 = fs.existsSync(path.join(DATA_2, '.vmove-aside')) ? fs.readdirSync(path.join(DATA_2, '.vmove-aside')).map((n) => path.join(DATA_2, '.vmove-aside', n, 'account-server')).filter((p) => fs.existsSync(p)) : [];
  check('… سرورِ حسابِ پیشینِ خودِ N2 هم کنار رفت، پاک نشد (همان هش)', as2.some((p) => sameTree(n2AcctBefore, tree(p, (r) => r === 'pg/heartbeat'))), as2.join(','));
  const acctTry = await N1.call('POST', '/api/account-server/start', {}, o1);
  await wait(800);
  check('⛔ روشن کردنِ سرورِ حسابِ کنارگذاشته روی N1 رد/بی‌اثر است', !(await accountAlive(DATA_1)), JSON.stringify(acctTry));
  check('… جدولِ جا: سرورِ حساب ⇒ «VPS آلمان»', readDb(DATA_C, "SELECT node_id FROM fleet_placement WHERE app_id = 'account-server'")[0]?.node_id === id2);

  /* ══════════════ آفلاین ══════════════ */
  console.log('── گرهٔ آفلاین ⇒ رد ──');
  tBeat.on = false;
  await tLoopDone;
  const tOff = await until(async () => {
    const r = await C.call('GET', '/api/fleet', undefined, owner);
    return r.json?.nodes?.find((n) => n.id === idT)?.online === false ? true : null;
  }, 15000);
  const mOff = await C.call('POST', '/api/fleet/moves', { app: appId, from: id2, to: idT, confirm: { app: 'Shop API', from: 'VPS آلمان', to: 'گرهٔ آزمون' } }, owner);
  check('⛔ T آفلاین ⇒ ۴۰۹ node_offline', Boolean(tOff) && mOff.status === 409 && mOff.json?.error === 'node_offline', JSON.stringify(mOff));

  /* ══════════════ رازها ══════════════ */
  console.log('── هیچ کلیدِ بسته‌ای در دیتابیس، دفتر، لاگ یا پاسخ ──');
  const keyForms = keysSeen.filter(Boolean).flatMap((k) => [k, Buffer.from(k, 'base64url').toString('hex'), Buffer.from(k, 'base64url').toString('base64')]);
  check('کلیدِ هر دو کارِ T گرفته شد (برای جست‌وجو) و دو کار دو کلیدِ جدا داشتند', keyForms.length === 6 && keysSeen[0] !== keysSeen[1]);
  const hitsC = filesContain(DATA_C, keyForms);
  const hits1 = filesContain(DATA_1, keyForms);
  check('کلید هیچ‌جای پوشهٔ دادهٔ مرکز نیست (دیتابیس، WAL، دفتر)', hitsC.length === 0, hitsC.join(' '));
  check('… و هیچ‌جای پوشهٔ دادهٔ مبدأ (N1)', hits1.length === 0, hits1.join(' '));
  check('… و در لاگِ هیچ‌کدام از سه پنل (مرکزِ پیش از راه‌اندازیِ دوباره هم)', !keyForms.some((k) => [C.out(), N1.out(), N2.out(), ...oldLogs].some((l) => l.includes(k))));
  const allMoves = await C.call('GET', '/api/fleet', undefined, owner);
  check('… و در پاسخِ مالک (فهرستِ کارها)', !keyForms.some((k) => JSON.stringify(allMoves.json).includes(k)));
  const audits = readDb(DATA_C, "SELECT action, ok, detail FROM audit_log WHERE action = 'panel.fleet.move'");
  check('دفتر: هر آغاز و هر رد ثبت شد (بی کلید)', audits.some((r) => r.ok === 1) && audits.some((r) => r.ok === 0 && /owner_only|confirm_mismatch|pump_cli_only|move_busy/.test(r.detail || '')), JSON.stringify(audits).slice(0, 300));
} catch (e) {
  check('بی خطای پیش‌بینی‌نشده', false, e.stack);
} finally {
  tBeat.on = false;
  await Promise.race([tLoopDone, wait(3000)]);
  await Promise.all([C?.stop(), N1?.stop(), N2?.stop()]);
  if (failed && process.env.KEEP_LOGS) {
    for (const [n, x] of [['C', C], ['N1', N1], ['N2', N2]]) if (x) fs.writeFileSync(path.join(os.tmpdir(), `app-placement-${n}.log`), x.out());
  }
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} این برنامه روی کدام سرور: ${passed} سبز، ${failed} قرمز`);
process.exit(failed ? 1 : 0);
