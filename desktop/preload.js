const { contextBridge, ipcRenderer } = require('electron');

// The renderer gets one narrow capability instead of Node's `require`.
contextBridge.exposeInMainWorld('stealthDesktop', {
  compareAudits: (runIdA, runIdB) =>
    ipcRenderer.invoke('audit:compare', { runIdA, runIdB })
});
