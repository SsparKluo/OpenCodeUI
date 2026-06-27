// ============================================
// 统一错误处理工具
// ============================================

import { notificationStore } from '../store/notificationStore'

export type ErrorCategory =
  | 'api' // API 调用错误
  | 'session' // Session 相关错误
  | 'permission' // 权限相关错误
  | 'ui' // UI 交互错误
  | 'parse' // 解析错误
  | 'sse' // SSE 事件流错误
  | 'file' // 文件操作错误
  | 'syntax' // 语法高亮错误
  | 'global' // 全局错误
  | 'revert' // 撤销/重做错误
  | 'clipboard' // 剪贴板错误
  | 'unknown' // 未分类错误

export interface ErrorContext {
  category: ErrorCategory
  operation: string
  silent?: boolean // 静默错误，不显示给用户
  details?: unknown // 额外的错误详情
}

/**
 * 统一的错误日志函数
 *
 * - 开发环境输出到控制台
 * - 非静默错误通过 notificationStore 弹 toast 展示给用户
 */
export function logError(error: unknown, context: ErrorContext): void {
  const { category, operation, silent = false } = context

  // 开发环境下始终输出到控制台
  if (import.meta.env.DEV) {
    console.error(`[${category}] ${operation}:`, error)
  }

  // 静默错误不打扰用户
  if (silent) return

  const message = extractErrorMessage(error)
  notificationStore.push('error', operation, message, '')
}

/**
 * 包装异步函数，自动处理错误
 */
export function withErrorHandling<T>(fn: () => Promise<T>, context: ErrorContext): Promise<T | undefined> {
  return fn().catch(error => {
    logError(error, context)
    return undefined
  })
}

/**
 * 创建带上下文的错误处理器
 * 用于同一模块内多次使用
 */
export function createErrorHandler(category: ErrorCategory) {
  return (operation: string, error: unknown, silent = false, details?: unknown) => {
    logError(error, { category, operation, silent, details })
  }
}

// ============================================
// 预定义的错误处理器 - 按模块分类
// ============================================

export const apiErrorHandler = createErrorHandler('api')
export const sessionErrorHandler = createErrorHandler('session')
export const permissionErrorHandler = createErrorHandler('permission')
export const uiErrorHandler = createErrorHandler('ui')
export const parseErrorHandler = createErrorHandler('parse')
export const sseErrorHandler = createErrorHandler('sse')
export const fileErrorHandler = createErrorHandler('file')
export const syntaxErrorHandler = createErrorHandler('syntax')
export const globalErrorHandler = createErrorHandler('global')
export const revertErrorHandler = createErrorHandler('revert')
export const clipboardErrorHandler = createErrorHandler('clipboard')

/**
 * 简单的 catch 处理器，用于 .catch(handleError('operation'))
 */
export function handleError(operation: string, category: ErrorCategory = 'unknown') {
  return (error: unknown) => {
    logError(error, { category, operation })
  }
}

/**
 * 从 unknown 类型的 error 中提取人类可读的 message。
 * ApiError / 普通 Error 直接取 .message，其余降级为字符串。
 */
function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}
