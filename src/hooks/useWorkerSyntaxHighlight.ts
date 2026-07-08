import { useState, useEffect, useRef, useMemo, useId } from 'react'
import type { BundledTheme } from 'shiki/themes'
import { highlightTokensInWorker, disposeShikiWorkerKey } from '../lib/shikiWorkerClient'
import type { HighlightTokens } from '../lib/highlightTypes'
import { normalizeLanguage } from '../utils/languageUtils'

function getShikiTheme(isDark: boolean): { theme: BundledTheme; key: string } {
  const theme = isDark ? 'github-dark-default' : 'github-light-default'
  return { theme, key: theme }
}

class ThemeStateManager {
  private isDark: boolean
  private subscribers = new Set<(isDark: boolean) => void>()
  private observer: MutationObserver | null = null
  private mediaQuery: MediaQueryList | null = null

  constructor() {
    this.isDark = this.detectTheme()
    this.setupListeners()
  }

  private detectTheme(): boolean {
    if (typeof window === 'undefined') return true
    const mode = document.documentElement.getAttribute('data-mode')
    if (mode === 'light') return false
    if (mode === 'dark') return true
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  private setupListeners() {
    if (typeof window === 'undefined') return
    this.observer = new MutationObserver(() => {
      const newIsDark = this.detectTheme()
      if (newIsDark !== this.isDark) {
        this.isDark = newIsDark
        this.notify()
      }
    })
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] })
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    this.mediaQuery.addEventListener('change', () => {
      const mode = document.documentElement.getAttribute('data-mode')
      if (!mode || mode === 'system') {
        const newIsDark = this.mediaQuery!.matches
        if (newIsDark !== this.isDark) {
          this.isDark = newIsDark
          this.notify()
        }
      }
    })
  }

  private notify() {
    this.subscribers.forEach(fn => fn(this.isDark))
  }

  getIsDark(): boolean {
    return this.isDark
  }

  subscribe(fn: (isDark: boolean) => void): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }
}

let themeStateManager: ThemeStateManager | null = null
function getThemeStateManager(): ThemeStateManager {
  if (!themeStateManager) themeStateManager = new ThemeStateManager()
  return themeStateManager
}

function useIsDarkMode(): boolean {
  const manager = getThemeStateManager()
  const [isDark, setIsDark] = useState(() => manager.getIsDark())
  useEffect(() => manager.subscribe(setIsDark), [manager])
  return isDark
}

export interface WorkerHighlightOptions {
  lang?: string
  enabled?: boolean
}

export function useWorkerSyntaxHighlight(
  code: string,
  options: WorkerHighlightOptions = {},
): { output: HighlightTokens | null; highlightedCode: string; isLoading: boolean } {
  const { lang = 'text', enabled = true } = options
  const normalizedLang = normalizeLanguage(lang)
  const isDark = useIsDarkMode()
  const resolvedTheme = useMemo(() => getShikiTheme(isDark), [isDark])
  const instanceId = useId()

  const [outputState, setOutputState] = useState<{ code: string; tokens: HighlightTokens } | null>(null)
  const workerKeyRef = useRef('')

  const key = `${instanceId}:${normalizedLang}:${resolvedTheme.key}`

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    const previousKey = workerKeyRef.current
    if (previousKey && previousKey !== key) disposeShikiWorkerKey(previousKey)
    workerKeyRef.current = key

    void highlightTokensInWorker({
      key,
      text: code,
      language: normalizedLang,
      theme: resolvedTheme.theme,
    })
      .then(result => {
        if (!cancelled) setOutputState({ code: result.code, tokens: result.tokens })
      })
      .catch(() => {
        // Worker failures fall back to plain code rendering in CodeBlock.
      })

    return () => {
      cancelled = true
    }
  }, [code, enabled, key, normalizedLang, resolvedTheme.theme])

  useEffect(() => {
    return () => {
      if (workerKeyRef.current) disposeShikiWorkerKey(workerKeyRef.current)
    }
  }, [])

  return {
    output: enabled ? (outputState?.tokens ?? null) : null,
    highlightedCode: enabled ? (outputState?.code ?? '') : '',
    isLoading: false,
  }
}
