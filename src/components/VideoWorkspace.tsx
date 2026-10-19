import { Check, Download, FileCheck2, FileVideo, Fingerprint, LoaderCircle, RotateCcw, ShieldCheck, Sparkles, UploadCloud, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatBytes, formatDimensions } from '../lib/format'
import { inspectVideo, MAX_VIDEO_SIZE, removeVideoMetadata, validateVideo } from '../lib/videoProcessing'
import type { ProcessedVideo, VideoInspection } from '../lib/videoProcessing'

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`
}

export function VideoWorkspace() {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [inspection, setInspection] = useState<VideoInspection | null>(null)
  const [result, setResult] = useState<ProcessedVideo | null>(null)
  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ message: string; percent?: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [previewUnavailable, setPreviewUnavailable] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const processingRef = useRef(false)
  const objectUrls = useRef<Set<string>>(new Set())

  useEffect(() => {
    const urls = objectUrls.current
    return () => {
      controller.current?.abort()
      controller.current = null
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [])

  const revokeUrls = () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url))
    objectUrls.current.clear()
  }

  const reset = () => {
    if (processingRef.current) return
    controller.current?.abort()
    controller.current = null
    revokeUrls()
    setFile(null); setPreviewUrl(null); setInspection(null); setResult(null)
    setError(null); setLoading(false); setProgress(null); setPreviewUnavailable(false)
    if (input.current) input.current.value = ''
  }

  const selectFiles = async (files: File[]) => {
    if (processingRef.current || !files.length) return
    if (files.length !== 1) { setError('Selecione um vídeo por vez.'); return }
    const next = files[0]
    const validationError = validateVideo(next)
    if (validationError) { setError(validationError); return }

    controller.current?.abort()
    const nextController = new AbortController()
    controller.current = nextController
    revokeUrls()
    const url = URL.createObjectURL(next)
    objectUrls.current.add(url)
    setFile(next); setPreviewUrl(url); setInspection(null); setResult(null)
    setError(null); setLoading(true); setProgress(null); setPreviewUnavailable(false)
    try {
      const nextInspection = await inspectVideo(next, { signal: nextController.signal })
      if (controller.current !== nextController || nextController.signal.aborted) return
      setInspection(nextInspection)
    } catch (reason) {
      if (controller.current !== nextController || nextController.signal.aborted) return
      setError(reason instanceof Error ? reason.message : 'Não foi possível inspecionar este vídeo.')
    } finally {
      if (controller.current === nextController) {
        controller.current = null
        setLoading(false)
      }
    }
  }

  const process = async () => {
    if (!file || !inspection || loading || processingRef.current) return
    processingRef.current = true
    const nextController = new AbortController()
    controller.current = nextController
    setProcessing(true); setError(null); setProgress({ message: 'Preparando o vídeo…' })
    try {
      const processed = await removeVideoMetadata(file, {
        signal: nextController.signal,
        onProgress: (nextProgress) => {
          if (controller.current === nextController && !nextController.signal.aborted) setProgress(nextProgress)
        },
      })
      if (controller.current !== nextController || nextController.signal.aborted) {
        URL.revokeObjectURL(processed.url)
        if (controller.current === nextController) setError('Processamento cancelado. Você pode tentar novamente.')
        return
      }
      if (processed.inspection.metadata.length) {
        URL.revokeObjectURL(processed.url)
        throw new Error('Ainda foram encontrados metadados no vídeo. O download não foi liberado.')
      }
      objectUrls.current.add(processed.url)
      setResult(processed)
    } catch (reason) {
      if (controller.current !== nextController) return
      setError(nextController.signal.aborted ? 'Processamento cancelado. Você pode tentar novamente.' : reason instanceof Error ? reason.message : 'Não foi possível limpar este vídeo.')
    } finally {
      if (controller.current === nextController) {
        controller.current = null
        processingRef.current = false
        setProcessing(false); setProgress(null)
      }
    }
  }

  return (
    <div className="video-workspace">
      <div className="quality-settings video-assurance">
        <div className="quality-copy">
          <h2><ShieldCheck size={18} />Qualidade original preservada</h2>
          <p>Remove metadados sem recodificar vídeo ou áudio. A resolução e a qualidade permanecem iguais.</p>
        </div>
        <p className="quality-note">As informações técnicas necessárias à reprodução, como rotação e cores, são preservadas. Compatível com vídeos convencionais; arquivos fragmentados ou com trilhas de dados não são aceitos.</p>
      </div>

      <div
        className={`dropzone video-dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragOver={(event) => { event.preventDefault(); if (!processingRef.current) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void selectFiles(Array.from(event.dataTransfer.files)) }}
      >
        <input
          ref={input}
          type="file"
          aria-label="Selecionar vídeo"
          accept=".mp4,.mov,.m4v,video/mp4,video/quicktime,video/x-m4v"
          disabled={processing}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            void selectFiles(files)
          }}
        />
        {file ? (
          <div className="dropzone-file">
            <div className="dropzone-thumb-wrap">
              <div className="dropzone-thumb-placeholder video-file-icon"><FileVideo size={32} /></div>
              <button className="remove-file" type="button" onClick={reset} disabled={processing} aria-label="Remover vídeo"><X size={15} /></button>
            </div>
            <div className="dropzone-file-copy"><strong>{file.name}</strong><span>{formatBytes(file.size)} · 1 vídeo selecionado</span></div>
            <button className="text-button" type="button" onClick={() => input.current?.click()} disabled={processing}>Trocar vídeo</button>
          </div>
        ) : (
          <button className="dropzone-empty" type="button" onClick={() => input.current?.click()} disabled={processing}>
            <UploadCloud className="upload-icon" size={28} />
            <strong>Arraste seu vídeo aqui</strong><span className="select-copy">ou selecione um arquivo</span>
            <small>MP4, MOV ou M4V · um vídeo por vez · até {formatBytes(MAX_VIDEO_SIZE)}</small>
          </button>
        )}
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading && <div className="loading-state" role="status"><span className="skeleton-line" /><span>Inspecionando metadados do vídeo…</span></div>}
      {progress && (
        <div className="enhancement-progress">
          <div role="status"><span>{progress.message}</span>{progress.percent !== undefined && <progress aria-label="Progresso da limpeza do vídeo" value={progress.percent} max={100} />}</div>
          <button className="cancel-processing" type="button" onClick={() => controller.current?.abort()}>Cancelar processamento</button>
        </div>
      )}

      {file && previewUrl && inspection && !loading && (
        <div className="workspace">
          <section className="panel metadata-panel" aria-labelledby="video-before-title">
            <div className="panel-heading">
              <div><h2 id="video-before-title">Antes</h2><p>Metadados encontrados no vídeo original</p></div>
              <span className={`count-badge ${inspection.metadata.length ? '' : 'is-neutral'}`}>{inspection.metadata.length} {inspection.metadata.length === 1 ? 'removível' : 'removíveis'}</span>
            </div>
            <video key={previewUrl} className="video-preview" controls preload="metadata" src={previewUrl} aria-label="Prévia do vídeo original" onError={() => setPreviewUnavailable(true)} />
            {previewUnavailable && <p className="video-preview-note">Este navegador não reproduz a prévia deste formato. A limpeza preserva o vídeo e o áudio originais.</p>}
            <p className="video-file-name">{file.name}</p>
            <div className="metadata-list">
              {inspection.metadata.length ? (
                <div className="metadata-group">
                  <div className="group-title"><FileVideo size={17} /><h3>Metadados removíveis</h3></div>
                  {inspection.metadata.map((item, index) => <div className="metadata-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong className="video-metadata-value" title={item.value}>{item.value}</strong></div>)}
                </div>
              ) : <div className="no-metadata"><ShieldCheck size={20} /><p>Nenhum metadado pessoal removível foi encontrado. Você ainda pode gerar e verificar uma cópia limpa.</p></div>}
              <div className="technical-summary">
                <div className="group-title"><Fingerprint size={17} /><h3>Análise técnica do arquivo</h3></div>
                <dl>
                  <div><dt>Formato</dt><dd>{inspection.format}</dd></div>
                  <div><dt>Tamanho</dt><dd>{formatBytes(file.size)}</dd></div>
                  <div><dt>Resolução</dt><dd>{formatDimensions(inspection.width, inspection.height)}</dd></div>
                  <div><dt>Duração</dt><dd>{formatDuration(inspection.duration)}</dd></div>
                </dl>
              </div>
            </div>
          </section>

          <section className="panel result-panel" aria-labelledby="video-after-title">
            <div className="panel-heading"><div><h2 id="video-after-title">Depois</h2><p>{result ? 'Cópia limpa, verificada e pronta para baixar' : 'A cópia limpa aparecerá aqui'}</p></div>{result && <span className="success-badge"><Check size={16} />Metadados removíveis limpos</span>}</div>
            {result ? (
              <>
                <video key={result.url} className="video-preview" controls preload="metadata" src={result.url} aria-label="Prévia do vídeo limpo" />
                <div className="success-message"><span><Check size={18} /></span><div><strong>Limpeza verificada</strong><p>{result.removedCount} {result.removedCount === 1 ? 'metadado removido' : 'metadados removidos'}. Vídeo e áudio preservados sem recodificação.</p></div></div>
                <div className="technical-summary">
                  <div className="group-title"><FileCheck2 size={17} /><h3>Resumo técnico</h3></div>
                  <dl>
                    <div><dt>Nome do arquivo</dt><dd>{result.name}</dd></div>
                    <div><dt>Formato</dt><dd>{result.inspection.format}</dd></div>
                    <div><dt>Tamanho</dt><dd className="video-result-size">{formatBytes(result.blob.size)}</dd></div>
                    <div><dt>Resolução</dt><dd>{formatDimensions(result.inspection.width, result.inspection.height)}</dd></div>
                    <div><dt>Duração</dt><dd>{formatDuration(result.inspection.duration)}</dd></div>
                  </dl>
                </div>
                <p className="detection-note video-technical-note">A limpeza remove metadados do contêiner. Identificações embutidas nas imagens, no áudio ou nos dados do codec permanecem no vídeo.</p>
                <a className="primary-button" href={result.url} download={result.name}><Download size={19} />Baixar vídeo limpo</a>
                <button className="secondary-button" type="button" onClick={reset}><RotateCcw size={18} />Limpar outro vídeo</button>
              </>
            ) : (
              <>
                <div className="no-metadata"><ShieldCheck size={30} /><div className="process-copy"><h3>Pronto para limpar</h3><p>Remova os metadados mantendo os dados originais de vídeo e áudio. O arquivo final será inspecionado antes do download.</p></div></div>
                <button className="primary-button" type="button" onClick={() => void process()} disabled={processing}>
                  {processing ? <LoaderCircle className="spinner" size={19} /> : <Sparkles size={19} />}{processing ? 'Limpando vídeo…' : 'Remover metadados do vídeo'}
                </button>
              </>
            )}
          </section>
        </div>
      )}

      {!file && <div className="empty-assurance"><ShieldCheck size={20} /><p><strong>Privacidade por padrão.</strong> Seu vídeo permanece neste dispositivo durante toda a limpeza.</p></div>}
    </div>
  )
}
