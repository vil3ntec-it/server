// ---------------------------------------------------------------------------
//  پلِ امن بینِ پنجره و پروسهٔ اصلی
//  فقط همین چند کار از رابط کاربری قابلِ صدا زدن است — نه چیزِ بیشتری.
// ---------------------------------------------------------------------------
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cc', {
  getState: () => ipcRenderer.invoke('state'),
  getLogs: () => ipcRenderer.invoke('logs'),
  restart: () => ipcRenderer.invoke('restart'),
  openInBrowser: () => ipcRenderer.invoke('open-browser'),
  openDataFolder: () => ipcRenderer.invoke('open-data'),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),

  // ترمینال: داخلِ برنامه یا در پنجرهٔ خودش
  popOutTerminal: () => ipcRenderer.invoke('terminal-popout'),
  dockTerminal: () => ipcRenderer.invoke('terminal-dock'),
  terminalPlace: () => ipcRenderer.invoke('terminal-place'),
  toggleFullScreen: () => ipcRenderer.invoke('terminal-fullscreen'),
  focusMain: () => ipcRenderer.invoke('focus-main'),

  getUi: () => ipcRenderer.invoke('get-ui'),
  setUi: (patch) => ipcRenderer.invoke('set-ui', patch),

  setupNeeded: () => ipcRenderer.invoke('setup-needed'),
  defaultDataDir: () => ipcRenderer.invoke('default-data-dir'),
  chooseFolder: (current) => ipcRenderer.invoke('choose-folder', current),
  saveSetup: (dir) => ipcRenderer.invoke('save-setup', dir),

  onLog: (fn) => {
    const handler = (_e, entry) => fn(entry);
    ipcRenderer.on('log', handler);
    return () => ipcRenderer.off('log', handler);
  },
  onStatus: (fn) => {
    const handler = (_e, s) => fn(s);
    ipcRenderer.on('status', handler);
    return () => ipcRenderer.off('status', handler);
  },
  onTerminalPlace: (fn) => {
    const handler = (_e, place) => fn(place);
    ipcRenderer.on('terminal-place', handler);
    return () => ipcRenderer.off('terminal-place', handler);
  },
});
