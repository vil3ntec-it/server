// ---------------------------------------------------------------------------
//  آزمونِ «جابه‌جایی به کامپیوترِ دیگر» از خودِ پنل (۱.۵۰.۹۳) — ‎/api/move‎
//      node test/move-ui.mjs
//
//  دو پنلِ واقعی (کامپیوترِ قدیم A و نو B) و یک سرورِ حسابِ ساختگیِ زیرِ نظرِ پنل که هر ۲۵ میلی‌ثانیه در
//  دیتابیسش می‌نویسد (پس کپیِ داغ ناسازگار می‌شد):
//    • مالک فقط: مدیرِ دوم ۴۰۳ ‎owner_only‎ پیش از رمز؛ نشستِ کهنه ‎reauth_required‎؛ رمزِ کوتاه ۴۰۰
//    • export: سرورِ حساب مکث و دوباره روشن، دانلود با بلیت، همان قالبِ ‎move-server.mjs‎
//    • import روی نصبِ تازه: از شبکه بی کد ۴۰۳، فایلِ غیرِ vmove پیش از نوشتن رد، بستهٔ دست‌خورده/رمزِ غلط ⇒ هیچ
//      چیز عوض نشد؛ بستهٔ درست ⇒ راه‌اندازیِ دوباره ⇒ «همان بسته است» و ورود با نام و رمزِ کامپیوترِ قدیم
//    • import روی نصبِ پُر: بی force ۴۰۹، دادهٔ قبلی کنار می‌رود (پاک نه)
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inspectBundle, compareData, BUNDLE_MAGIC } from '../scripts/move-server.mjs';

const BASE_PORT = Number(process.env.TEST_PORT || 4955);
let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 400) : ''}`); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PASS = 'correct horse battery staple';
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-move-ui-'));

/* ───────── سرورِ حسابِ ساختگی (همان قراردادِ supervisor) + ابزارِ تطبیقِ ساختگی ───────── */
const ACCT = path.join(tmp, 'acct');
fs.mkdirSync(path.join(ACCT, 'src'), { recursive: true });
fs.mkdirSync(path.join(ACCT, 'node_modules'), { recursive: true });
fs.mkdirSync(path.join(ACCT, 'scripts'), { recursive: true });
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
fs.writeFileSync(path.join(ACCT, 'scripts', 'move-db.js'), `
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const i = process.argv.indexOf('--db'); const dir = process.argv[i + 1].replace(/^pglite:/, '');
const h = crypto.createHash('sha256'); let rows = 0;
const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else { h.update(n); h.update(fs.readFileSync(p)); rows++; } } };
walk(dir);
const money = fs.existsSync(path.join(dir, 'money.txt')) ? fs.readFileSync(path.join(dir, 'money.txt'), 'utf8').trim() : '0';
console.log(JSON.stringify({ tables: { files: { rows, hash: h.digest('hex'), sums: { amount: money } } }, totals: { rows, money } }));
`);

async function boot(port, dataDir, env = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const sitesRoot = path.join(path.dirname(dataDir), `${path.basename(dataDir)}-sites`);
  fs.mkdirSync(sitesRoot, { recursive: true });
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
    env: {
      ...process.env, HLP_PORT: String(port), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: dataDir, HLP_SITES_ROOT: sitesRoot,
      HLP_TUNNEL: '0', HLP_AI_ENABLED: '0', HLP_DISCOVERY: '0', HLP_AGENT: '0', HLP_ACCOUNT_AUTOSTART: '0',
      HLP_SITESYNC_PORT: String(port + 1), HLP_DISCOVERY_PORT: String(port + 2), HLP_RATE_LOGIN: '1000', HLP_AUTH_RATE_LIMIT: '100000',
      HLP_MOVE_RESTART: '0', HLP_ACCOUNT_DIR: ACCT,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const BASE = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
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
    await new Promise((r) => { child.once('exit', r); setTimeout(r, 8000); });
  };
  return { up, out: () => out, call, stop, BASE, dataDir };
}

async function pollJob(s, id, token) {
  for (let i = 0; i < 240; i++) {
    const r = await s.call('GET', `/api/move/jobs/${id}`, undefined, token);
    if (r.json?.job && r.json.job.state !== 'running') return r.json.job;
    await wait(250);
  }
  return { state: 'timeout' };
}

async function upload(s, token, buf, { force, chunk = 64 * 1024, headers = {} } = {}) {
  const begin = await s.call('POST', '/api/move/import/begin', { size: buf.length, ...(force === undefined ? {} : { force }) }, token, headers);
  if (begin.status !== 200) return { begin };
  for (let off = 0; off < buf.length; off += chunk) {
    const r = await fetch(`${s.BASE}/api/move/import/${begin.json.uploadId}/chunk?offset=${off}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: buf.subarray(off, off + chunk),
    });
    if (r.status !== 200) return { begin, chunk: { status: r.status, json: await r.json().catch(() => null) } };
  }
  return { begin, uploadId: begin.json.uploadId };
}

//  ‎.vmove-panel‎ کارگاهِ خودِ پنل است (بارگذاری‌ها)، نه داده
const entries = (dir) => fs.readdirSync(dir).filter((n) => !['panel.db-wal', 'panel.db-shm', '.vmove-panel'].includes(n)).sort().join(',');
const staleSession = (dataDir, username) => {
  const d = new DatabaseSync(path.join(dataDir, 'panel.db'));
  try { d.exec('PRAGMA busy_timeout = 3000'); d.prepare('UPDATE sessions SET auth_at = 1 WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username); } finally { d.close(); }
};

const DATA_A = path.join(tmp, 'old-computer', 'data');
const DATA_B = path.join(tmp, 'new-computer', 'data');
const ACCT_PORT = BASE_PORT + 20;
let A = null;
let B = null;
try {
  /* ══════════════ کامپیوترِ قدیم: ساختنِ فایل ══════════════ */
  console.log('── کامپیوترِ قدیم (A): ساختنِ فایلِ جابه‌جایی ──');
  fs.mkdirSync(path.join(DATA_A, 'account-server', 'pg'), { recursive: true });
  fs.writeFileSync(path.join(DATA_A, 'account-server', 'pg', 'money.txt'), '12345678');
  fs.mkdirSync(path.join(DATA_A, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(DATA_A, 'uploads', 'photo.bin'), crypto.randomBytes(300_000));
  fs.mkdirSync(path.join(DATA_A, 'cloudflared'), { recursive: true });
  fs.writeFileSync(path.join(DATA_A, 'cloudflared', 'cert.json'), '{"secret":"tunnel"}');
  A = await boot(BASE_PORT, DATA_A, { HLP_ACCOUNT_AUTOSTART: '1', HLP_ACCOUNT_API: `http://127.0.0.1:${ACCT_PORT}` });
  check('پنلِ A بالا آمد', A.up, A.out().slice(-400));
  const owner = (await A.call('POST', '/api/auth/setup', { username: 'owner', password: 'Owner-Pass-2026' })).json?.token;
  await A.call('POST', '/api/auth/users', { username: 'admin2', password: 'Admin2-Pass-2026', role: 'admin' }, owner);
  const admin2 = (await A.call('POST', '/api/auth/login', { username: 'admin2', password: 'Admin2-Pass-2026' })).json?.token;
  check('مالک و مدیرِ دوم', Boolean(owner && admin2));
  const beat = path.join(DATA_A, 'account-server', 'pg', 'heartbeat');
  for (let i = 0; i < 60 && !fs.existsSync(beat); i++) await wait(250);
  check('سرورِ حسابِ زیرِ نظرِ پنل روشن است (در دیتابیسش می‌نویسد)', fs.existsSync(beat), A.out().slice(-400));

  const e2 = await A.call('POST', '/api/move/export', { passphrase: 'x' }, admin2);
  check('⛔ مدیرِ دوم: ۴۰۳ owner_only پیش از سنجشِ رمز (رمزِ کوتاه هم همان)', e2.status === 403 && e2.json?.error === 'owner_only', JSON.stringify(e2));
  const i2 = await A.call('GET', '/api/move/info', undefined, admin2);
  check('⛔ مدیرِ دوم حتی فهرستِ «چه می‌رود» را نمی‌بیند', i2.status === 403 && i2.json?.error === 'owner_only', JSON.stringify(i2));
  const anon = await A.call('POST', '/api/move/export', { passphrase: PASS });
  check('⛔ بی ورود ۴۰۱', anon.status === 401, JSON.stringify(anon));

  staleSession(DATA_A, 'owner');
  const stale = await A.call('POST', '/api/move/export', { passphrase: PASS }, owner);
  check('⛔ مالک با نشستِ کهنه: reauth_required', stale.status === 403 && stale.json?.error === 'reauth_required', JSON.stringify(stale));
  const re = await A.call('POST', '/api/auth/reauth', { password: 'Owner-Pass-2026' }, owner);
  check('احرازِ دوباره', re.status === 200, JSON.stringify(re));
  const short = await A.call('POST', '/api/move/export', { passphrase: 'short-pass' }, owner);
  check('رمزِ کوتاه‌تر از ۱۲ نویسه: ۴۰۰', short.status === 400 && short.json?.error === 'passphrase_too_short', JSON.stringify(short));

  const info = await A.call('GET', '/api/move/info', undefined, owner);
  check('مالک: «چه نمی‌رود» با دلیل (تونل هم)', info.status === 200 && info.json.excluded.some((x) => x.what === 'cloudflared/' && /تونل/.test(x.why)), JSON.stringify(info.json).slice(0, 300));

  const ex = await A.call('POST', '/api/move/export', { passphrase: PASS }, owner);
  check('export آغاز شد', ex.status === 200 && ex.json?.job?.id, JSON.stringify(ex));
  const busy = await A.call('POST', '/api/move/export', { passphrase: PASS }, owner);
  const exJob = await pollJob(A, ex.json.job.id, owner);
  check('هم‌زمان دو جابه‌جایی نه (۴۰۹ busy) — یا اولی همان دم تمام شده بود', busy.status === 409 || busy.status === 200, JSON.stringify(busy));
  if (busy.status === 200 && busy.json?.job?.id) await pollJob(A, busy.json.job.id, owner);
  check('export تمام شد', exJob.state === 'done', JSON.stringify(exJob).slice(0, 400));
  const res = exJob.result || {};
  check('سرورِ حساب ایستاد و دوباره روشن شد', res.account?.paused === true && res.account?.resumed === true, JSON.stringify(res.account));
  const b1 = fs.readFileSync(beat, 'utf8');
  await wait(400);
  check('… و دوباره در دیتابیسش می‌نویسد', fs.readFileSync(beat, 'utf8') !== b1);
  check('نامِ فایلِ روشن و اندازه', /^vill3n-[A-Za-z0-9-]+-\d{8}-\d{4}\.vmove$/.test(res.name || '') && res.size > 1000, `${res.name} ${res.size}`);
  check('پوشهٔ کارِ موقت پاک شد', !fs.existsSync(path.join(DATA_A, '.vmove-panel', 'work')) || fs.readdirSync(path.join(DATA_A, '.vmove-panel', 'work')).length === 0);

  const dlPath = `/api/move/export/${res.id}/download`;
  const dl2 = await A.call('GET', dlPath, undefined, admin2);
  check('⛔ مدیرِ دوم دانلود نمی‌کند', dl2.status === 403, JSON.stringify(dl2));
  const ticket = (await A.call('POST', '/api/auth/ticket', { path: dlPath }, owner)).json?.ticket;
  const dl = await fetch(`${A.BASE}${dlPath}?ticket=${encodeURIComponent(ticket || '')}`);
  const bundle = Buffer.from(await dl.arrayBuffer());
  check('دانلود با بلیت: نامِ فایل در Content-Disposition و همان اندازه',
    dl.status === 200 && (dl.headers.get('content-disposition') || '').includes(res.name) && bundle.length === res.size, `${dl.status} ${dl.headers.get('content-disposition')}`);
  check('همان قالبِ ‎VILL3NMV1‎', bundle.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC));
  check('رازی به‌صورتِ متن در فایل نیست', !bundle.includes(Buffer.from('12345678')) && !bundle.includes(Buffer.from('tunnel')));
  const BUNDLE = path.join(tmp, 'moved.vmove');
  fs.writeFileSync(BUNDLE, bundle);
  const ins = await inspectBundle({ file: BUNDLE, pass: PASS });
  const names = ins.manifest.files.map((f) => f.name);
  check('ابزارِ خطِ فرمان همان فایل را باز می‌کند (یک قالب)', ins.ok, JSON.stringify(ins.bad));
  check('مانیفست: از پنلِ روشن، سرورِ حساب «paused»، تطبیقِ سرورِ حساب انجام شد',
    ins.manifest.live?.from === 'panel' && ins.manifest.live?.accountServer === 'paused' && ins.manifest.account?.reconciled === true, JSON.stringify(ins.manifest.live));
  check('دیتابیسِ پنل، سرورِ حساب و فایل‌ها در بسته؛ تونل و کارِ پنل نه',
    ['data/panel.db', 'data/account-server/pg/money.txt', 'data/account-server/pg/heartbeat', 'data/uploads/photo.bin'].every((n) => names.includes(n))
    && !names.some((n) => /cloudflared|\.vmove-|panel\.pid|node_modules/.test(n)), names.join(' '));

  /* ══════════════ کامپیوترِ نو: نصبِ تازه ══════════════ */
  console.log('── کامپیوترِ نو (B): «بازگرداندن از فایلِ جابه‌جایی» روی نصبِ تازه ──');
  //  این نوبت با راه‌اندازیِ دوبارهٔ **خودکار** — همان راهی که صاحب سامانه می‌بیند
  B = await boot(BASE_PORT + 10, DATA_B, { HLP_MOVE_RESTART: '1' });
  check('پنلِ B (تازه، بی مدیر) بالا آمد', B.up, B.out().slice(-400));
  const pub0 = await B.call('GET', '/api/move/public');
  check('صفحهٔ نخست می‌داند نصب تازه است', pub0.status === 200 && pub0.json?.initialized === false, JSON.stringify(pub0));
  const lan = await B.call('POST', '/api/move/import/begin', { size: bundle.length }, undefined, { 'X-Forwarded-For': '192.168.1.50' });
  check('⛔ از دستگاهِ دیگرِ شبکه بی کدِ یک‌بارِ راه‌اندازی: ۴۰۳', lan.status === 403 && lan.json?.error === 'setup_code_required', JSON.stringify(lan));

  const before = entries(DATA_B);
  const junk = Buffer.concat([Buffer.from('PK\x03\x04 not a bundle '), crypto.randomBytes(5000)]);
  const j = await upload(B, null, junk);
  check('فایلِ غیرِ .vmove پیش از نوشتن رد می‌شود', j.chunk?.status === 400 && j.chunk?.json?.error === 'not_vmove'
    && fs.readdirSync(path.join(DATA_B, '.vmove-panel', 'in')).length === 0, JSON.stringify(j));
  const big = await B.call('POST', '/api/move/import/begin', { size: 64 * 1024 ** 4 });
  check('سقفِ اندازه: ۴۱۳ پیش از هر بایت', big.status === 413 && big.json?.error === 'too_large', JSON.stringify(big));

  const tampered = Buffer.from(bundle);
  tampered[Math.floor(tampered.length / 2)] ^= 0x01;
  const t = await upload(B, null, tampered);
  check('بستهٔ دست‌خورده بارگذاری شد', Boolean(t.uploadId), JSON.stringify(t));
  const tShort = await B.call('POST', '/api/move/import/start', { uploadId: t.uploadId, passphrase: 'short' });
  check('رمزِ کوتاه ۴۰۰', tShort.status === 400 && tShort.json?.error === 'passphrase_too_short', JSON.stringify(tShort));
  const tStart = await B.call('POST', '/api/move/import/start', { uploadId: t.uploadId, passphrase: PASS });
  const tJob = tStart.json?.job ? await pollJob(B, tStart.json.job.id) : {};
  check('⛔ بستهٔ دست‌خورده رد شد', tJob.state === 'failed' && /رمز نادرست|دست خورده/.test(tJob.error || ''), JSON.stringify(tJob).slice(0, 300));
  check('… و هیچ چیزِ پوشهٔ داده عوض نشد (نه ready، نه importing)', entries(DATA_B) === before, `${before} ⇐ ${entries(DATA_B)}`);

  const g = await upload(B, null, bundle, { chunk: 100 * 1024 });
  check('بستهٔ درست تکه‌تکه بارگذاری شد', Boolean(g.uploadId), JSON.stringify(g));
  const bad = await fetch(`${B.BASE}/api/move/import/${g.uploadId}/chunk?offset=0`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('x') });
  check('تکهٔ اضافه پس از کامل شدن پذیرفته نمی‌شود', bad.status === 409, String(bad.status));
  const wrong = await B.call('POST', '/api/move/import/start', { uploadId: g.uploadId, passphrase: 'not the right passphrase' });
  const wJob = wrong.json?.job ? await pollJob(B, wrong.json.job.id) : {};
  check('رمزِ غلط ⇒ رد، هیچ چیز عوض نشد، فایل برای تلاشِ دوباره می‌ماند', wJob.state === 'failed' && entries(DATA_B) === before, JSON.stringify(wJob).slice(0, 300));
  const ok = await B.call('POST', '/api/move/import/start', { uploadId: g.uploadId, passphrase: PASS });
  const okJob = ok.json?.job ? await pollJob(B, ok.json.job.id) : {};
  check('بسته سنجیده شد (sha256، شمارِ ردیف، سرورِ حساب)', okJob.state === 'done' && okJob.result?.account?.reconciled === true && okJob.result?.summary?.files === names.length, JSON.stringify(okJob).slice(0, 400));
  check('… هنوز جابه‌جا نشده: فقط ‎.vmove-ready-‎ منتظرِ راه‌اندازیِ دوباره', fs.readdirSync(DATA_B).some((n) => n.startsWith('.vmove-ready-')) && !fs.existsSync(path.join(DATA_B, 'uploads', 'photo.bin')));

  //  پنل خودش پایین و دوباره بالا می‌آید (scheduleRestart) — پروسهٔ تازه مالِ آزمون نیست؛ با panel.pid بسته می‌شود
  let pub = null;
  for (let i = 0; i < 160; i++) {
    await wait(250);
    try { pub = await B.call('GET', '/api/move/public'); } catch { pub = null; }
    if (pub?.json?.lastImport) break;
  }
  check('پنل خودش دوباره بالا آمد (راه‌اندازیِ دوبارهٔ خودکار)', Boolean(pub?.json?.lastImport), B.out().slice(-400));
  const autoPid = Number(fs.readFileSync(path.join(DATA_B, 'panel.pid'), 'utf8'));
  const killAuto = async () => {
    try { process.kill(autoPid, 'SIGTERM'); } catch { /* رفته */ }
    for (let i = 0; i < 40; i++) { try { process.kill(autoPid, 0); await wait(200); } catch { break; } }
  };
  check('پس از راه‌اندازیِ دوباره: «همان بسته است»', pub.json?.initialized === true && pub.json?.lastImport?.ok === true && pub.json?.lastImport?.same === true, JSON.stringify(pub.json));
  check('خلاصهٔ عمومی بی نامِ فایل و بی نشانیِ پوشه', !JSON.stringify(pub.json).includes('photo') && !JSON.stringify(pub.json).includes(tmp));
  const ownerB = (await B.call('POST', '/api/auth/login', { username: 'owner', password: 'Owner-Pass-2026' })).json?.token;
  check('ورود با نام و رمزِ کامپیوترِ قدیم', Boolean(ownerB));
  const infoB = await B.call('GET', '/api/move/info', undefined, ownerB);
  check('مالک: نتیجهٔ کامل و پوشهٔ قبلی کنار رفت (پاک نه)', infoB.json?.lastImport?.compare?.same === true && infoB.json?.lastImport?.previous
    && fs.existsSync(path.join(infoB.json.lastImport.previous, 'panel.db')), JSON.stringify(infoB.json?.lastImport).slice(0, 300));
  check('داده‌ها آمدند', fs.readFileSync(path.join(DATA_B, 'account-server', 'pg', 'money.txt'), 'utf8') === '12345678'
    && fs.existsSync(path.join(DATA_B, 'uploads', 'photo.bin')) && !fs.existsSync(path.join(DATA_B, 'cloudflared')));
  const cmp = await compareData({ file: BUNDLE, dataDir: DATA_B, pass: PASS, accountTool: path.join(ACCT, 'scripts', 'move-db.js') });
  check('compare ِ خطِ فرمان هم: همان بسته', cmp.same, cmp.diffs.join(' · '));

  await killAuto();
  B = await boot(BASE_PORT + 10, DATA_B);
  check('پنلِ B زیرِ دستِ آزمون دوباره بالا آمد', B.up, B.out().slice(-400));

  /* ══════════════ نصبِ پُر: force و کنار گذاشتن ══════════════ */
  console.log('── نصبِ پُر: بی تأییدِ «کنار گذاشتن» نه؛ مدیرِ دوم نه؛ دادهٔ قبلی کنار، نه پاک ──');
  const admin2B = (await B.call('POST', '/api/auth/login', { username: 'admin2', password: 'Admin2-Pass-2026' })).json?.token;
  const a2 = await B.call('POST', '/api/move/import/begin', { size: bundle.length, force: true }, admin2B);
  check('⛔ مدیرِ دوم: ۴۰۳ owner_only', a2.status === 403 && a2.json?.error === 'owner_only', JSON.stringify(a2));
  const anonB = await B.call('POST', '/api/move/import/begin', { size: bundle.length, force: true });
  check('⛔ بی ورود روی نصبِ پُر: ۴۰۱', anonB.status === 401, JSON.stringify(anonB));
  const nf = await B.call('POST', '/api/move/import/begin', { size: bundle.length }, ownerB);
  check('بی force: ۴۰۹ force_required با توضیح', nf.status === 409 && nf.json?.error === 'force_required' && /کنار/.test(nf.json?.message || ''), JSON.stringify(nf));
  staleSession(DATA_B, 'owner');
  const st = await B.call('POST', '/api/move/import/begin', { size: bundle.length, force: true }, ownerB);
  check('⛔ نشستِ کهنه: reauth_required', st.status === 403 && st.json?.error === 'reauth_required', JSON.stringify(st));
  await B.call('POST', '/api/auth/reauth', { password: 'Owner-Pass-2026' }, ownerB);
  fs.writeFileSync(path.join(DATA_B, 'uploads', 'made-on-new.txt'), 'new computer data');
  const firstPrev = infoB.json?.lastImport?.previous;
  const f = await upload(B, ownerB, bundle, { force: true, chunk: 256 * 1024 });
  const fNo = await B.call('POST', '/api/move/import/start', { uploadId: f.uploadId, passphrase: PASS }, ownerB);
  check('آغاز بی force هم ۴۰۹', fNo.status === 409, JSON.stringify(fNo));
  const fs2 = await B.call('POST', '/api/move/import/start', { uploadId: f.uploadId, passphrase: PASS, force: true }, ownerB);
  const fJob = fs2.json?.job ? await pollJob(B, fs2.json.job.id, ownerB) : {};
  check('با force سنجیده شد', fJob.state === 'done', JSON.stringify(fJob).slice(0, 300));
  await B.stop();
  B = await boot(BASE_PORT + 10, DATA_B);
  const pub2 = await B.call('GET', '/api/move/public');
  const last2 = JSON.parse(fs.readFileSync(path.join(DATA_B, '.vmove-last-import.json'), 'utf8'));
  check('پس از راه‌اندازیِ دوباره: همان بسته', pub2.json?.lastImport?.same === true, JSON.stringify(pub2.json));
  check('دادهٔ قبلیِ این کامپیوتر کنار رفت، پاک نشد', last2.previous && last2.previous !== firstPrev
    && fs.readFileSync(path.join(last2.previous, 'uploads', 'made-on-new.txt'), 'utf8') === 'new computer data'
    && !fs.existsSync(path.join(DATA_B, 'uploads', 'made-on-new.txt')), last2.previous);
  check('کنارگذاشتهٔ نوبتِ قبل هم سرِ جایش است', Boolean(firstPrev) && fs.existsSync(path.join(firstPrev, 'panel.db')));
} catch (e) {
  check('بی خطای پیش‌بینی‌نشده', false, e.stack);
} finally {
  await A?.stop();
  await B?.stop();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed ? '❌' : '✅'} جابه‌جایی از پنل: ${passed} سبز، ${failed} قرمز`);
process.exit(failed ? 1 : 0);
