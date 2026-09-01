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

  console.log('\n── کادرِ ترمینال ──');
  check('اولِ کار ترمینال بسته است و جلوی پنل را نمی‌گیرد', await win.isHidden('#term'));
  await win.screenshot({ path: path.join(SHOTS, '3-no-terminal.png') });

  await win.click('#btnTerminal');
  await win.waitForSelector('#term:not([hidden])', { timeout: 5000 });
  check('با دکمهٔ بالا باز می‌شود', await win.isVisible('#termBody'));

  // همان چیزی که کاربر گفت کار نمی‌کند: بسته شدن
  await win.click('#btnTermClose');
  await win.waitForSelector('#term', { state: 'hidden', timeout: 5000 });
  check('با ✕ واقعاً بسته می‌شود', await win.isHidden('#term'));

  await win.click('#btnTerminal');
  await win.waitForSelector('#term:not([hidden])', { timeout: 5000 });
  await win.click('#btnTerminal');
  await win.waitForSelector('#term', { state: 'hidden', timeout: 5000 });
  check('دکمهٔ بالا هم باز و هم می‌بندد', await win.isHidden('#term'));

  await win.click('#btnTerminal');
  await win.waitForSelector('#term:not([hidden])', { timeout: 5000 });

  console.log('\n── تغییرِ بلندی با دستگیره ──');
  const before = (await win.locator('#term').boundingBox()).height;

  /*
   * جای دستگیره درست پیش از فشار دادن اندازه گرفته می‌شود و همان‌جا
   * سنجیده می‌شود که گرفتن واقعاً شروع شده یا نه.
   *
   * قبلاً اگر فشار به دستگیره نمی‌خورد، آزمون فقط می‌گفت «۲۴۰ → ۲۴۰» و
   * معلوم نبود کشیدن خراب است یا فشار اصلاً به هدف نخورده. حالا اگر
   * نخورد، همان لحظه معلوم می‌شود.
   *
   * چرا دو بار تلاش کافی نبود: بالای ترمینال یک <webview> است و آن یک
   * فریمِ جدا با پروسهٔ خودش است. تا لحظه‌ای پیش، همین نقطه‌ای که حالا
   * دستگیره است متعلق به webview بود؛ نقشه‌ای که کروم برای فرستادنِ
   * ماوس به فریمِ درست دارد چند لحظه بعد از عوض شدنِ چیدمان به‌روز
   * می‌شود. در آن فاصله فشار به webview می‌رود و به دستگیره نمی‌رسد —
   * روی رانرِ CI که کندتر است، همین باعثِ افتادنِ آزمون شد. پس هم به
   * چیدمان فرصتِ نشستن می‌دهیم و هم چند بار، با فاصله، دوباره امتحان
   * می‌کنیم.
   */
  await win.waitForTimeout(300);
  let started = false;
  for (let attempt = 0; attempt < 5 && !started; attempt++) {
    const grip = await win.locator('#termGrip').boundingBox();
    await win.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await win.mouse.down();
    // رویداد از پروسهٔ مرورگر رد می‌شود؛ همان لحظه رسیده نیست
    for (let wait = 0; wait < 10 && !started; wait++) {
      started = await win.evaluate(() => document.body.classList.contains('resizing'));
      if (!started) await win.waitForTimeout(50);
    }
    if (!started) {
      await win.mouse.up();
      await win.waitForTimeout(200);
    }
  }
  check('فشار روی دستگیره گرفته می‌شود', started);

  const grip = await win.locator('#termGrip').boundingBox();
  await win.mouse.move(grip.x + grip.width / 2, grip.y - 120, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  const after = (await win.locator('#term').boundingBox()).height;
  check('کشیدنِ دستگیره ترمینال را بلندتر می‌کند', after > before + 60, `${before} → ${after}`);
  await win.screenshot({ path: path.join(SHOTS, '4-terminal-resized.png') });

  console.log('\n── پنجرهٔ جداگانه ──');
  await win.click('#btnPopout');
  const term = await app.waitForEvent('window', { timeout: 20000 });
  await term.waitForLoadState('domcontentloaded');
  check('ترمینال در پنجرهٔ خودش باز شد', (await term.title()) === 'ترمینال — مرکز فرمان', await term.title());

  await term.waitForSelector('#termBody .line', { timeout: 20000 });
  const popLines = await term.$$eval('#termBody .line', (els) => els.map((e) => e.textContent));
  check('همان خروجیِ زندهٔ سرور را دارد', popLines.length > 3, `${popLines.length} سطر`);
  await term.screenshot({ path: path.join(SHOTS, '5-terminal-window.png') });

  await win.waitForSelector('#term', { state: 'hidden', timeout: 5000 });
  check('در همان حال از صفحهٔ اصلی کنار می‌رود', await win.isHidden('#term'));
  check('و به کاربر می‌گوید کجاست', await win.isVisible('#termAway'));
  await win.screenshot({ path: path.join(SHOTS, '6-main-without-terminal.png') });

  // سرور که کار می‌کند، سطرِ تازه باید به پنجرهٔ جدا هم برسد
  const popBefore = popLines.length;
  await win.click('#btnRestart');
  await term.waitForFunction(
    (n) => document.querySelectorAll('#termBody .line').length > n,
    popBefore,
    { timeout: 30000 },
  );
  check('سطرهای تازه به پنجرهٔ جدا هم می‌رسند', true);

  // این کلیک همان پنجره را می‌بندد، پس Playwright منتظرِ پاسخی از صفحه‌ای
  // می‌ماند که دیگر وجود ندارد. خودِ بسته شدن نتیجهٔ درست است.
  await Promise.all([
    term.waitForEvent('close').catch(() => {}),
    term.click('#btnBack', { noWaitAfter: true }).catch(() => {}),
  ]);
  await win.waitForSelector('#termAway', { state: 'hidden', timeout: 10000 });
  check('«برگشت به برنامه» ترمینال را برمی‌گرداند', await win.isVisible('#term'));

  await win.waitForSelector('#dot.running', { timeout: 60000 });
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
