import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthMode } from '../store/serverStore'

const {
  createOpencodeClientMock,
  getActiveBaseUrlMock,
  getActiveAuthMock,
  getActiveAuthModeMock,
  isTauriMock,
} = vi.hoisted(() => ({
  createOpencodeClientMock: vi.fn((config: unknown) => ({ config })),
  getActiveBaseUrlMock: vi.fn((): string => 'http://127.0.0.1:4096'),
  getActiveAuthMock: vi.fn((): { username: string; password: string } | null => null),
  getActiveAuthModeMock: vi.fn((): AuthMode => 'basic'),
  isTauriMock: vi.fn(() => false),
}))

vi.mock('@opencode-ai/sdk/v2/client', () => ({
  createOpencodeClient: createOpencodeClientMock,
}))

vi.mock('../store/serverStore', () => ({
  makeBasicAuthHeader: vi.fn((auth: { username: string; password: string }) => 'Basic ' + btoa(`${auth.username}:${auth.password}`)),
  // 真实 helper 的语义镜像：只有 cloudflare-access 模式才返回 true
  usesCookieAuth: (mode: AuthMode) => mode === 'cloudflare-access',
  serverStore: {
    getActiveBaseUrl: getActiveBaseUrlMock,
    getActiveAuth: getActiveAuthMock,
    getActiveAuthMode: getActiveAuthModeMock,
  },
}))

vi.mock('../utils/tauri', () => ({
  isTauri: isTauriMock,
}))

type MockClient = {
  config: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }
}

describe('sdk request lifecycle', () => {
  beforeEach(async () => {
    vi.restoreAllMocks()
    getActiveBaseUrlMock.mockReturnValue('http://127.0.0.1:4096')
    getActiveAuthMock.mockReturnValue(null)
    getActiveAuthModeMock.mockReturnValue('basic')
    isTauriMock.mockReturnValue(false)
    const { abortInFlightApiRequests, invalidateSDKClient } = await import('./sdk')
    abortInFlightApiRequests('reset test state')
    invalidateSDKClient()
  })

  it('aborts in-flight SDK requests when the server endpoint changes', async () => {
    const { abortInFlightApiRequests, getSDKClient } = await import('./sdk')
    let signal: AbortSignal | undefined

    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
      })
    })

    const client = getSDKClient() as unknown as MockClient
    const request = client.config.fetch('http://127.0.0.1:4096/project/current')

    abortInFlightApiRequests('Server endpoint changed')

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(signal?.aborted).toBe(true)
  })

  it('prevents stale SDK clients from starting new requests after endpoint changes', async () => {
    const { abortInFlightApiRequests, getSDKClient } = await import('./sdk')
    const client = getSDKClient() as unknown as MockClient
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

    abortInFlightApiRequests('Server endpoint changed')

    await expect(client.config.fetch('http://127.0.0.1:4096/project/current')).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('uses credentials: include and no Authorization header in cloudflare-access mode without Basic credentials', async () => {
    const { invalidateSDKClient, getSDKClient } = await import('./sdk')
    getActiveAuthModeMock.mockReturnValue('cloudflare-access')
    getActiveAuthMock.mockReturnValue(null)
    invalidateSDKClient()

    const client = getSDKClient() as unknown as MockClient
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

    await client.config.fetch('http://api.example.com/session')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0][1]
    expect(init?.credentials).toBe('include')
  })

  it('creates SDK client without Authorization header in cloudflare-access mode without Basic credentials', async () => {
    const { invalidateSDKClient, getSDKClient } = await import('./sdk')
    getActiveAuthModeMock.mockReturnValue('cloudflare-access')
    getActiveAuthMock.mockReturnValue(null)
    createOpencodeClientMock.mockClear()
    invalidateSDKClient()

    getSDKClient()

    expect(createOpencodeClientMock).toHaveBeenCalledTimes(1)
    const config = createOpencodeClientMock.mock.calls[0][0] as {
      headers?: Record<string, string>
    }
    expect(config.headers?.Authorization).toBeUndefined()
  })

  it('creates SDK client with Authorization header when Basic credentials are filled (basic mode)', async () => {
    const { invalidateSDKClient, getSDKClient } = await import('./sdk')
    getActiveAuthModeMock.mockReturnValue('basic')
    getActiveAuthMock.mockReturnValue({ username: 'opencode', password: 'secret' })
    createOpencodeClientMock.mockClear()
    invalidateSDKClient()

    getSDKClient()

    expect(createOpencodeClientMock).toHaveBeenCalledTimes(1)
    const config = createOpencodeClientMock.mock.calls[0][0] as {
      headers?: Record<string, string>
    }
    expect(config.headers?.Authorization).toBe('Basic ' + btoa('opencode:secret'))
  })

  it('creates SDK client with Authorization header when cloudflare-access also has Basic credentials', async () => {
    const { invalidateSDKClient, getSDKClient } = await import('./sdk')
    getActiveAuthModeMock.mockReturnValue('cloudflare-access')
    getActiveAuthMock.mockReturnValue({ username: 'opencode', password: 'secret' })
    createOpencodeClientMock.mockClear()
    invalidateSDKClient()

    getSDKClient()

    expect(createOpencodeClientMock).toHaveBeenCalledTimes(1)
    const config = createOpencodeClientMock.mock.calls[0][0] as {
      headers?: Record<string, string>
    }
    expect(config.headers?.Authorization).toBe('Basic ' + btoa('opencode:secret'))
  })

  it('uses credentials: include when calling fetch in cloudflare-access mode', async () => {
    const { invalidateSDKClient, getSDKClient } = await import('./sdk')
    getActiveAuthModeMock.mockReturnValue('cloudflare-access')
    invalidateSDKClient()

    const client = getSDKClient() as unknown as MockClient
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

    await client.config.fetch('http://api.example.com/session')

    const init = fetchSpy.mock.calls[0][1]
    expect(init?.credentials).toBe('include')
  })

  it('uses credentials: same-origin when calling fetch in basic mode', async () => {
    const { invalidateSDKClient, getSDKClient } = await import('./sdk')
    getActiveAuthModeMock.mockReturnValue('basic')
    invalidateSDKClient()

    const client = getSDKClient() as unknown as MockClient
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

    await client.config.fetch('http://api.example.com/session')

    const init = fetchSpy.mock.calls[0][1]
    expect(init?.credentials).toBe('same-origin')
  })
})
