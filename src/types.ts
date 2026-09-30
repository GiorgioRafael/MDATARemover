export type MetadataCategory = 'Arquivo' | 'Imagem' | 'Câmera' | 'Localização' | 'Autoria' | 'Outros'

export interface MetadataItem {
  key: string
  label: string
  value: string
  category: MetadataCategory
  sensitive?: boolean
}

export interface MetadataBlock {
  label: string
  bytes: number
}

export interface TechnicalDetail {
  key: string
  label: string
  value: string
}

export interface InspectionAssessment {
  title: string
  description: string
  kind: 'clean' | 'found' | 'platform-copy'
}

export interface ImageInspection {
  items: MetadataItem[]
  blocks: MetadataBlock[]
  technical: TechnicalDetail[]
  assessment: InspectionAssessment
}

export interface ImageInfo {
  name: string
  type: string
  size: number
  width: number
  height: number
}

export type ProcessingMode = 'metadata-only' | 'robustness-study'
export type RobustnessPreset = 'leve' | 'moderado' | 'intenso'

export interface ProcessingOptions {
  mode: ProcessingMode
  preset: RobustnessPreset
  seed: string
}

export interface ProcessingReport {
  mode: ProcessingMode
  preset?: RobustnessPreset
  seed?: string
  transformations: string[]
  academicWatermark: boolean
}

export interface ProcessedImage {
  blob: Blob
  url: string
  name: string
  info: ImageInfo
  inspection: ImageInspection
  report: ProcessingReport
}

export interface BatchImage {
  id: number
  file: File
  status: 'pending' | 'processing' | 'done' | 'error'
  error: string | null
  result: ProcessedImage | null
}
