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
//    ۷) (۱.۵۰.۸۵) اجازه‌های مرورگر: فقط مبدأِ پنل و صفحه‌های خودِ برنامه، فقط آن‌چه پنل به‌کار می‌برد
//    ۸) همان، با سرورِ بالا: نمونهٔ دومِ main-impl.js با یک «سرورِ» کوچکِ ساختگی (فقط ‎/health‎)
//       تا مبدأِ پنلِ **همین اجرا** (درگاهِ انتخاب‌شده) از سیم‌کشیِ واقعی سنجیده شود
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

/* ─────────────────────────── ۷) اجازه‌های مرورگر ─────────────────────────── */
console.log('\n── ۷) اجازه‌های مرورگر (میکروفون، کلیپ‌بورد، اعلان، مکان…) ──');
{
  const ses = fake.session.defaultSession;
  const ask = (permission, requestingUrl, extra = {}) => new Promise((resolve) => {
    if (!ses.requestHandler) return resolve('بی گرداننده ⇒ Electron همه را می‌دهد');
    let done = false;
    ses.requestHandler(main.webContents, permission, (ok) => { done = true; resolve(ok); }, { requestingUrl, isMainFrame: true, ...extra });
    setTimeout(() => { if (!done) resolve('پاسخی نیامد'); }, 200);
  });
  const checkPerm = (permission, origin, details = {}) => (ses.checkHandler ? ses.checkHandler(main.webContents, permission, origin, details) : 'بی گرداننده');
  check('⛔ نشستِ پیش‌فرض گردانندهٔ درخواستِ اجازه دارد (پیش از هر پنجره)', typeof ses.requestHandler === 'function');
  check('⛔ و گردانندهٔ سنجشِ اجازه و دستگاه', typeof ses.checkHandler === 'function' && typeof ses.deviceHandler === 'function');
  check('⛔ دستگاه‌ها (HID/USB/Serial) ⇒ نه', ses.deviceHandler?.({ deviceType: 'hid', origin: 'http://127.0.0.1:4700' }) === false);

  for (const [label, perm, url, extra] of [
    ['صفحهٔ بیگانه: میکروفون', 'media', EVIL, { mediaTypes: ['audio'] }],
    ['صفحهٔ بیگانه: اعلان', 'notifications', EVIL],
    ['صفحهٔ بیگانه: مکان', 'geolocation', EVIL],
    ['صفحهٔ بیگانه: کلیپ‌بورد', 'clipboard-sanitized-write', EVIL],
    ['shell.html: میکروفون', 'media', SHELL, { mediaTypes: ['audio'] }],
    ['shell.html: خواندنِ کلیپ‌بورد', 'clipboard-read', SHELL],
    ['shell.html: بازکردنِ پروتکلِ بیرونی', 'openExternal', SHELL],
    ['پنل پیش از بالا آمدنِ سرور (مبدأ هنوز نامعلوم)', 'media', 'http://127.0.0.1:4700/support', { mediaTypes: ['audio'] }],
    ['درخواستِ بی نشانیِ قاب', 'media', '', { mediaTypes: ['audio'] }],
  ]) {
    check(`⛔ ${label} ⇒ رد`, (await ask(perm, url, extra)) === false);
  }
  check('shell.html: نوشتن در کلیپ‌بورد (کپیِ لاگ) — همان رفتارِ امروز', (await ask('clipboard-sanitized-write', SHELL)) === true);
  check('terminal.html: نوشتن در کلیپ‌بورد', (await ask('clipboard-sanitized-write', `${TERM}#x`)) === true);
  check('سنجش: shell.html با مبدأِ ‎file://‎ و قابِ اصلی ⇒ کلیپ‌بورد بله، اعلان نه',
    (main.webContents.getURL = () => SHELL, checkPerm('clipboard-sanitized-write', 'file://', { isMainFrame: true })) === true
    && checkPerm('notifications', 'file://', { isMainFrame: true }) === false);
  check('⛔ سنجش: مبدأِ بیگانه ⇒ نه', checkPerm('media', 'https://evil.example', { mediaType: 'audio', requestingUrl: EVIL }) === false);
  const before = fake.calls.windows.length;
  const logs = await invoke('logs', SHELL);
  check('ردها در ترمینالِ برنامه یک خط می‌گیرند (بی تکرارِ هر بار)', Array.isArray(logs) && logs.some((l) => /اجازهٔ «notifications»/.test(l.text))
    && logs.filter((l) => /اجازهٔ «media» برای «https:\/\/evil/.test(l.text)).length === 1, JSON.stringify(logs.slice(-3)));
  check('هیچ پنجره‌ای از این‌ها ساخته نشد', fake.calls.windows.length === before);

  const fresh = new fake.Session('persist:other');
  fake.app.emit('session-created', fresh);
  check('⛔ هر نشستِ تازه (partition) هم همان گرداننده را می‌گیرد', typeof fresh.requestHandler === 'function' && typeof fresh.checkHandler === 'function');

  let g = null;
  try { g = await import(pathToFileURL(path.join(APP, 'guards.js')).href); } catch { /* بالا سنجیده شد */ }
  const P = 'http://127.0.0.1:4711';
  const allow = (permission, url, extra = {}) => Boolean(g?.permissionAllowed?.({ permission, url, ...extra }, { panelOrigin: () => P, pages: () => [path.join(APP, 'shell.html')] }));
  check('قاعدهٔ خالص هست (permissionAllowed)', typeof g?.permissionAllowed === 'function');
  check('پنل: میکروفون برای پیامِ صوتی (فقط صدا) — راهِ مالک بسته نشد', allow('media', `${P}/account/support`, { mediaTypes: ['audio'] }));
  check('پنل: سنجشِ میکروفون (mediaType=audio)', allow('media', `${P}/`, { mediaType: 'audio' }));
  check('پنل: نوشتن در کلیپ‌بورد (دکمه‌های کپی) و تمام‌صفحهٔ ویدیو', allow('clipboard-sanitized-write', `${P}/x`) && allow('fullscreen', `${P}/x`));
  check('⛔ پنل: دوربین، صدا+دوربین، یا «نامعلوم» نه', !allow('media', `${P}/`, { mediaTypes: ['video'] }) && !allow('media', `${P}/`, { mediaTypes: ['audio', 'video'] })
    && !allow('media', `${P}/`, { mediaType: 'unknown' }) && !allow('media', `${P}/`, {}));
  check('⛔ پنل: اعلان، مکان، خواندنِ کلیپ‌بورد، MIDI، قفلِ نشانگر، پروتکلِ بیرونی نه',
    ['notifications', 'geolocation', 'clipboard-read', 'midiSysex', 'pointerLock', 'openExternal', 'display-capture', 'idle-detection'].every((x) => !allow(x, `${P}/`)));
  check('⛔ همان میزبان با درگاهِ دیگر، localhost، https یا قابِ بیگانهٔ درونِ پنل نه',
    !allow('media', 'http://127.0.0.1:4700/', { mediaTypes: ['audio'] }) && !allow('media', 'http://localhost:4711/', { mediaTypes: ['audio'] })
    && !allow('media', 'https://127.0.0.1:4711/', { mediaTypes: ['audio'] }) && !allow('clipboard-sanitized-write', EVIL));
}

/* ─────────────── ۸) سرورِ بالا: مبدأِ پنلِ همین اجرا ─────────────── */
console.log('\n── ۸) با سرورِ بالا: میکروفونِ پنل از سیم‌کشیِ واقعی ──');
{
  //  «سرورِ» ساختگی کنارِ یک پوستهٔ ساختگی: ‎serverDir() = packagedDir/../../server‎ — فقط ‎/health‎
  const stub = fs.mkdtempSync(path.join(fake.userData, 'stub-'));
  fs.mkdirSync(path.join(stub, 'server', 'src'), { recursive: true });
  fs.mkdirSync(path.join(stub, 'shell', 'app'), { recursive: true });
  fs.writeFileSync(path.join(stub, 'server', 'src', 'index.js'),
    "require('node:http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{\"ok\":true}'); })"
    + ".listen(Number(process.env.HLP_PORT), process.env.HLP_HOST || '127.0.0.1');\n");
  fs.writeFileSync(path.join(stub, 'package.json'), '{"type":"commonjs"}');
  const dataDir = path.join(stub, 'data');
  fs.mkdirSync(dataDir);
  const port = Number(process.env.TEST_PORT || 4987);
  fs.writeFileSync(settingsFile, JSON.stringify({ ...readSettings(), dataDir, lanAccess: false, port }));
  const second = await import(`${pathToFileURL(path.join(APP, 'main-impl.js')).href}?with-server`);
  const t0 = Date.now();
  await second.start({
    implDir: APP, packagedDir: path.join(stub, 'shell', 'app'), overlayDir: null, assetsDir: path.join(APP, '..', 'assets'),
    usingOverlay: false, markBooted() {},
  });
  const st = await invoke('state', SHELL);
  check('سرورِ ساختگی بالا آمد و نشانیِ پنلِ همین اجرا معلوم شد', st?.status === 'running' && /^http:\/\/127\.0\.0\.1:\d+$/.test(String(st?.url)),
    `${JSON.stringify(st).slice(0, 160)} (${Date.now() - t0}ms)`);
  const ses = fake.session.defaultSession;
  const ask = (permission, requestingUrl, extra = {}) => new Promise((resolve) => {
    if (!ses.requestHandler) return resolve('بی گرداننده ⇒ Electron همه را می‌دهد');
    ses.requestHandler(main.webContents, permission, resolve, { requestingUrl, isMainFrame: true, ...extra });
  });
  const checkPerm = (...a) => (ses.checkHandler ? ses.checkHandler(...a) : 'بی گرداننده');
  if (st?.url) {
    check('پنلِ همین اجرا: میکروفون (فقط صدا) برای پیامِ صوتی ⇒ بله', (await ask('media', `${st.url}/account/support`, { mediaTypes: ['audio'] })) === true);
    check('پنلِ همین اجرا: کپی ⇒ بله', (await ask('clipboard-sanitized-write', `${st.url}/`)) === true);
    check('⛔ پنلِ همین اجرا: دوربین و اعلان ⇒ نه', (await ask('media', `${st.url}/`, { mediaTypes: ['video'] })) === false
      && (await ask('notifications', `${st.url}/`)) === false);
    const other = `http://127.0.0.1:${Number(new URL(st.url).port) + 1}`;
    check('⛔ درگاهِ دیگرِ همین کامپیوتر (سایتِ دیگر روی لوپ‌بک) ⇒ نه', (await ask('media', `${other}/`, { mediaTypes: ['audio'] })) === false);
    check('سنجش: مبدأِ پنل + صدا ⇒ بله؛ مبدأِ دیگر ⇒ نه',
      checkPerm(main.webContents, 'media', st.url, { mediaType: 'audio', requestingUrl: `${st.url}/` }) === true
      && checkPerm(main.webContents, 'media', other, { mediaType: 'audio', requestingUrl: `${other}/` }) === false);
  }
  fake.app.emit('before-quit');
  await new Promise((r) => setTimeout(r, 300));
}

fs.rmSync(fake.userData, { recursive: true, force: true });
console.log(`\n${fail ? '❌' : '✅'} نگهبانِ پنجره‌ها: ${pass} درست، ${fail} نادرست`);
process.exit(fail ? 1 : 0);
