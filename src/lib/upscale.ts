import type { ProcessingOptions, UpscaleScale } from '../types'
import { upscaleDimensions } from './upscaleGeometry'
import type { UpscaleMessage } from './upscaleProtocol'

let worker: Worker | null = null

export async function upscaleCanvas(source: HTMLCanvasElement, scale: UpscaleScale, options: ProcessingOptions) {
  options.signal?.throwIfAborted()
  const dimensions = upscaleDimensions(source.width, source.height, scale)
  const pixels = source.getContext('2d')?.getImageData(0, 0, source.width, source.height)
  if (!pixels) throw new Error('Não foi possível ler os pixels para melhorar a imagem.')
  const output = document.createElement('canvas')
  output.width = dimensions.width
  output.height = dimensions.height
  const context = output.getContext('2d')
  if (!context) throw new Error('Seu navegador não oferece suporte à melhoria de imagem.')
  const currentWorker = worker ??= new Worker(new URL('./upscale.worker.ts', import.meta.url), { type: 'module' })
  try {
    const backend = await new Promise<'webgpu' | 'wasm'>((resolve, reject) => {
      const cleanUp = () => {
        currentWorker.onmessage = null
        currentWorker.onerror = null
        options.signal?.removeEventListener('abort', abort)
      }
      const abort = () => {
        cleanUp()
        currentWorker.terminate()
        worker = null
        reject(new DOMException('Processamento cancelado.', 'AbortError'))
      }
      currentWorker.onerror = () => {
        cleanUp()
        currentWorker.terminate()
        worker = null
        reject(new Error('Não foi possível iniciar a melhoria de qualidade. Tente novamente ou desative a opção.'))
      }
      currentWorker.onmessage = ({ data }: MessageEvent<UpscaleMessage>) => {
        if (data.type === 'progress') options.onProgress?.({ message: data.message, percent: data.percent })
        if (data.type === 'tile') context.putImageData(new ImageData(data.pixels, data.width, data.height), data.x, data.y)
        if (data.type === 'done') { cleanUp(); resolve(data.backend) }
        if (data.type === 'error') { cleanUp(); reject(new Error(data.message)) }
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      currentWorker.postMessage({ pixels: pixels.data, width: source.width, height: source.height, scale, modelUrl: new URL(`${import.meta.env.BASE_URL}models/realesr-general-x4v3-dn50.onnx`, window.location.origin).href }, [pixels.data.buffer])
    })
    return { canvas: output, backend }
  } catch (reason) {
    output.width = 0; output.height = 0
    throw reason
  }
}
