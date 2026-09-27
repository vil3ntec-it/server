// ---------------------------------------------------------------------------
//  آزمونِ کارِ بی‌حضور — «در نبودِ من هم همه‌کار را خودش بکند»
//      xvfb-run -a node test/unattended.mjs
//
//  خواستهٔ صاحب سامانه (۱۴۰۵/۰۷/۱۵): به‌روزرسانی که آمد خودش دانلود و نصب کند
//  و برنامه را **خودش** دوباره باز کند؛ با روشن شدنِ کامپیوتر خودش باز شود؛ و
//  کسی لازم نباشد دکمهٔ «باز کردنِ دوباره» را بزند.
//
//  چیزی شبیه‌سازی نمی‌شود: برنامهٔ واقعی با سرورِ واقعی بالا می‌آید، پروسهٔ
//  سرور واقعاً کشته می‌شود، و نشانهٔ «به‌روزرسانی نشست» همان فایلی است که
//  `applyUpdate`ِ سرور می‌نویسد — و برنامه باید واقعاً بسته و دوباره باز شود.
// ---------------------------------------------------------------------------
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loginItemPlan, restartDelay, shouldRelaunch, AUTOSTART_ARG, RESTART_MAX_MS,
} from '../app/autostart.js';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 240)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30000, step = 250) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch { /* هنوز نه */ }
    await sleep(step);
  }
  return null;
}

/* ─────────────────────────── ۱) قاعده‌های خالص ─────────────────────────── */
console.log('\n── روشن شدن با ویندوز (loginItemPlan) ──');
{
  const win = loginItemPlan({ platform: 'win32', isPackaged: true, settings: {}, execPath: 'C:\\P\\Control Center.exe' });
  check('پیش‌فرض روشن است', win?.openAtLogin === true, JSON.stringify(win));
  check('با پرچمِ --autostart ثبت می‌شود', win?.args?.[0] === AUTOSTART_ARG);
  check('مسیرِ خودِ برنامهٔ نصب‌شده', win?.path === 'C:\\P\\Control Center.exe');
  const off = loginItemPlan({ platform: 'win32', isPackaged: true, settings: { autoStart: false }, execPath: 'x.exe' });
  check('خاموش شدنِ صریح، واقعاً از ورودِ ویندوز برمی‌دارد (openAtLogin: false)', off?.openAtLogin === false);
  const portable = loginItemPlan({ platform: 'win32', isPackaged: true, execPath: 'C:\\Temp\\x\\cc.exe', portableFile: 'D:\\ControlCenter\\ControlCenter.exe' });
  check('نسخهٔ قابل‌حمل: خودِ فایلِ ‎.exe‎، نه پوشهٔ موقت', portable?.path === 'D:\\ControlCenter\\ControlCenter.exe', portable?.path);
  check('لینوکس: هیچ (کارِ systemd است)', loginItemPlan({ platform: 'linux', isPackaged: true, execPath: '/x' }) === null);
  check('اجرای توسعه خودش را در ورودِ ویندوز نمی‌نویسد', loginItemPlan({ platform: 'win32', isPackaged: false, execPath: 'x' }) === null);
}

console.log('\n── سرورِ افتاده (restartDelay) ──');
{
  const seq = [1, 2, 3, 4, 5, 6, 7, 50].map(restartDelay);
  check('۲ ⇒ ۴ ⇒ ۸ ⇒ ۱۶ ⇒ ۳۲ ثانیه', seq.slice(0, 5).join() === '2000,4000,8000,16000,32000', seq.join());
  check('سقفِ یک دقیقه — و هرگز «دست کشیدن» نیست', seq.slice(5).every((d) => d === RESTART_MAX_MS), seq.join());
  check('ورودیِ خراب ⇒ همان دو ثانیه', restartDelay(undefined) === 2000 && restartDelay(-3) === 2000);
}

console.log('\n── دوباره باز شدن پس از به‌روزرسانی (shouldRelaunch) ──');
{
  check('نشانهٔ تازه ⇒ باز شو', shouldRelaunch({ at: 200 }, 100) === true);
  check('نشانهٔ کهنه ⇒ نه (وگرنه حلقهٔ بی‌پایانِ بسته/باز)', shouldRelaunch({ at: 100 }, 100) === false);
  check('بی نشانه ⇒ نه', shouldRelaunch(null, 0) === false);
  check('autoRelaunch: false ⇒ نه (فقط نوار)', shouldRelaunch({ at: 200 }, 0, { autoRelaunch: false }) === false);
}

/* ───────────────────────── ۲) برنامهٔ واقعی ───────────────────────────── */
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cc-unattended-'));
const USER = path.join(tmp, 'userdata');
const DATA = path.join(tmp, 'data');
const PORT = 4760 + Math.floor(Math.random() * 30);
fs.mkdirSync(USER, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
const writeSettings = (extra = {}) => fs.writeFileSync(
  path.join(USER, 'desktop.json'),
  JSON.stringify({ dataDir: DATA, port: PORT, lanAccess: false, ...extra }),
  'utf8',
);

const launch = (extraArgs = []) => electron.launch({
  executablePath: './node_modules/electron/dist/electron',
  args: ['.', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${USER}`, ...extraArgs],
  cwd: process.cwd(),
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', HLP_ACCOUNT_AUTOSTART: '0', HLP_AUTOMATION: '0' },
  timeout: 60000,
});

const health = async () => {
  try { return (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { return false; }
};

/** هر پروسه‌ای که مالِ همین آزمون است — برنامه (با USER در خطِ فرمان) و سرورش (با DATA در محیط) */
function ourPids() {
  const out = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8');
      const env = fs.readFileSync(`/proc/${d}/environ`, 'utf8');
      if (cmd.includes(USER) || env.includes(`HLP_DATA_DIR=${DATA}`)) out.push(Number(d));
    } catch { /* پروسهٔ دیگران یا رفته */ }
  }
  return out;
}
function killAll() {
  for (const p of ourPids()) { try { process.kill(p, 'SIGKILL'); } catch { /* رفته */ } }
}

async function stateOf(win) {
  return win.evaluate(() => window.cc.getState());
}

let app;
try {
  console.log('\n── سرورِ افتاده خودش برمی‌گردد ──');
  writeSettings();
  app = await launch();
  let win = await app.firstWindow({ timeout: 30000 });
  await win.waitForLoadState('domcontentloaded');
  const first = await until(async () => { const s = await stateOf(win); return s.status === 'running' && s.pid ? s : null; }, 60000);
  check('برنامه بالا آمد و سرور روشن است', Boolean(first), JSON.stringify(first));

  process.kill(first.pid, 'SIGKILL');
  const saw = await until(async () => { const s = await stateOf(win); return s.status === 'error' && /خودش دوباره بالا می‌آید/.test(s.error || '') ? s : null; }, 10000, 100);
  check('کشته شدنِ سرور گفته می‌شود — «خودش دوباره بالا می‌آید»، نه بن‌بست', Boolean(saw), JSON.stringify(saw));
  const back = await until(async () => { const s = await stateOf(win); return s.status === 'running' && s.pid && s.pid !== first.pid ? s : null; }, 30000);
  check('بی هیچ کلیکی، سرورِ تازه بالا آمد', Boolean(back), JSON.stringify(back));
  check('و واقعاً جواب می‌دهد', await health());
  check('شمارندهٔ افتادن: ۱', back?.crashes === 1, back?.crashes);

  process.kill(back.pid, 'SIGKILL');
  const back2 = await until(async () => { const s = await stateOf(win); return s.status === 'running' && s.pid && s.pid !== back.pid ? s : null; }, 30000);
  check('افتادنِ دوم هم برمی‌گردد (با فاصلهٔ بیشتر)', back2?.crashes === 2, JSON.stringify(back2));
  const logs = await win.evaluate(() => window.cc.getLogs());
  check('ترمینال فاصله را می‌گوید (۲ و ۴ ثانیه)', logs.some((l) => /۲ ثانیهٔ دیگر|2 ثانیهٔ دیگر/.test(l.text)) && logs.some((l) => /4 ثانیهٔ دیگر|۴ ثانیهٔ دیگر/.test(l.text)));

  console.log('\n── دکمهٔ «راه‌اندازی دوباره» شمارنده را صفر می‌کند ──');
  await win.evaluate(() => window.cc.restart());
  const manual = await until(async () => { const s = await stateOf(win); return s.status === 'running' && s.pid !== back2.pid ? s : null; }, 30000);
  check('راه‌اندازیِ دستی ⇒ crashes = 0', manual?.crashes === 0, JSON.stringify(manual));

  console.log('\n── روشن شدن با ویندوز: دکمه روی لینوکس پنهان است ──');
  check('روی لینوکس دکمهٔ «روشن با ویندوز» نیست (پشتیبانی نمی‌شود)', await win.locator('#btnAutostart').isHidden());
  check('state.autoStart پیش‌فرض روشن', manual?.autoStart === true);

  console.log('\n── به‌روزرسانی نشست ⇒ برنامه خودش بسته و دوباره باز می‌شود ──');
  const oldServerPid = manual.pid;
  const before = new Set(ourPids());
  const closed = new Promise((r) => app.once('close', () => r(true)));
  fs.mkdirSync(path.join(DATA, 'updates'), { recursive: true });
  //  همان فایل و همان شکلی که applyUpdate می‌نویسد
  fs.writeFileSync(path.join(DATA, 'updates', 'applied.json'),
    JSON.stringify({ version: '9.9.9', commit: null, at: Date.now(), layout: 'packaged' }), 'utf8');
  const banner = await until(async () => {
    const t = await win.textContent('#updatedText');
    return (await win.locator('#updated').isVisible()) && t;
  }, 8000, 100).catch(() => null);
  check('نوار می‌گوید «خودش دوباره باز می‌شود»، نه «دکمه را بزنید»', /خودش دوباره باز می‌شود/.test(banner || ''), banner);
  const didClose = await Promise.race([closed, sleep(20000).then(() => false)]);
  check('برنامهٔ قبلی خودش بسته شد — بی کلیک', didClose === true);
  app = null;
  const oldGone = await until(async () => { try { process.kill(oldServerPid, 0); return false; } catch { return true; } }, 15000);
  check('سرورِ قبلی هم رفت (پروسهٔ یتیم نماند)', Boolean(oldGone));
  const relaunched = await until(async () => (await health()) && ourPids().some((p) => !before.has(p)), 60000, 400);
  check('نمونهٔ تازهٔ برنامه خودش باز شد و سرورش دوباره جواب می‌دهد', Boolean(relaunched), ourPids().join(','));
  //  ⛔ نشانهٔ کهنه نباید نمونهٔ تازه را دوباره ببندد (حلقهٔ بی‌پایان)
  await sleep(6000);
  check('نمونهٔ تازه با همان نشانه دوباره بسته نشد (حلقه نیست)', await health());
  killAll();
  await until(async () => !(await health()) && ourPids().length === 0, 15000);

  console.log('\n── autoRelaunch: false ⇒ فقط نوار، همان رفتارِ قدیم ──');
  writeSettings({ autoRelaunch: false });
  app = await launch([AUTOSTART_ARG]);
  win = await app.firstWindow({ timeout: 30000 });
  await win.waitForLoadState('domcontentloaded');
  const s3 = await until(async () => { const s = await stateOf(win); return s.status === 'running' ? s : null; }, 60000);
  check('با پرچمِ --autostart باز شد و خودش سرور را بالا آورد', Boolean(s3) && s3.autostarted === true, JSON.stringify(s3));
  const l3 = await win.evaluate(() => window.cc.getLogs());
  check('ترمینال می‌گوید «با روشن شدنِ ویندوز خودش باز شد»', l3.some((l) => /با روشن شدنِ ویندوز خودش باز شد/.test(l.text)));
  let closed2 = false;
  app.once('close', () => { closed2 = true; });
  fs.writeFileSync(path.join(DATA, 'updates', 'applied.json'),
    JSON.stringify({ version: '9.9.10', commit: null, at: Date.now(), layout: 'packaged' }), 'utf8');
  const banner2 = await until(async () => (await win.locator('#updated').isVisible()) && win.textContent('#updatedText'), 8000, 100);
  check('نوارِ «باید دوباره باز شود» آمد', /باید دوباره باز شود/.test(banner2 || ''), banner2);
  await sleep(5000);
  check('و برنامه خودسرانه بسته نشد', closed2 === false && (await health()));
} catch (e) {
  check(`خطای پیش‌بینی‌نشده: ${e.message}`, false);
} finally {
  await app?.close().catch(() => {});
  killAll();
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n════════════════════════════════════\n  موفق: ${pass}    ناموفق: ${fail}\n════════════════════════════════════`);
process.exit(fail ? 1 : 0);
