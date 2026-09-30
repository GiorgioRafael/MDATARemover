import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { createImageZip } from './zip'

describe('createImageZip', () => {
  it('gera um ZIP extraível com todas as imagens e preserva seus bytes', async () => {
    const images = Array.from({ length: 100 }, (_, index) => ({
      name: `foto-${index}.png`, blob: new Blob([new Uint8Array([index, 137, 80, 78, 71])]),
    }))
    const archive = await createImageZip(images)
    const extracted = unzipSync(new Uint8Array(await archive.arrayBuffer()))
    expect(archive.type).toBe('application/zip')
    expect(Object.keys(extracted)).toHaveLength(100)
    for (const [index, image] of images.entries()) {
      expect(extracted[image.name]).toEqual(new Uint8Array([index, 137, 80, 78, 71]))
    }
  })

  it('mantém arquivos com nomes iguais, diferenças de maiúsculas e sufixos já existentes', async () => {
    const names = ['foto-limpa.png', 'foto-limpa.png', 'FOTO-LIMPA.PNG', 'foto-limpa-2.png', 'ação-limpa.webp']
    const archive = await createImageZip(names.map((name, index) => ({ name, blob: new Blob([String(index)]) })))
    const extracted = unzipSync(new Uint8Array(await archive.arrayBuffer()))
    expect(Object.keys(extracted)).toEqual(['foto-limpa.png', 'foto-limpa-2.png', 'FOTO-LIMPA-3.PNG', 'foto-limpa-2-2.png', 'ação-limpa.webp'])
    expect(Object.values(extracted).map((bytes) => new TextDecoder().decode(bytes))).toEqual(['0', '1', '2', '3', '4'])
  })

  it('lê imagens em partes e mantém o conteúdo completo de um arquivo maior que um bloco', async () => {
    const bytes = new Uint8Array(1024 * 1024 + 23).fill(73)
    const archive = await createImageZip([{ name: 'grande.png', blob: new Blob([bytes]) }])
    const extracted = unzipSync(new Uint8Array(await archive.arrayBuffer()))['grande.png']
    expect(extracted.length).toBe(bytes.length)
    expect(extracted.every((byte, index) => byte === bytes[index])).toBe(true)
  })

  it('recusa um lote vazio', async () => {
    await expect(createImageZip([])).rejects.toThrow('Nenhuma foto limpa')
  })
})
