// ---------------------------------------------------------------------------
//  آزمونِ آینهٔ به‌روزرسانیِ برنامهٔ پمپ — سرورِ واقعی + گیت‌هابِ ساختگی
//
//      node test/pump-mirror.mjs
//
//  «درجا که توی گیت‌هاب آپدیت رو گذاشتم سرور ببینه و به برنامه بگه.»
//  می‌سنجد: سرور نسخهٔ تازه را می‌گیرد · با چک‌سام می‌سنجد · فقط آن‌چه برنامه
//  لازم دارد · از پورتِ عمومی سرو می‌کند (با Range) · «چیزی عوض نشده» یعنی ۳۰۴
//  و صفر دانلود · چک‌سامِ ناجور نسخهٔ سالمِ قبلی را خراب نمی‌کند · نسخهٔ تازه
//  جای قبلی را می‌گیرد · مسیرِ ناجور هیچ فایلی نمی‌دهد · توکن به میزبانِ دیگر نمی‌رود.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4797);
const BASE = `http://127.0.0.1:${PORT}`;
const PUB = `http://127.0.0.1:${PORT + 1}`;
const GH_PORT = PORT + 50;

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ── گیت‌هابِ ساختگی ─────────────────────────────────────────────────────────
const gh = { release: null, etag: null, hits: 0, notModified: 0, blobs: new Map(), authSeenOnBlob: [] };
function publish(version, { corrupt = false } = {}) {
  const setup = crypto.randomBytes(300_000);
  const small = crypto.randomBytes(40_000);
  const big = crypto.randomBytes(50_000);
  const files = {
    'PumpYaqobi-Setup.exe': setup,
    'PumpYaqobi-app-abc123.zip': small,
    'PumpYaqobi-Windows.zip': big,               // زیپِ کامل — نباید گرفته شود
    'version.txt': Buffer.from(version + '\n'),
  };
  const sums = Object.entries(files)
    .filter(([n]) => /\.(zip|exe)$/.test(n))
    .map(([n, b]) => `${corrupt && n.endsWith('.exe') ? sha(Buffer.from('x')) : sha(b)}  ${n}`)
    .join('\n') + '\n';
  files['SHA256SUMS.txt'] = Buffer.from(sums);
  gh.blobs = new Map(Object.entries(files));
  gh.etag = `"${version}-${corrupt ? 'bad' : 'ok'}"`;
  gh.release = {
    tag_name: `v${version}`,
    name: `پمپ — ${version}`,
    body: `یادداشتِ ${version}`,
    published_at: new Date().toISOString(),
    assets: Object.entries(files).map(([name, b], i) => ({
      id: i + 1, name, size: b.length,
      url: `http://127.0.0.1:${GH_PORT}/assets/${encodeURIComponent(name)}`,
      browser_download_url: `http://127.0.0.1:${GH_PORT}/dl/${encodeURIComponent(name)}`,
    })),
  };
  return files;
}

const ghServer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/repos/vil3ntec-it/pump-staion-yaqobi/releases/latest') {
    gh.hits++;
    if (req.headers['if-none-match'] && req.headers['if-none-match'] === gh.etag) {
      gh.notModified++;
      res.writeHead(304); return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json', etag: gh.etag });
    return res.end(JSON.stringify(gh.release));
  }
  let m = /^\/assets\/(.+)$/.exec(u.pathname);
  if (m) {
    //  همان رفتارِ گیت‌هاب: تغییرِ مسیر به **میزبانِ دیگر** (localhost به‌جای 127.0.0.1)
    res.writeHead(302, { location: `http://localhost:${GH_PORT}/blob/${m[1]}` });
    return res.end();
  }
  m = /^\/blob\/(.+)$/.exec(u.pathname);
  if (m) {
    gh.authSeenOnBlob.push(Boolean(req.headers.authorization));
    const b = gh.blobs.get(decodeURIComponent(m[1]));
    if (!b) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': b.length });
    return res.end(b);
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => ghServer.listen(GH_PORT, '127.0.0.1', r));

// ── سرورِ واقعی ────────────────────────────────────────────────────────────
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-pumpmirror-'));
//  🛤️ ت۱: «گزارشِ کرش»ِ ساختگی — تا بخشِ ۷ هر نسخه کرش دارد، پس هیچ نامزدی پایدار نمی‌شود
const CRASHES = path.join(tmp, 'crashes.json');
const crashes = (m) => fs.writeFileSync(CRASHES, typeof m === 'string' ? m : JSON.stringify(m));
crashes({ '*': 1 });
const STABLE_DAYS = 0.00003;                         // ~۲٫۶ ثانیه به‌جای هفت روز
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });
const child = spawn(process.execPath,
  ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
    env: {
      ...process.env,
      HLP_PORT: String(PORT), HLP_SITESYNC_PORT: String(PORT + 1), HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: path.join(tmp, 'data'), HLP_SITES_ROOT: path.join(tmp, 'sites'),
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_SITESYNC: '1', HLP_ACCOUNT_AUTOSTART: '0',
      HLP_PUMP_MIRROR: '1', HLP_GITHUB_API: `http://127.0.0.1:${GH_PORT}`,
      HLP_PUMP_CRASHES_FILE: CRASHES, HLP_PUMP_STABLE_DAYS: String(STABLE_DAYS),
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
const runMirror = () => call('POST', '/api/automation/jobs/pump-update-mirror/run', {});

try {
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 25_000) {
    try { if ((await fetch(`${BASE}/health`)).ok && (await fetch(`${PUB}/health`)).ok) { up = true; break; } } catch { /* */ }
    await wait(200);
  }
  if (!up) throw new Error(`سرور بالا نیامد:\n${out}`);
  const setup = await call('POST', '/api/auth/setup', { username: 'admin', password: 'ControlCenter!2026' });
  token = setup.body?.token || (await call('POST', '/api/auth/login', { username: 'admin', password: 'ControlCenter!2026' })).body?.token;
  check('مدیر وارد شد', Boolean(token));

  console.log('\n── ۰) پیش از هر نسخه ──');
  const none = await fetch(`${PUB}/api/pump-updates/latest`);
  check('هنوز چیزی نیامده ⇒ ۵۰۳ (نه «به‌روز است»)', none.status === 503);

  console.log('\n── ۱) نسخهٔ تازه روی گیت‌هاب ⇒ سرور می‌گیرد ──');
  const v1 = publish('3.1.240');
  const r1 = await runMirror();
  check('کار با موفقیت دوید', r1.status === 200 && r1.body.status === 'ok', JSON.stringify(r1.body).slice(0, 300));
  const latest = await (await fetch(`${PUB}/api/pump-updates/latest?channel=testing`)).json();
  check('نسخهٔ تازه از پورتِ عمومی', latest.tag_name === 'v3.1.240', JSON.stringify(latest));
  check('یادداشتِ انتشار هم آمد', latest.body === 'یادداشتِ 3.1.240');
  const names = (latest.assets || []).map((a) => a.name).sort();
  check('فقط آن‌چه برنامه لازم دارد (نصاب، بستهٔ کوچک، چک‌سام)',
    names.includes('PumpYaqobi-Setup.exe') && names.includes('PumpYaqobi-app-abc123.zip')
    && names.includes('SHA256SUMS.txt') && !names.includes('PumpYaqobi-Windows.zip'), names.join(','));
  check('نشانیِ فایل نسبی است و نامِ گیت‌هاب در پاسخ نیست',
    latest.assets.every((a) => a.browser_download_url.startsWith('/api/pump-updates/files/3.1.240/'))
    && !JSON.stringify(latest).includes('github') && !JSON.stringify(latest).includes(String(GH_PORT)));
  const v1Latest = await (await fetch(`${PUB}/api/v1/pump-updates/latest`)).json();
  check('همان از /api/v1 هم', v1Latest.tag_name === 'v3.1.240');

  const setupUrl = latest.assets.find((a) => a.name === 'PumpYaqobi-Setup.exe').browser_download_url;
  const got = Buffer.from(await (await fetch(PUB + setupUrl)).arrayBuffer());
  check('نصاب بایت‌به‌بایت همان', got.equals(v1['PumpYaqobi-Setup.exe']));
  const part = await fetch(PUB + setupUrl, { headers: { range: 'bytes=100-199' } });
  const partBuf = Buffer.from(await part.arrayBuffer());
  check('Range — دانلودِ ادامه‌دار', part.status === 206 && partBuf.equals(v1['PumpYaqobi-Setup.exe'].subarray(100, 200)), part.status);
  const sumsUrl = latest.assets.find((a) => a.name === 'SHA256SUMS.txt').browser_download_url;
  check('فهرستِ چک‌سام همان', (await (await fetch(PUB + sumsUrl)).text()) === v1['SHA256SUMS.txt'].toString());
  check('توکن (اگر بود) به میزبانِ دیگر نرفت', gh.authSeenOnBlob.every((x) => x === false));

  console.log('\n── ۲) چیزی عوض نشده ⇒ ۳۰۴، صفر دانلود ──');
  const before304 = gh.notModified;
  const blobsBefore = gh.authSeenOnBlob.length;
  const r2 = await runMirror();
  check('دورِ بی‌تغییر موفق', r2.status === 200 && r2.body.status === 'ok');
  check('با ETag پرسید و ۳۰۴ گرفت', gh.notModified === before304 + 1, `${before304} ⇒ ${gh.notModified}`);
  check('هیچ فایلی دوباره دانلود نشد', gh.authSeenOnBlob.length === blobsBefore);

  console.log('\n── ۳) نسخهٔ خراب (چک‌سامِ ناجور) نسخهٔ سالم را خراب نمی‌کند ──');
  publish('3.1.241', { corrupt: true });
  const r3 = await runMirror();
  check('کار شکست را گزارش کرد', r3.status === 200 && r3.body.status === 'failed', JSON.stringify(r3.body).slice(0, 200));
  const still = await (await fetch(`${PUB}/api/pump-updates/latest?channel=testing`)).json();
  check('همان نسخهٔ سالمِ قبلی سرو می‌شود', still.tag_name === 'v3.1.240', still.tag_name);
  const bad = await fetch(`${PUB}/api/pump-updates/files/3.1.241/PumpYaqobi-Setup.exe`);
  check('فایلِ نسخهٔ خراب هیچ‌جا سرو نمی‌شود', bad.status === 404);
  check('پوشهٔ نیمه‌کاره نماند', !fs.existsSync(path.join(tmp, 'data', 'pump-updates', '3.1.241.part')));

  console.log('\n── ۴) نسخهٔ درستِ بعدی جای قبلی را می‌گیرد ──');
  const v2 = publish('3.1.242');
  const r4 = await runMirror();
  check('کار موفق', r4.status === 200 && r4.body.status === 'ok');
  const l2 = await (await fetch(`${PUB}/api/pump-updates/latest?channel=testing`)).json();
  check('نسخهٔ تازه سرو می‌شود', l2.tag_name === 'v3.1.242');
  const s2 = Buffer.from(await (await fetch(PUB + l2.assets.find((a) => a.name === 'PumpYaqobi-Setup.exe').browser_download_url)).arrayBuffer());
  check('نصابِ تازه بایت‌به‌بایت', s2.equals(v2['PumpYaqobi-Setup.exe']));
  const oldStill = await fetch(`${PUB}/api/pump-updates/files/3.1.240/PumpYaqobi-Setup.exe`);
  check('نسخهٔ پیشین هنوز سرو می‌شود (دانلودی که وسطِ کار است نمی‌شکند)', oldStill.status === 200);

  console.log('\n── ۵) مسیرِ ناجور هیچ فایلی نمی‌دهد ──');
  for (const p of [
    '/api/pump-updates/files/3.1.242/..%2F..%2Fpanel.db',
    '/api/pump-updates/files/..%2F..%2Fdata/x',
    '/api/pump-updates/files/3.1.242/state.json',
    '/api/pump-updates/files/3.1.242/PumpYaqobi-Windows.zip',
    '/api/pump-updates/files/abc/PumpYaqobi-Setup.exe',
  ]) {
    const r = await fetch(PUB + p);
    check(`رد شد: ${p}`, r.status === 404 || r.status === 400, r.status);
  }

  console.log('\n── ۵ب) 🚦 درِ پخش: «روی سرور باشد ولی تا خودم نخواهم نرود» ──');
  const adm0 = await call('GET', '/api/pump-updates-admin');
  check('حالتِ پیش‌فرض خودکار است و همان نسخه پخش می‌شود', adm0.body.mode === 'auto' && adm0.body.served === '3.1.242', JSON.stringify(adm0.body).slice(0, 200));
  const h = await call('POST', '/api/pump-updates-admin/mode', { mode: 'hold' });
  check('پخش خاموش شد و همان نسخهٔ امروز قفل ماند', h.status === 200 && h.body.mode === 'hold' && h.body.served === '3.1.242', JSON.stringify(h.body).slice(0, 200));
  const v3 = publish('3.1.243');
  const r5 = await runMirror();
  check('نسخهٔ تازه گرفته شد', r5.status === 200 && r5.body.status === 'ok');
  const held = await (await fetch(`${PUB}/api/pump-updates/latest?channel=testing`)).json();
  check('⛔ برنامه‌ها هنوز نسخهٔ قبلی را می‌بینند', held.tag_name === 'v3.1.242', held.tag_name);
  const heldFile = await fetch(`${PUB}/api/pump-updates/files/3.1.243/PumpYaqobi-Setup.exe`);
  check('⛔ نسخهٔ نگه‌داشته از درِ عمومی دانلود نمی‌شود', heldFile.status === 404, heldFile.status);
  const adm1 = await call('GET', '/api/pump-updates-admin');
  check('پنل می‌گوید نسخهٔ تازه منتظرِ انتشار است', adm1.body.waiting === true && adm1.body.version === '3.1.243'
    && adm1.body.versions.some((v) => v.version === '3.1.243'), JSON.stringify(adm1.body).slice(0, 300));
  const test = await fetch(`${BASE}/api/pump-updates-admin/files/3.1.243/PumpYaqobi-Setup.exe?token=${token}`);
  const testBuf = Buffer.from(await test.arrayBuffer());
  check('مدیر نسخهٔ نگه‌داشته را برای آزمودن دانلود می‌کند', test.status === 200 && testBuf.equals(v3['PumpYaqobi-Setup.exe']), test.status);
  const anon = await fetch(`${BASE}/api/pump-updates-admin/files/3.1.243/PumpYaqobi-Setup.exe`);
  check('بی ورود، درِ آزمایشی بسته است', anon.status === 401, anon.status);
  const pubAdm = await fetch(`${PUB}/api/pump-updates-admin`);
  check('درِ مدیریت روی پورتِ عمومی نیست', pubAdm.status === 404 || pubAdm.status === 401, pubAdm.status);
  const pz = await call('POST', '/api/pump-updates-admin/publish', { version: '3.1.243' });
  check('انتشار زده شد', pz.status === 200 && pz.body.served === '3.1.243' && pz.body.mode === 'hold', JSON.stringify(pz.body).slice(0, 200));
  const after = await (await fetch(`${PUB}/api/pump-updates/latest?channel=testing`)).json();
  check('حالا برنامه‌ها نسخهٔ تازه را می‌بینند', after.tag_name === 'v3.1.243');
  const back = await call('POST', '/api/pump-updates-admin/publish', { version: '3.1.242' });
  check('برگرداندن به نسخهٔ قبلی هم شدنی است', back.status === 200 && back.body.served === '3.1.242');
  check('پس از برگرداندن، نسخهٔ تازه‌ترِ کنارگذاشته از درِ عمومی نمی‌رود',
    (await fetch(`${PUB}/api/pump-updates/files/3.1.243/PumpYaqobi-Setup.exe`)).status === 404);
  const nx = await call('POST', '/api/pump-updates-admin/publish', { version: '9.9.9' });
  check('نسخهٔ نگرفته منتشر نمی‌شود', nx.status === 404);
  const bm = await call('POST', '/api/pump-updates-admin/mode', { mode: 'whatever' });
  check('حالتِ ناشناخته رد می‌شود', bm.status === 400);
  const au = await call('POST', '/api/pump-updates-admin/mode', { mode: 'auto' });
  check('روشن کردنِ دوبارهٔ پخش ⇒ تازه‌ترین نسخه همان لحظه می‌رود', au.body.mode === 'auto' && au.body.served === '3.1.243');
  check('…و از درِ عمومی هم', (await (await fetch(`${PUB}/api/pump-updates/latest?channel=testing`)).json()).tag_name === 'v3.1.243');

  console.log('\n── ۷) 🛤️ یک کانال: نسخهٔ تازه درجا به همه (۱۴۰۵/۰۷/۲۲) ──');
  const tagOf = async (q = '') => (await (await fetch(`${PUB}/api/pump-updates/latest${q}`)).json()).tag_name;
  //  ⛔ کانالِ پایدارِ هفت‌روزه بن‌بست بود (کمینهٔ نصب از همان دستگاه‌هایی شمرده
  //  می‌شد که نامزد را نمی‌گرفتند)؛ حالا بی کانال، پایدار و آزمایشی یک نسخه‌اند.
  check('⛔ نصبِ پیش‌فرض (بی کانال) همان لحظه تازه‌ترین را می‌بیند',
    (await tagOf()) === 'v3.1.243' && (await tagOf('?channel=stable')) === 'v3.1.243', await tagOf());
  check('کانالِ آزمایشی هم همان', (await tagOf('?channel=testing')) === 'v3.1.243');
  const st0 = (await call('GET', '/api/pump-updates-admin')).body;
  check('پنل: «پایدار» همان منتشرشده است و هیچ نامزدی منتظر نمی‌ماند',
    st0.stable === '3.1.243' && st0.served === '3.1.243' && !st0.candidate, JSON.stringify(st0).slice(0, 300));
  publish('3.1.244');
  await runMirror();
  publish('3.1.245');
  await runMirror();
  check('⛔ دو نسخهٔ پشتِ سرِ هم ⇒ نصبِ پیش‌فرض بی هیچ انتظاری تازه‌ترین را دارد', (await tagOf()) === 'v3.1.245', await tagOf());
  check('فایلِ تازه‌ترین از درِ عمومی دانلود می‌شود',
    (await fetch(`${PUB}/api/pump-updates/files/3.1.245/PumpYaqobi-Setup.exe`)).status === 200);
  check('⛔ نسخهٔ کهنه‌تر از «یکی پیش از منتشرشده» از درِ عمومی بیرون نمی‌رود',
    (await fetch(`${PUB}/api/pump-updates/files/3.1.243/PumpYaqobi-Setup.exe`)).status === 404);

  await call('POST', '/api/pump-updates-admin/publish', { version: '3.1.244' });
  check('⛔ پخشِ خاموش همهٔ کانال‌ها را می‌بندد', (await tagOf()) === 'v3.1.244' && (await tagOf('?channel=testing')) === 'v3.1.244', await tagOf());
  await call('POST', '/api/pump-updates-admin/mode', { mode: 'auto' });
  check('پخشِ روشن ⇒ دوباره تازه‌ترین', (await tagOf()) === 'v3.1.245');

  console.log('\n── ۸) 🧪 پمپ‌های آزمایشی: نسخهٔ نگه‌داشته فقط به کامپیوترهای خودِ مدیر ──');
  const enroll = async (code) => (await call('POST', '/api/stations/enroll', { code, name: 'پمپ ' + code })).body;
  const A = await enroll('tst-a');            // کامپیوترِ آزمایشیِ مدیر
  const B = await enroll('reg-b');            // پمپِ معمولیِ یک مشتری
  check('دو پمپ ثبت شد (رمزِ برنامه و رمزِ خواندن)', A.token && A.readKey && B.token, JSON.stringify(A).slice(0, 200));
  await call('POST', '/api/pump-updates-admin/mode', { mode: 'hold' });
  const v8 = publish('3.1.246');
  await runMirror();
  const raw = async (u, h = {}) => { const r = await fetch(PUB + u, { headers: h }); return { status: r.status, text: await r.text(), buf: null }; };
  const L = '/api/pump-updates/latest';
  const anonL = await raw(L);
  check('پخش خاموش: همه هنوز نسخهٔ منتشرشده را می‌بینند', JSON.parse(anonL.text).tag_name === 'v3.1.245', anonL.text.slice(0, 100));
  const credA = { 'x-station-code': 'tst-a', 'x-station-token': A.token };
  const preList = await raw(L, credA);
  check('⛔ پیش از گذاشتن در فهرست، رمزِ درست هم همان پاسخِ همیشگی را می‌گیرد', preList.text === anonL.text);

  //  نوشتنِ فهرست: بی ورود ⇒ ۴۰۱؛ کارگزار ⇒ ۴۰۳؛ کدِ نبوده ⇒ ۴۰۰
  const noAuth = await fetch(`${BASE}/api/pump-updates-admin/testers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes: ['tst-a'] }) });
  check('بی ورود فهرست عوض نمی‌شود', noAuth.status === 401, noAuth.status);
  await call('POST', '/api/auth/users', { username: 'op-tester', password: 'Operator-1405-tst', role: 'operator' });
  const opTok = (await call('POST', '/api/auth/login', { username: 'op-tester', password: 'Operator-1405-tst' })).body?.token;
  const opW = await fetch(`${BASE}/api/pump-updates-admin/testers`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opTok}` }, body: JSON.stringify({ codes: ['tst-a'] }) });
  check('⛔ کارگزار (نه مدیر) فهرست را عوض نمی‌کند', Boolean(opTok) && opW.status === 403, `${Boolean(opTok)} ${opW.status}`);
  const unk = await call('POST', '/api/pump-updates-admin/testers', { codes: ['nobody-here'] });
  check('کدِ پمپی که ثبت نشده رد می‌شود', unk.status === 400 && unk.body.error === 'unknown_station', JSON.stringify(unk.body));
  const setT = await call('POST', '/api/pump-updates-admin/testers', { codes: ['tst-a'] });
  check('مدیر پمپِ آزمایشی را گذاشت و پنل فهرست و پمپ‌ها را نشان می‌دهد', setT.status === 200
    && JSON.stringify(setT.body.testers) === '["tst-a"]' && setT.body.stations?.some((x) => x.code === 'reg-b'), JSON.stringify(setT.body).slice(0, 300));
  const auditRows = (await call('GET', '/api/control/audit?limit=50&action=pump_update.testers')).body;
  check('در دفترِ ممیزی نشست', JSON.stringify(auditRows).includes('pump_update.testers'), JSON.stringify(auditRows).slice(0, 200));

  const tA = await raw(L, credA);
  const jA = JSON.parse(tA.text);
  check('🧪 پمپِ آزمایشی با رمزِ برنامه‌اش تازه‌ترین نسخه را می‌گیرد، با نشانِ tester',
    jA.tag_name === 'v3.1.246' && jA.tester === true, tA.text.slice(0, 120));
  const tA1 = JSON.parse((await raw('/api/v1/pump-updates/latest', credA)).text);
  check('همان از /api/v1 هم', tA1.tag_name === 'v3.1.246' && tA1.tester === true);
  const tAstable = JSON.parse((await raw(L + '?channel=stable', credA)).text);
  check('کانال برای پمپِ آزمایشی فرقی نمی‌کند', tAstable.tag_name === 'v3.1.246');
  for (const [label, h] of [
    ['رمزِ غلط', { 'x-station-code': 'tst-a', 'x-station-token': 'x'.repeat(A.token.length) }],
    ['رمزِ خواندنِ کیو‌آر', { 'x-station-code': 'tst-a', 'x-station-token': A.readKey }],
    ['پمپِ بیرونِ فهرست با رمزِ درستِ خودش', { 'x-station-code': 'reg-b', 'x-station-token': B.token }],
    ['رمزِ پمپِ دیگر با کدِ آزمایشی', { 'x-station-code': 'tst-a', 'x-station-token': B.token }],
    ['کدِ نبوده', { 'x-station-code': 'ghost', 'x-station-token': A.token }],
    ['فقط کد', { 'x-station-code': 'tst-a' }],
  ]) {
    const r = await raw(L, h);
    check(`⛔ ${label} ⇒ بایت‌به‌بایت همان پاسخِ همیشگی`, r.status === anonL.status && r.text === anonL.text, r.text.slice(0, 100));
  }

  const F = '/api/pump-updates/files/3.1.246/PumpYaqobi-Setup.exe';
  const fA = await fetch(PUB + F, { headers: credA });
  const fABuf = Buffer.from(await fA.arrayBuffer());
  check('🧪 پمپِ آزمایشی نصابِ نسخهٔ تازه را بایت‌به‌بایت می‌گیرد', fA.status === 200 && fABuf.equals(v8['PumpYaqobi-Setup.exe']), fA.status);
  const fSums = await fetch(PUB + '/api/pump-updates/files/3.1.246/SHA256SUMS.txt', { headers: credA });
  check('…و چک‌سامش را', fSums.status === 200 && (await fSums.text()) === v8['SHA256SUMS.txt'].toString());
  for (const [label, h] of [
    ['بی رمز', {}],
    ['رمزِ خواندن', { 'x-station-code': 'tst-a', 'x-station-token': A.readKey }],
    ['پمپِ بیرونِ فهرست', { 'x-station-code': 'reg-b', 'x-station-token': B.token }],
    ['رمزِ غلط', { 'x-station-code': 'tst-a', 'x-station-token': 'nope' }],
  ]) {
    check(`⛔ درِ فایل: ${label} ⇒ ۴۰۴`, (await fetch(PUB + F, { headers: h })).status === 404);
  }
  check('پمپِ آزمایشی نسخهٔ منتشرشده را هم می‌تواند بگیرد (دانلودِ وسطِ کار نمی‌شکند)',
    (await fetch(PUB + '/api/pump-updates/files/3.1.245/PumpYaqobi-Setup.exe', { headers: credA })).status === 200);

  const clr = await call('POST', '/api/pump-updates-admin/testers', { codes: [] });
  check('فهرست خالی شد', clr.status === 200 && clr.body.testers.length === 0);
  check('⛔ پس از برداشتن از فهرست، همان پمپ دوباره نسخهٔ منتشرشده را می‌بیند',
    (await raw(L, credA)).text === anonL.text && (await fetch(PUB + F, { headers: credA })).status === 404);
  await call('POST', '/api/pump-updates-admin/testers', { codes: ['tst-a'] });
  await call('POST', '/api/pump-updates-admin/mode', { mode: 'auto' });
  check('روشن کردنِ پخش ⇒ نسخهٔ تازه به همه می‌رسد (کانالِ آزمایشی)',
    JSON.parse((await raw(L + '?channel=testing')).text).tag_name === 'v3.1.246');

  console.log('\n── ۶) فقط‌خواندنی ──');
  const post = await fetch(`${PUB}/api/pump-updates/latest`, { method: 'POST' });
  check('POST هیچ کاری نمی‌کند', post.status === 404);
} catch (e) {
  failed++;
  console.log(`  ❌ ${e.stack || e}`);
} finally {
  child.kill('SIGTERM');
  ghServer.close();
  await wait(300);
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passed} موفق، ${failed} ناموفق`);
process.exit(failed ? 1 : 0);
