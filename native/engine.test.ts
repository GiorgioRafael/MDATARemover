// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, link, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import { appendFileSync, watch } from 'node:fs'
import { cleanFile, inspectFile } from './engine'
import { planImage, pngCrc } from './images'

const encode = (value: string) => new TextEncoder().encode(value)
function concat(...parts: Uint8Array[]) { return Buffer.concat(parts.map((part) => Buffer.from(part))) }
function int(value: number, little = false) { const bytes = Buffer.alloc(4); if (little) bytes.writeUInt32LE(value); else bytes.writeUInt32BE(value); return bytes }
function pngChunk(type: string, payload: Uint8Array) { const body = concat(encode(type), payload); return concat(int(payload.length), body, int(pngCrc(body))) }
const rawPixel = new Uint8Array([0, 30, 80, 150, 255])
function png(extra?: Uint8Array) {
  const header = concat(int(1), int(1), new Uint8Array([8, 6, 0, 0, 0]))
  const encoded = deflateSync(rawPixel)
  return { bytes: concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), extra ?? pngChunk('tEXt', encode('Author\0Private person')), pngChunk('IDAT', encoded), pngChunk('IEND', new Uint8Array())), encoded }
}
function exif(orientation = 6) {
  // IFD0: orientation and a private ASCII tag, then a null next-IFD pointer.
  return new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0, 2, 0, 18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 49, 1, 2, 0, 4, 0, 0, 0, 71, 80, 83, 0, 0, 0, 0, 0])
}
function jpegSegment(marker: number, payload: Uint8Array) { return concat(new Uint8Array([255, marker, (payload.length + 2) >>> 8, (payload.length + 2) & 255]), payload) }
function jpeg() {
  const entropyA = new Uint8Array([0x12, 255, 0, 0x34, 255, 208, 0x56])
  const entropyB = new Uint8Array([0x71, 0x22, 255, 0, 0x23])
  const scan = jpegSegment(218, new Uint8Array([1, 1, 0, 0, 63, 0]))
  return {
    entropyA, entropyB,
    bytes: concat(new Uint8Array([255, 216]), jpegSegment(225, concat(encode('Exif\0\0'), exif())), jpegSegment(194, new Uint8Array([8, 0, 1, 0, 1, 1, 1, 0x11, 0])), scan, entropyA, jpegSegment(237, encode('Private author after the first scan')), scan, entropyB, jpegSegment(254, encode('Private comment')), new Uint8Array([255, 217]), encode('Private trailing data')),
  }
}
function riffChunk(type: string, payload: Uint8Array) { return concat(encode(type), int(payload.length, true), payload, payload.length % 2 ? new Uint8Array(1) : new Uint8Array()) }
function webp(animated = false) {
  const compressed = new Uint8Array([0x2f, 0, 0, 0, 0, 7, 0xd0, 0xff, 0xfe, 0xf7, 0xbf, 0xff, 0x81, 0x88, 0xe8, 0x7f, 0, 0])
  const frame = riffChunk('VP8L', compressed)
  const body = concat(encode('WEBP'), riffChunk('VP8X', new Uint8Array([0x0c | (animated ? 2 : 0), 0, 0, 0, 0, 0, 0, 0, 0, 0])), animated ? concat(riffChunk('ANIM', new Uint8Array(6)), riffChunk('ANMF', concat(new Uint8Array(16), frame)), riffChunk('ANMF', concat(new Uint8Array(16), frame))) : frame, riffChunk('EXIF', exif()), riffChunk('XMP ', encode('Private GPS XMP')))
  return { compressed, bytes: concat(encode('RIFF'), int(body.length, true), body) }
}
function box(type: string, ...parts: Uint8Array[]) { const bytes = concat(...parts); return concat(int(bytes.length + 8), encode(type), bytes) }
function video() {
  function header(type: 'mvhd' | 'tkhd' | 'mdhd') {
    const bytes = Buffer.alloc(type === 'mvhd' ? 100 : type === 'tkhd' ? 84 : 24)
    bytes.writeUInt32BE(3850000000, 4); bytes.writeUInt32BE(3850000100, 8)
    if (type === 'tkhd') {
      bytes.writeUInt32BE(1, 12); bytes.writeUInt32BE(65536, 40); bytes.writeUInt32BE(65536, 56)
      bytes.writeUInt32BE(0x40000000, 72); bytes.writeUInt32BE(16 * 65536, 76); bytes.writeUInt32BE(16 * 65536, 80)
    } else { bytes.writeUInt32BE(1000, 12); bytes.writeUInt32BE(1000, 16) }
    return box(type, bytes)
  }
  const ftyp = box('ftyp', encode('isom'), int(0), encode('mp42')), media = Buffer.alloc(2 * 1024 * 1024, 0x56)
  const handler = Buffer.alloc(24); handler.set(encode('vide'), 8)
  const sample = Buffer.alloc(78); sample[7] = 1; sample.writeUInt16BE(16, 24); sample.writeUInt16BE(16, 26); sample.set(encode('Private encoder'), 42)
  const stbl = box('stbl', box('stsd', int(0), int(1), box('avc1', sample, box('avcC', new Uint8Array([1, 100, 0, 31])))), box('stts', int(0), int(1), int(1), int(1000)), box('stsc', int(0), int(1), int(1), int(1), int(1)), box('stsz', int(0), int(media.length), int(1)), box('stco', int(0), int(1), int(ftyp.length + 8)))
  const minf = box('minf', box('vmhd', new Uint8Array(12)), box('dinf', box('dref', int(0), int(1), box('url ', int(1)))), stbl)
  const track = box('trak', header('tkhd'), box('mdia', header('mdhd'), box('hdlr', handler, encode('Private track name\0')), minf))
  return { media, mediaStart: ftyp.length + 8, bytes: concat(ftyp, box('mdat', media), box('moov', header('mvhd'), track, box('udta', box('name', encode('Private title')), box('loci', encode('GPS private location'))))) }
}
let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'cleanframe-native-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('native file metadata engine', () => {
  it('replaces the selected PNG path, preserves compressed pixels and makes repeat cleaning a no-op', async () => {
    const file = join(directory, 'original.png'), source = png()
    await writeFile(file, source.bytes)
    expect(await inspectFile(file)).toMatchObject({ path: file, kind: 'image', format: 'PNG', metadata: [{ value: 'Presente' }] })
    const result = await cleanFile(file)
    expect(result).toMatchObject({ path: file, name: 'original.png', status: 'cleaned', removedCount: 1 })
    const output = await readFile(file)
    expect(output.includes(source.encoded)).toBe(true)
    expect(inflateSync(source.encoded)).toEqual(Buffer.from(rawPixel))
    expect(output.includes(encode('Private person'))).toBe(false)
    expect((await inspectFile(file)).metadata).toEqual([])
    const before = await stat(file)
    expect(await cleanFile(file)).toMatchObject({ status: 'already_clean', removedCount: 0, sizeBefore: output.length, sizeAfter: output.length })
    expect((await stat(file)).ino).toBe(before.ino)
    expect(await readdir(directory)).toEqual(['original.png'])
  })

  it('cleans JPEG metadata between progressive scans without touching scan bytes or orientation', async () => {
    const file = join(directory, 'progressive.jpg'), source = jpeg()
    await writeFile(file, source.bytes)
    expect((await cleanFile(file)).removedCount).toBe(4)
    const output = await readFile(file)
    expect(output.includes(source.entropyA)).toBe(true)
    expect(output.includes(source.entropyB)).toBe(true)
    expect(output.includes(encode('Private'))).toBe(false)
    expect(output.includes(new Uint8Array([18, 1, 3, 0, 1, 0, 0, 0, 6, 0]))).toBe(true)
    expect(await cleanFile(file)).toMatchObject({ status: 'already_clean', removedCount: 0 })
  })

  it.each([false, true])('cleans WebP (animation=%s) while preserving compressed frame bytes and orientation', async (animated) => {
    const file = join(directory, 'original.webp'), source = webp(animated)
    await writeFile(file, source.bytes)
    expect(await cleanFile(file)).toMatchObject({ status: 'cleaned', removedCount: 2 })
    const output = await readFile(file)
    expect(output.includes(source.compressed)).toBe(true)
    expect(output.readUInt32LE(4)).toBe(output.length - 8)
    expect(output[20] & 0x0c).toBe(0x08)
    expect(output.includes(encode('Private GPS XMP'))).toBe(false)
    expect(await cleanFile(file)).toMatchObject({ status: 'already_clean', removedCount: 0 })
  })

  it('streams MP4 metadata patches while retaining media offsets, encoded content and original path', async () => {
    const file = join(directory, 'original.mp4'), source = video()
    await writeFile(file, source.bytes)
    const before = await inspectFile(file)
    expect(before.metadata.length).toBeGreaterThan(5)
    expect(await cleanFile(file)).toMatchObject({ path: file, sizeBefore: source.bytes.length, sizeAfter: source.bytes.length, removedCount: before.metadata.length })
    const output = await readFile(file)
    expect(output.subarray(source.mediaStart, source.mediaStart + source.media.length).equals(source.media)).toBe(true)
    expect(output.includes(encode('Private'))).toBe(false)
    expect(output.includes(encode('GPS private location'))).toBe(false)
    expect(await cleanFile(file)).toMatchObject({ status: 'already_clean' })
    expect(await readdir(directory)).toEqual(['original.mp4'])
  })

  it('preserves PNG orientation while removing EXIF private fields', async () => {
    const file = join(directory, 'orientation.png'), source = png(pngChunk('eXIf', exif()))
    await writeFile(file, source.bytes)
    expect(await cleanFile(file)).toMatchObject({ removedCount: 1 })
    const output = await readFile(file)
    expect(output.includes(encode('GPS'))).toBe(false)
    expect(output.includes(source.encoded)).toBe(true)
    expect(await cleanFile(file)).toMatchObject({ status: 'already_clean' })
  })

  it('leaves a corrupt original byte-identical and removes its temporary lock', async () => {
    const file = join(directory, 'corrupt.png'), source = png().bytes
    source[source.length - 1] ^= 1
    await writeFile(file, source)
    await expect(cleanFile(file)).rejects.toThrow('estrutura inválida')
    expect(await readFile(file)).toEqual(source)
    expect(await readdir(directory)).toEqual(['corrupt.png'])
  })

  it('rejects signatures that disagree with the file extension and invalid segment bounds', async () => {
    const file = join(directory, 'disguised.jpg'), source = png().bytes
    await writeFile(file, source)
    await expect(cleanFile(file)).rejects.toThrow('estrutura inválida')
    expect(await readFile(file)).toEqual(source)
    const broken = jpeg().bytes.subarray(0, 30)
    expect(() => planImage(broken, '.jpg')).toThrow()
  })

  it('refuses MPF JPEG so auxiliary images and HDR gain maps are never discarded', async () => {
    const file = join(directory, 'hdr.jpg'), image = jpeg().bytes
    const source = concat(image.subarray(0, 2), jpegSegment(226, concat(encode('MPF\0'), exif())), image.subarray(2), jpeg().bytes)
    await writeFile(file, source)
    await expect(inspectFile(file)).rejects.toThrow('multi-imagem ou HDR com MPF')
    await expect(cleanFile(file)).rejects.toThrow('multi-imagem ou HDR com MPF')
    expect((await readFile(file)).equals(source)).toBe(true)
    expect(await readdir(directory)).toEqual(['hdr.jpg'])
  })

  it('prevents simultaneous cleaning of the same original', async () => {
    const file = join(directory, 'concurrent.mp4'), source = video()
    await writeFile(file, source.bytes)
    const results = await Promise.allSettled([cleanFile(file), cleanFile(file)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await inspectFile(file)).metadata).toEqual([])
    expect(await readdir(directory)).toEqual(['concurrent.mp4'])
  })

  it('honors a lock acquired by another process without modifying that lock', async () => {
    const file = join(directory, 'locked.png'), source = png().bytes
    await writeFile(file, source)
    const lockPath = join(directory, '.locked.png.cleanframe.lock'), lock = await open(lockPath, 'wx')
    try {
      await lock.writeFile('another process')
      await expect(cleanFile(file)).rejects.toThrow('trava')
      expect(await readFile(file)).toEqual(source)
      expect(await readFile(lockPath, 'utf8')).toBe('another process')
    } finally { await lock.close() }
  })

  it('detects a concurrent source change before replacement and removes the temporary file', async () => {
    const file = join(directory, 'changing.mp4'), source = video()
    await writeFile(file, source.bytes)
    let modified = false
    const watcher = watch(directory, (_event, name) => {
      if (!modified && name?.startsWith('.cleanframe-') && name.endsWith('.tmp')) {
        modified = true
        appendFileSync(file, 'external change')
      }
    })
    try {
      await expect(cleanFile(file)).rejects.toThrow('alterado por outro programa')
      expect(modified).toBe(true)
      expect((await readFile(file)).equals(concat(source.bytes, encode('external change')))).toBe(true)
      expect(await readdir(directory)).toEqual(['changing.mp4'])
    } finally { watcher.close() }
  })

  it('refuses hard links so a second path cannot retain the private original', async () => {
    const file = join(directory, 'original.png'), linked = join(directory, 'linked.png'), source = png().bytes
    await writeFile(file, source); await link(file, linked)
    await expect(cleanFile(file)).rejects.toThrow('hard links')
    expect(await readFile(file)).toEqual(source)
    expect(await readFile(linked)).toEqual(source)
  })

  it('refuses read-only files and relative paths', async () => {
    const file = join(directory, 'readonly.png'), source = png().bytes
    await writeFile(file, source); await chmod(file, 0o444)
    try {
      await expect(cleanFile(file)).rejects.toThrow(/somente leitura|permissão/)
      expect(await readFile(file)).toEqual(source)
      await expect(cleanFile('readonly.png')).rejects.toThrow('absoluto')
    } finally { await chmod(file, 0o644) }
  })
})
