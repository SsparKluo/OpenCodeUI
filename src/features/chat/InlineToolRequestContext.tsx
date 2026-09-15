/**
 * InlineToolRequestContext
 *
 * 把待处理的权限请求和提问请求注入到消息流里，
 * 让工具视图可以在对应位置直接渲染内嵌交互。
 * 对于 task 类型的 tool，还支持匹配子 session 内部的请求。
 */

import { createContext, useContext } from 'react'
import type { ApiPermissionRequest, ApiQuestionRequest, PermissionReply, QuestionAnswer } from '../../api'
import { childSessionStore } from '../../store'
import { makeSessionKey, splitSessionKey } from '../../utils/sessionKey'

/**
 * task 工具匹配子 session 请求时的定位信息。
 * sessionKey 取自工具 metadata，可能是原始 id；serverId 是 pane 绑定的服务器（权威值），
 * 绝不能从「全局活动服务器」猜测——多服务器 / WSL 场景下两者不同，孙 session 会永远匹配不上。
 */
export interface TaskChildSessionRef {
  sessionKey: string
  serverId: string
}

export interface InlineToolRequestContextValue {
  /** 当前 pane 绑定的服务器，供 task 工具解析子 session 的服务器作用域 key */
  serverId: string
  /** 当前 pending 的权限请求 */
  pendingPermissions: ApiPermissionRequest[]
  /** 当前 pending 的提问请求 */
  pendingQuestions: ApiQuestionRequest[]
  /** 回复权限 */
  onPermissionReply: (requestId: string, reply: PermissionReply) => void
  /** 回复提问 */
  onQuestionReply: (requestId: string, answers: QuestionAnswer[]) => void
  /** 拒绝提问 */
  onQuestionReject: (requestId: string) => void
  /** 是否正在发送回复 */
  isReplying: boolean
}

const defaultValue: InlineToolRequestContextValue = {
  // 没有 Provider 就没有 pane 绑定，空串表示「无权威服务器」，不做任何猜测
  serverId: '',
  pendingPermissions: [],
  pendingQuestions: [],
  onPermissionReply: () => {},
  onQuestionReply: () => {},
  onQuestionReject: () => {},
  isReplying: false,
}

export const InlineToolRequestContext = createContext<InlineToolRequestContextValue>(defaultValue)

export function useInlineToolRequests() {
  return useContext(InlineToolRequestContext)
}

/**
 * 根据 callID 查找关联的权限请求。
 * 对于 task tool，额外传入 child（子 session key + pane 绑定的权威服务器），
 * 匹配子 session（及其子孙）内部发出的权限请求。
 */
export function findPermissionRequestForTool(
  pendingPermissions: ApiPermissionRequest[],
  callID: string,
  child?: TaskChildSessionRef,
): ApiPermissionRequest | undefined {
  // 先按 callID 精确匹配（直接工具调用）
  const direct = pendingPermissions.find(p => p.tool?.callID === callID)
  if (direct) return direct

  // 对 task tool，按子 session 归属匹配
  if (child) {
    // 复合 key 以调用方传入的权威 serverId 合成：对原始 id 做 splitSessionKey 会回退到
    // 全局活动服务器，pane 绑定其他服务器时（多服务器 / WSL）孙 session 永远匹配不上
    const childScoped = child.sessionKey.includes('::')
      ? child.sessionKey
      : makeSessionKey(child.serverId, child.sessionKey)
    const { serverId: childServerId, sessionId: childRawId } = splitSessionKey(childScoped)
    const isMatch = (sid: string) => {
      const { sessionId: raw } = splitSessionKey(sid)
      // 消息 metadata 里的 sessionId 是原始 id，pending 请求的 sessionID 可能是复合 key（SSE）
      // 或原始 id（轮询）：统一按原始 id 比较，isChildOf 需要复合 key（childSessionStore 存复合）
      if (raw === childRawId) return true
      const scoped = sid.includes('::') ? sid : makeSessionKey(childServerId, raw)
      return childSessionStore.isChildOf(scoped, childScoped)
    }
    return pendingPermissions.find(p => isMatch(p.sessionID))
  }

  return undefined
}

/**
 * 根据 callID 查找关联的提问请求。
 * 对于 task tool，额外传入 child（子 session key + pane 绑定的权威服务器）。
 */
export function findQuestionRequestForTool(
  pendingQuestions: ApiQuestionRequest[],
  callID: string,
  child?: TaskChildSessionRef,
): ApiQuestionRequest | undefined {
  const direct = pendingQuestions.find(q => q.tool?.callID === callID)
  if (direct) return direct

  if (child) {
    const childScoped = child.sessionKey.includes('::')
      ? child.sessionKey
      : makeSessionKey(child.serverId, child.sessionKey)
    const { serverId: childServerId, sessionId: childRawId } = splitSessionKey(childScoped)
    const isMatch = (sid: string) => {
      const { sessionId: raw } = splitSessionKey(sid)
      if (raw === childRawId) return true
      const scoped = sid.includes('::') ? sid : makeSessionKey(childServerId, raw)
      return childSessionStore.isChildOf(scoped, childScoped)
    }
    return pendingQuestions.find(q => isMatch(q.sessionID))
  }

  return undefined
}
