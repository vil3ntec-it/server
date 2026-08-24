// ---------------------------------------------------------------------------
//  آزمونِ کتابخانهٔ سرور
//      node test/storage.mjs
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4788);
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-store-'));
const dataDir = path.join(tmp, 'data');
const sitesRoot = path.join(tmp, 'old-sites');
const library = path.join(tmp, 'HomeServer');
fs.mkdirSync(sitesRoot, { recursive: true });

// دو پوشهٔ «پراکنده» می‌سازیم تا مرتب‌کردن آزموده شود
fs.mkdirSync(path.join(sitesRoot, 'shop'), { recursive: true });
fs.writeFileSync(path.join(sitesRoot, 'shop', 'index.html'), '<h1>shop</h1>');
fs.mkdirSync(path.join(sitesRoot, 'random-stuff', 'inner'), { recursive: true });
fs.writeFileSync(path.join(sitesRoot, 'random-stuff', 'inner', 'a.txt'), 'x');

let passed = 0;
let failed = 0;
const check = (name, ok, extra = '') => {
  if (ok) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(import.meta.dirname, '..', 'src', 'index.js')], {
  env: {
    ...process.env,
    HLP_PORT: String(PORT), HLP_HOST: '127.0.0.1', HLP_DATA_DIR: dataDir,
    HLP_SITES_ROOT: sitesRoot, HLP_TUNNEL: '0', HLP_AI_ENABLED: '0',
    HLP_SITESYNC_PORT: String(PORT + 1),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (out += d));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function up() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return true; } catch { /* هنوز */ }
    await wait(250);
  }
  return false;
}

try {
  if (!await up()) throw new Error(`سرور بالا نیامد:\n${out.slice(-1500)}`);
  const key = fs.readFileSync(path.join(dataDir, 'local-admin.key'), 'utf8').trim();
  const H = { 'X-Local-Key': key, 'Content-Type': 'application/json' };
  const get = async (p) => (await fetch(BASE + p, { headers: H })).json();
  const post = async (p, body) => {
    const r = await fetch(BASE + p, { method: 'POST', headers: H, body: JSON.stringify(body || {}) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  console.log('\n▶ پیش از انتخابِ محل');
  const before = await get('/api/storage');
  check('وضعیت خوانده می‌شود', before.ok === true);
  check('می‌گوید هنوز تنظیم نشده', before.configured === false);
  check('یک محلِ پیشنهادی می‌دهد', typeof before.suggested === 'string' && before.suggested.length > 0);

  const noKey = await fetch(`${BASE}/api/storage`);
  check('بدونِ کلید بسته است', noKey.status === 401);

  console.log('\n▶ ساختنِ کتابخانه');
  const bad = await post('/api/storage/check', { root: '' });
  check('مسیرِ خالی رد می‌شود', bad.status === 400);

  const made = await post('/api/storage/setup', { root: library });
  check('کتابخانه ساخته شد', made.status === 200 && made.body.ok === true, JSON.stringify(made.body).slice(0, 120));

  const wanted = ['Server/config', 'Server/database', 'Server/logs', 'Server/cache', 'Server/system',
    'Sites', 'Apps', 'Backups/Daily', 'Backups/Weekly', 'Backups/Manual', 'Downloads', 'Temp', 'Unsorted'];
  const missing = wanted.filter((w) => !fs.existsSync(path.join(library, ...w.split('/'))));
  check('همهٔ شاخه‌ها ساخته شدند', missing.length === 0, missing.join(', '));
  check('راهنمای پوشه گذاشته شد', fs.existsSync(path.join(library, 'راهنمای-این-پوشه.txt')));

  const after = await get('/api/storage');
  check('حالا تنظیم‌شده گزارش می‌شود', after.configured === true && after.healthy === true);
  check('فضای دیسک خوانده می‌شود', after.disk.ok === true && after.disk.total > 0);

  console.log('\n▶ پوشهٔ مستقل برای هر پروژه');
  const site1 = await post('/api/storage/sites', { name: 'پمپ یعقوبی' });
  check('پوشهٔ سایت ساخته شد', site1.status === 200 && fs.existsSync(site1.body.folders.base));
  const subs = ['app', 'data', 'logs', 'backup', 'config'];
  check('زیرپوشه‌های سایت کامل‌اند',
    subs.every((s) => fs.existsSync(path.join(site1.body.folders.base, s))));

  const site2 = await post('/api/storage/sites', { name: 'پمپ یعقوبی' });
  check('نامِ تکراری جدا می‌شود', site2.body.folders.folder !== site1.body.folders.folder, `${site1.body.folders.folder} / ${site2.body.folders.folder}`);
  check('نامِ دوم پسوندِ ۲ دارد', site2.body.folders.folder.endsWith('-2'), site2.body.folders.folder);

  const app1 = await post('/api/storage/apps', { name: 'Android: Shop?' });
  check('پوشهٔ برنامه ساخته شد', app1.status === 200 && fs.existsSync(app1.body.folders.base));
  check('نویسه‌های ممنوعِ ویندوز پاک شدند', !/[<>:"/\\|?*]/.test(app1.body.folders.folder), app1.body.folders.folder);
  check('زیرپوشه‌های برنامه کامل‌اند',
    ['data', 'logs', 'config', 'backup'].every((s) => fs.existsSync(path.join(app1.body.folders.base, s))));

  const bothInPlace = fs.existsSync(path.join(library, 'Sites', site1.body.folders.folder))
    && fs.existsSync(path.join(library, 'Apps', app1.body.folders.folder));
  check('سایت و برنامه هرکدام جای خودشان', bothInPlace);

  console.log('\n▶ پیدا کردنِ پوشه‌های پراکنده');
  const scan = await get('/api/storage/scan');
  const names = (scan.found || []).map((f) => f.name);
  check('پوشه‌های پراکنده پیدا شدند', names.includes('shop') && names.includes('random-stuff'), names.join(', '));
  const unclear = (scan.found || []).find((f) => f.name === 'random-stuff');
  check('چیزی که معلوم نیست → Unsorted', unclear && unclear.suggestedBranch === 'Unsorted', unclear?.suggestedBranch);
  const clear = (scan.found || []).find((f) => f.name === 'shop');
  check('سایتِ شناخته‌شده → Sites', clear && clear.suggestedBranch === 'Sites', clear?.suggestedBranch);

  console.log('\n▶ مرتب کردن (اول پیش‌نمایش، بعد انتقال)');
  const preview = await post('/api/storage/organize/preview', {
    items: [{ path: path.join(sitesRoot, 'shop'), name: 'shop', branch: 'Sites' }],
  });
  check('پیش‌نمایش مقصد را می‌گوید', preview.body.plan[0].ok === true && preview.body.plan[0].target.includes('Sites'));
  check('هنوز چیزی جابه‌جا نشده', fs.existsSync(path.join(sitesRoot, 'shop')));

  const moved = await post('/api/storage/organize/apply', {
    items: [{ path: path.join(sitesRoot, 'shop'), name: 'shop', branch: 'Sites' }],
  });
  const step = moved.body.done[0];
  check('انتقال انجام شد', step.moved === true && step.verified === true, JSON.stringify(step).slice(0, 120));
  check('فایل‌ها در مقصدند', fs.existsSync(path.join(step.target, 'index.html')));
  check('بدونِ اجازه، منبع پاک نمی‌شود', fs.existsSync(path.join(sitesRoot, 'shop')));

  console.log('\n▶ نظافتِ فایل‌های موقت');
  const oldFile = path.join(library, 'Temp', 'old.txt');
  fs.writeFileSync(oldFile, 'x');
  const past = Date.now() - 48 * 3600 * 1000;
  fs.utimesSync(oldFile, past / 1000, past / 1000);
  fs.writeFileSync(path.join(library, 'Temp', 'new.txt'), 'x');
  const cleaned = await post('/api/storage/clean-temp', { olderThanHours: 24 });
  check('فایلِ موقتِ قدیمی پاک شد', cleaned.body.removed === 1 && !fs.existsSync(oldFile));
  check('فایلِ تازه دست نخورد', fs.existsSync(path.join(library, 'Temp', 'new.txt')));

  console.log('\n▶ ترمیم');
  await fsp.rm(path.join(library, 'Backups', 'Weekly'), { recursive: true, force: true });
  const repaired = await post('/api/storage/repair', {});
  check('شاخهٔ پاک‌شده دوباره ساخته شد', repaired.body.ok && fs.existsSync(path.join(library, 'Backups', 'Weekly')));
} catch (e) {
  failed++;
  console.log(`\n❌ ${e.message}`);
  console.log(out.slice(-1200));
} finally {
  child.kill('SIGTERM');
  await wait(400);
  child.kill('SIGKILL');
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} تست درست، ${failed} تست خراب\n`);
process.exit(failed === 0 ? 0 : 1);
