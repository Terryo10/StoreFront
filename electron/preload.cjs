// Preload runs sandboxed with contextIsolation. Only this narrow, typed API reaches the page;
// see src/services/bridge.ts for the matching TypeScript interface.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('posBridge', {
  isElectron: true,
  appInfo: () => ipcRenderer.invoke('app:info'),
  secureStore: {
    available: () => ipcRenderer.invoke('secure:available'),
    set: (key, value) => ipcRenderer.invoke('secure:set', key, value),
    get: (key) => ipcRenderer.invoke('secure:get', key),
    remove: (key) => ipcRenderer.invoke('secure:remove', key),
  },
  printer: {
    printRaw: (target, bytes) => ipcRenderer.invoke('printer:raw', target, bytes),
    openDrawer: (target) => ipcRenderer.invoke('printer:drawer', target),
  },
})
