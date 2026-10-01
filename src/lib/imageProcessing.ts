import type { ImageInfo, ProcessedImage, ProcessingOptions, ProcessingReport } from '../types'
import { cleanFileName } from './format'
import { stripMetadataBlocks } from './containerMetadata'
import { inspectMetadata } from './metadata'
import { describeRecipe, drawRobustnessStudy } from './robustnessLab'

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_FILE_SIZE = 25 * 1024 * 1024

export function validateImage(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Use uma imagem JPG, PNG ou WEBP.'
  if (file.size > MAX_FILE_SIZE) return 'A imagem deve ter no máximo 25 MB.'
  return null
}

async function loadImage(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch (reason) {
      throw new Error('Não foi possível ler esta imagem. Tente exportá-la novamente como JPG, PNG ou WEBP.', { cause: reason })
    }
  }
  const url = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try { await image.decode() }
  catch (reason) {
    URL.revokeObjectURL(url)
    throw new Error('Não foi possível ler esta imagem. Tente exportá-la novamente como JPG, PNG ou WEBP.', { cause: reason })
  }
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) }
}

export async function readImageInfo(file: File): Promise<ImageInfo> {
  const decoded = await loadImage(file)
  const info = { name: file.name, type: file.type, size: file.size, width: decoded.width, height: decoded.height }
  decoded.close?.()
  return info
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Não foi possível gerar a imagem limpa.')), type, quality)
  })
}

export async function removeMetadata(
  file: File,
  options: ProcessingOptions = { mode: 'metadata-only', preset: 'leve', seed: 'tcc-001' },
): Promise<ProcessedImage> {
  options.signal?.throwIfAborted()
  const decoded = await loadImage(file)
  let canvas = document.createElement('canvas')
  const canvases = [canvas]
  try {
    canvas.width = decoded.width
    canvas.height = decoded.height
    let context = canvas.getContext('2d', { alpha: file.type !== 'image/jpeg', willReadFrequently: Boolean(options.upscale || options.mode === 'robustness-study') })
    if (!context) throw new Error('Seu navegador não oferece suporte ao processamento desta imagem.')
    if (file.type === 'image/jpeg') {
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    let transformations = ['Reconstrução dos pixels em um novo arquivo', 'Remoção de blocos EXIF, XMP, IPTC, ICC e texto']
    let quality = 0.95
    let upscale: ProcessingReport['upscale']
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
    decoded.close?.()
    decoded.close = undefined
    if (options.upscale) {
      options.onProgress?.({ message: 'Preparando melhoria de qualidade…' })
      const { upscaleCanvas } = await import('./upscale')
      const enhanced = await upscaleCanvas(canvas, options.upscale, options)
      canvas.width = 0; canvas.height = 0
      canvas = enhanced.canvas
      canvases.push(canvas)
      context = canvas.getContext('2d')!
      upscale = { algorithm: 'Real-ESRGAN', scale: options.upscale, originalWidth: decoded.width, originalHeight: decoded.height, backend: enhanced.backend }
      transformations.push(`Super-resolução Real-ESRGAN ${options.upscale}× com redução de ruído equilibrada`)
      quality = 0.97
    }
    options.signal?.throwIfAborted()
    if (options.mode === 'robustness-study') {
      const visualSource = canvas
      canvas = document.createElement('canvas')
      canvases.push(canvas)
      canvas.width = visualSource.width; canvas.height = visualSource.height
      context = canvas.getContext('2d', { alpha: file.type !== 'image/jpeg' })!
      const recipe = drawRobustnessStudy(context, visualSource, canvas.width, canvas.height, options.preset, options.seed)
      transformations = [...transformations, ...describeRecipe(recipe)]
      quality = recipe.quality
    }

    options.onProgress?.({ message: 'Removendo metadados e verificando o arquivo final…' })
    const outputType = file.type
    const encoded = await canvasToBlob(canvas, outputType, outputType === 'image/jpeg' || outputType === 'image/webp' ? quality : undefined)
    const blob = await stripMetadataBlocks(encoded)
    const name = cleanFileName(file.name, outputType).replace(/-limpa\./, options.upscale ? `-limpa-${options.upscale}x.` : '-limpa.')
    const inspection = await inspectMetadata(blob)
    options.signal?.throwIfAborted()
    if (inspection.items.length || inspection.blocks.length) throw new Error('Ainda foram encontrados metadados. Tente limpar esta imagem novamente.')
    return {
      blob,
      url: URL.createObjectURL(blob),
      name,
      info: { name, type: outputType, size: blob.size, width: canvas.width, height: canvas.height },
      inspection,
      report: {
        mode: options.mode,
        preset: options.mode === 'robustness-study' ? options.preset : undefined,
        seed: options.mode === 'robustness-study' ? options.seed : undefined,
        transformations,
        academicWatermark: options.mode === 'robustness-study',
        upscale,
      },
    }
  } finally {
    decoded.close?.()
    for (const surface of canvases) { surface.width = 0; surface.height = 0 }
  }
}
