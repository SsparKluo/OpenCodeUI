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
// 关键行为：strip /api 前缀（与 standalone Caddy 的 handle_path /api/* 等价），
// 透传 method / headers / body；SSE 流式响应通过 new Request(target, ...) 透传。

interface Env {
  BACKEND_VPC: Fetcher
}

const stripApiPrefix = (pathname: string): string => {
  if (pathname === '/api') return '/'
  if (pathname.startsWith('/api/')) return pathname.slice('/api'.length)
  return pathname
}

const UPSTREAM_HOST = 'http://opencode-backend'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.BACKEND_VPC) {
      return new Response('BACKEND_VPC binding is not configured', { status: 500 })
    }

    const url = new URL(request.url)
    const upstreamPath = stripApiPrefix(url.pathname)
    const target = `${UPSTREAM_HOST}${upstreamPath}${url.search}`

    const proxyRequest = new Request(target, request)
    return env.BACKEND_VPC.fetch(proxyRequest)
  },
}
