'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Renderer'a sadece bu yuzey acilir; dosya sistemi ve ag erisimi main tarafinda kalir.
contextBridge.exposeInMainWorld('subkill', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  saveCards: (cards) => ipcRenderer.invoke('cards:save', cards),

  upsertSubscription: (sub) => ipcRenderer.invoke('sub:upsert', sub),
  removeSubscription: (id) => ipcRenderer.invoke('sub:remove', id),

  gmailTest: (creds) => ipcRenderer.invoke('gmail:test', creds),
  gmailScan: (creds) => ipcRenderer.invoke('gmail:scan', creds),
  gmailApply: (records) => ipcRenderer.invoke('gmail:apply', records),
  hasGmailPassword: () => ipcRenderer.invoke('gmail:hasPassword'),

  scanUsage: () => ipcRenderer.invoke('usage:scan'),
  refreshRates: () => ipcRenderer.invoke('fx:refresh'),

  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  exportCsv: () => ipcRenderer.invoke('data:exportCsv'),
  importCsv: () => ipcRenderer.invoke('data:importCsv'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  dataPath: () => ipcRenderer.invoke('data:path'),

  onProgress: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('scan:progress', handler);
    return () => ipcRenderer.removeListener('scan:progress', handler);
  }
});
