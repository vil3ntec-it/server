// ---------------------------------------------------------------------------
//  آینهٔ به‌روزرسانیِ سایت‌ها (src/siteupdates/mirror.js) — سرور از «گیت‌هاب»
//  می‌گیرد، می‌سنجد و فقط به سایت‌های همین کامپیوتر می‌دهد. سایت هیچ نشانیِ
//  گیت‌هاب نمی‌شناسد: SITE_UPDATE_URL را خودِ پنل به پروسهٔ سایت می‌دهد.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4837);
const BASE = `http://127.0.0.1:${PORT}`;
const GH_PORT = PORT + 50;

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// «گیت‌هابِ» ساختگی: raw.githubusercontent.com/<repo>/main/sites/vill3n-top/…
const gh = { files: new Map(), hits: [] };
function publish(version, files, { tamper } = {}) {
  gh.files = new Map(Object.entries(files).map(([p, c]) => [p, Buffer.from(c)]));
  const list = [...gh.files].map(([p, b]) => ({ path: p, size: b.length, sha256: sha(b) }));
  gh.files.set('release.json', Buffer.from(JSON.stringify({ version, files: list })));
  if (tamper) gh.files.set(tamper, Buffer.from('TAMPERED'));
}
const ghServer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const m = /^\/sites\/vill3n-top\/(.+)$/.exec(decodeURIComponent(u.pathname));
  const b = m && gh.files.get(m[1]);
  if (m) gh.hits.push(m[1]);
  if (!b) { res.writeHead(404); return res.end(); }
  res.writeHead(200); res.end(b);
});
await new Promise((r) => ghServer.listen(GH_PORT, '127.0.0.1', r));

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-sitemirror-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });
const child = spawn(process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
    env: {
      ...process.env,
      HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_ACCOUNT_AUTOSTART: '0', HLP_PUMP_MIRROR: '0',
      HLP_SITE_MIRROR: '1', HLP_SITE_RAW: `http://127.0.0.1:${GH_PORT}/`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

let token = null;
const call = async (method, url, body) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const runMirror = () => call('POST', '/api/automation/jobs/site-update-mirror/run', {});
const get = (p, headers = {}) => fetch(`${BASE}/site-updates/vill3n-top/${p}`, { headers });

try {
  const t0 = Date.now();
  while (Date.now() - t0 < 25_000) {
    try { if ((await fetch(`${BASE}/health`)).ok) break; } catch { /* */ }
    await wait(200);
  }
  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' });
  token = setup.body?.token || (await call('POST', '/api/auth/login', { username: 'admin', password: 'ControlCenter!2026' })).body?.token;
  check('ورود', Boolean(token));

  console.log('\n── ۱) پیش از هر نسخه ──');
  check('چیزی نیامده ⇒ ۴۰۴', (await get('release.json')).status === 404);

  console.log('\n── ۲) نسخهٔ تازه ⇒ سرور می‌گیرد و فقط به همین کامپیوتر می‌دهد ──');
  publish('2.1.0', { 'server.js': 'v1-server', 'src/app.js': 'v1-app' });
  const r1 = await runMirror();
  check('کار دوید', r1.status === 200 && r1.body.status === 'ok', JSON.stringify(r1.body).slice(0, 300));
  const rel = await (await get('release.json')).json().catch(() => null);
  check('release.json از سرور', rel?.version === '2.1.0', JSON.stringify(rel));
  check('فایل از سرور، بایت‌به‌بایت', (await (await get('src/app.js')).text()) === 'v1-app');
  check('با سرآیندِ تونل (cf-ray) ⇒ ۴۰۴', (await get('release.json', { 'cf-ray': 'abc' })).status === 404);
  check('با X-Forwarded-For ⇒ ۴۰۴', (await get('src/app.js', { 'x-forwarded-for': '1.2.3.4' })).status === 404);
  check('فایلی که در فهرست نیست ⇒ ۴۰۴', (await get('package.json')).status === 404);
  check('«..» ⇒ ۴۰۴', (await get('..%2F..%2Fcurrent.json')).status === 404);
  check('سایتِ ناشناخته ⇒ ۴۰۴', (await fetch(`${BASE}/site-updates/other/release.json`)).status === 404);

  console.log('\n── ۳) فایلِ دست‌کاری‌شده ⇒ نسخهٔ سالمِ قبلی می‌ماند ──');
  publish('2.2.0', { 'server.js': 'v1-server', 'src/app.js': 'v2-app' }, { tamper: 'src/app.js' });
  await runMirror();
  check('هنوز 2.1.0', (await (await get('release.json')).json()).version === '2.1.0');
  check('فایل همان نسخهٔ سالم', (await (await get('src/app.js')).text()) === 'v1-app');

  console.log('\n── ۴) نسخهٔ سالمِ بعدی ⇒ فقط فایلِ عوض‌شده دانلود می‌شود ──');
  publish('2.2.1', { 'server.js': 'v1-server', 'src/app.js': 'v2-app' });
  gh.hits = [];
  await runMirror();
  check('2.2.1 آمد', (await (await get('release.json')).json()).version === '2.2.1');
  check('فایلِ یکسان دوباره گرفته نشد', !gh.hits.includes('server.js'), gh.hits.join(','));
  check('فایلِ تازه سرو می‌شود', (await (await get('src/app.js')).text()) === 'v2-app');

  console.log('\n── ۵) فهرستی که به data دست بزند ⇒ رد ──');
  gh.files.set('release.json', Buffer.from(JSON.stringify({ version: '9.0.0', files: [{ path: 'data/db.json', size: 1, sha256: sha(Buffer.from('x')) }] })));
  await runMirror();
  check('هنوز 2.2.1', (await (await get('release.json')).json()).version === '2.2.1');

  console.log('\n── ۶) سایتِ ثبت‌شده نشانیِ آینه را می‌گیرد، نه گیت‌هاب ──');
  const siteDir = path.join(tmp, 'sites', 'vill3n-top');
  fs.mkdirSync(siteDir, { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'site.json'), JSON.stringify({ id: 'vill3n-top', port: 4790 }));
  fs.writeFileSync(path.join(siteDir, 'server.js'), "require('http').createServer((q, s) => s.end(process.env.SITE_UPDATE_URL || '')).listen(process.env.PORT, '127.0.0.1');");
  const added = await call('POST', '/api/sites', { path: siteDir, startCommand: 'node server.js' });
  check('سایت اضافه شد', added.status === 200, JSON.stringify(added.body).slice(0, 200));
  await call('POST', `/api/sites/${added.body.site?.id}/start`, {});
  let url = '';
  for (let i = 0; i < 30 && !url; i++) { await wait(200); try { url = await (await fetch(`http://127.0.0.1:${added.body.site?.port}/`)).text(); } catch { /* */ } }
  check('SITE_UPDATE_URL همان آینهٔ پنل است', url === `http://127.0.0.1:${PORT}/site-updates/vill3n-top/`, url);
  check('و هیچ نامی از گیت‌هاب در آن نیست', !/github/i.test(url));
  await call('POST', `/api/sites/${added.body.site?.id}/stop`, {});
} catch (e) {
  failed++;
  console.error('\n❌ آزمون شکست:', e.message);
  console.error(out.slice(-2000));
} finally {
  child.kill('SIGTERM');
  ghServer.close();
  await wait(300);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
