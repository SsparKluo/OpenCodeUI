import { useState, useEffect, useMemo, useRef, useId } from 'react'
import type { ShikiThemeInput } from '../lib/shiki'
import { disposeShikiWorkerKey, highlightHtmlInWorker, highlightTokensInWorker } from '../lib/shikiWorkerClient'
import type { HighlightTokens } from '../lib/highlightTypes'
import { normalizeLanguage } from '../utils/languageUtils'
import { THEME_SWITCH_DISABLE_MS } from '../constants'

export type { HighlightTokens } from '../lib/highlightTypes'

type IdleWindowApi = {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (id: number) => void
}

type HighlightTask = () => Promise<void>

// ============================================
// LRU 缓存层 - 避免重复高亮相同代码
// ============================================

interface CacheEntry<T> {
  value: T
  timestamp: number
}

class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private maxSize: number

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (entry) {
      // 更新时间戳（LRU）
      entry.timestamp = Date.now()
      return entry.value
    }
    return undefined
  }

  set(key: string, value: T): void {
    // 如果已存在，更新
    if (this.cache.has(key)) {
      this.cache.get(key)!.value = value
      this.cache.get(key)!.timestamp = Date.now()
      return
    }

    // 如果满了，删除最老的
    if (this.cache.size >= this.maxSize) {
      let oldestKey: string | null = null
      let oldestTime = Infinity
      for (const [k, v] of this.cache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp
          oldestKey = k
        }
      }
      if (oldestKey) this.cache.delete(oldestKey)
    }

    this.cache.set(key, { value, timestamp: Date.now() })
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// 全局缓存实例 - HTML 和 Tokens 分开缓存
// 控制缓存上限，避免长对话占用过多内存
const htmlCache = new LRUCache<string>(120)
const tokensCache = new LRUCache<HighlightTokens>(80)

const highlightQueue: HighlightTask[] = []
let highlightQueueRunning = false
let highlightRequestId = 0

function scheduleQueuedHighlight(task: HighlightTask): () => void {
  let cancelled = false
  highlightQueue.push(async () => {
    if (!cancelled) await task()
  })
  void runHighlightQueue()

  return () => {
    cancelled = true
  }
}

async function runHighlightQueue() {
  if (highlightQueueRunning) return
  highlightQueueRunning = true

  try {
    while (highlightQueue.length > 0) {
      const task = highlightQueue.shift()
      if (task) await task()
      await yieldToMainThread()
    }
  } finally {
    highlightQueueRunning = false
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, 0)
  })
}

// 生成缓存 key
function getCacheKey(code: string, lang: string, theme: string): string {
  // 使用简单 hash 减少 key 长度
  const codeHash = simpleHash(code)
  return `${codeHash}:${lang}:${theme}`
}

// 简单的字符串 hash
function simpleHash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash
}

// 带缓存的高亮函数
async function highlightWithCache(
  code: string,
  lang: string,
  theme: ShikiThemeInput,
  themeKey: string,
  mode: 'html' | 'tokens',
): Promise<string | HighlightTokens | null> {
  const cacheKey = getCacheKey(code, lang, themeKey)

  if (mode === 'html') {
    const cached = htmlCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    try {
      const { html } = await highlightHtmlInWorker({
        key: `html:${cacheKey}:${highlightRequestId++}`,
        text: code,
        language: lang,
        theme,
      })
      htmlCache.set(cacheKey, html)
      return html
    } catch {
      // 语言不在 shiki bundle 中，跳过高亮
      return null
    }
  } else {
    const cached = tokensCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    try {
      const { tokens } = await highlightTokensInWorker({
        key: `tokens:${cacheKey}:${highlightRequestId++}`,
        text: code,
        language: lang,
        theme,
        complete: true,
      })
      tokensCache.set(cacheKey, tokens)
      return tokens
    } catch {
      return null
    }
  }
}

// 导出缓存统计（调试用）
export function getHighlightCacheStats() {
  return {
    htmlCacheSize: htmlCache.size,
    tokensCacheSize: tokensCache.size,
  }
}

// 清除缓存（主题切换时可能需要）
export function clearHighlightCache() {
  htmlCache.clear()
  tokensCache.clear()
}

// ============================================

// 根据明暗模式选择 Shiki 官方完整主题。官方主题不依赖项目 preset/customCSS，缓存 key 不应跟这些变化。
export function getShikiTheme(isDark: boolean): { theme: ShikiThemeInput; key: string } {
  const theme = isDark ? 'github-dark-default' : 'github-light-default'
  return {
    theme,
    key: theme,
  }
}

// ============================================
// 全局主题状态单例 - 避免每个 CodeBlock 都创建监听器
// ============================================

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

    // 监听 data-mode 属性变化
    this.observer = new MutationObserver(() => {
      const newIsDark = this.detectTheme()
      if (newIsDark !== this.isDark) {
        this.isDark = newIsDark
        this.notify()
      }
    })

    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode'],
    })

    // 监听系统主题变化
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      const mode = document.documentElement.getAttribute('data-mode')
      if (!mode || mode === 'system') {
        const newIsDark = this.mediaQuery!.matches
        if (newIsDark !== this.isDark) {
          this.isDark = newIsDark
          this.notify()
        }
      }
    }
    this.mediaQuery.addEventListener('change', handleChange)
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

// 全局单例
let themeStateManager: ThemeStateManager | null = null

function getThemeStateManager(): ThemeStateManager {
  if (!themeStateManager) {
    themeStateManager = new ThemeStateManager()
  }
  return themeStateManager
}

// 使用全局单例的 hook
function useIsDarkMode(): boolean {
  const manager = getThemeStateManager()
  const [isDark, setIsDark] = useState(() => manager.getIsDark())

  useEffect(() => {
    return manager.subscribe(setIsDark)
  }, [manager])

  return isDark
}

export interface HighlightOptions {
  lang?: string
  theme?: ShikiThemeInput
  enabled?: boolean
  delayMs?: number
}

export function useStreamingSyntaxHighlight(
  code: string,
  options: HighlightOptions = {},
): { output: HighlightTokens | null; highlightedCode: string; isLoading: boolean } {
  const { lang = 'text', theme, enabled = true } = options
  const normalizedLang = normalizeLanguage(lang)
  const isDark = useIsDarkMode()
  const instanceId = useId()
  const resolvedTheme = useMemo(() => {
    if (theme) return { theme, key: theme }
    return getShikiTheme(isDark)
  }, [theme, isDark])

  const [outputState, setOutputState] = useState<{ code: string; tokens: HighlightTokens } | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const workerKeyRef = useRef('')

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    const key = `stream:${instanceId}:${normalizedLang}:${resolvedTheme.key}`
    workerKeyRef.current = key
    const loadingFrame = requestAnimationFrame(() => {
      if (!cancelled) setIsLoading(true)
    })

    void highlightTokensInWorker({ key, text: code, language: normalizedLang, theme: resolvedTheme.theme })
      .then(result => {
        if (!cancelled) setOutputState({ code: result.code, tokens: result.tokens })
      })
      .catch(err => {
        if (import.meta.env.DEV && err instanceof Error && err.message !== 'superseded') {
          console.warn('[Syntax] streaming Shiki worker error:', err)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(loadingFrame)
    }
  }, [code, enabled, instanceId, normalizedLang, resolvedTheme.key, resolvedTheme.theme])

  useEffect(() => {
    return () => {
      if (workerKeyRef.current) disposeShikiWorkerKey(workerKeyRef.current)
    }
  }, [])

  const currentOutput = enabled && outputState && code.startsWith(outputState.code) ? outputState : null
  return { output: currentOutput?.tokens ?? null, highlightedCode: currentOutput?.code ?? '', isLoading: enabled && isLoading }
}

// Overload for HTML mode (default)
export function useSyntaxHighlight(
  code: string,
  options?: HighlightOptions & { mode?: 'html' },
): { output: string | null; isLoading: boolean }
// Overload for Tokens mode
export function useSyntaxHighlight(
  code: string,
  options: HighlightOptions & { mode: 'tokens' },
): { output: HighlightTokens | null; isLoading: boolean }

export function useSyntaxHighlight(code: string, options: HighlightOptions & { mode?: 'html' | 'tokens' } = {}) {
  const { lang = 'text', theme, mode = 'html', enabled = true, delayMs = 0 } = options
  const normalizedLang = normalizeLanguage(lang)

  // 自动检测当前主题模式
  const isDark = useIsDarkMode()

  // 如果没有指定主题，则根据 isDark 自动选择
  const resolvedTheme = useMemo(() => {
    if (theme) {
      return { theme, key: theme }
    }
    return getShikiTheme(isDark)
  }, [theme, isDark])

  const cacheKey = useMemo(
    () => getCacheKey(code, normalizedLang, resolvedTheme.key),
    [code, normalizedLang, resolvedTheme.key],
  )
  const outputKey = `${mode}:${cacheKey}`
  const [outputState, setOutputState] = useState<{ key: string; value: string | HighlightTokens | null } | null>(() => {
    const cachedResult = mode === 'html' ? htmlCache.get(cacheKey) : tokensCache.get(cacheKey)
    return cachedResult !== undefined ? { key: outputKey, value: cachedResult } : null
  })
  const [isLoading, setIsLoading] = useState(false)
  const prevKeyRef = useRef<{ code: string; lang: string; themeKey: string } | null>(null)

  // 原先此处有 useLayoutEffect 做同步高亮（codeToTokensSyncIfLoaded），
  // 会在浏览器绘制前阻塞主线程——500 行代码耗时 ~150ms，1000 行 ~300ms。
  // 删除后由下方 useEffect 的异步路径接管：先绘制纯文本，再通过
  // scheduleQueuedHighlight（含 yieldToMainThread）逐块高亮，不阻塞交互。
  useEffect(() => {
    // Even when highlighting is temporarily disabled by viewport/lifecycle state,
    // keep already-computed results available after layout changes or remounts.
    const cachedResult = mode === 'html' ? htmlCache.get(cacheKey) : tokensCache.get(cacheKey)
    if (cachedResult !== undefined) {
      setOutputState({ key: outputKey, value: cachedResult })
      setIsLoading(false)
      return
    }

    if (!enabled) {
      // 禁用时保留上次结果（而非清空），避免 enabled 切换导致无意义的
      // null → value 重渲染循环。调用方 resize 结束后 enabled 恢复为 true，
      // 缓存命中直接返回，不会触发额外渲染。
      setIsLoading(false)
      return
    }

    let cancelled = false
    const prevKey = prevKeyRef.current
    const isThemeOnlyChange =
      !!prevKey && prevKey.code === code && prevKey.lang === normalizedLang && prevKey.themeKey !== resolvedTheme.key
    prevKeyRef.current = { code, lang: normalizedLang, themeKey: resolvedTheme.key }

    const shouldDefer = isThemeOnlyChange

    setIsLoading(true)

    async function highlight() {
      try {
        const result = await highlightWithCache(code, normalizedLang, resolvedTheme.theme, resolvedTheme.key, mode)
        if (!cancelled) setOutputState({ key: outputKey, value: result })
      } catch (err) {
        // Syntax highlighting error - silently fallback
        if (import.meta.env.DEV) {
          console.warn('[Syntax] Shiki error:', err)
        }
        if (!cancelled) setOutputState({ key: outputKey, value: null })
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    const schedule = () => {
      if (shouldDefer) {
        const idleWindow = window as Window & IdleWindowApi
        if (typeof idleWindow.requestIdleCallback === 'function') {
          const idleId = idleWindow.requestIdleCallback(
            () => {
              void highlight()
            },
            {
              timeout: THEME_SWITCH_DISABLE_MS * 2,
            },
          )
          return () => idleWindow.cancelIdleCallback?.(idleId)
        }
        const timeoutId = window.setTimeout(() => highlight(), THEME_SWITCH_DISABLE_MS)
        return () => clearTimeout(timeoutId)
      }
      if (delayMs > 0) {
        let cancelQueuedHighlight: (() => void) | null = null
        const timeoutId = window.setTimeout(() => {
          cancelQueuedHighlight = scheduleQueuedHighlight(highlight)
        }, delayMs)
        return () => {
          clearTimeout(timeoutId)
          cancelQueuedHighlight?.()
        }
      }
      return scheduleQueuedHighlight(highlight)
    }

    const cancelSchedule = schedule()

    return () => {
      cancelled = true
      cancelSchedule()
    }
  }, [cacheKey, code, delayMs, enabled, mode, normalizedLang, outputKey, resolvedTheme])

  return { output: outputState?.key === outputKey ? outputState.value : null, isLoading }
}

// ============================================
// Ref 版本 — tokens 不经过 React state/props
// 用于 CodePreview 等需要处理超大 token 数组的场景
// ============================================

/**
 * 与 useSyntaxHighlight 功能相同，但 tokens 存在 ref 里，
 * 只通过一个自增的 version number 触发渲染。
 * 避免 React 在 fiber 层面持有/比较巨大的 token 数组。
 */
export function useSyntaxHighlightRef(
  code: string,
  options: Omit<HighlightOptions, 'mode'> = {},
): { tokensRef: React.RefObject<HighlightTokens | null>; version: number } {
  const { lang = 'text', theme, enabled = true } = options
  const normalizedLang = normalizeLanguage(lang)

  const isDark = useIsDarkMode()
  const resolvedTheme = useMemo(() => {
    if (theme) {
      return { theme, key: theme }
    }
    return getShikiTheme(isDark)
  }, [theme, isDark])

  const tokensRef = useRef<HighlightTokens | null>(null)
  const [version, setVersion] = useState(0)
  const prevKeyRef = useRef<{ code: string; lang: string; themeKey: string } | null>(null)

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false
    const prevKey = prevKeyRef.current
    const isThemeOnlyChange =
      !!prevKey && prevKey.code === code && prevKey.lang === normalizedLang && prevKey.themeKey !== resolvedTheme.key
    prevKeyRef.current = { code, lang: normalizedLang, themeKey: resolvedTheme.key }

    const shouldDefer = isThemeOnlyChange

    // 先检查缓存
    const cacheKey = getCacheKey(code, normalizedLang, resolvedTheme.key)
    const cachedResult = tokensCache.get(cacheKey)

    if (cachedResult !== undefined) {
      tokensRef.current = cachedResult
      setVersion(v => v + 1) // eslint-disable-line react-hooks/set-state-in-effect -- 缓存命中时需同步通知消费者
      return
    }

    // code 变了时清空 ref，version 不变所以不触发额外渲染
    if (!isThemeOnlyChange) {
      tokensRef.current = null
    }

    async function highlight() {
      try {
        const result = await highlightWithCache(code, normalizedLang, resolvedTheme.theme, resolvedTheme.key, 'tokens')
        if (!cancelled) {
          tokensRef.current = result as HighlightTokens | null
          setVersion(v => v + 1)
        }
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[Syntax] Shiki error:', err)
        }
        if (!cancelled) {
          tokensRef.current = null
          setVersion(v => v + 1)
        }
      }
    }

    const schedule = () => {
      if (shouldDefer) {
        const idleWindow = window as Window & IdleWindowApi
        if (typeof idleWindow.requestIdleCallback === 'function') {
          const idleId = idleWindow.requestIdleCallback(
            () => {
              void highlight()
            },
            { timeout: THEME_SWITCH_DISABLE_MS * 2 },
          )
          return () => idleWindow.cancelIdleCallback?.(idleId)
        }
        const timeoutId = window.setTimeout(() => highlight(), THEME_SWITCH_DISABLE_MS)
        return () => clearTimeout(timeoutId)
      }
      return scheduleQueuedHighlight(highlight)
    }

    const cancelSchedule = schedule()

    return () => {
      cancelled = true
      cancelSchedule()
    }
  }, [code, normalizedLang, resolvedTheme, enabled])

  return { tokensRef, version }
}
