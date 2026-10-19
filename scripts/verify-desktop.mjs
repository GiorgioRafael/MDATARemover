import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

// End-to-end check: real Electron, real preload/IPC and disposable disk files.
const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(path.join(tmpdir(), 'cleanframe-desktop-'))
const fixture = path.join(directory, 'foto-com-metadados.png')
function chunk(type, data) {
  const name = Buffer.from(type)
  const bytes = Buffer.concat([name, data])
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const header = Buffer.alloc(4), footer = Buffer.alloc(4)
  header.writeUInt32BE(data.length); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([header, bytes, footer])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const pixels = chunk('IDAT', deflateSync(Buffer.from([0, 20, 150, 80, 255])))
const clean = Buffer.concat([signature, chunk('IHDR', header), pixels, chunk('IEND', Buffer.alloc(0))])
const original = Buffer.concat([signature, chunk('IHDR', header), chunk('tEXt', Buffer.from('Author\0Pessoa de teste')), pixels, chunk('IEND', Buffer.alloc(0))])
await writeFile(fixture, original)
const executableIndex = process.argv.indexOf('--app')
const packagedExecutable = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : undefined
const app = await electron.launch({
  ...(packagedExecutable ? { executablePath: packagedExecutable } : {}),
  args: packagedExecutable ? [] : [path.join(root, 'native-dist', 'main.cjs')],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  timeout: 60_000,
})
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await expect(page.getByRole('heading', { name: /metadados/i }).first()).toBeVisible()
  await expect(page.getByText('100% local', { exact: true })).toBeVisible()
  await page.screenshot({ path: path.join(directory, 'desktop-inicial.png') })
  // Replace only the OS chooser, keeping the complete application IPC path real.
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, fixture)
  await page.getByRole('button', { name: 'Selecionar arquivos', exact: true }).click()
  await expect(page.getByText('foto-com-metadados.png', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(fixture, { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: /Remover metadados/ }).click()
  await expect(page.getByText('Metadados removidos', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
  expect(await readFile(fixture)).toEqual(clean)
  await page.screenshot({ path: path.join(directory, 'desktop-concluido.png') })
  await page.getByRole('button', { name: 'Conectar MCP', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copiar configuração' })).toBeVisible()
  const config = JSON.parse(await page.getByLabel('Configuração do servidor MCP').innerText())
  expect(config.mcpServers.cleanframe.args).toContain('--mcp')
  await page.getByRole('button', { name: 'Copiar configuração' }).click()
  await expect(page.getByRole('button', { name: 'Configuração copiada' })).toBeVisible()
  await page.getByRole('button', { name: 'Fechar configuração MCP' }).click()
  await page.getByRole('button', { name: 'Limpar lista', exact: true }).click()
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'; input.id = 'qa-local-input'; input.hidden = true
    document.body.append(input)
  })
  await page.locator('#qa-local-input').setInputFiles(fixture)
  await page.evaluate(() => {
    const input = document.querySelector('#qa-local-input')
    const transfer = new DataTransfer()
    transfer.items.add(input.files[0])
    document.querySelector('.cf-dropzone').dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: transfer,
    }))
    input.remove()
  })
  await expect(page.getByText(fixture, { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: /Remover metadados/ }).click()
  await expect(page.getByText('Já estava limpo', { exact: true }).first()).toBeVisible()
  expect(await readFile(fixture)).toEqual(clean)
  await page.setViewportSize({ width: 680, height: 760 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: path.join(directory, 'desktop-compacto.png'), fullPage: true })
  expect(errors).toEqual([])
  console.log(JSON.stringify({ verified: true, environment: packagedExecutable ? 'packaged Electron' : 'development Electron', fixture, screenshots: directory, checks: ['initial UI', 'real file path', 'in-place write', 'unchanged compressed pixels', 'MCP config and clipboard', 'drop with disk-backed File', 'idempotent cleaning', 'compact width', 'no renderer or console errors'] }, null, 2))
} finally {
  await app.close()
}
