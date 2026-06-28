// ============================================
// SDK Client - 基于 @opencode-ai/sdk 的统一客户端
//
// 职责：
// 1. 根据当前活动服务器动态创建 SDK client
// 2. 整合 baseUrl / auth / tauri fetch
// 3. 为上层 API 模块提供统一的 client 获取方式
// ============================================

import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import { serverStore, makeBasicAuthHeader } from '../store/serverStore'
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

    return await getFetchImpl()(input, {
      ...init,
      signal: controller.signal,
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
  const authPart = auth?.password ? `${auth.username}:${auth.password}` : ''
  return `${baseUrl}|${authPart}`
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
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
 *
 * 由于项目未启用 throwOnError，result.error 通常是后端返回的原始 JSON body
 * （常见形态：{ name, data: { message } } 或 { message }），这里提取人类可读信息
 * 作为 Error.message，原始对象挂到 cause 上便于调试。
 */
export function unwrap<T>(result: { data?: T; error?: unknown }): T {
  if (result.error != null) {
    throw new ApiError(extractApiErrorMessage(result.error), { cause: result.error })
  }
  return result.data as T
}

/**
 * OpenCode API 错误。继承 Error 以兼容现有 try/catch + instanceof Error 的用法。
 */
export class ApiError extends Error {
  name = 'ApiError'
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 从后端返回的 error body 中提取人类可读信息。
 * 优先级：data.message > message > data.error > name > 摘要后的 JSON
 */
function extractApiErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  if (isRecordLike(error)) {
    const data = isRecordLike(error.data) ? error.data : undefined
    if (typeof data?.message === 'string' && data.message) return data.message
    if (typeof error.message === 'string' && error.message) return error.message
    if (typeof data?.error === 'string' && data.error) return data.error
    if (typeof error.name === 'string' && error.name) return error.name
  }

  try {
    const json = JSON.stringify(error)
    return json.length > 200 ? json.slice(0, 200) + '…' : json
  } catch {
    return 'Unknown error'
  }
}
