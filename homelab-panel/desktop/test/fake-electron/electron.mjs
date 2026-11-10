// ---------------------------------------------------------------------------
//  جای‌گزینِ کوچکِ «electron» برای test/guards.mjs — فقط همان چند چیزی که
//  app/main-impl.js صدا می‌زند، و هر چه پروسهٔ اصلی با پنجره‌ها می‌کند ثبت می‌شود
//  تا آزمون همان رفتار را بی Electron بسنجد (پوشهٔ node_modules ِ برنامه لازم نیست).
//  ⚠️ پنل هرگز بالا نمی‌آید: نمونهٔ نخست پوشهٔ داده ندارد؛ نمونهٔ دوم (بخشِ ۸ ِ آزمون، ۱.۵۰.۸۵)
//  فقط یک «سرورِ» چندخطیِ ساختگی (‎/health‎) را اجرا می‌کند که آزمون پیش از پایان می‌بندد.
// ---------------------------------------------------------------------------
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const calls = {
  openExternal: [],
  openPath: [],
  handlers: new Map(),
  windows: [],
};

export const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-guards-'));

class WebContents extends EventEmitter {
  constructor() {
    super();
    this.windowOpenHandler = null;
    this.sent = [];
  }
  setWindowOpenHandler(fn) { this.windowOpenHandler = fn; }
  send(channel, payload) { this.sent.push([channel, payload]); }
}

export class BrowserWindow extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.webContents = new WebContents();
    this.destroyed = false;
    this.loaded = null;
    calls.windows.push(this);
  }
  loadFile(file) { this.loaded = file; return Promise.resolve(); }
  loadURL(url) { this.loaded = url; return Promise.resolve(); }
  isDestroyed() { return this.destroyed; }
  isMinimized() { return false; }
  isFullScreen() { return false; }
  setFullScreen() {}
  restore() {}
  focus() {}
  show() {}
  maximize() {}
  close() { this.destroyed = true; this.emit('closed'); }
  static fromWebContents(wc) { return calls.windows.find((w) => w.webContents === wc) || null; }
}

export const ipcMain = {
  handle(channel, fn) { calls.handlers.set(channel, fn); },
  on() {},
  off() {},
};

export const shell = {
  openExternal(url) { calls.openExternal.push(String(url)); return Promise.resolve(); },
  openPath(p) { calls.openPath.push(String(p)); return Promise.resolve(''); },
};

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
};

export const Menu = { setApplicationMenu() {} };

/** نشستِ ساختگی: گرداننده‌های اجازه فقط ثبت می‌شوند تا آزمون صدایشان بزند (۱.۵۰.۸۵) */
export class Session {
  constructor(name = 'default') {
    this.name = name;
    this.requestHandler = null;
    this.checkHandler = null;
    this.deviceHandler = null;
  }
  setPermissionRequestHandler(fn) { this.requestHandler = fn; }
  setPermissionCheckHandler(fn) { this.checkHandler = fn; }
  setDevicePermissionHandler(fn) { this.deviceHandler = fn; }
}
export const session = { defaultSession: new Session('default') };

export const app = Object.assign(new EventEmitter(), {
  isPackaged: false,
  getPath: (name) => (name === 'userData' || name === 'documents' ? userData : os.tmpdir()),
  getVersion: () => '0.0.0-guards',
  getAppPath: () => process.cwd(),
  requestSingleInstanceLock: () => true,
  whenReady: () => Promise.resolve(),
  setLoginItemSettings() {},
  relaunch() {},
  exit() {},
  quit() {},
});

export default { app, BrowserWindow, dialog, ipcMain, shell, Menu, session };
