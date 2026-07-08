import { useState, useEffect, useRef, useMemo, useId } from 'react'
import { normalizeLanguage } from '../utils/languageUtils'
import type { BundledTheme } from 'shiki/themes'
import type { WorkerRequest, WorkerResponse, WorkerToken } from '../workers/shikiWorker'
import type { HighlightTokens } from './useSyntaxHighlight'

type FlatToken = HighlightTokens[number][number]

let worker: Worker | null = null
let workerReady: Promise<void> | null = null
let nextId = 1

const pendingRequests = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (err: unknown) => void }>()
const latestRequestByKey = new Map<string, number>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../workers/shikiWorker.ts', import.meta.url), { type: 'module' })

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const msg = event.data
    if (msg.type === 'ready') {
      workerReadyPromiseResolve?.()
      return
    }
    if ('id' in msg) {
      const pending = pendingRequests.get(msg.id)
      if (pending) {
        pendingRequests.delete(msg.id)
        if (msg.type === 'error') {
          pending.reject(new Error(msg.message))
        } else if (msg.type === 'superseded') {
          pending.reject(new Error('superseded'))
        } else {
          pending.resolve(msg)
        }
      }
    }
  }

  return worker
}

let workerReadyPromiseResolve: (() => void) | null = null
function ensureWorkerReady(): Promise<void> {
  if (workerReady) return workerReady
  workerReady = new Promise(resolve => {
    workerReadyPromiseResolve = resolve
  })
  const w = getWorker()
  w.postMessage({ type: 'init', themes: ['github-dark-default', 'github-light-default'] } satisfies WorkerRequest)
  return workerReady
}

function workerHighlight(params: {
  key: string
  text: string
  language: string
  theme: BundledTheme
  complete?: boolean
}): Promise<Extract<WorkerResponse, { type: 'highlight' }>> {
  const id = nextId++
  const w = getWorker()

  latestRequestByKey.set(params.key, id)

  return new Promise<Extract<WorkerResponse, { type: 'highlight' }>>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: resolve as (r: WorkerResponse) => void,
      reject: reject as (err: unknown) => void,
    })
    w.postMessage({ type: 'highlight', id, ...params } satisfies WorkerRequest)
  })
}

function workerDispose(key: string) {
  if (!worker) return
  worker.postMessage({ type: 'dispose', key } satisfies WorkerRequest)
  latestRequestByKey.delete(key)
}

function splitTokensIntoLines(tokens: WorkerToken[]): HighlightTokens {
  if (tokens.length === 0) return [[]]
  const lines: HighlightTokens = []
  let currentLine: FlatToken[] = []

  for (const [content, color] of tokens) {
    const token: FlatToken = { content, color } as FlatToken
    const newlineIndex = content.indexOf('\n')
    if (newlineIndex === -1) {
      currentLine.push(token)
      continue
    }
    const segments = content.split('\n')
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (seg) currentLine.push(i === 0 && seg === content ? token : { ...token, content: seg })
      if (i < segments.length - 1) {
        lines.push(currentLine)
        currentLine = []
      }
    }
  }
  if (currentLine.length > 0 || lines.length === 0) lines.push(currentLine)
  return lines
}

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
    if (!enabled) {
      return
    }

    let cancelled = false
    const previousKey = workerKeyRef.current
    if (previousKey && previousKey !== key) workerDispose(previousKey)
    workerKeyRef.current = key

    void (async () => {
      try {
        await ensureWorkerReady()
        if (cancelled || workerKeyRef.current !== key) return

        const result = await workerHighlight({
          key,
          text: code,
          language: normalizedLang,
          theme: resolvedTheme.theme,
        })
        if (cancelled) return

        const latest = latestRequestByKey.get(key)
        if (result.id !== latest) return

        const tokens = splitTokensIntoLines([...result.stable, ...result.unstable])
        setOutputState({ code, tokens })
      } catch {
        // Worker failures fall back to plain code rendering in CodeBlock.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [code, enabled, key, normalizedLang, resolvedTheme.theme])

  useEffect(() => {
    return () => {
      if (workerKeyRef.current) workerDispose(workerKeyRef.current)
    }
  }, [])

  return {
    output: enabled ? (outputState?.tokens ?? null) : null,
    highlightedCode: enabled ? (outputState?.code ?? '') : '',
    isLoading: false,
  }
}
