import { describe, expect, it } from 'vitest'
import { inspectMetadata } from './metadata'

describe('inspectMetadata', () => {
  it('classifica os campos estruturais JFIF de um JPEG sem metadados como detalhes técnicos', async () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x10,
      0x4a, 0x46, 0x49, 0x46, 0x00,
      0x01, 0x01, 0x00,
      0x00, 0x01, 0x00, 0x01,
      0x00, 0x00,
      0xff, 0xd9,
    ])
    const inspection = await inspectMetadata(new Blob([jpeg], { type: 'image/jpeg' }))
    expect(inspection.blocks).toEqual([])
    expect(inspection.items).toEqual([])
    expect(inspection.assessment.kind).toBe('clean')
    expect(inspection.technical).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'parsed-ThumbnailWidth', value: '0' }),
      expect.objectContaining({ key: 'parsed-ThumbnailHeight', value: '0' }),
    ]))
  })
})
