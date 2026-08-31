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

/* ------------------------------ پورتِ آزاد ------------------------------- */

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function pickPort(preferred = 4700) {
  for (let port = preferred; port < preferred + 40; port++) {
    if (await portFree(port)) return port;
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
  logs: [],
  stopping: false,
  appliedWatcher: null,
  appliedSeen: 0,
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
    serverDir: serverDir(),
    version: app.getVersion(),
    node: process.versions.node,
    electron: process.versions.electron,
    platform: process.platform,
    usingOverlay: ctx.usingOverlay,
    shellDir: ctx.overlayDir,
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

  const hasAi = fs.existsSync(path.resolve(dir, '..', '..', 'ai-support', 'package.json'));

  pushLog(`راه‌اندازی سرور روی پورت ${state.port} …`);
  pushLog(`پوشهٔ داده: ${state.dataDir}`);

  state.child = spawn(process.execPath, [entry], {
    cwd: dir,
    env: {
      ...process.env,
      // با این پرچم، Electron مثل خودِ Node رفتار می‌کند
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
      HLP_PORT: String(state.port),
      HLP_HOST: '127.0.0.1',
      HLP_DATA_DIR: state.dataDir,
      HLP_AI_ENABLED: hasAi ? '1' : '0',
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

  state.child.on('exit', (code, signal) => {
    state.child = null;
    if (state.stopping) return;
    pushLog(`سرور بسته شد (کد ${code ?? signal})`, 'err');
    setStatus('error', `سرور بسته شد (کد ${code ?? signal})`);
  });

  const healthy = await waitForHealth(state.port);
  if (state.stopping) return;
  if (healthy) {
    pushLog(`سرور آماده است: ${state.url}`);
    setStatus('running');
  } else if (state.child) {
    pushLog('سرور در مهلتِ مقرر جواب نداد.', 'err');
    setStatus('error', 'سرور جواب نداد');
  }
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
ipcMain.handle('open-data', () => (state.dataDir ? shell.openPath(state.dataDir) : null));
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
      const applied = readApplied();
      if (applied?.at && applied.at > state.appliedSeen) {
        state.appliedSeen = applied.at;
        pushLog(`به‌روزرسانی نصب شد (نسخهٔ ${applied.version || '؟'}) — برای اعمال، برنامه دوباره باز شود.`);
        broadcast('update-applied', applied);
      }
    });
  } catch { /* روی بعضی مسیرها watch نداریم؛ کاربر دستی هم می‌تواند ببندد */ }
}

function relaunchApp() {
  state.stopping = true;
  stopServer();
  app.relaunch();
  setTimeout(() => app.exit(0), 600);
}

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
  createWindow();

  const saved = readSettings();
  if (saved.dataDir) {
    state.dataDir = saved.dataDir;
    watchApplied();
    await startServer();
  } else {
    // بارِ اول: از کاربر می‌پرسیم اطلاعات کجا برود
    setStatus('stopped');
  }
}
