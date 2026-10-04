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

  console.log('\n── ۷) 🛤️ دو کانال: پایدار (پیش‌فرض) و آزمایشی — شورا، ت۱ ──');
  const tagOf = async (q = '') => (await (await fetch(`${PUB}/api/pump-updates/latest${q}`)).json()).tag_name;
  const bake = () => wait(STABLE_DAYS * 86_400_000 + 600);
  check('⛔ نصبِ پیش‌فرض (بی کانال) هنوز نخستین نسخه را می‌بیند — هر مرج به همه نمی‌رسد',
    (await tagOf()) === 'v3.1.240' && (await tagOf('?channel=stable')) === 'v3.1.240', await tagOf());
  check('کانالِ آزمایشی تازه‌ترین را می‌بیند', (await tagOf('?channel=testing')) === 'v3.1.243');
  const st0 = (await call('GET', '/api/pump-updates-admin')).body;
  check('پنل: پایدار و نامزد (نخستین نسخهٔ پس از پایدار؛ ۲۴۳ جایش را نگرفت)', st0.stable === '3.1.240' && st0.candidate?.version === '3.1.242', JSON.stringify(st0).slice(0, 400));
  check('فایلِ نسخهٔ پایدار از درِ عمومی دانلود می‌شود',
    (await fetch(`${PUB}/api/pump-updates/files/3.1.240/PumpYaqobi-Setup.exe`)).status === 200);
  await bake();
  await runMirror();
  const stC = (await call('GET', '/api/pump-updates-admin')).body;
  check('⛔ نامزدِ کرش‌دار با گذشتِ زمان هم پایدار نشد و تازه‌ترین جایش آمد',
    (await tagOf()) === 'v3.1.240' && stC.candidate?.version === '3.1.243', JSON.stringify(stC.candidate));

  //  ⛔ شورا، د۶: صفر کرش ولی فقط یک دستگاه ⇒ هنوز معنایی ندارد
  crashes({ '3.1.243': { crashes: 0, installs: 1 }, '*': 1 });
  await bake();
  await runMirror();
  const stF = (await call('GET', '/api/pump-updates-admin')).body;
  check('⛔ «بی کرش» ولی کمتر از کمینهٔ نصب ⇒ پایدار نشد و شمارِ نصب دیده می‌شود',
    (await tagOf()) === 'v3.1.240' && stF.candidate?.version === '3.1.243' && stF.candidate?.installs === 1
      && stF.minInstalls === 3, JSON.stringify(stF.candidate));
  crashes({ '3.1.243': 0, '*': 1 });
  await runMirror();
  check('⛔ عددِ خالیِ «صفر کرش» (بی شمارِ نصب) هم پایدار نمی‌کند', (await tagOf()) === 'v3.1.240', await tagOf());

  crashes({ '3.1.243': { crashes: 0, installs: 3 }, '*': 1 });
  await runMirror();
  check('نامزدی که «هفت روز» بی کرش و روی سه دستگاه ماند پایدار شد', (await tagOf()) === 'v3.1.243', await tagOf());

  publish('3.1.244');
  await runMirror();
  publish('3.1.245');
  await runMirror();
  const st1 = (await call('GET', '/api/pump-updates-admin')).body;
  check('⛔ نامزد ثابت می‌ماند — نسخهٔ تازه‌تر جایش را نمی‌گیرد (هفته‌ای حداکثر یک بار)',
    st1.candidate?.version === '3.1.244' && st1.stable === '3.1.243', JSON.stringify(st1.candidate));
  check('پایدار هنوز همان است، آزمایشی تازه‌ترین', (await tagOf()) === 'v3.1.243' && (await tagOf('?channel=testing')) === 'v3.1.245');

  crashes('not-json');
  await bake();
  await runMirror();
  const st2 = (await call('GET', '/api/pump-updates-admin')).body;
  check('⛔ سرورِ حساب نرسید ⇒ پایدار نمی‌شود و نامزد سرِ جایش', st2.stable === '3.1.243' && st2.candidate?.version === '3.1.244', JSON.stringify(st2.candidate));

  crashes({ '3.1.244': 2 });
  await runMirror();
  const st3 = (await call('GET', '/api/pump-updates-admin')).body;
  check('نامزدِ کرش‌دار کنار رفت و تازه‌ترین نامزد شد', st3.stable === '3.1.243' && st3.candidate?.version === '3.1.245', JSON.stringify(st3.candidate));
  check('فایلِ پایدار (۲۴۳) هنوز روی دیسک است', (await fetch(`${PUB}/api/pump-updates/files/3.1.243/PumpYaqobi-Setup.exe`)).status === 200);

  const pr = await call('POST', '/api/pump-updates-admin/stable', { version: '3.1.245' });
  check('«همین را پایدار کن» از پنل', pr.status === 200 && pr.body.stable === '3.1.245' && !pr.body.candidate, JSON.stringify(pr.body).slice(0, 300));
  check('…و نصبِ پیش‌فرض همان را می‌بیند', (await tagOf()) === 'v3.1.245');
  check('نسخهٔ نگرفته پایدار نمی‌شود', (await call('POST', '/api/pump-updates-admin/stable', { version: '9.9.9' })).status === 404);

  await call('POST', '/api/pump-updates-admin/publish', { version: '3.1.244' });
  check('⛔ پخشِ خاموش هر دو کانال را می‌بندد', (await tagOf()) === 'v3.1.244' && (await tagOf('?channel=testing')) === 'v3.1.244', await tagOf());
  await call('POST', '/api/pump-updates-admin/mode', { mode: 'auto' });
  check('پخشِ روشن ⇒ پایدار دوباره همان پایدار', (await tagOf()) === 'v3.1.245');

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
