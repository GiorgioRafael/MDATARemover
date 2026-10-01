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
export type UpscaleScale = 2 | 4
export interface ProcessingProgress {
  message: string
  percent?: number
}

export interface ProcessingOptions {
  mode: ProcessingMode
  preset: RobustnessPreset
  seed: string
  upscale?: UpscaleScale
  onProgress?: (progress: ProcessingProgress) => void
  signal?: AbortSignal
}

export interface ProcessingReport {
  mode: ProcessingMode
  preset?: RobustnessPreset
  seed?: string
  transformations: string[]
  academicWatermark: boolean
  upscale?: { algorithm: 'Real-ESRGAN'; scale: UpscaleScale; originalWidth: number; originalHeight: number; backend: 'webgpu' | 'wasm' }
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
