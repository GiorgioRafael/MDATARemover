import { Image, LockKeyhole, ShieldCheck, Video } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Brand } from './components/Brand'
import { BatchPanel } from './components/BatchPanel'
import { MetadataPanel } from './components/MetadataPanel'
import { ResultPanel } from './components/ResultPanel'
import { UploadDropzone } from './components/UploadDropzone'
import { QualitySettings } from './components/QualitySettings'
import { readImageInfo, removeMetadata, validateImage } from './lib/imageProcessing'
import { inspectMetadata } from './lib/metadata'
import { MAX_BATCH_FILES } from './lib/batch'
import type { BatchImage, ImageInfo, ImageInspection, ProcessedImage, ProcessingOptions, ProcessingProgress } from './types'

const VideoWorkspace = lazy(() => import('./components/VideoWorkspace').then((module) => ({ default: module.VideoWorkspace })))

export default function App() {
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [info, setInfo] = useState<ImageInfo | null>(null)
  const [inspection, setInspection] = useState<ImageInspection | null>(null)
  const [result, setResult] = useState<ProcessedImage | null>(null)
  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batch, setBatch] = useState<BatchImage[]>([])
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [progress, setProgress] = useState<ProcessingProgress | null>(null)
  const [processingOptions, setProcessingOptions] = useState<ProcessingOptions>({ mode: 'metadata-only', preset: 'moderado', seed: 'tcc-001' })
  const objectUrls = useRef<string[]>([])
  const busy = useRef(false)
  const archiveUrl = useRef<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => { controller.current?.abort(); objectUrls.current.forEach((url) => URL.revokeObjectURL(url)) }, [])

  const revokeUrls = () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url))
    objectUrls.current = []
    archiveUrl.current = null
  }

  const invalidateArchive = () => {
    if (!archiveUrl.current) return
    URL.revokeObjectURL(archiveUrl.current)
    objectUrls.current = objectUrls.current.filter((url) => url !== archiveUrl.current)
    archiveUrl.current = null
  }

  const reset = () => {
    if (busy.current) return
    revokeUrls()
    setFile(null); setPreviewUrl(null); setInfo(null); setInspection(null); setResult(null); setError(null)
    setBatch([])
  }

  const processFile = async (next: File, options: ProcessingOptions) => {
    controller.current = new AbortController()
    setProcessing(true); setError(null); setProgress({ message: 'Preparando a imagem…' })
    try {
      const processed = await removeMetadata(next, { ...options, signal: controller.current.signal, onProgress: setProgress })
      if (result) {
        URL.revokeObjectURL(result.url)
        objectUrls.current = objectUrls.current.filter((url) => url !== result.url)
      }
      objectUrls.current.push(processed.url)
      setResult(processed)
    }
    catch (reason) { setError(controller.current.signal.aborted ? 'Processamento cancelado. Você pode tentar novamente.' : reason instanceof Error ? reason.message : 'Não foi possível limpar a imagem.') }
    finally { setProcessing(false); setProgress(null); controller.current = null }
  }

  const selectFile = async (next: File, cleanImmediately = false) => {
    if (busy.current) return
    const validationError = validateImage(next)
    if (validationError) { setError(validationError); return }
    busy.current = true
    revokeUrls()
    setBatch([])
    const url = URL.createObjectURL(next)
    objectUrls.current.push(url)
    setFile(next); setPreviewUrl(url); setInfo(null); setInspection(null); setResult(null); setError(null); setLoading(true)
    try {
      const [nextInfo, nextInspection] = await Promise.all([readImageInfo(next), inspectMetadata(next)])
      setInfo(nextInfo); setInspection(nextInspection)
      setLoading(false)
      if (cleanImmediately) await processFile(next, { ...processingOptions, mode: 'metadata-only' })
    } catch {
      setError('Não foi possível ler esta imagem. Tente exportá-la novamente como JPG, PNG ou WEBP.')
    } finally { setLoading(false); busy.current = false }
  }

  const process = async () => {
    if (!file || busy.current) return
    busy.current = true
    try {
      await processFile(file, processingOptions)
    }
    finally { busy.current = false }
  }

  const selectFiles = async (files: File[], selection: 'add' | 'replace' = 'add') => {
    if (busy.current || !files.length) return
    const reusableResult = result?.report.mode === 'metadata-only'
      && result.report.upscale?.scale === processingOptions.upscale
      && !result.inspection.items.length && !result.inspection.blocks.length ? result : null
    const previous: BatchImage[] = selection === 'replace' ? [] : batch.length ? batch : file ? [
      { id: 0, file, status: reusableResult ? 'done' : 'pending', error: null, result: reusableResult },
    ] : []
    const total = previous.length + files.length
    if (total > MAX_BATCH_FILES) {
      setError(`Selecione no máximo ${MAX_BATCH_FILES} fotos por vez. Você selecionou ${total}.${previous.length ? ' As fotos anteriores foram mantidas.' : ''}`)
      return
    }
    if (total === 1) { await selectFile(files[0]); return }
    if (selection === 'replace') revokeUrls()
    else {
      invalidateArchive()
      const discardedUrls = [previewUrl, !reusableResult ? result?.url : null].filter((url): url is string => Boolean(url))
      discardedUrls.forEach((url) => URL.revokeObjectURL(url))
      objectUrls.current = objectUrls.current.filter((url) => !discardedUrls.includes(url))
    }
    setFile(null); setPreviewUrl(null); setInfo(null); setInspection(null); setResult(null); setError(null)
    const firstId = previous.reduce((maximum, image) => Math.max(maximum, image.id), -1) + 1
    setBatch([...previous, ...files.map((image, index): BatchImage => {
      const validationError = validateImage(image)
      return { id: firstId + index, file: image, status: validationError ? 'error' : 'pending', error: validationError, result: null }
    })])
  }

  const processBatch = async () => {
    if (busy.current) return
    const pending = batch.filter((image) => image.status !== 'done' && !validateImage(image.file))
    if (!pending.length) return
    busy.current = true
    controller.current = new AbortController()
    setBatchProcessing(true); setError(null)
    invalidateArchive()
    try {
      for (const image of pending) {
        if (controller.current.signal.aborted) break
        setProgress({ message: 'Preparando a próxima foto…' })
        setBatch((images) => images.map((item) => item.id === image.id ? { ...item, status: 'processing', error: null } : item))
        try {
          const processed = await removeMetadata(image.file, { ...processingOptions, mode: 'metadata-only', signal: controller.current.signal, onProgress: setProgress })
          if (processed.inspection.items.length || processed.inspection.blocks.length) {
            URL.revokeObjectURL(processed.url)
            throw new Error('Ainda foram encontrados metadados. Tente limpar esta foto novamente.')
          }
          objectUrls.current.push(processed.url)
          setBatch((images) => images.map((item) => item.id === image.id ? { ...item, status: 'done', result: processed } : item))
        } catch (reason) {
          if (controller.current.signal.aborted) {
            setBatch((images) => images.map((item) => item.id === image.id ? { ...item, status: 'pending', error: null } : item))
            setError('Lote pausado. As fotos concluídas podem ser baixadas; clique em limpar para continuar as restantes.')
            break
          }
          setBatch((images) => images.map((item) => item.id === image.id ? { ...item, status: 'error', error: reason instanceof Error ? reason.message : 'Não foi possível limpar esta foto.' } : item))
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } finally {
      busy.current = false
      setBatchProcessing(false)
      setProgress(null); controller.current = null
    }
  }

  const downloadZip = async () => {
    if (busy.current) return
    const results = batch.flatMap((image) => image.status === 'done' && image.result ? [image.result] : [])
    if (!results.length) return
    busy.current = true
    setZipping(true); setError(null)
    try {
      if (!archiveUrl.current) {
        const { createImageZip } = await import('./lib/zip')
        const archive = await createImageZip(results)
        archiveUrl.current = URL.createObjectURL(archive)
        objectUrls.current.push(archiveUrl.current)
      }
      const link = document.createElement('a')
      link.href = archiveUrl.current
      link.download = 'cleanframe-fotos-limpas.zip'
      link.hidden = true
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível gerar o ZIP. Tente novamente ou baixe as fotos individualmente.')
    } finally {
      busy.current = false
      setZipping(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner"><Brand /><div className="privacy-top"><LockKeyhole size={15} />Processamento local. Seus arquivos não saem deste dispositivo.</div></div>
      </header>
      <main>
        <section className="intro">
          <h1>{mediaType === 'video' ? 'Limpe seus vídeos sem perder qualidade' : 'Prepare imagens limpas para publicar'}</h1>
          <p>{mediaType === 'video' ? 'Remova metadados de vídeos preservando a imagem e o áudio originais.' : 'Remova metadados e melhore a resolução das suas fotos antes de publicar.'}</p>
        </section>

        <div className="media-tabs" role="tablist" aria-label="Tipo de arquivo" onKeyDown={(event) => {
          if (loading || processing || batchProcessing || zipping || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'image' : event.key === 'End' ? 'video' : mediaType === 'image' ? 'video' : 'image'
          setMediaType(next)
          document.getElementById(`${next}-tab`)?.focus()
        }}>
          <button id="image-tab" type="button" role="tab" tabIndex={mediaType === 'image' ? 0 : -1} aria-selected={mediaType === 'image'} aria-controls="image-panel" onClick={() => setMediaType('image')} disabled={loading || processing || batchProcessing || zipping}><Image size={17} aria-hidden="true" />Imagens</button>
          <button id="video-tab" type="button" role="tab" tabIndex={mediaType === 'video' ? 0 : -1} aria-selected={mediaType === 'video'} aria-controls="video-panel" onClick={() => setMediaType('video')} disabled={loading || processing || batchProcessing || zipping}><Video size={17} aria-hidden="true" />Vídeos</button>
        </div>

        {mediaType === 'video' ? (
          <section id="video-panel" role="tabpanel" aria-labelledby="video-tab">
            <Suspense fallback={<div className="loading-state" role="status">Preparando a limpeza de vídeos…</div>}><VideoWorkspace /></Suspense>
          </section>
        ) : (
        <section id="image-panel" role="tabpanel" aria-labelledby="image-tab">
        <QualitySettings scale={processingOptions.upscale} disabled={loading || processing || batchProcessing || zipping} locked={batch.some((image) => image.status === 'done')} onChange={(upscale) => setProcessingOptions((options) => ({ ...options, upscale }))} />
        <UploadDropzone
          files={batch.length ? batch.map((image) => image.file) : file ? [file] : []}
          previewUrl={previewUrl}
          onFiles={selectFiles}
          onPasteImage={(image) => selectFile(image, true)}
          onError={setError}
          onClear={reset}
          disabled={loading || processing || batchProcessing || zipping}
        />
        {error && <div className="error-banner" role="alert">{error}</div>}
        {loading && <div className="loading-state"><span className="skeleton-line" /><span>Inspecionando metadados…</span></div>}
        {progress && <div className="enhancement-progress"><div role="status"><span>{progress.message}</span>{progress.percent !== undefined && <progress aria-label="Progresso da melhoria de qualidade" value={progress.percent} max={100} />}</div><button className="cancel-processing" type="button" onClick={() => controller.current?.abort()}>Cancelar processamento</button></div>}

        {batch.length > 0 && <BatchPanel images={batch} processing={batchProcessing} zipping={zipping} onProcess={processBatch} onDownloadZip={downloadZip} onReset={reset} />}

        {file && previewUrl && info && inspection && !loading && (
          <div className="workspace">
            <MetadataPanel info={info} inspection={inspection} previewUrl={previewUrl} />
            <ResultPanel
              originalInfo={info}
              originalPreviewUrl={previewUrl}
              result={result}
              processing={processing}
              options={processingOptions}
              onOptionsChange={setProcessingOptions}
              onProcess={process}
              onReset={reset}
            />
          </div>
        )}

        {!file && batch.length === 0 && (
          <div className="empty-assurance">
            <ShieldCheck size={20} />
            <p><strong>Privacidade por padrão.</strong> Nenhum upload, conta ou servidor. O processamento acontece inteiramente no seu navegador.</p>
          </div>
        )}
        </section>
        )}
      </main>
      <footer>CleanFrame · ferramenta interna para publicação segura</footer>
    </div>
  )
}
