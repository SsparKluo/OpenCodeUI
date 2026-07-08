import { describe, expect, it } from 'vitest'
import { getShikiTheme } from './useSyntaxHighlight'
import { isSupportedLanguage, normalizeLanguage } from '../utils/languageUtils'

describe('getShikiTheme', () => {
  it('uses complete GitHub bundled themes by default', () => {
    expect(getShikiTheme(true).theme).toBe('github-dark-default')
    expect(getShikiTheme(false).theme).toBe('github-light-default')
  })

  it('uses stable cache keys that only depend on syntax theme', () => {
    expect(getShikiTheme(true).key).toBe('github-dark-default')
    expect(getShikiTheme(false).key).toBe('github-light-default')
  })
})

describe('Shiki language metadata', () => {
  it('keeps common aliases supported through Shiki bundled aliases', () => {
    expect(isSupportedLanguage(normalizeLanguage('js'))).toBe(true)
    expect(isSupportedLanguage(normalizeLanguage('ts'))).toBe(true)
    expect(isSupportedLanguage(normalizeLanguage('py'))).toBe(true)
  })

  it('does not restrict highlighting to the worker hot language list', () => {
    expect(isSupportedLanguage('wolfram')).toBe(true)
    expect(isSupportedLanguage('emacs-lisp')).toBe(true)
  })
})
