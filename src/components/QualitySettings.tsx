import { ScanLine } from 'lucide-react'
import type { UpscaleScale } from '../types'

interface Props {
  scale?: UpscaleScale
  disabled: boolean
  locked: boolean
  onChange: (scale?: UpscaleScale) => void
}

export function QualitySettings({ scale, disabled, locked, onChange }: Props) {
  return (
    <section className="quality-settings" aria-labelledby="quality-title">
      <div className="quality-copy"><h2 id="quality-title"><ScanLine size={19} />Melhorar qualidade com IA</h2><p>Amplie a resolução e reduza ruído com Real-ESRGAN, no seu dispositivo.</p></div>
      <label htmlFor="upscale-scale">Ampliação
        <select id="upscale-scale" value={scale ?? 1} disabled={disabled || locked} onChange={(event) => onChange(event.target.value === '1' ? undefined : Number(event.target.value) as UpscaleScale)}>
          <option value="1">Desativada · só limpar</option>
          <option value="2">2× · recomendada</option>
          <option value="4">4× · mais resolução</option>
        </select>
      </label>
      <p className="quality-note">{locked ? 'A qualidade deste lote está definida. Inicie um novo lote para mudar a ampliação.' : scale ? 'A IA pode recriar detalhes. Revise o resultado. Primeira execução baixa o modelo; as fotos não são enviadas. Até 16 MP na saída; em lotes, o processo pode demorar.' : 'Escolha 2× ou 4× antes de selecionar ou colar imagens. A remoção de metadados continua ativa.'}</p>
    </section>
  )
}
