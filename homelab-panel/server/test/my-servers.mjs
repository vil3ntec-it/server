// ---------------------------------------------------------------------------
//  آزمونِ «سرورهای من» (۱.۵۰.۹۴، گامِ ۲ ِ docs/MULTI-SERVER-fa.md) — ‎/api/fleet‎ و ‎/api/fleet/hub‎
//      node test/my-servers.mjs
//
//  دو پنلِ واقعیِ هم‌زمان روی همین کامپیوتر با پورت و پوشهٔ دادهٔ جدا — «مرکز» (C) و «گره» (N) — هر کدام با سرورِ
//  حسابِ ساختگیِ زیرِ نظرِ خودش؛ گره سایتِ پویا و تونلِ ساختگی هم دارد. همه از راهِ HTTP، مثلِ صاحب‌کار:
//    • فقط مالک (مدیرِ دوم ۴۰۳ پیش از رمز)، بی احرازِ دوباره رد
//    • کدِ درست ⇒ فهرست؛ کدِ نادرست/کهنه/دوباره‌مصرف ⇒ رد و هیچ کلیدی روی دیسکِ گره
//    • امضای جعلی، بدنهٔ دست‌خورده، ‎ts‎ ِ کهنه/آینده، nonce ِ تکراری، گرهٔ ناشناس ⇒ رد؛ پاسخِ مرکز امضاشده
//    • تپشِ ۳۰ ثانیه‌ای (این‌جا کوتاه) ⇒ آنلاین؛ ایستادن ⇒ پس از سقف «آفلاین»؛ از درِ عمومی هم
//    • نگه‌داری روشن ⇒ گره در تپشِ بعدی سرورِ حساب، سایت و تونلش را می‌ایستاند (حتی پس از راه‌اندازیِ دوباره)؛
//      خاموش ⇒ همان‌ها برمی‌گردند؛ نگه‌داریِ خودِ مرکز
//    • دو سرور با سرورِ حسابِ روشن ⇒ «دو دفتر»؛ جدا کردن ⇒ تپشِ بعدی ‎403 node_revoked‎
//    • ‎scripts/join.mjs‎ (کلیدِ محلی) وصل و جدا می‌کند
//    • هیچ کد یا کلیدِ خصوصی در دیتابیس، دفتر یا لاگ نیست
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { generateKeys, signEnvelope, readEnvelope, verifyEnvelope } from '../src/fleet/crypto.js';

const BASE_PORT = Number(process.env.TEST_PORT || 5155);
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 500) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-my-servers-'));
const SERVER_DIR = path.join(import.meta.dirname, '..');

/* ───────── سرورِ حسابِ ساختگی (همان قراردادِ supervisor، مثلِ move-ui) ───────── */
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

const staleSession = (dataDir, username) => {
  const d = new DatabaseSync(path.join(dataDir, 'panel.db'));
  try { d.exec('PRAGMA busy_timeout = 3000'); d.prepare('UPDATE sessions SET auth_at = 1 WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username); } finally { d.close(); }
};
const readDb = (dataDir, sql, ...args) => {
  const d = new DatabaseSync(path.join(dataDir, 'panel.db'), { readOnly: true });
  try { d.exec('PRAGMA busy_timeout = 3000'); return d.prepare(sql).all(...args); } finally { d.close(); }
};
const beatOf = (dataDir) => { try { return fs.readFileSync(path.join(dataDir, 'account-server', 'pg', 'heartbeat'), 'utf8'); } catch { return null; } };
/** سرورِ حسابِ ساختگی همین حالا در دیتابیسش می‌نویسد؟ */
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
async function until(fn, ms = 10000, step = 200) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    await wait(step);
  }
  return v;
}
/** هر رشته‌ای از این‌ها در بایت‌های پوشه/فایل؟ */
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
      for (const x of needles) if (x && buf.includes(Buffer.from(x))) hits.push(`${path.relative(dir, p)}∋${x.slice(0, 12)}…`);
    }
  };
  walk(dir);
  return hits;
}

/** جریانِ SSE ِ ‎/api/live/stream‎ — رویدادهای «changed» */
function openStream(base, token) {
  const box = { topics: [], raw: '', ctrl: new AbortController() };
  box.ready = fetch(`${base}/api/live/stream`, { signal: box.ctrl.signal, headers: { Authorization: `Bearer ${token}` } }).then((res) => {
    (async () => {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = dec.decode(value, { stream: true });
          box.raw += chunk;
          buf += chunk;
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (/^event: changed$/m.test(frame)) { try { box.topics.push(JSON.parse(/^data: (.+)$/m.exec(frame)[1]).topic); } catch { /* */ } }
          }
        }
      } catch { /* بسته شد */ }
    })();
    return res.status;
  });
  return box;
}

const FAKE_TUNNEL = 'sh,-c,echo https://node-tunnel.fleet-test.example; exec sleep 3600';
const DATA_C = path.join(tmp, 'center', 'data');
const DATA_N = path.join(tmp, 'node', 'data');
const C_PORT = BASE_PORT;
const N_PORT = BASE_PORT + 10;
const SITE_PORT = BASE_PORT + 30;
const C_ENV = { HLP_ACCOUNT_AUTOSTART: '1', HLP_ACCOUNT_API: `http://127.0.0.1:${BASE_PORT + 20}`, HLP_FLEET_CODE_TTL_MS: '2000', HLP_FLEET_OFFLINE_MS: '3000' };
const N_ENV = {
  HLP_ACCOUNT_AUTOSTART: '1', HLP_ACCOUNT_API: `http://127.0.0.1:${BASE_PORT + 21}`, HLP_FLEET_HEARTBEAT_MS: '400',
  HLP_TUNNEL: '1', HLP_TUNNEL_CMD: FAKE_TUNNEL, HLP_NODE_KIND: 'vps',
};
const codes = [];
let C = null;
let N = null;
try {
  console.log('── دو پنلِ هم‌زمان: مرکز و گره ──');
  [C, N] = await Promise.all([boot(C_PORT, DATA_C, C_ENV), boot(N_PORT, DATA_N, N_ENV)]);
  check('مرکز (C) و گره (N) بالا آمدند، پورت و پوشهٔ جدا', C.up && N.up, (C.up ? '' : C.out().slice(-600)) + (N.up ? '' : N.out().slice(-600)));
  const owner = (await C.call('POST', '/api/auth/setup', { username: 'owner', password: 'Owner-Pass-2026' })).json?.token;
  await C.call('POST', '/api/auth/users', { username: 'admin2', password: 'Admin2-Pass-2026', role: 'admin' }, owner);
  const admin2 = (await C.call('POST', '/api/auth/login', { username: 'admin2', password: 'Admin2-Pass-2026' })).json?.token;
  const nOwner = (await N.call('POST', '/api/auth/setup', { username: 'nowner', password: 'Node-Pass-2026' })).json?.token;
  check('مالکِ مرکز، مدیرِ دوم و مالکِ گره', Boolean(owner && admin2 && nOwner));
  check('سرورِ حسابِ هر دو روشن است', await until(() => accountAlive(DATA_C)) && await until(() => accountAlive(DATA_N)));

  //  سایتِ پویا روی گره (فرمانِ شروع فقط مالک). راه‌اندازیِ خودکارِ سایت (دامنه/تونلِ جدای سایت) خاموش: بی اینترنت
  //  دانلودِ cloudflared ِ تونلِ سایت وضعیتِ تونلِ اصلی را «installing» می‌کرد — رفتارِ پیشین، نه این آزمون
  await N.call('PUT', '/api/settings', { siteAutoSetup: false }, nOwner);
  const siteDir = path.join(N.sitesRoot, 'shopapi');
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'package.json'), JSON.stringify({ name: 'shopapi', scripts: { start: 'node server.js' } }));
  fs.writeFileSync(path.join(siteDir, 'server.js'), "require('node:http').createServer((q, s) => s.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');\n");
  const mk = await N.call('POST', '/api/sites', { path: siteDir, name: 'Shop API', kind: 'node', startCommand: 'node server.js', port: SITE_PORT }, nOwner);
  const site = mk.json?.site;
  const st = site ? await N.call('POST', `/api/sites/${site.id}/start`, {}, nOwner) : null;
  check('سایتِ پویا روی گره روشن شد', st?.status === 200 && await until(() => portOpen(SITE_PORT)), JSON.stringify(mk.json || mk).slice(0, 300) + JSON.stringify(st?.json));
  const tun0 = await until(async () => (await N.call('GET', '/api/site-server/tunnel', undefined, nOwner)).json?.status === 'running' || null, 15000);
  check('تونلِ (ساختگیِ) گره روشن است', Boolean(tun0), JSON.stringify((await N.call('GET', '/api/site-server/tunnel', undefined, nOwner)).json).slice(0, 200));

  /* ══════════════ فقط مالک ══════════════ */
  console.log('── فقط مالک و احرازِ دوباره ──');
  const anon = await C.call('GET', '/api/fleet');
  check('⛔ بی ورود ۴۰۱', anon.status === 401, JSON.stringify(anon));
  const l2 = await C.call('GET', '/api/fleet', undefined, admin2);
  check('⛔ مدیرِ دوم فهرست را نمی‌بیند (۴۰۳ owner_only)', l2.status === 403 && l2.json?.error === 'owner_only', JSON.stringify(l2));
  staleSession(DATA_C, 'admin2');
  const c2 = await C.call('POST', '/api/fleet/codes', {}, admin2);
  check('⛔ مدیرِ دوم «افزودنِ سرور»: ۴۰۳ owner_only پیش از رمز (نشستِ کهنه هم reauth نمی‌گیرد)', c2.status === 403 && c2.json?.error === 'owner_only', JSON.stringify(c2));
  staleSession(DATA_C, 'owner');
  const cs = await C.call('POST', '/api/fleet/codes', {}, owner);
  check('⛔ مالک با نشستِ کهنه: reauth_required', cs.status === 403 && cs.json?.error === 'reauth_required', JSON.stringify(cs));
  await C.call('POST', '/api/auth/reauth', { password: 'Owner-Pass-2026' }, owner);
  const ov0 = await C.call('GET', '/api/fleet', undefined, owner);
  check('مالک: نقشِ «مرکز»، تنها، ردیفِ خودش با سرورِ حسابِ روشن', ov0.status === 200 && ov0.json?.role === 'center' && ov0.json.nodes.length === 0
    && ov0.json.self?.apps?.some((a) => a.id === 'account-server' && a.running) && typeof ov0.json.self?.metrics?.cpu === 'number', JSON.stringify(ov0.json).slice(0, 400));

  /* ══════════════ جفت شدن ══════════════ */
  console.log('── جفت شدن: کدِ نادرست، کهنه، درست، دوباره‌مصرف ──');
  const link = (code, extra = {}) => N.call('POST', '/api/fleet/link', { center: C.BASE, code, ...extra }, nOwner);
  const fleetFiles = () => { try { return fs.readdirSync(path.join(DATA_N, 'fleet')); } catch { return []; } };
  const wrong = await link('ABCD-EFGH-JKMN');
  check('⛔ کدِ نادرست ⇒ ۴۰۳ code_invalid', wrong.status === 403 && wrong.json?.error === 'code_invalid', JSON.stringify(wrong));
  check('… و هیچ کلیدی روی دیسکِ گره ننشست، هیچ پیوندی ثبت نشد', fleetFiles().length === 0 && readDb(DATA_N, 'SELECT * FROM fleet_link').length === 0, fleetFiles().join(','));
  const k1 = await C.call('POST', '/api/fleet/codes', {}, owner);
  check('کدِ وصل ساخته شد (۱۲ نویسه، ۱۰ دقیقه — این‌جا کوتاه)', k1.status === 200 && /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(k1.json?.code || '') && k1.json.expiresAt > Date.now(), JSON.stringify(k1));
  codes.push(k1.json?.code);
  await wait(2300);
  const old = await link(k1.json.code);
  check('⛔ کدِ کهنه (سقف گذشت) ⇒ ۴۰۳ code_expired', old.status === 403 && old.json?.error === 'code_expired', JSON.stringify(old));
  const http = await N.call('POST', '/api/fleet/link', { center: 'http://203.0.113.9:4700', code: 'X' }, nOwner);
  check('⛔ مرکزِ اینترنتی با http (نه https) ⇒ ۴۰۰ https_required', http.status === 400 && http.json?.error === 'https_required', JSON.stringify(http));
  const nStale = (staleSession(DATA_N, 'nowner'), await link('ABCD'));
  check('⛔ مالکِ گره با نشستِ کهنه: reauth_required', nStale.status === 403 && nStale.json?.error === 'reauth_required', JSON.stringify(nStale));
  await N.call('POST', '/api/auth/reauth', { password: 'Node-Pass-2026' }, nOwner);

  const k2 = await C.call('POST', '/api/fleet/codes', {}, owner);
  codes.push(k2.json?.code);
  const live = openStream(C.BASE, owner);
  check('جریانِ زندهٔ مرکز باز شد', (await live.ready) === 200);
  const ok = await link(` ${k2.json.code.toLowerCase().replaceAll('-', ' ')} `, { name: 'VPS آلمان' });
  check('کدِ درست (نوشتنِ آزاد: کوچک، فاصله) ⇒ گره وصل شد', ok.status === 200 && ok.json?.link?.status === 'active' && ok.json.link.centerUrl === C.BASE, JSON.stringify(ok));
  const nodeId = ok.json?.link?.nodeId;
  const keyFile = path.join(DATA_N, 'fleet', `node-${nodeId}.key`);
  const kst = fs.existsSync(keyFile) ? fs.statSync(keyFile) : null;
  const dst = fs.statSync(path.join(DATA_N, 'fleet'));
  check('کلیدِ خصوصی فقط در پوشهٔ دادهٔ گره: فایل ‎0600‎، پوشه ‎0700‎', kst && (kst.mode & 0o777) === 0o600 && (dst.mode & 0o777) === 0o700,
    kst ? (kst.mode & 0o777).toString(8) : 'نیست');
  const pem = kst ? fs.readFileSync(keyFile, 'utf8') : '';
  const pemBody = pem.split('\n').filter((l) => l && !l.startsWith('-----')).join('');
  check('کلیدِ خصوصی Ed25519 است', Boolean(pem) && crypto.createPrivateKey(pem).asymmetricKeyType === 'ed25519');
  const again = await link(k2.json.code);
  check('⛔ دوباره وصل شدنِ گرهٔ وصل‌شده ⇒ ۴۰۹ already_linked', again.status === 409 && again.json?.error === 'already_linked', JSON.stringify(again));

  //  کلیدِ خودِ آزمون — همان قرارداد، مستقیم با درِ امضاشده (گرهٔ T)
  const T = generateKeys();
  const joinT = (code, keys = T, extra = {}) => fetch(`${C.BASE}/api/fleet/hub/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signEnvelope({ purpose: 'join', node: '', payload: { code, publicKey: keys.publicKey, name: 'test-node', kind: 'foreign', ...extra }, privateKey: keys.privateKeyPem })),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const reused = await joinT(k2.json.code);
  check('⛔ کدِ دوباره‌مصرف ⇒ ۴۰۳ code_used', reused.status === 403 && reused.json?.error === 'code_used', JSON.stringify(reused));
  const forgedJoin = await fetch(`${C.BASE}/api/fleet/hub/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signEnvelope({ purpose: 'join', node: '', payload: { code: 'whatever', publicKey: T.publicKey }, privateKey: generateKeys().privateKeyPem })),
  });
  check('⛔ وصل با امضای کلیدی جز کلیدِ اعلام‌شده ⇒ ۴۰۱ bad_signature (کد سنجیده نمی‌شود)', forgedJoin.status === 401 && (await forgedJoin.json()).error === 'bad_signature');

  const listed = await until(async () => {
    const r = await C.call('GET', '/api/fleet', undefined, owner);
    const n = r.json?.nodes?.find((x) => x.id === nodeId);
    return n?.online && n.version && n.apps?.length ? r.json : null;
  }, 10000);
  const nRow = listed?.nodes?.find((x) => x.id === nodeId);
  check('فهرستِ مرکز: نام، گونه (vps)، آنلاین، نسخه، آخرین تپش', nRow && nRow.name === 'VPS آلمان' && nRow.kind === 'vps' && nRow.online && nRow.version
    && Date.now() - nRow.lastSeenAt < 3000, JSON.stringify(nRow).slice(0, 400));
  //  پیام پس از رگبار می‌رود (bumpSoon) — نه همان لحظه
  await until(() => live.topics.includes('fleet'), 3000, 100);
  check('صفحهٔ «سرورهای من» زنده است: وصل شدن موضوعِ ‎fleet‎ را بیدار کرد', live.topics.includes('fleet'), JSON.stringify(live.topics) + live.raw.slice(0, 300));
  await wait(1500);
  const quiet0 = live.topics.filter((x) => x === 'fleet').length;
  await wait(2500);
  check('⛔ در سکوت (تپش‌های بی تغییر، هر ۴۰۰ میلی‌ثانیه) صفر پیامِ ‎fleet‎', live.topics.filter((x) => x === 'fleet').length === quiet0,
    `${live.topics.filter((x) => x === 'fleet').length - quiet0} پیام`);
  check('… CPU/حافظه/دیسک از گره', nRow && typeof nRow.metrics?.cpu === 'number' && nRow.metrics.memory?.total > 0 && typeof nRow.metrics.disk?.usage === 'number', JSON.stringify(nRow?.metrics));
  check('… برنامه‌ها و سایت‌های رویش (سرورِ حساب، سایتِ پویا) و تونل', nRow && nRow.apps.some((a) => a.id === 'account-server' && a.running)
    && nRow.apps.some((a) => a.id === `site:${site?.slug}` && a.running && a.dataful) && nRow.tunnel?.running === true, JSON.stringify(nRow?.apps));
  check('⛔ «دو دفتر»: سرورِ حساب روی مرکز و گره هر دو روشن ⇒ هشدار با هر دو نام', listed?.conflicts?.some((c) => c.id === 'account-server' && c.holders.length === 2
    && c.holders.some((h) => h.self) && c.holders.some((h) => h.id === nodeId)), JSON.stringify(listed?.conflicts));
  const nView = await N.call('GET', '/api/fleet', undefined, nOwner);
  check('گره خودش می‌داند: نقشِ «گره»، وصل به همین مرکز، آخرین تپشِ موفق', nView.json?.role === 'node' && nView.json?.node?.linked === true
    && nView.json.node.link.centerUrl === C.BASE && nView.json.node.link.lastOkAt > 0, JSON.stringify(nView.json?.node));
  const selfOnNode = await N.call('POST', '/api/fleet/self/maintenance', { on: true }, nOwner);
  check('⛔ روی گره «نگه‌داریِ خودم» نه — کارِ مرکز است (۴۰۹)', selfOnNode.status === 409 && selfOnNode.json?.error === 'node_managed_by_center', JSON.stringify(selfOnNode));
  const codeOnNode = await N.call('POST', '/api/fleet/codes', {}, nOwner);
  check('⛔ گره «افزودنِ سرور» نمی‌سازد (۴۰۹ is_node)', codeOnNode.status === 409 && codeOnNode.json?.error === 'is_node', JSON.stringify(codeOnNode));

  /* ══════════════ پیامِ امضاشده ══════════════ */
  console.log('── امضا، زمان و nonce ──');
  const k3 = await C.call('POST', '/api/fleet/codes', {}, owner);
  codes.push(k3.json?.code);
  const jt = await joinT(k3.json.code);
  const jr = readEnvelope(jt.json?.reply, 'reply');
  const centerKey = jr.ok ? jr.env.body.centerKey : null;
  const tId = jr.ok ? jr.env.node : null;
  check('گرهٔ آزمون (T) وصل شد؛ پاسخ با کلیدِ مرکز امضاشده', jt.status === 200 && centerKey && verifyEnvelope(jr.env, centerKey), JSON.stringify(jt.json).slice(0, 300));
  const hb = (env, base = C.BASE) => fetch(`${base}/api/fleet/hub/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env) })
    .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
  const rep = { name: 'test-node', kind: 'foreign', version: '0.0.1', apps: [], metrics: { cpu: 12.5 } };
  const good = signEnvelope({ purpose: 'heartbeat', node: tId, payload: { report: rep }, privateKey: T.privateKeyPem });
  const g1 = await hb(good);
  const g1r = readEnvelope(g1.json?.reply, 'reply');
  check('تپشِ درست ⇒ ۲۰۰ و پاسخِ امضاشده با همان nonce و «نگه‌داری: خاموش»', g1.status === 200 && g1r.ok && verifyEnvelope(g1r.env, centerKey)
    && g1r.env.nonce === good.nonce && g1r.env.body.maintenance === false, JSON.stringify(g1));
  const g2 = await hb(good);
  check('⛔ همان پیام دوباره (nonce ِ تکراری) ⇒ ۴۰۹ replay', g2.status === 409 && g2.json?.error === 'replay', JSON.stringify(g2));
  const forged = signEnvelope({ purpose: 'heartbeat', node: tId, payload: { report: rep }, privateKey: generateKeys().privateKeyPem });
  const f1 = await hb(forged);
  check('⛔ امضای جعلی (کلیدِ دیگر) ⇒ ۴۰۱ bad_signature', f1.status === 401 && f1.json?.error === 'bad_signature', JSON.stringify(f1));
  const tampered = { ...signEnvelope({ purpose: 'heartbeat', node: tId, payload: { report: rep }, privateKey: T.privateKeyPem }) };
  tampered.payload = tampered.payload.replace('test-node', 'evil-node');
  const f2 = await hb(tampered);
  check('⛔ بدنهٔ دست‌خورده پس از امضا ⇒ ۴۰۱ bad_signature', f2.status === 401 && f2.json?.error === 'bad_signature', JSON.stringify(f2));
  const oldTs = await hb(signEnvelope({ purpose: 'heartbeat', node: tId, payload: { report: rep }, privateKey: T.privateKeyPem, ts: Date.now() - 6 * 60 * 1000 }));
  check('⛔ ‎ts‎ ِ کهنه (۶ دقیقه پیش) ⇒ ۴۰۱ stale_ts', oldTs.status === 401 && oldTs.json?.error === 'stale_ts' && Number.isFinite(oldTs.json?.serverTime), JSON.stringify(oldTs));
  const futTs = await hb(signEnvelope({ purpose: 'heartbeat', node: tId, payload: { report: rep }, privateKey: T.privateKeyPem, ts: Date.now() + 6 * 60 * 1000 }));
  check('⛔ ‎ts‎ ِ آینده (۶ دقیقه بعد) ⇒ ۴۰۱ stale_ts', futTs.status === 401 && futTs.json?.error === 'stale_ts', JSON.stringify(futTs));
  const wrongPurpose = await hb({ ...signEnvelope({ purpose: 'leave', node: tId, payload: { report: rep }, privateKey: T.privateKeyPem }), purpose: 'heartbeat' });
  check('⛔ امضای «جدا شدن» جای «تپش» نمی‌نشیند ⇒ ۴۰۱', wrongPurpose.status === 401 && wrongPurpose.json?.error === 'bad_signature', JSON.stringify(wrongPurpose));
  const unknown = await hb(signEnvelope({ purpose: 'heartbeat', node: 'nobody-nobody-1234', payload: {}, privateKey: T.privateKeyPem }));
  check('⛔ گرهٔ ناشناس ⇒ ۴۰۱ unknown_node', unknown.status === 401 && unknown.json?.error === 'unknown_node', JSON.stringify(unknown));
  const junk = await hb({ v: 1, purpose: 'heartbeat', node: tId, ts: 'x' });
  check('⛔ پاکتِ بدشکل ⇒ ۴۰۰', junk.status === 400 && junk.json?.error === 'bad_envelope', JSON.stringify(junk));
  const pub = await hb(signEnvelope({ purpose: 'heartbeat', node: tId, payload: { report: rep }, privateKey: T.privateKeyPem }), `http://127.0.0.1:${C_PORT + 1}`);
  check('درِ عمومی (راهِ تونل، پورتِ ‎+1‎) هم تپشِ امضاشده را می‌پذیرد', pub.status === 200 && pub.json?.ok === true, JSON.stringify(pub));
  const pubOwner = await fetch(`http://127.0.0.1:${C_PORT + 1}/api/fleet`).then((r) => r.status);
  check('⛔ کارهای مالک (‎/api/fleet‎) روی درِ عمومی نیستند (۴۰۴)', pubOwner === 404, String(pubOwner));

  /* ══════════════ آفلاین ══════════════ */
  console.log('── تپش نرسد ⇒ پس از سقف «آفلاین» ──');
  const offline = await until(async () => {
    const r = await C.call('GET', '/api/fleet', undefined, owner);
    const t = r.json?.nodes?.find((x) => x.id === tId);
    const n = r.json?.nodes?.find((x) => x.id === nodeId);
    return t && t.online === false && n?.online === true ? { t, n } : null;
  }, 8000, 300);
  check('گرهٔ T بی تپش ⇒ «آفلاین» (سقفِ آزمون ۳ ثانیه)؛ N با تپشِ پیوسته آنلاین می‌ماند', Boolean(offline), JSON.stringify(offline));

  /* ══════════════ حالتِ نگه‌داری ══════════════ */
  console.log('── حالتِ نگه‌داری: روشن ⇒ گره می‌ایستد، خاموش ⇒ برمی‌گردد ──');
  const m2 = await C.call('POST', `/api/fleet/nodes/${nodeId}/maintenance`, { on: true }, admin2);
  check('⛔ مدیرِ دوم نگه‌داری نمی‌زند (۴۰۳ owner_only)', m2.status === 403 && m2.json?.error === 'owner_only', JSON.stringify(m2));
  staleSession(DATA_C, 'owner');
  const mStale = await C.call('POST', `/api/fleet/nodes/${nodeId}/maintenance`, { on: true }, owner);
  check('⛔ بی احرازِ دوباره نگه‌داری رد', mStale.status === 403 && mStale.json?.error === 'reauth_required', JSON.stringify(mStale));
  await C.call('POST', '/api/auth/reauth', { password: 'Owner-Pass-2026' }, owner);
  const fleetBefore = live.topics.filter((x) => x === 'fleet').length;
  const mOn = await C.call('POST', `/api/fleet/nodes/${nodeId}/maintenance`, { on: true }, owner);
  check('مالک: «غیرفعال» برای گره', mOn.status === 200 && mOn.json?.maintenance === true, JSON.stringify(mOn));
  const applied = await until(async () => {
    const r = await N.call('GET', '/api/fleet', undefined, nOwner);
    return r.json?.maintenance?.active && r.json.maintenance.source === 'center' ? r.json : null;
  }, 10000);
  check('گره در تپشِ بعدی به نگه‌داری رفت (به خواستِ مرکز)', Boolean(applied), JSON.stringify((await N.call('GET', '/api/fleet', undefined, nOwner)).json?.maintenance));
  check('… سرورِ حسابِ گره ایستاد', await until(async () => !(await accountAlive(DATA_N)), 10000));
  check('… سایتِ پویای گره ایستاد', await until(async () => !(await portOpen(SITE_PORT)), 10000));
  const tunOff = await until(async () => (await N.call('GET', '/api/site-server/tunnel', undefined, nOwner)).json?.status === 'stopped' || null, 8000);
  check('… تونلِ گره ایستاد (تنظیمِ «روشن بماند» ِ مالک دست نخورد)', Boolean(tunOff)
    && (await N.call('GET', '/api/site-server/tunnel', undefined, nOwner)).json?.autostart === true);
  check('… پمپ‌ها: کدِ پمپ دست نخورد — درِ پمپ روی پنلِ گره همان‌طور جواب می‌دهد', (await N.call('GET', '/api/stations-admin', undefined, nOwner)).status !== 500);
  check('… هیچ داده‌ای پاک نشد (پوشهٔ سرورِ حساب و سایت سرِ جایش)', fs.existsSync(path.join(DATA_N, 'account-server', 'pg', 'heartbeat')) && fs.existsSync(path.join(siteDir, 'server.js')));
  const cSeen = await until(async () => {
    const r = await C.call('GET', '/api/fleet', undefined, owner);
    const n = r.json?.nodes?.find((x) => x.id === nodeId);
    return n?.maintenance?.applied && n.online && !r.json.conflicts.some((c) => c.id === 'account-server') ? r.json : null;
  }, 8000);
  check('مرکز می‌بیند: «در نگه‌داری» اعمال شد، هنوز آنلاین، و «دو دفتر» ِ سرورِ حساب برطرف', Boolean(cSeen));
  check('… و هر گام (خواستِ مالک، اعمال در گره) صفحه را بیدار کرد', await until(() => live.topics.filter((x) => x === 'fleet').length >= fleetBefore + 2, 3000, 100), `${fleetBefore} ⇐ ${live.topics.filter((x) => x === 'fleet').length}`);

  //  پنلِ گره در نگه‌داری دوباره بالا می‌آید ⇒ هیچ چیزی خودکار روشن نمی‌شود
  await N.stop();
  N = await boot(N_PORT, DATA_N, N_ENV);
  check('پنلِ گره در نگه‌داری دوباره بالا آمد', N.up, N.out().slice(-400));
  await wait(2500);
  check('⛔ … سرورِ حساب، سایت و تونل خودکار روشن نشدند', !(await accountAlive(DATA_N)) && !(await portOpen(SITE_PORT))
    && (await N.call('GET', '/api/site-server/tunnel', undefined, nOwner)).json?.status !== 'running', N.out().slice(-400));
  check('… و پیامِ روشنِ نگه‌داری در کنسول', /حالتِ نگه‌داری روشن است/.test(N.out()));

  const mOff = await C.call('POST', `/api/fleet/nodes/${nodeId}/maintenance`, { on: false }, owner);
  check('مالک: «فعال» برای گره', mOff.status === 200 && mOff.json?.maintenance === false, JSON.stringify(mOff));
  live.ctrl.abort();
  check('… سرورِ حسابِ گره برگشت', await until(() => accountAlive(DATA_N), 12000));
  check('… سایتِ پویای گره برگشت', await until(() => portOpen(SITE_PORT), 12000));
  check('… تونلِ گره برگشت', Boolean(await until(async () => (await N.call('GET', '/api/site-server/tunnel', undefined, nOwner)).json?.status === 'running' || null, 12000)));
  const back = await until(async () => {
    const r = await C.call('GET', '/api/fleet', undefined, owner);
    return r.json?.conflicts?.some((c) => c.id === 'account-server') ? r.json : null;
  }, 8000);
  check('… و «دو دفتر» دوباره دیده می‌شود (هر دو روشن)', Boolean(back));

  console.log('── نگه‌داریِ خودِ مرکز ──');
  const selfOn = await C.call('POST', '/api/fleet/self/maintenance', { on: true }, owner);
  check('مرکز خودش در نگه‌داری', selfOn.status === 200 && selfOn.json?.maintenance?.active === true && selfOn.json.maintenance.source === 'self', JSON.stringify(selfOn));
  check('… سرورِ حسابِ مرکز ایستاد', await until(async () => !(await accountAlive(DATA_C)), 10000));
  const selfOff = await C.call('POST', '/api/fleet/self/maintenance', { on: false }, owner);
  check('… و برگشت', selfOff.status === 200 && selfOff.json?.maintenance?.active === false && await until(() => accountAlive(DATA_C), 12000), JSON.stringify(selfOff));

  /* ══════════════ جدا کردن ══════════════ */
  console.log('── جدا کردن ⇒ تپشِ بعدی رد ──');
  const r2 = await C.call('POST', `/api/fleet/nodes/${nodeId}/revoke`, {}, admin2);
  check('⛔ مدیرِ دوم جدا نمی‌کند (۴۰۳ owner_only)', r2.status === 403 && r2.json?.error === 'owner_only', JSON.stringify(r2));
  staleSession(DATA_C, 'owner');
  const rStale = await C.call('POST', `/api/fleet/nodes/${nodeId}/revoke`, {}, owner);
  check('⛔ بی احرازِ دوباره جدا کردن رد', rStale.status === 403 && rStale.json?.error === 'reauth_required', JSON.stringify(rStale));
  await C.call('POST', '/api/auth/reauth', { password: 'Owner-Pass-2026' }, owner);
  const rv = await C.call('POST', `/api/fleet/nodes/${nodeId}/revoke`, {}, owner);
  check('مالک: «جدا کردن»', rv.status === 200, JSON.stringify(rv));
  const tRev = await hb(signEnvelope({ purpose: 'heartbeat', node: tId, payload: { report: rep }, privateKey: T.privateKeyPem }));
  check('گرهٔ T هنوز وصل است (فقط N جدا شد)', tRev.status === 200, JSON.stringify(tRev));
  const nGone = await until(async () => {
    const r = await N.call('GET', '/api/fleet', undefined, nOwner);
    return r.json?.node?.linked === false && r.json.node.link?.status === 'revoked' ? r.json : null;
  }, 8000);
  check('تپشِ بعدیِ N ⇒ ۴۰۳ node_revoked (امضاشده) ⇒ گره پیوند را «جدا شده» ثبت کرد', Boolean(nGone), JSON.stringify((await N.call('GET', '/api/fleet', undefined, nOwner)).json?.node));
  const rowsN = readDb(DATA_C, 'SELECT status, revoked_by, public_key FROM fleet_nodes WHERE id = ?', nodeId);
  check('… ردیفِ گره در مرکز پاک نشد (status=revoked، به دستِ مالک)', rowsN[0]?.status === 'revoked' && rowsN[0]?.revoked_by === 'owner');
  check('… کلیدِ خصوصیِ گره هم پاک نشد (فقط بی‌اثر)', fs.existsSync(keyFile));
  //  T با امضای درست ولی پس از جدا شدن
  await C.call('POST', `/api/fleet/nodes/${tId}/revoke`, {}, owner);
  const tEnv = signEnvelope({ purpose: 'heartbeat', node: tId, payload: { report: rep }, privateKey: T.privateKeyPem });
  const tAfter = await hb(tEnv);
  const tR = readEnvelope(tAfter.json?.reply, 'reply');
  check('⛔ تپشِ گرهٔ جداشده ⇒ ۴۰۳ node_revoked با پاسخِ امضاشدهٔ مرکز', tAfter.status === 403 && tAfter.json?.error === 'node_revoked'
    && tR.ok && verifyEnvelope(tR.env, centerKey) && tR.env.body.revoked === true && tR.env.nonce === tEnv.nonce, JSON.stringify(tAfter));
  const mRev = await C.call('POST', `/api/fleet/nodes/${nodeId}/maintenance`, { on: true }, owner);
  check('⛔ نگه‌داری برای گرهٔ جداشده ⇒ ۴۰۹', mRev.status === 409, JSON.stringify(mRev));

  /* ══════════════ ابزارِ خطِ فرمان ══════════════ */
  console.log('── node scripts/join.mjs <نشانی> <کد> (کلیدِ محلی) ──');
  const k4 = await C.call('POST', '/api/fleet/codes', {}, owner);
  codes.push(k4.json?.code);
  const cli = (...a) => spawnSync(process.execPath, [path.join(SERVER_DIR, 'scripts', 'join.mjs'), ...a, '--port', String(N_PORT), '--data-dir', DATA_N], { encoding: 'utf8', timeout: 30000 });
  const j = cli(C.BASE, k4.json.code, '--name', 'cli-node', '--kind', 'hosting');
  check('ابزار وصل کرد (کدِ ۰)', j.status === 0 && /وصل شد/.test(j.stdout), j.stdout + j.stderr);
  const cliRow = await until(async () => {
    const r = await C.call('GET', '/api/fleet', undefined, owner);
    return r.json?.nodes?.find((x) => x.name === 'cli-node' && x.kind === 'hosting' && x.online && x.status === 'active') || null;
  }, 8000);
  check('… مرکز گرهٔ تازه را آنلاین می‌بیند (نام و گونه از ابزار)', Boolean(cliRow));
  const jBad = cli(C.BASE, 'ZZZZ-ZZZZ-ZZZZ');
  check('⛔ ابزار: کدِ دوم روی گرهٔ وصل ⇒ کدِ ۱ با پیام', jBad.status === 1 && /وصل است/.test(jBad.stdout), jBad.stdout);
  const lv = cli('--leave');
  check('ابزار: جدا شدن، مرکز خبردار شد', lv.status === 0 && /جدا شد/.test(lv.stdout) && !/خبردار نشد/.test(lv.stdout), lv.stdout + lv.stderr);
  const cliGone = readDb(DATA_C, 'SELECT status, revoked_by FROM fleet_nodes WHERE id = ?', cliRow?.id || '');
  check('… در مرکز همان گره «جدا شده» به دستِ خودِ گره', cliGone[0]?.status === 'revoked' && cliGone[0]?.revoked_by === 'node', JSON.stringify(cliGone));
  const wrongKey = spawnSync(process.execPath, [path.join(SERVER_DIR, 'scripts', 'join.mjs'), C.BASE, 'X', '--port', String(N_PORT), '--data-dir', path.join(tmp, 'nowhere')], { encoding: 'utf8' });
  check('⛔ ابزار بی کلیدِ محلیِ درست ⇒ کدِ ۱', wrongKey.status === 1 && /کلیدِ محلی/.test(wrongKey.stdout), wrongKey.stdout);
  const fake = await fetch(`${N.BASE}/api/fleet/link`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Key': 'f'.repeat(48) }, body: JSON.stringify({ center: C.BASE, code: 'X' }) });
  check('⛔ کلیدِ محلیِ نادرست ⇒ ۴۰۱', fake.status === 401, String(fake.status));

  /* ══════════════ رازها ══════════════ */
  console.log('── هیچ رازی در دیتابیس، دفتر یا لاگ ──');
  const codeForms = codes.filter(Boolean).flatMap((c) => [c, c.replaceAll('-', '')]);
  const hitsC = filesContain(DATA_C, codeForms);
  check('هیچ کدِ وصل در پوشهٔ دادهٔ مرکز (دیتابیس، WAL، دفتر)', hitsC.length === 0, hitsC.join(' '));
  check('هیچ کدِ وصل در لاگِ هیچ‌کدام از دو پنل', !codeForms.some((c) => C.out().includes(c) || N.out().includes(c)));
  const hitsN = filesContain(DATA_N, [pemBody.slice(0, 40)]).filter((h) => !h.startsWith(path.join('fleet', 'node-')));
  check('کلیدِ خصوصی جز فایلِ خودش هیچ‌جای پوشهٔ دادهٔ گره نیست (دیتابیس، دفتر)', Boolean(pemBody) && hitsN.length === 0, hitsN.join(' '));
  check('کلیدِ خصوصی در لاگِ گره نیست', Boolean(pemBody) && !N.out().includes(pemBody.slice(0, 40)));
  const auditRows = readDb(DATA_C, "SELECT action, ok, detail FROM audit_log WHERE action LIKE 'panel.fleet.%'");
  check('دفتر: ساختنِ کد، نگه‌داری، جدا کردن و وصل/ردِ گره ثبت شد', ['panel.fleet.code', 'panel.fleet.maintenance', 'panel.fleet.revoke', 'panel.fleet.node_joined'].every((a) => auditRows.some((r) => r.action === a))
    && auditRows.some((r) => r.action === 'panel.fleet.node_joined' && r.ok === 0 && /code_(invalid|expired|used)/.test(r.detail || '')), JSON.stringify(auditRows).slice(0, 400));
} catch (e) {
  check('بی خطای پیش‌بینی‌نشده', false, e.stack);
} finally {
  await Promise.all([C?.stop(), N?.stop()]);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} سرورهای من: ${passed} سبز، ${failed} قرمز`);
process.exit(failed ? 1 : 0);
