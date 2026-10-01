import { describe, expect, it } from 'vitest'
import { imageTiles, TILE_PADDING, upscaleDimensions } from './upscaleGeometry'

describe('dimensões e montagem do upscale', () => {
  it('amplia exatamente 2× ou 4× sem alterar a proporção', () => {
    expect(upscaleDimensions(321, 179, 2)).toEqual({ width: 642, height: 358 })
    expect(upscaleDimensions(321, 179, 4)).toEqual({ width: 1284, height: 716 })
  })

  it('impede alocações além do limite antes de processar a imagem', () => {
    expect(upscaleDimensions(2000, 2000, 2)).toEqual({ width: 4000, height: 4000 })
    expect(() => upscaleDimensions(2001, 2000, 2)).toThrow('16 megapixels')
    expect(() => upscaleDimensions(4097, 10, 2)).toThrow('8.192 px')
    expect(() => upscaleDimensions(0, 20, 2)).toThrow('dimensões inválidas')
  })

  it('cobre imagens com dimensões ímpares uma única vez e preserva as bordas reais', () => {
    const width = 273, height = 139
    const coverage = new Uint8Array(width * height)
    for (const tile of imageTiles(width, height)) {
      for (let y = tile.y; y < tile.y + tile.height; y++) {
        for (let x = tile.x; x < tile.x + tile.width; x++) coverage[y * width + x]++
      }
      expect(tile.left).toBeGreaterThanOrEqual(0)
      expect(tile.top).toBeGreaterThanOrEqual(0)
      expect(tile.left + tile.inputWidth).toBeLessThanOrEqual(width)
      expect(tile.top + tile.inputHeight).toBeLessThanOrEqual(height)
    }
    expect(coverage.every((count) => count === 1)).toBe(true)
  })

  it('inclui o campo receptivo completo entre blocos para evitar costuras', () => {
    const center = imageTiles(512, 512).find((tile) => tile.x === 128 && tile.y === 128)!
    expect(center.x - center.left).toBe(TILE_PADDING)
    expect(center.y - center.top).toBe(TILE_PADDING)
    expect(center.inputWidth).toBe(center.width + TILE_PADDING * 2)
    expect(center.inputHeight).toBe(center.height + TILE_PADDING * 2)
    expect(imageTiles(1, 1)).toEqual([{ x: 0, y: 0, width: 1, height: 1, left: 0, top: 0, inputWidth: 1, inputHeight: 1 }])
  })
})
