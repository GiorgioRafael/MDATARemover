import { AlertTriangle, Aperture, Copyright, FileText, Fingerprint, Image as ImageIcon, Info, MapPin, ShieldAlert } from 'lucide-react'
import type { ImageInfo, ImageInspection, MetadataCategory } from '../types'
import { formatBytes, formatDimensions } from '../lib/format'

interface Props {
  info: ImageInfo
  inspection: ImageInspection
  previewUrl: string
}

const categoryIcons: Record<MetadataCategory, typeof FileText> = {
  Arquivo: FileText,
  Imagem: ImageIcon,
  Câmera: Aperture,
  Localização: MapPin,
  Autoria: Copyright,
  Outros: ShieldAlert,
}

export function MetadataPanel({ info, inspection, previewUrl }: Props) {
  const grouped = inspection.items.reduce<Partial<Record<MetadataCategory, typeof inspection.items>>>((all, item) => {
    ;(all[item.category] ??= []).push(item)
    return all
  }, {})
  const total = inspection.items.length + inspection.blocks.length

  return (
    <section className="panel metadata-panel" aria-labelledby="before-title">
      <div className="panel-heading">
        <div><h2 id="before-title">Antes</h2><p>Metadados encontrados na imagem original</p></div>
        <span className={`count-badge ${total === 0 ? 'is-neutral' : ''}`}>{total} {total === 1 ? 'removível' : 'removíveis'}</span>
      </div>

      <div className="file-summary">
        <img src={previewUrl} alt="Imagem original" />
        <div><strong>{info.name}</strong><span>{formatBytes(info.size)} · {formatDimensions(info.width, info.height)}</span></div>
      </div>

      <div className={`inspection-assessment is-${inspection.assessment.kind}`}>
        <Info size={18} />
        <div><strong>{inspection.assessment.title}</strong><span>{inspection.assessment.description}</span></div>
      </div>

      {inspection.blocks.length > 0 && (
        <div className="embedded-alert">
          <AlertTriangle size={18} />
          <div><strong>{inspection.blocks.length} {inspection.blocks.length === 1 ? 'bloco embutido' : 'blocos embutidos'}</strong><span>{inspection.blocks.map((block) => block.label).join(', ')}</span></div>
        </div>
      )}

      <div className="metadata-list">
        {Object.entries(grouped).map(([category, items]) => {
          const Icon = categoryIcons[category as MetadataCategory]
          return (
            <div className="metadata-group" key={category}>
              <div className="group-title"><Icon size={17} /><h3>{category}</h3></div>
              {items.map((item) => (
                <div className="metadata-row" key={item.key}>
                  <span>{item.label}{item.sensitive && <span className="sensitive-dot" title="Dado potencialmente sensível" />}</span>
                  <strong title={item.value}>{item.value}</strong>
                </div>
              ))}
            </div>
          )
        })}
        {inspection.items.length === 0 && inspection.blocks.length === 0 && (
          <div className="no-metadata"><ShieldAlert size={20} /><p>0 metadados pessoais removíveis. A imagem ainda pode ser reprocessada para gerar um arquivo novo e normalizado.</p></div>
        )}
        <div className="technical-details">
          <div className="group-title"><Fingerprint size={17} /><h3>Análise técnica do arquivo</h3></div>
          {inspection.technical.map((detail) => (
            <div className="metadata-row" key={detail.key}>
              <span>{detail.label}</span>
              <strong title={detail.value}>{detail.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
