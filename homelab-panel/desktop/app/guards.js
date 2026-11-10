// ---------------------------------------------------------------------------
//  ══ نگهبانِ پنجره‌ها (۱.۵۰.۸۴) — پلِ `window.cc` فقط مالِ صفحه‌های خودِ برنامه ══
//
//  یافتهٔ بازبینیِ خصمانه: پنجرهٔ اصلی و ترمینال هر دو preload دارند (پلِ
//  `window.cc`: لاگِ سرور، پوشهٔ داده، راه‌اندازی، روشن با ویندوز…) ولی:
//    • ناوبری بسته نبود — پیوند یا فایلی که روی پنجره رها شود، Chromium همان را
//      **در همان پنجره** باز می‌کند و preload برای هر صفحه‌ای می‌دود؛ صفحهٔ بیگانه
//      پل را می‌گرفت.
//    • هیچ درِ IPC نمی‌پرسید «از کدام صفحه؟».
//    • `setWindowOpenHandler` هر نشانی را به `shell.openExternal` می‌داد —
//      ‎file:///C:/…/x.exe‎، UNC و پروتکل‌های ویندوز (‎ms-msdt:‎، ‎search-ms:‎) ⇒ اجرای
//      برنامه/فایلِ دلخواه با یک ‎window.open‎ از همان صفحهٔ بیگانه.
//
//  ⛔ قاعده‌ها، همه خالص (بی Electron) تا آزمون بی پنجره بسنجدشان:
//    ۱) پنجرهٔ پل‌دار فقط صفحه‌های خودش (`shell.html`، `terminal.html`) را باز می‌کند.
//    ۲) IPC فقط از قابِ اصلیِ همان صفحه‌ها پاسخ می‌گیرد.
//    ۳) مرورگرِ سیستم فقط ‎http(s)‎ می‌گیرد.
//    ۴) ‎<webview>‎ ِ پنل هرگز preload و Node نمی‌گیرد.
// ---------------------------------------------------------------------------
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** نشانیِ ‎file:‎ ِ یکی از همین صفحه‌ها؟ (پرس‌وجو و # مهم نیست؛ UNC هرگز) */
export function isOwnPage(url, pages, platform = process.platform) {
  let u;
  try { u = new URL(String(url || '')); } catch { return false; }
  if (u.protocol !== 'file:' || (u.host && u.host !== 'localhost')) return false;
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  let file;
  try { file = fileURLToPath(u, { windows: win }); } catch { return false; }
  const norm = (x) => { const r = p.resolve(String(x)); return win ? r.toLowerCase() : r; };
  const target = norm(file);
  return (pages || []).some((page) => norm(page) === target);
}

/** پیوندی که به مرورگرِ سیستم سپرده می‌شود: فقط ‎http(s)‎ با میزبان — نه ‎file:‎، UNC یا پروتکلِ سفارشی */
export function externalUrlOk(url) {
  let u;
  try { u = new URL(String(url || '')); } catch { return false; }
  return (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname);
}

/** درخواستِ IPC از قابِ اصلیِ یکی از صفحه‌های خودِ برنامه؟ */
export function senderIsOwnPage(event, pages, platform = process.platform) {
  const frame = event?.senderFrame;
  if (!frame || frame.parent) return false;
  return isOwnPage(frame.url, pages, platform);
}

/** ⛔ ‎<webview>‎ ِ پنل: نه preload، نه Node، با جداسازی و sandbox — هر چه صفتِ تگ گفته باشد */
export function hardenWebviewPrefs(webPreferences) {
  if (!webPreferences || typeof webPreferences !== 'object') return webPreferences;
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.contextIsolation = true;
  webPreferences.sandbox = true;
  webPreferences.webviewTag = false;
  return webPreferences;
}

/**
 * نگهبان را روی یک پنجرهٔ پل‌دار می‌گذارد.
 * @param {{ webContents: any }} win
 * @param {{ pages: () => string[], openExternal: (url: string) => unknown, log?: (m: string) => void }} opts
 */
export function guardWindow(win, { pages, openExternal, log = () => {} }) {
  const wc = win.webContents;
  //  Electron ≥ ۲۵: نشانی روی خودِ رخداد است؛ آرگومانِ دوم همان نشانیِ قدیمی (منسوخ)
  const stay = (kind) => (event, legacyUrl) => {
    const url = event?.url ?? legacyUrl;
    if (isOwnPage(url, pages())) return;
    event?.preventDefault?.();
    log(`${kind} ِ پنجرهٔ برنامه به «${String(url || '').slice(0, 120)}» بسته شد — فقط صفحه‌های خودِ برنامه`);
  };
  wc.on('will-navigate', stay('ناوبری'));
  wc.on('will-redirect', stay('تغییرِ مسیر'));
  wc.setWindowOpenHandler(({ url }) => {
    if (externalUrlOk(url)) openExternal(url);
    else log(`بازکردنِ «${String(url || '').slice(0, 120)}» رد شد — مرورگرِ سیستم فقط http(s) می‌گیرد`);
    return { action: 'deny' };
  });
  wc.on('will-attach-webview', (_event, webPreferences) => { hardenWebviewPrefs(webPreferences); });
  return win;
}
