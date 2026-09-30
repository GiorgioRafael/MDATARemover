import { Beaker, Check, Download, FileCheck2, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import type { ImageInfo, ProcessedImage, ProcessingOptions, RobustnessPreset } from '../types'
import { formatBytes, formatDimensions } from '../lib/format'

interface Props {
  originalInfo: ImageInfo
  originalPreviewUrl: string
  result: ProcessedImage | null
  processing: boolean
  options: ProcessingOptions
  onOptionsChange: (options: ProcessingOptions) => void
  onProcess: () => void
  onReset: () => void
}

export function ResultPanel({ originalInfo, originalPreviewUrl, result, processing, options, onOptionsChange, onProcess, onReset }: Props) {
  const cleanCount = result ? result.inspection.items.length + result.inspection.blocks.length : null
  const outputFingerprint = result?.inspection.technical.find((detail) => detail.key === 'sha256')?.value
  const sizeDifference = result ? Math.round((result.info.size / originalInfo.size - 1) * 100) : 0
  const sizeComparison = sizeDifference === 0
    ? 'mesmo tamanho do original'
    : `${Math.abs(sizeDifference)}% ${sizeDifference > 0 ? 'maior' : 'menor'} que o original`

  if (!result) {
    return (
      <section className="panel result-panel waiting" aria-labelledby="after-title">
        <div className="panel-heading"><div><h2 id="after-title">Depois</h2><p>A cópia limpa aparecerá aqui</p></div></div>
        <div className="waiting-preview"><img src={originalPreviewUrl} alt="Prévia aguardando limpeza" /><div className="preview-veil"><Sparkles size={28} /></div></div>
        <div className="process-copy"><h3>Pronta para limpar</h3><p>Vamos reconstruir a imagem a partir dos pixels e verificar o arquivo final.</p></div>
        <div className="processing-mode" aria-label="Modo de processamento">
          <label className="mode-option">
            <input
              type="radio"
              name="processing-mode"
              checked={options.mode === 'metadata-only'}
              onChange={() => onOptionsChange({ ...options, mode: 'metadata-only' })}
            />
            <span><strong>Somente privacidade</strong><small>Remove metadados sem alterar intencionalmente a aparência.</small></span>
          </label>
          <label className="mode-option research">
            <input
              type="radio"
              name="processing-mode"
              checked={options.mode === 'robustness-study'}
              onChange={() => onOptionsChange({ ...options, mode: 'robustness-study' })}
            />
            <span><strong><Beaker size={15} /> Laboratório de robustez</strong><small>Aplica transformações controladas e uma marca d’água acadêmica.</small></span>
          </label>
          {options.mode === 'robustness-study' && (
            <div className="research-settings">
              <label>Nível do ensaio
                <select value={options.preset} onChange={(event) => onOptionsChange({ ...options, preset: event.target.value as RobustnessPreset })}>
                  <option value="leve">Leve</option>
                  <option value="moderado">Moderado</option>
                  <option value="intenso">Intenso</option>
                </select>
              </label>
              <label>Semente reproduzível
                <input value={options.seed} maxLength={64} onChange={(event) => onOptionsChange({ ...options, seed: event.target.value || 'tcc-001' })} />
              </label>
              <p>Para avaliação controlada no detector da pesquisa. Não mede nem garante evasão em plataformas reais.</p>
            </div>
          )}
        </div>
        <button className="primary-button" type="button" onClick={onProcess} disabled={processing}>
          {processing ? <LoaderCircle className="spinner" size={19} /> : <Sparkles size={19} />}
          {processing ? 'Processando imagem…' : options.mode === 'robustness-study' ? 'Gerar amostra de pesquisa' : 'Remover todos os metadados'}
        </button>
      </section>
    )
  }

  return (
    <section className="panel result-panel" aria-labelledby="after-title">
      <div className="panel-heading">
        <div><h2 id="after-title">Depois</h2><p>Arquivo novo, pronto para publicar</p></div>
        <span className={`success-badge ${cleanCount !== 0 ? 'has-warning' : ''}`}><Check size={16} />{cleanCount} metadados encontrados</span>
      </div>
      <img className="result-image" src={result.url} alt="Imagem processada sem metadados" />
      <div className={`success-message ${cleanCount !== 0 ? 'has-warning' : ''}`}>
        <span><Check size={18} /></span>
        <div><strong>{cleanCount === 0 ? 'Limpeza verificada' : 'Atenção: restaram dados detectáveis'}</strong><p>{cleanCount === 0 ? 'Nenhum bloco EXIF, XMP, IPTC, ICC ou texto embutido foi encontrado.' : 'Revise o arquivo antes de publicar.'}</p></div>
      </div>
      <div className="technical-summary">
        <div className="group-title"><FileCheck2 size={17} /><h3>Resumo técnico</h3></div>
        <dl>
          <div><dt>Nome do arquivo</dt><dd>{result.name}</dd></div>
          <div><dt>Formato</dt><dd>{result.info.type.replace('image/', '').toUpperCase()}</dd></div>
          <div><dt>Tamanho</dt><dd>{formatBytes(result.info.size)} <span className="size-change">({sizeComparison})</span></dd></div>
          <div><dt>Dimensões</dt><dd>{formatDimensions(result.info.width, result.info.height)}</dd></div>
          {outputFingerprint && <div><dt>Hash do arquivo novo</dt><dd>{outputFingerprint}</dd></div>}
        </dl>
      </div>
      {result.report.mode === 'robustness-study' && (
        <div className="experiment-report">
          <div className="group-title"><Beaker size={17} /><h3>Relatório do ensaio</h3></div>
          <p>Preset <strong>{result.report.preset}</strong> · semente <code>{result.report.seed}</code></p>
          <ul>{result.report.transformations.map((item) => <li key={item}>{item}</li>)}</ul>
          <small>Saída marcada para uso acadêmico. Compare-a somente com detectores e conjuntos de dados que você tem autorização para testar.</small>
        </div>
      )}
      <p className="detection-note">O hash binário muda ao gerar o arquivo novo, mas redes sociais ainda podem reconhecer a imagem pela semelhança visual dos pixels.</p>
      <a className="primary-button" href={result.url} download={result.name}><Download size={19} />Baixar imagem limpa</a>
      <button className="secondary-button" type="button" onClick={onReset}><RotateCcw size={18} />Limpar outra imagem</button>
    </section>
  )
}
