// ============================================
// MultiServerStore - 多服务器订阅模式配置
//
// 开启后，session 列表按服务器分组展示，并同时订阅多个服务器的事件。
// 配置持久化在 localStorage。
// ============================================

import { useSyncExternalStore } from 'react'
import { serverStore } from './serverStore'

const STORAGE_KEY = 'opencode-multi-server'

interface PersistedShape {
  enabled: boolean
  subscribedServerIds: string[]
  /** serverId -> 用户为该服务器添加的工作区目录 */
  serverWorkspaces: Record<string, string[]>
  /** serverId -> 展示顺序（含 'global' 占位；与文件夹模式一致，全局文件夹也可拖拽排序） */
  serverWorkspaceOrder: Record<string, string[]>
  /** 项目管理面板当前聚焦的服务器（添加目录时的目标服务器） */
  focusedServerId: string | null
}

type Listener = () => void

function loadPersisted(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedShape>
      return {
        enabled: parsed.enabled === true,
        subscribedServerIds: Array.isArray(parsed.subscribedServerIds) ? parsed.subscribedServerIds : [],
        serverWorkspaces:
          parsed.serverWorkspaces && typeof parsed.serverWorkspaces === 'object' ? parsed.serverWorkspaces : {},
        serverWorkspaceOrder:
          parsed.serverWorkspaceOrder && typeof parsed.serverWorkspaceOrder === 'object'
            ? parsed.serverWorkspaceOrder
            : {},
        focusedServerId: typeof parsed.focusedServerId === 'string' ? parsed.focusedServerId : null,
      }
    }
    return { enabled: false, subscribedServerIds: [], serverWorkspaces: {}, serverWorkspaceOrder: {}, focusedServerId: null }
  } catch {
    return { enabled: false, subscribedServerIds: [], serverWorkspaces: {}, serverWorkspaceOrder: {}, focusedServerId: null }
  }
}

class MultiServerStore {
  private settings: PersistedShape = loadPersisted()
  private listeners: Set<Listener> = new Set()
  private _snapshot: PersistedShape = { ...this.settings }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot(): PersistedShape {
    return this._snapshot
  }

  private notify(): void {
    this._snapshot = { ...this.settings }
    this.persist()
    this.listeners.forEach(fn => fn())
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      // ignore
    }
  }

  isEnabled(): boolean {
    return this.settings.enabled
  }

  setEnabled(enabled: boolean): void {
    if (this.settings.enabled === enabled) return
    this.settings.enabled = enabled
    // 开启时若白名单为空，自动订阅当前活动服务器，避免开启后一片空白
    if (enabled && this.settings.subscribedServerIds.length === 0) {
      const activeId = serverStore.getActiveServerId()
      if (activeId) {
        this.settings.subscribedServerIds = [activeId]
      }
    }
    this.notify()
  }

  getSubscribedServerIds(): string[] {
    return [...this.settings.subscribedServerIds]
  }

  /** 是否订阅了指定服务器 */
  isSubscribed(serverId: string): boolean {
    return this.settings.subscribedServerIds.includes(serverId)
  }

  /** 订阅/取消订阅一个服务器（多服务器模式开启时生效） */
  setSubscribed(serverId: string, subscribed: boolean): void {
    const current = new Set(this.settings.subscribedServerIds)
    if (subscribed) {
      current.add(serverId)
    } else {
      current.delete(serverId)
    }
    const next = Array.from(current)
    if (JSON.stringify(next) === JSON.stringify(this.settings.subscribedServerIds)) return
    this.settings.subscribedServerIds = next
    this.notify()
  }

  /** 用服务器 id 集合整体替换订阅列表 */
  setSubscribedServerIds(serverIds: string[]): void {
    const next = Array.from(new Set(serverIds))
    if (JSON.stringify(next) === JSON.stringify(this.settings.subscribedServerIds)) return
    this.settings.subscribedServerIds = next
    this.notify()
  }

  // ============================================
  // 服务器工作区（用户添加的目录）
  // ============================================

  /** 获取某服务器的工作区目录列表（顺序即展示顺序） */
  getServerWorkspaces(serverId: string): string[] {
    return [...(this.settings.serverWorkspaces[serverId] ?? [])]
  }

  /** 添加工作区目录 */
  addServerWorkspace(serverId: string, directory: string): boolean {
    const normalized = directory.replace(/\\/g, '/').replace(/\/+$/, '') || ''
    if (!normalized) return false
    const current = this.settings.serverWorkspaces[serverId] ?? []
    if (current.some(dir => dir === normalized)) return false
    this.settings.serverWorkspaces = {
      ...this.settings.serverWorkspaces,
      [serverId]: [...current, normalized],
    }
    this.notify()
    return true
  }

  /** 移除工作区目录 */
  removeServerWorkspace(serverId: string, directory: string): void {
    const current = this.settings.serverWorkspaces[serverId] ?? []
    const next = current.filter(dir => dir !== directory)
    if (next.length === current.length) return
    this.settings.serverWorkspaces = {
      ...this.settings.serverWorkspaces,
      [serverId]: next,
    }
    const order = this.settings.serverWorkspaceOrder[serverId]
    if (order) {
      this.settings.serverWorkspaceOrder = {
        ...this.settings.serverWorkspaceOrder,
        [serverId]: order.filter(item => item !== directory),
      }
    }
    this.notify()
  }

  /** 整体替换某服务器的工作区列表（拖拽排序用，不含 global 占位） */
  setServerWorkspaces(serverId: string, directories: string[]): void {
    const current = this.settings.serverWorkspaces[serverId] ?? []
    if (JSON.stringify(directories) === JSON.stringify(current)) return
    this.settings.serverWorkspaces = {
      ...this.settings.serverWorkspaces,
      [serverId]: directories,
    }
    // 同步更新展示顺序（保留 global 与未在列表中的目录）
    const order = this.settings.serverWorkspaceOrder[serverId]
    if (order) {
      const nextOrder = order.filter(item => item === 'global' || directories.includes(item))
      const missing = directories.filter(dir => !nextOrder.includes(dir))
      this.settings.serverWorkspaceOrder = {
        ...this.settings.serverWorkspaceOrder,
        [serverId]: [...nextOrder, ...missing],
      }
    }
    this.notify()
  }

  /** 获取某服务器的展示顺序（含 'global' 占位；新目录自动追加到末尾） */
  getServerWorkspacesOrder(serverId: string): string[] {
    const order = this.settings.serverWorkspaceOrder[serverId]
    const workspaces = this.settings.serverWorkspaces[serverId] ?? []
    if (order && order.length > 0) {
      // 清理已删除的目录，补上新添加的
      const valid = order.filter(item => item === 'global' || workspaces.includes(item))
      const missing = workspaces.filter(dir => !valid.includes(dir))
      return [...valid, ...missing]
    }
    return ['global', ...workspaces]
  }

  /** 整体替换某服务器的展示顺序（含 'global'，拖拽排序用） */
  setServerWorkspacesOrder(serverId: string, order: string[]): void {
    const current = this.settings.serverWorkspaceOrder[serverId]
    if (JSON.stringify(order) === JSON.stringify(current)) return
    this.settings.serverWorkspaceOrder = {
      ...this.settings.serverWorkspaceOrder,
      [serverId]: order,
    }
    this.notify()
  }

  // ============================================
  // 焦点服务器（项目管理面板的目标服务器）
  // ============================================

  /** 当前焦点服务器（缺省 = active server） */
  getFocusedServerId(): string {
    return this.settings.focusedServerId ?? serverStore.getActiveServerId()
  }

  setFocusedServerId(serverId: string | null): void {
    if (this.settings.focusedServerId === serverId) return
    this.settings.focusedServerId = serverId
    this.notify()
  }
}

export const multiServerStore = new MultiServerStore()

/** React hook：多服务器模式配置 */
export function useMultiServerStore(): PersistedShape {
  return useSyncExternalStore(
    listener => multiServerStore.subscribe(listener),
    () => multiServerStore.getSnapshot(),
    () => multiServerStore.getSnapshot(),
  )
}
