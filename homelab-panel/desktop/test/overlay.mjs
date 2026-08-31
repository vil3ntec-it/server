// ---------------------------------------------------------------------------
//  آزمونِ به‌روزرسانیِ خودِ برنامه — بدونِ نصبِ دوبارهٔ ۸۵ مگابایتی
//      node test/overlay.mjs
//
//  ادعا این است: پوستهٔ برنامه و حتی مغزش (main-impl.js) می‌توانند از پوشهٔ
//  به‌روزرسانی بالا بیایند. اینجا واقعاً همان کار انجام می‌شود — یک نسخهٔ
//  تازه در آن پوشه گذاشته می‌شود و برنامه دوباره باز می‌شود.
//
//  و ادعای دوم که مهم‌تر است: یک به‌روزرسانیِ خراب نباید برنامه را از کار
//  بیندازد. آن هم واقعاً امتحان می‌شود.
// ---------------------------------------------------------------------------
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-overlay-'));
const USER = path.join(tmp, 'userdata');
const DATA = path.join(tmp, 'data');
const OVERLAY = path.join(USER, 'app-update');
fs.mkdirSync(USER, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

// پوشهٔ داده را از قبل انتخاب می‌کنیم تا صفحهٔ بارِ اول نیاید
fs.writeFileSync(path.join(USER, 'desktop.json'), JSON.stringify({ dataDir: DATA }), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 240)}`);
};

const launch = () => electron.launch({
  executablePath: './node_modules/electron/dist/electron',
  args: ['.', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${USER}`],
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  timeout: 60000,
});

/** همان کاری که به‌روزرسانی می‌کند: فایل‌های app/ را در پوشهٔ به‌روزرسانی می‌گذارد */
async function stageOverlay(mutate) {
  await fsp.rm(OVERLAY, { recursive: true, force: true });
  await fsp.cp(path.resolve('app'), OVERLAY, { recursive: true });
  await mutate(OVERLAY);
}

try {
  console.log('\n── نسخهٔ همراهِ نصب ──');
  {
    const app = await launch();
    const win = await app.firstWindow({ timeout: 30000 });
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#stage:not([hidden])', { timeout: 20000 });
    const brand = await win.textContent('.brand');
    check('برنامه با نسخهٔ نصب بالا آمد', brand.includes('مرکز فرمان'), brand.trim());
    await app.close().catch(() => {});
  }

  console.log('\n── به‌روزرسانیِ سالم ──');
  await stageOverlay(async (dir) => {
    // پوسته: نشانه‌ای که از بیرون دیده شود
    const html = path.join(dir, 'shell.html');
    let text = await fsp.readFile(html, 'utf8');
    text = text.replace('مرکز فرمان\n    </span>', 'مرکز فرمان نسخهٔ تازه\n    </span>');
    await fsp.writeFile(html, text, 'utf8');

    // مغز: یک سطرِ نشانه‌دار در ترمینال
    const impl = path.join(dir, 'main-impl.js');
    let code = await fsp.readFile(impl, 'utf8');
    code = code.replace('  await app.whenReady();', "  pushLog('نشانهٔ مغزِ به‌روزرسانی‌شده');\n  await app.whenReady();");
    await fsp.writeFile(impl, code, 'utf8');
  });

  {
    const app = await launch();
    const win = await app.firstWindow({ timeout: 30000 });
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#stage:not([hidden])', { timeout: 20000 });

    const brand = await win.textContent('.brand');
    check('پوستهٔ به‌روزرسانی‌شده بالا آمد', brand.includes('نسخهٔ تازه'), brand.trim());

    await win.waitForSelector('#dot.running', { timeout: 60000 });
    const lines = await win.$$eval('#termBody .line', (els) => els.map((e) => e.textContent));
    check('مغزِ به‌روزرسانی‌شده هم اجرا شد',
          lines.some((l) => l.includes('نشانهٔ مغزِ به‌روزرسانی‌شده')),
          lines.slice(0, 3).join(' | '));
    check('سرور با نسخهٔ به‌روزرسانی‌شده هم بالا آمد', true);
    check('نشانهٔ «در حالِ بالا آمدن» پاک شد — یعنی سالم بوده',
          !fs.existsSync(path.join(OVERLAY, '.booting')));
    await app.close().catch(() => {});
  }

  console.log('\n── به‌روزرسانیِ خراب ──');
  await stageOverlay(async (dir) => {
    await fsp.writeFile(path.join(dir, 'main-impl.js'), 'throw new Error("این نسخه خراب است");\n', 'utf8');
  });

  {
    const app = await launch();
    const win = await app.firstWindow({ timeout: 30000 });
    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('#stage:not([hidden])', { timeout: 20000 });
    const brand = await win.textContent('.brand');
    check('برنامه با وجودِ به‌روزرسانیِ خراب بالا آمد', brand.includes('مرکز فرمان'), brand.trim());
    check('برنامه به نسخهٔ همراهِ نصب برگشت', !brand.includes('نسخهٔ تازه'), brand.trim());

    const broken = fs.readdirSync(USER).filter((n) => n.startsWith('app-update-broken-'));
    check('نسخهٔ خراب کنار گذاشته شد', broken.length > 0, fs.readdirSync(USER).join(', '));
    check('پوشهٔ به‌روزرسانی دیگر استفاده نمی‌شود', !fs.existsSync(path.join(OVERLAY, 'main-impl.js')));

    await win.waitForSelector('#dot.running', { timeout: 60000 });
    check('سرور بعد از برگشت هم بالا آمد', true);
    await app.close().catch(() => {});
  }
} catch (e) {
  fail++;
  console.log(`\n❌ ${e.message}`);
} finally {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log('\n════════════════════════════════════');
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log('════════════════════════════════════');
process.exit(fail ? 1 : 0);
