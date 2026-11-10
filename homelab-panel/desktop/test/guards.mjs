// ---------------------------------------------------------------------------
//  آزمونِ نگهبانِ پنجره‌ها (۱.۵۰.۸۴) — پلِ `window.cc` فقط مالِ صفحه‌های خودِ برنامه
//      node test/guards.mjs        (بی Electron؛ پیش از آزمون‌های پنجره‌دار)
//
//  خودِ app/main-impl.js بار می‌شود — با یک «electron» ِ کوچکِ ساختگی که هر چه
//  پروسهٔ اصلی با پنجره‌ها می‌کند ثبت می‌کند (test/fake-electron/). پس همان
//  سیم‌کشیِ واقعی سنجیده می‌شود، نه یک رونوشت:
//    ۱) پنجره‌ها: جداسازی، بی Node، sandbox ِ صریح
//    ۲) ناوبری: صفحهٔ بیگانه (پیوند/فایلِ رهاشده روی پنجره) باز نمی‌شود
//    ۳) ‎window.open‎: مرورگرِ سیستم فقط ‎http(s)‎ — نه ‎file:‎، UNC، ‎ms-msdt:‎…
//    ۴) IPC فقط از قابِ اصلیِ shell.html/terminal.html
//    ۵) ‎<webview>‎ هرگز preload و Node نمی‌گیرد
//    ۶) قاعده‌های خالص با مسیرِ ویندوز (فاصله، حروفِ بزرگ/کوچک، UNC)
// ---------------------------------------------------------------------------
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

register('./fake-electron/hooks.mjs', import.meta.url);
const fake = await import('./fake-electron/electron.mjs');

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? '✅' : '❌'} ${name}${ok || !extra ? '' : ' — ' + String(extra).slice(0, 240)}`);
};

const APP = path.join(import.meta.dirname, '..', 'app');
const SHELL = pathToFileURL(path.join(APP, 'shell.html')).href;
const TERM = pathToFileURL(path.join(APP, 'terminal.html')).href;
const EVIL = 'https://evil.example/cc.html';
const settingsFile = path.join(fake.userData, 'desktop.json');

const impl = await import(pathToFileURL(path.join(APP, 'main-impl.js')).href);
await impl.start({
  implDir: APP, packagedDir: APP, overlayDir: null, assetsDir: path.join(APP, '..', 'assets'),
  usingOverlay: false, markBooted() {},
});

const navigate = (win, url, kind = 'will-navigate') => {
  const event = { url, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  win.webContents.emit(kind, event, url);
  return !event.defaultPrevented;          // true یعنی «رفت»
};
const openWindow = (win, url) => {
  const before = fake.calls.openExternal.length;
  const res = win.webContents.windowOpenHandler ? win.webContents.windowOpenHandler({ url, disposition: 'new-window' }) : null;
  return { action: res?.action ?? 'allow (بی نگهبان)', external: fake.calls.openExternal.slice(before) };
};
const invoke = async (channel, url, args = [], frame = {}) => {
  const fn = fake.calls.handlers.get(channel);
  if (!fn) return { missing: true };
  const event = { sender: main.webContents, senderFrame: url === null ? null : { url, parent: null, ...frame } };
  return fn(event, ...args);
};
const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; } };

const [main] = fake.calls.windows;
check('پنجرهٔ اصلی ساخته شد و shell.html را بار کرد', Boolean(main) && path.resolve(String(main.loaded)) === path.join(APP, 'shell.html'), main?.loaded);

/* ─────────────────────────── ۱) پنجره‌ها ─────────────────────────── */
console.log('\n── ۱) تنظیمِ پنجرهٔ اصلی ──');
{
  const p = main.options.webPreferences || {};
  check('جداسازیِ زمینه روشن، Node خاموش', p.contextIsolation === true && p.nodeIntegration === false);
  check('sandbox ِ صریح (نه وابسته به پیش‌فرضِ نسخهٔ Electron)', p.sandbox === true, JSON.stringify(p));
}

/* ─────────────────────────── ۲) ناوبری ─────────────────────────── */
console.log('\n── ۲) ناوبریِ پنجرهٔ اصلی ──');
check('صفحهٔ خودِ برنامه (shell.html#…) باز می‌شود', navigate(main, `${SHELL}#x`) === true);
check('⛔ پیوندِ بیگانهٔ رهاشده روی پنجره باز نمی‌شود (پل به آن نمی‌رسد)', navigate(main, EVIL) === false);
check('⛔ فایلِ HTML ِ رهاشده (file://) باز نمی‌شود', navigate(main, pathToFileURL(path.join(fake.userData, 'dropped.html')).href) === false);
check('⛔ تغییرِ مسیر به بیرون هم نه', navigate(main, EVIL, 'will-redirect') === false);

/* ─────────────────────────── ۳) window.open ─────────────────────────── */
console.log('\n── ۳) window.open ⇒ مرورگرِ سیستم ──');
for (const [label, url] of [
  ['file:///C:/Windows/System32/calc.exe', 'file:///C:/Windows/System32/calc.exe'],
  ['UNC (file://host/share)', 'file://attacker.example/share/run.exe'],
  ['ms-msdt:', 'ms-msdt:/id PCWDiagnostic /skip force'],
  ['search-ms:', 'search-ms:query=x&crumb=location:\\\\attacker.example\\share'],
  ['javascript:', 'javascript:alert(1)'],
]) {
  const r = openWindow(main, url);
  check(`⛔ ${label} به shell.openExternal نمی‌رسد و پنجره ساخته نمی‌شود`, r.action === 'deny' && r.external.length === 0, JSON.stringify(r));
}
{
  const r = openWindow(main, 'https://github.com/vil3ntec-it/server/releases');
  check('https در مرورگرِ سیستم باز می‌شود (همان رفتارِ امروز)', r.action === 'deny' && r.external.length === 1, JSON.stringify(r));
}

/* ─────────────────────────── ۴) IPC ─────────────────────────── */
console.log('\n── ۴) IPC فقط از صفحه‌های خودِ برنامه ──');
{
  const ownLogs = await invoke('logs', SHELL);
  check('shell.html: لاگ می‌گیرد', Array.isArray(ownLogs), JSON.stringify(ownLogs).slice(0, 80));
  check('⛔ صفحهٔ بیگانه: لاگِ سرور را نمی‌گیرد', !Array.isArray(await invoke('logs', EVIL)));
  check('⛔ صفحهٔ بیگانه: وضعیت (پوشهٔ داده، نسخه) را نمی‌گیرد', (await invoke('state', EVIL)) == null);
  check('⛔ فایلِ دیگرِ file:// همان پوشه نه', !Array.isArray(await invoke('logs', pathToFileURL(path.join(APP, 'other.html')).href)));
  check('⛔ قابِ درونیِ همان shell.html نه', !Array.isArray(await invoke('logs', SHELL, [], { parent: {} })));
  check('⛔ قابِ ازبین‌رفته (senderFrame=null) نه', !Array.isArray(await invoke('logs', null)));

  await invoke('set-ui', EVIL, [{ planted: 1 }]);
  check('⛔ صفحهٔ بیگانه تنظیمِ برنامه را نمی‌نویسد', readSettings().ui?.planted === undefined, JSON.stringify(readSettings()));
  await invoke('set-ui', SHELL, [{ terminalHeight: 222 }]);
  check('shell.html تنظیمِ رابط را می‌نویسد (همان رفتارِ امروز)', readSettings().ui?.terminalHeight === 222, JSON.stringify(readSettings()));
}

/* ─────────────────────────── ترمینالِ جدا ─────────────────────────── */
console.log('\n── پنجرهٔ ترمینالِ جدا ──');
{
  await invoke('terminal-popout', SHELL);
  const term = fake.calls.windows.find((w) => w !== main);
  check('پنجرهٔ ترمینال ساخته شد', Boolean(term) && path.resolve(String(term?.loaded)) === path.join(APP, 'terminal.html'), term?.loaded);
  if (term) {
    const p = term.options.webPreferences || {};
    check('ترمینال: جداسازی، بی Node، sandbox ِ صریح', p.contextIsolation === true && p.nodeIntegration === false && p.sandbox === true, JSON.stringify(p));
    check('⛔ ترمینال: ناوبری به بیرون نه', navigate(term, EVIL) === false);
    const r = openWindow(term, 'file:///C:/Windows/System32/calc.exe');
    check('⛔ ترمینال: window.open ِ file:// نه به openExternal نه پنجرهٔ تازه', r.action === 'deny' && r.external.length === 0, JSON.stringify(r));
    check('terminal.html: لاگ می‌گیرد', Array.isArray(await invoke('logs', TERM)));
  }
}

/* ─────────────────────────── ۵) webview ─────────────────────────── */
console.log('\n── ۵) ‎<webview>‎ ِ پنل ──');
{
  const prefs = { preload: 'file:///tmp/evil-preload.js', preloadURL: 'file:///tmp/evil.js', nodeIntegration: true, contextIsolation: false, sandbox: false, webviewTag: true };
  main.webContents.emit('will-attach-webview', { preventDefault() {} }, prefs, { src: 'http://127.0.0.1:4700' });
  check('⛔ preload ِ تگ برداشته می‌شود', prefs.preload === undefined && prefs.preloadURL === undefined, JSON.stringify(prefs));
  check('⛔ Node خاموش، جداسازی و sandbox روشن، webview ِ تودرتو نه',
    prefs.nodeIntegration === false && prefs.contextIsolation === true && prefs.sandbox === true && prefs.webviewTag === false, JSON.stringify(prefs));
}

/* ─────────────────────────── ۶) قاعده‌های خالص ─────────────────────────── */
console.log('\n── ۶) قاعده‌های خالص (مسیرِ ویندوز) ──');
{
  let g = null;
  try { g = await import(pathToFileURL(path.join(APP, 'guards.js')).href); } catch (e) { check('app/guards.js بار شد', false, e.message); }
  if (g) {
    const page = 'C:\\Users\\Ali Reza\\AppData\\Roaming\\Control Center\\app-update\\shell.html';
    check('ویندوز: فاصله و حروفِ بزرگ/کوچک', g.isOwnPage('file:///c:/users/ali%20reza/appdata/roaming/control%20center/app-update/shell.html?x#y', [page], 'win32'));
    check('ویندوز: asar ِ نصب', g.isOwnPage('file:///C:/Program%20Files/Control%20Center/resources/app.asar/app/shell.html',
      ['C:\\Program Files\\Control Center\\resources\\app.asar\\app\\shell.html'], 'win32'));
    check('⛔ ویندوز: UNC با همان نام نه', !g.isOwnPage('file://attacker/share/shell.html', ['\\\\attacker\\share\\shell.html'], 'win32'));
    check('⛔ ویندوز: صفحهٔ کناری نه', !g.isOwnPage('file:///C:/app/evil.html', ['C:\\app\\shell.html'], 'win32'));
    check('⛔ ‎..‎ در نشانی همان صفحه را نمی‌سازد مگر واقعاً همان فایل باشد',
      g.isOwnPage('file:///C:/app/sub/../shell.html', ['C:\\app\\shell.html'], 'win32') && !g.isOwnPage('file:///C:/app/../shell.html', ['C:\\app\\shell.html'], 'win32'));
    check('http و https بله؛ file/ms-*/data/javascript نه',
      g.externalUrlOk('https://a.example/x') && g.externalUrlOk('http://192.168.1.5:4700/') &&
      !g.externalUrlOk('file:///etc/passwd') && !g.externalUrlOk('ms-settings:') && !g.externalUrlOk('data:text/html,x') &&
      !g.externalUrlOk('javascript:alert(1)') && !g.externalUrlOk('https://'));
  }
}

fs.rmSync(fake.userData, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} نگهبانِ پنجره‌ها: ${pass} درست، ${fail} نادرست`);
process.exit(fail ? 1 : 0);
