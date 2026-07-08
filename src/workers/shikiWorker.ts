/// <reference lib="webworker" />

import { ShikiStreamTokenizer } from 'shiki-stream'
import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemedToken,
} from 'shiki/core'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'
import onigWasmUrl from 'shiki/onig.wasm?url'
import type { BundledTheme } from 'shiki/themes'

export type WorkerToken = [content: string, color: string]

export type WorkerRequest =
  | { type: 'init'; themes: BundledTheme[] }
  | { type: 'highlight'; id: number; key: string; text: string; language: string; theme: BundledTheme; complete?: boolean }
  | { type: 'dispose'; key: string }

export type WorkerResponse =
  | {
      type: 'highlight'
      id: number
      key: string
      reset: boolean
      stable: WorkerToken[]
      unstable: WorkerToken[]
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

const langLoaders: Record<string, () => Promise<unknown>> = {
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  clojure: () => import('@shikijs/langs/clojure'),
  cmake: () => import('@shikijs/langs/cmake'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  dotenv: () => import('@shikijs/langs/dotenv'),
  elixir: () => import('@shikijs/langs/elixir'),
  erlang: () => import('@shikijs/langs/erlang'),
  fish: () => import('@shikijs/langs/fish'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  groovy: () => import('@shikijs/langs/groovy'),
  haskell: () => import('@shikijs/langs/haskell'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  less: () => import('@shikijs/langs/less'),
  lua: () => import('@shikijs/langs/lua'),
  make: () => import('@shikijs/langs/make'),
  markdown: () => import('@shikijs/langs/markdown'),
  'objective-c': () => import('@shikijs/langs/objective-c'),
  'objective-cpp': () => import('@shikijs/langs/objective-cpp'),
  perl: () => import('@shikijs/langs/perl'),
  php: () => import('@shikijs/langs/php'),
  powershell: () => import('@shikijs/langs/powershell'),
  prisma: () => import('@shikijs/langs/prisma'),
  protobuf: () => import('@shikijs/langs/proto'),
  python: () => import('@shikijs/langs/python'),
  r: () => import('@shikijs/langs/r'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  scala: () => import('@shikijs/langs/scala'),
  scss: () => import('@shikijs/langs/scss'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  sql: () => import('@shikijs/langs/sql'),
  svelte: () => import('@shikijs/langs/svelte'),
  swift: () => import('@shikijs/langs/swift'),
  terraform: () => import('@shikijs/langs/terraform'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  viml: () => import('@shikijs/langs/viml'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
}
const languageAliases: Record<string, string> = {
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  golang: 'go',
  javascriptreact: 'jsx',
  js: 'javascript',
  mjs: 'javascript',
  py: 'python',
  shell: 'bash',
  ts: 'typescript',
  typescriptreact: 'tsx',
  yml: 'yaml',
}

function loadOnigWasm(): Promise<ArrayBuffer> {
  onigWasmPromise ??= fetch(onigWasmUrl).then(response => {
    if (!response.ok) throw new Error(`Failed to load Shiki WASM: ${response.status}`)
    return response.arrayBuffer()
  })
  return onigWasmPromise
}

function findLangLoader(lang: string): (() => Promise<unknown>) | undefined {
  const key = languageAliases[lang] ?? lang
  return langLoaders[key]
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

async function highlight(request: Extract<WorkerRequest, { type: 'highlight' }>) {
  try {
    const instance = await highlighter
    if (!instance) throw new Error('Shiki worker not initialized')

    const language = findLangLoader(request.language) ? request.language : 'text'
    await ensureLang(instance, language)

    if (request.complete) {
      const result = instance.codeToTokens(request.text, { lang: language, theme: request.theme })
      streams.delete(request.key)
      post({
        type: 'highlight',
        id: request.id,
        key: request.key,
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
