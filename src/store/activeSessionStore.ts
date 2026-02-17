// ============================================
// ActiveSessionStore - 追踪所有 session 的活跃状态
// ============================================
//
// 数据来源：
// 1. 初始化：GET /session/status → 全量 session 状态
// 2. 实时更新：SSE session.status 事件
//
// 输出：busy session 列表（供 sidebar Active tab 显示）

import { useSyncExternalStore } from 'react'
import type { SessionStatus, SessionStatusMap } from '../types/api/session'

// ============================================
// Types
// ============================================

export interface ActiveSessionEntry {
  sessionId: string
  status: SessionStatus
  /** session 标题，从 session 列表补充 */
  title?: string
  /** session 所属目录 */
  directory?: string
}

interface ActiveSessionState {
  /** sessionID -> status */
  statusMap: SessionStatusMap
  /** 初始化是否完成 */
  initialized: boolean
}

type Subscriber = () => void

// ============================================
// Store
// ============================================

class ActiveSessionStore {
  private state: ActiveSessionState = {
    statusMap: {},
    initialized: false,
  }
  private subscribers = new Set<Subscriber>()

  // session 元信息缓存（title, directory）
  private sessionMeta = new Map<string, { title?: string; directory?: string }>()

  // 派生数据缓存 — useSyncExternalStore 要求引用稳定
  private cachedBusySessions: ActiveSessionEntry[] = []
  private cachedBusyCount: number = 0

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify() {
    // 在 notify 前重新计算缓存，保证 getSnapshot 返回稳定引用
    this.recomputeDerived()
    this.subscribers.forEach(cb => cb())
  }

  private recomputeDerived() {
    const entries = Object.entries(this.state.statusMap)
      .filter(([, status]) => status.type === 'busy' || status.type === 'retry')
      .map(([sessionId, status]) => {
        const meta = this.sessionMeta.get(sessionId)
        return {
          sessionId,
          status,
          title: meta?.title,
          directory: meta?.directory,
        } as ActiveSessionEntry
      })
    this.cachedBusySessions = entries
    this.cachedBusyCount = entries.length
  }

  getSnapshot = (): ActiveSessionState => this.state

  getBusySessionsSnapshot = (): ActiveSessionEntry[] => this.cachedBusySessions

  getBusyCountSnapshot = (): number => this.cachedBusyCount

  // ============================================
  // 初始化：从 API 拉取全量状态
  // ============================================

  initialize(statusMap: SessionStatusMap) {
    this.state = {
      statusMap: { ...statusMap },
      initialized: true,
    }
    this.notify()
  }

  // ============================================
  // SSE 事件更新单个 session 状态
  // ============================================

  updateStatus(sessionId: string, status: SessionStatus) {
    const newMap = { ...this.state.statusMap }

    if (status.type === 'idle') {
      // idle 时从 map 中移除（不再是活跃 session）
      delete newMap[sessionId]
    } else {
      newMap[sessionId] = status
    }

    this.state = { ...this.state, statusMap: newMap }
    this.notify()
  }

  // ============================================
  // Session 元信息管理
  // ============================================

  setSessionMeta(sessionId: string, title?: string, directory?: string) {
    const existing = this.sessionMeta.get(sessionId)
    const newTitle = title ?? existing?.title
    const newDir = directory ?? existing?.directory
    if (newTitle !== existing?.title || newDir !== existing?.directory) {
      this.sessionMeta.set(sessionId, { title: newTitle, directory: newDir })
      this.notify()
    }
  }

  getSessionMeta(sessionId: string) {
    return this.sessionMeta.get(sessionId)
  }

  // ============================================
  // 派生数据（非 React 用途）
  // ============================================

  /** 获取所有 busy/retry session 列表 */
  getBusySessions(): ActiveSessionEntry[] {
    return this.cachedBusySessions
  }

  get busyCount(): number {
    return this.cachedBusyCount
  }
}

// ============================================
// Singleton & React Hooks
// ============================================

export const activeSessionStore = new ActiveSessionStore()

export function useActiveSessionStore() {
  return useSyncExternalStore(
    activeSessionStore.subscribe,
    activeSessionStore.getSnapshot,
  )
}

export function useBusySessions(): ActiveSessionEntry[] {
  return useSyncExternalStore(
    activeSessionStore.subscribe,
    activeSessionStore.getBusySessionsSnapshot,
  )
}

export function useBusyCount(): number {
  return useSyncExternalStore(
    activeSessionStore.subscribe,
    activeSessionStore.getBusyCountSnapshot,
  )
}
