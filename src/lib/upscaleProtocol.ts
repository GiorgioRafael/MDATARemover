import type { UpscaleScale } from '../types'

export interface UpscaleRequest {
  pixels: Uint8ClampedArray
  width: number
  height: number
  scale: UpscaleScale
  modelUrl: string
}

export type UpscaleMessage =
  | { type: 'progress'; message: string; percent?: number }
  | { type: 'tile'; pixels: Uint8ClampedArray<ArrayBuffer>; x: number; y: number; width: number; height: number }
  | { type: 'done'; backend: 'webgpu' | 'wasm' }
  | { type: 'error'; message: string }
