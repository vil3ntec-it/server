// ---------------------------------------------------------------------------
//  «هاستِ اشتراکی» (۱.۵۱.۱) — بستهٔ zip، نمایندهٔ هاست و قاعدهٔ جابه‌جایی، روی مرکزِ واقعی
//      node test/host-agent.mjs
//
//    ⛔ بسته: سرورِ حساب + نماینده + نشانی و کلیدِ عمومیِ مرکز — بی node_modules، بی ‎.env‎، بی داده، بی کدِ وصل؛ فقط مالک
//    ⛔ نماینده با کدِ درست وصل می‌شود (پاسخِ امضاشده با کلیدِ سنجاق‌شدهٔ بسته)، گونهٔ ‎host‎؛ «وصل شد» فقط پس از نخستین تپش
//    ⛔ کدِ کهنه، کدِ مصرف‌شده و کدِ نادرست ⇒ رد، و هیچ کلید یا پیوندی روی دیسکِ نماینده
//    ⛔ کد نه در پوشهٔ نماینده، نه در خروجی‌اش، نه در دیتابیس/دفترِ مرکز؛ کلیدِ خصوصی ۶۰۰
//    ⛔ نماینده هیچ درِ ورودی ندارد؛ فقط سرورِ حساب (در همان پروسه) پورت دارد
//    ⛔ جدا کردن ⇒ تپشِ بعدی ‎node_revoked‎ ِ امضاشده ⇒ نماینده می‌ایستد
//    ⛔ جابه‌جایی به هاست: فقط سرورِ حساب، و فقط اگر نماینده دریافتِ بسته را بگوید (امروز نه ⇒ ‎host_manual_import‎)
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const SERVER_DIR = path.join(import.meta.dirname, '..');
const PORT = Number(process.env.TEST_PORT || 5235);
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 600) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-host-agent-'));
process.env.HLP_DATA_DIR = path.join(tmp, 'unit');

/* ── سرورِ حسابِ ساختگی (CommonJS، مثلِ shop/server) با چیزهایی که **نباید** در بسته بیایند ── */
const ACCT = path.join(tmp, 'acct');
fs.mkdirSync(path.join(ACCT, 'src'), { recursive: true });
fs.mkdirSync(path.join(ACCT, 'node_modules', 'leftpad'), { recursive: true });
fs.mkdirSync(path.join(ACCT, 'data', 'pg'), { recursive: true });
fs.writeFileSync(path.join(ACCT, 'package.json'), JSON.stringify({ name: 'fake-account', version: '9.9.9', main: 'src/index.js' }));
fs.writeFileSync(path.join(ACCT, 'node_modules', 'leftpad', 'index.js'), 'module.exports = 1;');
fs.writeFileSync(path.join(ACCT, 'data', 'pg', 'ledger'), 'SECRET-LEDGER-ROW');
fs.writeFileSync(path.join(ACCT, '.env'), 'JWT_SECRET=SUPER-SECRET-VALUE\n');
fs.writeFileSync(path.join(ACCT, 'src', 'index.js'), `'use strict';
const http = require('node:http');
http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, status: 'ok', version: '9.9.9' })); })
  .listen(Number(process.env.PORT || 0), '127.0.0.1');
`);

async function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

/* ── مرکزِ واقعی (کدِ ۸ ثانیه‌ای تا «کهنه» سنجیدنی باشد؛ آفلاین پس از ۳ ثانیه) ── */
const DATA = path.join(tmp, 'center');
fs.mkdirSync(DATA, { recursive: true });
const center = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SERVER_DIR, 'src', 'index.js')], {
  env: { ...process.env, HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: DATA, HLP_SITES_ROOT: path.join(tmp, 'sites'),
    HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0',
    HLP_SITESYNC_PORT: String(PORT + 1), HLP_DISCOVERY_PORT: String(PORT + 2), HLP_RATE_LOGIN: '1000', HLP_AUTH_RATE_LIMIT: '100000',
    HLP_ACCOUNT_DIR: ACCT, HLP_UPDATE_AUTO: '0', HLP_FLEET_CODE_TTL_MS: '8000', HLP_FLEET_OFFLINE_MS: '3000', HLP_STATIONS: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let centerOut = '';
center.stdout.on('data', (d) => (centerOut += d));
center.stderr.on('data', (d) => (centerOut += d));
const BASE = `http://127.0.0.1:${PORT}`;
const call = async (method, url, body, token) => {
  const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString('utf8')); } catch { /* zip */ }
  return { status: r.status, json, buf, type: r.headers.get('content-type') || '' };
};
const agents = [];
let agentOut = '';
function runAgent(bundleRoot, env) {
  const port = env.PORT;
  const child = spawn(process.execPath, [path.join(bundleRoot, 'vill3n-agent', 'start.cjs')], { cwd: bundleRoot, env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => (agentOut += d));
  child.stderr.on('data', (d) => (agentOut += d));
  agents.push(child);
  return child;
}
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
const allText = (dir) => {
  const out = [];
  const walk = (d) => { for (const n of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, n.name); if (n.isDirectory()) walk(f); else out.push(fs.readFileSync(f).toString('latin1') + fs.readFileSync(f).toString('utf8')); } };
  if (fs.existsSync(dir)) walk(dir);
  return out.join('\n');
};

try {
  for (let i = 0; i < 160; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* */ } await wait(250); }
  const PW = 'HostAgent!2026';
  await call('POST', '/api/auth/setup', { username: 'owner', password: PW });
  const owner = (await call('POST', '/api/auth/login', { username: 'owner', password: PW })).json?.token;
  await call('POST', '/api/auth/users', { username: 'adm2', password: 'HostAgent-adm2!', role: 'admin' }, owner);
  const adm2 = (await call('POST', '/api/auth/login', { username: 'adm2', password: 'HostAgent-adm2!' })).json?.token;
  check('مرکز بالا آمد؛ مالک و مدیرِ دوم', Boolean(owner && adm2), centerOut.slice(-400));

  console.log('\n── کدِ وصل: نشانی‌های مرکز و حالِ کد ──');
  const c1 = await call('POST', '/api/fleet/codes', {}, owner);
  const local = c1.json?.centers?.find((c) => c.reach === 'local');
  check('«افزودنِ سرور» ⇒ کد، شناسهٔ ردیف و نشانی‌های مرکز (این‌جا «همین کامپیوتر»)', c1.status === 200 && /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(c1.json?.code || '')
    && /^[A-Za-z0-9_-]{16,}$/.test(c1.json?.codeId || '') && local?.url === BASE, JSON.stringify(c1.json));
  const st0 = await call('GET', `/api/fleet/codes/${c1.json.codeId}`, undefined, owner);
  check('حالِ کد: باز، وصل نه — و خودِ کد در پاسخ نیست', st0.status === 200 && st0.json?.state === 'open' && st0.json?.connected === false && !JSON.stringify(st0.json).includes(c1.json.code), JSON.stringify(st0.json));
  check('⛔ مدیرِ دوم: حالِ کد و بسته ۴۰۳ (فقط مالک)', (await call('GET', `/api/fleet/codes/${c1.json.codeId}`, undefined, adm2)).status === 403
    && (await call('GET', `/api/fleet/host-bundle?center=${encodeURIComponent(BASE)}`, undefined, adm2)).status === 403);
  check('شناسهٔ ناشناخته ⇒ ۴۰۴', (await call('GET', '/api/fleet/codes/nope-nope-nope-nope', undefined, owner)).status === 404);

  console.log('\n── بستهٔ هاست ──');
  check('⛔ نشانیِ مرکزِ بیگانه ⇒ ۴۰۰', (await call('GET', `/api/fleet/host-bundle?center=${encodeURIComponent('https://evil.example')}`, undefined, owner)).status === 400);
  const zip = await call('GET', `/api/fleet/host-bundle?center=${encodeURIComponent(BASE)}`, undefined, owner);
  check('بسته ⇒ ۲۰۰ application/zip', zip.status === 200 && zip.type.includes('zip') && zip.buf.length > 200, `${zip.status} ${zip.type}`);
  const zipFile = path.join(tmp, 'vill3n-host.zip');
  fs.writeFileSync(zipFile, zip.buf);
  const { extractZip, readZipIndex } = await import('../src/control/zip.js');
  const index = (await readZipIndex(zipFile)).entries.map((e) => e.name);
  const names = index.map(String);
  const BUNDLE = path.join(tmp, 'bundle');
  await extractZip(zipFile, BUNDLE);
  const ROOT = path.join(BUNDLE, 'vill3n-host');
  check('چیدمان: کدِ سرورِ حساب + vill3n-agent/{start.cjs,agent.cjs,center.json} + README', ['package.json', 'src/index.js', 'vill3n-agent/start.cjs', 'vill3n-agent/agent.cjs', 'vill3n-agent/center.json', 'README-fa.txt']
    .every((f) => fs.existsSync(path.join(ROOT, f))), names.join(' '));
  check('⛔ بی node_modules، بی ‎.env‎، بی داده', !names.some((n) => /node_modules|(^|\/)\.env|\/data\//.test(n)) && !fs.existsSync(path.join(ROOT, '.env')) && !fs.existsSync(path.join(ROOT, 'data')), names.join(' '));
  const cj = JSON.parse(fs.readFileSync(path.join(ROOT, 'vill3n-agent', 'center.json'), 'utf8'));
  check('center.json فقط نشانی، کلیدِ **عمومی**، نام و نسخه', JSON.stringify(Object.keys(cj).sort()) === JSON.stringify(['agentVersion', 'builtAt', 'centerKey', 'centerName', 'centerUrl']) && cj.centerUrl === BASE && cj.centerKey.length === 60, JSON.stringify(cj));
  const bundleText = allText(BUNDLE);
  check('⛔ هیچ راز در بسته: نه کدِ وصل، نه JWT_SECRET، نه دادهٔ دفتر، نه کلیدِ خصوصی', !bundleText.includes(c1.json.code) && !bundleText.includes('SUPER-SECRET-VALUE')
    && !bundleText.includes('SECRET-LEDGER-ROW') && !/BEGIN PRIVATE KEY/.test(bundleText));
  const agentSrc = fs.readFileSync(path.join(ROOT, 'vill3n-agent', 'agent.cjs'), 'utf8') + fs.readFileSync(path.join(ROOT, 'vill3n-agent', 'start.cjs'), 'utf8');
  check('⛔ نماینده هیچ درِ ورودی ندارد (نه createServer، نه listen)', !/createServer|\.listen\(/.test(agentSrc.replace(/\/\/.*$/gm, '')));

  console.log('\n── کدِ نادرست / وصل با کدِ درست ──');
  const agentReq = createRequire(path.join(ROOT, 'vill3n-agent', 'agent.cjs'));
  const agentMod = agentReq('./agent.cjs');
  const AGENT_DIR = path.join(ROOT, 'vill3n-agent');
  const bad = await agentMod.join({ agentDir: AGENT_DIR, dir: path.join(tmp, 'a-bad'), code: 'ZZZZ-ZZZZ-ZZZZ' });
  check('⛔ کدِ نادرست ⇒ code_invalid و هیچ کلیدی روی دیسک', !bad.ok && bad.error === 'code_invalid' && !fs.existsSync(path.join(tmp, 'a-bad', 'node.key')), JSON.stringify(bad));
  const DIR1 = path.join(tmp, 'a1');
  const j1 = await agentMod.join({ agentDir: AGENT_DIR, dir: DIR1, code: c1.json.code, name: 'هاستِ آزمایشی' });
  check('کدِ درست ⇒ وصل (پاسخِ امضاشده با کلیدِ سنجاق‌شدهٔ بسته)', j1.ok && j1.link?.centerKey === cj.centerKey && /^[A-Za-z0-9_-]{8,}$/.test(j1.link?.nodeId || ''), JSON.stringify(j1));
  const st1 = await call('GET', `/api/fleet/codes/${c1.json.codeId}`, undefined, owner);
  check('⛔ پیش از نخستین تپش: «مصرف شد» ولی هنوز «وصل شد» نه', st1.json?.state === 'used' && st1.json?.connected === false && st1.json?.node?.beat === false && st1.json?.node?.kind === 'host', JSON.stringify(st1.json));
  await wait(20);
  const b1 = await agentMod.beat({ agentDir: AGENT_DIR, dir: DIR1, accountRunning: () => true });
  const st2 = await call('GET', `/api/fleet/codes/${c1.json.codeId}`, undefined, owner);
  check('⛔ نخستین تپشِ امضاشده ⇒ «وصل شد»', b1.ok && st2.json?.connected === true && st2.json?.node?.beat === true, `${JSON.stringify(b1)} ${JSON.stringify(st2.json)}`);
  const fleet = await call('GET', '/api/fleet', undefined, owner);
  const hostNode = fleet.json?.nodes?.find((n) => n.id === j1.link.nodeId);
  check('در فهرست: گونهٔ host، نماینده، سرورِ حسابِ روشن', hostNode?.kind === 'host' && hostNode?.agent === 'host' && hostNode?.apps?.some((a) => a.id === 'account-server' && a.running), JSON.stringify(hostNode));
  const keyStat = fs.statSync(path.join(DIR1, 'node.key'));
  check('کلیدِ خصوصی ۶۰۰ و پیوند در پوشهٔ نماینده', (keyStat.mode & 0o777) === 0o600 && JSON.parse(fs.readFileSync(path.join(DIR1, 'link.json'), 'utf8')).status === 'active', (keyStat.mode & 0o777).toString(8));

  console.log('\n── کدِ دوباره‌مصرف و کهنه ──');
  const reuse = await agentMod.join({ agentDir: AGENT_DIR, dir: path.join(tmp, 'a-reuse'), code: c1.json.code });
  check('⛔ همان کد دوباره ⇒ code_used و هیچ کلیدی', !reuse.ok && reuse.error === 'code_used' && !fs.existsSync(path.join(tmp, 'a-reuse', 'node.key')), JSON.stringify(reuse));
  const c2 = await call('POST', '/api/fleet/codes', {}, owner);
  await wait(8600);
  const old = await agentMod.join({ agentDir: AGENT_DIR, dir: path.join(tmp, 'a-old'), code: c2.json.code });
  check('⛔ کدِ کهنه (بیش از عمرش) ⇒ code_expired و هیچ کلیدی', !old.ok && old.error === 'code_expired' && !fs.existsSync(path.join(tmp, 'a-old', 'node.key')), JSON.stringify(old));
  check('حالِ همان کد: expired', (await call('GET', `/api/fleet/codes/${c2.json.codeId}`, undefined, owner)).json?.state === 'expired');

  console.log('\n── نمایندهٔ واقعی (start.cjs) مثلِ cPanel ──');
  const c3 = await call('POST', '/api/fleet/codes', {}, owner);
  const appPort = await freePort();
  const DIR3 = path.join(tmp, 'a3');
  runAgent(ROOT, { VILL3N_JOIN_CODE: c3.json.code, VILL3N_AGENT_DIR: DIR3, VILL3N_AGENT_HEARTBEAT_MS: '1000', VILL3N_AGENT_NAME: 'cpanel-test', PORT: appPort });
  const conn = await until(async () => (await call('GET', `/api/fleet/codes/${c3.json.codeId}`, undefined, owner)).json?.connected === true, 15000);
  check('⛔ با ‎VILL3N_JOIN_CODE‎ در محیط: وصل و «وصل شد» در صفحه', conn === true, agentOut.slice(-600));
  const acctUp = await until(async () => (await fetch(`http://127.0.0.1:${appPort}/`)).ok, 5000);
  check('سرورِ حساب در همان پروسه روی پورتِ هاست جواب می‌دهد', acctUp === true);
  check('⛔ کد نه در خروجیِ نماینده، نه در پوشه‌اش؛ پیامِ «پاک کنید» آمد', !agentOut.includes(c3.json.code) && !allText(DIR3).includes(c3.json.code) && /VILL3N_JOIN_CODE را از «Setup Node.js App» پاک کنید/.test(agentOut), agentOut.slice(-400));
  const d = new DatabaseSync(path.join(DATA, 'panel.db'), { readOnly: true });
  const dbDump = JSON.stringify([d.prepare('SELECT * FROM fleet_join_codes').all(), d.prepare('SELECT * FROM cc_audit').all(), d.prepare('SELECT * FROM audit_log').all()]);
  d.close();
  check('⛔ هیچ کدی در دیتابیس/دفترِ مرکز (فقط HMAC)', ![c1, c2, c3].some((c) => dbDump.includes(c.json.code)) && !centerOut.includes(c3.json.code));

  console.log('\n── جابه‌جایی به هاست ──');
  const { hostRule } = await import('../src/fleet/placement.js');
  const host = { name: 'h', agent: 'host', caps: [] };
  check('قاعده: سایت به هاست ⇒ host_account_only', hostRule({ id: 'site:x', type: 'site' }, host)?.code === 'host_account_only');
  check('قاعده: سرورِ حساب به هاستِ بی ‎move-import‎ ⇒ host_manual_import', hostRule({ id: 'account-server', type: 'account' }, host)?.code === 'host_manual_import');
  check('قاعده: سرورِ حساب به هاستی که می‌گیرد ⇒ مجاز؛ پنلِ کامل ⇒ همیشه مجاز', hostRule({ id: 'account-server', type: 'account' }, { ...host, caps: ['move-import:account-server'] }) === null
    && hostRule({ id: 'site:x', type: 'site' }, { name: 'v', agent: null, caps: [] }) === null);
  check('قاعده: هاست مبدأ نمی‌شود', hostRule({ id: 'account-server', type: 'account' }, host, 'from')?.code === 'host_not_source');
  const pv = (await call('GET', '/api/fleet', undefined, owner)).json;
  const acctRow = pv?.placement?.find((a) => a.id === 'account-server');
  const t3 = acctRow?.targets?.find((x) => x.name === 'cpanel-test');
  check('«انتقال به سرورِ دیگر»: هاست در فهرستِ مقصدها، با دلیلِ «دستی»', t3?.agent === 'host' && t3?.blocked === 'host_manual_import', JSON.stringify(acctRow?.targets));
  const mv = await call('POST', '/api/fleet/moves', { app: 'account-server', from: 'self', to: t3?.id, confirm: { app: acctRow?.name, from: pv?.self?.name, to: 'cpanel-test' } }, owner);
  check('⛔ درِ جابه‌جایی همان را می‌گوید (۴۰۹ host_manual_import) — هیچ کاری آغاز نشد', mv.status === 409 && mv.json?.error === 'host_manual_import'
    && !((await call('GET', '/api/fleet', undefined, owner)).json?.moves || []).length, JSON.stringify(mv.json));

  console.log('\n── جدا کردن ──');
  const rv = await call('POST', `/api/fleet/nodes/${j1.link.nodeId}/revoke`, {}, owner);
  const b2 = await agentMod.beat({ agentDir: AGENT_DIR, dir: DIR1 });
  check('⛔ جدا کردن ⇒ تپشِ بعدی node_revoked ِ امضاشده و پیوندِ نماینده «revoked»', rv.status === 200 && b2.revoked === true
    && JSON.parse(fs.readFileSync(path.join(DIR1, 'link.json'), 'utf8')).status === 'revoked', JSON.stringify(b2));
  const b3 = await agentMod.beat({ agentDir: AGENT_DIR, dir: DIR1 });
  check('…و پس از آن دیگر تپشی نمی‌فرستد', b3.ok === false && b3.error === 'not_linked');
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  for (const a of agents) a.kill('SIGTERM');
  center.kill('SIGTERM');
  await wait(500);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
if (failed) console.log('\n' + centerOut.slice(-2000) + '\n---- agent ----\n' + agentOut.slice(-1500));
console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed ? 1 : 0);
