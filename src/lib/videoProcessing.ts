/**
 * Lossless, local container editing. No encoded video/audio samples are decoded,
 * recompressed, read into memory or moved: every edit keeps its original length.
 *
 * Scope: conventional, self-contained MP4/MOV/M4V with audio/video tracks only.
 * Removes container tags, dates and descriptive names. Codec configuration,
 * orientation, colour/HDR information and encoded streams remain byte-identical.
 * Metadata inside encoded streams (for example SEI), visible content and file
 * system dates are outside this operation. Unknown extensions, item-based meta,
 * telemetry, encrypted and fragmented files are rejected conservatively.
 *
 * Layout references: developer.apple.com/documentation/quicktime-file-format
 * (Atoms, Metadata atoms and types, Track header atom, Video sample description).
 */

export const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024

export interface VideoInspection {
  format: string
  width: number
  height: number
  duration: number
  metadata: Array<{ label: string; value: string }>
}

export interface ProcessedVideo {
  blob: Blob
  url: string
  name: string
  inspection: VideoInspection
  removedCount: number
}

type Options = { signal?: AbortSignal; onProgress?: (progress: { message: string; percent?: number }) => void }
type Box = { type: string; start: number; payload: number; end: number }
type Patch = { start: number; end: number; bytes?: Uint8Array<ArrayBuffer> }
/** Random-access header reader; the native app supplies disk slices without loading media. */
export type VideoSource = { readonly size: number; slice(start?: number, end?: number): Pick<Blob, 'arrayBuffer'> }
type Track = { handler: string; width: number; height: number; descriptions: number }

const TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/m4v', 'application/mp4'])
const BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'avc1', 'hvc1', 'hev1', 'av01', 'qt  ', 'M4V ', 'M4VH', 'M4VP', 'MSNV'])
const VIDEO_CODECS = new Set(['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp08', 'vp09', 'jpeg', 'mjpa', 'mjpb', 'apch', 'apcn', 'apcs', 'apco', 'ap4h', 'ap4x', 'mp4v'])
const AUDIO_CODECS = new Set(['mp4a', 'alac', 'ac-3', 'ec-3', 'Opus', 'fLaC', 'lpcm', 'sowt', 'twos', 'in24', 'in32', 'fl32', 'fl64', 'raw ', 'ulaw', 'alaw'])
const SAMPLE_EXTENSIONS = new Set(['avcC', 'hvcC', 'av1C', 'vpcC', 'esds', 'pasp', 'clap', 'colr', 'fiel', 'gama', 'btrt', 'mdcv', 'clli', 'cclv', 'amve', 'dac3', 'dec3', 'dOps', 'dfLa', 'alac', 'chan', 'enda', 'frma', 'glbl', '\0\0\0\0'])
const USER_TAGS = new Set(['name', 'cprt', 'auth', 'dscp', 'loci', 'titl', 'albm', 'yrrc', 'gnre', 'perf', 'rtng', 'clsf', 'kywd', 'XMP_', 'Xtra'])
const META_CHILDREN = new Set(['hdlr', 'mhdr', 'keys', 'ilst', 'ctry', 'lang', 'free'])
const GROUP_LENGTHS: Record<string, number> = { roll: 2, prol: 2, 'rap ': 1, sync: 1 }
const MAX_READ_BYTES = 32 * 1024 * 1024
const READ_CHUNK = 64 * 1024
const MAX_BOXES = 50_000
const text = new TextDecoder('latin1')
const freeType = new Uint8Array([102, 114, 101, 101])

export function validateVideo(file: File): string | null {
  if (!/\.(mp4|mov|m4v)$/i.test(file.name) || (file.type && !TYPES.has(file.type.toLowerCase()))) return 'Use um vídeo MP4, MOV ou M4V.'
  if (!file.size) return 'O vídeo está vazio.'
  if (file.size > MAX_VIDEO_SIZE) return 'O vídeo deve ter no máximo 2 GB.'
  return null
}

function invalid(): never { throw new Error('O vídeo está incompleto ou possui uma estrutura inválida.') }
function unsupported(detail: string): never { throw new Error(`Este vídeo não pode ser limpo com segurança: ${detail}. Use um MP4, MOV ou M4V convencional com faixas de vídeo e áudio.`) }
function u32(bytes: Uint8Array, offset = 0) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset) }
function u16(bytes: Uint8Array, offset = 0) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset) }
function u64(bytes: Uint8Array, offset = 0) {
  const value = u32(bytes, offset) * 2 ** 32 + u32(bytes, offset + 4)
  if (!Number.isSafeInteger(value)) invalid()
  return value
}

class Reader {
  private readBytes = 0
  private boxCount = 0
  constructor(readonly file: VideoSource, readonly signal?: AbortSignal) {}

  async read(start: number, length: number) {
    this.signal?.throwIfAborted()
    if (start < 0 || length < 0 || start + length > this.file.size) invalid()
    this.readBytes += length
    if (this.readBytes > MAX_READ_BYTES) unsupported('a estrutura exige uma leitura de cabeçalhos maior que o limite de segurança')
    const bytes = new Uint8Array(await this.file.slice(start, start + length).arrayBuffer())
    this.signal?.throwIfAborted()
    if (bytes.length !== length) invalid()
    return bytes
  }

  async boxes(start: number, end: number, top = false) {
    const boxes: Box[] = []
    while (start < end) {
      if (++this.boxCount > MAX_BOXES) unsupported('há blocos demais no contêiner')
      if (end - start < 8) invalid()
      const header = await this.read(start, 8)
      let length = u32(header)
      let headerSize = 8
      if (length === 1) {
        if (end - start < 16) invalid()
        length = u64(await this.read(start + 8, 8))
        headerSize = 16
      } else if (length === 0) {
        if (!top) invalid()
        length = end - start
      }
      if (length < headerSize || length > end - start) invalid()
      boxes.push({ type: text.decode(header.subarray(4)), start, payload: start + headerSize, end: start + length })
      start += length
    }
    return boxes
  }

  async nonzero(start: number, end: number) {
    for (let at = start; at < end; at += READ_CHUNK) {
      if ((await this.read(at, Math.min(READ_CHUNK, end - at))).some((byte) => byte !== 0)) return true
    }
    return false
  }
}

async function analyze(file: VideoSource, signal?: AbortSignal) {
  if (!file.size || file.size > MAX_VIDEO_SIZE) unsupported('tamanho fora do limite de 2 GB')
  const reader = new Reader(file, signal)
  const patches: Patch[] = []
  const metadata: VideoInspection['metadata'] = []
  const top = await reader.boxes(0, file.size, true)
  const media = top.filter((box) => box.type === 'mdat')
  const movies = top.filter((box) => box.type === 'moov')
  const ftypes = top.filter((box) => box.type === 'ftyp')
  if (movies.length !== 1 || !media.length || media.some((box) => box.end <= box.payload)) invalid()
  if (ftypes.length > 1) invalid()
  let format = 'MOV'
  if (ftypes.length) {
    const box = ftypes[0]
    const length = box.end - box.payload
    if (length < 8 || length > 1024 || length % 4) invalid()
    const brand = text.decode((await reader.read(box.payload, length)).subarray(0, 4))
    if (!BRANDS.has(brand)) unsupported('a marca do contêiner não é compatível')
    format = brand === 'qt  ' ? 'MOV' : brand.startsWith('M4V') ? 'M4V' : 'MP4'
  } else if (top[0]?.type !== 'moov' && top[0]?.type !== 'wide' && top[0]?.type !== 'mdat') {
    invalid()
  }
  const inspection: VideoInspection = { format, width: 0, height: 0, duration: 0, metadata }
  const tracks: Track[] = []

  function record(label: string, start: number, end: number, value = 'Presente') {
    if (end <= start) return
    patches.push({ start, end })
    metadata.push({ label, value })
  }

  function removeBox(box: Box, label: string) {
    patches.push({ start: box.start + 4, end: box.start + 8, bytes: freeType })
    record(label, box.payload, box.end)
  }

  async function timestamps(box: Box) {
    const version = (await reader.read(box.payload, 1))[0]
    if (version !== 0 && version !== 1) unsupported('versão de cabeçalho não reconhecida')
    const min = box.type === 'mvhd' ? (version ? 112 : 100) : box.type === 'tkhd' ? (version ? 96 : 84) : (version ? 36 : 24)
    if (box.end - box.payload < min) invalid()
    const header = await reader.read(box.payload, min)
    const length = version ? 8 : 4
    for (const [offset, label] of [[4, 'Data de criação'], [4 + length, 'Data de modificação']] as const) {
      if (header.subarray(offset, offset + length).some((byte) => byte !== 0)) record(`${label} (${box.type})`, box.payload + offset, box.payload + offset + length)
    }
    return { version, header }
  }

  async function validateTags(box: Box, depth = 0): Promise<void> {
    if (depth > 12) unsupported('estrutura de metadados muito profunda')
    if (box.type === 'meta') {
      // Only by-value QuickTime/iTunes tags: item metadata may point into mdat.
      if (box.end - box.payload < 8) invalid()
      const first = await reader.read(box.payload, 4)
      const children = await reader.boxes(box.payload + (u32(first) === 0 ? 4 : 0), box.end)
      if (!children.length || children.some((child) => !META_CHILDREN.has(child.type))) unsupported('metadados de itens ou extensões de metadados não reconhecidas')
    } else {
      // Legacy user-data strings are themselves ordinary atoms (including ©xxx).
      // Do not discard an opaque user-data wrapper that might hide an iloc/gps
      // index referring to private bytes elsewhere in the file.
      let end = box.end
      if (end - box.payload >= 4 && u32(await reader.read(end - 4, 4)) === 0) {
        // Some legacy QuickTime writers append a four-byte terminator. Retry
        // without it only when it is not already part of a complete atom.
        const tailLength = end - box.payload
        if (tailLength === 4) return
      }
      let children: Box[]
      try { children = await reader.boxes(box.payload, end) }
      catch (error) {
        if (!(error instanceof Error) || !error.message.includes('estrutura inválida') || end - box.payload < 4 || u32(await reader.read(end - 4, 4)) !== 0) throw error
        end -= 4
        children = await reader.boxes(box.payload, end)
      }
      for (const child of children) {
        if (child.type === 'meta' || child.type === 'udta') await validateTags(child, depth + 1)
        else if (!child.type.startsWith('©') && !USER_TAGS.has(child.type) && !['free', 'skip', 'wide'].includes(child.type)) unsupported(`extensão de dados do usuário não reconhecida (${child.type})`)
      }
    }
  }

  async function tags(box: Box) {
    await validateTags(box)
    removeBox(box, box.type === 'udta' ? 'Tags do usuário (GPS, autoria e outros dados)' : 'Tags do contêiner')
  }

  async function common(box: Box) {
    if (box.type === 'udta' || box.type === 'meta') { await tags(box); return true }
    if (box.type === 'free' || box.type === 'skip' || box.type === 'wide') {
      if (await reader.nonzero(box.payload, box.end)) removeBox(box, 'Dados em espaço de preenchimento')
      return true
    }
    if (box.type === 'uuid') {
      if (box.end - box.payload < 16) invalid()
      const uuid = Array.from(await reader.read(box.payload, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')
      if (uuid !== 'be7acfcb97a942e89c71999491e3afac') unsupported('há uma extensão UUID não reconhecida')
      removeBox(box, 'XMP')
      return true
    }
    if (new Set(['moof', 'mfra', 'mvex', 'sidx', 'styp']).has(box.type)) unsupported('contêiner fragmentado')
    if (new Set(['sinf', 'schi', 'tenc', 'senc', 'saio', 'saiz', 'pssh', 'encv', 'enca']).has(box.type)) unsupported('conteúdo protegido ou criptografado')
    return false
  }

  function one(boxes: Box[], type: string) {
    const found = boxes.filter((box) => box.type === type)
    if (found.length !== 1) invalid()
    return found[0]
  }

  async function handler(box: Box) {
    if (box.end - box.payload < 24) invalid()
    const bytes = await reader.read(box.payload, 24)
    if (bytes[0] !== 0) unsupported('versão de handler não reconhecida')
    if (await reader.nonzero(box.payload + 24, box.end)) record('Nome descritivo da faixa', box.payload + 24, box.end)
    return text.decode(bytes.subarray(8, 12))
  }

  async function descriptions(box: Box, track: Track) {
    if (box.end - box.payload < 8) invalid()
    const prefix = await reader.read(box.payload, 8)
    if (u32(prefix) !== 0) unsupported('versão da descrição de amostra não reconhecida')
    const entries = await reader.boxes(box.payload + 8, box.end)
    if (!entries.length || entries.length > 64 || entries.length !== u32(prefix, 4)) invalid()
    track.descriptions = entries.length
    for (const entry of entries) {
      const video = track.handler === 'vide'
      if (!(video ? VIDEO_CODECS : AUDIO_CODECS).has(entry.type)) unsupported(`codec ou faixa não reconhecido (${entry.type})`)
      let fixed = video ? 78 : 28
      if (entry.end - entry.payload < fixed) invalid()
      const bytes = await reader.read(entry.payload, fixed)
      if (u16(bytes, 6) !== 1) unsupported('referência de mídia não reconhecida')
      if (video) {
        if (!u16(bytes, 24) || !u16(bytes, 26)) invalid()
        if (bytes.subarray(42, 74).some((byte) => byte !== 0)) record('Nome do codificador', entry.payload + 42, entry.payload + 74)
      } else {
        const version = u16(bytes, 8)
        if (version > 2) unsupported('versão da descrição de áudio não reconhecida')
        fixed = version === 2 ? 64 : version === 1 ? 44 : 28
        if (entry.end - entry.payload < fixed) invalid()
      }
      for (const extension of await reader.boxes(entry.payload + fixed, entry.end)) {
        if (await common(extension)) continue
        if (extension.type === 'wave') {
          for (const child of await reader.boxes(extension.payload, extension.end)) {
            if (child.type === 'mp4a') {
              if (child.end - child.payload !== 4 || u32(await reader.read(child.payload, 4)) !== 0) unsupported('marcador de áudio QuickTime não reconhecido')
              continue
            }
            if (!(await common(child)) && !SAMPLE_EXTENSIONS.has(child.type)) unsupported(`extensão de áudio não reconhecida (${child.type})`)
          }
        } else if (!SAMPLE_EXTENSIONS.has(extension.type)) unsupported(`extensão de amostra não reconhecida (${extension.type})`)
      }
    }
  }

  async function dataReferences(box: Box) {
    if (box.end - box.payload < 8) invalid()
    const prefix = await reader.read(box.payload, 8)
    const entries = await reader.boxes(box.payload + 8, box.end)
    if (u32(prefix) !== 0 || !entries.length || entries.length !== u32(prefix, 4)) invalid()
    if (entries.length !== 1) unsupported('múltiplas referências de mídia')
    for (const entry of entries) {
      if (entry.type !== 'url ' || entry.end - entry.payload !== 4 || u32(await reader.read(entry.payload, 4)) !== 1) unsupported('mídia externa ou referência de arquivo')
    }
  }

  async function table(box: Box) {
    if (box.end - box.payload < 8) invalid()
    const prefix = await reader.read(box.payload, 8)
    const count = u32(prefix, 4)
    const stride = ({ stco: 4, co64: 8, stts: 8, ctts: 8, stsc: 12, stss: 4, stsh: 8 } as Record<string, number>)[box.type]
    if (stride && box.end - box.payload !== 8 + count * stride) invalid()
    if (box.type === 'stco' || box.type === 'co64') {
      const width = box.type === 'co64' ? 8 : 4
      for (let at = box.payload + 8; at < box.end; at += READ_CHUNK) {
        const bytes = await reader.read(at, Math.min(READ_CHUNK, box.end - at))
        for (let offset = 0; offset < bytes.length; offset += width) {
          const position = width === 8 ? u64(bytes, offset) : u32(bytes, offset)
          if (!media.some((mdat) => position >= mdat.payload && position < mdat.end)) invalid()
        }
      }
    } else if (box.type === 'stsz') {
      if (box.end - box.payload < 12) invalid()
      const bytes = await reader.read(box.payload, 12)
      if (box.end - box.payload !== 12 + (u32(bytes, 4) === 0 ? u32(bytes, 8) * 4 : 0)) invalid()
    } else if (box.type === 'stz2') {
      if (box.end - box.payload < 12) invalid()
      const bytes = await reader.read(box.payload, 12)
      if (![4, 8, 16].includes(bytes[7]) || box.end - box.payload !== 12 + Math.ceil(u32(bytes, 8) * bytes[7] / 8)) invalid()
    }
  }

  async function sampleGroup(box: Box) {
    if (box.end - box.payload < 12) invalid()
    const prefix = await reader.read(box.payload, Math.min(20, box.end - box.payload))
    const version = prefix[0]
    const type = text.decode(prefix.subarray(4, 8))
    const expectedLength = GROUP_LENGTHS[type]
    if (!expectedLength) unsupported(`grupo de amostras não reconhecido (${type})`)
    if (box.type === 'sbgp') {
      if (version > 1) unsupported('versão do grupo de amostras não reconhecida')
      const headerLength = version ? 16 : 12
      if (prefix.length < headerLength || box.end - box.payload !== headerLength + u32(prefix, headerLength - 4) * 8) invalid()
    } else {
      if (version > 2) unsupported('versão da descrição do grupo de amostras não reconhecida')
      const headerLength = version === 0 ? 12 : version === 1 ? 16 : 20
      if (prefix.length < headerLength) invalid()
      const count = u32(prefix, headerLength - 4)
      const defaultLength = version === 0 ? expectedLength : u32(prefix, 8)
      if (defaultLength) {
        if (defaultLength !== expectedLength || box.end - box.payload !== headerLength + count * expectedLength) invalid()
      } else {
        if (box.end - box.payload !== headerLength + count * (4 + expectedLength)) invalid()
        for (let at = box.payload + headerLength; at < box.end; at += 4 + expectedLength) {
          if (u32(await reader.read(at, 4)) !== expectedLength) invalid()
        }
      }
    }
  }

  async function walk(parent: Box, context: string, track?: Track, depth = 0) {
    if (depth > 12) unsupported('estrutura muito profunda')
    const children = await reader.boxes(parent.payload, parent.end)
    if (context === 'moov') { one(children, 'mvhd'); if (!children.some((box) => box.type === 'trak')) invalid() }
    if (context === 'trak') { one(children, 'tkhd'); one(children, 'mdia') }
    if (context === 'mdia') {
      one(children, 'mdhd'); one(children, 'minf')
      track!.handler = await handler(one(children, 'hdlr'))
      if (!['vide', 'soun'].includes(track!.handler)) unsupported('há faixas de metadados, telemetria ou outros dados além de áudio e vídeo')
    }
    if (context === 'minf') { one(children, 'dinf'); one(children, 'stbl') }
    if (context === 'dinf') one(children, 'dref')
    if (context === 'stbl') {
      one(children, 'stsd'); one(children, 'stts'); one(children, 'stsc')
      if (children.filter((box) => box.type === 'stco' || box.type === 'co64').length !== 1 || children.filter((box) => box.type === 'stsz' || box.type === 'stz2').length !== 1) invalid()
    }
    for (const box of children) {
      if (await common(box)) continue
      if (context === 'moov' && box.type === 'mvhd') {
        const { version, header } = await timestamps(box)
        const timescale = u32(header, version ? 20 : 12)
        const duration = version ? u64(header, 24) : u32(header, 16)
        if (!timescale || !Number.isFinite(duration / timescale)) invalid()
        inspection.duration = duration / timescale
      } else if (context === 'moov' && box.type === 'trak') {
        if (tracks.length >= 128) unsupported('há faixas demais')
        const next = { handler: '', width: 0, height: 0, descriptions: 0 }
        tracks.push(next)
        await walk(box, 'trak', next, depth + 1)
      } else if (context === 'trak' && box.type === 'tkhd') {
        const { version, header } = await timestamps(box)
        const offset = version ? 12 : 0
        let width = u32(header, 76 + offset) / 65536
        let height = u32(header, 80 + offset) / 65536
        // Report portrait display dimensions; keep the entire matrix untouched.
        if (u32(header, 40 + offset) === 0 && u32(header, 56 + offset) === 0 && u32(header, 44 + offset) !== 0 && u32(header, 52 + offset) !== 0) [width, height] = [height, width]
        track!.width = width; track!.height = height
      } else if (context === 'trak' && ['mdia', 'edts'].includes(box.type)) {
        await walk(box, box.type, track, depth + 1)
      } else if (context === 'mdia' && box.type === 'mdhd') {
        const { version, header } = await timestamps(box)
        if (!u32(header, version ? 20 : 12)) invalid()
      } else if (context === 'mdia' && box.type === 'hdlr') {
        // Already checked before descending, so track order does not matter.
      } else if (context === 'mdia' && box.type === 'minf') {
        await walk(box, 'minf', track, depth + 1)
      } else if (context === 'minf' && ['dinf', 'stbl'].includes(box.type)) {
        await walk(box, box.type, track, depth + 1)
      } else if (context === 'minf' && box.type === 'hdlr') {
        await handler(box)
      } else if (context === 'minf' && ['vmhd', 'smhd'].includes(box.type)) {
        if (box.end - box.payload < (box.type === 'vmhd' ? 12 : 8)) invalid()
      } else if (context === 'dinf' && box.type === 'dref') {
        await dataReferences(box)
      } else if (context === 'stbl' && box.type === 'stsd') {
        await descriptions(box, track!)
      } else if (context === 'stbl' && ['stts', 'ctts', 'stsc', 'stsz', 'stz2', 'stco', 'co64', 'stss', 'stsh'].includes(box.type)) {
        await table(box)
      } else if (context === 'stbl' && ['sdtp', 'cslg'].includes(box.type)) {
        if (box.end - box.payload < 4) invalid()
      } else if (context === 'stbl' && ['sgpd', 'sbgp'].includes(box.type)) {
        await sampleGroup(box)
      } else if (context === 'edts' && box.type === 'elst') {
        if (box.end - box.payload < 8) invalid()
        const bytes = await reader.read(box.payload, 8)
        if (bytes[0] > 1 || box.end - box.payload !== 8 + u32(bytes, 4) * (bytes[0] ? 20 : 12)) invalid()
      } else unsupported(`bloco não reconhecido (${box.type})`)
    }
  }

  for (const box of top) {
    if (await common(box)) continue
    if (box.type === 'moov') await walk(box, 'moov')
    else if (!['mdat', 'ftyp'].includes(box.type)) unsupported(`bloco não reconhecido (${box.type})`)
  }
  const video = tracks.find((track) => track.handler === 'vide')
  if (!video || !video.width || !video.height) invalid()
  inspection.width = video.width; inspection.height = video.height
  patches.sort((a, b) => a.start - b.start)
  if (patches.some((patch, index) => index > 0 && patch.start < patches[index - 1].end)) invalid()
  return { inspection, patches }
}

export async function inspectVideo(file: Blob, options: { signal?: AbortSignal } = {}): Promise<VideoInspection> {
  return (await analyze(file, options.signal)).inspection
}

/** Metadata-only, fixed-length patch plan for the native disk editor. */
export async function analyzeVideoContainer(file: VideoSource) {
  return analyze(file)
}

const ZERO_BLOCK = new Blob([new Uint8Array(1024 * 1024)])
function zeros(length: number) {
  const parts: Blob[] = []
  while (length >= ZERO_BLOCK.size) { parts.push(ZERO_BLOCK); length -= ZERO_BLOCK.size }
  if (length) parts.push(ZERO_BLOCK.slice(0, length))
  return new Blob(parts)
}

export async function removeVideoMetadata(file: File, options: Options = {}): Promise<ProcessedVideo> {
  options.signal?.throwIfAborted()
  const error = validateVideo(file)
  if (error) throw new Error(error)
  options.onProgress?.({ message: 'Verificando os cabeçalhos do vídeo…', percent: 10 })
  const original = await analyze(file, options.signal)
  options.signal?.throwIfAborted()
  options.onProgress?.({ message: 'Removendo tags sem recodificar vídeo ou áudio…', percent: 45 })
  const parts: BlobPart[] = []
  let offset = 0
  for (const patch of original.patches) {
    options.signal?.throwIfAborted()
    parts.push(file.slice(offset, patch.start), patch.bytes ?? zeros(patch.end - patch.start))
    offset = patch.end
  }
  parts.push(file.slice(offset))
  const type = original.inspection.format === 'MOV' ? 'video/quicktime' : 'video/mp4'
  const blob = new Blob(parts, { type })
  if (blob.size !== file.size) invalid()
  options.onProgress?.({ message: 'Verificando os metadados do arquivo final…', percent: 80 })
  const inspection = await inspectVideo(blob, options)
  options.signal?.throwIfAborted()
  if (inspection.metadata.length) throw new Error('Não foi possível confirmar a remoção dos metadados do contêiner.')
  const name = file.name.replace(/(-limpo)?(\.(?:mp4|mov|m4v))$/i, '-limpo$2')
  options.onProgress?.({ message: 'Vídeo pronto, com a qualidade original preservada.', percent: 100 })
  options.signal?.throwIfAborted()
  return { blob, name, inspection, removedCount: original.inspection.metadata.length, url: URL.createObjectURL(blob) }
}
