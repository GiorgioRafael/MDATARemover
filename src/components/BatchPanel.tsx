import { AlertCircle, Archive, Check, Download, Image as ImageIcon, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import { memo } from 'react'
import { validateImage } from '../lib/imageProcessing'
import { formatBytes } from '../lib/format'
import type { BatchImage } from '../types'

interface Props {
  images: BatchImage[]
  processing: boolean
  zipping: boolean
  onProcess: () => void
  onDownloadZip: () => void
  onReset: () => void
}

const BatchRow = memo(function BatchRow({ image }: { image: BatchImage }) {
  return (
    <li className={`batch-row is-${image.status}`}>
      {image.status === 'done' && image.result ? <img src={image.result.url} alt="" loading="lazy" /> : <span className="batch-thumbnail"><ImageIcon size={22} /></span>}
      <div className="batch-file-copy">
        <strong title={image.file.name}>{image.file.name}</strong>
        <span>{formatBytes(image.file.size)}{image.result ? ` → ${formatBytes(image.result.info.size)}` : ''}{image.result?.report.upscale ? ` · ${image.result.info.width} × ${image.result.info.height} px · IA ${image.result.report.upscale.scale}×` : ''}</span>
        {image.error && <p role="alert">{image.error}</p>}
      </div>
      <span className="batch-status">
        {image.status === 'processing' ? <><LoaderCircle className="spinner" size={15} />Limpando</> : image.status === 'done' ? <><Check size={15} />Limpa</> : image.status === 'error' ? <><AlertCircle size={15} />Erro</> : 'Aguardando'}
      </span>
      {image.status === 'done' && image.result && <a className="batch-download" href={image.result.url} download={image.result.name} aria-label={`Baixar ${image.file.name}`}><Download size={17} />Baixar</a>}
    </li>
  )
})

export function BatchPanel({ images, processing, zipping, onProcess, onDownloadZip, onReset }: Props) {
  const done = images.filter((image) => image.status === 'done').length
  const failed = images.filter((image) => image.status === 'error').length
  const completed = done + failed
  const remaining = images.filter((image) => image.status !== 'done' && !validateImage(image.file)).length
  const current = images.find((image) => image.status === 'processing')
  const started = processing || completed > 0

  return (
    <section className="panel batch-panel" aria-labelledby="batch-title">
      <div className="panel-heading">
        <div><h2 id="batch-title">Limpeza em lote</h2><p>Até 100 fotos · processamento local · 25 MB por foto</p></div>
        <span className="batch-count">{done} de {images.length} limpas</span>
      </div>
      <div className="batch-actions">
        {remaining > 0 && (
          <button className="primary-button" type="button" onClick={onProcess} disabled={processing || zipping}>
            {processing ? <LoaderCircle className="spinner" size={18} /> : <Sparkles size={18} />}
            {processing ? 'Limpando fotos…' : `Limpar ${remaining} ${remaining === 1 ? 'foto' : 'fotos'}`}
          </button>
        )}
        <button className={remaining ? 'secondary-button' : 'primary-button'} type="button" onClick={onDownloadZip} disabled={!done || processing || zipping}>
          {zipping ? <LoaderCircle className="spinner" size={18} /> : <Archive size={18} />}
          {zipping ? 'Preparando ZIP…' : 'Baixar todas (.zip)'}
        </button>
        <button className="batch-reset" type="button" onClick={onReset} disabled={processing || zipping}><RotateCcw size={16} />Novo lote</button>
      </div>
      <div className="batch-progress" aria-live="polite">
        <div><span>{processing ? `Limpando ${current?.file.name ?? 'próxima foto'}…` : done === images.length ? 'Todas as fotos foram limpas e verificadas.' : started ? `${done} ${done === 1 ? 'foto limpa' : 'fotos limpas'}${failed ? ` · ${failed} com erro` : ''}` : 'Selecione “Limpar fotos” para começar.'}</span><strong>{completed}/{images.length}</strong></div>
        <progress aria-label="Progresso da limpeza" value={completed} max={images.length} />
        {failed > 0 && <p>As fotos com erro não entram no ZIP. As demais podem ser baixadas normalmente.</p>}
      </div>
      <ul className="batch-list" aria-label="Fotos do lote">
        {images.map((image) => <BatchRow image={image} key={image.id} />)}
      </ul>
    </section>
  )
}
