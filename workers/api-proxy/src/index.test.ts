// 验证 proxy 透传 header（特别是 Authorization）的能力。
// 通过 mock env.BACKEND_VPC 抓取实际发出的 Request，检查 method / headers / body 是否被保留。

import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index'

interface Env {
  BACKEND_VPC: Fetcher
}

function createMockBackend() {
  const calls: Request[] = []
  const fetcher = {
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const req = input instanceof Request ? input : new Request(input, init)
      calls.push(req)
      return new Response('ok', { status: 200 })
    }),
    connect: vi.fn(),
  } as unknown as Fetcher
  return { fetcher, calls }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('api-proxy header pass-through', () => {
  it('forwards Authorization header set by the browser to the backend', async () => {
    const { fetcher, calls } = createMockBackend()
    const env: Env = { BACKEND_VPC: fetcher }

    const incoming = new Request('https://pages.example.com/api/health', {
      method: 'GET',
      headers: {
        Authorization: 'Basic b3BlbmNvZGU6c2VjcmV0',
        'X-Custom': 'value',
      },
    })

    await worker.fetch(incoming, env)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://opencode-backend/health')
    expect(calls[0].headers.get('Authorization')).toBe('Basic b3BlbmNvZGU6c2VjcmV0')
    expect(calls[0].headers.get('X-Custom')).toBe('value')
  })

  it('preserves method and body on POST', async () => {
    const { fetcher, calls } = createMockBackend()
    const env: Env = { BACKEND_VPC: fetcher }

    const incoming = new Request('https://pages.example.com/api/session', {
      method: 'POST',
      headers: {
        Authorization: 'Basic b3BlbmNvZGU6c2VjcmV0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ foo: 'bar' }),
    })

    await worker.fetch(incoming, env)

    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].headers.get('Authorization')).toBe('Basic b3BlbmNvZGU6c2VjcmV0')
    expect(calls[0].headers.get('Content-Type')).toBe('application/json')
    expect(await calls[0].json()).toEqual({ foo: 'bar' })
  })

  it('strips /api prefix from path', async () => {
    const { fetcher, calls } = createMockBackend()
    const env: Env = { BACKEND_VPC: fetcher }

    await worker.fetch(new Request('https://pages.example.com/api/project/current'), env)
    expect(calls[0].url).toBe('http://opencode-backend/project/current')
  })

  it('preserves query string', async () => {
    const { fetcher, calls } = createMockBackend()
    const env: Env = { BACKEND_VPC: fetcher }

    await worker.fetch(new Request('https://pages.example.com/api/pty/abc/connect?cursor=42'), env)
    expect(calls[0].url).toBe('http://opencode-backend/pty/abc/connect?cursor=42')
  })

  it('returns 500 when BACKEND_VPC binding is missing', async () => {
    const env = {} as Env
    const res = await worker.fetch(new Request('https://pages.example.com/api/health'), env)
    expect(res.status).toBe(500)
  })
})
