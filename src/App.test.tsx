// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { MAX_FILE_SIZE, readImageInfo, removeMetadata } from './lib/imageProcessing'
import { inspectMetadata } from './lib/metadata'
import { createImageZip } from './lib/zip'
import type { ImageInfo, ImageInspection, ProcessedImage } from './types'

vi.mock('./lib/imageProcessing', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/imageProcessing')>(),
  readImageInfo: vi.fn(),
  removeMetadata: vi.fn(),
}))
vi.mock('./lib/metadata', () => ({ inspectMetadata: vi.fn() }))
vi.mock('./lib/zip', () => ({ createImageZip: vi.fn() }))

const info: ImageInfo = { name: 'imagem.png', type: 'image/png', size: 100, width: 20, height: 10 }
const inspection: ImageInspection = {
  items: [], blocks: [], technical: [],
  assessment: { kind: 'clean', title: 'Sem metadados', description: 'Nenhum dado pessoal encontrado.' },
}
const result: ProcessedImage = {
  blob: new Blob(['clean'], { type: 'image/png' }),
  url: 'blob:clean', name: 'imagem-limpa.png', info, inspection,
  report: { mode: 'metadata-only', transformations: [], academicWatermark: false },
}
const clipboardRead = vi.fn<() => Promise<ClipboardItem[]>>()
const NativeURL = URL

function clipboardItem(type: string): ClipboardItem {
  return { types: [type], getType: vi.fn().mockResolvedValue(new Blob(['image'], { type })) } as unknown as ClipboardItem
}

function paste(image?: File, target: Element = document.body) {
  fireEvent.paste(target, { clipboardData: { files: image ? [image] : [], items: [] } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => 'blob:original')
    static revokeObjectURL = vi.fn()
  })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: clipboardRead } })
  clipboardRead.mockResolvedValue([clipboardItem('image/png')])
  vi.mocked(readImageInfo).mockResolvedValue(info)
  vi.mocked(inspectMetadata).mockResolvedValue(inspection)
  vi.mocked(removeMetadata).mockResolvedValue(result)
  vi.mocked(createImageZip).mockResolvedValue(new Blob(['zip'], { type: 'application/zip' }))
})

describe('melhoria de qualidade', () => {
  it('aplica a ampliação escolhida na tela inicial também às imagens coladas', async () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Ampliação'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Colar imagem' }))
    await screen.findByRole('link', { name: 'Baixar imagem limpa' })
    expect(removeMetadata).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ mode: 'metadata-only', upscale: 4, signal: expect.any(AbortSignal), onProgress: expect.any(Function) }))
  })

  it('usa a mesma ampliação no lote e bloqueia alterações enquanto processa', async () => {
    let finish!: (value: ProcessedImage) => void
    vi.mocked(removeMetadata).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const { container } = render(<App />)
    fireEvent.change(screen.getByLabelText('Ampliação'), { target: { value: '2' } })
    const files = [new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.png', { type: 'image/png' })]
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } })
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 2 fotos' }))
    expect(screen.getByLabelText('Ampliação')).toBeDisabled()
    await act(async () => finish(result))
    await waitFor(() => expect(screen.getByText('2 de 2 limpas')).toBeVisible())
    expect(vi.mocked(removeMetadata).mock.calls.every((call) => call[1]?.upscale === 2)).toBe(true)
    expect(screen.getByLabelText('Ampliação')).toBeDisabled()
  })

  it('cancela o processamento e permite tentar novamente sem liberar saída parcial', async () => {
    vi.mocked(removeMetadata).mockImplementationOnce((_file, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true })
    }))
    render(<App />)
    fireEvent.change(screen.getByLabelText('Ampliação'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Colar imagem' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar processamento' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Processamento cancelado'))
    expect(screen.queryByRole('link', { name: 'Baixar imagem limpa' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Limpar e melhorar 2×' })).toBeEnabled()
  })

  it('retoma um lote cancelado sem reprocessar as fotos concluídas', async () => {
    vi.mocked(removeMetadata).mockResolvedValueOnce(result).mockImplementationOnce((_file, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true })
    }))
    const { container } = render(<App />)
    const files = ['a', 'b', 'c'].map((name) => new File(['photo'], `${name}.png`, { type: 'image/png' }))
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } })
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 3 fotos' }))
    await waitFor(() => expect(removeMetadata).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar processamento' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Limpar 2 fotos' })).toBeEnabled())
    expect(screen.getByRole('link', { name: 'Baixar a.png' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Baixar todas (.zip)' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 2 fotos' }))
    await waitFor(() => expect(screen.getByText('3 de 3 limpas')).toBeVisible())
    expect(removeMetadata).toHaveBeenCalledTimes(4)
    expect(vi.mocked(removeMetadata).mock.calls.filter((call) => call[0] === files[0])).toHaveLength(1)
  })
})

describe('limpeza em lote', () => {
  const photos = (count: number) => Array.from({ length: count }, (_, index) => new File(['image'], `foto-${index}.png`, { type: 'image/png' }))

  function select(files: File[]) {
    const { container } = render(<App />)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } })
    return container
  }

  it('acumula fotos selecionadas uma por vez e mantém a primeira no lote', async () => {
    const files = photos(3)
    const container = select([files[0]])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adicionar fotos' })).toBeEnabled())
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [files[1]] } })
    expect(screen.getByText('2 fotos selecionadas')).toBeVisible()
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [files[2]] } })
    expect(screen.getByText('3 fotos selecionadas')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 3 fotos' }))
    await waitFor(() => expect(screen.getByText('3 de 3 limpas')).toBeVisible())
    expect(vi.mocked(removeMetadata).mock.calls.map((call) => call[0])).toEqual(files)
  })

  it('acrescenta fotos arrastadas sem substituir o lote existente', () => {
    const container = select(photos(2))
    fireEvent.drop(container.querySelector('.dropzone')!, { dataTransfer: { files: [new File(['image'], 'nova.png', { type: 'image/png' })] } })
    expect(screen.getByText('3 fotos selecionadas')).toBeVisible()
    expect(screen.getByText('foto-0.png')).toBeVisible()
    expect(screen.getByText('foto-1.png')).toBeVisible()
    expect(screen.getByText('nova.png')).toBeVisible()
  })

  it('aplica o limite ao total acumulado sem perder as fotos anteriores', () => {
    const container = select(photos(99))
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: photos(2) } })
    expect(screen.getByRole('alert')).toHaveTextContent('Você selecionou 101')
    expect(screen.getByRole('alert')).toHaveTextContent('As fotos anteriores foram mantidas')
    expect(screen.getByText('99 fotos selecionadas')).toBeVisible()
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: photos(1) } })
    expect(screen.getByText('100 fotos selecionadas')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('substitui o lote apenas quando o usuário escolhe Substituir seleção', async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    const container = select(photos(2))
    fireEvent.click(screen.getByRole('button', { name: 'Substituir seleção' }))
    expect(inputClick).toHaveBeenCalledTimes(1)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'substituta.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adicionar fotos' })).toBeEnabled())
    expect(screen.queryByRole('heading', { name: 'Limpeza em lote' })).not.toBeInTheDocument()
    expect(screen.queryByText('foto-0.png')).not.toBeInTheDocument()
    expect(container.querySelector('.dropzone-file-copy')).toHaveTextContent('substituta.png')
  })

  it('preserva resultados concluídos e recria o ZIP ao acrescentar fotos', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const files = photos(3)
    const container = select(files.slice(0, 2))
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 2 fotos' }))
    await waitFor(() => expect(screen.getByText('2 de 2 limpas')).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: 'Baixar todas (.zip)' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adicionar fotos' })).toBeEnabled())
    expect(createImageZip).toHaveBeenCalledTimes(1)
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [files[2]] } })
    expect(screen.getByText('3 fotos selecionadas')).toBeVisible()
    expect(screen.getAllByRole('link', { name: /^Baixar foto-/ })).toHaveLength(2)
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(result.url)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 1 foto' }))
    await waitFor(() => expect(screen.getByText('3 de 3 limpas')).toBeVisible())
    expect(removeMetadata).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('button', { name: 'Baixar todas (.zip)' }))
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(2))
    expect(createImageZip).toHaveBeenLastCalledWith([result, result, result])
  })

  it('leva o resultado de uma imagem já limpa para o lote sem reprocessá-la', async () => {
    const files = photos(2)
    const container = select([files[0]])
    fireEvent.click(await screen.findByRole('button', { name: 'Remover todos os metadados' }))
    await screen.findByRole('link', { name: 'Baixar imagem limpa' })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [files[1]] } })
    expect(screen.getByText('1 de 2 limpas')).toBeVisible()
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(result.url)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 1 foto' }))
    await waitFor(() => expect(screen.getByText('2 de 2 limpas')).toBeVisible())
    expect(removeMetadata).toHaveBeenCalledTimes(2)
  })

  it('aceita 100 fotos e libera o download individual de cada resultado verificado', async () => {
    const container = select(photos(100))
    expect(screen.getByText('100 fotos selecionadas')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Baixar todas (.zip)' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 100 fotos' }))
    await waitFor(() => expect(container.querySelector('.batch-count')).toHaveTextContent('100 de 100 limpas'), { timeout: 10000 })
    expect(screen.getAllByRole('link', { name: /^Baixar foto-/ })).toHaveLength(100)
    expect(removeMetadata).toHaveBeenCalledTimes(100)
    expect(screen.getByRole('button', { name: 'Baixar todas (.zip)' })).toBeEnabled()
    expect(screen.getByRole('progressbar', { name: 'Progresso da limpeza' })).toHaveAttribute('value', '100')
  }, 15000)

  it('recusa mais de 100 fotos sem iniciar o processamento', () => {
    select(photos(101))
    expect(screen.getByRole('alert')).toHaveTextContent('no máximo 100 fotos')
    expect(screen.getByRole('alert')).toHaveTextContent('Você selecionou 101')
    expect(screen.queryByRole('heading', { name: 'Limpeza em lote' })).not.toBeInTheDocument()
    expect(removeMetadata).not.toHaveBeenCalled()
  })

  it('limpa uma foto por vez e bloqueia substituição ou novo processamento durante o lote', async () => {
    let finishFirst!: (value: ProcessedImage) => void
    vi.mocked(removeMetadata).mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve }))
    const container = select(photos(2))
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 2 fotos' }))
    expect(removeMetadata).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Novo lote' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Limpando fotos…' })).toBeDisabled()
    fireEvent.drop(container.querySelector('.dropzone')!, { dataTransfer: { files: photos(3) } })
    expect(screen.getByText('2 fotos selecionadas')).toBeVisible()
    await act(async () => finishFirst(result))
    await waitFor(() => expect(screen.getByText('2 de 2 limpas')).toBeVisible())
    expect(removeMetadata).toHaveBeenCalledTimes(2)
  })

  it('continua após uma falha e permite tentar novamente apenas a foto que falhou', async () => {
    vi.mocked(removeMetadata).mockRejectedValueOnce(new Error('Foto corrompida'))
    select(photos(3))
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 3 fotos' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Limpar 1 foto' })).toBeEnabled())
    expect(screen.getByText('2 de 3 limpas')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Foto corrompida')
    expect(screen.getAllByRole('link', { name: /^Baixar foto-/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 1 foto' }))
    await waitFor(() => expect(screen.getByText('3 de 3 limpas')).toBeVisible())
    expect(removeMetadata).toHaveBeenCalledTimes(4)
  })

  it('mantém arquivos inválidos fora da limpeza e do download', async () => {
    select([...photos(2), new File(['gif'], 'animada.gif', { type: 'image/gif' })])
    expect(screen.getByRole('alert')).toHaveTextContent('Use uma imagem JPG, PNG ou WEBP')
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 2 fotos' }))
    await waitFor(() => expect(screen.getByText('2 de 3 limpas')).toBeVisible())
    expect(removeMetadata).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('link', { name: 'Baixar animada.gif' })).not.toBeInTheDocument()
  })

  it('não libera um arquivo se a inspeção final ainda detectar metadados', async () => {
    vi.mocked(removeMetadata).mockResolvedValueOnce({ ...result, inspection: { ...inspection, blocks: [{ label: 'EXIF', bytes: 12 }] } })
    select(photos(2))
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 2 fotos' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Limpar 1 foto' })).toBeEnabled())
    expect(screen.getByRole('alert')).toHaveTextContent('Ainda foram encontrados metadados')
    expect(screen.queryByRole('link', { name: 'Baixar foto-0.png' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Baixar foto-1.png' })).toBeVisible()
  })

  it('gera o ZIP só com resultados limpos, reaproveita o arquivo e limpa os recursos ao reiniciar', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.mocked(removeMetadata).mockRejectedValueOnce(new Error('Falha individual'))
    select(photos(3))
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 3 fotos' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Baixar todas (.zip)' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Baixar todas (.zip)' }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(createImageZip).toHaveBeenCalledWith([result, result])
    expect(click.mock.instances[0]).toHaveAttribute('download', 'cleanframe-fotos-limpas.zip')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Baixar todas (.zip)' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Baixar todas (.zip)' }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2))
    expect(createImageZip).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Novo lote' }))
    expect(screen.getByRole('button', { name: 'Colar imagem' })).toBeVisible()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
    click.mockRestore()
  })

  it('preserva os downloads individuais e permite tentar novamente se a geração do ZIP falhar', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.mocked(createImageZip).mockRejectedValueOnce(new Error('Não foi possível gerar o ZIP.'))
    select(photos(2))
    fireEvent.click(screen.getByRole('button', { name: 'Limpar 2 fotos' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Baixar todas (.zip)' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Baixar todas (.zip)' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível gerar o ZIP')
    expect(screen.getAllByRole('link', { name: /^Baixar foto-/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Baixar todas (.zip)' }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    click.mockRestore()
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('colar e limpar imagens', () => {
  it.each([
    ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'],
  ])('identifica %s pelo botão e disponibiliza o download automaticamente', async (type, extension) => {
    clipboardRead.mockResolvedValue([clipboardItem(type)])
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Colar imagem' }))
    expect(await screen.findByRole('link', { name: 'Baixar imagem limpa' })).toHaveAttribute('download', result.name)
    expect(removeMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ type, name: `imagem-colada.${extension}` }),
      expect.objectContaining({ mode: 'metadata-only' }),
    )
  })

  it('limpa a imagem recebida pelo atalho sem pedir acesso à área de transferência', async () => {
    const image = new File(['image'], 'captura.png', { type: 'image/png' })
    render(<App />)
    paste(image)
    expect(await screen.findByRole('link', { name: 'Baixar imagem limpa' })).toBeVisible()
    expect(clipboardRead).not.toHaveBeenCalled()
    expect(removeMetadata).toHaveBeenCalledWith(image, expect.objectContaining({ mode: 'metadata-only' }))
  })

  it('informa quando foi copiado apenas texto ou um link', async () => {
    clipboardRead.mockResolvedValue([clipboardItem('text/plain')])
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Colar imagem' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nenhuma imagem encontrada')
    expect(removeMetadata).not.toHaveBeenCalled()
    paste()
    expect(screen.getByRole('alert')).toHaveTextContent('Copie uma imagem')
  })

  it('orienta a usar o atalho quando a permissão é negada', async () => {
    clipboardRead.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Colar imagem' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('O navegador bloqueou')
    expect(screen.getByRole('alert')).toHaveTextContent('Ctrl + V')
    paste(new File(['image'], 'captura.png', { type: 'image/png' }))
    expect(await screen.findByRole('link', { name: 'Baixar imagem limpa' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('permite colar pelo atalho quando a API do botão não existe', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Colar imagem' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Use Ctrl + V')
    paste(new File(['image'], 'captura.png', { type: 'image/png' }))
    expect(await screen.findByRole('link', { name: 'Baixar imagem limpa' })).toBeVisible()
  })

  it('rejeita formatos não suportados e imagens maiores que 25 MB', async () => {
    render(<App />)
    await act(async () => paste(new File(['GIF89a'], 'animacao.gif', { type: 'image/gif' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Use uma imagem JPG, PNG ou WEBP')
    paste(new File([new Uint8Array(MAX_FILE_SIZE + 1)], 'grande.png', { type: 'image/png' }))
    expect(screen.getByRole('alert')).toHaveTextContent('no máximo 25 MB')
    expect(readImageInfo).not.toHaveBeenCalled()
    expect(removeMetadata).not.toHaveBeenCalled()
  })

  it('exibe o erro de decodificação sem oferecer um download', async () => {
    vi.mocked(readImageInfo).mockRejectedValueOnce(new Error('Invalid image'))
    render(<App />)
    paste(new File(['invalid'], 'invalida.png', { type: 'image/png' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ler esta imagem')
    expect(screen.queryByRole('link', { name: 'Baixar imagem limpa' })).not.toBeInTheDocument()
    expect(removeMetadata).not.toHaveBeenCalled()
  })

  it('exibe o erro de limpeza e permite tentar novamente', async () => {
    vi.mocked(removeMetadata).mockRejectedValueOnce(new Error('Não foi possível gerar a imagem limpa.'))
    render(<App />)
    paste(new File(['image'], 'captura.png', { type: 'image/png' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível gerar a imagem limpa')
    fireEvent.click(screen.getByRole('button', { name: 'Remover todos os metadados' }))
    expect(await screen.findByRole('link', { name: 'Baixar imagem limpa' })).toBeVisible()
  })

  it('ignora novas imagens enquanto a primeira está sendo inspecionada', async () => {
    let finishInspection!: (value: ImageInfo) => void
    vi.mocked(readImageInfo).mockReturnValueOnce(new Promise((resolve) => { finishInspection = resolve }))
    render(<App />)
    paste(new File(['first'], 'primeira.png', { type: 'image/png' }))
    paste(new File(['second'], 'segunda.png', { type: 'image/png' }))
    expect(readImageInfo).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Remover imagem' })).toBeDisabled()
    await act(async () => finishInspection(info))
    expect(await screen.findByRole('link', { name: 'Baixar imagem limpa' })).toBeVisible()
    expect(removeMetadata).toHaveBeenCalledTimes(1)
  })

  it('mantém a limpeza manual para arquivos selecionados e não interfere na colagem em campos', async () => {
    const { container } = render(<App />)
    const image = new File(['image'], 'selecionada.png', { type: 'image/png' })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [image] } })
    await screen.findByRole('button', { name: 'Remover todos os metadados' })
    expect(removeMetadata).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: /Laboratório de robustez/ }))
    const seedInput = screen.getByLabelText('Semente reproduzível')
    paste(image, seedInput)
    expect(removeMetadata).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    paste(image)
    await waitFor(() => expect(removeMetadata).toHaveBeenCalledWith(image, expect.objectContaining({ mode: 'metadata-only' })))
    expect(await screen.findByRole('link', { name: 'Baixar imagem limpa' })).toBeVisible()
  })
})
