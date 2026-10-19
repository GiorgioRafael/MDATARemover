#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argumentsList = process.argv.slice(2)
const supportedOptions = new Set(['--help', '-h', '--build-only', '--dry-run'])

function fail(message) {
  console.error(`\nNão foi possível instalar o CleanFrame: ${message}`)
  process.exit(1)
}

if (argumentsList.some((argument) => !supportedOptions.has(argument))) {
  fail('opção desconhecida. Use --help para ver as opções disponíveis.')
}

if (argumentsList.includes('--help') || argumentsList.includes('-h')) {
  console.log(`Instalação local do CleanFrame Desktop

Uso: npm run desktop:install -- [opções]

  --build-only  Compila e gera o instalador, sem abri-lo.
  --dry-run     Exibe o plano sem compilar, instalar ou alterar arquivos.
  --help        Exibe esta ajuda.

Requer Node.js 24 ou superior e dependências instaladas com npm ci.
Windows: gera e abre o instalador para o usuário atual.
macOS: gera e abre o DMG; arraste CleanFrame para Aplicativos.
Os pacotes desta instalação são gerados em release/local-install/.`)
  process.exit(0)
}

if (Number(process.versions.node.split('.')[0]) < 24) {
  fail('instale Node.js 24 ou superior em https://nodejs.org/en/download e tente novamente.')
}
if (!['win32', 'darwin'].includes(process.platform)) {
  fail('este instalador oferece suporte a Windows e macOS.')
}
if (!['x64', 'arm64'].includes(process.arch)) {
  fail(`a arquitetura ${process.arch} não é suportada. Use Node.js x64 ou arm64.`)
}

const buildOnly = argumentsList.includes('--build-only')
const dryRun = argumentsList.includes('--dry-run')
const rootPackage = JSON.parse(readFileSync(join(rootDirectory, 'package.json'), 'utf8'))
const platformName = process.platform === 'win32' ? 'win' : 'mac'
const extension = process.platform === 'win32' ? 'exe' : 'dmg'
const artifactName = `CleanFrame-${rootPackage.version}-${platformName}-${process.arch}.${extension}`
const installerPath = join(rootDirectory, 'release', 'local-install', artifactName)
const builderPath = join(rootDirectory, 'node_modules', 'electron-builder', 'cli.js')
const builderArguments = [
  builderPath,
  process.platform === 'win32' ? '--win' : '--mac',
  process.platform === 'win32' ? 'nsis' : 'dmg',
  `--${process.arch}`,
  '--config.directories.output=release/local-install',
  '--publish', 'never',
]

console.log(`CleanFrame ${rootPackage.version} — ${platformName} ${process.arch}`)
console.log(`Pasta do projeto: ${rootDirectory}`)
console.log(`Instalador: ${installerPath}`)

if (dryRun) {
  console.log('\nPlano (nenhum arquivo será alterado):')
  console.log('1. npm run desktop:build')
  console.log(`2. electron-builder ${builderArguments.slice(1).join(' ')}`)
  console.log(buildOnly
    ? '3. Verificar o instalador gerado; não abri-lo.'
    : process.platform === 'win32'
      ? '3. Verificar e abrir o instalador do usuário atual.'
      : '3. Verificar e abrir o DMG; arrastar CleanFrame para Aplicativos.')
  process.exit(0)
}

function findNpmCli() {
  const nodeDirectory = dirname(process.execPath)
  const candidates = [
    process.env.npm_execpath,
    join(nodeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDirectory, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  const npmCli = candidates.find((candidate) => candidate && existsSync(candidate))
  if (!npmCli) {
    fail('não encontrei o npm. Reinstale o Node.js com npm e execute npm run desktop:install.')
  }
  return npmCli
}

function run(command, args, description, options = {}) {
  console.log(`\n${description}`)
  const result = spawnSync(command, args, {
    cwd: rootDirectory,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    ...options,
  })
  if (result.error) fail(`${description}: ${result.error.message}`)
  if (result.signal) fail(`${description} foi interrompido (${result.signal}).`)
  if (result.status !== 0) {
    console.error(`\n${description} falhou (código ${result.status}).`)
    console.error('Se o CleanFrame estiver aberto nesta pasta, feche-o, aguarde alguns segundos e tente novamente.')
    process.exit(result.status > 0 && result.status <= 255 ? result.status : 1)
  }
}

const npmCli = findNpmCli()
if (!existsSync(builderPath)) {
  fail('faltam dependências. Execute npm ci ou abra o arquivo Instalar da sua plataforma.')
}

run(process.execPath, [npmCli, 'run', 'desktop:build'], 'Compilando o aplicativo…')
const packagingStartedAt = Date.now()
run(process.execPath, builderArguments, 'Gerando o instalador…')

let installerStats
try {
  installerStats = statSync(installerPath)
} catch {
  fail(`o empacotamento terminou, mas não gerou o instalador esperado: ${installerPath}`)
}
if (!installerStats.isFile() || installerStats.size === 0 || installerStats.mtimeMs < packagingStartedAt - 2000) {
  fail(`o instalador esperado não foi atualizado nesta compilação: ${installerPath}`)
}

console.log(`\nInstalador gerado: ${installerPath}`)
if (buildOnly) process.exit(0)

if (process.platform === 'win32') {
  run(installerPath, [], 'Abrindo o instalador do CleanFrame…', { windowsHide: false })
  console.log('\nO instalador foi encerrado. Se concluiu a instalação, abra CleanFrame no menu Iniciar.')
} else {
  run('/usr/bin/open', [installerPath], 'Abrindo a imagem de instalação…')
  console.log('\nNa janela do DMG, arraste CleanFrame para Aplicativos. Depois, abra-o por Aplicativos.')
}
