const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  autosave: {
    save: (data) => ipcRenderer.invoke('autosave:save', data),
    saveSync: (data) => ipcRenderer.sendSync('autosave:saveSync', data),
    load: () => ipcRenderer.invoke('autosave:load'),
    clear: () => ipcRenderer.invoke('autosave:clear'),
  },
  files: {
    openImages: () => ipcRenderer.invoke('files:openImages'),
    selectDirectory: () => ipcRenderer.invoke('files:selectDirectory'),
    readImageAsBase64: (filePath) => ipcRenderer.invoke('files:readImageAsBase64', filePath),
    saveProcessedImage: (args) => ipcRenderer.invoke('files:saveProcessedImage', args),
    exportToProfile: (args) => ipcRenderer.invoke('files:exportToProfile', args),
    downloadFromUrl: (url) => ipcRenderer.invoke('files:downloadFromUrl', url),
  },
  usage: {
      get: () => ipcRenderer.invoke('usage:get'),
      reset: () => ipcRenderer.invoke('usage:reset'),
    },
    settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
  },
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
    onUpdateAvailable: (callback) => ipcRenderer.on('updater:updateAvailable', (_event, info) => callback(info)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('updater:updateDownloaded', (_event, info) => callback(info)),
    installUpdate: () => ipcRenderer.invoke('updater:installUpdate'),
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getAppPath: () => ipcRenderer.invoke('app:getAppPath'),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },
  image: {
    removeBg: (base64) => ipcRenderer.invoke('image:removeBg', base64),
    removeBgChroma: (args) => ipcRenderer.invoke('image:removeBgChroma', args),
    removeWhiteBg: (base64) => ipcRenderer.invoke('image:removeWhiteBg', base64),
    detectMode: (args) => ipcRenderer.invoke('image:detectMode', args),
  },
  sankhya: {
    getGroups: (args) => ipcRenderer.invoke('sankhya:getGroups', args),
    getProductImage: (args) => ipcRenderer.invoke('sankhya:getProductImage', args),
    query: (args) => ipcRenderer.invoke('sankhya:query', args),
    saveDescription: (args) => ipcRenderer.invoke('sankhya:saveDescription', args),
    markMarketingValidated: (args) => ipcRenderer.invoke('sankhya:markMarketingValidated', args),
    saveAlternativeImages: (args) => ipcRenderer.invoke('sankhya:saveAlternativeImages', args),
    uploadImagesFTP: (args) => ipcRenderer.invoke('sankhya:uploadImagesFTP', args),
    uploadMainImage: (args) => ipcRenderer.invoke('sankhya:uploadMainImage', args),
    onQueueOpen: (callback) => ipcRenderer.on('queue:open', (_event, skus) => callback(skus)),
    getPendingQueue: () => ipcRenderer.invoke('queue:getPending'),
    checkQueueNow: () => ipcRenderer.invoke('queue:checkNow'),
    clearPendingQueue: () => ipcRenderer.invoke('queue:clearPending')
  },
  gemini: {
    rewrite: (args) => ipcRenderer.invoke('gemini:rewrite', args),
    autoEnhance: (args) => ipcRenderer.invoke('gemini:auto-enhance', args),
    inpaint: (args) => ipcRenderer.invoke('gemini:inpaint', args),
    upscale: (args) => ipcRenderer.invoke('gemini:upscale', args),
    extractSkus: (args) => ipcRenderer.invoke('gemini:extractSkus', args),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
  search: {
    googleLens: (args) => ipcRenderer.invoke('search:googleLens', args),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
    writeImage: (imageBase64) => ipcRenderer.invoke('clipboard:writeImage', imageBase64),
    readImage: () => ipcRenderer.invoke('clipboard:readImage'),
  }
});
