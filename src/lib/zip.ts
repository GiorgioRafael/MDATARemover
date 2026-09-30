import { Zip, ZipPassThrough } from 'fflate'

interface ZipImage {
  name: string
  blob: Blob
}

export async function createImageZip(images: ZipImage[]): Promise<Blob> {
  if (!images.length) throw new Error('Nenhuma foto limpa disponível para baixar.')
  if (images.reduce((size, image) => size + image.blob.size + 1024, 0) >= 0xffffffff) {
    throw new Error('As fotos ultrapassam o limite de tamanho do ZIP. Baixe-as individualmente ou selecione um lote menor.')
  }

  const parts: Blob[] = []
  const names = new Set<string>()
  const archive = new Zip((error, data) => {
    if (error) throw error
    parts.push(new Blob([new Uint8Array(data).buffer]))
  })

  try {
    for (const image of images) {
      const originalName = image.name.replace(/[/\\]/g, '_') || 'imagem-limpa.png'
      const extensionAt = originalName.lastIndexOf('.')
      const base = extensionAt > 0 ? originalName.slice(0, extensionAt) : originalName
      const extension = extensionAt > 0 ? originalName.slice(extensionAt) : ''
      let name = originalName
      for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${base}-${suffix}${extension}`
      names.add(name.toLowerCase())
      const entry = new ZipPassThrough(name)
      archive.add(entry)
      const chunkSize = 1024 * 1024
      for (let offset = 0; offset < image.blob.size; offset += chunkSize) {
        entry.push(new Uint8Array(await image.blob.slice(offset, offset + chunkSize).arrayBuffer()))
      }
      entry.push(new Uint8Array(0), true)
    }
    archive.end()
    return new Blob(parts, { type: 'application/zip' })
  } catch (reason) {
    archive.terminate()
    throw reason
  }
}
