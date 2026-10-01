import * as ort from 'onnxruntime-web/webgpu'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import { imageTiles, MODEL_SCALE, upscaleDimensions } from './upscaleGeometry'
import type { UpscaleMessage, UpscaleRequest } from './upscaleProtocol'

const workerScope = self as unknown as {
  postMessage: (message: UpscaleMessage, transfer?: Transferable[]) => void
  onmessage: ((event: MessageEvent<UpscaleRequest>) => void) | null
}
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl }
let session: ort.InferenceSession | null = null
let backend: 'webgpu' | 'wasm' = 'wasm'
let running = false

const progress = (message: string, percent?: number) => workerScope.postMessage({ type: 'progress', message, percent })

async function getSession(modelUrl: string) {
  if (session) return session
  progress('Carregando o modelo de melhoria de imagem…')
  if ('gpu' in navigator) {
    try {
      session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' })
      backend = 'webgpu'
      return session
    } catch { /* Browsers without an available GPU use the same model on the CPU. */ }
  }
  progress('Preparando melhoria local pela CPU. Pode levar mais tempo…')
  session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  backend = 'wasm'
  return session
}

function alphaAt(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const clampedX = Math.max(0, Math.min(width - 1, x))
  const clampedY = Math.max(0, Math.min(height - 1, y))
  const left = Math.floor(clampedX), top = Math.floor(clampedY)
  const right = Math.min(width - 1, left + 1), bottom = Math.min(height - 1, top + 1)
  const dx = clampedX - left, dy = clampedY - top
  return pixels[(top * width + left) * 4 + 3] * (1 - dx) * (1 - dy)
    + pixels[(top * width + right) * 4 + 3] * dx * (1 - dy)
    + pixels[(bottom * width + left) * 4 + 3] * (1 - dx) * dy
    + pixels[(bottom * width + right) * 4 + 3] * dx * dy
}

async function upscale(request: UpscaleRequest) {
  const { pixels, width, height, scale, modelUrl } = request
  upscaleDimensions(width, height, scale)
  if (pixels.length !== width * height * 4) throw new Error('Não foi possível ler os pixels da imagem.')
  await getSession(modelUrl)
  const tiles = imageTiles(width, height)
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index]
    const area = tile.inputWidth * tile.inputHeight
    const inputData = new Float32Array(3 * area)
    for (let y = 0; y < tile.inputHeight; y++) {
      for (let x = 0; x < tile.inputWidth; x++) {
        const source = ((tile.top + y) * width + tile.left + x) * 4
        const destination = y * tile.inputWidth + x
        for (let channel = 0; channel < 3; channel++) inputData[channel * area + destination] = pixels[source + channel] / 255
      }
    }
    const input = new ort.Tensor('float32', inputData, [1, 3, tile.inputHeight, tile.inputWidth])
    let outputs: ort.InferenceSession.ReturnType | undefined
    try {
      try {
        outputs = await session!.run({ input })
      } catch (reason) {
        if (backend !== 'webgpu') throw reason
        // Device loss or unsupported GPU operators: retry this tile with the identical model.
        await session!.release()
        session = null
        backend = 'wasm'
        progress('Continuando a melhoria pela CPU. Pode levar mais tempo…')
        session = await ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
        outputs = await session.run({ input })
      }
      const output = outputs.output
      const data = await output.getData() as Float32Array
      const modelWidth = tile.inputWidth * MODEL_SCALE
      const modelArea = modelWidth * tile.inputHeight * MODEL_SCALE
      const outputWidth = tile.width * scale, outputHeight = tile.height * scale
      const tilePixels = new Uint8ClampedArray(outputWidth * outputHeight * 4)
      const ratio = MODEL_SCALE / scale
      for (let y = 0; y < outputHeight; y++) {
        for (let x = 0; x < outputWidth; x++) {
          const offset = (y * outputWidth + x) * 4
          const modelX = (tile.x - tile.left) * MODEL_SCALE + x * ratio
          const modelY = (tile.y - tile.top) * MODEL_SCALE + y * ratio
          for (let channel = 0; channel < 3; channel++) {
            let value = 0
            for (let dy = 0; dy < ratio; dy++) {
              for (let dx = 0; dx < ratio; dx++) value += data[channel * modelArea + (modelY + dy) * modelWidth + modelX + dx]
            }
            tilePixels[offset + channel] = Math.round(Math.max(0, Math.min(1, value / (ratio * ratio))) * 255)
          }
          tilePixels[offset + 3] = Math.round(alphaAt(pixels, width, height, tile.x + (x + 0.5) / scale - 0.5, tile.y + (y + 0.5) / scale - 0.5))
        }
      }
      workerScope.postMessage({ type: 'tile', pixels: tilePixels, x: tile.x * scale, y: tile.y * scale, width: outputWidth, height: outputHeight }, [tilePixels.buffer])
      const percent = Math.round((index + 1) / tiles.length * 100)
      progress(`Melhorando a imagem ${scale}× · ${percent}%${backend === 'wasm' ? ' · CPU' : ''}`, percent)
    } finally {
      input.dispose()
      if (outputs) for (const tensor of Object.values(outputs)) tensor.dispose()
    }
  }
  workerScope.postMessage({ type: 'done', backend })
}

workerScope.onmessage = async ({ data }) => {
  if (running) return
  running = true
  try { await upscale(data) }
  catch {
    if (session) await session.release().catch(() => {})
    session = null
    workerScope.postMessage({ type: 'error', message: 'Não foi possível concluir a melhoria de qualidade neste navegador. Tente novamente, escolha 2× ou desative a melhoria para limpar os metadados.' })
  } finally { running = false }
}
