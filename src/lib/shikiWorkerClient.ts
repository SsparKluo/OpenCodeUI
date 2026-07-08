import type { BundledTheme } from 'shiki/themes'
import type { WorkerRequest, WorkerResponse, WorkerToken } from '../workers/shikiWorker'
import type { HighlightTokens } from './highlightTypes'

type PendingRequest = {
  resolve: (response: WorkerResponse) => void
  reject: (error: unknown) => void
}

let worker: Worker | null = null
let workerReady: Promise<void> | null = null
let workerReadyPromiseResolve: (() => void) | null = null
let nextId = 1

const pendingRequests = new Map<number, PendingRequest>()
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

    if (!('id' in msg)) return
    const pending = pendingRequests.get(msg.id)
    if (!pending) return

    pendingRequests.delete(msg.id)
    if (msg.type === 'error') {
      pending.reject(new Error(msg.message))
    } else if (msg.type === 'superseded') {
      pending.reject(new Error('superseded'))
    } else {
      pending.resolve(msg)
    }
  }

  worker.onerror = error => {
    pendingRequests.forEach(pending => pending.reject(error))
    pendingRequests.clear()
    workerReady = null
    workerReadyPromiseResolve = null
    worker = null
  }

  return worker
}

export function ensureShikiWorkerReady(): Promise<void> {
  if (workerReady) return workerReady

  workerReady = new Promise(resolve => {
    workerReadyPromiseResolve = resolve
  })
  getWorker().postMessage({ type: 'init', themes: ['github-dark-default', 'github-light-default'] } satisfies WorkerRequest)
  return workerReady
}

function splitTokensIntoLines(tokens: WorkerToken[]): HighlightTokens {
  if (tokens.length === 0) return [[]]

  const lines: HighlightTokens = []
  let currentLine: HighlightTokens[number] = []

  for (const [content, color] of tokens) {
    const token = { content, color }
    const newlineIndex = content.indexOf('\n')
    if (newlineIndex === -1) {
      currentLine.push(token)
      continue
    }

    const segments = content.split('\n')
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]
      if (segment) currentLine.push(index === 0 && segment === content ? token : { ...token, content: segment })
      if (index < segments.length - 1) {
        lines.push(currentLine)
        currentLine = []
      }
    }
  }

  if (currentLine.length > 0 || lines.length === 0) lines.push(currentLine)
  return lines
}

async function workerHighlight(params: {
  key: string
  text: string
  language: string
  theme: BundledTheme
  mode: 'tokens' | 'html'
  complete?: boolean
}): Promise<Extract<WorkerResponse, { type: 'highlight' }>> {
  await ensureShikiWorkerReady()

  const id = nextId++
  const w = getWorker()
  latestRequestByKey.set(params.key, id)

  return new Promise<Extract<WorkerResponse, { type: 'highlight' }>>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: resolve as (response: WorkerResponse) => void,
      reject,
    })
    w.postMessage({ type: 'highlight', id, ...params } satisfies WorkerRequest)
  })
}

export async function highlightTokensInWorker(params: {
  key: string
  text: string
  language: string
  theme: BundledTheme
  complete?: boolean
}): Promise<{ id: number; code: string; tokens: HighlightTokens }> {
  const result = await workerHighlight({ ...params, mode: 'tokens' })
  if (result.id !== latestRequestByKey.get(params.key)) throw new Error('superseded')
  return {
    id: result.id,
    code: result.code,
    tokens: splitTokensIntoLines([...result.stable, ...result.unstable]),
  }
}

export async function highlightHtmlInWorker(params: {
  key: string
  text: string
  language: string
  theme: BundledTheme
}): Promise<{ id: number; html: string }> {
  const result = await workerHighlight({ ...params, mode: 'html', complete: true })
  if (result.id !== latestRequestByKey.get(params.key)) throw new Error('superseded')
  return { id: result.id, html: result.html ?? '' }
}

export function disposeShikiWorkerKey(key: string) {
  if (!worker) return

  worker.postMessage({ type: 'dispose', key } satisfies WorkerRequest)
  latestRequestByKey.delete(key)
}
