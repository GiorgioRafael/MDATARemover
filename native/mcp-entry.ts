import { startMcpServer } from './mcp.js'

void startMcpServer().catch((error: unknown) => {
  process.stderr.write(`Falha ao iniciar o MCP local: ${error instanceof Error ? error.message : 'erro desconhecido'}\n`)
  process.exitCode = 1
})
