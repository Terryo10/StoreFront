// Electron main process. Kept as plain CommonJS so it runs without a build step.
const { app, BrowserWindow, ipcMain, safeStorage, Menu, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const net = require('node:net')
const { pathToFileURL } = require('node:url')

const DEV_URL = process.env.VITE_DEV_SERVER_URL
const isDev = !!DEV_URL

// One till app per machine: a second instance would fight over IndexedDB and the printer.
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

let win = null

function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#eceeed',
    title: 'Till',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  // Removing the menu frees F10/Alt for till shortcuts.
  Menu.setApplicationMenu(null)
  win.once('ready-to-show', () => win.show())

  if (isDev) {
    win.loadURL(DEV_URL)
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools()
    })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  // Never navigate the till window away from the app; open external links in the OS browser.
  win.webContents.on('will-navigate', (e, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith(APP_FILE_URL)
    if (!allowed) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* ---------- IPC: only the till's own page may call these ---------- */

const APP_FILE_URL = pathToFileURL(path.join(__dirname, '..', 'dist') + path.sep).href

function trustedSender(event) {
  const url = event.senderFrame?.url ?? ''
  return isDev ? url.startsWith(DEV_URL) : url.startsWith(APP_FILE_URL)
}

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trustedSender(event)) throw new Error('Untrusted IPC sender')
    return fn(...args)
  })
}

/* ---------- Secure token storage (OS-level encryption via safeStorage) ---------- */

const secretsDir = () => path.join(app.getPath('userData'), 'secrets')
const secretFile = (key) => path.join(secretsDir(), `${key.replace(/[^a-z0-9-]/gi, '_')}.bin`)

handle('secure:available', () => safeStorage.isEncryptionAvailable())

handle('secure:set', (key, value) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is not available')
  if (typeof key !== 'string' || typeof value !== 'string') throw new Error('Invalid arguments')
  fs.mkdirSync(secretsDir(), { recursive: true })
  fs.writeFileSync(secretFile(key), safeStorage.encryptString(value), { mode: 0o600 })
})

handle('secure:get', (key) => {
  try {
    const buf = fs.readFileSync(secretFile(String(key)))
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
})

handle('secure:remove', (key) => {
  try {
    fs.unlinkSync(secretFile(String(key)))
  } catch {
    /* already gone */
  }
})

/* ---------- ESC/POS printing ---------- */

const PRINT_TIMEOUT_MS = 6000

function sendNetwork(host, port, bytes) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(PRINT_TIMEOUT_MS)
    socket.once('timeout', () => done({ ok: false, error: `Printer at ${host}:${port} did not respond` }))
    socket.once('error', (err) => done({ ok: false, error: `Printer at ${host}:${port}: ${err.message}` }))
    socket.connect(port, host, () => {
      socket.write(Buffer.from(bytes), (err) => {
        if (err) return done({ ok: false, error: err.message })
        socket.end(() => done({ ok: true, detail: `Sent ${bytes.length} bytes to ${host}:${port}` }))
      })
    })
  })
}

// The renderer chooses the target, so only printer-like devices are accepted. Anything else
// would let a compromised page write arbitrary files or reach arbitrary LAN services.
const DEVICE_PATTERNS = [/^\/dev\/usb\/lp\d+$/, /^\/dev\/lp\d+$/, /^\/dev\/tty(USB|ACM|S)\d+$/, /^\/dev\/cu\.[\w.-]+$/, /^(\\\\\.\\)?(COM|LPT)\d+$/i]
const RAW_PRINT_PORTS = { min: 9100, max: 9109 }
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$|^\[?[0-9a-f:]+\]?$/i

function sendDevice(devicePath, bytes) {
  if (!DEVICE_PATTERNS.some((re) => re.test(devicePath))) {
    return Promise.resolve({ ok: false, error: `${devicePath} is not a supported printer device (use /dev/usb/lp0, /dev/ttyUSB0, COM3 or LPT1)` })
  }
  return new Promise((resolve) => {
    // r+ never creates or truncates a file, so only an existing device node can be written.
    fs.open(devicePath, 'r+', (openErr, fd) => {
      if (openErr) return resolve({ ok: false, error: `Could not open ${devicePath}: ${openErr.message}` })
      fs.write(fd, Buffer.from(bytes), (err) => {
        fs.close(fd, () => {})
        if (err) resolve({ ok: false, error: `Could not write to ${devicePath}: ${err.message}` })
        else resolve({ ok: true, detail: `Sent ${bytes.length} bytes to ${devicePath}` })
      })
    })
  })
}

function mockPrint(bytes) {
  const dir = path.join(app.getPath('userData'), 'mock-printer')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${Date.now()}.bin`)
  fs.writeFileSync(file, Buffer.from(bytes))
  return { ok: true, detail: `Mock printer wrote ${file}` }
}

function validateBytes(bytes) {
  if (!Array.isArray(bytes) || bytes.length > 512 * 1024 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    throw new Error('Invalid print data')
  }
}

async function dispatch(target, bytes) {
  validateBytes(bytes)
  if (!target || typeof target !== 'object') return { ok: false, error: 'No printer configured' }
  if (target.kind === 'network') {
    const host = String(target.host ?? '').trim()
    const port = Number(target.port) || 9100
    if (!host) return { ok: false, error: 'Printer IP address is missing' }
    if (!HOST_PATTERN.test(host)) return { ok: false, error: `${host} is not a valid printer address` }
    if (!Number.isInteger(port) || port < RAW_PRINT_PORTS.min || port > RAW_PRINT_PORTS.max) {
      return { ok: false, error: `Port ${port} is not a raw printing port (use ${RAW_PRINT_PORTS.min} to ${RAW_PRINT_PORTS.max})` }
    }
    return sendNetwork(host, port, bytes)
  }
  if (target.kind === 'device') {
    if (!target.devicePath) return { ok: false, error: 'Printer device path is missing' }
    return sendDevice(String(target.devicePath), bytes)
  }
  return mockPrint(bytes)
}

handle('printer:raw', async (target, bytes) => {
  try {
    return await dispatch(target, bytes)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

handle('printer:drawer', async (target) => {
  try {
    return await dispatch(target, [0x1b, 0x70, 0x00, 0x19, 0xfa])
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
})

handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  userData: app.getPath('userData'),
  safeStorage: safeStorage.isEncryptionAvailable(),
}))
