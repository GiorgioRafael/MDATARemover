import { build } from 'esbuild'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { build as viteBuild } from 'vite'

await mkdir('native-dist', { recursive: true })
await build({
  entryPoints: { main: 'native/main.ts', mcp: 'native/mcp-entry.ts' },
  outdir: 'native-dist', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['electron'], sourcemap: false,
})
await copyFile('native/preload.cjs', 'native-dist/preload.cjs')
await copyFile('build/icon.png', 'native-dist/icon.png')
const rootPackage = JSON.parse(await readFile('package.json', 'utf8'))
await writeFile('native-dist/package.json', JSON.stringify({
  name: 'cleanframe-desktop', version: rootPackage.version,
  description: 'Removedor local de metadados de imagens e vídeos com MCP',
  author: 'GiorgioRafael', main: 'main.cjs', type: 'commonjs',
}, null, 2))
await viteBuild({ configFile: 'vite.desktop.config.ts' })
