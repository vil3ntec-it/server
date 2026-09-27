// ---------------------------------------------------------------------------
//  آزمونِ نصبِ خودکار — «آپدیتی که میاد درجا دانلود کنه… لازم نباشه من وایسم»
//      node test/update-auto.mjs          (npm run test:update-auto)
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۵). چیزی از مسیرِ نصب شبیه‌سازی نمی‌شود: یک
//  GitHubِ ساختگی روی همین کامپیوتر فهرستِ انتشار و بستهٔ zip را می‌دهد، و
//  همان `autoUpdateOnce`ی که کارِ `panel-update` صدا می‌زند، واقعاً دانلود
//  می‌کند، باز می‌کند، بکاپ می‌گیرد و روی یک نصبِ بسته‌بندی‌شدهٔ ساختگی
//  (چیدمانِ برنامهٔ ویندوز) می‌نشاند — و نشانهٔ `applied.json` را می‌نویسد که
//  برنامهٔ ویندوز با دیدنش خودش دوباره باز می‌شود (desktop/test/unattended.mjs).
// ---------------------------------------------------------------------------
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`); }
};

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-autoupd-'));
const serverRoot = path.join(tmp, 'Control Center', 'resources', 'server');
const shellDir = path.join(tmp, 'userData', 'app-update');
const dataDir = path.join(tmp, 'data');
await fsp.mkdir(path.join(serverRoot, 'src'), { recursive: true });
await fsp.mkdir(path.join(serverRoot, 'node_modules', 'ws'), { recursive: true });
await fsp.mkdir(shellDir, { recursive: true });

const realDeps = JSON.parse(await fsp.readFile(new URL('../package.json', import.meta.url), 'utf8')).dependencies || {};
await fsp.writeFile(path.join(serverRoot, 'package.json'), JSON.stringify({ name: 'homelab-panel-server', version: '0.0.1', dependencies: realDeps }));
await fsp.writeFile(path.join(serverRoot, 'src', 'index.js'), '// نسخهٔ قدیمی\n');
await fsp.writeFile(path.join(serverRoot, '.env'), 'SECRET=دست-نخورد\n');
await fsp.writeFile(path.join(shellDir, 'shell.js'), '// پوستهٔ قدیمی\n');

/* ───────── GitHubِ ساختگی: فهرستِ انتشار + zip، و شمارِ هر درخواست ───────── */
const hits = { releases: 0, zip: 0 };
let release = null; // انتشارِ فعلیِ «آن‌طرف»
let zipFile = null;
const gh = http.createServer((req, res) => {
  if (req.url.startsWith('/repos/x/y/releases')) {
    hits.releases++;
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(release ? [release] : []));
  }
  if (req.url.startsWith('/zip/')) {
    hits.zip++;
    const buf = fs.readFileSync(zipFile);
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': buf.length });
    return res.end(buf);
  }
  res.writeHead(404); res.end('{}');
});
await new Promise((r) => gh.listen(0, '127.0.0.1', r));
const GH = `http://127.0.0.1:${gh.address().port}`;

process.env.HLP_APP_LAYOUT = 'packaged';
process.env.HLP_SERVER_ROOT = serverRoot;
process.env.HLP_SHELL_DIR = shellDir;
process.env.HLP_DATA_DIR = dataDir;
process.env.HLP_UPDATE_REPO = 'x/y';
process.env.HLP_GITHUB_API = GH;
process.env.NO_PROXY = '127.0.0.1,localhost';
delete process.env.HLP_AUTO_UPDATE;

const { ensureControlSchema } = await import('../src/control/schema.js');
ensureControlSchema();
const { createZip, walk } = await import('../src/control/zip.js');
const { getSetting, setSetting } = await import('../src/db.js');
const updater = await import('../src/update/github.js');
const { versionInfo } = await import('../src/version.js');
const { jobs, REQUIRED_JOBS } = await import('../src/automation/jobs/index.js');

async function makeZip(name, files) {
  const root = path.join(tmp, 'pkg', name, 'server-main');
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, text, 'utf8');
  }
  const out = path.join(tmp, `${name}.zip`);
  await createZip(out, await walk(path.join(tmp, 'pkg', name)));
  return out;
}
const releaseOf = (version, sha) => ({
  tag_name: 'windows-preview',
  name: 'Windows preview',
  draft: false,
  prerelease: true,
  target_commitish: sha,
  published_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  body: 'آزمون',
  zipball_url: `${GH}/zip/${sha}`,
  assets: [{ name: `ControlCenter-Setup-${version}.exe` }],
});
const read = (p) => fs.readFileSync(p, 'utf8');

try {
  console.log('\n── پیش‌فرض‌ها ──');
  check('در برنامهٔ ویندوز نصبِ خودکار پیش‌فرض روشن است', updater.autoInstallDefault() === true && updater.autoInstallEnabled() === true);
  process.env.HLP_AUTO_UPDATE = '0';
  check('HLP_AUTO_UPDATE=0 همیشه خاموش', updater.autoInstallEnabled() === false);
  delete process.env.HLP_AUTO_UPDATE;
  check('updateStatus نشانش می‌دهد (autoInstall)', updater.updateStatus().autoInstall === true);

  console.log('\n── کارِ panel-update در موتورِ اتوماسیون ──');
  const job = jobs.find((j) => j.name === 'panel-update');
  check('ثبت شده و در فهرستِ اجباری است', Boolean(job) && REQUIRED_JOBS.includes('panel-update'));
  check('هر ساعت', job?.every === 60 * 60_000, job?.every);
  check('سه دقیقه پس از روشن شدن هم یک بار (runOnStart)', job?.runOnStart === 3 * 60_000, job?.runOnStart);
  check('یک تلاش — بسته‌ی ناموفق هر دقیقه دوباره دانلود نمی‌شود', job?.attempts === 1);

  console.log('\n── خاموش ⇒ حتی از GitHub نمی‌پرسد ──');
  setSetting('cc_update_autoinstall', false);
  const off = await updater.autoUpdateOnce({ restart: false });
  check('رد شد، با دلیل', off.skipped && /خاموش/.test(off.reason), JSON.stringify(off));
  check('صفر درخواست به GitHub', hits.releases === 0 && hits.zip === 0, JSON.stringify(hits));
  setSetting('cc_update_autoinstall', null);

  console.log('\n── چیزی تازه نیست ⇒ یک پرسش، صفر دانلود ──');
  release = releaseOf(versionInfo.version, 'a'.repeat(40));
  setSetting('cc_update_commit', 'a'.repeat(40));
  setSetting('cc_update_installed_at', Date.now() + 60_000);
  const same = await updater.autoUpdateOnce({ restart: false });
  check('«تازه‌ترین است»', same.skipped && /تازه‌ترین/.test(same.reason), JSON.stringify(same));
  check('فقط فهرست پرسیده شد، zip نه', hits.releases === 1 && hits.zip === 0, JSON.stringify(hits));

  console.log('\n── نسخهٔ عقب‌تر هرگز خودکار نمی‌نشیند ──');
  release = releaseOf('0.0.1', 'b'.repeat(40));
  const back = await updater.autoUpdateOnce({ restart: false });
  check('رد شد', back.skipped === true, JSON.stringify(back));
  check('و دانلود نشد', hits.zip === 0);

  console.log('\n── بستهٔ ناقص ⇒ ثبت و ۲۴ ساعت کنار، نه دانلودِ ساعتی ──');
  zipFile = await makeZip('broken', {
    'homelab-panel/server/package.json': JSON.stringify({ name: 'homelab-panel-server', version: '9.9.8', dependencies: realDeps }),
    //  نه src/index.js و نه پوستهٔ برنامه — packageProblems ردش می‌کند
    'README.md': 'ناقص',
  });
  release = releaseOf('9.9.8', 'c'.repeat(40));
  let brokeErr = null;
  try { await updater.autoUpdateOnce({ restart: false }); } catch (e) { brokeErr = e; }
  check('نصب نشد و خطا داد', Boolean(brokeErr), brokeErr?.message);
  check('کدِ قبلی دست‌نخورده ماند', read(path.join(serverRoot, 'src', 'index.js')).includes('قدیمی'));
  const af = getSetting('cc_update_autofail', null);
  check('همان نسخه در cc_update_autofail ثبت شد', af?.latest === '9.9.8' && af?.commit === 'c'.repeat(40), JSON.stringify(af));
  check('و صفحه دلیلش را می‌بیند (updateStatus.autoFail)', updater.updateStatus().autoFail?.latest === '9.9.8');
  const zipsBefore = hits.zip;
  const held = await updater.autoUpdateOnce({ restart: false });
  check('دورِ بعد همان بسته دوباره دانلود نمی‌شود', held.skipped && /۲۴ ساعت/.test(held.reason) && hits.zip === zipsBefore, JSON.stringify(held));
  check('heldBack: پس از ۲۴ ساعت دوباره امتحان می‌شود',
    updater.heldBack({ latest: '9.9.8', commit: 'c'.repeat(40) }, { ...af, at: Date.now() - updater.AUTOFAIL_HOLD_MS - 1 }) === false);
  check('heldBack: کامیتِ تازه‌تر همان لحظه امتحان می‌شود',
    updater.heldBack({ latest: '9.9.8', commit: 'd'.repeat(40) }, af) === false);

  console.log('\n── نسخهٔ تازهٔ سالم ⇒ خودش دانلود و نصب، بی هیچ کلیکی ──');
  zipFile = await makeZip('good', {
    'homelab-panel/server/package.json': JSON.stringify({ name: 'homelab-panel-server', version: '9.9.9', dependencies: realDeps }),
    'homelab-panel/server/src/index.js': '// نسخهٔ تازه\n',
    'homelab-panel/server/.env': 'SECRET=از-بسته-نباید-بیاید',
    'homelab-panel/desktop/app/main-impl.js': '// مغزِ تازه\n',
    'homelab-panel/desktop/app/shell.js': '// پوستهٔ تازه\n',
  });
  release = releaseOf('9.9.9', 'e'.repeat(40));
  const t0 = Date.now();
  const ok = await updater.autoUpdateOnce({ restart: false });
  check('نصب شد', ok.ok === true && ok.to === '9.9.9', JSON.stringify({ ok: ok.ok, to: ok.to, reason: ok.reason }));
  check('کدِ سرور عوض شد', read(path.join(serverRoot, 'src', 'index.js')).includes('تازه'));
  check('پوستهٔ برنامهٔ ویندوز هم عوض شد', read(path.join(shellDir, 'shell.js')).includes('تازه'));
  check('.env دست نخورد', read(path.join(serverRoot, '.env')).includes('دست-نخورد'));
  check('پیش از نصب بکاپ گرفته شد', ok.steps?.some((s) => s.name === 'backup' && s.status === 'ok'));
  const applied = JSON.parse(read(path.join(dataDir, 'updates', 'applied.json')));
  check('نشانهٔ applied.json برای برنامهٔ ویندوز نوشته شد (همان که دوباره بازش می‌کند)',
    applied.version === '9.9.9' && applied.at >= t0 && applied.layout === 'packaged', JSON.stringify(applied));
  check('cc_update_autofail پاک شد', getSetting('cc_update_autofail', null) == null);
  check('کامیتِ نصب‌شده ثبت شد', getSetting('cc_update_commit', null) === 'e'.repeat(40));
  check('نصب «در جریان» نمانده', updater.installBusy() === false);

  console.log('\n── دکمهٔ دستی و کارِ خودکار یک در دارند ──');
  updater.markInstall({ running: true, phase: 'download' });
  const busy = await updater.autoUpdateOnce({ restart: false });
  check('وقتی نصبِ دستی در جریان است، کارِ خودکار دومی راه نمی‌اندازد', busy.skipped && /در جریان/.test(busy.reason), JSON.stringify(busy));
  const busy2 = await updater.installLatest({ restart: false });
  check('installLatest هم همان را می‌گوید', busy2.reason === 'install_running');
  updater.markInstall({ running: false, phase: 'idle' });
} catch (e) {
  fail++;
  console.log(`\n❌ ${e.message}\n${e.stack?.split('\n').slice(1, 5).join('\n') || ''}`);
} finally {
  gh.close();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log('════════════════════════════════════');
process.exit(fail ? 1 : 0);
