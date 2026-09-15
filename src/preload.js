'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Renderer'a sadece bu yuzey acilir; dosya sistemi ve ag erisimi main tarafinda kalir.
contextBridge.exposeInMainWorld('subkill', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),

  upsertSubscription: (sub) => ipcRenderer.invoke('sub:upsert', sub),
  removeSubscription: (id) => ipcRenderer.invoke('sub:remove', id),
  resetSubscriptions: () => ipcRenderer.invoke('subs:reset'),

  mailProviders: () => ipcRenderer.invoke('mail:providers'),
  mailAccounts: () => ipcRenderer.invoke('mail:accounts'),
  mailAddAccount: (creds) => ipcRenderer.invoke('mail:addAccount', creds),
  mailRemoveAccount: (user) => ipcRenderer.invoke('mail:removeAccount', user),
  mailScan: (opts) => ipcRenderer.invoke('mail:scan', opts),
  mailApply: (payload) => ipcRenderer.invoke('mail:apply', payload),
  runAutoScan: () => ipcRenderer.invoke('autoscan:run'),

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
  },

  onAutoScan: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('autoscan:done', handler);
    return () => ipcRenderer.removeListener('autoscan:done', handler);
  }
});
