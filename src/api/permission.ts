// ============================================
// Permission & Question API Functions
// 基于 @opencode-ai/sdk: /permission, /question 相关接口
// ============================================

import { getSDKClient, unwrap } from './sdk'
import { resolveSessionTarget } from '../utils/sessionKey'
import { formatPathForApi } from '../utils/directoryUtils'
import type { ApiPermissionRequest, PermissionReply, ApiQuestionRequest, QuestionAnswer } from './types'

// ============================================
// Permission API
// ============================================

/**
 * 获取待处理的权限请求列表
 */
export async function getPendingPermissions(
  sessionId?: string,
  directory?: string,
  serverId?: string,
): Promise<ApiPermissionRequest[]> {
  const sdk = getSDKClient(serverId)
  const permissions = unwrap(await sdk.permission.list({ directory: formatPathForApi(directory, serverId) }))
  if (!sessionId) return permissions
  const target = resolveSessionTarget(sessionId, serverId)
  return permissions.filter((p: ApiPermissionRequest) => p.sessionID === target.sessionId)
}

/**
 * 回复权限请求
 */
export async function replyPermission(
  requestId: string,
  reply: PermissionReply,
  message?: string,
  directory?: string,
  sessionId?: string,
  serverId?: string,
): Promise<boolean> {
  const sdk = getSDKClient(serverId)

  if (sessionId) {
    const target = resolveSessionTarget(sessionId, serverId)
    unwrap(
      await sdk.permission.respond({
        sessionID: target.sessionId,
        permissionID: requestId,
        directory: formatPathForApi(directory, serverId),
        response: reply,
      }),
    )
    return true
  }

  unwrap(
    await sdk.permission.reply({
      requestID: requestId,
      directory: formatPathForApi(directory, serverId),
      reply,
      message,
    }),
  )
  return true
}

// ============================================
// Question API
// ============================================

/**
 * 获取待处理的问题请求列表
 */
export async function getPendingQuestions(
  sessionId?: string,
  directory?: string,
  serverId?: string,
): Promise<ApiQuestionRequest[]> {
  const sdk = getSDKClient(serverId)
  const questions = unwrap(await sdk.question.list({ directory: formatPathForApi(directory, serverId) }))
  if (!sessionId) return questions
  const target = resolveSessionTarget(sessionId, serverId)
  return questions.filter((q: ApiQuestionRequest) => q.sessionID === target.sessionId)
}

/**
 * 回复问题请求
 */
export async function replyQuestion(
  requestId: string,
  answers: QuestionAnswer[],
  directory?: string,
  serverId?: string,
): Promise<boolean> {
  const sdk = getSDKClient(serverId)
  unwrap(
    await sdk.question.reply({
      requestID: requestId,
      directory: formatPathForApi(directory, serverId),
      answers,
    }),
  )
  return true
}

/**
 * 拒绝问题请求
 */
export async function rejectQuestion(requestId: string, directory?: string, serverId?: string): Promise<boolean> {
  const sdk = getSDKClient(serverId)
  unwrap(
    await sdk.question.reject({
      requestID: requestId,
      directory: formatPathForApi(directory, serverId),
    }),
  )
  return true
}
