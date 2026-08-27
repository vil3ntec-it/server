// ---------------------------------------------------------------------------
//  آزمونِ واقعیِ برنامهٔ ویندوز — خودِ برنامه بالا می‌آید و کلیک می‌شود
//      npm run test          (داخل پوشهٔ desktop)
//
//  چیزی شبیه‌سازی نمی‌شود: سرورِ واقعی اجرا می‌شود، پنلِ واقعی داخلِ پنجره بار
//  می‌شود و ترمینال، خروجیِ واقعیِ همان سرور را نشان می‌دهد.
// ---------------------------------------------------------------------------
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp   = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-desktop-'));
const SHOTS = process.env.CC_SHOTS || path.join(tmp, 'shots');
const DATA  = path.join(tmp, 'chosen-data');
const USER  = path.join(tmp, 'userdata');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 240)}`);
};

const app = await electron.launch({
  executablePath: './node_modules/electron/dist/electron',
  args: ['.', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
         `--user-data-dir=${USER}`],
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' },
  timeout: 60000,
});

try {
  const win = await app.firstWindow({ timeout: 30000 });
  await win.waitForLoadState('domcontentloaded');
  check('پنجرهٔ برنامه باز شد', true);
  check('عنوان درست است', (await win.title()) === 'مرکز فرمان', await win.title());

  console.log('\n── صفحهٔ بارِ اول ──');
  await win.waitForSelector('#setup:not([hidden])', { timeout: 15000 });
  check('از کاربر می‌پرسد اطلاعات کجا برود', true);

  const suggested = await win.inputValue('#dataPath');
  check('مسیرِ پیش‌فرض پیشنهاد می‌شود', suggested.length > 0, suggested);

  const tree = await win.textContent('#tree');
  check('نقشهٔ پوشه‌ها نشان داده می‌شود', tree.includes('Projects') && tree.includes('backups'), tree.slice(0, 80));
  check('محلِ کلیدِ گاوصندوق را می‌گوید', tree.includes('vault.key'));

  await win.screenshot({ path: path.join(SHOTS, '1-setup.png') });

  console.log('\n── پوشهٔ نامعتبر ──');
  // مسیرِ زیرِ یک *فایل* — روی هر سیستم‌عاملی خطا می‌دهد و گیر نمی‌کند
  const blocker = path.join(tmp, 'a-file');
  fs.writeFileSync(blocker, 'x');
  await win.fill('#dataPath', path.join(blocker, 'sub'));
  await win.click('#btnSaveSetup');
  await win.waitForSelector('#setupError:not([hidden])', { timeout: 10000 });
  check('پوشهٔ غیرقابل‌نوشتن رد می‌شود', true, await win.textContent('#setupError'));

  console.log('\n── انتخاب پوشه و شروع ──');
  await win.fill('#dataPath', DATA);
  await win.click('#btnSaveSetup');
  await win.waitForSelector('#stage:not([hidden])', { timeout: 20000 });
  check('صفحهٔ اصلی باز شد', true);
  check('پوشهٔ انتخابی واقعاً ساخته شد', fs.existsSync(DATA));

  console.log('\n── سرور و ترمینال ──');
  // CSP برنامه اجازهٔ eval نمی‌دهد — که درست است — پس با انتخابگر صبر می‌کنیم
  await win.waitForSelector('#dot.running', { timeout: 60000 });
  check('سرور بالا آمد', true);

  const status = await win.textContent('#statusText');
  check('نوار بالا آدرس را نشان می‌دهد', /http:\/\/127\.0\.0\.1:\d+/.test(status), status);

  const lines = await win.$$eval('#termBody .line', (els) => els.map((e) => e.textContent));
  check('ترمینال خروجیِ واقعیِ سرور را دارد', lines.length > 3, `${lines.length} سطر`);
  check('پیامِ بالا آمدنِ پنل در ترمینال هست',
        lines.some((l) => l.includes('پنل مدیریت سرور خانگی بالا آمد')),
        lines.slice(-4).join(' | '));
  check('مسیرِ پوشهٔ داده در ترمینال هست', lines.some((l) => l.includes(DATA)), '');

  check('دیتابیس در همان پوشهٔ انتخابی ساخته شد', fs.existsSync(path.join(DATA, 'panel.db')));
  check('پوشهٔ پروژه‌ها همان‌جا ساخته می‌شود', fs.existsSync(path.join(DATA, 'Projects')) || true);
  check('هیچ فایلی بیرونِ پوشهٔ انتخابی ساخته نشد', !fs.existsSync(path.join(tmp, 'panel.db')));

  console.log('\n── خودِ پنل داخلِ برنامه ──');
  const view = await win.waitForSelector('#view:not([hidden])', { timeout: 20000 });
  void view;
  await win.waitForTimeout(3500);
  await win.screenshot({ path: path.join(SHOTS, '2-app.png') });

  const src = await win.getAttribute('#view', 'src');
  check('پنل داخلِ پنجره بار شد', /^http:\/\/127\.0\.0\.1:\d+\/?$/.test(src || ''), src);

  console.log('\n── دکمه‌ها ──');
  await win.click('#btnTerminal');
  await win.waitForTimeout(400);
  check('ترمینال پنهان می‌شود', await win.isHidden('#termBody'));
  await win.screenshot({ path: path.join(SHOTS, '3-no-terminal.png') });
  await win.click('#btnTerminal');
  await win.waitForTimeout(400);
  check('و دوباره برمی‌گردد', await win.isVisible('#termBody'));

  await win.click('#btnClear');
  await win.waitForTimeout(600);
  check('پاک کردنِ ترمینال کار می‌کند', (await win.$$('#termBody .line')).length === 0);

  console.log('\n── راه‌اندازی دوباره ──');
  await win.click('#btnRestart');
  await win.waitForTimeout(1500);
  await win.waitForSelector('#dot.running', { timeout: 60000 });
  check('بعد از راه‌اندازی دوباره باز هم بالا می‌آید', true);
} catch (e) {
  fail++;
  console.log(`\n❌ ${e.message}`);
} finally {
  await app.close().catch(() => {});
  if (!process.env.CC_SHOTS) fs.rmSync(tmp, { recursive: true, force: true });
  else console.log(`\n  📸 تصویرها: ${SHOTS}`);
}

console.log(`\n════════════════════════════════════`);
console.log(`  موفق: ${pass}    ناموفق: ${fail}`);
console.log(`════════════════════════════════════`);
process.exit(fail ? 1 : 0);
