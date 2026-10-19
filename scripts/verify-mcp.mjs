import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const applicationIndex = process.argv.indexOf('--app')
if (applicationIndex !== -1 && !process.argv[applicationIndex + 1]) {
  throw new Error('Use --app seguido do caminho absoluto do executável instalado.')
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, payload) {
  const tag = Buffer.from(type)
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, payload])))
  return Buffer.concat([header, tag, payload, checksum])
}

// A real, decodable one-pixel RGBA PNG. Its encoded pixels must remain byte-identical.
const dimensions = Buffer.alloc(13)
dimensions.writeUInt32BE(1, 0)
dimensions.writeUInt32BE(1, 4)
dimensions[8] = 8
dimensions[9] = 6
const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const imageHeader = chunk('IHDR', dimensions)
const imageData = chunk('IDAT', deflateSync(Buffer.from([0, 220, 20, 60, 255])))
const imageEnd = chunk('IEND', Buffer.alloc(0))
const expectedClean = Buffer.concat([header, imageHeader, imageData, imageEnd])
const original = Buffer.concat([
  header, imageHeader, chunk('tEXt', Buffer.from('Comment\0MCP local private metadata')), imageData, imageEnd,
])

function data(response) {
  assert.equal(typeof response.structuredContent, 'object')
  assert.deepEqual(response.content, [{ type: 'text', text: JSON.stringify(response.structuredContent, null, 2) }])
  return response.structuredContent
}

async function verifyServer(configuration) {
  const directory = await mkdtemp(join(tmpdir(), 'cleanframe-mcp-'))
  const filePath = join(directory, 'photo;$(literal)&.png')
  const secondPath = join(directory, 'second.png')
  const invalidPath = join(directory, 'invalid.jpg')
  const missingPath = join(directory, 'missing.mp4')
  await writeFile(filePath, original)
  await writeFile(secondPath, original)
  await writeFile(invalidPath, Buffer.from('This is not a JPEG'))
  const client = new Client({ name: 'cleanframe-stdio-verifier', version: '1.0.0' })
  const transport = new StdioClientTransport({ ...configuration, cwd: root, stderr: 'pipe' })
  let diagnostic = ''
  transport.stderr?.on('data', (bytes) => { diagnostic += String(bytes).slice(0, 4000) })
  const protocolErrors = []
  client.onerror = (error) => { protocolErrors.push(error.message) }
  const call = (name, arguments_) => client.callTool({ name, arguments: arguments_ }, undefined, { timeout: 15_000 })
  try {
    await client.connect(transport, { timeout: 15_000 })
    const listed = await client.listTools()
    assert.deepEqual(listed.tools.map(({ name }) => name).sort(), [
      'inspect_metadata', 'remove_metadata', 'remove_metadata_batch', 'supported_formats',
    ])
    const formats = data(await call('supported_formats', {}))
    assert.ok(formats.extensions.includes('.png'))

    const inspected = data(await call('inspect_metadata', { path: filePath }))
    assert.equal(inspected.success, true)
    assert.ok(inspected.inspection.metadata.length > 0)
    assert.deepEqual(await readFile(filePath), original, 'Inspection must never change the original')

    const noConfirmation = await call('remove_metadata', { path: filePath })
    assert.equal(noConfirmation.isError, true)
    assert.deepEqual(await readFile(filePath), original, 'Missing authorization must never change the original')
    const invalidArgument = await call('inspect_metadata', { path: 'relative.png' })
    assert.equal(invalidArgument.isError, true)
    const incompatible = await call('remove_metadata', { path: invalidPath, confirmOverwrite: true })
    assert.equal(incompatible.isError, true)
    assert.equal(data(incompatible).success, false)
    assert.equal(await readFile(invalidPath, 'utf8'), 'This is not a JPEG')

    const cleaned = data(await call('remove_metadata', { path: filePath, confirmOverwrite: true }))
    assert.equal(cleaned.success, true)
    assert.equal(cleaned.result.status, 'cleaned')
    assert.equal(cleaned.result.path, await realpath(filePath))
    assert.ok(cleaned.result.removedCount > 0)
    assert.deepEqual(await readFile(filePath), expectedClean, 'Encoded pixels must remain identical')
    const inspectedAfter = data(await call('inspect_metadata', { path: filePath }))
    assert.deepEqual(inspectedAfter.inspection.metadata, [])
    const repeated = data(await call('remove_metadata', { path: filePath, confirmOverwrite: true }))
    assert.equal(repeated.result.status, 'already_clean')
    assert.equal(repeated.result.removedCount, 0)

    const batchResponse = await call('remove_metadata_batch', {
      paths: [missingPath, secondPath], confirmOverwrite: true,
    })
    assert.equal(batchResponse.isError, true)
    const batch = data(batchResponse)
    assert.equal(batch.success, false)
    assert.equal(batch.failed, 1)
    assert.equal(batch.succeeded, 1)
    assert.equal(batch.results[0].success, false)
    assert.equal(batch.results[1].result.status, 'cleaned')
    assert.deepEqual(await readFile(secondPath), expectedClean)
    assert.equal(data(await call('supported_formats', {})).success, true)
    assert.deepEqual((await readdir(directory)).sort(), [basename(filePath), basename(invalidPath), basename(secondPath)].sort())
    assert.deepEqual(protocolErrors, [], 'stdout must contain only valid MCP protocol messages')
  } catch (error) {
    throw new Error(`${configuration.label}: ${error.message}${diagnostic ? `\nServer stderr: ${diagnostic}` : ''}`, { cause: error })
  } finally {
    await client.close()
    // Only this test's freshly created temporary directory can be removed.
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()))
    assert.ok(basename(directory).startsWith('cleanframe-mcp-'))
    await rm(directory, { recursive: true, force: true })
  }
  console.log(`MCP stdio verificado: ${configuration.label}`)
}

await verifyServer({ label: 'Node bundle', command: process.execPath, args: [join(root, 'native-dist', 'mcp.cjs')] })
if (applicationIndex !== -1) {
  const executable = resolve(process.argv[applicationIndex + 1])
  const resources = process.platform === 'darwin'
    ? resolve(dirname(executable), '..', 'Resources')
    : join(dirname(executable), 'resources')
  await verifyServer({
    label: 'Aplicativo instalado em modo Node', command: executable,
    args: [join(resources, 'app.asar', 'mcp.cjs'), '--mcp'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  })
} else {
  await verifyServer({
    label: 'Electron em modo Node', command: require('electron'),
    args: [join(root, 'native-dist', 'mcp.cjs'), '--mcp'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  })
}
