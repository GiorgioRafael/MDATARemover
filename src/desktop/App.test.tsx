// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { CleanFrameBridge, CleanResult, Inspection } from './types'

const photo: Inspection = {
  path: 'C:\\Fotos\\ferias.jpg', name: 'ferias.jpg', format: 'jpeg', kind: 'image', size: 125000,
  metadata: [{ label: 'Autor', value: 'Giorgio' }, { label: 'GPS', value: '-23, -46' }], warnings: [],
}
const video: Inspection = {
  path: 'C:\\Videos\\viagem.mp4', name: 'viagem.mp4', format: 'mp4', kind: 'video', size: 42000000,
  metadata: [{ label: 'Título', value: 'Viagem' }], warnings: ['A data do sistema de arquivos pode permanecer.'],
}
const cleaned: CleanResult = {
  path: photo.path, name: photo.name, format: photo.format, kind: photo.kind,
  sizeBefore: photo.size, sizeAfter: 124820, removedCount: 2, status: 'cleaned', warnings: [],
}

function installBridge() {
  const bridge: CleanFrameBridge = {
    pickFiles: vi.fn().mockResolvedValue([photo]),
    inspectFiles: vi.fn().mockResolvedValue([photo]),
    cleanFile: vi.fn().mockResolvedValue(cleaned),
    pathForFile: vi.fn().mockReturnValue(photo.path),
    getMcpConfig: vi.fn().mockResolvedValue({ command: 'C:\\CleanFrame\\CleanFrame.exe', args: ['--mcp'] }),
    copyText: vi.fn().mockResolvedValue(undefined),
  }
  Object.defineProperty(window, 'cleanFrame', { configurable: true, value: bridge })
  return bridge
}

let bridge: CleanFrameBridge

beforeEach(() => {
  bridge = installBridge()
})

afterEach(() => {
  cleanup()
  delete window.cleanFrame
  vi.restoreAllMocks()
})

async function pickFiles() {
  fireEvent.click(screen.getByRole('button', { name: 'Selecionar arquivos' }))
  await screen.findByRole('button', { name: `Ver detalhes de ${photo.name}` })
}

describe('CleanFrame desktop', () => {
  it('inspeciona os originais e só mostra sucesso depois da limpeza nativa', async () => {
    render(<App />)
    await pickFiles()

    const details = within(screen.getByRole('complementary'))
    expect(details.getByText(photo.path)).toBeVisible()
    expect(details.getByText('Autor')).toBeVisible()
    expect(details.getByText('Giorgio')).toBeVisible()
    expect(screen.getByText('A limpeza altera os arquivos originais.')).toBeVisible()
    expect(bridge.cleanFile).not.toHaveBeenCalled()
    expect(screen.queryByText('Pronto. Arquivo original atualizado.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remover metadados' }))
    await screen.findByText('Pronto. Arquivo original atualizado.')

    expect(bridge.cleanFile).toHaveBeenCalledExactlyOnceWith(photo.path)
    expect(details.getByText('2 campos removidos. Salvo no mesmo caminho.')).toBeVisible()
    expect(details.queryByText('GPS')).not.toBeInTheDocument()
    expect(screen.getByText('1 arquivo concluído')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Remover metadados' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: /baixar/i })).not.toBeInTheDocument()
  })

  it('continua o lote após falha e permite tentar o arquivo que falhou novamente', async () => {
    vi.mocked(bridge.pickFiles).mockResolvedValue([photo, video])
    vi.mocked(bridge.cleanFile)
      .mockRejectedValueOnce(new Error('O arquivo está em uso.'))
      .mockResolvedValueOnce({ ...cleaned, path: video.path, name: video.name, kind: 'video' })
      .mockResolvedValueOnce(cleaned)
    render(<App />)
    await pickFiles()

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de viagem.mp4' }))
    expect(screen.getByText(video.warnings[0])).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Remover metadados/ }))
    await screen.findByText('1 arquivo concluído · 1 com erro')
    expect(vi.mocked(bridge.cleanFile).mock.calls).toEqual([[photo.path], [video.path]])

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes de ferias.jpg' }))
    expect(screen.getByText('O arquivo está em uso.')).toBeVisible()
    expect(screen.getByText('O arquivo não foi alterado')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Remover metadados' }))
    await screen.findByText('2 arquivos concluídos')
    expect(bridge.cleanFile).toHaveBeenLastCalledWith(photo.path)
  })

  it('usa o caminho nativo ao soltar um arquivo e evita duplicatas na lista', async () => {
    render(<App />)
    const area = screen.getByRole('region', { name: 'Área para soltar arquivos' })
    const file = new File(['original'], photo.name, { type: 'image/jpeg' })
    fireEvent.drop(area, { dataTransfer: { files: [file], types: ['Files'] } })
    await screen.findByRole('button', { name: 'Ver detalhes de ferias.jpg' })

    expect(bridge.pathForFile).toHaveBeenCalledExactlyOnceWith(file)
    expect(bridge.inspectFiles).toHaveBeenCalledExactlyOnceWith([photo.path])
    await pickFiles()
    expect(screen.getAllByRole('button', { name: 'Ver detalhes de ferias.jpg' })).toHaveLength(1)
  })

  it('recusa arquivos soltos sem caminho local em vez de criar uma cópia', async () => {
    vi.mocked(bridge.pathForFile).mockReturnValue('')
    render(<App />)
    fireEvent.drop(screen.getByRole('region', { name: 'Área para soltar arquivos' }), {
      dataTransfer: { files: [new File(['copy'], photo.name)], types: ['Files'] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível acessar o caminho local.')
    expect(bridge.inspectFiles).not.toHaveBeenCalled()
    expect(bridge.cleanFile).not.toHaveBeenCalled()
  })

  it('exibe erros de inspeção por arquivo e mantém os outros disponíveis', async () => {
    vi.mocked(bridge.inspectFiles).mockResolvedValue([{ path: photo.path, error: 'Arquivo inválido.' }, video])
    render(<App />)
    fireEvent.drop(screen.getByRole('region', { name: 'Área para soltar arquivos' }), {
      dataTransfer: { files: [new File(['invalid'], photo.name)], types: ['Files'] },
    })
    expect(await screen.findByText('Arquivo inválido.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Remover metadados' }))
    await waitFor(() => expect(bridge.cleanFile).toHaveBeenCalledExactlyOnceWith(video.path))
  })

  it('mostra falhas de leitura vindas do seletor nativo sem habilitar a limpeza', async () => {
    vi.mocked(bridge.pickFiles).mockResolvedValue([{ path: photo.path, error: 'O arquivo foi removido.' }])
    render(<App />)
    await pickFiles()
    expect(screen.getByText('O arquivo foi removido.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Remover metadados' })).toBeDisabled()
    expect(bridge.cleanFile).not.toHaveBeenCalled()
  })

  it('diferencia um arquivo já limpo de um arquivo modificado', async () => {
    vi.mocked(bridge.pickFiles).mockResolvedValue([{ ...photo, metadata: [] }])
    vi.mocked(bridge.cleanFile).mockResolvedValue({ ...cleaned, status: 'already_clean', removedCount: 0, sizeAfter: photo.size })
    render(<App />)
    await pickFiles()
    expect(screen.getByText('Nenhum metadado removível encontrado na inspeção.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Remover metadados' }))
    expect(await screen.findByText('O arquivo já estava limpo')).toBeVisible()
    expect(screen.getByText('Nenhuma alteração foi necessária.')).toBeVisible()
    expect(screen.queryByText('Pronto. Arquivo original atualizado.')).not.toBeInTheDocument()
  })

  it('bloqueia alterações da fila e cliques repetidos enquanto limpa', async () => {
    let finish: ((result: CleanResult) => void) | undefined
    vi.mocked(bridge.cleanFile).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    render(<App />)
    await pickFiles()
    fireEvent.click(screen.getByRole('button', { name: 'Remover metadados' }))

    expect(screen.getByRole('button', { name: 'Limpando 1 de 1…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Limpar lista' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Selecionar arquivos' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remover ferias.jpg da lista' })).toBeDisabled()
    expect(screen.queryByText('Pronto. Arquivo original atualizado.')).not.toBeInTheDocument()

    await act(async () => { finish?.(cleaned) })
    expect(bridge.cleanFile).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Pronto. Arquivo original atualizado.')).toBeVisible()
  })

  it('remove itens e limpa somente a lista da interface', async () => {
    vi.mocked(bridge.pickFiles).mockResolvedValue([photo, video])
    render(<App />)
    await pickFiles()
    fireEvent.click(screen.getByRole('button', { name: 'Remover ferias.jpg da lista' }))
    expect(screen.queryByRole('button', { name: 'Ver detalhes de ferias.jpg' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'viagem.mp4' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar lista' }))
    expect(screen.queryByRole('region', { name: 'Arquivos selecionados' })).not.toBeInTheDocument()
    expect(bridge.cleanFile).not.toHaveBeenCalled()
  })

  it('mostra e copia a configuração MCP retornada pelo aplicativo', async () => {
    render(<App />)
    const open = screen.getByRole('button', { name: 'Conectar MCP' })
    fireEvent.click(open)
    await screen.findByLabelText('Configuração do servidor MCP')
    expect(open).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Copiar configuração' }))
    expect(await screen.findByRole('button', { name: 'Configuração copiada' })).toBeVisible()
    expect(JSON.parse(vi.mocked(bridge.copyText).mock.calls[0][0])).toEqual({
      mcpServers: { cleanframe: { command: 'C:\\CleanFrame\\CleanFrame.exe', args: ['--mcp'] } },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fechar configuração MCP' }))
    expect(open).toHaveAttribute('aria-expanded', 'false')
  })

  it('mantém a prévia do navegador honesta e sem operações de arquivos', () => {
    delete window.cleanFrame
    render(<App />)
    expect(screen.getByText('Você está vendo uma prévia no navegador.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Selecionar arquivos' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Conectar MCP' }))
    expect(screen.getByText('Abra o aplicativo desktop para obter o comando MCP deste computador.')).toBeVisible()
    expect(screen.queryByLabelText('Configuração do servidor MCP')).not.toBeInTheDocument()
    expect(bridge.pickFiles).not.toHaveBeenCalled()
    expect(bridge.cleanFile).not.toHaveBeenCalled()
  })
})
