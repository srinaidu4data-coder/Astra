const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron')
const fs = require('fs')
const path = require('path')

const isDev = !!process.env.VITE_DEV_SERVER_URL
const PROTOCOL = 'interviewpulse'
let mainWindow = null
let overlayWindow = null
/** Last non-maximized bounds so maximize/restore works cleanly */
let overlayRestoredBounds = null
let overlayBoundsSaveTimer = null

const OVERLAY_MIN_W = 320
const OVERLAY_MIN_H = 240
/** Tall detach default — full-height Speak (Hide chrome on in OverlayPage) */
const OVERLAY_DEFAULT_W = 520
const OVERLAY_DEFAULT_H = 960

function overlayStatePath() {
  return path.join(app.getPath('userData'), 'overlay-bounds.json')
}

function loadOverlayBounds() {
  try {
    const raw = fs.readFileSync(overlayStatePath(), 'utf8')
    const j = JSON.parse(raw)
    if (
      j &&
      typeof j.width === 'number' &&
      typeof j.height === 'number' &&
      typeof j.x === 'number' &&
      typeof j.y === 'number'
    ) {
      return j
    }
  } catch {
    /* first run / corrupt */
  }
  return null
}

function saveOverlayBounds(bounds) {
  try {
    fs.writeFileSync(overlayStatePath(), JSON.stringify(bounds), 'utf8')
  } catch (err) {
    console.warn('save overlay bounds failed:', err)
  }
}

function scheduleSaveOverlayBounds() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (overlayBoundsSaveTimer) clearTimeout(overlayBoundsSaveTimer)
  overlayBoundsSaveTimer = setTimeout(() => {
    overlayBoundsSaveTimer = null
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    if (overlayWindow.isMaximized()) return
    const b = overlayWindow.getBounds()
    overlayRestoredBounds = b
    saveOverlayBounds(b)
  }, 250)
}

function clampOverlayBounds(bounds) {
  const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay()
  const wa = display.workArea
  const width = Math.min(
    Math.max(OVERLAY_MIN_W, Math.round(bounds.width || OVERLAY_DEFAULT_W)),
    wa.width,
  )
  const height = Math.min(
    Math.max(OVERLAY_MIN_H, Math.round(bounds.height || OVERLAY_DEFAULT_H)),
    wa.height,
  )
  let x = Math.round(bounds.x ?? wa.x + wa.width - width - 40)
  let y = Math.round(bounds.y ?? wa.y + 60)
  // Keep at least 80px of the window on-screen
  x = Math.min(Math.max(wa.x - width + 80, x), wa.x + wa.width - 80)
  y = Math.min(Math.max(wa.y, y), wa.y + wa.height - 80)
  return { x, y, width, height }
}

function defaultOverlayBounds() {
  const display = screen.getPrimaryDisplay()
  const { width: sw, height: sh, x: sx, y: sy } = display.workArea
  const width = Math.min(OVERLAY_DEFAULT_W, sw - 40)
  // Tall: use most of the work area height (matches "Tall" preset)
  const height = Math.min(Math.max(OVERLAY_DEFAULT_H, Math.round(sh * 0.9)), sh - 40)
  return {
    width,
    height,
    x: sx + sw - width - 40,
    y: sy + 40,
  }
}

/** Named size presets relative to the display under the overlay (or primary). */
function overlayPresetBounds(preset, current) {
  const display =
    screen.getDisplayMatching(current || defaultOverlayBounds()) ||
    screen.getPrimaryDisplay()
  const wa = display.workArea
  const cx = (current?.x ?? wa.x) + (current?.width ?? OVERLAY_DEFAULT_W) / 2
  const cy = (current?.y ?? wa.y) + (current?.height ?? OVERLAY_DEFAULT_H) / 2

  const presets = {
    compact: { width: 380, height: 420 },
    medium: { width: 560, height: 700 },
    large: { width: 780, height: 900 },
    wide: { width: Math.min(1100, wa.width - 40), height: 640 },
    tall: { width: 520, height: Math.min(wa.height - 40, 1100) },
    max: { width: wa.width - 24, height: wa.height - 24 },
  }
  const size = presets[preset] || presets.medium
  const width = Math.min(Math.max(OVERLAY_MIN_W, size.width), wa.width)
  const height = Math.min(Math.max(OVERLAY_MIN_H, size.height), wa.height)
  // Keep center roughly stable when changing size
  let x = Math.round(cx - width / 2)
  let y = Math.round(cy - height / 2)
  return clampOverlayBounds({ x, y, width, height })
}

// Allow open-from-web: interviewpulse://open
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

/** Last live answer/levels snapshot for overlay bootstrap */
let lastLiveState = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  boot()
}

function boot() {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((a) => typeof a === 'string' && a.startsWith(`${PROTOCOL}://`))
    focusMainWindow(url)
  })

  // macOS open-url
  app.on('open-url', (event, url) => {
    event.preventDefault()
    focusMainWindow(url)
  })

  app.whenReady().then(() => {
    createMainWindow()
    registerShortcuts()

    // Windows: protocol may arrive as first-launch argv
    const coldStartUrl = process.argv.find(
      (a) => typeof a === 'string' && a.startsWith(`${PROTOCOL}://`),
    )
    if (coldStartUrl) {
      focusMainWindow(coldStartUrl)
    }

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

  registerIpc()
}

function focusMainWindow(deepLink) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    if (deepLink) {
      mainWindow.webContents.send('app:deep-link', deepLink)
    }
  } else if (app.isReady()) {
    createMainWindow()
  }
}

function applyContentProtection(win, enabled) {
  if (!win || win.isDestroyed()) return
  try {
    win.setContentProtection(enabled)
  } catch (err) {
    console.warn('setContentProtection failed:', err)
  }
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return
  }

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

  // Surface load errors (blank window is almost always a bad file:// asset path)
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[main] did-fail-load', code, desc, url)
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] render-process-gone', details)
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    // Packaged: electron/main.cjs lives next to dist/ inside app.asar
    const indexHtml = path.join(__dirname, '..', 'dist', 'index.html')
    mainWindow.loadFile(indexHtml).catch((err) => {
      console.error('[main] loadFile failed', indexHtml, err)
    })
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

function makeOverlayInteractive() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  try {
    // Click-through makes the window ignore all mouse input (can't drag/move).
    overlayWindow.setIgnoreMouseEvents(false)
    overlayWindow.setMovable(true)
    overlayWindow.setResizable(true)
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  } catch {
    /* ignore */
  }
}

function createOverlayWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    // Re-show: always restore interactivity so user can drag again
    makeOverlayInteractive()
    // If saved bounds put it off-screen, snap back
    try {
      const b = clampOverlayBounds(overlayWindow.getBounds())
      overlayWindow.setBounds(b, false)
    } catch {
      /* ignore */
    }
    overlayWindow.show()
    overlayWindow.focus()
    return
  }

  const saved = loadOverlayBounds()
  const bounds = clampOverlayBounds(saved || defaultOverlayBounds())
  overlayRestoredBounds = bounds

  // Transparent + frameless: keep thickFrame so Windows can still drag-resize edges.
  overlayWindow = new BrowserWindow({
    ...bounds,
    minWidth: OVERLAY_MIN_W,
    minHeight: OVERLAY_MIN_H,
    maxWidth: undefined,
    maxHeight: undefined,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    maximizable: true,
    minimizable: false,
    fullscreenable: true,
    skipTaskbar: true,
    hasShadow: true,
    thickFrame: true,
    // Must stay true — false + transparent often breaks -webkit-app-region drag on Windows
    movable: true,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Allow growing to any work-area size (Electron still enforces min*)
  try {
    const wa = screen.getPrimaryDisplay().workAreaSize
    overlayWindow.setMaximumSize(wa.width, wa.height)
  } catch {
    /* ignore */
  }

  const url = isDev
    ? `${process.env.VITE_DEV_SERVER_URL}/#/overlay`
    : `file://${path.join(__dirname, '../dist/index.html')}#/overlay`

  overlayWindow.loadURL(url)
  makeOverlayInteractive()
  applyContentProtection(overlayWindow, true)

  overlayWindow.once('ready-to-show', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      makeOverlayInteractive()
      overlayWindow.show()
      overlayWindow.focus()
      // Push last known answer immediately; also ask main window to re-publish
      if (lastLiveState) {
        try {
          overlayWindow.webContents.send('live:state', lastLiveState)
        } catch {
          /* ignore */
        }
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('live:request-publish')
        } catch {
          /* ignore */
        }
      }
    }
  })

  overlayWindow.on('resize', scheduleSaveOverlayBounds)
  overlayWindow.on('move', scheduleSaveOverlayBounds)
  overlayWindow.on('closed', () => {
    if (overlayBoundsSaveTimer) {
      clearTimeout(overlayBoundsSaveTimer)
      overlayBoundsSaveTimer = null
    }
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
      overlayWindow.webContents.send('overlay:toggle-click-through')
    }
  })
}

function registerIpc() {
  ipcMain.handle('stealth:set-content-protection', (_e, enabled) => {
    if (mainWindow) applyContentProtection(mainWindow, enabled)
    if (overlayWindow) applyContentProtection(overlayWindow, enabled)
    return { ok: true, enabled }
  })

  ipcMain.handle('overlay:open', () => {
    createOverlayWindow()
    // Ask main renderer to re-broadcast current answer for the overlay
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('live:request-publish')
      } catch {
        /* ignore */
      }
    }
    if (lastLiveState && overlayWindow && !overlayWindow.isDestroyed()) {
      try {
        overlayWindow.webContents.send('live:state', lastLiveState)
      } catch {
        /* ignore */
      }
    }
    return { ok: true }
  })

  /** Live answer bridge: main window publishes → overlay receives */
  ipcMain.handle('live:publish', (event, state) => {
    lastLiveState = state || null
    const senderId = event.sender.id
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      if (win.webContents.id === senderId) continue
      try {
        win.webContents.send('live:state', lastLiveState)
      } catch {
        /* ignore */
      }
    }
    return { ok: true }
  })

  ipcMain.handle('live:request', () => lastLiveState)

  ipcMain.handle('live:request-publish', (event) => {
    // Overlay asks main window to push latest zustand state
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.send('live:request-publish')
      } catch {
        /* ignore */
      }
    }
    // Also return cached state to the requester
    try {
      if (lastLiveState) {
        event.sender.send('live:state', lastLiveState)
      }
    } catch {
      /* ignore */
    }
    return { ok: true, hasState: Boolean(lastLiveState) }
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
      if (enabled) {
        // Pass-through: clicks go to apps below (cannot drag while this is on)
        overlayWindow.setIgnoreMouseEvents(true, { forward: true })
      } else {
        overlayWindow.setIgnoreMouseEvents(false)
        overlayWindow.setMovable(true)
      }
    }
    return { ok: true, clickThrough: Boolean(enabled) }
  })

  /** Move overlay by delta (renderer-driven drag — reliable on transparent Windows). */
  ipcMain.handle('overlay:move-by', (_e, delta) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return { ok: false }
    if (overlayWindow.isMaximized() || overlayWindow.isFullScreen()) {
      return { ok: false, reason: 'maximized' }
    }
    // Ensure we can receive / apply moves
    try {
      overlayWindow.setIgnoreMouseEvents(false)
    } catch {
      /* ignore */
    }
    const cur = overlayWindow.getBounds()
    const next = clampOverlayBounds({
      x: cur.x + (Number(delta?.x) || 0),
      y: cur.y + (Number(delta?.y) || 0),
      width: cur.width,
      height: cur.height,
    })
    overlayWindow.setBounds(next, false)
    overlayRestoredBounds = next
    scheduleSaveOverlayBounds()
    return { ok: true, ...next }
  })

  ipcMain.handle('overlay:reset-position', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return { ok: false }
    const next = clampOverlayBounds(defaultOverlayBounds())
    try {
      overlayWindow.setIgnoreMouseEvents(false)
      if (overlayWindow.isMaximized()) overlayWindow.unmaximize()
      if (overlayWindow.isFullScreen()) overlayWindow.setFullScreen(false)
    } catch {
      /* ignore */
    }
    overlayWindow.setBounds(next, true)
    overlayRestoredBounds = next
    saveOverlayBounds(next)
    overlayWindow.show()
    overlayWindow.focus()
    return { ok: true, ...next }
  })

  ipcMain.handle('overlay:set-always-on-top', (_e, enabled) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.setAlwaysOnTop(enabled, 'screen-saver')
    }
    return { ok: true }
  })

  ipcMain.handle('overlay:get-bounds', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return { ok: false }
    const b = overlayWindow.getBounds()
    return {
      ok: true,
      ...b,
      maximized: overlayWindow.isMaximized(),
      isFullScreen: overlayWindow.isFullScreen(),
    }
  })

  ipcMain.handle('overlay:set-bounds', (_e, partial) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return { ok: false }
    if (overlayWindow.isMaximized()) overlayWindow.unmaximize()
    if (overlayWindow.isFullScreen()) overlayWindow.setFullScreen(false)
    const cur = overlayWindow.getBounds()
    const next = clampOverlayBounds({
      x: partial?.x ?? cur.x,
      y: partial?.y ?? cur.y,
      width: partial?.width ?? cur.width,
      height: partial?.height ?? cur.height,
    })
    overlayWindow.setBounds(next, true)
    overlayRestoredBounds = next
    saveOverlayBounds(next)
    return { ok: true, ...next }
  })

  ipcMain.handle('overlay:resize-by', (_e, delta) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return { ok: false }
    if (overlayWindow.isMaximized()) overlayWindow.unmaximize()
    const cur = overlayWindow.getBounds()
    const next = clampOverlayBounds({
      x: cur.x,
      y: cur.y,
      width: cur.width + (Number(delta?.width) || 0),
      height: cur.height + (Number(delta?.height) || 0),
    })
    overlayWindow.setBounds(next, true)
    overlayRestoredBounds = next
    scheduleSaveOverlayBounds()
    return { ok: true, ...next }
  })

  ipcMain.handle('overlay:set-preset', (_e, preset) => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return { ok: false }
    if (overlayWindow.isMaximized()) overlayWindow.unmaximize()
    if (overlayWindow.isFullScreen()) overlayWindow.setFullScreen(false)
    const cur = overlayWindow.getBounds()
    if (preset === 'max') {
      // Fill the work area of the display the overlay is on
      const display = screen.getDisplayMatching(cur) || screen.getPrimaryDisplay()
      const wa = display.workArea
      const next = {
        x: wa.x + 12,
        y: wa.y + 12,
        width: wa.width - 24,
        height: wa.height - 24,
      }
      overlayWindow.setBounds(next, true)
      overlayRestoredBounds = next
      saveOverlayBounds(next)
      return { ok: true, preset, ...next }
    }
    const next = overlayPresetBounds(String(preset || 'medium'), cur)
    overlayWindow.setBounds(next, true)
    overlayRestoredBounds = next
    saveOverlayBounds(next)
    return { ok: true, preset, ...next }
  })

  ipcMain.handle('overlay:toggle-maximize', () => {
    if (!overlayWindow || overlayWindow.isDestroyed()) return { ok: false }
    if (overlayWindow.isFullScreen()) {
      overlayWindow.setFullScreen(false)
    }
    if (overlayWindow.isMaximized()) {
      overlayWindow.unmaximize()
      if (overlayRestoredBounds) {
        overlayWindow.setBounds(clampOverlayBounds(overlayRestoredBounds), true)
      }
      return { ok: true, maximized: false, ...overlayWindow.getBounds() }
    }
    overlayRestoredBounds = overlayWindow.getBounds()
    // Prefer work-area fill over OS maximize (cleaner with transparent frameless)
    const display =
      screen.getDisplayMatching(overlayRestoredBounds) || screen.getPrimaryDisplay()
    const wa = display.workArea
    overlayWindow.setBounds(
      { x: wa.x, y: wa.y, width: wa.width, height: wa.height },
      true,
    )
    return { ok: true, maximized: true, ...overlayWindow.getBounds() }
  })

  ipcMain.handle('app:platform', () => process.platform)
}
