import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session } from 'electron'
import path from 'node:path'
import { inspectFile, cleanFile } from './engine.js'

let window: BrowserWindow | null = null
let operations = 0
const grantedPaths = new Set<string>()

const assertSender = (event: Electron.IpcMainInvokeEvent) => {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Origem da solicitação não autorizada.')
  }
}

const inspectPaths = async (paths: unknown) => {
  if (!Array.isArray(paths) || !paths.length || paths.length > 100 || paths.some((item) => typeof item !== 'string')) {
    throw new Error('Selecione entre 1 e 100 arquivos locais.')
  }
  const results = []
  for (const filePath of paths as string[]) {
    try {
      const inspection = await inspectFile(filePath)
      grantedPaths.add(inspection.path)
      results.push(inspection)
    } catch (error) {
      results.push({ path: filePath, error: error instanceof Error ? error.message : 'Não foi possível ler o arquivo.' })
    }
  }
  return results
}

ipcMain.handle('cleanframe:pick', async (event) => {
  assertSender(event)
  const selection = await dialog.showOpenDialog(window!, {
    title: 'Escolha imagens ou vídeos',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Imagens e vídeos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'mov', 'm4v'] }],
  })
  return selection.canceled ? [] : inspectPaths(selection.filePaths)
})
ipcMain.handle('cleanframe:inspect', async (event, paths: unknown) => {
  assertSender(event)
  return inspectPaths(paths)
})
ipcMain.handle('cleanframe:clean', async (event, filePath: unknown) => {
  assertSender(event)
  if (typeof filePath !== 'string' || !grantedPaths.has(filePath)) throw new Error('Selecione e inspecione o arquivo antes de limpar.')
  operations++
  try { return await cleanFile(filePath) }
  finally { operations-- }
})
ipcMain.handle('cleanframe:mcp-config', (event) => {
  assertSender(event)
  // Node mode exposes reliable stdio on Windows and avoids starting Chromium.
  const entry = path.join(__dirname, 'mcp.cjs')
  return { command: process.execPath, args: [entry, '--mcp'], env: { ELECTRON_RUN_AS_NODE: '1' } }
})
ipcMain.handle('cleanframe:copy', (event, text: unknown) => {
  assertSender(event)
  if (typeof text !== 'string' || text.length > 64_000) throw new Error('Texto inválido.')
  clipboard.writeText(text)
})

const createWindow = () => {
  window = new BrowserWindow({
    width: 1080, height: 820, minWidth: 660, minHeight: 650,
    title: 'CleanFrame', backgroundColor: '#ffffff', show: false,
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, spellcheck: false,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.once('ready-to-show', () => window?.show())
  window.on('close', (event) => {
    if (operations > 0) {
      event.preventDefault()
      void dialog.showMessageBox(window!, { type: 'info', message: 'Aguarde a limpeza terminar para fechar o CleanFrame.', buttons: ['Entendi'] })
    }
  })
  window.on('closed', () => { window = null; grantedPaths.clear() })
  void window.loadFile(path.join(__dirname, 'renderer/desktop.html'))
}

app.whenReady().then(() => {
  // The desktop app never contacts a network service, including for fonts.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !['file:', 'devtools:', 'data:', 'blob:'].includes(new URL(details.url).protocol) })
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([
    { label: 'CleanFrame', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' }, { role: 'windowMenu' },
  ]) : null)
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`)
  app.exit(1)
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
