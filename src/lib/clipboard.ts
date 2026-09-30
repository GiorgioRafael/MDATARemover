import { ACCEPTED_TYPES } from './imageProcessing'

export const NO_CLIPBOARD_IMAGE = 'Nenhuma imagem encontrada na área de transferência. Copie uma imagem e tente novamente.'

const extensions: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function imageFromPaste(data: DataTransfer | null): File | null {
  if (!data) return null
  const files = Array.from(data.files)
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  return files.find((file) => ACCEPTED_TYPES.includes(file.type))
    ?? files.find((file) => file.type.startsWith('image/'))
    ?? null
}

export async function readClipboardImage(): Promise<File> {
  if (!navigator.clipboard?.read) {
    throw new Error('Seu navegador não permite colar pelo botão. Use Ctrl + V (ou ⌘ + V no Mac) para colar uma imagem.')
  }

  let items: ClipboardItem[]
  try {
    items = await navigator.clipboard.read()
  } catch (reason) {
    if (reason instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(reason.name)) {
      throw new Error('O navegador bloqueou o acesso à área de transferência. Use Ctrl + V (ou ⌘ + V no Mac) ou permita o acesso e tente novamente.')
    }
    throw new Error('Não foi possível ler a área de transferência. Copie a imagem novamente ou use Ctrl + V (ou ⌘ + V no Mac).')
  }

  for (const item of items) {
    const type = item.types.find((candidate) => ACCEPTED_TYPES.includes(candidate))
    if (!type) continue
    try {
      const blob = await item.getType(type)
      return new File([blob], `imagem-colada.${extensions[type]}`, { type })
    } catch {
      throw new Error('Não foi possível ler a imagem copiada. Copie-a novamente ou use Ctrl + V (ou ⌘ + V no Mac).')
    }
  }

  if (items.some((item) => item.types.some((type) => type.startsWith('image/')))) {
    throw new Error('Use uma imagem JPG, PNG ou WEBP.')
  }
  throw new Error(NO_CLIPBOARD_IMAGE)
}
