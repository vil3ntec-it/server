// ---------------------------------------------------------------------------
//  آزمونِ واقعیِ به‌روزرسانی از GitHub
//      node test/update.mjs
//
//  یک نصبِ ساختگی (ولی کامل) در پوشهٔ موقت ساخته می‌شود، بستهٔ واقعیِ GitHub
//  رویش نصب می‌شود و بعد بررسی می‌کنیم:
//      • فایل‌های برنامه واقعاً عوض شده‌اند،
//      • پوشهٔ data و فایل .env دست‌نخورده مانده‌اند،
//      • بکاپِ نصبِ قبلی گرفته شده و برگشت کار می‌کند.
//
//  اگر اینترنت نبود، آزمون با پیامِ روشن رد می‌شود (نه شکست).
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import fsp from 'node:fs/promises';
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

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-update-'));
const installRoot = path.join(tmp, 'install');
const dataDir = path.join(tmp, 'data');

// نصبِ ساختگی: همان چیدمانِ واقعی، با چند فایلِ نشانه‌دار
await fsp.mkdir(path.join(installRoot, 'homelab-panel', 'server', 'src'), { recursive: true });
await fsp.mkdir(path.join(installRoot, 'homelab-panel', 'server', 'data', 'Projects', 'shop'), { recursive: true });
await fsp.mkdir(path.join(installRoot, 'ai-support'), { recursive: true });
await fsp.writeFile(path.join(installRoot, 'homelab-panel', 'server', 'package.json'), JSON.stringify({ name: 'homelab-panel-server', version: '0.0.1' }, null, 2));
await fsp.writeFile(path.join(installRoot, 'homelab-panel', 'server', 'src', 'index.js'), '// نسخهٔ قدیمی\n');
await fsp.writeFile(path.join(installRoot, 'homelab-panel', 'server', '.env'), 'HLP_PORT=4700\nSECRET=دست-نخورد\n');
await fsp.writeFile(path.join(installRoot, 'homelab-panel', 'server', 'data', 'panel.db'), 'دادهٔ من');
await fsp.writeFile(path.join(installRoot, 'homelab-panel', 'server', 'data', 'Projects', 'shop', 'app.js'), 'پروژهٔ من');
await fsp.writeFile(path.join(installRoot, 'README.md'), '# قدیمی\n');

process.env.HLP_INSTALL_ROOT = installRoot;
process.env.HLP_DATA_DIR = dataDir;

const { ensureControlSchema } = await import('../src/control/schema.js');
ensureControlSchema();
const updater = await import('../src/update/github.js');

try {
  console.log('\n── بررسی ──');
  check('ریشهٔ نصب همان است که خواستیم', updater.INSTALL_ROOT === installRoot, updater.INSTALL_ROOT);

  const info = await updater.checkForUpdate({ force: true });
  if (info.error) {
    console.log(`\n⏭️  از GitHub خبری نشد (${info.error}) — این آزمون به اینترنت نیاز دارد.`);
    await fsp.rm(tmp, { recursive: true, force: true });
    process.exit(0);
  }
  check('نسخه‌ای از GitHub خوانده شد', Boolean(info.latest), JSON.stringify(info).slice(0, 200));
  check('آدرسِ دانلود پیدا شد', Boolean(info.downloadUrl), info.downloadUrl || '');

  console.log('\n── دانلود ──');
  const downloaded = await updater.downloadUpdate(info);
  check('بسته دانلود شد', downloaded.size > 10000, String(downloaded.size));
  check('بسته یک آرشیوِ سالم است', downloaded.entries > 10, String(downloaded.entries));
  check('جمعِ کنترلی حساب شد', /^[0-9a-f]{64}$/.test(downloaded.checksum), downloaded.checksum);

  console.log('\n── نصب ──');
  const result = await updater.applyUpdate(info, downloaded, { actor: 'test', restart: false });
  const steps = Object.fromEntries(result.steps.map((s) => [s.name, s.status]));
  check('باز کردنِ بسته', steps.extract === 'ok', JSON.stringify(steps));
  check('اعتبارسنجیِ بسته', steps.validate === 'ok', JSON.stringify(steps));
  check('بکاپِ نصبِ قبلی', steps.backup === 'ok', JSON.stringify(steps));
  check('جایگزینیِ فایل‌ها', steps.install === 'ok', JSON.stringify(steps));
  check('فایلِ بکاپ روی دیسک هست', fs.existsSync(result.backup.path));

  console.log('\n── چیزهایی که نباید دست بخورند ──');
  const env = await fsp.readFile(path.join(installRoot, 'homelab-panel', 'server', '.env'), 'utf8');
  check('فایل .env دست‌نخورده ماند', env.includes('دست-نخورد'), env);
  check('دیتابیسِ پنل دست‌نخورده ماند', (await fsp.readFile(path.join(installRoot, 'homelab-panel', 'server', 'data', 'panel.db'), 'utf8')) === 'دادهٔ من');
  check(
    'پوشهٔ پروژه‌ها دست‌نخورده ماند',
    (await fsp.readFile(path.join(installRoot, 'homelab-panel', 'server', 'data', 'Projects', 'shop', 'app.js'), 'utf8')) === 'پروژهٔ من'
  );

  console.log('\n── چیزهایی که باید عوض شوند ──');
  const newIndex = await fsp.readFile(path.join(installRoot, 'homelab-panel', 'server', 'src', 'index.js'), 'utf8');
  check('کدِ سرور جایگزین شد', newIndex.length > 200 && !newIndex.includes('نسخهٔ قدیمی'), newIndex.slice(0, 80));
  check('پوشهٔ رابط کاربریِ ساخته‌شده آمد', fs.existsSync(path.join(installRoot, 'homelab-panel', 'server', 'public', 'index.html')));
  check('پوشهٔ دستیار آمد', fs.existsSync(path.join(installRoot, 'ai-support', 'package.json')));
  const pkg = JSON.parse(await fsp.readFile(path.join(installRoot, 'homelab-panel', 'server', 'package.json'), 'utf8'));
  check('نسخهٔ package.json به‌روز شد', pkg.version !== '0.0.1', pkg.version);

  console.log('\n── برگشت ──');
  const back = await updater.rollback({ actor: 'test' });
  check('برگشت انجام شد', back.ok === true && back.copied > 0, JSON.stringify(back).slice(0, 200));
  const restored = await fsp.readFile(path.join(installRoot, 'homelab-panel', 'server', 'src', 'index.js'), 'utf8');
  check('کدِ قبلی برگشت', restored.includes('نسخهٔ قدیمی'), restored.slice(0, 80));
  const envAfter = await fsp.readFile(path.join(installRoot, 'homelab-panel', 'server', '.env'), 'utf8');
  check('.env بعد از برگشت هم سالم است', envAfter.includes('دست-نخورد'));
} catch (e) {
  fail++;
  console.log(`\n❌ خطای غیرمنتظره: ${e.stack}`);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true });
}

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log('════════════════════════════════════\n');
process.exit(fail ? 1 : 0);
