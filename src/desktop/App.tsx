import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { AlertCircle, ArrowDownToLine, Check, CheckCircle2, ChevronRight, Code2, Copy, FileImage, FileVideo, FolderOpen, Leaf, LoaderCircle, LockKeyhole, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import type { CleanResult, Inspection, InspectionError, McpConfig } from './types'

type FileState = {
  path: string
  inspection?: Inspection
  status: 'ready' | 'cleaning' | 'cleaned' | 'already_clean' | 'error'
  error?: string
  result?: CleanResult
}

const statusLabels: Record<FileState['status'], string> = {
  ready: 'Pronto para limpar',
  cleaning: 'Limpando…',
  cleaned: 'Metadados removidos',
  already_clean: 'Já estava limpo',
  error: 'Não foi alterado',
}

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(bytes / 1024 ** (power + 1))} ${units[power]}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir esta operação.'
}

function FileIcon({ kind, size = 23 }: { kind?: 'image' | 'video'; size?: number }) {
  return kind === 'video' ? <FileVideo size={size} aria-hidden="true" /> : <FileImage size={size} aria-hidden="true" />
}

function StatusIcon({ status }: { status: FileState['status'] }) {
  if (status === 'cleaning') return <LoaderCircle size={15} className="cf-spin" aria-hidden="true" />
  if (status === 'cleaned' || status === 'already_clean') return <CheckCircle2 size={15} aria-hidden="true" />
  if (status === 'error') return <AlertCircle size={15} aria-hidden="true" />
  return <span className="cf-status-dot" />
}

export default function App() {
  const bridge = window.cleanFrame
  const [files, setFiles] = useState<FileState[]>([])
  const [selectedPath, setSelectedPath] = useState<string>()
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number }>()
  const [mcpOpen, setMcpOpen] = useState(false)
  const [mcpConfig, setMcpConfig] = useState<McpConfig>()
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpError, setMcpError] = useState('')
  const [copied, setCopied] = useState(false)

  const selected = files.find((file) => file.path === selectedPath) ?? files[0]
  const readyFiles = files.filter((file) => file.inspection && (file.status === 'ready' || file.status === 'error'))
  const completed = files.filter((file) => file.status === 'cleaned' || file.status === 'already_clean').length
  const failed = files.filter((file) => file.status === 'error').length
  const configText = mcpConfig ? JSON.stringify({ mcpServers: { cleanframe: mcpConfig } }, null, 2) : ''

  function addInspections(inspections: Array<Inspection | InspectionError>) {
    const additions = inspections.map((inspection): FileState => 'error' in inspection
      ? { path: inspection.path, status: 'error', error: inspection.error }
      : { path: inspection.path, status: 'ready', inspection })
    setFiles((previous) => {
      const existingPaths = new Set(previous.map((file) => file.path))
      return [...previous, ...additions.filter((file) => {
        if (existingPaths.has(file.path)) return false
        existingPaths.add(file.path)
        return true
      })]
    })
    setSelectedPath((previous) => previous ?? additions[0]?.path)
    setProgress(undefined)
  }

  async function pickFiles() {
    if (!bridge || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setProgress(undefined)
    try {
      addInspections(await bridge.pickFiles())
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function dropFiles(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (!bridge || busyRef.current) return
    const droppedFiles = Array.from(event.dataTransfer.files)
    if (!droppedFiles.length) return
    busyRef.current = true
    setBusy(true)
    setError('')
    setProgress(undefined)
    try {
      const paths = droppedFiles.map((file) => bridge.pathForFile(file))
      if (paths.some((path) => !path)) {
        throw new Error('Não foi possível acessar o caminho local. Use “Selecionar arquivos” para abrir os originais.')
      }
      addInspections(await bridge.inspectFiles([...new Set(paths)]))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  async function cleanFiles() {
    if (!bridge || busyRef.current || !readyFiles.length) return
    busyRef.current = true
    setBusy(true)
    setError('')
    const paths = readyFiles.map((file) => file.path)
    setProgress({ done: 0, total: paths.length })
    try {
      for (const [index, path] of paths.entries()) {
        setFiles((previous) => previous.map((file) => file.path === path ? { ...file, status: 'cleaning', error: undefined } : file))
        try {
          const result = await bridge.cleanFile(path)
          setFiles((previous) => previous.map((file) => file.path === path ? { ...file, status: result.status, result } : file))
        } catch (cause) {
          setFiles((previous) => previous.map((file) => file.path === path ? { ...file, status: 'error', error: errorMessage(cause) } : file))
        }
        setProgress({ done: index + 1, total: paths.length })
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function removeFile(path: string) {
    setFiles((previous) => previous.filter((file) => file.path !== path))
    if (selectedPath === path) setSelectedPath(undefined)
    setProgress(undefined)
  }

  async function toggleMcp() {
    setMcpOpen((previous) => !previous)
    if (mcpOpen || mcpConfig || !bridge || mcpLoading) return
    setMcpLoading(true)
    setMcpError('')
    try {
      setMcpConfig(await bridge.getMcpConfig())
    } catch (cause) {
      setMcpError(errorMessage(cause))
    } finally {
      setMcpLoading(false)
    }
  }

  async function copyMcp() {
    if (!bridge || !configText) return
    setCopied(false)
    setMcpError('')
    try {
      await bridge.copyText(configText)
      setCopied(true)
    } catch (cause) {
      setMcpError(errorMessage(cause))
    }
  }

  function dragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    dragDepth.current += 1
    if (bridge && !busyRef.current && event.dataTransfer.types.includes('Files')) setDragging(true)
  }

  function dragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  return (
    <div className="cf-app" onDragOver={(event) => event.preventDefault()} onDrop={(event) => event.preventDefault()}>
      <header className="cf-header">
        <div className="cf-header-inner">
          <div className="cf-brand" aria-label="CleanFrame">
            <span className="cf-brand-mark"><Leaf size={21} strokeWidth={2.3} aria-hidden="true" /></span>
            CleanFrame <span className="cf-desktop-label">Desktop</span>
          </div>
          <div className="cf-header-actions">
            <span className="cf-local-badge"><span /> {bridge ? '100% local' : 'Prévia da interface'}</span>
            <button type="button" className="cf-button cf-button-subtle" onClick={() => void toggleMcp()} aria-expanded={mcpOpen} aria-controls="cf-mcp"><Code2 size={17} aria-hidden="true" /> Conectar MCP</button>
          </div>
        </div>
      </header>

      <main className="cf-main">
        {mcpOpen ? <section id="cf-mcp" className="cf-mcp-panel" aria-labelledby="cf-mcp-title">
          <div className="cf-section-heading">
            <div><h2 id="cf-mcp-title"><Code2 size={20} aria-hidden="true" /> Controle pelo seu assistente</h2><p>Adicione esta configuração ao cliente MCP. O servidor usa arquivos locais por stdio.</p></div>
            <button type="button" className="cf-icon-button" aria-label="Fechar configuração MCP" onClick={() => setMcpOpen(false)}><X size={19} aria-hidden="true" /></button>
          </div>
          {!bridge ? <p className="cf-preview-copy">Abra o aplicativo desktop para obter o comando MCP deste computador.</p> : null}
          {mcpLoading ? <p role="status" className="cf-loading"><LoaderCircle size={16} className="cf-spin" aria-hidden="true" /> Carregando configuração…</p> : null}
          {mcpConfig ? <><pre tabIndex={0} aria-label="Configuração do servidor MCP">{configText}</pre><div className="cf-mcp-footer"><p>O assistente pode inspecionar e limpar os arquivos autorizados no seu computador.</p><button type="button" className="cf-button cf-button-outline" onClick={() => void copyMcp()}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? 'Configuração copiada' : 'Copiar configuração'}</button></div></> : null}
          {mcpError ? <p className="cf-inline-error" role="alert">{mcpError}</p> : null}
        </section> : null}

        <section className="cf-intro" aria-labelledby="cf-title">
          <p className="cf-eyebrow"><ShieldCheck size={15} aria-hidden="true" /> Sua privacidade, no seu computador</p>
          <h1 id="cf-title">Remova os metadados.<br /><span>Preserve o que importa.</span></h1>
          <p>Fotos e vídeos limpos, diretamente no arquivo original.</p>
        </section>

        {!bridge ? <div className="cf-preview-banner" role="status"><AlertCircle size={19} aria-hidden="true" /><div><strong>Você está vendo uma prévia no navegador.</strong><p>A seleção e a alteração dos arquivos estão disponíveis no aplicativo desktop para Windows e macOS.</p></div></div> : null}

        <section
          className={`cf-dropzone${dragging ? ' cf-dropzone-active' : ''}${files.length ? ' cf-dropzone-compact' : ''}${!bridge ? ' cf-dropzone-disabled' : ''}`}
          aria-label="Área para soltar arquivos"
          onDragEnter={dragEnter}
          onDragLeave={dragLeave}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void dropFiles(event)}
        >
          <div className="cf-drop-icon"><ArrowDownToLine size={27} strokeWidth={1.7} aria-hidden="true" /></div>
          <div className="cf-drop-copy"><h2>{dragging ? 'Solte os arquivos aqui' : files.length ? 'Adicione mais arquivos' : 'Arraste suas fotos e vídeos para cá'}</h2><p>JPG, PNG, WEBP · MP4, MOV, M4V</p></div>
          <button type="button" className="cf-button cf-button-outline" disabled={!bridge || busy} onClick={() => void pickFiles()}><FolderOpen size={17} aria-hidden="true" /> Selecionar arquivos</button>
        </section>

        {error ? <p role="alert" className="cf-error-banner"><AlertCircle size={17} aria-hidden="true" />{error}</p> : null}
        {busy && !progress ? <p className="cf-loading" role="status"><LoaderCircle size={16} className="cf-spin" aria-hidden="true" /> Lendo os arquivos locais…</p> : null}

        {files.length ? <section className="cf-workspace" aria-label="Arquivos selecionados">
          <div className="cf-files-panel">
            <div className="cf-section-heading cf-files-heading"><div><h2>Seus arquivos <span className="cf-count">{files.length}</span></h2><p>Confira os dados antes de remover.</p></div><button type="button" className="cf-button cf-button-text" disabled={busy} onClick={() => { setFiles([]); setSelectedPath(undefined); setProgress(undefined); setError('') }}><Trash2 size={15} aria-hidden="true" /> Limpar lista</button></div>
            <ul className="cf-file-list">
              {files.map((file) => <li key={file.path} className={`cf-file-row cf-file-${file.status}${selected?.path === file.path ? ' cf-file-selected' : ''}`}>
                <button type="button" className="cf-file-select" aria-pressed={selected?.path === file.path} aria-label={`Ver detalhes de ${file.inspection?.name ?? fileName(file.path)}`} onClick={() => setSelectedPath(file.path)}>
                  <span className="cf-file-icon"><FileIcon kind={file.inspection?.kind} /></span>
                  <span className="cf-file-copy"><strong>{file.inspection?.name ?? fileName(file.path)}</strong><span className="cf-file-path" title={file.path}>{file.path}</span><span className="cf-file-caption">{file.inspection ? `${file.inspection.format.toUpperCase()} · ${formatSize(file.result?.sizeAfter ?? file.inspection.size)}` : 'Falha na leitura'}<span className={`cf-file-status cf-status-${file.status}`}><StatusIcon status={file.status} />{statusLabels[file.status]}</span></span></span>
                  <ChevronRight size={17} className="cf-file-chevron" aria-hidden="true" />
                </button>
                <button type="button" className="cf-icon-button cf-remove-file" aria-label={`Remover ${file.inspection?.name ?? fileName(file.path)} da lista`} disabled={busy} onClick={() => removeFile(file.path)}><X size={16} aria-hidden="true" /></button>
              </li>)}
            </ul>
            <button type="button" className="cf-add-files" disabled={busy || !bridge} onClick={() => void pickFiles()}><Plus size={16} aria-hidden="true" /> Adicionar arquivos</button>
          </div>

          {selected ? <aside className="cf-details-panel" aria-labelledby="cf-details-title">
            <div className="cf-details-heading"><span className="cf-file-icon"><FileIcon kind={selected.inspection?.kind} size={25} /></span><div><p>{selected.inspection?.kind === 'video' ? 'Vídeo' : 'Imagem'}</p><h2 id="cf-details-title">{selected.inspection?.name ?? fileName(selected.path)}</h2></div></div>
            <div className="cf-path-detail"><span>Caminho original</span><code>{selected.path}</code></div>
            {selected.result ? <div className="cf-result" role="status"><CheckCircle2 size={21} aria-hidden="true" /><div><strong>{selected.result.status === 'already_clean' ? 'O arquivo já estava limpo' : 'Pronto. Arquivo original atualizado.'}</strong><p>{selected.result.status === 'already_clean' ? 'Nenhuma alteração foi necessária.' : `${selected.result.removedCount} ${selected.result.removedCount === 1 ? 'campo removido' : 'campos removidos'}. Salvo no mesmo caminho.`}</p><span>{formatSize(selected.result.sizeBefore)} <span aria-label="para">→</span> {formatSize(selected.result.sizeAfter)}</span></div></div> : null}
            {selected.error ? <div className="cf-detail-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><div><strong>O arquivo não foi alterado</strong><p>{selected.error}</p></div></div> : null}
            {selected.inspection && !selected.result ? <><div className="cf-metadata-heading"><h3>Metadados encontrados</h3><span>{selected.inspection.metadata.length}</span></div>{selected.inspection.metadata.length ? <dl className="cf-metadata-list">{selected.inspection.metadata.map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl> : <p className="cf-no-metadata"><ShieldCheck size={19} aria-hidden="true" /> Nenhum metadado removível encontrado na inspeção.</p>}</> : null}
            {(selected.result?.warnings ?? selected.inspection?.warnings ?? []).length ? <div className="cf-warnings"><h3><AlertCircle size={15} aria-hidden="true" /> Observações do arquivo</h3><ul>{(selected.result?.warnings ?? selected.inspection?.warnings ?? []).map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
          </aside> : null}

          <div className="cf-process-panel">
            <div className="cf-original-note"><LockKeyhole size={20} aria-hidden="true" /><div><strong>A limpeza altera os arquivos originais.</strong><p>Os arquivos são salvos no mesmo caminho. A imagem e o vídeo não são recodificados.</p></div></div>
            <button type="button" className="cf-button cf-button-primary" disabled={!bridge || busy || !readyFiles.length} onClick={() => void cleanFiles()}>{busy && progress ? <LoaderCircle size={18} className="cf-spin" aria-hidden="true" /> : <ShieldCheck size={18} aria-hidden="true" />}{busy && progress ? `Limpando ${Math.min(progress.done + 1, progress.total)} de ${progress.total}…` : 'Remover metadados'}{!busy && readyFiles.length > 1 ? <span className="cf-button-count">{readyFiles.length}</span> : null}</button>
            {progress ? <div className="cf-progress" role="status"><progress max={progress.total} value={progress.done} aria-label="Progresso da limpeza" /><p>{busy ? `${progress.done} de ${progress.total} processados` : `${completed} ${completed === 1 ? 'arquivo concluído' : 'arquivos concluídos'}${failed ? ` · ${failed} com erro` : ''}`}</p></div> : null}
          </div>
        </section> : <div className="cf-empty-assurances"><span><LockKeyhole size={17} aria-hidden="true" /> Sem envio para servidores</span><span><CheckCircle2 size={17} aria-hidden="true" /> Mesmo arquivo, mesmo caminho</span><span><Code2 size={17} aria-hidden="true" /> Pronto para MCP</span></div>}

        <footer className="cf-footer"><Leaf size={14} aria-hidden="true" /> CleanFrame <span>·</span> Privacidade sem complicação.</footer>
      </main>
    </div>
  )
}
