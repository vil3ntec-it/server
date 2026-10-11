#!/usr/bin/env node
'use strict';
/*
  VILL3N — سایت دانلود برنامه‌ها + پنل مالک
  اجرا:            node server.js
  اجرا و باز کردن: node server.js --open
  فراموشی رمز:     node server.js reset-owner
  فقط Node لازم است (نسخهٔ ۱۸ به بالا)؛ هیچ بستهٔ دیگری نصب نمی‌شود.
*/
const fs = require('fs');
const path = require('path');

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`Node ${process.versions.node} خیلی قدیمی است. نسخهٔ ۱۸ یا بالاتر لازم است.`);
  process.exit(1);
}

const ROOT = __dirname;
const args = process.argv.slice(2);

/* ───── نگهبان: سرور در پروسهٔ فرزند اجرا می‌شود تا بعد از به‌روزرسانی خودش دوباره بالا بیاید ───── */
if (typeof PhusionPassenger === 'undefined' && !process.env.VILL3N_CHILD && !['reset-owner', 'update'].includes(args[0]) && process.env.VILL3N_SUPERVISOR !== '0') {
  require('./src/supervisor').run(__filename, args);
  return;
}
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : undefined; };

let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') { console.error('config.json خوانده نشد:', e.message); process.exit(1); } }

const passenger = typeof PhusionPassenger !== 'undefined';
const config = {
  port: passenger ? 'passenger' : (flag('port') || process.env.PORT || fileConfig.port || 4780),
  host: flag('host') || process.env.HOST || fileConfig.host || '127.0.0.1',
  dataDir: path.resolve(ROOT, String(flag('data') || process.env.DATA_DIR || fileConfig.dataDir || 'data')),
  trustProxy: !!fileConfig.trustProxy,
  proxy: fileConfig.proxy || '',
  seed: fileConfig.seed,
};

/* ───── قفل: دو نسخه از سرور نباید هم‌زمان روی یک پوشهٔ داده کار کنند ───── */
fs.mkdirSync(config.dataDir, { recursive: true });
const LOCK = path.join(config.dataDir, '.lock');
// پنلِ کنترول سنتر SITE_SLUG را می‌گذارد؛ نسخه‌ای که پنل اجرا کرده «مدیریت‌شده» است
const MANAGED = !!process.env.SITE_SLUG;
function readLock() {
  try {
    const raw = fs.readFileSync(LOCK, 'utf8').trim();
    if (/^\d+$/.test(raw)) return { pid: Number(raw) };
    const j = JSON.parse(raw);
    return j && Number(j.pid) ? j : null;
  } catch (_) { return null; }
}
function isAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function takeLock() {
  try {
    const st = fs.statSync(LOCK);
    const other = readLock();
    if (other && isAlive(other.pid) && Date.now() - st.mtimeMs < 15000) {
      /*
        ⚠️ نسخهٔ قبلی که پنل اجرا کرده بود و پنل دیگر آن را نمی‌شناسد (پنل بسته یا به‌روز شد،
        یا فقط پوستهٔ cmd بسته شد) زنده می‌ماند و قفل را تا ابد نگه می‌داشت؛ هر «اجرا»ی بعدی
        بسته می‌شد و سایت دیگر آنلاین نمی‌شد. اگر هر دو نسخه کارِ پنل‌اند، نسخهٔ قدیمی بسته می‌شود.
        نسخه‌ای که خودتان با START.bat یا سرویس اجرا کرده‌اید هرگز بسته نمی‌شود.
      */
      if (!(MANAGED && other.managed)) return other;
      try { process.kill(other.pid); } catch (_) { /* شاید همین حالا بسته شد */ }
      const until = Date.now() + 5000;
      while (isAlive(other.pid) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      if (isAlive(other.pid)) return other;
      console.log(`نسخهٔ جامانده (PID ${other.pid}) بسته شد و این نسخه جایش را گرفت.`);
    }
  } catch (_) { /* قفلی نیست */ }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, port: config.port, managed: MANAGED }));
  const t = setInterval(() => { try { const now = new Date(); fs.utimesSync(LOCK, now, now); } catch (_) { /* نادیده */ } }, 5000);
  t.unref();
  return true;
}
function dropLock() { try { if (readLock()?.pid === process.pid) fs.unlinkSync(LOCK); } catch (_) { /* نبود */ } }

/* ───── به‌روزرسانیِ دستی: node server.js update ───── */
if (args[0] === 'update') {
  require('./src/core/updater').checkAndApply({ root: ROOT, dataDir: config.dataDir, baseUrl: fileConfig.updateUrl, log: console.log })
    .then((r) => { console.log(r.status === 'updated' ? `\nنسخهٔ ${r.version} نصب شد (${r.changed} فایل). سایت را دوباره اجرا کنید.\n` : `\nهمین نسخه (${r.version}) تازه‌ترین است.\n`); process.exit(0); })
    .catch((e) => { console.error(`\nبه‌روزرسانی نشد: ${e.message}\n`); process.exit(1); });
  return;
}

if (args[0] === 'reset-owner') {
  if (takeLock() !== true) { console.error('سرور در حال اجراست. اول آن را ببندید، بعد دوباره این دستور را بزنید.'); process.exit(1); }
  const { DB } = require('./src/core/db');
  const { Auth } = require('./src/core/auth');
  const db = new DB(config.dataDir);
  db.data.owner = null; db.data.sessions = [];
  db.audit('reset-owner', 'رمز مالک از روی خودِ سرور پاک شد', 'محلی');
  db.saveNow();
  const code = new Auth(db, { dataDir: config.dataDir }).ensureSetupCode();
  dropLock();
  console.log(`\nرمز مالک پاک شد. سرور را اجرا کنید و در /admin رمز تازه بسازید.\nکد راه‌اندازی: ${code}\n`);
  process.exit(0);
}

const held = takeLock();
if (held !== true) {
  console.error(`\nیک نسخهٔ دیگر از همین سرور روی همین پوشهٔ داده در حال اجراست (PID ${held.pid}${held.port ? `، پورت ${held.port}` : ''}).\nبرای جلوگیری از خراب‌شدن داده، این نسخه اجرا نشد.\nآن نسخه را ببندید (Task Manager ← Details ← همین PID ← End task)، یا اگر سرویسِ ویندوز نصب کرده‌اید UNINSTALL-SERVICE.bat را بزنید.\n`);
  process.exit(1);
}

const { createSite, listen, VERSION } = require('./src/app');
const site = createSite({ dataDir: config.dataDir, publicDir: path.join(ROOT, 'public'), config });

/* ───── به‌روزرسانیِ خودکار از GitHub ─────
   دو دقیقه بعد از روشن شدن و بعد هر ۶ ساعت. با "autoUpdate": false در config.json خاموش می‌شود. */
function scheduleUpdates() {
  if (passenger || fileConfig.autoUpdate === false) return;
  const { checkAndApply } = require('./src/core/updater');
  let busy = false;
  const tick = async () => {
    if (busy || closing) return;
    busy = true;
    try {
      const r = await checkAndApply({ root: ROOT, dataDir: config.dataDir, baseUrl: fileConfig.updateUrl, log: console.log });
      if (r.status === 'updated') {
        if (process.env.VILL3N_CHILD) shutdown(require('./src/supervisor').RESTART_CODE);
        else console.log(`نسخهٔ ${r.version} نصب شد؛ با اجرای دوبارهٔ سایت فعال می‌شود.`);
      }
    } catch (e) { console.error(`[به‌روزرسانی] ${e.message}`); } finally { busy = false; }
  };
  setTimeout(tick, Number(process.env.VILL3N_UPDATE_DELAY_MS) || 2 * 60 * 1000).unref();
  setInterval(tick, 6 * 3600 * 1000).unref();
}

function openBrowser(url) {
  const { spawn } = require('child_process');
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsVerbatimArguments: false }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch (_) { /* مرورگر باز نشد؛ نشانی در ترمینال هست */ }
}

let server;
let closing = false;
function shutdown(code) {
  if (closing) return; closing = true;
  try { site.stop(); } catch (e) { console.error(e); }
  dropLock();
  if (server) { server.close(() => process.exit(code)); setTimeout(() => process.exit(code), 3000).unref(); } else process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));
process.on('uncaughtException', (e) => { console.error('[خطای پیش‌بینی‌نشده]', e); shutdown(1); });
process.on('unhandledRejection', (e) => { console.error('[خطای پیش‌بینی‌نشده]', e); });
// نگهبان رفت (کشته شد یا بسته شد) ⇒ این پروسه هم می‌رود؛ نسخهٔ جامانده‌ای نمی‌ماند
if (process.env.VILL3N_CHILD && process.send) process.on('disconnect', () => shutdown(0));
process.on('exit', () => { try { site.db.flush(); } catch (_) { /* نادیده */ } dropLock(); });

listen(site, config).then((srv) => {
  server = srv;
  site.start();
  const local = passenger ? '(Passenger)' : `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
  const code = site.auth.ensureSetupCode();
  console.log([
    '',
    `  VILL3N ${VERSION}  روشن است`,
    `  سایت:        ${local}/`,
    `  پنل مالک:    ${local}/admin`,
    `  پوشهٔ داده:  ${config.dataDir}`,
    code ? `  کد راه‌اندازی (فقط بار اول): ${code}` : '',
    '',
  ].filter((l) => l !== '').join('\n') + '\n');
  scheduleUpdates();
  if (flag('open') && !passenger) openBrowser(`${local}/admin${code ? `#setup=${code}` : ''}`);
}).catch((e) => {
  if (e.code === 'EADDRINUSE') console.error(`\nپورت ${config.port} را برنامهٔ دیگری گرفته است.\nدر config.json پورت دیگری بگذارید (مثلاً 4781) و دوباره اجرا کنید.\n`);
  else if (e.code === 'EACCES') console.error(`\nاجازهٔ استفاده از پورت ${config.port} نیست. پورت بالای ۱۰۲۴ انتخاب کنید.\n`);
  else console.error(e);
  dropLock();
  process.exit(1);
});
