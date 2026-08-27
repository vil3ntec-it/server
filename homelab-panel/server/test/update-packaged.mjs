// ---------------------------------------------------------------------------
//  آزمونِ به‌روزرسانی در چیدمانِ برنامهٔ ویندوز
//      node test/update-packaged.mjs
//
//  چرا جداست: چیدمان از متغیرهای محیطی خوانده می‌شود، و آن‌ها موقعِ وارد
//  کردنِ ماژول تثبیت می‌شوند.
//
//  چیزی که واقعاً می‌سنجد: در برنامهٔ بسته‌بندی‌شده، سرور در resources/server
//  است نه homelab-panel/server. قبلاً به‌روزرسانی درختِ مخزن را همان‌طور که
//  بود کنارِ برنامه می‌ریخت، «موفق» گزارش می‌داد و چیزی که واقعاً اجرا
//  می‌شود عوض نمی‌شد. اینجا بی‌رحمانه بررسی می‌شود که این اتفاق نمی‌افتد.
// ---------------------------------------------------------------------------
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ' — ' + String(extra).slice(0, 300) : ''}`);
  }
};

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-packaged-'));
const installDir = path.join(tmp, 'Control Center');       // جایی که برنامه نصب شده
const serverRoot = path.join(installDir, 'resources', 'server');
const shellDir = path.join(tmp, 'userData', 'app-update'); // پوستهٔ به‌روزرسانی‌شده
const dataDir = path.join(tmp, 'data');

// ── نصبِ بسته‌بندی‌شدهٔ ساختگی ──
await fsp.mkdir(path.join(serverRoot, 'src'), { recursive: true });
await fsp.mkdir(path.join(serverRoot, 'data', 'Projects', 'shop'), { recursive: true });
await fsp.mkdir(path.join(serverRoot, 'node_modules', 'ws'), { recursive: true });
await fsp.mkdir(shellDir, { recursive: true });

const realDeps = JSON.parse(await fsp.readFile(new URL('../package.json', import.meta.url), 'utf8')).dependencies || {};

await fsp.writeFile(path.join(serverRoot, 'package.json'), JSON.stringify({ name: 'homelab-panel-server', version: '0.0.1', dependencies: realDeps }, null, 2));
await fsp.writeFile(path.join(serverRoot, 'src', 'index.js'), '// نسخهٔ قدیمی\n');
await fsp.writeFile(path.join(serverRoot, '.env'), 'SECRET=دست-نخورد\n');
await fsp.writeFile(path.join(serverRoot, 'data', 'panel.db'), 'دادهٔ من');
await fsp.writeFile(path.join(serverRoot, 'data', 'Projects', 'shop', 'app.js'), 'پروژهٔ من');
await fsp.writeFile(path.join(serverRoot, 'node_modules', 'ws', 'index.js'), 'وابستگی');
await fsp.writeFile(path.join(shellDir, 'shell.js'), '// پوستهٔ قدیمی\n');

process.env.HLP_APP_LAYOUT = 'packaged';
process.env.HLP_SERVER_ROOT = serverRoot;
process.env.HLP_SHELL_DIR = shellDir;
process.env.HLP_DATA_DIR = dataDir;

const { ensureControlSchema } = await import('../src/control/schema.js');
ensureControlSchema();
const { createZip } = await import('../src/control/zip.js');
const updater = await import('../src/update/github.js');

/** بستهٔ ساختگی با همان چیدمانِ مخزن که GitHub می‌دهد */
const pkgRoot = path.join(tmp, 'package-src', 'server-main');
const write = async (rel, text) => {
  const full = path.join(pkgRoot, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, text, 'utf8');
};

await write('homelab-panel/server/package.json', JSON.stringify({ name: 'homelab-panel-server', version: '9.9.9', dependencies: realDeps }, null, 2));
await write('homelab-panel/server/src/index.js', '// نسخهٔ تازه\n');
await write('homelab-panel/server/src/control/schema.js', '// طرحِ تازه\n');
await write('homelab-panel/server/public/index.html', '<!doctype html><title>تازه</title>');
await write('homelab-panel/server/data/panel.db', 'دادهٔ بسته — نباید بنشیند');
await write('homelab-panel/server/.env', 'SECRET=از-بسته-نباید-بیاید');
await write('homelab-panel/desktop/app/shell.js', '// پوستهٔ تازه\n');
await write('homelab-panel/desktop/app/main-impl.js', '// مغزِ تازه\n');
await write('homelab-panel/desktop/package.json', JSON.stringify({ version: '9.9.9' }));
await write('homelab-panel/web/src/App.tsx', 'سورسِ رابط کاربری — داخلِ برنامه لازم نیست');
await write('ai-support/index.js', 'دستیار — داخلِ برنامه لازم نیست');
await write('README.md', '# مستندات — داخلِ برنامه لازم نیست');

const { walk } = await import('../src/control/zip.js');
const zipPath = path.join(tmp, 'package.zip');
await createZip(zipPath, await walk(path.join(tmp, 'package-src')));

const exists = (p) => fs.existsSync(p);
const read = (p) => fs.readFileSync(p, 'utf8');

try {
  console.log('\n── چیدمان ──');
  const status = updater.updateStatus();
  check('چیدمان «بسته‌بندی‌شده» شناخته شد', status.layout === 'packaged', status.layout);
  check('ریشهٔ نصب همان resources/server است', status.installRoot === serverRoot, status.installRoot);
  check('پوشهٔ پوسته شناخته شد', status.shellDir === shellDir, String(status.shellDir));

  console.log('\n── نصبِ به‌روزرسانی ──');
  const res = await updater.applyUpdate(
    { latest: '9.9.9', commit: 'abc1234', repo: 'vil3ntec-it/server' },
    { path: zipPath },
    { actor: 'آزمون', restart: false },
  );
  check('به‌روزرسانی بدونِ خطا نصب شد', res.ok === true, JSON.stringify(res.steps || []).slice(0, 300));

  console.log('\n── فایل‌ها سرِ جای درست نشستند ──');
  check('کدِ سرور در resources/server عوض شد',
        exists(path.join(serverRoot, 'src', 'index.js')) && read(path.join(serverRoot, 'src', 'index.js')).includes('تازه'),
        read(path.join(serverRoot, 'src', 'index.js')));
  check('فایلِ تازه هم آمد', exists(path.join(serverRoot, 'src', 'control', 'schema.js')));
  check('رابط کاربریِ ساخته‌شده آمد', exists(path.join(serverRoot, 'public', 'index.html')));
  check('نسخهٔ package.json به‌روز شد',
        JSON.parse(read(path.join(serverRoot, 'package.json'))).version === '9.9.9');

  console.log('\n── پوستهٔ برنامه ──');
  check('پوستهٔ تازه در پوشهٔ به‌روزرسانی نشست',
        exists(path.join(shellDir, 'shell.js')) && read(path.join(shellDir, 'shell.js')).includes('تازه'),
        read(path.join(shellDir, 'shell.js')));
  check('مغزِ برنامه هم به‌روز شد',
        exists(path.join(shellDir, 'main-impl.js')) && read(path.join(shellDir, 'main-impl.js')).includes('تازه'));

  console.log('\n── همان باگی که این کار را لازم کرد ──');
  check('هیچ پوشهٔ homelab-panel ای کنارِ برنامه ساخته نشد', !exists(path.join(installDir, 'homelab-panel')));
  check('هیچ پوشهٔ resources تودرتویی ساخته نشد', !exists(path.join(serverRoot, 'resources')));
  check('سورسِ رابط کاربری داخلِ برنامه ریخته نشد', !exists(path.join(serverRoot, '..', '..', 'homelab-panel')));
  check('دستیار و مستندات کپی نشدند',
        !exists(path.join(installDir, 'ai-support')) && !exists(path.join(installDir, 'README.md')));

  console.log('\n── چیزهایی که نباید دست بخورند ──');
  check('.env دست‌نخورده ماند', read(path.join(serverRoot, '.env')).includes('دست-نخورد'));
  check('دیتابیس دست‌نخورده ماند', read(path.join(serverRoot, 'data', 'panel.db')) === 'دادهٔ من');
  check('پوشهٔ پروژه‌ها دست‌نخورده ماند', read(path.join(serverRoot, 'data', 'Projects', 'shop', 'app.js')) === 'پروژهٔ من');
  check('node_modules دست‌نخورده ماند', read(path.join(serverRoot, 'node_modules', 'ws', 'index.js')) === 'وابستگی');

  console.log('\n── نشانهٔ «دوباره باز شو» ──');
  const appliedPath = path.join(dataDir, 'updates', 'applied.json');
  check('فایلِ نشانه نوشته شد', exists(appliedPath));
  const applied = JSON.parse(read(appliedPath));
  check('نسخه داخلش هست', applied.version === '9.9.9', JSON.stringify(applied));
  check('چیدمان داخلش هست', applied.layout === 'packaged');

  console.log('\n── بسته‌ای که بخش‌های نصب را ندارد ──');
  // همان اتفاقی که واقعاً افتاد: بسته از شاخه‌ای آمد که مرکز فرمان و پوستهٔ
  // برنامه را ندارد. اگر بنشیند، همه‌شان پاک می‌شوند.
  const thinRoot = path.join(tmp, 'thin-src', 'server-main');
  const writeThin = async (rel, text) => {
    const full = path.join(thinRoot, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, text, 'utf8');
  };
  await writeThin('homelab-panel/server/package.json', JSON.stringify({ name: 'homelab-panel-server', version: '9.9.9', dependencies: realDeps }, null, 2));
  await writeThin('homelab-panel/server/src/index.js', '// پنلِ قدیمی\n');
  await writeThin('homelab-panel/server/public/index.html', '<!doctype html><title>قدیمی</title>');
  // نه src/control، نه src/update، نه desktop/app

  const thinZip = path.join(tmp, 'thin.zip');
  await createZip(thinZip, await walk(path.join(tmp, 'thin-src')));

  const before = read(path.join(serverRoot, 'src', 'index.js'));
  let refused = null;
  try {
    await updater.applyUpdate({ latest: '9.9.9', repo: 'x/y' }, { path: thinZip }, { actor: 'آزمون', restart: false });
  } catch (e) {
    refused = e;
  }
  check('چنین بسته‌ای نصب نمی‌شود', refused?.message === 'package_incomplete', refused?.message || 'نصب شد!');
  check('می‌گوید دقیقاً چه چیزی کم است',
        (refused?.problems || []).some((x) => x.includes('src/control')) &&
        (refused?.problems || []).some((x) => x.includes('desktop/app')),
        JSON.stringify(refused?.problems || []));
  check('هیچ فایلی عوض نشد', read(path.join(serverRoot, 'src', 'index.js')) === before);
  check('مرکز فرمان سرِ جایش ماند', exists(path.join(serverRoot, 'src', 'control', 'schema.js')));
  check('پوستهٔ برنامه سرِ جایش ماند', exists(path.join(shellDir, 'shell.js')));

  console.log('\n── بستهٔ عقب‌تر ──');
  const oldRoot = path.join(tmp, 'old-src', 'server-main');
  const writeOld = async (rel, text) => {
    const full = path.join(oldRoot, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, text, 'utf8');
  };
  await writeOld('homelab-panel/server/package.json', JSON.stringify({ name: 'homelab-panel-server', version: '0.0.1', dependencies: realDeps }, null, 2));
  await writeOld('homelab-panel/server/src/index.js', '// خیلی قدیمی\n');
  await writeOld('homelab-panel/server/src/control/schema.js', '// هست');
  await writeOld('homelab-panel/server/src/update/github.js', '// هست');
  await writeOld('homelab-panel/server/public/index.html', '<!doctype html>');
  await writeOld('homelab-panel/desktop/app/main-impl.js', '// هست');
  const oldZip = path.join(tmp, 'old.zip');
  await createZip(oldZip, await walk(path.join(tmp, 'old-src')));

  let refusedOld = null;
  try {
    await updater.applyUpdate({ latest: '0.0.1', repo: 'x/y' }, { path: oldZip }, { actor: 'آزمون', restart: false });
  } catch (e) {
    refusedOld = e;
  }
  check('نسخهٔ عقب‌تر هم نصب نمی‌شود', refusedOld?.message === 'package_incomplete', refusedOld?.message || 'نصب شد!');
  check('دلیلش را می‌گوید',
        (refusedOld?.problems || []).some((x) => x.includes('عقب‌تر')),
        JSON.stringify(refusedOld?.problems || []));

  console.log('\n── برگشت ──');
  await updater.rollback({ actor: 'آزمون' });
  check('کدِ قبلیِ سرور برگشت', read(path.join(serverRoot, 'src', 'index.js')).includes('قدیمی'));
  check('پوستهٔ قبلی هم برگشت', read(path.join(shellDir, 'shell.js')).includes('قدیمی'));
  check('.env بعد از برگشت هم سالم است', read(path.join(serverRoot, '.env')).includes('دست-نخورد'));
} catch (e) {
  fail++;
  console.log(`\n❌ ${e.message}\n${e.stack?.split('\n').slice(1, 4).join('\n') || ''}`);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log('════════════════════════════════════');
process.exit(fail ? 1 : 0);
