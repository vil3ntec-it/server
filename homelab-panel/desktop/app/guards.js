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
//    ۵) (۱.۵۰.۸۵) اجازه‌های مرورگر (میکروفون، دوربین، اعلان، مکان، کلیپ‌بورد، دستگاه…) — Electron
//       بی گرداننده **هر** درخواستی را بی‌پرسش می‌دهد. حالا فقط آن‌چه پنل واقعاً به‌کار می‌برد و فقط
//       از مبدأِ خودِ پنل (‎http://127.0.0.1:پورتِ همین اجرا‎): میکروفون برای پیامِ صوتیِ پشتیبانی
//       (فقط صدا — نه دوربین، نه صفحه)، نوشتن در کلیپ‌بورد (دکمه‌های «کپی») و تمام‌صفحهٔ ویدیو؛
//       صفحه‌های خودِ برنامه فقط نوشتن در کلیپ‌بورد (کپیِ لاگ). هر مبدأِ دیگر و هر اجازهٔ دیگر ⇒ رد.
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

/* ─────────────── ۵) اجازه‌های مرورگر (۱.۵۰.۸۵) ─────────────── */

/** آن‌چه پنل به‌کار می‌برد — `web/src`: ‎getUserMedia({audio:true})‎ (Support.tsx)، ‎clipboard.writeText‎، ‎<video controls>‎ */
export const PANEL_PERMISSIONS = Object.freeze(['media', 'clipboard-sanitized-write', 'fullscreen']);
/** shell.html/terminal.html — فقط «کپیِ لاگ» */
export const SHELL_PERMISSIONS = Object.freeze(['clipboard-sanitized-write']);

function originOf(url) {
  try {
    const u = new URL(String(url || ''));
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch { return null; }
}

/**
 * آیا این اجازه به این صفحه داده شود؟ خالص.
 * @param {{ permission: string, url: string, mediaTypes?: string[], mediaType?: string }} req
 *   ‎url‎: نشانیِ **قابی** که می‌خواهد (نه پنجرهٔ میزبان) — قابِ بیگانه درونِ پنل هم بیگانه است
 * @param {{ panelOrigin: string | null | (() => string | null), pages: () => string[], platform?: string }} o
 */
export function permissionAllowed({ permission, url, mediaTypes, mediaType }, { panelOrigin, pages, platform = process.platform }) {
  const panel = typeof panelOrigin === 'function' ? panelOrigin() : panelOrigin;
  const origin = originOf(url);
  if (panel && origin && origin === panel) {
    if (permission === 'media') {
      //  فقط میکروفون: ‎mediaTypes‎ در درخواست، ‎mediaType‎ در سنجش؛ «نامعلوم»/دوربین/صفحه ⇒ نه
      const types = Array.isArray(mediaTypes) ? mediaTypes : mediaType ? [mediaType] : [];
      return types.length > 0 && types.every((t) => t === 'audio');
    }
    return PANEL_PERMISSIONS.includes(permission);
  }
  if (isOwnPage(url, typeof pages === 'function' ? pages() : pages, platform)) return SHELL_PERMISSIONS.includes(permission);
  return false;
}

/**
 * گرداننده‌های اجازه را روی یک نشست می‌گذارد (درخواست، سنجش، دستگاه). همان قاعدهٔ `permissionAllowed`.
 * @param {any} ses نشستِ Electron
 * @param {{ panelOrigin: () => string | null, pages: () => string[], log?: (m: string) => void, platform?: string }} opts
 */
export function guardPermissions(ses, opts) {
  if (!ses || typeof ses.setPermissionRequestHandler !== 'function') return false;
  const { log = () => {} } = opts;
  const said = new Set();
  const denied = (permission, url) => {
    const key = `${permission} ${originOf(url) || String(url || '').slice(0, 60)}`;
    if (said.has(key) || said.size > 100) return;
    said.add(key);
    log(`اجازهٔ «${permission}» برای «${String(url || '؟').slice(0, 120)}» رد شد — فقط آن‌چه پنل به‌کار می‌برد، فقط از خودِ پنل`);
  };
  ses.setPermissionRequestHandler((_wc, permission, callback, details = {}) => {
    //  نشانیِ قابِ درخواست‌کننده؛ نبود ⇒ رد (نه نشانیِ پنجرهٔ میزبان)
    const url = details.requestingUrl || '';
    const ok = permissionAllowed({ permission, url, mediaTypes: details.mediaTypes }, opts);
    if (!ok) denied(permission, url);
    callback(ok);
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details = {}) => {
    //  سنجش گاهی فقط مبدأ دارد؛ برای صفحهٔ ‎file:‎ ِ خودِ برنامه (مبدأِ ‎file://‎) نشانیِ قابِ اصلی
    let url = details.requestingUrl || '';
    if (!url) url = /^file:/i.test(String(requestingOrigin || '')) && details.isMainFrame !== false ? wc?.getURL?.() || '' : requestingOrigin || '';
    return permissionAllowed({ permission, url, mediaType: details.mediaType }, opts);
  });
  //  WebHID/WebUSB/Serial/Bluetooth — پنل هیچ‌کدام را به‌کار نمی‌برد
  if (typeof ses.setDevicePermissionHandler === 'function') ses.setDevicePermissionHandler(() => false);
  return true;
}
