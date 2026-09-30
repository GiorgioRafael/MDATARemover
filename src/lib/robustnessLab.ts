import type { RobustnessPreset } from '../types'

export interface RobustnessRecipe {
  cropPercent: number
  angleDegrees: number
  brightness: number
  contrast: number
  saturation: number
  noiseAmplitude: number
  quality: number
}

const PRESETS: Record<RobustnessPreset, Omit<RobustnessRecipe, 'angleDegrees'>> = {
  leve: {
    cropPercent: 0.006,
    brightness: 1.005,
    contrast: 1.01,
    saturation: 0.995,
    noiseAmplitude: 0.8,
    quality: 0.94,
  },
  moderado: {
    cropPercent: 0.012,
    brightness: 1.012,
    contrast: 1.025,
    saturation: 0.985,
    noiseAmplitude: 1.4,
    quality: 0.9,
  },
  intenso: {
    cropPercent: 0.02,
    brightness: 1.02,
    contrast: 1.04,
    saturation: 0.97,
    noiseAmplitude: 2.2,
    quality: 0.86,
  },
}

export function seedToUint32(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function createRandom(seed: number) {
  let state = seed || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }
}

export function getRobustnessRecipe(preset: RobustnessPreset, seed: string): RobustnessRecipe {
  const random = createRandom(seedToUint32(seed))
  const maximumAngle = preset === 'leve' ? 0.08 : preset === 'moderado' ? 0.16 : 0.25
  return {
    ...PRESETS[preset],
    angleDegrees: (random() * 2 - 1) * maximumAngle,
  }
}

export function describeRecipe(recipe: RobustnessRecipe): string[] {
  return [
    `Reenquadramento de ${(recipe.cropPercent * 100).toFixed(1)}%`,
    `Rotação determinística de ${recipe.angleDegrees.toFixed(2)}°`,
    'Ajuste leve de luminosidade, contraste e saturação',
    `Ruído RGB reproduzível (amplitude ${recipe.noiseAmplitude.toFixed(1)})`,
    `Recompressão com qualidade ${Math.round(recipe.quality * 100)}% quando aplicável`,
    'Marca d’água visível de experimento acadêmico',
  ]
}

function addSeededNoise(context: CanvasRenderingContext2D, width: number, height: number, amplitude: number, seed: string) {
  const pixels = context.getImageData(0, 0, width, height)
  const data = pixels.data
  const random = createRandom(seedToUint32(`${seed}:pixels`))

  for (let index = 0; index < data.length; index += 4) {
    const delta = (random() * 2 - 1) * amplitude
    data[index] = Math.max(0, Math.min(255, data[index] + delta))
    data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + delta * 0.82))
    data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + delta * 1.08))
  }

  context.putImageData(pixels, 0, 0)
}

function addAcademicWatermark(context: CanvasRenderingContext2D, width: number, height: number) {
  const fontSize = Math.max(11, Math.min(30, Math.round(Math.min(width, height) * 0.027)))
  const paddingX = Math.max(8, Math.round(fontSize * 0.7))
  const paddingY = Math.max(6, Math.round(fontSize * 0.45))
  const margin = Math.max(8, Math.round(fontSize * 0.7))
  const label = 'EXPERIMENTO ACADÊMICO · NÃO PUBLICAR'

  context.save()
  context.font = `700 ${fontSize}px system-ui, sans-serif`
  context.textBaseline = 'middle'
  const textWidth = context.measureText(label).width
  const boxWidth = Math.min(width - margin * 2, textWidth + paddingX * 2)
  const boxHeight = fontSize + paddingY * 2
  const x = width - boxWidth - margin
  const y = height - boxHeight - margin

  context.globalAlpha = 0.82
  context.fillStyle = '#102f25'
  context.fillRect(x, y, boxWidth, boxHeight)
  context.globalAlpha = 1
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.fillText(label, x + boxWidth / 2, y + boxHeight / 2, Math.max(1, boxWidth - paddingX * 2))
  context.restore()
}

export function drawRobustnessStudy(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  preset: RobustnessPreset,
  seed: string,
): RobustnessRecipe {
  const recipe = getRobustnessRecipe(preset, seed)
  const angle = recipe.angleDegrees * Math.PI / 180
  const scale = 1 + recipe.cropPercent * 2 + Math.abs(angle)

  context.save()
  context.translate(width / 2, height / 2)
  context.rotate(angle)
  context.filter = `brightness(${recipe.brightness}) contrast(${recipe.contrast}) saturate(${recipe.saturation})`
  context.drawImage(source, -width * scale / 2, -height * scale / 2, width * scale, height * scale)
  context.restore()
  context.filter = 'none'

  addSeededNoise(context, width, height, recipe.noiseAmplitude, seed)
  addAcademicWatermark(context, width, height)
  return recipe
}
