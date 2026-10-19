import { afterEach, describe, expect, it, vi } from 'vitest'
import { inspectVideo, MAX_VIDEO_SIZE, removeVideoMetadata, validateVideo } from './videoProcessing'

const encoder = new TextEncoder()
function join(...parts: Uint8Array[]) {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.length }
  return bytes
}
function int(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}
function long(value: number) { return join(int(Math.floor(value / 2 ** 32)), int(value >>> 0)) }
function box(type: string, ...parts: Uint8Array[]) {
  const payload = join(...parts)
  return join(int(payload.length + 8), encoder.encode(type), payload)
}
function extendedBox(type: string, payload: Uint8Array) { return join(int(1), encoder.encode(type), long(payload.length + 16), payload) }
function write(bytes: Uint8Array, offset: number, value: number) { new DataView(bytes.buffer).setUint32(offset, value) }
function times(type: 'mvhd' | 'tkhd' | 'mdhd', version = 0, rotated = false) {
  const extra = version ? 12 : 0
  const bytes = new Uint8Array((type === 'mvhd' ? 100 : type === 'tkhd' ? 84 : 24) + extra)
  bytes[0] = version
  if (version) { bytes.set(long(3_850_000_000), 4); bytes.set(long(3_850_000_123), 12) }
  else { write(bytes, 4, 3_850_000_000); write(bytes, 8, 3_850_000_123) }
  if (type === 'tkhd') {
    write(bytes, 12 + (version ? 8 : 0), 1)
    write(bytes, 20 + extra, 5_000)
    if (rotated) { write(bytes, 44 + extra, 65536); write(bytes, 52 + extra, 0xffff0000) }
    else { write(bytes, 40 + extra, 65536); write(bytes, 56 + extra, 65536) }
    write(bytes, 72 + extra, 0x40000000)
    write(bytes, 76 + extra, 1920 * 65536); write(bytes, 80 + extra, 1080 * 65536)
  } else {
    write(bytes, version ? 20 : 12, 1000)
    if (version) bytes.set(long(5000), 24)
    else write(bytes, 16, 5000)
  }
  return box(type, bytes)
}

type FixtureOptions = { version?: number; rotated?: boolean; handler?: string; extra?: Uint8Array; sampleExtra?: Uint8Array; userTags?: Uint8Array; stblExtra?: Uint8Array; badOffset?: boolean; external?: boolean; bigMedia?: boolean; noFtyp?: boolean }
function fixture(options: FixtureOptions = {}) {
  const ftyp = options.noFtyp ? new Uint8Array() : box('ftyp', encoder.encode('isom'), int(0), encoder.encode('mp42'))
  const media = options.bigMedia ? new Uint8Array(8 * 1024 * 1024).fill(0x6d) : encoder.encode('encoded sample bytes: not reconstructed')
  const mdat = box('mdat', media)
  const handler = new Uint8Array(24)
  handler.set(encoder.encode(options.handler ?? 'vide'), 8)
  const sample = new Uint8Array(78)
  sample[7] = 1
  new DataView(sample.buffer).setUint16(24, 1920)
  new DataView(sample.buffer).setUint16(26, 1080)
  sample.set(encoder.encode('\x0aMy encoder'), 42)
  const rendering = join(box('avcC', new Uint8Array([1, 100, 0, 31])), box('colr', encoder.encode('nclx'), new Uint8Array([0, 1, 0, 1, 0, 1, 128])), box('pasp', int(1), int(1)))
  const stsd = box('stsd', int(0), int(1), box('avc1', sample, rendering, options.sampleExtra ?? new Uint8Array()))
  const stbl = box('stbl', stsd,
    box('stts', int(0), int(1), int(1), int(5000)),
    box('stsc', int(0), int(1), int(1), int(1), int(1)),
    box('stsz', int(0), int(media.length), int(1)),
    box('stco', int(0), int(1), int(options.badOffset ? 1 : ftyp.length + 8)),
    options.stblExtra ?? new Uint8Array(),
  )
  const dref = box('dref', int(0), int(1), box('url ', int(options.external ? 0 : 1)))
  const minf = box('minf', box('vmhd', new Uint8Array(12)), box('dinf', dref), stbl)
  const mdia = box('mdia', times('mdhd', options.version), box('hdlr', handler, encoder.encode('Private Editor\0')), minf)
  const trak = box('trak', times('tkhd', options.version, options.rotated), mdia)
  const tags = box('udta', options.userTags ?? join(box('name', encoder.encode('Personal title')), box('loci', encoder.encode('GPS coordinates'))))
  const moov = box('moov', times('mvhd', options.version), trak, tags)
  const bytes = join(ftyp, mdat, moov, options.extra ?? new Uint8Array())
  return { file: new File([bytes], options.noFtyp ? 'clip.mov' : 'clip.mp4', { type: options.noFtyp ? 'video/quicktime' : 'video/mp4' }), bytes, media, mediaStart: ftyp.length + 8, rendering }
}

function find(bytes: Uint8Array, name: string) {
  const needle = encoder.encode(name)
  for (let at = 0; at <= bytes.length - needle.length; at++) {
    if (needle.every((byte, index) => bytes[at + index] === byte)) return at
  }
  return -1
}

afterEach(() => vi.restoreAllMocks())

describe('video container metadata removal', () => {
  it.each([0, 1])('clears version %i dates and tags while preserving media, sample offsets, colours and orientation', async (version) => {
    const source = fixture({ version, rotated: true })
    const before = await inspectVideo(source.file)
    expect(before).toMatchObject({ format: 'MP4', width: 1080, height: 1920, duration: 5 })
    expect(before.metadata.some((entry) => entry.label.includes('criação'))).toBe(true)
    const result = await removeVideoMetadata(source.file)
    const output = new Uint8Array(await result.blob.arrayBuffer())
    expect(output.length).toBe(source.bytes.length)
    expect(output.subarray(source.mediaStart, source.mediaStart + source.media.length)).toEqual(source.media)
    expect(result.inspection.metadata).toEqual([])
    expect(result.inspection).toMatchObject({ width: 1080, height: 1920, duration: 5 })
    expect(result.removedCount).toBe(before.metadata.length)
    expect(result.name).toBe('clip-limpo.mp4')
    for (const atom of ['avcC', 'colr', 'pasp', 'stco']) {
      const at = find(source.bytes, atom) - 4
      const size = new DataView(source.bytes.buffer).getUint32(at)
      expect(output.subarray(at, at + size)).toEqual(source.bytes.subarray(at, at + size))
    }
    for (const atom of ['mvhd', 'tkhd', 'mdhd']) {
      const payload = find(source.bytes, atom) + 4
      const length = version ? 16 : 8
      expect(output.subarray(payload + 4, payload + 4 + length).every((byte) => byte === 0)).toBe(true)
      const end = payload + (atom === 'mvhd' ? 100 : atom === 'tkhd' ? 84 : 24) + (version ? 12 : 0)
      expect(output.subarray(payload + 4 + length, end)).toEqual(source.bytes.subarray(payload + 4 + length, end))
    }
    expect(find(output, 'Personal title')).toBe(-1)
    expect(find(output, 'GPS coordinates')).toBe(-1)
    expect(find(output, 'Private Editor')).toBe(-1)
    expect(find(output, 'My encoder')).toBe(-1)
    URL.revokeObjectURL(result.url)
  })

  it('removes by-value meta, known XMP UUID and data hidden in padding, including extended-size boxes', async () => {
    const uuid = new Uint8Array('be7acfcb97a942e89c71999491e3afac'.match(/../g)!.map((hex) => parseInt(hex, 16)))
    const extra = join(
      box('meta', int(0), box('hdlr', new Uint8Array(24)), box('ilst', box('name', encoder.encode('Private tag')))),
      extendedBox('uuid', join(uuid, encoder.encode('private XMP'))),
      box('free', encoder.encode('private padding')), box('skip', encoder.encode('more private padding')),
    )
    const result = await removeVideoMetadata(fixture({ extra }).file)
    const output = new Uint8Array(await result.blob.arrayBuffer())
    for (const value of ['Private tag', 'private XMP', 'private padding', 'more private padding']) expect(find(output, value)).toBe(-1)
    expect(result.inspection.metadata).toEqual([])
    URL.revokeObjectURL(result.url)
  })

  it('supports conventional QuickTime files without ftyp and preserves their extension and MIME', async () => {
    const result = await removeVideoMetadata(fixture({ noFtyp: true }).file)
    expect(result.name).toBe('clip-limpo.mov')
    expect(result.blob.type).toBe('video/quicktime')
    expect(result.inspection.format).toBe('MOV')
    URL.revokeObjectURL(result.url)
  })

  it('preserves known audio priming groups and legacy QuickTime text tags with a terminator', async () => {
    const grouping = join(
      box('sgpd', new Uint8Array([1, 0, 0, 0]), encoder.encode('roll'), int(2), int(1), new Uint8Array([255, 255])),
      box('sbgp', int(0), encoder.encode('roll'), int(1), int(1), int(1)),
    )
    const legacyType = new Uint8Array([0xa9, 0x78, 0x79, 0x7a])
    const privateText = encoder.encode('Private coordinates')
    const legacy = join(int(privateText.length + 8), legacyType, privateText, int(0))
    const source = fixture({ stblExtra: grouping, userTags: legacy })
    const result = await removeVideoMetadata(source.file)
    const output = new Uint8Array(await result.blob.arrayBuffer())
    const groupAt = find(source.bytes, 'sgpd') - 4
    expect(output.subarray(groupAt, groupAt + grouping.length)).toEqual(grouping)
    expect(find(output, 'Private coordinates')).toBe(-1)
    URL.revokeObjectURL(result.url)
  })

  it('reads bounded header slices and never loads the full video or encoded media', async () => {
    const source = fixture({ bigMedia: true })
    const reads: number[] = []
    const original = Blob.prototype.arrayBuffer
    vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) {
      reads.push(this.size)
      return original.call(this)
    })
    const result = await removeVideoMetadata(source.file)
    expect(Math.max(...reads)).toBeLessThanOrEqual(64 * 1024)
    expect(reads.reduce((sum, size) => sum + size, 0)).toBeLessThan(16 * 1024)
    URL.revokeObjectURL(result.url)
  })

  it.each([
    ['metadata/telemetry tracks', { handler: 'meta' }],
    ['timecode tracks', { handler: 'tmcd' }],
    ['external media', { external: true }],
    ['fragments', { extra: box('moof') }],
    ['unknown UUID extensions', { extra: box('uuid', new Uint8Array(16)) }],
    ['item metadata pointing outside its box', { extra: box('meta', int(0), box('iloc', new Uint8Array(8))) }],
    ['item metadata nested inside user data', { userTags: box('meta', int(0), box('iloc', new Uint8Array(8))) }],
    ['proprietary user-data references', { userTags: box('gps ', int(80)) }],
    ['private sample group descriptions', { stblExtra: box('sgpd', int(0), encoder.encode('priv'), int(0)) }],
    ['unknown sample extensions', { sampleExtra: box('priv', encoder.encode('secret')) }],
  ] as const)('rejects %s instead of claiming removal', async (_name, options) => {
    const createURL = vi.spyOn(URL, 'createObjectURL')
    await expect(removeVideoMetadata(fixture(options).file)).rejects.toThrow('não pode ser limpo com segurança')
    expect(createURL).not.toHaveBeenCalled()
  })

  it('rejects malformed box lengths, truncated containers, false signatures and offsets outside media', async () => {
    const source = fixture()
    const corrupt = source.bytes.slice()
    write(corrupt, find(corrupt, 'moov') - 4, 0x7fffffff)
    for (const file of [new File([corrupt], 'bad.mp4'), new File([source.bytes.slice(0, -1)], 'bad.mp4'), new File(['not a movie'], 'bad.mp4'), fixture({ badOffset: true }).file]) {
      await expect(removeVideoMetadata(file)).rejects.toThrow('inválida')
    }
  })

  it('rejects excessive nesting/box counts and unsafe extended lengths without a full read', async () => {
    const header = join(int(1), encoder.encode('free'), new Uint8Array(8).fill(255))
    await expect(inspectVideo(new Blob([header]))).rejects.toThrow('inválida')
    const excess = join(...Array.from({ length: 50_001 }, () => box('free')))
    await expect(inspectVideo(new Blob([excess]))).rejects.toThrow('blocos demais')
  })

  it('honours aborts before reading and between verification and URL creation', async () => {
    const source = fixture()
    const controller = new AbortController()
    controller.abort()
    const createURL = vi.spyOn(URL, 'createObjectURL')
    await expect(inspectVideo(source.file, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    await expect(removeVideoMetadata(source.file, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    const late = new AbortController()
    await expect(removeVideoMetadata(source.file, { signal: late.signal, onProgress: ({ percent }) => { if (percent === 100) late.abort() } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(createURL).not.toHaveBeenCalled()
  })
})

describe('validateVideo', () => {
  it('accepts case-insensitive supported extensions and an empty browser MIME', () => {
    expect(validateVideo(new File(['video'], 'CLIP.MP4'))).toBeNull()
    expect(validateVideo(new File(['video'], 'clip.m4v', { type: 'video/x-m4v' }))).toBeNull()
  })
  it('rejects unsupported formats, contradictory MIME, empty and oversized files', () => {
    expect(validateVideo(new File(['video'], 'clip.webm', { type: 'video/webm' }))).toContain('MP4, MOV ou M4V')
    expect(validateVideo(new File(['video'], 'clip.mp4', { type: 'image/png' }))).toContain('MP4, MOV ou M4V')
    expect(validateVideo(new File([], 'clip.mp4'))).toContain('vazio')
    const large = new File(['x'], 'clip.mp4')
    Object.defineProperty(large, 'size', { value: MAX_VIDEO_SIZE + 1 })
    expect(validateVideo(large)).toContain('2 GB')
  })
})
