import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventTypes } from '../types/api/event'

// 按 serverId 返回 URL 的 http mock：订阅迁移测试需要断言「新连接建到了哪台服务器」，
// 固定 URL 的 mock 无法区分 local 与 wsl:Ubuntu。未登记的 serverId 回退到 example.test，
// 保持与既有流式解析测试（不断言 URL）兼容。
const httpMocks = vi.hoisted(() => ({
  baseUrls: new Map<string, string>(),
}))

vi.mock('./http', () => ({
  getApiBaseUrl: (serverId?: string) => httpMocks.baseUrls.get(serverId ?? '') ?? 'http://example.test',
  getAuthHeader: () => ({}),
}))

vi.mock('../utils/tauri', () => ({
  isTauri: () => false,
}))

const encoder = new TextEncoder()

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(total)
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }

  return result
}

function createEventChunks(delta: string, splitAt: number): Uint8Array[] {
  const marker = '__DELTA__'
  const raw = `data: ${JSON.stringify({
    directory: 'global',
    payload: {
      type: EventTypes.MESSAGE_PART_DELTA,
      properties: {
        messageID: 'session-1',
        partID: 'part-1',
        field: 'text',
        delta: marker,
      },
    },
  })}\n\n`

  const [before, after] = raw.split(marker)
  const deltaBytes = encoder.encode(delta)

  return [
    concatBytes(encoder.encode(before), deltaBytes.slice(0, splitAt)),
    concatBytes(deltaBytes.slice(splitAt), encoder.encode(after)),
  ]
}

function createStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }
      controller.close()
    },
  })
}

function createFetchResponse(chunks: Uint8Array[]): Pick<Response, 'ok' | 'body'> {
  return {
    ok: true,
    body: createStream(chunks) as Response['body'],
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function createEventChunk(payload: object): Uint8Array[] {
  return [encoder.encode(`data: ${JSON.stringify({ directory: 'global', payload })}\n\n`)]
}

describe('subscribeToEvents', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('preserves Chinese text when UTF-8 bytes are split across chunks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createFetchResponse(createEventChunks('中文', 2)))
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents } = await import('./events')

    const received = await new Promise<string>((resolve, reject) => {
      const unsubscribe = subscribeToEvents({
        onPartDelta(data) {
          unsubscribe()
          resolve(data.delta)
        },
        onError(error) {
          unsubscribe()
          reject(error)
        },
      })
    })

    expect(received).toBe('中文')
  })

  it('preserves four-byte characters when split in the middle', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createFetchResponse(createEventChunks('𠮷😀', 3)))
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents } = await import('./events')

    const received = await new Promise<string>((resolve, reject) => {
      const unsubscribe = subscribeToEvents({
        onPartDelta(data) {
          unsubscribe()
          resolve(data.delta)
        },
        onError(error) {
          unsubscribe()
          reject(error)
        },
      })
    })

    expect(received).toBe('𠮷😀')
  })

  it('dispatches server.connected payloads with timestamp', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createFetchResponse(
        createEventChunk({
          type: EventTypes.SERVER_CONNECTED,
          properties: { timestamp: '2026-04-22T15:00:00.000Z' },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents } = await import('./events')

    const received = await new Promise<unknown>((resolve, reject) => {
      const unsubscribe = subscribeToEvents({
        onServerConnected(data) {
          unsubscribe()
          resolve(data.timestamp)
        },
        onError(error) {
          unsubscribe()
          reject(error)
        },
      })
    })

    expect(received).toBe('2026-04-22T15:00:00.000Z')
  })

  it('ignores stale server.connected events from an old browser SSE generation after reconnect', async () => {
    const firstFetch = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const secondFetch = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementationOnce(() => secondFetch.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents, reconnectSSE } = await import('./events')
    const received: string[] = []

    const unsubscribe = subscribeToEvents({
      onServerConnected(data) {
        if (typeof data.timestamp === 'string') {
          received.push(data.timestamp)
        }
      },
    })

    reconnectSSE()

    secondFetch.resolve(
      createFetchResponse(
        createEventChunk({
          type: EventTypes.SERVER_CONNECTED,
          properties: { timestamp: 'new-server-time' },
        }),
      ),
    )

    await vi.waitFor(() => {
      expect(received).toEqual(['new-server-time'])
    })

    firstFetch.resolve(
      createFetchResponse(
        createEventChunk({
          type: EventTypes.SERVER_CONNECTED,
          properties: { timestamp: 'stale-server-time' },
        }),
      ),
    )

    await Promise.resolve()
    await Promise.resolve()

    expect(received).toEqual(['new-server-time'])
    unsubscribe()
  })

  it('ignores stale browser fetch failures from an old SSE generation after reconnect', async () => {
    const firstFetch = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const secondFetch = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstFetch.promise)
      .mockImplementationOnce(() => secondFetch.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents, reconnectSSE, getConnectionInfo } = await import('./events')
    const onError = vi.fn()

    const unsubscribe = subscribeToEvents({
      onError,
    })

    reconnectSSE()

    firstFetch.reject(new Error('stale failure'))

    await Promise.resolve()
    await Promise.resolve()

    expect(onError).not.toHaveBeenCalled()
    expect(getConnectionInfo().state).toBe('connecting')

    secondFetch.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    unsubscribe()
  })
})

describe('subscribeToEvents server-change migration', () => {
  const LOCAL_URL = 'http://local.test'
  const WSL_URL = 'http://wsl.test'

  function fetchedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
    return fetchMock.mock.calls.map(call => String(call[0]))
  }

  beforeEach(() => {
    // 与相邻 describe 平级，外层的 vi.resetModules 不会作用于本块测试；
    // 必须自行重置，否则 events/serverStore 的模块级状态（连接池、变更监听器）跨测试泄漏
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
    httpMocks.baseUrls.set('local', LOCAL_URL)
    httpMocks.baseUrls.set('wsl:Ubuntu', WSL_URL)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    httpMocks.baseUrls.clear()
  })

  it('keeps the active subscription untouched when a non-active server reports server-runtime-updated', async () => {
    // 场景：active 是 local，WSL sidecar 首次注册 wsl:Ubuntu。upsertServer 对任何
    // runtime 变化的服务器都无条件广播 server-runtime-updated，订阅绝不能被「迁移」到非 active 服务器
    const openStream = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const fetchMock = vi.fn().mockReturnValue(openStream.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents } = await import('./events')
    const { serverStore } = await import('../store/serverStore')

    const unsubscribe = subscribeToEvents({})

    expect(fetchedUrls(fetchMock)).toEqual([`${LOCAL_URL}/global/event`])

    serverStore.upsertServer({ id: 'wsl:Ubuntu', name: 'Ubuntu (WSL)', url: WSL_URL })
    await Promise.resolve()

    // local 连接未被拆、未向 wsl:Ubuntu 发起新连接
    expect(fetchedUrls(fetchMock)).toEqual([`${LOCAL_URL}/global/event`])

    unsubscribe()
    openStream.resolve(createFetchResponse([]))
  })

  it('re-subscribes the active subscription when the active server reports server-runtime-updated', async () => {
    // 合法迁移场景：active local 的端点变了（如本地运行时 URL override 落到新端口），
    // 旧 SSE 还连着死地址，必须拆旧建新、用新 URL 重订阅
    const firstStream = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const secondStream = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstStream.promise)
      .mockImplementationOnce(() => secondStream.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents } = await import('./events')
    const { serverStore } = await import('../store/serverStore')

    const unsubscribe = subscribeToEvents({})
    expect(fetchedUrls(fetchMock)).toEqual([`${LOCAL_URL}/global/event`])

    httpMocks.baseUrls.set('local', `${LOCAL_URL}:9999`)
    serverStore.upsertServer({ id: 'local', name: 'Local', url: `${LOCAL_URL}:9999`, isDefault: true })
    await Promise.resolve()

    expect(fetchedUrls(fetchMock)).toEqual([`${LOCAL_URL}/global/event`, `${LOCAL_URL}:9999/global/event`])

    unsubscribe()
    firstStream.resolve(createFetchResponse([]))
    secondStream.resolve(createFetchResponse([]))
  })

  it('migrates the subscription on a real server-switch', async () => {
    // 焦点真实切换（setActiveServer）→ 订阅必须跟着迁移到新 active 服务器
    const firstStream = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const secondStream = createDeferred<Pick<Response, 'ok' | 'body'>>()
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstStream.promise)
      .mockImplementationOnce(() => secondStream.promise)
    vi.stubGlobal('fetch', fetchMock)

    const { subscribeToEvents } = await import('./events')
    const { serverStore } = await import('../store/serverStore')

    const unsubscribe = subscribeToEvents({})
    expect(fetchedUrls(fetchMock)).toEqual([`${LOCAL_URL}/global/event`])

    // 先注册非 active 的 wsl:Ubuntu（不应动订阅），再把焦点切过去（应迁移）
    serverStore.upsertServer({ id: 'wsl:Ubuntu', name: 'Ubuntu (WSL)', url: WSL_URL })
    serverStore.setActiveServer('wsl:Ubuntu')
    await Promise.resolve()

    expect(fetchedUrls(fetchMock)).toEqual([`${LOCAL_URL}/global/event`, `${WSL_URL}/global/event`])

    unsubscribe()
    firstStream.resolve(createFetchResponse([]))
    secondStream.resolve(createFetchResponse([]))
  })
})
