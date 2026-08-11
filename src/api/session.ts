// ============================================
// Session API Functions
// 基于 @opencode-ai/sdk: /session 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import { normalizeTodoItems } from './todo'
import { formatPathForApi } from '../utils/directoryUtils'
import { getSessionMessages } from './message'
import { normalizeFileDiffs } from '../types/api/file'
import type { ApiSession, SessionListParams, FileDiff, ApiMessageWithParts, ApiUserMessage } from './types'
import type { SessionStatusMap } from '../types/api/session'
import type { TodoItem } from '../types/api/event'

function normalizeSessionList(value: unknown): ApiSession[] {
  if (Array.isArray(value)) return value as ApiSession[]
  throw new Error('Invalid OpenCode session list response')
}

// ============================================
// Session Status & Diff
// ============================================

/**
 * 获取所有 session 的当前状态
 */
export async function getSessionStatus(directory?: string, serverId?: string): Promise<SessionStatusMap> {
  const sdk = getSDKClient(serverId)
  return unwrap(await sdk.session.status({ directory: formatPathForApi(directory) }))
}

/**
 * 获取 session 的 diff
 * 返回可在 UI 中渲染的 SnapshotFileDiff（过滤缺少 file 的异常项）
 */
export async function getSessionDiff(
  sessionId: string,
  directory?: string,
  messageId?: string,
  serverId?: string,
): Promise<FileDiff[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return normalizeFileDiffs(
    unwrap(
      await sdk.session.diff({
        sessionID: target.sessionId,
        directory: formatPathForApi(directory),
        messageID: messageId,
      }),
    ),
  )
}

function isUserMessage(message: ApiMessageWithParts): message is ApiMessageWithParts & { info: ApiUserMessage } {
  return message.info.role === 'user'
}

/**
 * 获取当前可见用户消息对应的本轮 diff
 */
export async function getLastTurnDiff(sessionId: string, directory?: string, serverId?: string): Promise<FileDiff[]> {
  const [session, messages] = await Promise.all([
    getSession(sessionId, directory, serverId),
    getSessionMessages(sessionId, undefined, directory, serverId),
  ])

  const userMessages = messages.filter(isUserMessage)
  const revertMessageId = session.revert?.messageID
  const visibleUserMessages = revertMessageId
    ? userMessages.filter(message => message.info.id < revertMessageId)
    : userMessages

  return normalizeFileDiffs(visibleUserMessages.at(-1)?.info.summary?.diffs)
}

// ============================================
// Session CRUD
// ============================================

/**
 * 获取 session 列表
 */
export async function getSessions(params: SessionListParams = {}, serverId?: string): Promise<ApiSession[]> {
  const sdk = getSDKClient(serverId)
  const { directory, roots, start, search, limit } = params
  return normalizeSessionList(
    unwrap(
      await sdk.session.list({
        directory: formatPathForApi(directory),
        roots,
        start,
        search,
        limit,
      }),
    ),
  )
}

/**
 * 获取单个 session
 */
export async function getSession(sessionId: string, directory?: string, serverId?: string): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(await sdk.session.get({ sessionID: target.sessionId, directory: formatPathForApi(directory) }))
}

/**
 * 创建 session
 */
export async function createSession(
  params: {
    directory?: string
    title?: string
    parentID?: string
  } = {},
  serverId?: string,
): Promise<ApiSession> {
  const sdk = getSDKClient(serverId)
  const { directory, title, parentID } = params
  return unwrap(
    await sdk.session.create({
      directory: formatPathForApi(directory),
      title,
      parentID,
    }),
  )
}

/**
 * 更新 session
 */
export async function updateSession(
  sessionId: string,
  params: { title?: string; time?: { archived?: number } },
  directory?: string,
  serverId?: string,
): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(
    await sdk.session.update({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory),
      ...params,
    }),
  )
}

/**
 * 删除 session
 */
export async function deleteSession(sessionId: string, directory?: string, serverId?: string): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  unwrap(await sdk.session.delete({ sessionID: target.sessionId, directory: formatPathForApi(directory) }))
  return true
}

// ============================================
// Session Actions
// ============================================

/**
 * 中止 session
 */
export async function abortSession(sessionId: string, directory?: string, serverId?: string): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  unwrap(await sdk.session.abort({ sessionID: target.sessionId, directory: formatPathForApi(directory) }))
  return true
}

/**
 * 回退消息
 */
export async function revertMessage(
  sessionId: string,
  messageId: string,
  partId?: string,
  directory?: string,
  serverId?: string,
): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(
    await sdk.session.revert({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory),
      messageID: messageId,
      partID: partId,
    }),
  )
}

/**
 * 恢复已回退的消息
 */
export async function unrevertSession(sessionId: string, directory?: string, serverId?: string): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(await sdk.session.unrevert({ sessionID: target.sessionId, directory: formatPathForApi(directory) }))
}

/**
 * 分享 session
 */
export async function shareSession(sessionId: string, directory?: string, serverId?: string): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(await sdk.session.share({ sessionID: target.sessionId, directory: formatPathForApi(directory) }))
}

/**
 * 取消分享 session
 */
export async function unshareSession(sessionId: string, directory?: string, serverId?: string): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(await sdk.session.unshare({ sessionID: target.sessionId, directory: formatPathForApi(directory) }))
}

/**
 * Fork session
 */
export async function forkSession(sessionId: string, messageId?: string, directory?: string, serverId?: string): Promise<ApiSession> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(
    await sdk.session.fork({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory),
      messageID: messageId,
    }),
  )
}

/**
 * 总结 session
 */
export async function summarizeSession(
  sessionId: string,
  params: { providerID: string; modelID: string; auto?: boolean },
  directory?: string,
  serverId?: string,
): Promise<boolean> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  unwrap(
    await sdk.session.summarize({
      sessionID: target.sessionId,
      directory: formatPathForApi(directory),
      ...params,
    }),
  )
  return true
}

/**
 * 获取子 session
 */
export async function getSessionChildren(sessionId: string, directory?: string, serverId?: string): Promise<ApiSession[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  return unwrap(await sdk.session.children({ sessionID: target.sessionId, directory: formatPathForApi(directory) }))
}

/**
 * Session Todo
 */
export type ApiTodo = TodoItem

/**
 * 获取 session 的 todo 列表
 * SDK 的 Todo 没有 id 字段，用 index+content+status 合成
 */
export async function getSessionTodos(sessionId: string, directory?: string, serverId?: string): Promise<ApiTodo[]> {
  const target = resolveSessionTarget(sessionId, serverId)
  const sdk = getSDKClient(target.serverId)
  const todos = unwrap(await sdk.session.todo({ sessionID: target.sessionId, directory: formatPathForApi(directory) }))
  return normalizeTodoItems(todos)
}
