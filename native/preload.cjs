const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('cleanFrame', Object.freeze({
  pickFiles: () => ipcRenderer.invoke('cleanframe:pick'),
  inspectFiles: (paths) => ipcRenderer.invoke('cleanframe:inspect', paths),
  cleanFile: (path) => ipcRenderer.invoke('cleanframe:clean', path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  getMcpConfig: () => ipcRenderer.invoke('cleanframe:mcp-config'),
  copyText: (text) => ipcRenderer.invoke('cleanframe:copy', text),
}))
