/** Lossless container edits. Encoded image and animation data are never decoded. */
export type ImagePlan = { bytes: Uint8Array; format: string; metadata: { label: string; value: string }[]; warnings: string[] }
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index])
const join = (parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((total, bytes) => total + bytes.length, 0))
  let offset = 0
  for (const bytes of parts) { result.set(bytes, offset); offset += bytes.length }
  return result
}
function invalid(): never { throw new Error('A imagem está incompleta ou possui uma estrutura inválida. O original não foi alterado.') }
function unsupported(detail: string): never { throw new Error(`Não é seguro limpar esta imagem: ${detail}. O original não foi alterado.`) }
const entry = (label: string) => ({ label, value: 'Presente' })
const colorWarning = 'Perfil de cor preservado para manter a aparência; perfis ICC podem conter informações do fabricante.'

/** Only orientation survives EXIF; pointers, thumbnails, GPS and private tags disappear. */
function minimalExif(payload: Uint8Array): Uint8Array | undefined {
  const prefix = ascii(payload, 0, Math.min(6, payload.length)) === 'Exif\0\0' ? 6 : 0
  const tiff = payload.subarray(prefix)
  if (tiff.length < 8) invalid()
  const endian = ascii(tiff, 0, 2)
  if (endian !== 'II' && endian !== 'MM') invalid()
  const little = endian === 'II'
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  if (view.getUint16(2, little) !== 42) invalid()
  const offset = view.getUint32(4, little)
  if (offset < 8 || offset > tiff.length - 2) invalid()
  const count = view.getUint16(offset, little)
  if (offset + 2 + count * 12 + 4 > tiff.length) invalid()
  let orientation: number | undefined
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12
    if (view.getUint16(at, little) !== 0x112) continue
    if (orientation !== undefined || view.getUint16(at + 2, little) !== 3 || view.getUint32(at + 4, little) !== 1) invalid()
    orientation = view.getUint16(at + 8, little)
    if (orientation < 1 || orientation > 8) invalid()
  }
  if (orientation === undefined || orientation === 1) return undefined
  // Canonical little-endian TIFF, one SHORT tag and no additional IFD.
  const bytes = new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0])
  return prefix ? join([new Uint8Array([69, 120, 105, 102, 0, 0]), bytes]) : bytes
}
function jpegSegment(marker: number, payload: Uint8Array) {
  const length = payload.length + 2
  return join([new Uint8Array([255, marker, length >>> 8, length & 255]), payload])
}
function jpeg(bytes: Uint8Array): ImagePlan {
  if (bytes[0] !== 255 || bytes[1] !== 216) invalid()
  const metadata: ImagePlan['metadata'] = [], warnings: string[] = [], parts = [bytes.subarray(0, 2)]
  let at = 2, frame = false, scan = false, ended = false, orientations = 0, segments = 0
  while (at < bytes.length) {
    if (++segments > 100_000 || bytes[at] !== 255) invalid()
    const start = at
    while (bytes[at] === 255) at++
    const marker = bytes[at++]
    if (!marker || marker === 216 || marker === undefined || (marker >= 208 && marker <= 215)) invalid()
    if (marker === 217) {
      if (!frame || !scan) invalid()
      parts.push(bytes.subarray(start, at)); ended = true
      if (at !== bytes.length) metadata.push(entry('Dados após o fim do JPEG'))
      break
    }
    if (marker === 1) { parts.push(bytes.subarray(start, at)); continue }
    if (at + 2 > bytes.length) invalid()
    const length = bytes[at] * 256 + bytes[at + 1]
    const end = at + length
    if (length < 2 || end > bytes.length) invalid()
    const payload = bytes.subarray(at + 2, end)
    let replacement: Uint8Array | undefined = bytes.subarray(start, end)
    if (marker >= 224 && marker <= 239) {
      replacement = undefined
      if (marker === 224 && ascii(payload, 0, 5) === 'JFIF\0') {
        if (payload.length < 14 || payload[12] * payload[13] * 3 + 14 !== payload.length) invalid()
        // Preserve density and version, remove the embedded thumbnail.
        const header = payload.slice(0, 14); header[12] = 0; header[13] = 0
        replacement = jpegSegment(marker, header)
        if (!eq(replacement, bytes.subarray(start, end))) metadata.push(entry('Miniatura JFIF'))
      } else if (marker === 225 && ascii(payload, 0, 6) === 'Exif\0\0') {
        if (++orientations > 1) unsupported('múltiplos blocos EXIF')
        const clean = minimalExif(payload)
        replacement = clean ? jpegSegment(marker, clean) : undefined
        if (!replacement || !eq(replacement, bytes.subarray(start, end))) metadata.push(entry('EXIF (GPS, datas e autoria)'))
      } else if (marker === 226 && ascii(payload, 0, 4) === 'MPF\0') {
        // MPF indexes can address additional JPEG images beyond the first EOI,
        // including an HDR gain map. Dropping them would change image content.
        unsupported('JPEG multi-imagem ou HDR com MPF')
      } else if (marker === 226 && ascii(payload, 0, 12) === 'ICC_PROFILE\0') {
        if (payload.length < 14 || !payload[12] || payload[12] > payload[13]) invalid()
        replacement = bytes.subarray(start, end); if (!warnings.includes(colorWarning)) warnings.push(colorWarning)
      } else if (marker === 238 && ascii(payload, 0, 5) === 'Adobe' && payload.length === 12) {
        replacement = bytes.subarray(start, end)
      } else metadata.push(entry(`Bloco APP${marker - 224} (tags e informações adicionais)`))
    } else if (marker === 254) { replacement = undefined; metadata.push(entry('Comentário JPEG')) }
    else if ([192, 193, 194].includes(marker)) {
      if (frame || payload.length < 6 || payload.length !== 6 + payload[5] * 3 || !payload[5] || !payload[1] && !payload[2] || !payload[3] && !payload[4]) invalid()
      frame = true
    } else if ([195, 197, 198, 199, 201, 202, 203, 205, 206, 207, 220].includes(marker)) unsupported('codificação JPEG não convencional')
    else if (![196, 219, 221, 218].includes(marker)) unsupported(`marcador JPEG ${marker.toString(16)} não reconhecido`)
    if (replacement) parts.push(replacement)
    at = end
    if (marker === 218) {
      if (!frame || payload.length < 4 || payload.length !== 1 + payload[0] * 2 + 3) invalid()
      scan = true
      const entropy = at
      while (at < bytes.length) {
        if (bytes[at] !== 255) { at++; continue }
        let next = at + 1
        while (bytes[next] === 255) next++
        if (bytes[next] === 0 || bytes[next] >= 208 && bytes[next] <= 215) { at = next + 1; continue }
        break
      }
      if (at >= bytes.length) invalid()
      parts.push(bytes.subarray(entropy, at))
    }
  }
  if (!ended) invalid()
  return { bytes: join(parts), format: 'JPEG', metadata, warnings }
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index
  for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1
  return crc >>> 0
})
export function pngCrc(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8
  return (crc ^ 0xffffffff) >>> 0
}
function pngChunk(type: string, payload: Uint8Array) {
  const bytes = new Uint8Array(12 + payload.length), view = new DataView(bytes.buffer)
  view.setUint32(0, payload.length)
  bytes.set(new TextEncoder().encode(type), 4); bytes.set(payload, 8)
  view.setUint32(bytes.length - 4, pngCrc(bytes.subarray(4, bytes.length - 4)))
  return bytes
}
function png(bytes: Uint8Array): ImagePlan {
  if (!eq(bytes.subarray(0, 8), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))) invalid()
  const parts = [bytes.subarray(0, 8)], metadata: ImagePlan['metadata'] = [], warnings: string[] = []
  const rendering = new Set(['PLTE', 'IDAT', 'IEND', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'bKGD', 'hIST', 'pHYs', 'sPLT', 'acTL', 'fcTL', 'fdAT', 'cICP', 'mDCV', 'cLLI'])
  let at = 8, ended = false, data = false, exif = false, chunks = 0
  while (at < bytes.length) {
    if (++chunks > 100_000 || at + 12 > bytes.length) invalid()
    const view = new DataView(bytes.buffer, bytes.byteOffset + at, bytes.length - at)
    const length = view.getUint32(0), end = at + 12 + length
    if (length > 0x7fffffff || end > bytes.length) invalid()
    const type = ascii(bytes, at + 4, at + 8), payload = bytes.subarray(at + 8, end - 4)
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase() || pngCrc(bytes.subarray(at + 4, end - 4)) !== view.getUint32(8 + length)) invalid()
    let replacement: Uint8Array | undefined = bytes.subarray(at, end)
    if (at === 8) {
      if (type !== 'IHDR' || length !== 13) invalid()
      const header = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
      const validDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!header.getUint32(0) || !header.getUint32(4) || !validDepths[payload[9]]?.includes(payload[8]) || payload[10] || payload[11] || payload[12] > 1) invalid()
    } else if (type === 'IHDR') invalid()
    else if (type === 'eXIf') {
      if (exif || data) unsupported('posição ou quantidade de blocos EXIF PNG')
      exif = true
      const clean = minimalExif(payload)
      replacement = clean ? pngChunk(type, clean) : undefined
      if (!replacement || !eq(replacement, bytes.subarray(at, end))) metadata.push(entry('EXIF (GPS, datas e autoria)'))
    } else if (!rendering.has(type)) {
      if (type[0] === type[0].toUpperCase()) unsupported(`bloco crítico PNG ${type}`)
      replacement = undefined; metadata.push(entry(`Bloco ${type} (texto, datas ou informações adicionais)`))
    }
    if (type === 'iCCP') warnings.push(colorWarning)
    if (type === 'IDAT') data = true
    if (type === 'IEND') {
      if (length || !data) invalid()
      ended = true
    }
    if (replacement) parts.push(replacement)
    at = end
    if (ended) { if (at !== bytes.length) metadata.push(entry('Dados após o fim do PNG')); break }
  }
  if (!ended) invalid()
  return { bytes: join(parts), format: 'PNG', metadata, warnings }
}

function webp(bytes: Uint8Array): ImagePlan {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP') invalid()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(4, true) !== bytes.length - 8) invalid()
  const parts: Uint8Array[] = [], metadata: ImagePlan['metadata'] = [], warnings: string[] = []
  let at = 12, image = false, extended = false, exif = false, flags: Uint8Array | undefined, chunks = 0
  while (at < bytes.length) {
    if (++chunks > 100_000 || at + 8 > bytes.length) invalid()
    const type = ascii(bytes, at, at + 4), length = view.getUint32(at + 4, true), end = at + 8 + length + (length % 2)
    if (end > bytes.length || (length % 2 && bytes[end - 1] !== 0)) invalid()
    const payload = bytes.subarray(at + 8, at + 8 + length)
    let replacement: Uint8Array | undefined = bytes.subarray(at, end)
    if (type === 'VP8X') {
      if (at !== 12 || length !== 10 || extended || payload[0] & 0xc1 || payload[1] || payload[2] || payload[3]) invalid()
      extended = true; replacement = bytes.slice(at, end); flags = replacement
      replacement[8] &= ~0x0c
    } else if (type === 'EXIF') {
      if (!extended || exif) invalid()
      exif = true
      const clean = minimalExif(payload)
      replacement = undefined
      if (clean) {
        replacement = new Uint8Array(8 + clean.length + (clean.length % 2))
        replacement.set(new TextEncoder().encode('EXIF'))
        new DataView(replacement.buffer).setUint32(4, clean.length, true); replacement.set(clean, 8)
        flags![8] |= 0x08
      }
      if (!replacement || !eq(replacement, bytes.subarray(at, end))) metadata.push(entry('EXIF (GPS, datas e autoria)'))
    } else if (type === 'XMP ') { replacement = undefined; metadata.push(entry('XMP')) }
    else if (type === 'ICCP') { if (!extended) invalid(); warnings.push(colorWarning) }
    else if (type === 'VP8 ' || type === 'VP8L') {
      if (image || !length) invalid()
      if (type === 'VP8 ' && (length < 10 || ascii(payload, 3, 6) !== '\x9d\x01\x2a')) invalid()
      if (type === 'VP8L' && (length < 5 || payload[0] !== 0x2f || payload[4] & 0xe0)) invalid()
      image = true
    } else if (type === 'ANIM') { if (!extended || length !== 6) invalid() }
    else if (type === 'ANMF') {
      if (!extended || length < 24) invalid()
      // Reject opaque embedded metadata: only the documented frame payloads are accepted.
      let frame = 16, frameImage = false
      while (frame < payload.length) {
        if (frame + 8 > payload.length) invalid()
        const sub = ascii(payload, frame, frame + 4), size = new DataView(payload.buffer, payload.byteOffset + frame + 4, 4).getUint32(0, true)
        const next = frame + 8 + size + size % 2
        if (next > payload.length || !['ALPH', 'VP8 ', 'VP8L'].includes(sub) || !size) invalid()
        if (sub !== 'ALPH') { if (frameImage) invalid(); frameImage = true }
        frame = next
      }
      if (!frameImage) invalid()
      image = true
    } else if (type === 'ALPH') { if (!extended || !length) invalid() }
    else { replacement = undefined; metadata.push(entry(`Bloco ${type} (informações adicionais)`)) }
    if (replacement) parts.push(replacement)
    at = end
  }
  if (!image) invalid()
  // Remove inconsistent flags even if a writer supplied an empty metadata declaration.
  if (flags && !eq(flags, bytes.subarray(12, 12 + flags.length)) && !metadata.length) metadata.push(entry('Sinalizadores de metadados WebP'))
  const output = join([bytes.subarray(0, 12), ...parts])
  new DataView(output.buffer).setUint32(4, output.length - 8, true)
  return { bytes: output, format: 'WEBP', metadata, warnings }
}

export function planImage(bytes: Uint8Array, extension: string): ImagePlan {
  if (extension === '.jpg' || extension === '.jpeg') return jpeg(bytes)
  if (extension === '.png') return png(bytes)
  if (extension === '.webp') return webp(bytes)
  throw new Error('Formato de imagem não suportado.')
}
