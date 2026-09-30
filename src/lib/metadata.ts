import type { ImageInspection, MetadataCategory, MetadataItem, TechnicalDetail } from '../types'
import { analyzeContainer, scanMetadataBlocks } from './containerMetadata'

const ignoredTechnicalKeys = new Set([
  'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight', 'BitsPerSample',
  'Compression', 'PhotometricInterpretation', 'SamplesPerPixel', 'RowsPerStrip',
  'StripByteCounts', 'StripOffsets', 'PlanarConfiguration', 'YCbCrSubSampling',
  'YCbCrPositioning', 'ColorSpace', 'ComponentsConfiguration', 'JFIFVersion',
  'ResolutionUnit', 'XResolution', 'YResolution', 'InteroperabilityIndex',
  'BitDepth', 'ColorType', 'Filter', 'Interlace',
  'ThumbnailWidth', 'ThumbnailHeight',
])

const labels: Record<string, string> = {
  Make: 'Fabricante', Model: 'Modelo', LensModel: 'Lente', Software: 'Software',
  DateTimeOriginal: 'Data da captura', CreateDate: 'Data de criação', ModifyDate: 'Data de modificação',
  Artist: 'Autor', Copyright: 'Direitos autorais', ImageDescription: 'Descrição',
  GPSLatitude: 'Latitude', GPSLongitude: 'Longitude', GPSAltitude: 'Altitude',
  latitude: 'Latitude', longitude: 'Longitude', ExposureTime: 'Tempo de exposição',
  FNumber: 'Abertura', ISO: 'ISO', FocalLength: 'Distância focal',
  Orientation: 'Orientação', UserComment: 'Comentário', XPComment: 'Comentário',
  XPAuthor: 'Autor', Creator: 'Criador', Credit: 'Crédito', Source: 'Fonte',
  DocumentName: 'Nome do documento', SerialNumber: 'Número de série',
  BodySerialNumber: 'Número de série da câmera', LensSerialNumber: 'Número de série da lente',
  Rating: 'Avaliação', Keywords: 'Palavras-chave', Subject: 'Assunto', Title: 'Título',
}

const technicalLabels: Record<string, string> = {
  ImageWidth: 'Largura declarada', ImageHeight: 'Altura declarada',
  ExifImageWidth: 'Largura EXIF', ExifImageHeight: 'Altura EXIF',
  BitsPerSample: 'Bits por amostra', Compression: 'Compressão',
  PhotometricInterpretation: 'Interpretação de cor', SamplesPerPixel: 'Amostras por pixel',
  PlanarConfiguration: 'Configuração dos canais', YCbCrSubSampling: 'Subamostragem YCbCr',
  YCbCrPositioning: 'Posicionamento YCbCr', ColorSpace: 'Espaço de cor',
  JFIFVersion: 'Versão JFIF', ResolutionUnit: 'Unidade de resolução',
  XResolution: 'Resolução horizontal', YResolution: 'Resolução vertical',
  BitDepth: 'Profundidade', ColorType: 'Modelo de cor', Filter: 'Filtro PNG',
  Interlace: 'Entrelaçamento',
  ThumbnailWidth: 'Largura da miniatura JFIF', ThumbnailHeight: 'Altura da miniatura JFIF',
}

function categoryFor(key: string): MetadataCategory {
  const lower = key.toLowerCase()
  if (lower.includes('gps') || ['latitude', 'longitude'].includes(lower)) return 'Localização'
  if (/make|model|lens|exposure|fnumber|iso|focal|flash|shutter|aperture|serial/.test(lower)) return 'Câmera'
  if (/artist|author|creator|copyright|credit|owner|byline/.test(lower)) return 'Autoria'
  if (/orientation|color|pixel|resolution|width|height/.test(lower)) return 'Imagem'
  return 'Outros'
}

function isSensitive(key: string): boolean {
  return /gps|latitude|longitude|location|serial|owner|artist|author|creator|copyright|date|time/i.test(key)
}

function displayValue(value: unknown): string {
  if (value instanceof Date) return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'medium' }).format(value)
  if (Array.isArray(value)) return value.map(displayValue).join(', ')
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  if (typeof value === 'number') return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 6 }).format(value)
  return String(value)
}

function flattenObject(value: Record<string, unknown>, prefix = ''): MetadataItem[] {
  const result: MetadataItem[] = []
  for (const [key, raw] of Object.entries(value)) {
    if (raw == null || ignoredTechnicalKeys.has(key) || ArrayBuffer.isView(raw) || raw instanceof ArrayBuffer) continue
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof raw === 'object' && !(raw instanceof Date) && !Array.isArray(raw)) {
      result.push(...flattenObject(raw as Record<string, unknown>, fullKey))
      continue
    }
    const shown = displayValue(raw)
    if (!shown || shown === '[]' || shown === '{}') continue
    result.push({
      key: fullKey,
      label: labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2'),
      value: shown,
      category: categoryFor(key),
      sensitive: isSensitive(key),
    })
  }
  return result
}

function technicalFromParsed(parsed: Record<string, unknown>): TechnicalDetail[] {
  const details: TechnicalDetail[] = []
  for (const [key, value] of Object.entries(parsed)) {
    if (!ignoredTechnicalKeys.has(key) || value == null || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue
    const shown = displayValue(value)
    if (shown) details.push({ key: `parsed-${key}`, label: technicalLabels[key] ?? key, value: shown })
  }
  return details
}

async function fileFingerprint(buffer: ArrayBuffer): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 20).toUpperCase()
  } catch {
    return null
  }
}

function dedupeTechnical(details: TechnicalDetail[]): TechnicalDetail[] {
  const seen = new Set<string>()
  return details.filter((detail) => {
    if (seen.has(detail.label)) return false
    seen.add(detail.label)
    return true
  })
}

export async function inspectMetadata(file: Blob): Promise<ImageInspection> {
  const buffer = await file.arrayBuffer()
  const fingerprintPromise = fileFingerprint(buffer)
  let parsed: Record<string, unknown> = {}
  try {
    const { default: exifr } = await import('exifr')
    parsed = (await exifr.parse(buffer, {
      tiff: true, exif: true, gps: true, xmp: true, iptc: true,
      icc: true, jfif: true, ihdr: true, translateKeys: true,
      translateValues: true, reviveValues: true, mergeOutput: true,
    })) ?? {}
  } catch {
    parsed = {}
  }
  const items = flattenObject(parsed)
  const blocks = scanMetadataBlocks(buffer, file.type)
  const fingerprint = await fingerprintPromise
  const fileName = 'name' in file && typeof file.name === 'string' ? file.name : ''
  const looksLikePlatformCopy = /^[a-f0-9]{24,}\.(?:jpe?g|png|webp)$/i.test(fileName)
  const localModified = 'lastModified' in file && typeof file.lastModified === 'number'
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(file.lastModified))
    : null
  const technical = dedupeTechnical([
    ...analyzeContainer(buffer, file.type),
    ...technicalFromParsed(parsed),
    ...(fingerprint ? [{ key: 'sha256', label: 'Impressão digital do arquivo', value: `SHA-256 ${fingerprint}…` }] : []),
    ...(localModified ? [{ key: 'localModified', label: 'Modificado no dispositivo', value: `${localModified} (não é dado embutido)` }] : []),
  ])
  const found = items.length + blocks.length > 0
  return {
    items,
    blocks,
    technical,
    assessment: found
      ? { kind: 'found', title: 'Há dados embutidos removíveis', description: 'Os registros abaixo fazem parte do arquivo e serão descartados na limpeza.' }
      : looksLikePlatformCopy
        ? { kind: 'platform-copy', title: 'Provável cópia processada por plataforma', description: 'O nome hexadecimal e a ausência de EXIF/XMP são compatíveis com uma imagem renomeada e recomprimida por CDN. Os dados originais provavelmente já foram removidos antes do download.' }
        : { kind: 'clean', title: 'O arquivo já veio sem metadados pessoais', description: 'Nenhum bloco EXIF, XMP, IPTC, ICC ou comentário foi localizado. A análise técnica abaixo descreve o arquivo, mas não representa dados pessoais removíveis.' },
  }
}
