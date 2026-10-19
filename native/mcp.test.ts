import { basename, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpServer, type McpEngine } from './mcp.js'

const path = resolve('test-photo.jpg')
const inspection = {
  path,
  name: basename(path),
  format: 'JPEG',
  kind: 'image' as const,
  size: 150,
  metadata: [{ label: 'GPSLatitude', value: '23' }],
  warnings: [],
}
const cleaned = {
  path,
  name: basename(path),
  format: 'JPEG',
  kind: 'image' as const,
  sizeBefore: 150,
  sizeAfter: 100,
  removedCount: 1,
  status: 'cleaned' as const,
  warnings: [],
}

const closeSessions: Array<() => Promise<void>> = []

async function session(overrides: Partial<McpEngine> = {}) {
  const engine: McpEngine = {
    inspectFile: vi.fn(async () => inspection),
    cleanFile: vi.fn(async () => cleaned),
    supportedExtensions: ['.jpg', '.mp4'],
    ...overrides,
  }
  const server = createMcpServer(engine)
  const client = new Client({ name: 'cleanframe-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  closeSessions.push(async () => {
    await client.close()
    await server.close()
  })
  return { client, engine }
}

afterEach(async () => {
  for (const close of closeSessions.splice(0)) await close()
})

describe('MCP local', () => {
  it('expõe somente as quatro ferramentas locais com indicações corretas de efeitos', async () => {
    const { client } = await session()
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'inspect_metadata', 'remove_metadata', 'remove_metadata_batch', 'supported_formats',
    ])
    for (const tool of tools) {
      const writes = tool.name.startsWith('remove_')
      expect(tool.annotations).toMatchObject({
        readOnlyHint: !writes,
        destructiveHint: writes,
        idempotentHint: true,
        openWorldHint: false,
      })
      if (writes) expect(tool.inputSchema.required).toContain('confirmOverwrite')
    }
  })

  it('retorna inspeção estruturada e texto equivalente sem chamar a limpeza', async () => {
    const { client, engine } = await session()
    const response = await client.callTool({ name: 'inspect_metadata', arguments: { path } })
    expect(response.isError).toBe(false)
    expect(response.structuredContent).toEqual({ success: true, inspection })
    expect(response.content).toEqual([{
      type: 'text', text: JSON.stringify(response.structuredContent, null, 2),
    }])
    expect(engine.inspectFile).toHaveBeenCalledWith(path)
    expect(engine.cleanFile).not.toHaveBeenCalled()
  })

  it('exige confirmação literal verdadeira antes de alterar o arquivo', async () => {
    const { client, engine } = await session()
    for (const arguments_ of [{ path }, { path, confirmOverwrite: false }]) {
      const response = await client.callTool({ name: 'remove_metadata', arguments: arguments_ })
      expect(response.isError).toBe(true)
    }
    expect(engine.cleanFile).not.toHaveBeenCalled()
    const response = await client.callTool({
      name: 'remove_metadata', arguments: { path, confirmOverwrite: true },
    })
    expect(response.structuredContent).toEqual({ success: true, result: cleaned })
    expect(response.isError).toBe(false)
    expect(engine.cleanFile).toHaveBeenCalledExactlyOnceWith(path)
  })

  it('recusa caminhos relativos, URLs e NUL sem quebrar a sessão', async () => {
    const { client, engine } = await session()
    for (const invalid of ['photo.jpg', 'https://example.com/photo.jpg', 'file:///tmp/photo.jpg', `${path}\0.jpg`]) {
      const response = await client.callTool({ name: 'inspect_metadata', arguments: { path: invalid } })
      expect(response.isError).toBe(true)
    }
    if (process.platform === 'win32') {
      const response = await client.callTool({ name: 'inspect_metadata', arguments: { path: '\\photo.jpg' } })
      expect(response.isError).toBe(true)
    }
    expect(engine.inspectFile).not.toHaveBeenCalled()
    const response = await client.callTool({ name: 'supported_formats', arguments: {} })
    expect(response.structuredContent).toMatchObject({ success: true, extensions: ['.jpg', '.mp4'] })
  })

  it('passa um caminho com caracteres de terminal como texto literal ao mecanismo', async () => {
    const unusualPath = resolve('photo;$(echo unsafe)&.jpg')
    const { client, engine } = await session()
    await client.callTool({ name: 'inspect_metadata', arguments: { path: unusualPath } })
    expect(engine.inspectFile).toHaveBeenCalledExactlyOnceWith(unusualPath)
  })

  it('retorna erros de arquivos ausentes ou incompatíveis e permite a próxima chamada', async () => {
    const inspectFile = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Arquivo não encontrado.'), { code: 'ENOENT' }))
      .mockRejectedValueOnce(new Error('Formato incompatível.'))
      .mockResolvedValueOnce(inspection)
    const { client } = await session({ inspectFile })
    const missing = await client.callTool({ name: 'inspect_metadata', arguments: { path } })
    expect(missing.isError).toBe(true)
    expect(missing.structuredContent).toEqual({
      success: false, path, error: { code: 'ENOENT', message: 'Arquivo não encontrado.' },
    })
    const incompatible = await client.callTool({ name: 'inspect_metadata', arguments: { path } })
    expect(incompatible.isError).toBe(true)
    expect(incompatible.structuredContent).toMatchObject({
      success: false, error: { code: 'PROCESSING_FAILED', message: 'Formato incompatível.' },
    })
    const success = await client.callTool({ name: 'inspect_metadata', arguments: { path } })
    expect(success.isError).toBe(false)
  })

  it('mantém resultados independentes no lote e continua após uma falha', async () => {
    const missingPath = resolve('missing.mp4')
    const lastPath = resolve('last.jpg')
    const cleanFile = vi.fn()
      .mockResolvedValueOnce(cleaned)
      .mockRejectedValueOnce(Object.assign(new Error('Arquivo não encontrado.'), { code: 'ENOENT' }))
      .mockResolvedValueOnce({ ...cleaned, path: lastPath, status: 'already_clean', removedCount: 0 })
    const { client } = await session({ cleanFile })
    const response = await client.callTool({
      name: 'remove_metadata_batch',
      arguments: { paths: [path, missingPath, lastPath], confirmOverwrite: true },
    })
    expect(response.isError).toBe(true)
    expect(response.structuredContent).toEqual({
      success: false,
      total: 3,
      succeeded: 2,
      failed: 1,
      results: [
        { success: true, path, result: cleaned },
        { success: false, path: missingPath, error: { code: 'ENOENT', message: 'Arquivo não encontrado.' } },
        { success: true, path: lastPath, result: { ...cleaned, path: lastPath, status: 'already_clean', removedCount: 0 } },
      ],
    })
    expect(cleanFile.mock.calls.map(([calledPath]) => calledPath)).toEqual([path, missingPath, lastPath])
  })

  it('recusa lote sem confirmação, vazio ou acima de 100 arquivos antes de qualquer alteração', async () => {
    const { client, engine } = await session()
    for (const arguments_ of [
      { paths: [path] },
      { paths: [], confirmOverwrite: true },
      { paths: Array.from({ length: 101 }, () => path), confirmOverwrite: true },
    ]) {
      const response = await client.callTool({ name: 'remove_metadata_batch', arguments: arguments_ })
      expect(response.isError).toBe(true)
    }
    expect(engine.cleanFile).not.toHaveBeenCalled()
  })
})
