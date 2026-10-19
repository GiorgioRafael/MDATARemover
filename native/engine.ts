import { constants } from 'node:fs'
import { access, chmod, lstat, open, realpath, rename, unlink } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { analyzeVideoContainer, type VideoSource } from '../src/lib/videoProcessing.js'
import { planImage, type ImagePlan } from './images.js'

export const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.m4v'] as const
export interface Inspection {
  path: string
  name: string
  format: string
  kind: 'image' | 'video'
  size: number
  metadata: Array<{ label: string; value: string }>
  warnings: string[]
}
export interface CleanResult {
  path: string
  name: string
  format: string
  kind: 'image' | 'video'
  sizeBefore: number
  sizeAfter: number
  removedCount: number
  status: 'cleaned' | 'already_clean'
  warnings: string[]
}
const IMAGE_LIMIT = 256 * 1024 * 1024
const VIDEO_WARNING = 'A limpeza remove metadados do contêiner. Dados dentro dos fluxos codificados (como SEI), conteúdo visível e datas do sistema de arquivos permanecem.'
const IMAGE_WARNING = 'Orientação, parâmetros de renderização e dados comprimidos são preservados. Conteúdo visível e datas do sistema de arquivos permanecem.'
const active = new Set<string>()
const same = (a: BigIntStats, b: BigIntStats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode && a.nlink === b.nlink
const changed = () => new Error('O arquivo foi alterado por outro programa durante a operação. Tente novamente. O original não foi substituído.')

async function targetPath(input: string) {
  if (typeof input !== 'string' || !input || input.includes('\0') || !isAbsolute(input)) throw new Error('Informe o caminho absoluto de um arquivo local.')
  const extension = extname(input).toLowerCase()
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(extension)) throw new Error('Formato não suportado. Use JPG, JPEG, PNG, WEBP, MP4, MOV ou M4V.')
  // Canonicalize the parent so aliases cannot acquire different locks for one file.
  const path = join(await realpath(dirname(resolve(input))), basename(input))
  return { path, extension, key: process.platform === 'win32' ? path.toLowerCase() : path }
}
async function snapshot(path: string) {
  const stat = await lstat(path, { bigint: true })
  if (stat.isSymbolicLink()) throw new Error('Links simbólicos não são aceitos. Escolha o arquivo original.')
  if (!stat.isFile()) throw new Error('Escolha um arquivo comum local.')
  if (stat.nlink !== 1n) throw new Error('Arquivos com hard links não são aceitos. Escolha um arquivo com um único caminho.')
  if (stat.size === 0n || stat.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('O arquivo está vazio ou excede o limite de tamanho.')
  return stat
}
async function openSource(path: string, expected: BigIntStats) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    if (!same(expected, await handle.stat({ bigint: true }))) throw changed()
    return handle
  } catch (error) { await handle.close(); throw error }
}
async function assertUnchanged(path: string, expected: BigIntStats, handle?: FileHandle) {
  if (!same(expected, await snapshot(path)) || handle && !same(expected, await handle.stat({ bigint: true }))) throw changed()
}
async function readExactly(handle: FileHandle, start: number, length: number) {
  const bytes = new Uint8Array(length)
  let offset = 0
  while (offset < length) {
    const read = await handle.read(bytes, offset, length - offset, start + offset)
    if (!read.bytesRead) throw changed()
    offset += read.bytesRead
  }
  return bytes
}
function diskSource(handle: FileHandle, size: number): VideoSource {
  return {
    size,
    slice(start = 0, end = size) {
      // Only requested container headers are read. Encoded streams stay on disk.
      if (start < 0 || end < start || end > size) throw new Error('Leitura inválida do contêiner.')
      return { async arrayBuffer() { return (await readExactly(handle, start, end - start)).buffer as ArrayBuffer } }
    },
  }
}
async function inspectHandle(handle: FileHandle, path: string, extension: string, size: number): Promise<{ inspection: Inspection; image?: ImagePlan; video?: Awaited<ReturnType<typeof analyzeVideoContainer>> }> {
  const base = { path, name: basename(path), size }
  if (['.mp4', '.mov', '.m4v'].includes(extension)) {
    const video = await analyzeVideoContainer(diskSource(handle, size))
    return { video, inspection: { ...base, format: video.inspection.format, kind: 'video', metadata: video.inspection.metadata, warnings: [VIDEO_WARNING] } }
  }
  if (size > IMAGE_LIMIT) throw new Error('A imagem excede o limite de 256 MB para edição segura.')
  const image = planImage(await readExactly(handle, 0, size), extension)
  return { image, inspection: { ...base, format: image.format, kind: 'image', metadata: image.metadata, warnings: [IMAGE_WARNING, ...image.warnings] } }
}

export async function inspectFile(input: string): Promise<Inspection> {
  const { path, extension } = await targetPath(input)
  const before = await snapshot(path)
  const handle = await openSource(path, before)
  try {
    const result = await inspectHandle(handle, path, extension, Number(before.size))
    await assertUnchanged(path, before, handle)
    return result.inspection
  } finally { await handle.close() }
}

async function writeExactly(handle: FileHandle, bytes: Uint8Array, position: number) {
  let offset = 0
  while (offset < bytes.length) {
    const result = await handle.write(bytes, offset, bytes.length - offset, position + offset)
    if (!result.bytesWritten) throw new Error('Não foi possível completar a gravação. O original não foi alterado.')
    offset += result.bytesWritten
  }
}
async function copyDisk(source: FileHandle, destination: FileHandle, size: number) {
  const block = new Uint8Array(Math.min(1024 * 1024, size))
  let position = 0
  while (position < size) {
    const length = Math.min(block.length, size - position)
    const result = await source.read(block, 0, length, position)
    if (!result.bytesRead) throw changed()
    await writeExactly(destination, block.subarray(0, result.bytesRead), position)
    position += result.bytesRead
  }
}
async function erase(handle: FileHandle, start: number, end: number) {
  const zero = new Uint8Array(Math.min(1024 * 1024, end - start))
  while (start < end) {
    const count = Math.min(zero.length, end - start)
    await writeExactly(handle, zero.subarray(0, count), start)
    start += count
  }
}
function translateError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error('Não foi possível processar o arquivo local.')
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return new Error('Sem permissão para alterar este arquivo ou sua pasta. O original não foi substituído.')
  if (code === 'ENOSPC') return new Error('Não há espaço livre para a gravação segura. O original não foi substituído.')
  if (code === 'ENOENT') return new Error('O arquivo ou a pasta não foi encontrado. Verifique o caminho e tente novamente.')
  return error
}

/** Atomically replaces the selected path only after a fully verified sibling temporary file exists. */
export async function cleanFile(input: string): Promise<CleanResult> {
  const { path, extension, key } = await targetPath(input)
  if (active.has(key)) throw new Error('Este arquivo já está sendo processado. Aguarde a operação atual.')
  active.add(key)
  const lockPath = join(dirname(path), `.${basename(path)}.cleanframe.lock`)
  let lock: FileHandle | undefined, source: FileHandle | undefined, temporary: FileHandle | undefined
  let temporaryPath: string | undefined, lockIdentity: BigIntStats | undefined
  try {
    try { lock = await open(lockPath, 'wx', 0o600) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Este arquivo possui uma operação em andamento ou uma trava de uma sessão interrompida. Feche outras instâncias; se nenhuma estiver usando o arquivo, remova a trava .cleanframe.lock na pasta do original.')
      throw error
    }
    lockIdentity = await lock.stat({ bigint: true })
    await lock.writeFile(JSON.stringify({ pid: process.pid, created: new Date().toISOString() }))
    const before = await snapshot(path)
    if ((before.mode & 0o222n) === 0n) throw new Error('O arquivo está marcado como somente leitura. O original não foi alterado.')
    await access(path, constants.W_OK)
    source = await openSource(path, before)
    const analysis = await inspectHandle(source, path, extension, Number(before.size))
    await assertUnchanged(path, before, source)
    const result: CleanResult = {
      path, name: basename(path), format: analysis.inspection.format, kind: analysis.inspection.kind,
      sizeBefore: Number(before.size), sizeAfter: Number(before.size), removedCount: analysis.inspection.metadata.length,
      status: analysis.inspection.metadata.length ? 'cleaned' : 'already_clean', warnings: [...analysis.inspection.warnings],
    }
    if (!result.removedCount) return result
    temporaryPath = join(dirname(path), `.cleanframe-${randomUUID()}.tmp`)
    temporary = await open(temporaryPath, 'wx+', 0o600)
    if (analysis.image) {
      await writeExactly(temporary, analysis.image.bytes, 0)
      result.sizeAfter = analysis.image.bytes.length
    } else if (analysis.video) {
      await copyDisk(source, temporary, Number(before.size))
      for (const patch of analysis.video.patches) {
        if (patch.bytes) await writeExactly(temporary, patch.bytes, patch.start)
        else await erase(temporary, patch.start, patch.end)
      }
    } else throw new Error('Não foi possível criar o plano de limpeza.')
    const verification = await inspectHandle(temporary, path, extension, result.sizeAfter)
    if (verification.inspection.metadata.length) throw new Error('A verificação encontrou metadados restantes. O original não foi alterado.')
    const written = await temporary.stat({ bigint: true })
    if (written.size !== BigInt(result.sizeAfter)) throw new Error('A verificação do tamanho falhou. O original não foi alterado.')
    await chmod(temporaryPath, Number(before.mode & 0o777n))
    await temporary.sync()
    await temporary.close(); temporary = undefined
    await assertUnchanged(path, before, source)
    await source.close(); source = undefined
    await assertUnchanged(path, before)
    await rename(temporaryPath, path)
    temporaryPath = undefined
    // Directory fsync is supported on macOS; Windows normally rejects directory handles.
    if (process.platform !== 'win32') {
      let directory: FileHandle | undefined
      try { directory = await open(dirname(path), constants.O_RDONLY); await directory.sync() }
      catch { result.warnings.push('O arquivo foi substituído, mas o sistema não confirmou a sincronização da pasta com o disco.') }
      finally { await directory?.close().catch(() => undefined) }
    }
    return result
  } catch (error) { throw translateError(error) }
  finally {
    await temporary?.close().catch(() => undefined)
    await source?.close().catch(() => undefined)
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
    await lock?.close().catch(() => undefined)
    if (lockIdentity) {
      const current = await lstat(lockPath, { bigint: true }).catch(() => undefined)
      if (current && current.dev === lockIdentity.dev && current.ino === lockIdentity.ino) await unlink(lockPath).catch(() => undefined)
    }
    active.delete(key)
  }
}
