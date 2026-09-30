import { describe, expect, it } from 'vitest'
import { analyzeContainer, scanMetadataBlocks, stripMetadataBlocks } from './containerMetadata'

function jpegWithApp(marker: number, payload: number[]): ArrayBuffer {
  const length = payload.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, marker, length >> 8, length & 0xff, ...payload, 0xff, 0xda]).buffer
}

describe('scanMetadataBlocks', () => {
  it('detecta um bloco EXIF em JPEG', () => {
    const payload = Array.from(new TextEncoder().encode('Exif\0\0teste'))
    expect(scanMetadataBlocks(jpegWithApp(0xe1, payload), 'image/jpeg')[0]?.label).toBe('EXIF')
  })

  it('ignora segmentos visuais comuns do JPEG', () => {
    expect(scanMetadataBlocks(jpegWithApp(0xdb, [1, 2, 3]), 'image/jpeg')).toEqual([])
  })

  it('remove blocos EXIF e mantém os demais segmentos do JPEG', async () => {
    const payload = Array.from(new TextEncoder().encode('Exif\0\0teste'))
    const input = jpegWithApp(0xe1, payload)
    const result = await stripMetadataBlocks(new Blob([input], { type: 'image/jpeg' }))
    expect(scanMetadataBlocks(await result.arrayBuffer(), 'image/jpeg')).toEqual([])
  })

  it('detecta blocos APP desconhecidos que também podem carregar rastros', () => {
    const payload = Array.from(new TextEncoder().encode('Ducky\0dados'))
    expect(scanMetadataBlocks(jpegWithApp(0xec, payload), 'image/jpeg')[0]?.label).toContain('APP12')
  })

  it('separa propriedades técnicas de metadados removíveis', () => {
    const details = analyzeContainer(jpegWithApp(0xdb, [1, 2, 3]), 'image/jpeg')
    expect(details.some((detail) => detail.label === 'Assinatura do arquivo')).toBe(true)
    expect(scanMetadataBlocks(jpegWithApp(0xdb, [1, 2, 3]), 'image/jpeg')).toEqual([])
  })
})
