// ============================================
// SDK Client - 基于 @opencode-ai/sdk 的统一客户端
//
// 职责：
// 1. 根据当前活动服务器动态创建 SDK client
// 2. 整合 baseUrl / auth / tauri fetch
// 3. 为上层 API 模块提供统一的 client 获取方式
// ============================================

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { serverStore, makeBasicAuthHeader, usesCookieAuth } from '../store/serverStore'
import { isTauri } from '../utils/tauri'

// Tauri fetch 缓存
let _tauriFetch: typeof globalThis.fetch | null = null
let _tauriFetchLoading: Promise<typeof globalThis.fetch> | null = null
let _apiRequestGeneration = 0
const _apiRequestControllers = new Set<AbortController>()

async function getTauriFetch(): Promise<typeof globalThis.fetch> {
  if (_tauriFetch) return _tauriFetch
  if (_tauriFetchLoading) return _tauriFetchLoading
  _tauriFetchLoading = import('@tauri-apps/plugin-http').then(mod => {
    _tauriFetch = mod.fetch as unknown as typeof globalThis.fetch
    return _tauriFetch
  })
  return _tauriFetchLoading
}

function getFetchImpl(): typeof globalThis.fetch {
  return isTauri() && _tauriFetch ? _tauriFetch : globalThis.fetch
}

function createAbortError(message: string) {
  return new DOMException(message, 'AbortError')
}

async function trackedFetch(input: RequestInfo | URL, init: RequestInit | undefined, generation: number): Promise<Response> {
  const controller = new AbortController()
  const externalSignal = init?.signal
  const abortFromExternal = () => controller.abort(externalSignal?.reason)

  if (externalSignal?.aborted) {
    abortFromExternal()
  } else {
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  }

  _apiRequestControllers.add(controller)

  try {
    if (generation !== _apiRequestGeneration) {
      throw createAbortError('Stale API request')
    }

    // Cloudflare Access 模式：让浏览器携带目标 hostname 的 CF_Authorization cookie。
    // basic/none 模式保持 same-origin，避免无谓的 cookie 泄漏给跨域 endpoint。
    const activeAuthMode = serverStore.getActiveAuthMode()
    const credentials: RequestCredentials = usesCookieAuth(activeAuthMode) ? 'include' : 'same-origin'

    return await getFetchImpl()(input, {
      ...init,
      signal: controller.signal,
      credentials,
    })
  } finally {
    externalSignal?.removeEventListener('abort', abortFromExternal)
    _apiRequestControllers.delete(controller)
  }
}

export function abortInFlightApiRequests(reason = 'Server endpoint changed'): void {
  _apiRequestGeneration++
  for (const controller of _apiRequestControllers) {
    controller.abort(createAbortError(reason))
  }
  _apiRequestControllers.clear()
}

// Client 缓存：按 "baseUrl + authHash" 缓存实例，避免重复创建
let _cachedClient: OpencodeClient | null = null
let _cachedKey = ''

function buildCacheKey(): string {
  const baseUrl = serverStore.getActiveBaseUrl()
  const auth = serverStore.getActiveAuth()
  const authMode = serverStore.getActiveAuthMode()
  const authPart = auth?.password ? `${auth.username}:${auth.password}` : ''
  // authMode 必须进 cache key：切换 access ↔ access+basic 时即使 auth 不变，
  // 也需要重建 client 决定是否注入 Authorization。
  return `${baseUrl}|${authMode}|${authPart}`
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  // 只要填了 Basic 凭据就发 Authorization header，与 authMode 无关。
  // cloudflare-access 模式下 Access cookie 也会同时被浏览器发送（见 trackedFetch）。
  const auth = serverStore.getActiveAuth()
  if (auth?.password) {
    headers['Authorization'] = makeBasicAuthHeader(auth)
  }
  return headers
}

/**
 * 同步获取 SDK client（浏览器环境 or tauri fetch 已加载）
 * 如果 tauri fetch 还没加载完，先用原生 fetch
 */
export function getSDKClient(): OpencodeClient {
  const key = buildCacheKey()
  if (_cachedClient && _cachedKey === key) {
    return _cachedClient
  }

  const baseUrl = serverStore.getActiveBaseUrl()
  const headers = buildHeaders()
  const generation = _apiRequestGeneration

  _cachedClient = createOpencodeClient({
    baseUrl,
    headers,
    fetch: (input, init) => trackedFetch(input, init, generation),
  })
  _cachedKey = key
  return _cachedClient
}

/**
 * 异步获取 SDK client（确保 tauri fetch 已加载）
 * 在应用初始化时应该先调一次这个
 */
export async function getSDKClientAsync(): Promise<OpencodeClient> {
  if (isTauri()) {
    await getTauriFetch()
  }
  // 使 cache 失效以便用新的 tauri fetch 重建
  _cachedClient = null
  _cachedKey = ''
  return getSDKClient()
}

/**
 * 强制重建 client（服务器切换时调用）
 */
export function invalidateSDKClient(): void {
  _cachedClient = null
  _cachedKey = ''
}

/**
 * 从 SDK 返回值中提取 data，如果有 error 则抛出
 *
 * SDK 默认返回 { data, error, request, response }
 * 我们的上层 API 函数期望直接返回数据，所以需要 unwrap
 */
export function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error != null) {
    const err = result.error
    if (err instanceof Error) throw err
    if (typeof err === 'string') throw new Error(err)
    throw new Error(JSON.stringify(err))
  }
  return result.data as T
}
