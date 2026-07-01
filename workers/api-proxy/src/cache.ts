const STREAM_ACCEPT = /text\/event-stream/i

const NON_CACHEABLE_PATH_PREFIXES = ['/global/event', '/pty/']

export function shouldBypassCache(request: Request, upstreamPath: string): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return true
  if (request.headers.get('Upgrade')) return true
  if (STREAM_ACCEPT.test(request.headers.get('Accept') ?? '')) return true
  if (request.headers.get('Authorization')) return true
  if (request.headers.get('Cookie')) return true

  for (const prefix of NON_CACHEABLE_PATH_PREFIXES) {
    if (upstreamPath === prefix || upstreamPath.startsWith(prefix)) return true
  }

  if (upstreamPath.includes('/connect') || upstreamPath.includes('/stream')) return true

  return false
}

export function cacheKeyRequest(request: Request): Request {
  const url = new URL(request.url)
  url.searchParams.sort()
  return new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
  })
}

export function isCacheableUpstreamResponse(response: Response): boolean {
  if (response.status !== 200) return false
  const cc = response.headers.get('Cache-Control') ?? ''
  if (/no-store|private/i.test(cc)) return false
  const ce = response.headers.get('Content-Encoding')
  if (ce && ce !== 'identity') return false
  return true
}

export function withEdgeCacheHeaders(response: Response, maxAgeSeconds: number): Response {
  const headers = new Headers(response.headers)
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', `public, max-age=${maxAgeSeconds}`)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function readResponseBody(response: Response): Promise<ArrayBuffer | null> {
  try {
    return await response.arrayBuffer()
  } catch {
    return null
  }
}