// ============================================
// NotificationStore - 应用内通知中心
// ============================================
//
// 1. 通知列表（权限请求、问答、session 完成/出错）
// 2. Toast 弹窗（自动消失，可点击跳转）

import { useSyncExternalStore } from 'react'

// ============================================
// Types
// ============================================

export type NotificationType = 'permission' | 'question' | 'completed' | 'error'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  body: string
  sessionId: string
  directory?: string
  timestamp: number
  read: boolean
}

export interface ToastItem {
  notification: AppNotification
  exiting: boolean
}

interface NotificationState {
  notifications: AppNotification[]
  toasts: ToastItem[]
  centerOpen: boolean
}

type Subscriber = () => void

// ============================================
// Constants
// ============================================

const TOAST_DURATION = 5000
const MAX_NOTIFICATIONS = 50
const MAX_TOASTS = 3
const EXIT_ANIMATION_MS = 200

// ============================================
// Store
// ============================================

class NotificationStore {
  private state: NotificationState = {
    notifications: [],
    toasts: [],
    centerOpen: false,
  }
  private subscribers = new Set<Subscriber>()
  private toastTimers = new Map<string, ReturnType<typeof setTimeout>>()

  subscribe = (callback: Subscriber): (() => void) => {
    this.subscribers.add(callback)
    return () => this.subscribers.delete(callback)
  }

  private notify() {
    this.subscribers.forEach(cb => cb())
  }

  getSnapshot = (): NotificationState => this.state

  // ============================================
  // 通知推送
  // ============================================

  push(type: NotificationType, title: string, body: string, sessionId: string, directory?: string) {
    const notification: AppNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      title,
      body,
      sessionId,
      directory,
      timestamp: Date.now(),
      read: false,
    }

    const notifications = [notification, ...this.state.notifications].slice(0, MAX_NOTIFICATIONS)

    const toasts = [...this.state.toasts]
    if (toasts.length >= MAX_TOASTS) {
      const oldest = toasts.pop()
      if (oldest) this.clearToastTimer(oldest.notification.id)
    }
    toasts.unshift({ notification, exiting: false })

    this.state = { ...this.state, notifications, toasts }
    this.notify()

    this.scheduleToastDismiss(notification.id)
  }

  // ============================================
  // Toast
  // ============================================

  private scheduleToastDismiss(id: string) {
    this.clearToastTimer(id)
    const timer = setTimeout(() => this.dismissToast(id), TOAST_DURATION)
    this.toastTimers.set(id, timer)
  }

  private clearToastTimer(id: string) {
    const timer = this.toastTimers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.toastTimers.delete(id)
    }
  }

  dismissToast(id: string) {
    this.clearToastTimer(id)
    const toasts = this.state.toasts.map(t =>
      t.notification.id === id ? { ...t, exiting: true } : t
    )
    this.state = { ...this.state, toasts }
    this.notify()

    setTimeout(() => {
      this.state = {
        ...this.state,
        toasts: this.state.toasts.filter(t => t.notification.id !== id),
      }
      this.notify()
    }, EXIT_ANIMATION_MS)
  }

  dismissAllToasts() {
    this.toastTimers.forEach(timer => clearTimeout(timer))
    this.toastTimers.clear()
    this.state = { ...this.state, toasts: [] }
    this.notify()
  }

  // ============================================
  // 通知中心
  // ============================================

  toggleCenter() {
    this.state = { ...this.state, centerOpen: !this.state.centerOpen }
    this.notify()
  }

  openCenter() {
    this.state = { ...this.state, centerOpen: true }
    this.notify()
  }

  closeCenter() {
    this.state = { ...this.state, centerOpen: false }
    this.notify()
  }

  markRead(id: string) {
    this.state = {
      ...this.state,
      notifications: this.state.notifications.map(n =>
        n.id === id ? { ...n, read: true } : n
      ),
    }
    this.notify()
  }

  markAllRead() {
    this.state = {
      ...this.state,
      notifications: this.state.notifications.map(n => ({ ...n, read: true })),
    }
    this.notify()
  }

  clearAll() {
    this.state = { ...this.state, notifications: [] }
    this.notify()
  }

  remove(id: string) {
    this.state = {
      ...this.state,
      notifications: this.state.notifications.filter(n => n.id !== id),
    }
    this.notify()
  }

  get unreadCount(): number {
    return this.state.notifications.filter(n => !n.read).length
  }
}

// ============================================
// 单例 & React Hooks
// ============================================

export const notificationStore = new NotificationStore()

export function useNotificationStore() {
  return useSyncExternalStore(
    notificationStore.subscribe,
    notificationStore.getSnapshot,
  )
}

export function useUnreadCount(): number {
  return useSyncExternalStore(
    notificationStore.subscribe,
    () => notificationStore.unreadCount,
  )
}
