const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron')
const path = require('path')

const isDev = !!process.env.VITE_DEV_SERVER_URL
let mainWindow = null
let overlayWindow = null

function applyContentProtection(win, enabled) {
  if (!win || win.isDestroyed()) return
  try {
    win.setContentProtection(enabled)
  } catch (err) {
    console.warn('setContentProtection failed:', err)
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0B0F17',
    title: 'InterviewPulse AI',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close()
    }
  })
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show()
    return
  }

  const display = screen.getPrimaryDisplay()
  const { width } = display.workAreaSize

  overlayWindow = new BrowserWindow({
    width: 520,
    height: 640,
    x: width - 560,
    y: 80,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  const url = isDev
    ? `${process.env.VITE_DEV_SERVER_URL}/#/overlay`
    : `file://${path.join(__dirname, '../dist/index.html')}#/overlay`

  overlayWindow.loadURL(url)
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  applyContentProtection(overlayWindow, true)

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+S', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      createOverlayWindow()
      return
    }
    if (overlayWindow.isVisible()) {
      overlayWindow.hide()
    } else {
      overlayWindow.show()
    }
  })

  globalShortcut.register('CommandOrControl+Shift+C', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      const clickThrough = !overlayWindow.isIgnoreMouseEvents()
      // toggle is handled via IPC state; here just flip ignore
      overlayWindow.webContents.send('overlay:toggle-click-through')
    }
  })
}

app.whenReady().then(() => {
  createMainWindow()
  registerShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// IPC
ipcMain.handle('stealth:set-content-protection', (_e, enabled) => {
  if (mainWindow) applyContentProtection(mainWindow, enabled)
  if (overlayWindow) applyContentProtection(overlayWindow, enabled)
  return { ok: true, enabled }
})

ipcMain.handle('overlay:open', () => {
  createOverlayWindow()
  return { ok: true }
})

ipcMain.handle('overlay:close', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
  return { ok: true }
})

ipcMain.handle('overlay:set-opacity', (_e, opacity) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setOpacity(Math.min(1, Math.max(0.2, opacity)))
  }
  return { ok: true }
})

ipcMain.handle('overlay:set-click-through', (_e, enabled) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setIgnoreMouseEvents(enabled, { forward: true })
  }
  return { ok: true }
})

ipcMain.handle('overlay:set-always-on-top', (_e, enabled) => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setAlwaysOnTop(enabled, 'screen-saver')
  }
  return { ok: true }
})

ipcMain.handle('app:platform', () => process.platform)
