// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VideoWorkspace } from './VideoWorkspace'
import { inspectVideo, removeVideoMetadata, validateVideo } from '../lib/videoProcessing'
import type { ProcessedVideo, VideoInspection } from '../lib/videoProcessing'

vi.mock('../lib/videoProcessing', () => ({
  MAX_VIDEO_SIZE: 2 * 1024 ** 3,
  inspectVideo: vi.fn(),
  removeVideoMetadata: vi.fn(),
  validateVideo: vi.fn(),
}))

const inspection: VideoInspection = {
  format: 'MP4', width: 1920, height: 1080, duration: 65,
  metadata: [{ label: 'Localização', value: '-23.55,-46.63' }, { label: 'Autor', value: 'Nome original' }],
}
const result: ProcessedVideo = {
  blob: new Blob(['clean'], { type: 'video/mp4' }),
  url: 'blob:clean-video', name: 'video-limpo.mp4', removedCount: 2,
  inspection: { ...inspection, metadata: [] },
}
const NativeURL = URL

beforeEach(() => {
  vi.resetAllMocks()
  let nextUrl = 0
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => `blob:original-video-${++nextUrl}`)
    static revokeObjectURL = vi.fn()
  })
  vi.mocked(validateVideo).mockReturnValue(null)
  vi.mocked(inspectVideo).mockResolvedValue(inspection)
  vi.mocked(removeVideoMetadata).mockResolvedValue(result)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function select(name = 'video.mp4') {
  const file = new File(['video'], name, { type: 'video/mp4' })
  fireEvent.change(screen.getByLabelText('Selecionar vídeo'), { target: { files: [file] } })
  return file
}

describe('limpeza de metadados de vídeos', () => {
  it('inspeciona o original e libera o download somente após verificar a cópia limpa', async () => {
    render(<VideoWorkspace />)
    const file = select()
    expect(await screen.findByText('Nome original')).toBeVisible()
    expect(screen.getByText('1:05')).toBeVisible()
    expect(screen.getByText('1.920 × 1.080 px')).toBeVisible()
    expect(screen.getByText(/sem recodificar vídeo ou áudio/)).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Baixar vídeo limpo' })).not.toBeInTheDocument()
    expect(removeVideoMetadata).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Remover metadados do vídeo' }))
    const download = await screen.findByRole('link', { name: 'Baixar vídeo limpo' })
    expect(download).toHaveAttribute('href', result.url)
    expect(download).toHaveAttribute('download', result.name)
    expect(screen.getByText('Limpeza verificada')).toBeVisible()
    expect(removeVideoMetadata).toHaveBeenCalledWith(file, { signal: expect.any(AbortSignal), onProgress: expect.any(Function) })
    expect(inspectVideo).toHaveBeenCalledWith(file, { signal: expect.any(AbortSignal) })
  })

  it('recusa formatos inválidos sem ler ou limpar o arquivo', () => {
    vi.mocked(validateVideo).mockReturnValueOnce('Use um vídeo MP4, MOV ou M4V.')
    render(<VideoWorkspace />)
    select('video.avi')
    expect(screen.getByRole('alert')).toHaveTextContent('Use um vídeo MP4, MOV ou M4V.')
    expect(inspectVideo).not.toHaveBeenCalled()
    expect(removeVideoMetadata).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('aceita um vídeo arrastado e informa quando há mais de um arquivo', async () => {
    const { container } = render(<VideoWorkspace />)
    const files = ['a.mp4', 'b.mov'].map((name) => new File(['video'], name, { type: 'video/mp4' }))
    fireEvent.drop(container.querySelector('.video-dropzone')!, { dataTransfer: { files } })
    expect(screen.getByRole('alert')).toHaveTextContent('Selecione um vídeo por vez.')
    expect(inspectVideo).not.toHaveBeenCalled()
    fireEvent.drop(container.querySelector('.video-dropzone')!, { dataTransfer: { files: [files[0]] } })
    await screen.findByRole('button', { name: 'Remover metadados do vídeo' })
    expect(inspectVideo).toHaveBeenCalledWith(files[0], expect.anything())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('informa erros de formato ou fragmentação e não oferece download', async () => {
    vi.mocked(inspectVideo).mockRejectedValueOnce(new Error('Vídeos fragmentados ainda não são suportados.'))
    render(<VideoWorkspace />)
    select()
    expect(await screen.findByRole('alert')).toHaveTextContent('Vídeos fragmentados ainda não são suportados.')
    expect(screen.queryByRole('button', { name: 'Remover metadados do vídeo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Baixar vídeo limpo' })).not.toBeInTheDocument()
  })

  it('rejeita uma saída que ainda tenha metadados e permite tentar novamente', async () => {
    vi.mocked(removeVideoMetadata).mockResolvedValueOnce({ ...result, inspection })
    render(<VideoWorkspace />)
    select()
    fireEvent.click(await screen.findByRole('button', { name: 'Remover metadados do vídeo' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Ainda foram encontrados metadados')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.url)
    expect(screen.queryByRole('link', { name: 'Baixar vídeo limpo' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remover metadados do vídeo' }))
    expect(await screen.findByRole('link', { name: 'Baixar vídeo limpo' })).toBeVisible()
  })

  it('cancela o processamento, bloqueia a seleção enquanto processa e permite tentar novamente', async () => {
    vi.mocked(removeVideoMetadata).mockImplementationOnce((_file, options) => new Promise((_resolve, reject) => {
      options!.onProgress?.({ message: 'Verificando vídeo…', percent: 50 })
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Cancelado', 'AbortError')), { once: true })
    }))
    const { container } = render(<VideoWorkspace />)
    select()
    fireEvent.click(await screen.findByRole('button', { name: 'Remover metadados do vídeo' }))
    expect(screen.getByLabelText('Selecionar vídeo')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remover vídeo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Trocar vídeo' })).toBeDisabled()
    expect(screen.getByRole('progressbar', { name: 'Progresso da limpeza do vídeo' })).toHaveAttribute('value', '50')
    fireEvent.drop(container.querySelector('.video-dropzone')!, { dataTransfer: { files: [new File(['other'], 'outro.mp4')] } })
    expect(inspectVideo).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar processamento' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Processamento cancelado')
    expect(screen.getByLabelText('Selecionar vídeo')).toBeEnabled()
    expect(screen.queryByRole('link', { name: 'Baixar vídeo limpo' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remover metadados do vídeo' }))
    expect(await screen.findByRole('link', { name: 'Baixar vídeo limpo' })).toBeVisible()
  })

  it('libera os endereços temporários do original e do resultado ao reiniciar', async () => {
    render(<VideoWorkspace />)
    select()
    fireEvent.click(await screen.findByRole('button', { name: 'Remover metadados do vídeo' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Limpar outro vídeo' }))
    expect(screen.getByRole('button', { name: /Arraste seu vídeo aqui/ })).toBeVisible()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:original-video-1')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.url)
    expect(screen.queryByRole('link', { name: 'Baixar vídeo limpo' })).not.toBeInTheDocument()
  })

  it('aborta a inspeção anterior e ignora sua resposta quando outro vídeo é selecionado', async () => {
    let finish!: (value: VideoInspection) => void
    vi.mocked(inspectVideo).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    render(<VideoWorkspace />)
    select('primeiro.mp4')
    const signal = vi.mocked(inspectVideo).mock.calls[0][1]!.signal!
    select('segundo.mp4')
    expect(signal.aborted).toBe(true)
    await screen.findByText('Nome original')
    await act(async () => finish({ ...inspection, metadata: [{ label: 'Dado antigo', value: 'Resposta antiga' }] }))
    expect(screen.queryByText('Resposta antiga')).not.toBeInTheDocument()
    expect(screen.getByText('Nome original')).toBeVisible()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:original-video-1')
  })

  it('aborta tarefas e descarta resultados tardios ao sair da tela', async () => {
    let finish!: (value: ProcessedVideo) => void
    vi.mocked(removeVideoMetadata).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const { unmount } = render(<VideoWorkspace />)
    select()
    fireEvent.click(await screen.findByRole('button', { name: 'Remover metadados do vídeo' }))
    const signal = vi.mocked(removeVideoMetadata).mock.calls[0][1]!.signal!
    unmount()
    expect(signal.aborted).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:original-video-1')
    await act(async () => finish(result))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.url)
  })

  it('mantém a limpeza disponível quando o navegador não consegue reproduzir a prévia', async () => {
    render(<VideoWorkspace />)
    select()
    await screen.findByRole('button', { name: 'Remover metadados do vídeo' })
    fireEvent.error(screen.getByLabelText('Prévia do vídeo original'))
    expect(screen.getByText(/Este navegador não reproduz a prévia/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Remover metadados do vídeo' })).toBeEnabled()
  })

  it('permite remover a seleção durante a inspeção sem reintroduzir o arquivo', async () => {
    let finish!: (value: VideoInspection) => void
    vi.mocked(inspectVideo).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    render(<VideoWorkspace />)
    select()
    const signal = vi.mocked(inspectVideo).mock.calls[0][1]!.signal!
    fireEvent.click(screen.getByRole('button', { name: 'Remover vídeo' }))
    expect(signal.aborted).toBe(true)
    await act(async () => finish(inspection))
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'Antes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Arraste seu vídeo aqui/ })).toBeVisible()
  })
})
