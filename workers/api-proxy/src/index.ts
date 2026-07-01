// OpenCodeUI API Proxy Worker
//
// 部署架构：
//   浏览器
//     ↓
//   Cloudflare Pages（前端静态资源）
//     ↓ /api/*
//   Pages Function（functions/api/[[path]].ts） — service binding →
//     ↓
//   API_PROXY Worker（本文件）
//     ↓ BACKEND_VPC.fetch()（VPC Service binding → Cloudflare Tunnel）
//     ↓
//   私网 / 本地的 opencode serve
//
// 缓存策略（可缓存的 GET/HEAD）：
//   1. Cache API（caches.default）— 命中则不再访问 VPC
//   2. 可选 KV（CACHE_KV）— 二级缓存，配合 cacheTtl 秒级 TTL
//
// 重定向：redirect: 'manual'，不把上游 3xx 在 Worker 内跟跳，避免子请求叠加。

import {
  cacheKeyRequest,
  isCacheableUpstreamResponse,
  readResponseBody,
  shouldBypassCache,
  withEdgeCacheHeaders,
} from './cache'

interface Env {
  BACKEND_VPC: Fetcher
  /** 可选：Workers KV namespace，用于 Cache API 未命中时的二级缓存 */
  CACHE_KV?: KVNamespace
  /** KV 条目 TTL（秒），默认 60 */
  CACHE_KV_TTL_SECONDS?: string
  /** 写入 Cache API 的 max-age（秒），默认 60 */
  CACHE_EDGE_MAX_AGE_SECONDS?: string
}

const stripApiPrefix = (pathname: string): string => {
  if (pathname === '/api') return '/'
  if (pathname.startsWith('/api/')) return pathname.slice('/api'.length)
  return pathname
}

const UPSTREAM_HOST = 'http://opencode-backend'

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

const buildUpstreamRequest = (request: Request, target: string): Request =>
  new Request(target, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    // @ts-expect-error duplex 是 fetch 标准但 Cloudflare 类型未暴露
    duplex: 'half',
    redirect: 'manual',
  })

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!env.BACKEND_VPC) {
      return new Response('BACKEND_VPC binding is not configured', { status: 500 })
    }

    const url = new URL(request.url)
    const upstreamPath = stripApiPrefix(url.pathname)
    const target = `${UPSTREAM_HOST}${upstreamPath}${url.search}`

    const bypassCache = shouldBypassCache(request, upstreamPath)
    const edgeMaxAge = parsePositiveInt(env.CACHE_EDGE_MAX_AGE_SECONDS, 60)
    const kvTtl = parsePositiveInt(env.CACHE_KV_TTL_SECONDS, 60)

    if (!bypassCache) {
      const cache = caches.default
      const cacheLookup = cacheKeyRequest(request)
      const cached = await cache.match(cacheLookup)
      if (cached) {
        return cached
      }

      if (env.CACHE_KV) {
        const kvKey = `v1:${request.method}:${cacheLookup.url}`
        const kvHit = await env.CACHE_KV.getWithMetadata<{ status: number; headers: [string, string][] }>(
          kvKey,
          'arrayBuffer',
        )
        if (kvHit.value) {
          const headers = new Headers(kvHit.metadata?.headers ?? [])
          headers.set('X-Cache', 'KV')
          if (!headers.has('Cache-Control')) {
            headers.set('Cache-Control', `public, max-age=${edgeMaxAge}`)
          }
          const response = new Response(kvHit.value, {
            status: kvHit.metadata?.status ?? 200,
            headers,
          })
          ctx.waitUntil(cache.put(cacheLookup, response.clone()))
          return response
        }
      }
    }

    const upstreamResponse = await env.BACKEND_VPC.fetch(buildUpstreamRequest(request, target))

    if (upstreamResponse.status >= 300 && upstreamResponse.status < 400) {
      return upstreamResponse
    }

    if (bypassCache || !isCacheableUpstreamResponse(upstreamResponse)) {
      return upstreamResponse
    }

    const body = await readResponseBody(upstreamResponse)
    if (!body) {
      return upstreamResponse
    }

    const responseToStore = withEdgeCacheHeaders(
      new Response(body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: upstreamResponse.headers,
      }),
      edgeMaxAge,
    )

    const cacheLookup = cacheKeyRequest(request)
    ctx.waitUntil(caches.default.put(cacheLookup, responseToStore.clone()))

    if (env.CACHE_KV) {
      const kvKey = `v1:${request.method}:${cacheLookup.url}`
      const headerPairs = [...responseToStore.headers.entries()]
      ctx.waitUntil(
        env.CACHE_KV.put(kvKey, body, {
          expirationTtl: kvTtl,
          metadata: { status: responseToStore.status, headers: headerPairs },
        }),
      )
    }

    return responseToStore
  },
}