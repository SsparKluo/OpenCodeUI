/// <reference lib="webworker" />

import { ShikiStreamTokenizer } from 'shiki-stream'
import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemedToken,
} from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import onigWasmUrl from 'shiki/onig.wasm?url'
import { bundledLanguagesAlias, bundledLanguagesBase } from 'shiki/langs'
import type { BundledTheme } from 'shiki/themes'

export type WorkerToken = [content: string, color: string]

export type WorkerRequest =
  | { type: 'init'; themes: BundledTheme[] }
  | {
      type: 'highlight'
      id: number
      key: string
      text: string
      language: string
      theme: BundledTheme
      mode: 'tokens' | 'html'
      complete?: boolean
    }
  | { type: 'dispose'; key: string }

export type WorkerResponse =
  | {
      type: 'highlight'
      id: number
      key: string
      code: string
      reset: boolean
      stable: WorkerToken[]
      unstable: WorkerToken[]
      html?: string
    }
  | { type: 'error'; id: number; key: string; message: string }
  | { type: 'superseded'; id: number; key: string }
  | { type: 'ready' }

type Stream = {
  language: string
  theme: BundledTheme
  source: string
  tokenizer: ShikiStreamTokenizer
}

const streams = new Map<string, Stream>()
const activeHighlights = new Set<string>()
const queuedHighlights = new Map<string, Extract<WorkerRequest, { type: 'highlight' }>>()
let highlighter: Promise<HighlighterCore> | undefined
let onigWasmPromise: Promise<ArrayBuffer> | null = null
const plainLanguages = new Set(['text', 'txt', 'plain', 'plaintext'])

const langLoaders = {
  ...bundledLanguagesBase,
  ...bundledLanguagesAlias,
} as Record<string, (() => Promise<unknown>) | undefined>

function loadOnigWasm(): Promise<ArrayBuffer> {
  onigWasmPromise ??= fetch(onigWasmUrl).then(response => {
    if (!response.ok) throw new Error(`Failed to load Shiki WASM: ${response.status}`)
    return response.arrayBuffer()
  })
  return onigWasmPromise
}

function findLangLoader(lang: string): (() => Promise<unknown>) | undefined {
  return langLoaders[lang.toLowerCase()]
}

async function ensureLang(instance: HighlighterCore, lang: string): Promise<boolean> {
  if (instance.getLoadedLanguages().includes(lang)) return true
  const loader = findLangLoader(lang)
  if (!loader) return false
  await instance.loadLanguage(loader as Parameters<HighlighterCore['loadLanguage']>[0])
  return true
}

function toWorkerToken(value: ThemedToken): WorkerToken {
  return [value.content, value.color ?? '']
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function plainTextHtml(value: string): string {
  return `<pre class="shiki"><code>${escapeHtml(value)}</code></pre>`
}

async function highlight(request: Extract<WorkerRequest, { type: 'highlight' }>) {
  try {
    const instance = await highlighter
    if (!instance) throw new Error('Shiki worker not initialized')

    const requestedLanguage = request.language.toLowerCase()
    const language = plainLanguages.has(requestedLanguage) || findLangLoader(requestedLanguage) ? requestedLanguage : 'text'
    const isPlainText = plainLanguages.has(language)
    const loaded = isPlainText ? true : await ensureLang(instance, language)
    if (!loaded) throw new Error(`Unsupported Shiki language: ${request.language}`)

    if (isPlainText) {
      post({
        type: 'highlight',
        id: request.id,
        key: request.key,
        code: request.text,
        reset: true,
        stable: request.mode === 'html' ? [] : [[request.text, '']],
        unstable: [],
        html: request.mode === 'html' ? plainTextHtml(request.text) : undefined,
      })
      return
    }

    if (request.mode === 'html') {
      const html = instance.codeToHtml(request.text, { lang: language, theme: request.theme })
      streams.delete(request.key)
      post({
        type: 'highlight',
        id: request.id,
        key: request.key,
        code: request.text,
        reset: true,
        stable: [],
        unstable: [],
        html,
      })
      return
    }

    if (request.complete) {
      const result = instance.codeToTokens(request.text, { lang: language, theme: request.theme })
      streams.delete(request.key)
      post({
        type: 'highlight',
        id: request.id,
        key: request.key,
        code: request.text,
        reset: true,
        stable: result.tokens
          .flatMap((line, index) =>
            index === result.tokens.length - 1 ? line : [...line, { content: '\n', offset: 0 } as ThemedToken],
          )
          .map(toWorkerToken),
        unstable: [],
      })
      return
    }

    const previous = streams.get(request.key)
    const reset = !previous || previous.language !== language || previous.theme !== request.theme || !request.text.startsWith(previous.source)
    const stream = reset
      ? { language, theme: request.theme, source: '', tokenizer: new ShikiStreamTokenizer({ highlighter: instance, lang: language, theme: request.theme }) }
      : previous
    const chunk = request.text.slice(stream.source.length)
    if (chunk) await stream.tokenizer.enqueue(chunk)
    stream.source = request.text
    streams.set(request.key, stream)
    post({
      type: 'highlight',
      id: request.id,
      key: request.key,
      code: request.text,
      reset,
      stable: stream.tokenizer.tokensStable.filter(t => t.content.length > 0).map(toWorkerToken),
      unstable: stream.tokenizer.tokensUnstable.filter(t => t.content.length > 0).map(toWorkerToken),
    })
  } catch (error) {
    post({ type: 'error', id: request.id, key: request.key, message: error instanceof Error ? error.message : String(error) })
  }
}

function post(response: WorkerResponse) {
  self.postMessage(response)
}

function runQueuedHighlight(request: Extract<WorkerRequest, { type: 'highlight' }>) {
  activeHighlights.add(request.key)
  void highlight(request).finally(() => {
    activeHighlights.delete(request.key)
    const next = queuedHighlights.get(request.key)
    if (!next) return
    queuedHighlights.delete(request.key)
    runQueuedHighlight(next)
  })
}

function queueHighlight(request: Extract<WorkerRequest, { type: 'highlight' }>) {
  if (!activeHighlights.has(request.key)) {
    runQueuedHighlight(request)
    return
  }

  const previous = queuedHighlights.get(request.key)
  if (previous) post({ type: 'superseded', id: previous.id, key: previous.key })
  queuedHighlights.set(request.key, request)
}

const themeLoaders: Record<string, () => Promise<unknown>> = {
  'github-dark-default': () => import('shiki/themes/github-dark-default.mjs'),
  'github-light-default': () => import('shiki/themes/github-light-default.mjs'),
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  if (msg.type === 'init') {
    highlighter ??= createHighlighterCore({
      engine: createOnigurumaEngine(loadOnigWasm),
      themes: msg.themes.map(t => themeLoaders[t]?.() ?? themeLoaders['github-dark-default']!()) as Parameters<typeof createHighlighterCore>[0]['themes'],
      langs: [],
    })
    void highlighter.then(() => post({ type: 'ready' }))
    return
  }
  if (msg.type === 'dispose') {
    const queued = queuedHighlights.get(msg.key)
    if (queued) post({ type: 'superseded', id: queued.id, key: queued.key })
    queuedHighlights.delete(msg.key)
    streams.delete(msg.key)
    return
  }
  queueHighlight(msg)
}
