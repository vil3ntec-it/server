// ---------------------------------------------------------------------------
//  مرکز فرمان — برنامهٔ ویندوز
//
//  همان پنلِ داخلِ مخزن است، فقط داخلِ یک پنجرهٔ واقعیِ ویندوز:
//      • بالا: خودِ پنل
//      • پایین: ترمینال، با خروجیِ واقعیِ سرور
//
//  سرور با Node ای که خودِ Electron همراه دارد اجرا می‌شود، پس نصبِ جداگانهٔ
//  Node.js لازم نیست.
// ---------------------------------------------------------------------------
import { app, BrowserWindow, dialog, ipcMain, shell, Menu } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureFirewall } from './firewall.js';
import { loginItemPlan, restartDelay, shouldRelaunch, HEALTHY_RESET_MS, AUTOSTART_ARG } from './autostart.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * از راه‌اندازِ برنامه می‌آید: کدام نسخه اجرا می‌شود (نصب یا به‌روزرسانی)،
 * فایل‌های پوسته کجا هستند، و آیکن‌ها کجا.
 */
let ctx = {
  implDir: __dirname,
  packagedDir: __dirname,
  overlayDir: null,
  assetsDir: path.resolve(__dirname, '..', 'assets'),
  usingOverlay: false,
  markBooted() {},
};

const implFile = (name) => path.join(ctx.implDir, name);
const assetFile = (name) => path.join(ctx.assetsDir, name);

/* ------------------------------ جای فایل‌ها ------------------------------ */

/** پوشهٔ سرور — در نسخهٔ بسته‌بندی‌شده کنارِ منابع می‌نشیند */
function serverDir() {
  const packaged = path.join(process.resourcesPath || '', 'server');
  if (fs.existsSync(path.join(packaged, 'src', 'index.js'))) return packaged;
  // از محلِ نسخهٔ *همراهِ نصب* حساب می‌شود، نه از محلِ این فایل: وقتی برنامه
  // از پوشهٔ به‌روزرسانی بالا می‌آید، این فایل جای دیگری است ولی سرور نه.
  return path.resolve(ctx.packagedDir, '..', '..', 'server');
}

/** تنظیماتِ خودِ برنامه (نه تنظیماتِ پنل) */
const settingsFile = () => path.join(app.getPath('userData'), 'desktop.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** پیشنهادِ پیش‌فرض برای محلِ داده — جایی که کاربر پیدایش می‌کند */
function defaultDataDir() {
  const docs = app.getPath('documents') || os.homedir();
  return path.join(docs, 'ControlCenter');
}

/* ------------------- پوشهٔ داده‌ای که همه‌چیز با خودش می‌برد -------------- */
/*
 * خواستهٔ صاحب مخزن: «فولدرِ سرور جوری باشه که همه‌چی توش باشه و اگه از یک
 * کامپیوتر به کامپیوترِ دیگه بردم اطلاعات باشه، و برنامهٔ سرور هم توی همان
 * فولدر باشه که آیکونش رو بتونم توی کامپیوترِ جدید بذارم یا از خودِ فولدر باز
 * کنم.»
 *
 * پس:
 *   ۱) داخلِ پوشهٔ داده یک نشانه می‌نشیند (‎ControlCenter.home.json‎). هر
 *      پوشه‌ای که این نشانه را دارد «خانهٔ مرکز فرمان» است.
 *   ۲) نسخهٔ قابل‌حملِ برنامه (‎ControlCenter-Portable-*.exe‎، بی نصب) با یک
 *      دکمه داخلِ همان پوشه کپی می‌شود.
 *   ۳) هر بار که برنامه از داخلِ پوشه‌ای اجرا شود که نشانه دارد — یا از
 *      زیرپوشه‌اش — همان پوشه، پوشهٔ داده است؛ بی سوال، بی تنظیمِ قبلی.
 *      یعنی کلِ پوشه را روی فلش می‌برید، روی کامپیوترِ تازه دوبار کلیک
 *      می‌کنید و همه‌چیز سرِ جایش است.
 *
 * ⚠️ نشانه فقط یک فایلِ کوچکِ JSON است، نه چیزی که سرور بخواندش. اگر نبود،
 * رفتارِ قدیمی (پوشهٔ ذخیره‌شده یا پرسیدن) عیناً سرِ جایش است.
 */
const HOME_MARKER = 'ControlCenter.home.json';

/** نشانه را در پوشهٔ داده بنویس (یا تازه کن). هیچ‌وقت خطا بیرون نمی‌دهد. */
function writeHomeMarker(dir) {
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, HOME_MARKER),
      JSON.stringify({ app: 'control-center', version: app.getVersion(), at: Date.now() }, null, 2),
      'utf8'
    );
  } catch { /* پوشهٔ فقط‌خواندنی؛ نشانه اختیاری است */ }
}

/** آیا این پوشه نشانهٔ «خانه» دارد؟ */
function isHome(dir) {
  try {
    return !!dir && fs.existsSync(path.join(dir, HOME_MARKER));
  } catch {
    return false;
  }
}

/** فایلِ اجراییِ قابل‌حمل — فقط وقتی همین برنامه به شکلِ قابل‌حمل اجرا شده. */
function portableExe() {
  return process.env.PORTABLE_EXECUTABLE_FILE || null;
}

/**
 * «برنامه از داخلِ پوشهٔ داده اجرا شده؟» — پوشهٔ فایلِ اجرایی و تا دو پدرِ
 * بالاترش را نگاه می‌کند. خروجی همان پوشهٔ خانه است، یا ‎null‎.
 *
 * ⚠️ ‎process.execPath‎ی نسخهٔ نصبی داخلِ ‎Program Files‎ است و هیچ‌وقت نشانه
 * ندارد، پس نسخهٔ نصبی رفتارش عوض نمی‌شود.
 */
function homeNearExe() {
  const starts = [process.env.PORTABLE_EXECUTABLE_DIR, path.dirname(process.execPath)]
    .filter(Boolean)
    .map((d) => path.resolve(d));
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 3; i++) {
      if (isHome(dir)) return dir;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return null;
}

/* ------------------------------ پورتِ آزاد ------------------------------- */

function portFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/**
 * ══ پنل روی کدام کارت گوش بدهد (۱۴۰۵/۰۷/۱۳) ══════════════════════════════
 *
 * ⛔ **‎0.0.0.0‎، نه ‎127.0.0.1‎.** تا امروز این‌جا ‎127.0.0.1‎ بود و برنامهٔ پمپ
 * روی کامپیوترِ دیگر و گوشیِ کارمند روی وای‌فای هیچ‌وقت به سرورِ خانگی
 * نمی‌رسیدند: کشفِ خودکار نشانیِ شبکه را می‌گفت و همان نشانی «اتصال رد شد»
 * می‌گرفت. نگهبانِ ‎lan-guard.js‎ در خودِ پنل نمی‌گذارد این در به اینترنت باز
 * شود. ‎lanAccess: false‎ در تنظیماتِ برنامه همان رفتارِ قدیم را برمی‌گرداند.
 */
function listenHost() {
  return readSettings().lanAccess === false ? '127.0.0.1' : '0.0.0.0';
}

async function pickPort(preferred = 4700) {
  for (let port = preferred; port < preferred + 40; port++) {
    if (await portFree(port, listenHost())) return port;
  }
  return preferred;
}

/* ------------------------------ حالتِ برنامه ----------------------------- */

const state = {
  win: null,
  termWin: null, // پنجرهٔ جدا گانهٔ ترمینال — وقتی کاربر «پنجرهٔ جدا» را می‌زند
  child: null,
  port: 4700,
  url: null,
  status: 'stopped', // stopped | starting | running | error
  error: null,
  dataDir: null,
  runFromHome: false, // برنامه از داخلِ خودِ پوشهٔ داده باز شده
  logs: [],
  stopping: false,
  appliedWatcher: null,
  appliedSeen: 0,
  // کارِ بی‌حضور: سرورِ افتاده خودش برمی‌گردد و به‌روزرسانی خودش باز می‌شود
  crashes: 0,
  restartTimer: null,
  healthyAt: 0,
  relaunching: false,
  autostarted: process.argv.includes(AUTOSTART_ARG),
};

const MAX_LOG_LINES = 3000;

/** به هر پنجره‌ای که باز است می‌فرستد — هم پوسته، هم ترمینالِ جدا شده */
function broadcast(channel, payload) {
  for (const win of [state.win, state.termWin]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function pushLog(text, stream = 'out') {
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\r/g, '').trimEnd();
    if (!line) continue;
    const entry = { at: Date.now(), stream, text: line.slice(0, 2000) };
    state.logs.push(entry);
    if (state.logs.length > MAX_LOG_LINES) state.logs.shift();
    broadcast('log', entry);
  }
}

function setStatus(status, error = null) {
  state.status = status;
  state.error = error;
  broadcast('status', publicState());
}

function publicState() {
  return {
    status: state.status,
    error: state.error,
    port: state.port,
    url: state.url,
    dataDir: state.dataDir,
    runFromHome: state.runFromHome,
    portable: !!portableExe(),
    serverDir: serverDir(),
    version: app.getVersion(),
    node: process.versions.node,
    electron: process.versions.electron,
    platform: process.platform,
    usingOverlay: ctx.usingOverlay,
    shellDir: ctx.overlayDir,
    pid: state.child?.pid || null,
    crashes: state.crashes,
    autoStart: readSettings().autoStart !== false,
    autoRelaunch: readSettings().autoRelaunch !== false,
    autostarted: state.autostarted,
  };
}

/* ------------------------------ اجرای سرور ------------------------------- */

/** صبر می‌کند تا سرور واقعاً جواب بدهد — نه اینکه فقط پروسه ساخته شود */
async function waitForHealth(port, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (state.stopping) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch { /* هنوز بالا نیامده */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function startServer() {
  if (state.child) return;
  const dir = serverDir();
  const entry = path.join(dir, 'src', 'index.js');

  if (!fs.existsSync(entry)) {
    setStatus('error', `فایل‌های سرور پیدا نشد:\n${entry}`);
    pushLog(`فایل‌های سرور پیدا نشد: ${entry}`, 'err');
    return;
  }

  setStatus('starting');
  state.port = await pickPort(Number(readSettings().port) || 4700);
  state.url = `http://127.0.0.1:${state.port}`;

  pushLog(`راه‌اندازی سرور روی پورت ${state.port} …`);
  pushLog(`پوشهٔ داده: ${state.dataDir}${state.runFromHome ? ' (برنامه از داخلِ همین پوشه باز شده)' : ''}`);
  writeHomeMarker(state.dataDir);

  state.child = spawn(process.execPath, [entry], {
    cwd: dir,
    env: {
      ...process.env,
      // با این پرچم، Electron مثل خودِ Node رفتار می‌کند
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
      HLP_PORT: String(state.port),
      HLP_HOST: listenHost(),
      //  ⚠️ سرور خودش ‎127.0.0.1‎ِ پوسته‌های کهنه را به شبکه باز می‌کند
      //  (‎config.listenHost‎)؛ «نه» گفتنِ صریحِ کاربر باید به آن‌جا هم برسد.
      HLP_LAN_ACCESS: listenHost() === '0.0.0.0' ? '1' : '0',
      HLP_DATA_DIR: state.dataDir,
      // بدونِ این‌ها، به‌روزرسانی فایل‌ها را کنارِ برنامه می‌ریزد و چیزی که
      // واقعاً اجرا می‌شود عوض نمی‌شود.
      HLP_APP_LAYOUT: 'packaged',
      HLP_SHELL_DIR: ctx.overlayDir || '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  state.child.stdout.setEncoding('utf8');
  state.child.stderr.setEncoding('utf8');
  state.child.stdout.on('data', (d) => pushLog(d, 'out'));
  state.child.stderr.on('data', (d) => pushLog(d, 'err'));

  state.child.on('error', (e) => {
    pushLog(`اجرای سرور ناموفق بود: ${e.message}`, 'err');
    setStatus('error', e.message);
  });

  const me = state.child;
  state.child.on('exit', (code, signal) => {
    if (state.child === me) state.child = null;
    if (state.stopping || state.relaunching) return;
    //  ⛔ پنل پس از نصبِ به‌روزرسانی عمداً بیرون می‌رود. اگر نشانه‌اش تازه
    //  است، کلِ برنامه دوباره باز می‌شود (پوسته هم عوض شده) — نه فقط سرور.
    if (maybeRelaunchForUpdate('exit')) return;
    pushLog(`سرور بسته شد (کد ${code ?? signal})`, 'err');
    scheduleServerRestart(`سرور بسته شد (کد ${code ?? signal})`);
  });

  const healthy = await waitForHealth(state.port);
  if (state.stopping) return;
  //  ⚠️ پنل روی شبکه گوش می‌دهد ولی دیوارِ آتشِ ویندوز پیش‌فرض می‌بندد —
  //  در هر اجرا حداکثر **یک بار** می‌پرسیم (UAC)، و فقط اگر قاعده‌ها نیستند.
  //  پشتِ سرِ کار، بی انتظار؛ نه گفتن چیزی را روی همین کامپیوتر نمی‌شکند.
  if (healthy && listenHost() === '0.0.0.0' && !state.firewallAsked) {
    state.firewallAsked = true;
    ensureFirewall({ panelPort: state.port, publicPort: 4701, discoveryPort: 4702 })
      .then((r) => {
        if (r.state === 'added') pushLog('✅ دیوارِ آتشِ ویندوز برای شبکهٔ خانه باز شد (پنل · پورتِ عمومی · کشفِ خودکار).');
        else if (r.state === 'declined')
          pushLog('⚠️ دیوارِ آتشِ ویندوز باز نشد — برنامهٔ پمپ روی کامپیوترهای دیگر و گوشی‌ها به این سرور نمی‌رسند. '
            + 'بارِ بعد که برنامه باز شد، در پنجرهٔ ویندوز «بله» را بزنید.', 'err');
      })
      .catch(() => { /* دیوارِ آتش رفاه است */ });
  }
  if (healthy) {
    pushLog(`سرور آماده است: ${state.url}`);
    state.healthyAt = Date.now();
    setStatus('running');
  } else if (state.child) {
    pushLog('سرور در مهلتِ مقرر جواب نداد.', 'err');
    setStatus('error', 'سرور جواب نداد');
  }
}

/**
 * ⛔ سرورِ افتاده خودش برمی‌گردد — کسی پای کامپیوتر نیست که «راه‌اندازی
 * دوباره» را بزند. فاصله زیاد می‌شود ولی هرگز دست نمی‌کشد (`restartDelay`)، و
 * سروری که دو دقیقه سالم ماند شمارنده‌اش را از صفر می‌گیرد.
 */
function scheduleServerRestart(why) {
  if (state.restartTimer || state.relaunching) return;
  if (state.healthyAt && Date.now() - state.healthyAt >= HEALTHY_RESET_MS) state.crashes = 0;
  state.healthyAt = 0;
  state.crashes += 1;
  const wait = restartDelay(state.crashes);
  pushLog(`سرور خودش دوباره بالا می‌آید — ${Math.round(wait / 1000)} ثانیهٔ دیگر (بارِ ${state.crashes})`, 'err');
  setStatus('error', `${why} — ${Math.round(wait / 1000)} ثانیهٔ دیگر خودش دوباره بالا می‌آید`);
  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    if (state.stopping || state.relaunching || state.child) return;
    startServer().catch((e) => pushLog(`راه‌اندازیِ دوبارهٔ سرور نشد: ${e.message}`, 'err'));
  }, wait);
}

function cancelServerRestart() {
  if (state.restartTimer) clearTimeout(state.restartTimer);
  state.restartTimer = null;
}

function stopServer() {
  if (!state.child) return;
  state.stopping = true;
  const child = state.child;
  state.child = null;
  try {
    child.kill('SIGTERM');
  } catch { /* از قبل مرده */ }
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch { /* تمام */ }
  }, 4000);
}

async function restartServer() {
  pushLog('راه‌اندازی دوباره …');
  cancelServerRestart();
  state.crashes = 0;
  stopServer();
  await new Promise((r) => setTimeout(r, 1200));
  state.stopping = false;
  await startServer();
}

/* -------------------------------- پنجره --------------------------------- */

function createWindow() {
  state.win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#101010',
    show: false,
    title: 'مرکز فرمان',
    icon: assetFile('icon.png'),
    webPreferences: {
      preload: implFile('preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  state.win.loadFile(implFile('shell.html'));
  state.win.once('ready-to-show', () => {
    state.win.show();
    // پنجره آمد، پس این نسخه سالم است
    ctx.markBooted();
  });

  // پیوندهای بیرونی در مرورگرِ خودِ سیستم باز شوند، نه داخلِ برنامه
  state.win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // بستنِ پنجرهٔ اصلی یعنی پایانِ کار — ترمینالِ جدا شده هم با آن می‌رود
  state.win.on('closed', () => {
    state.win = null;
    closeTerminalWindow();
  });
}

/* --------------------- ترمینال در پنجرهٔ جداگانه ------------------------- */

/** به هر دو پنجره می‌گوید ترمینال الان کجاست: داخلِ برنامه یا پنجرهٔ خودش */
function announceTerminalPlace() {
  broadcast('terminal-place', { popped: Boolean(state.termWin && !state.termWin.isDestroyed()) });
}

function openTerminalWindow() {
  if (state.termWin && !state.termWin.isDestroyed()) {
    if (state.termWin.isMinimized()) state.termWin.restore();
    state.termWin.focus();
    return;
  }

  state.termWin = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 480,
    minHeight: 260,
    backgroundColor: '#0b0b0b',
    show: false,
    title: 'ترمینال — مرکز فرمان',
    icon: assetFile('icon.png'),
    webPreferences: {
      preload: implFile('preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  state.termWin.loadFile(implFile('terminal.html'));
  state.termWin.once('ready-to-show', () => {
    // خواستهٔ کاربر: در پنجرهٔ جدا، تمامِ صفحه باشد
    state.termWin.maximize();
    state.termWin.show();
  });

  state.termWin.on('closed', () => {
    state.termWin = null;
    // پنجره که بسته شد، ترمینال دوباره به داخلِ برنامه برمی‌گردد
    announceTerminalPlace();
  });

  announceTerminalPlace();
}

function closeTerminalWindow() {
  if (state.termWin && !state.termWin.isDestroyed()) state.termWin.close();
}

/* --------------------------------- IPC ---------------------------------- */

ipcMain.handle('state', () => publicState());
ipcMain.handle('logs', () => state.logs);
ipcMain.handle('restart', () => restartServer());
ipcMain.handle('open-browser', () => (state.url ? shell.openExternal(state.url) : null));
// فقط صفحهٔ انتشارهای همین مخزن — نه هر نشانی‌ای که پوسته بدهد
ipcMain.handle('open-external', (_event, url) => {
  const s = String(url || '');
  if (!s.startsWith('https://github.com/vil3ntec-it/')) return false;
  shell.openExternal(s);
  return true;
});
ipcMain.handle('open-data', () => (state.dataDir ? shell.openPath(state.dataDir) : null));

/**
 * کپیِ خودِ برنامه به داخلِ پوشهٔ داده — تا پوشه «همه‌چیز» را با خود ببرد.
 *
 * فقط نسخهٔ قابل‌حمل یک فایلِ تنهاست که هر جا برود کار می‌کند؛ فایلِ اجراییِ
 * نسخهٔ نصبی بی پوشهٔ کنارش (‎resources/‎) باز نمی‌شود. پس برای نسخهٔ نصبی
 * نشانیِ دانلودِ نسخهٔ قابل‌حمل برمی‌گردد و کاربر همان را در پوشه می‌گذارد.
 */
ipcMain.handle('copy-app-into-data', async () => {
  if (!state.dataDir) return { ok: false, error: 'هنوز پوشهٔ داده انتخاب نشده است' };
  const exe = portableExe();
  if (!exe) {
    return {
      ok: false,
      installed: true,
      error: 'این نسخه نصب‌شده است و یک فایلِ تنها نیست. نسخهٔ قابل‌حمل (Portable) را بگیرید و داخلِ پوشهٔ داده بگذارید.',
      url: 'https://github.com/vil3ntec-it/server/releases',
    };
  }
  const target = path.join(state.dataDir, 'ControlCenter.exe');
  try {
    if (path.resolve(exe) === path.resolve(target)) {
      return { ok: true, path: target, already: true };
    }
    await fsp.copyFile(exe, target);
    writeHomeMarker(state.dataDir);
    pushLog(`برنامه داخلِ پوشهٔ داده کپی شد: ${target}`);
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: `کپی نشد (${e.code || e.message})` };
  }
});
ipcMain.handle('clear-logs', () => {
  state.logs = [];
});

ipcMain.handle('terminal-popout', () => {
  openTerminalWindow();
  return { popped: true };
});

ipcMain.handle('terminal-dock', () => {
  closeTerminalWindow();
  return { popped: false };
});

ipcMain.handle('terminal-place', () => ({
  popped: Boolean(state.termWin && !state.termWin.isDestroyed()),
}));

ipcMain.handle('terminal-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { full: false };
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  return { full: next };
});

ipcMain.handle('focus-main', () => {
  if (!state.win || state.win.isDestroyed()) return null;
  if (state.win.isMinimized()) state.win.restore();
  state.win.focus();
  return null;
});

/* تنظیماتِ کوچکِ رابط (مثلِ بلندیِ ترمینال) — کنارِ بقیهٔ تنظیماتِ برنامه */
ipcMain.handle('get-ui', () => readSettings().ui || {});
ipcMain.handle('set-ui', (_event, patch) => {
  const ui = { ...(readSettings().ui || {}), ...(patch && typeof patch === 'object' ? patch : {}) };
  writeSettings({ ui });
  return ui;
});

ipcMain.handle('setup-needed', () => !readSettings().dataDir);

ipcMain.handle('default-data-dir', () => defaultDataDir());

ipcMain.handle('choose-folder', async (_event, current) => {
  const res = await dialog.showOpenDialog(state.win, {
    title: 'پوشهٔ نگهداری اطلاعات را انتخاب کنید',
    defaultPath: current || defaultDataDir(),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'انتخاب',
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return res.filePaths[0];
});

/**
 * ساخت و آزمونِ نوشتنِ پوشه، با مهلتِ زمانی.
 *
 * چرا مهلت لازم است: روی بعضی مسیرهای ویژهٔ سیستم‌عامل، ساختِ بازگشتیِ پوشه
 * می‌تواند تا ابد بچرخد. بدونِ این مهلت، کلِ پنجره قفل می‌شد.
 */
async function ensureWritable(target, timeoutMs = 8000) {
  const work = (async () => {
    await fsp.mkdir(target, { recursive: true });
    const probe = path.join(target, `.write-test-${Date.now()}`);
    await fsp.writeFile(probe, 'ok');
    await fsp.rm(probe, { force: true });
  })();
  let timer;
  const guard = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  try {
    await Promise.race([work, guard]);
  } finally {
    clearTimeout(timer);
  }
  // اگر مهلت تمام شد، کارِ پس‌زمینه را رها می‌کنیم ولی خطایش برنامه را نخواباند
  work.catch(() => {});
}

ipcMain.handle('save-setup', async (_event, dataDir) => {
  const raw = String(dataDir || '').trim();
  if (!raw) return { ok: false, error: 'مسیر خالی است' };
  const target = path.resolve(raw);
  try {
    await ensureWritable(target);
  } catch (e) {
    const reason = e.message === 'timeout' ? 'این مسیر جواب نداد' : `این پوشه نوشتنی نیست (${e.code || e.message})`;
    return { ok: false, error: reason };
  }
  writeSettings({ dataDir: target });
  state.dataDir = target;
  watchApplied();
  state.stopping = false;
  await startServer();
  return { ok: true, dataDir: target };
});

/* --------------------- به‌روزرسانی: نشانه و راه‌اندازی دوباره -------------- */

/** فایلی که سرور بعد از نشستنِ به‌روزرسانی می‌نویسد */
const appliedFile = () => (state.dataDir ? path.join(state.dataDir, 'updates', 'applied.json') : null);

function readApplied() {
  const file = appliedFile();
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * چشم به فایلِ نشانه.
 *
 * پوستهٔ برنامه داخلِ خودِ برنامه است، پس وقتی به‌روزرسانی می‌نشیند تا کلِ
 * برنامه دوباره باز نشود عوض نمی‌شود. به کاربر می‌گوییم، و دکمه‌اش را
 * می‌دهیم — خودمان بی‌خبر نمی‌بندیمش.
 */
function watchApplied() {
  const dir = state.dataDir ? path.join(state.dataDir, 'updates') : null;
  if (!dir) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch { /* بی‌خیال */ }

  state.appliedSeen = readApplied()?.at || 0;

  try {
    state.appliedWatcher?.close();
    state.appliedWatcher = fs.watch(dir, (_event, name) => {
      if (name && name !== 'applied.json') return;
      maybeRelaunchForUpdate('watch');
    });
  } catch { /* روی بعضی مسیرها watch نداریم؛ کاربر دستی هم می‌تواند ببندد */ }
}

/**
 * ⛔ به‌روزرسانی که نشست، برنامه **خودش** دوباره باز می‌شود — خواستهٔ صاحب
 * سامانه: «لازم نباشه من وایسم… بعد دکمهٔ باز کردنِ دوباره رو بزنم». پیش از این
 * فقط نواری می‌آمد و منتظرِ کلیک می‌ماند، و سرورِ بیرون‌رفته «بسته شد» می‌گفت.
 * `autoRelaunch: false` در تنظیماتِ برنامه همان رفتارِ قدیم (فقط نوار) را برمی‌گرداند.
 * @returns آیا برنامه دارد دوباره باز می‌شود
 */
function maybeRelaunchForUpdate(from) {
  if (state.relaunching) return true;
  const applied = readApplied();
  if (!applied?.at || applied.at <= state.appliedSeen) return false;
  const settings = readSettings();
  state.appliedSeen = applied.at;
  broadcast('update-applied', applied);
  if (!shouldRelaunch(applied, 0, settings)) {
    pushLog(`به‌روزرسانی نصب شد (نسخهٔ ${applied.version || '؟'}) — برای اعمال، برنامه دوباره باز شود.`);
    return false;
  }
  pushLog(`به‌روزرسانی نصب شد (نسخهٔ ${applied.version || '؟'}) — برنامه همین حالا خودش دوباره باز می‌شود…`);
  //  پس از «exit» سرور دیگر نیست؛ از «watch» یک مکثِ کوتاه تا پنل خودش بیرون برود.
  setTimeout(relaunchApp, from === 'exit' ? 300 : 2500);
  state.relaunching = true;
  return true;
}

function relaunchApp() {
  state.relaunching = true;
  state.stopping = true;
  cancelServerRestart();
  stopServer();
  //  ⚠️ نسخهٔ قابل‌حمل از پوشهٔ موقت اجرا می‌شود؛ دوباره باز کردنِ همان مسیر
  //  یعنی اجرای فایلی که با بسته شدنِ همین برنامه پاک می‌شود.
  const exe = portableExe();
  const args = process.argv.slice(1).filter((a) => a !== AUTOSTART_ARG);
  app.relaunch(exe ? { execPath: exe, args } : { args });
  setTimeout(() => app.exit(0), 600);
}

/* --------------------------- روشن شدن با ویندوز --------------------------- */

function applyLoginItem() {
  const plan = loginItemPlan({
    platform: process.platform,
    isPackaged: app.isPackaged,
    settings: readSettings(),
    execPath: process.execPath,
    portableFile: portableExe(),
  });
  if (!plan) return null;
  try {
    app.setLoginItemSettings(plan);
  } catch (e) {
    pushLog(`ثبتِ «روشن با ویندوز» نشد: ${e.message}`, 'err');
  }
  return plan;
}

ipcMain.handle('autostart', () => ({
  enabled: readSettings().autoStart !== false,
  supported: Boolean(loginItemPlan({ platform: process.platform, isPackaged: true, execPath: process.execPath })),
}));
ipcMain.handle('set-autostart', (_event, on) => {
  writeSettings({ autoStart: Boolean(on) });
  applyLoginItem();
  pushLog(on ? '✅ برنامه با روشن شدنِ ویندوز خودش باز می‌شود.' : 'روشن شدن با ویندوز خاموش شد.');
  broadcast('status', publicState());
  return { enabled: Boolean(on) };
});

ipcMain.handle('update-applied', () => readApplied());
ipcMain.handle('relaunch', () => {
  relaunchApp();
  return true;
});

/* ------------------------------- چرخهٔ عمر ------------------------------- */

/** راه‌اندازِ برنامه (main.js) این را صدا می‌زند و بستر را می‌دهد */
export async function start(context) {
  ctx = { ...ctx, ...context };

  // فقط یک نسخه از برنامه اجرا شود
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', () => {
    if (state.win) {
      if (state.win.isMinimized()) state.win.restore();
      state.win.focus();
    }
  });

  app.on('window-all-closed', () => {
    stopServer();
    app.quit();
  });

  app.on('before-quit', () => {
    state.stopping = true;
    stopServer();
  });

  await app.whenReady();
  Menu.setApplicationMenu(null);
  //  ⛔ هر بار که برنامه باز می‌شود دوباره نوشته می‌شود: مسیرِ برنامه با نصبِ
  //  تازه عوض می‌شود و ثبتِ کهنه یعنی فردا صبح ویندوز چیزی را اجرا نمی‌کند.
  applyLoginItem();
  if (state.autostarted) pushLog('برنامه با روشن شدنِ ویندوز خودش باز شد.');
  createWindow();

  const saved = readSettings();
  const home = homeNearExe();
  if (home) {
    // از داخلِ پوشهٔ داده باز شده — همان پوشه، بی سوال. (کامپیوترِ تازه،
    // فلش، پوشهٔ جابه‌جاشده.) تنظیمِ ذخیره‌شده هم به همین می‌نشیند تا دفعهٔ
    // بعد از هر جا باز شد، همین را بگیرد.
    state.dataDir = home;
    state.runFromHome = true;
    if (saved.dataDir !== home) writeSettings({ dataDir: home });
    watchApplied();
    await startServer();
  } else if (saved.dataDir) {
    state.dataDir = saved.dataDir;
    watchApplied();
    await startServer();
  } else {
    // بارِ اول: از کاربر می‌پرسیم اطلاعات کجا برود
    setStatus('stopped');
  }
}
