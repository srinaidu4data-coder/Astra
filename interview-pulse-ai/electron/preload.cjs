const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('interviewPulse', {
  platform: () => ipcRenderer.invoke('app:platform'),
  setContentProtection: (enabled) =>
    ipcRenderer.invoke('stealth:set-content-protection', enabled),
  openOverlay: () => ipcRenderer.invoke('overlay:open'),
  closeOverlay: () => ipcRenderer.invoke('overlay:close'),
  setOverlayOpacity: (opacity) => ipcRenderer.invoke('overlay:set-opacity', opacity),
  setClickThrough: (enabled) => ipcRenderer.invoke('overlay:set-click-through', enabled),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('overlay:set-always-on-top', enabled),
  onToggleClickThrough: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('overlay:toggle-click-through', handler)
    return () => ipcRenderer.removeListener('overlay:toggle-click-through', handler)
  },
  onDeepLink: (cb) => {
    const handler = (_e, url) => cb(url)
    ipcRenderer.on('app:deep-link', handler)
    return () => ipcRenderer.removeListener('app:deep-link', handler)
  },
})
