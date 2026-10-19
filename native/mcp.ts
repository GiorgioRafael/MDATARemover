import { isAbsolute, win32 } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { cleanFile, inspectFile, SUPPORTED_EXTENSIONS } from './engine.js'

/** Injectable only to let protocol tests exercise failures without modifying files. */
export interface McpEngine {
  inspectFile: typeof inspectFile
  cleanFile: typeof cleanFile
  supportedExtensions: readonly string[]
}

const defaultEngine: McpEngine = {
  inspectFile,
  cleanFile,
  supportedExtensions: SUPPORTED_EXTENSIONS,
}

function isLocalAbsolutePath(value: string): boolean {
  if (value.includes('\0') || /^[a-z][a-z\d+.-]*:\/\//i.test(value)) return false
  if (!isAbsolute(value)) return false
  // A path such as \photo.jpg depends on the current drive on Windows.
  if (process.platform === 'win32') {
    const root = win32.parse(value).root
    return /^[a-z]:[\\/]$/i.test(root) || /^\\\\[^\\/]+[\\/][^\\/]+[\\/]$/.test(root)
  }
  return true
}

const absolutePath = z.string().min(1).refine(isLocalAbsolutePath, {
  message: 'Informe o caminho absoluto de um arquivo local, sem URL ou byte NUL.',
}).describe('Caminho absoluto do arquivo neste computador. Não aceita URLs.')

const confirmation = z.literal(true).describe(
  'Confirmação explícita de que o usuário autorizou sobrescrever este arquivo no próprio local.',
)

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
}

function errorDetails(error: unknown) {
  const code = error !== null && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' ? error.code : 'PROCESSING_FAILED'
  return {
    code,
    message: error instanceof Error ? error.message : 'Não foi possível processar o arquivo.',
  }
}

function result<T extends Record<string, unknown>>(data: T, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    isError,
  }
}

/** Creates an offline MCP server; importing this module never opens stdin or a GUI. */
export function createMcpServer(engine: McpEngine = defaultEngine): McpServer {
  const server = new McpServer({ name: 'cleanframe-local', version: '1.0.0' })

  server.registerTool('inspect_metadata', {
    title: 'Inspecionar metadados locais',
    description: 'Lê os metadados removíveis de uma imagem ou vídeo local sem alterar o arquivo.',
    inputSchema: { path: absolutePath },
    annotations: readAnnotations,
  }, async ({ path }) => {
    try {
      return result({ success: true, inspection: await engine.inspectFile(path) })
    } catch (error) {
      return result({ success: false, path, error: errorDetails(error) }, true)
    }
  })

  server.registerTool('remove_metadata', {
    title: 'Remover metadados do arquivo original',
    description: 'Remove metadados de uma imagem ou vídeo no próprio caminho. Sobrescreve o original; '
      + 'use apenas após autorização do usuário. Não gera uma nova imagem nem usa serviços externos. '
      + 'O resultado informa o estado verificado e eventuais avisos.',
    inputSchema: { path: absolutePath, confirmOverwrite: confirmation },
    annotations: writeAnnotations,
  }, async ({ path }) => {
    try {
      return result({ success: true, result: await engine.cleanFile(path) })
    } catch (error) {
      return result({ success: false, path, error: errorDetails(error) }, true)
    }
  })

  server.registerTool('remove_metadata_batch', {
    title: 'Remover metadados de vários arquivos originais',
    description: 'Processa de 1 a 100 caminhos locais, em sequência, sobrescrevendo cada original '
      + 'autorizado. Retorna um resultado independente por arquivo e continua após falhas. '
      + 'isError e success indicam se qualquer arquivo falhou; confira também cada resultado.',
    inputSchema: {
      paths: z.array(absolutePath).min(1).max(100).describe('Caminhos absolutos dos arquivos autorizados.'),
      confirmOverwrite: confirmation,
    },
    annotations: writeAnnotations,
  }, async ({ paths }) => {
    const results = []
    let succeeded = 0
    for (const path of paths) {
      try {
        results.push({ success: true, path, result: await engine.cleanFile(path) })
        succeeded += 1
      } catch (error) {
        results.push({ success: false, path, error: errorDetails(error) })
      }
    }
    const failed = paths.length - succeeded
    return result({ success: failed === 0, total: paths.length, succeeded, failed, results }, failed > 0)
  })

  server.registerTool('supported_formats', {
    title: 'Consultar formatos locais compatíveis',
    description: 'Lista as extensões aceitas pelo mecanismo local. A compatibilidade também depende '
      + 'do conteúdo real do arquivo; arquivos inválidos ou recursos não suportados geram erro.',
    inputSchema: {},
    annotations: readAnnotations,
  }, async () => result({
    success: true,
    extensions: [...engine.supportedExtensions],
    operation: 'in_place',
    localOnly: true,
  }))

  return server
}

/** stdio only: all protocol output is written by the MCP transport. */
export async function startMcpServer(): Promise<McpServer> {
  const server = createMcpServer()
  await server.connect(new StdioServerTransport())
  return server
}
