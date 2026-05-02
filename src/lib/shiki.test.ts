import { describe, expect, it } from 'vitest'
import { createAdaptiveShikiTheme } from './shiki'

describe('createAdaptiveShikiTheme', () => {
  it('creates a custom dark Shiki theme with project syntax groups', () => {
    const theme = createAdaptiveShikiTheme(true)

    expect(theme.name).toBe('OpenCodeUI Dark')
    expect(theme.type).toBe('dark')
    expect(theme.colors?.['editor.foreground']).toBeTruthy()
    expect(foregroundFor(theme, 'string')).toBe('#a5d6ff')
    expect(foregroundFor(theme, 'keyword')).toBe('#ff7b72')
    expect(foregroundFor(theme, 'support.type.property-name.json')).toBe('#79c0ff')
    expect(theme.tokenColors?.some(rule => includesScope(rule.scope, 'support.type.property-name.json'))).toBe(true)
    expect(theme.tokenColors?.some(rule => includesScope(rule.scope, 'entity.name.function'))).toBe(true)
    expect(theme.tokenColors?.some(rule => includesScope(rule.scope, 'markup.heading'))).toBe(true)
  })

  it('creates a custom light Shiki theme', () => {
    const theme = createAdaptiveShikiTheme(false)

    expect(theme.name).toBe('OpenCodeUI Light')
    expect(theme.type).toBe('light')
    expect(foregroundFor(theme, 'string')).toBe('#0a3069')
    expect(foregroundFor(theme, 'keyword')).toBe('#cf222e')
    expect(foregroundFor(theme, 'support.type.property-name.json')).toBe('#0550ae')
    expect(theme.tokenColors?.length).toBeGreaterThan(10)
  })
})

function includesScope(scope: string | string[] | undefined, expected: string) {
  return Array.isArray(scope) ? scope.includes(expected) : scope === expected
}

function foregroundFor(theme: ReturnType<typeof createAdaptiveShikiTheme>, scope: string) {
  return theme.tokenColors?.find(rule => includesScope(rule.scope, scope))?.settings?.foreground
}
