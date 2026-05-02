/**
 * Shiki highlighter — lazy per-language loading
 *
 * 只静态打包 core + WASM engine + 2 个主题。
 * 语言 grammar 全部运行时按需 import()，每个语言单独 chunk（几 KB）。
 */

import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import { bundledLanguagesBase, bundledLanguagesAlias } from 'shiki/langs'
import type { BundledTheme } from 'shiki/themes'

export interface CustomShikiTheme {
  name: string
  type: 'light' | 'dark'
  colors?: Record<string, string>
  tokenColors?: Array<{
    scope?: string | string[]
    settings?: {
      foreground?: string
      fontStyle?: string
      fontWeight?: string
      textDecoration?: string
    }
  }>
}

export type ShikiThemeInput = BundledTheme | CustomShikiTheme
type ShikiThemeRuntimeInput = Parameters<HighlighterCore['codeToTokens']>[1] extends { theme: infer T } ? T : never

// ── singleton ──────────────────────────────────────────────

let highlighter: HighlighterCore | null = null
let initPromise: Promise<HighlighterCore> | null = null

/**
 * 获取 / 初始化 highlighter 单例。
 * 重复调用只会创建一次。
 */
export function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return Promise.resolve(highlighter)
  if (initPromise) return initPromise

  initPromise = createHighlighterCore({
    engine: createOnigurumaEngine(() => import('shiki/wasm')),
    themes: [import('shiki/themes/github-dark.mjs'), import('shiki/themes/github-light.mjs')],
    langs: [], // 不预加载任何语言
  }).then(h => {
    highlighter = h
    return h
  })

  return initPromise
}

function computedColorToHex(cssColor: string): string | null {
  try {
    const ctx = document.createElement('canvas').getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = cssColor
    const normalized = ctx.fillStyle
    if (normalized.startsWith('#')) return normalized

    const match = normalized.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
    if (!match) return null

    const r = parseInt(match[1], 10)
    const g = parseInt(match[2], 10)
    const b = parseInt(match[3], 10)
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
  } catch {
    return null
  }
}

function cssVarToHex(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (!value) return fallback
  return computedColorToHex(`hsl(${value})`) || fallback
}

export function createAdaptiveShikiTheme(isDark: boolean): CustomShikiTheme {
  // GitHub/Primer-like syntax colors, kept as a custom theme so code highlighting still follows
  // app theme revisions and can be tuned without giving up Shiki token fidelity.
  const syntax = {
    comment: cssVarToHex('--text-400', isDark ? '#8b949e' : '#6e7781'),
    regexp: isDark ? '#a5d6ff' : '#0a3069',
    string: isDark ? '#a5d6ff' : '#0a3069',
    keyword: isDark ? '#ff7b72' : '#cf222e',
    primitive: isDark ? '#79c0ff' : '#0550ae',
    operator: cssVarToHex('--text-300', isDark ? '#c9d1d9' : '#24292f'),
    variable: cssVarToHex('--text-100', isDark ? '#c9d1d9' : '#24292f'),
    property: isDark ? '#79c0ff' : '#0550ae',
    type: isDark ? '#ffa657' : '#953800',
    constant: isDark ? '#79c0ff' : '#0550ae',
    punctuation: cssVarToHex('--text-300', isDark ? '#c9d1d9' : '#24292f'),
    info: isDark ? '#d2a8ff' : '#8250df',
    success: isDark ? '#7ee787' : '#116329',
    warning: isDark ? '#ffa657' : '#953800',
    critical: isDark ? '#ff7b72' : '#cf222e',
  }

  return {
    name: isDark ? 'OpenCodeUI Dark' : 'OpenCodeUI Light',
    type: isDark ? 'dark' : 'light',
    colors: {
      'editor.background': cssVarToHex('--bg-100', isDark ? '#24292e' : '#ffffff'),
      'editor.foreground': syntax.variable,
    },
    tokenColors: [
      {
        scope: ['comment', 'punctuation.definition.comment'],
        settings: { foreground: syntax.comment, fontStyle: 'italic' },
      },
      {
        scope: ['string.regexp', 'constant.character.escape', 'constant.other.character-class.regexp'],
        settings: { foreground: syntax.regexp },
      },
      {
        scope: ['string', 'string.quoted', 'string.template', 'markup.inline.raw', 'markup.inserted'],
        settings: { foreground: syntax.string },
      },
      {
        scope: ['keyword', 'storage', 'storage.modifier', 'keyword.operator.word'],
        settings: { foreground: syntax.keyword },
      },
      {
        scope: ['constant.numeric', 'constant.language.boolean', 'constant.language.null', 'constant.language.undefined'],
        settings: { foreground: syntax.primitive },
      },
      {
        scope: [
          'keyword.operator',
          'keyword.operator.assignment',
          'keyword.operator.logical',
          'keyword.operator.expression',
          'punctuation.accessor',
          'punctuation.separator.key-value',
          'punctuation.separator.dictionary.key-value',
        ],
        settings: { foreground: syntax.operator },
      },
      {
        scope: ['support.type.property-name.json', 'meta.object-literal.key', 'variable.other.property', 'variable.object.property'],
        settings: { foreground: syntax.property },
      },
      {
        scope: [
          'punctuation.support.type.property-name.begin.json',
          'punctuation.support.type.property-name.end.json',
          'punctuation.support.type.property-name.json',
        ],
        settings: { foreground: syntax.property },
      },
      {
        scope: ['entity.other.attribute-name', 'entity.other.attribute-name.html', 'entity.other.attribute-name.jsx'],
        settings: { foreground: syntax.property },
      },
      {
        scope: ['entity.name.function', 'support.function', 'support.function.builtin', 'variable.function', 'meta.function-call'],
        settings: { foreground: syntax.info },
      },
      {
        scope: ['entity.name.type', 'entity.name.class', 'support.type', 'storage.type', 'support.class'],
        settings: { foreground: syntax.type },
      },
      {
        scope: ['constant', 'constant.language', 'support.constant', 'variable.other.constant'],
        settings: { foreground: syntax.constant },
      },
      {
        scope: ['entity.name.tag', 'entity.name.tag.tsx', 'entity.name.tag.jsx', 'support.class.component'],
        settings: { foreground: syntax.info },
      },
      {
        scope: ['variable', 'variable.other.readwrite', 'entity.name.object', 'support.variable'],
        settings: { foreground: syntax.variable },
      },
      {
        scope: ['punctuation', 'meta.brace', 'meta.delimiter'],
        settings: { foreground: syntax.punctuation },
      },
      {
        scope: ['markup.heading', 'entity.name.section'],
        settings: { foreground: syntax.keyword, fontWeight: '600' },
      },
      {
        scope: ['markup.link', 'string.other.link'],
        settings: { foreground: syntax.info, textDecoration: 'underline' },
      },
      {
        scope: ['markup.bold'],
        settings: { foreground: syntax.warning, fontWeight: '600' },
      },
      {
        scope: ['markup.italic'],
        settings: { foreground: syntax.warning, fontStyle: 'italic' },
      },
      {
        scope: ['markup.deleted'],
        settings: { foreground: syntax.critical },
      },
      {
        scope: ['markup.changed'],
        settings: { foreground: syntax.warning },
      },
      {
        scope: ['markup.inserted'],
        settings: { foreground: syntax.success },
      },
    ],
  }
}

// ── language loading ───────────────────────────────────────

/** 正在加载中的语言 → Promise（避免重复 import） */
const loadingLangs = new Map<string, Promise<void>>()

/**
 * 确保某个语言已经加载到 highlighter 中。
 * 已加载的语言会被跳过，不会重复请求。
 */
export async function ensureLang(lang: string): Promise<boolean> {
  const h = await getHighlighter()

  // 已经加载了
  const loaded = h.getLoadedLanguages()
  if (loaded.includes(lang)) return true

  // 正在加载中
  const pending = loadingLangs.get(lang)
  if (pending) {
    await pending
    return true
  }

  // 查找 loader
  const loader =
    (bundledLanguagesBase as Record<string, (() => Promise<unknown>) | undefined>)[lang] ??
    (bundledLanguagesAlias as Record<string, (() => Promise<unknown>) | undefined>)[lang]

  if (!loader) return false // shiki 不支持的语言

  const promise = h.loadLanguage(loader as Parameters<HighlighterCore['loadLanguage']>[0]).then(
    () => {
      loadingLangs.delete(lang)
    },
    err => {
      loadingLangs.delete(lang)
      if (import.meta.env.DEV) {
        console.warn(`[shiki] failed to load lang "${lang}":`, err)
      }
    },
  )
  loadingLangs.set(lang, promise)
  await promise

  return h.getLoadedLanguages().includes(lang)
}

// ── 高亮 API（对外封装）────────────────────────────────────

export async function codeToHtml(code: string, opts: { lang: string; theme: ShikiThemeInput }): Promise<string> {
  const h = await getHighlighter()
  await ensureLang(opts.lang)

  // 如果语言加载失败，fallback 到 plaintext
  const loaded = h.getLoadedLanguages()
  const safeLang = loaded.includes(opts.lang) ? opts.lang : 'text'

  return h.codeToHtml(code, { lang: safeLang, theme: opts.theme as unknown as ShikiThemeRuntimeInput })
}

export async function codeToTokens(code: string, opts: { lang: string; theme: ShikiThemeInput }) {
  const h = await getHighlighter()
  await ensureLang(opts.lang)

  const loaded = h.getLoadedLanguages()
  const safeLang = loaded.includes(opts.lang) ? opts.lang : 'text'

  return h.codeToTokens(code, { lang: safeLang, theme: opts.theme as unknown as ShikiThemeRuntimeInput })
}

// ── 语言支持检测（纯元数据，不拉 grammar）──────────────────

const supportedLangs = new Set([...Object.keys(bundledLanguagesBase), ...Object.keys(bundledLanguagesAlias)])

export function isSupportedLanguage(lang: string): boolean {
  return supportedLangs.has(lang)
}
