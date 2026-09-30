import type { MetadataBlock, TechnicalDetail } from '../types'

const decoder = new TextDecoder('latin1')

function textAt(bytes: Uint8Array, start: number, length: number): string {
  return decoder.decode(bytes.slice(start, start + length))
}

function scanJpeg(bytes: Uint8Array): MetadataBlock[] {
  const blocks: MetadataBlock[] = []
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (length < 2 || offset + length + 2 > bytes.length) break
    const payloadStart = offset + 4
    const payloadLength = length - 2
    let label: string | null = null
    if (marker === 0xe1) {
      const prefix = textAt(bytes, payloadStart, Math.min(payloadLength, 32))
      label = prefix.startsWith('Exif') ? 'EXIF' : prefix.includes('http://ns.adobe.com/xap') ? 'XMP' : 'APP1 (dados adicionais)'
    } else if (marker === 0xed) label = 'IPTC / Photoshop (APP13)'
    else if (marker === 0xe2) {
      const prefix = textAt(bytes, payloadStart, Math.min(payloadLength, 16))
      label = prefix.startsWith('ICC_PROFILE') ? 'Perfil ICC' : prefix.startsWith('MPF') ? 'MPF / multi-imagem' : 'APP2 (dados adicionais)'
    } else if (marker === 0xeb) {
      const prefix = textAt(bytes, payloadStart, Math.min(payloadLength, 32))
      label = /JUMBF|c2pa/i.test(prefix) ? 'C2PA / credenciais de conteúdo' : 'APP11 (dados adicionais)'
    } else if (marker === 0xec) label = 'APP12 / informações da imagem'
    else if (marker >= 0xe3 && marker <= 0xef && marker !== 0xee) label = `APP${marker - 0xe0} (dados adicionais)`
    else if (marker === 0xfe) label = 'Comentário JPEG'
    if (label) blocks.push({ label, bytes: payloadLength })
    offset += length + 2
  }
  return blocks
}

function scanPng(bytes: Uint8Array): MetadataBlock[] {
  const blocks: MetadataBlock[] = []
  const metadataChunks: Record<string, string> = {
    tEXt: 'Texto PNG', zTXt: 'Texto comprimido PNG', iTXt: 'Texto internacional / XMP',
    eXIf: 'EXIF', iCCP: 'Perfil ICC', tIME: 'Data de modificação', pHYs: 'Resolução física',
  }
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4)
    const length = view.getUint32(0)
    const type = textAt(bytes, offset + 4, 4)
    if (metadataChunks[type]) blocks.push({ label: metadataChunks[type], bytes: length })
    offset += length + 12
    if (type === 'IEND') break
  }
  return blocks
}

function scanWebp(bytes: Uint8Array): MetadataBlock[] {
  const blocks: MetadataBlock[] = []
  let offset = 12
  const names: Record<string, string> = { EXIF: 'EXIF', XMP_: 'XMP', ICCP: 'Perfil ICC' }
  while (offset + 8 <= bytes.length) {
    const type = textAt(bytes, offset, 4)
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4)
    const length = view.getUint32(0, true)
    if (names[type]) blocks.push({ label: names[type], bytes: length })
    offset += 8 + length + (length % 2)
  }
  return blocks
}

export function scanMetadataBlocks(buffer: ArrayBuffer, mime: string): MetadataBlock[] {
  const bytes = new Uint8Array(buffer)
  if (mime === 'image/jpeg') return scanJpeg(bytes)
  if (mime === 'image/png') return scanPng(bytes)
  if (mime === 'image/webp') return scanWebp(bytes)
  return []
}

function jpegTechnicalDetails(bytes: Uint8Array): TechnicalDetail[] {
  const details: TechnicalDetail[] = [{ key: 'signature', label: 'Assinatura do arquivo', value: 'JPEG válido (SOI)' }]
  let offset = 2
  let segmentCount = 0
  let quantizationTables = 0
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (length < 2 || offset + length + 2 > bytes.length) break
    const payload = offset + 4
    segmentCount += 1
    if (marker === 0xe0 && textAt(bytes, payload, 5) === 'JFIF\0' && length >= 14) {
      const major = bytes[payload + 5]
      const minor = bytes[payload + 6]
      const unit = bytes[payload + 7]
      const xDensity = (bytes[payload + 8] << 8) | bytes[payload + 9]
      const yDensity = (bytes[payload + 10] << 8) | bytes[payload + 11]
      details.push({ key: 'jfif', label: 'Contêiner', value: `JFIF ${major}.${String(minor).padStart(2, '0')}` })
      if (unit > 0) details.push({ key: 'density', label: 'Densidade declarada', value: `${xDensity} × ${yDensity} ${unit === 1 ? 'dpi' : 'dpcm'}` })
    }
    if (marker === 0xdb) quantizationTables += 1
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
      const precision = bytes[payload]
      const components = bytes[payload + 5]
      const encoding = marker === 0xc2 ? 'JPEG progressivo' : 'JPEG baseline'
      details.push({ key: 'encoding', label: 'Codificação', value: encoding })
      details.push({ key: 'precision', label: 'Precisão de cor', value: `${precision} bits por canal` })
      details.push({ key: 'components', label: 'Componentes', value: String(components) })
      if (components >= 3 && length >= 11) {
        const sampling = bytes[payload + 7]
        const horizontal = sampling >> 4
        const vertical = sampling & 0x0f
        const label = horizontal === 2 && vertical === 2 ? '4:2:0' : horizontal === 2 && vertical === 1 ? '4:2:2' : horizontal === 1 && vertical === 1 ? '4:4:4' : `${horizontal}×${vertical}`
        details.push({ key: 'subsampling', label: 'Subamostragem de cor', value: label })
      }
    }
    offset += length + 2
  }
  details.push({ key: 'structure', label: 'Estrutura JPEG', value: `${segmentCount} segmentos · ${quantizationTables} ${quantizationTables === 1 ? 'tabela' : 'tabelas'} de quantização` })
  let eoi = -1
  for (let index = bytes.length - 2; index >= 0; index -= 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) { eoi = index + 2; break }
  }
  if (eoi > 0 && eoi < bytes.length) details.push({ key: 'trailing', label: 'Dados após o fim da imagem', value: `${bytes.length - eoi} bytes` })
  return details
}

function pngTechnicalDetails(bytes: Uint8Array): TechnicalDetail[] {
  const details: TechnicalDetail[] = [{ key: 'signature', label: 'Assinatura do arquivo', value: 'PNG válido' }]
  if (bytes.length >= 29 && textAt(bytes, 12, 4) === 'IHDR') {
    const colorTypes: Record<number, string> = { 0: 'tons de cinza', 2: 'RGB', 3: 'paleta indexada', 4: 'cinza + alfa', 6: 'RGBA' }
    details.push({ key: 'pngColor', label: 'Modelo de cor', value: colorTypes[bytes[25]] ?? `tipo ${bytes[25]}` })
    details.push({ key: 'pngDepth', label: 'Profundidade', value: `${bytes[24]} bits` })
    details.push({ key: 'pngInterlace', label: 'Entrelaçamento', value: bytes[28] === 1 ? 'Adam7' : 'não' })
  }
  return details
}

function webpTechnicalDetails(bytes: Uint8Array): TechnicalDetail[] {
  const chunks: string[] = []
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = textAt(bytes, offset, 4)
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true)
    chunks.push(type.trim())
    offset += 8 + length + (length % 2)
  }
  return [
    { key: 'signature', label: 'Assinatura do arquivo', value: 'RIFF/WEBP válido' },
    { key: 'webpChunks', label: 'Estrutura WEBP', value: chunks.join(' · ') || 'sem chunks legíveis' },
  ]
}

export function analyzeContainer(buffer: ArrayBuffer, mime: string): TechnicalDetail[] {
  const bytes = new Uint8Array(buffer)
  if (mime === 'image/jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegTechnicalDetails(bytes)
  if (mime === 'image/png' && textAt(bytes, 1, 3) === 'PNG') return pngTechnicalDetails(bytes)
  if (mime === 'image/webp' && textAt(bytes, 0, 4) === 'RIFF' && textAt(bytes, 8, 4) === 'WEBP') return webpTechnicalDetails(bytes)
  return [{ key: 'signature', label: 'Assinatura do arquivo', value: 'não reconhecida' }]
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const joined = new Uint8Array(length)
  let offset = 0
  for (const part of parts) { joined.set(part, offset); offset += part.length }
  return joined
}

function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts = [bytes.slice(0, 2)]
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    if (marker === 0xda) {
      parts.push(bytes.slice(offset))
      break
    }
    if (marker === 0xd9) { parts.push(bytes.slice(offset, offset + 2)); break }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
    if (length < 2 || offset + length + 2 > bytes.length) return bytes
    const end = offset + length + 2
    const isMetadata = (marker >= 0xe1 && marker <= 0xed) || marker === 0xef || marker === 0xfe
    if (!isMetadata) parts.push(bytes.slice(offset, end))
    offset = end
  }
  return joinBytes(parts)
}

function stripPng(bytes: Uint8Array): Uint8Array {
  const parts = [bytes.slice(0, 8)]
  const removable = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'iCCP', 'tIME', 'pHYs'])
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0)
    const type = textAt(bytes, offset + 4, 4)
    const end = offset + length + 12
    if (end > bytes.length) return bytes
    if (!removable.has(type)) parts.push(bytes.slice(offset, end))
    offset = end
    if (type === 'IEND') break
  }
  return joinBytes(parts)
}

function stripWebp(bytes: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = textAt(bytes, offset, 4)
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true)
    const end = offset + 8 + length + (length % 2)
    if (end > bytes.length) return bytes
    if (!['EXIF', 'XMP_', 'ICCP'].includes(type)) {
      const chunk = bytes.slice(offset, end)
      if (type === 'VP8X' && chunk.length > 8) chunk[8] &= ~0x2c
      chunks.push(chunk)
    }
    offset = end
  }
  const body = joinBytes(chunks)
  const output = new Uint8Array(12 + body.length)
  output.set(bytes.slice(0, 12), 0)
  output.set(body, 12)
  new DataView(output.buffer).setUint32(4, output.length - 8, true)
  return output
}

export async function stripMetadataBlocks(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const stripped = blob.type === 'image/jpeg' ? stripJpeg(bytes)
    : blob.type === 'image/png' ? stripPng(bytes)
      : blob.type === 'image/webp' ? stripWebp(bytes)
        : bytes
  return new Blob([stripped as BlobPart], { type: blob.type })
}
