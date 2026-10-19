export interface Inspection {
  path: string
  name: string
  format: string
  kind: 'image' | 'video'
  size: number
  metadata: Array<{ label: string; value: string }>
  warnings: string[]
}

export interface InspectionError {
  path: string
  error: string
}

export interface CleanResult {
  path: string
  name: string
  format: string
  kind: 'image' | 'video'
  sizeBefore: number
  sizeAfter: number
  removedCount: number
  status: 'cleaned' | 'already_clean'
  warnings: string[]
}

export interface McpConfig {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface CleanFrameBridge {
  pickFiles(): Promise<Array<Inspection | InspectionError>>
  inspectFiles(paths: string[]): Promise<Array<Inspection | InspectionError>>
  cleanFile(path: string): Promise<CleanResult>
  pathForFile(file: File): string
  getMcpConfig(): Promise<McpConfig>
  copyText(text: string): Promise<void>
}

declare global {
  interface Window {
    cleanFrame?: CleanFrameBridge
  }
}
