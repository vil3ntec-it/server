// ---------------------------------------------------------------------------
//  وصلِ خودکارِ سرورِ تازه با متغیرِ محیط (۱.۵۱.۱) — ‎install.sh‎ (‎join_center‎) و ‎scripts/join.mjs‎
//      node test/join-env.mjs
//
//  «افزودنِ سرور» یک خط می‌دهد:
//      curl … install.sh | sudo VILL3N_DEPLOY=vps VILL3N_JOIN_CENTER=<مرکز> VILL3N_JOIN_CODE=<کد> bash
//  دو پنلِ واقعی (مرکز C و گرهٔ N)؛ ‎install.sh‎ با ‎VILL3N_SKIP_SYSTEM=1‎ و همهٔ مرحله‌های پیشین «انجام‌شده» (‎.install-state‎) تا
//  فقط ‎join_center‎ بدود — روی همان پوشهٔ دادهٔ پنلِ N:
//    ⛔ کدِ درست ⇒ وصل؛ گزارشِ پایانی «join-center 🆕»؛ گرهٔ ‎vps‎ در فهرستِ مرکز با نخستین تپش
//    ⛔ کدِ کهنه ⇒ «کهنه شده»، نصب نمی‌شکند (کد ۰)، وصل نه
//    ⛔ کدِ مصرف‌شده ⇒ «یک بار مصرف شده»، وصل نه
//    ⛔ کد نه در لاگِ نصب، نه در گزارش، نه در خروجی، نه در فایلی زیرِ ریشهٔ نصب؛ و نه در خطِ فرمانِ ‎join.mjs‎ (فقط محیط)
//    ⛔ ‎join.mjs‎ بی آرگومان، با همان دو متغیر هم وصل می‌شود
// ---------------------------------------------------------------------------
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SERVER_DIR = path.join(import.meta.dirname, '..');
const REPO = path.resolve(SERVER_DIR, '..', '..');
const BASE_PORT = Number(process.env.TEST_PORT || 5265);
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); } else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 700) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-join-env-'));

const panels = [];
async function boot(port, dataDir, env = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(SERVER_DIR, 'src', 'index.js')], {
    env: { ...process.env, HLP_PORT: String(port), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: path.join(path.dirname(dataDir), `sites-${port}`),
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0', HLP_STATIONS: '0',
      HLP_SITESYNC_PORT: String(port + 1), HLP_DISCOVERY_PORT: String(port + 2), HLP_RATE_LOGIN: '1000', HLP_AUTH_RATE_LIMIT: '100000', HLP_UPDATE_AUTO: '0',
      HLP_FLEET_HEARTBEAT_MS: '1000', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  panels.push(child);
  const BASE = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 160; i++) { try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* */ } await wait(250); }
  const call = async (method, url, body, token) => {
    const r = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await r.json(); } catch { /* */ }
    return { status: r.status, json };
  };
  return { BASE, call, out: () => out, dataDir };
}
async function until(fn, ms = 10000, step = 200) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) { try { v = await fn(); } catch { v = null; } if (v) return v; await wait(step); }
  return v;
}
const allText = (dir, skip = () => false) => {
  const out = [];
  const walk = (d) => {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, n.name);
      if (skip(f)) continue;
      if (n.isSymbolicLink()) continue;
      if (n.isDirectory()) walk(f); else { try { out.push(fs.readFileSync(f, 'utf8')); } catch { /* */ } }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.join('\n');
};

try {
  const C = await boot(BASE_PORT, path.join(tmp, 'center'), { HLP_FLEET_CODE_TTL_MS: '6000' });
  //  ریشهٔ «نصب»: کدِ پنل همین مخزن (پیوند)، دادهٔ پنلِ N همان ‎<ریشه>/data/core‎ ِ ‎install.sh‎
  const ROOT = path.join(tmp, 'srv');
  fs.mkdirSync(path.join(ROOT, 'core'), { recursive: true });
  fs.symlinkSync(REPO, path.join(ROOT, 'core', 'panel'));
  const N_PORT = BASE_PORT + 10;
  const N = await boot(N_PORT, path.join(ROOT, 'data', 'core'));
  const PW = 'JoinEnv!2026';
  for (const p of [C, N]) await p.call('POST', '/api/auth/setup', { username: 'owner', password: PW });
  const cTok = (await C.call('POST', '/api/auth/login', { username: 'owner', password: PW })).json?.token;
  check('دو پنل بالا: مرکز و سرورِ تازه', Boolean(cTok) && fs.existsSync(path.join(ROOT, 'data', 'core', 'local-admin.key')), C.out().slice(-300));

  const steps = spawnSync('bash', [path.join(REPO, 'install.sh'), '--list-steps'], { encoding: 'utf8' }).stdout.trim().split(/\s+/);
  fs.writeFileSync(path.join(ROOT, '.install-state'), `${steps.join('\n')}\n`);
  const install = (env) => spawnSync('bash', [path.join(REPO, 'install.sh')], {
    encoding: 'utf8', timeout: 120000,
    env: { ...process.env, VILL3N_SKIP_SYSTEM: '1', VILL3N_NON_INTERACTIVE: '1', VILL3N_ROOT: ROOT, VILL3N_PANEL_PORT: String(N_PORT), VILL3N_DEPLOY: 'vps', ...env },
  });
  const newCode = async () => (await C.call('POST', '/api/fleet/codes', {}, cTok)).json;
  const report = () => { try { return fs.readFileSync(path.join(ROOT, '.install-report'), 'utf8'); } catch { return ''; } };

  console.log('\n── install.sh با کدِ درست ──');
  const k1 = await newCode();
  const r1 = install({ VILL3N_JOIN_CENTER: C.BASE, VILL3N_JOIN_CODE: k1.code });
  check('نصب تمام (کد ۰)، «وصل شد» در خروجی و «join-center» در گزارش', r1.status === 0 && /وصل شد/.test(r1.stdout) && /join-center\tinstalled/.test(report()), `${r1.status} ${r1.stdout.slice(-800)} ${r1.stderr.slice(-300)}`);
  const linked = await until(async () => (await C.call('GET', `/api/fleet/codes/${k1.codeId}`, undefined, cTok)).json?.connected === true, 10000);
  check('⛔ مرکز: کد مصرف شد و نخستین تپش رسید («وصل شد ✓» ِ پنجره)', linked === true);
  const node = (await C.call('GET', '/api/fleet', undefined, cTok)).json?.nodes?.find((n) => n.status === 'active');
  check('گونهٔ vps (از ‎VILL3N_DEPLOY‎)', node?.kind === 'vps', JSON.stringify(node));
  const logText = allText(path.join(ROOT, 'logs')) + report();
  check('⛔ کد نه در لاگِ نصب، نه در گزارش، نه در خروجی', !logText.includes(k1.code) && !r1.stdout.includes(k1.code) && !r1.stderr.includes(k1.code));
  check('⛔ و نه در هیچ فایلی زیرِ ریشهٔ نصب (دادهٔ پنلِ تازه هم)', !allText(ROOT, (f) => f === path.join(ROOT, 'core', 'panel')).includes(k1.code));
  const src = fs.readFileSync(path.join(REPO, 'install.sh'), 'utf8');
  check('⛔ ‎install.sh‎: کد فقط در محیطِ ‎join.mjs‎ (نه آرگومان)، و از محیطِ بقیه برداشته می‌شود', /unset VILL3N_JOIN_CODE/.test(src)
    && /VILL3N_JOIN_CODE="\$JOIN_CODE"[^\n]*\\\n\s*node scripts\/join\.mjs --port "\$PANEL_PORT" --data-dir "\$DATA_DIR"/.test(src) && !/set -x/.test(src));

  //  جدا شدن تا همان سرور دوباره امتحان شود (کلیدِ محلی، همان ‎vill3n‎)
  const leave = spawnSync(process.execPath, [path.join(SERVER_DIR, 'scripts', 'join.mjs'), '--leave', '--port', String(N_PORT), '--data-dir', path.join(ROOT, 'data', 'core')], { encoding: 'utf8' });
  check('جدا شدن با ‎join.mjs --leave‎', leave.status === 0, leave.stdout + leave.stderr);

  console.log('\n── کدِ مصرف‌شده و کهنه ──');
  const r2 = install({ VILL3N_JOIN_CENTER: C.BASE, VILL3N_JOIN_CODE: k1.code });
  check('⛔ همان کد دوباره ⇒ «یک بار مصرف شده»، نصب نمی‌شکند، وصل نه', r2.status === 0 && /یک بار مصرف شده/.test(r2.stdout) && /join-center\tfailed/.test(report())
    && !(await C.call('GET', '/api/fleet', undefined, cTok)).json?.nodes?.some((n) => n.status === 'active'), r2.stdout.slice(-600));
  const k2 = await newCode();
  await wait(6600);
  const r3 = install({ VILL3N_JOIN_CENTER: C.BASE, VILL3N_JOIN_CODE: k2.code });
  check('⛔ کدِ کهنه ⇒ «کهنه شده»، نصب نمی‌شکند، وصل نه', r3.status === 0 && /کهنه شده/.test(r3.stdout) && /join-center\tfailed/.test(report())
    && !(await C.call('GET', '/api/fleet', undefined, cTok)).json?.nodes?.some((n) => n.status === 'active'), r3.stdout.slice(-600));
  const r4 = install({ VILL3N_JOIN_CENTER: C.BASE });
  check('⛔ فقط یکی از دو متغیر ⇒ «هر دو لازم است»', r4.status === 0 && /هر دو لازم است/.test(report()), report());
  const r5 = install({});
  check('بی هیچ‌کدام ⇒ مرحلهٔ وصل اصلاً نیست', r5.status === 0 && !/join_center|join-center/.test(r5.stdout + report()));

  console.log('\n── ‎join.mjs‎ با متغیرِ محیط (بی آرگومان) ──');
  const k3 = await newCode();
  const j = spawnSync(process.execPath, [path.join(SERVER_DIR, 'scripts', 'join.mjs'), '--port', String(N_PORT), '--data-dir', path.join(ROOT, 'data', 'core')],
    { encoding: 'utf8', env: { ...process.env, VILL3N_JOIN_CENTER: C.BASE, VILL3N_JOIN_CODE: k3.code, VILL3N_JOIN_KIND: 'home' } });
  const n3 = await until(async () => (await C.call('GET', `/api/fleet/codes/${k3.codeId}`, undefined, cTok)).json?.connected === true, 10000);
  check('وصل با ‎VILL3N_JOIN_CENTER/CODE‎ و گونهٔ home؛ کد در خروجی نیست', j.status === 0 && n3 === true && !j.stdout.includes(k3.code)
    && (await C.call('GET', '/api/fleet', undefined, cTok)).json?.nodes?.some((n) => n.status === 'active' && n.kind === 'home'), j.stdout + j.stderr);
} catch (e) {
  check('خطای غیرمنتظره', false, e.stack || e.message);
} finally {
  for (const p of panels) p.kill('SIGTERM');
  await wait(600);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${failed ? '❌' : '✅'} ${passed} سبز، ${failed} قرمز\n`);
process.exit(failed ? 1 : 0);
