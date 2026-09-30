import { describe, expect, it } from 'vitest'
import { describeRecipe, getRobustnessRecipe, seedToUint32 } from './robustnessLab'

describe('robustnessLab', () => {
  it('gera a mesma receita para a mesma semente', () => {
    expect(getRobustnessRecipe('moderado', 'ensaio-42')).toEqual(getRobustnessRecipe('moderado', 'ensaio-42'))
  })

  it('gera rotações diferentes para sementes diferentes', () => {
    expect(getRobustnessRecipe('moderado', 'ensaio-a').angleDegrees).not.toBe(getRobustnessRecipe('moderado', 'ensaio-b').angleDegrees)
  })

  it('mantém os níveis dentro de limites conservadores', () => {
    const intense = getRobustnessRecipe('intenso', 'tcc')
    expect(Math.abs(intense.angleDegrees)).toBeLessThanOrEqual(0.25)
    expect(intense.cropPercent).toBeLessThanOrEqual(0.02)
    expect(intense.noiseAmplitude).toBeLessThanOrEqual(2.2)
  })

  it('produz hash de semente estável e relatório legível', () => {
    expect(seedToUint32('tcc-001')).toBe(seedToUint32('tcc-001'))
    expect(describeRecipe(getRobustnessRecipe('leve', 'tcc-001'))).toContain('Marca d’água visível de experimento acadêmico')
  })
})
