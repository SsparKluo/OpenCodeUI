// ============================================
// Session API Types
// 基于 OpenAPI 规范
// ============================================

import type { TimeInfo } from './common'

/**
 * Session 状态 - 基于 OpenAPI anyOf 定义
 * idle: 空闲, busy: 正在工作, retry: 重试中
 */
export type SessionStatus =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number }

/**
 * GET /session/status 返回值
 * Record<sessionID, SessionStatus>
 */
export type SessionStatusMap = Record<string, SessionStatus>

/**
 * Session 摘要信息
 */
export interface SessionSummary {
  additions: number
  deletions: number
  files: number
}

/**
 * Session 分享信息
 */
export interface SessionShare {
  url: string
}

/**
 * Session 回退状态
 */
export interface SessionRevert {
  messageID: string
  partID?: string
  snapshot?: string
  diff?: string
}

/**
 * Session 实体
 */
export interface Session {
  id: string
  slug?: string
  projectID: string
  directory: string
  parentID?: string
  title: string
  time: TimeInfo
  summary?: SessionSummary
  share?: SessionShare
  revert?: SessionRevert
}

/**
 * Session 列表查询参数
 */
export interface SessionListParams {
  directory?: string
  roots?: boolean
  start?: number
  search?: string
  limit?: number
}

/**
 * Session 创建参数
 */
export interface SessionCreateParams {
  title?: string
  directory?: string
}

/**
 * Session 更新参数
 */
export interface SessionUpdateParams {
  title?: string
  summary?: SessionSummary
}

/**
 * Session Fork 参数
 */
export interface SessionForkParams {
  messageID?: string
  directory?: string
}
