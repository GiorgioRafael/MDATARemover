import type { UpscaleScale } from '../types'

export const MODEL_SCALE = 4
export const TILE_SIZE = 128
// 34 convolutions with 3x3 kernels: the complete receptive field avoids tile seams.
export const TILE_PADDING = 34
export const MAX_UPSCALE_PIXELS = 16_000_000
export const MAX_UPSCALE_EDGE = 8192

export function upscaleDimensions(width: number, height: number, scale: UpscaleScale) {
  if (scale !== 2 && scale !== 4) throw new Error('Escolha uma ampliação de 2× ou 4×.')
  const outputWidth = width * scale
  const outputHeight = height * scale
  if (width < 1 || height < 1 || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('A imagem tem dimensões inválidas.')
  }
  if (outputWidth * outputHeight > MAX_UPSCALE_PIXELS || Math.max(outputWidth, outputHeight) > MAX_UPSCALE_EDGE) {
    throw new Error(`A ampliação de ${scale}× excede o limite de 16 megapixels ou 8.192 px por lado. Use 2×, uma imagem menor ou desative a melhoria de qualidade.`)
  }
  return { width: outputWidth, height: outputHeight }
}

export function imageTiles(width: number, height: number, tileSize = TILE_SIZE) {
  const tiles = []
  for (let y = 0; y < height; y += tileSize) {
    for (let x = 0; x < width; x += tileSize) {
      const tileWidth = Math.min(tileSize, width - x)
      const tileHeight = Math.min(tileSize, height - y)
      const left = Math.max(0, x - TILE_PADDING)
      const top = Math.max(0, y - TILE_PADDING)
      const right = Math.min(width, x + tileWidth + TILE_PADDING)
      const bottom = Math.min(height, y + tileHeight + TILE_PADDING)
      tiles.push({ x, y, width: tileWidth, height: tileHeight, left, top, inputWidth: right - left, inputHeight: bottom - top })
    }
  }
  return tiles
}
