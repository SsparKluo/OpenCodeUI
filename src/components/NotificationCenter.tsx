// ============================================
// NotificationCenter - 铃铛 + 通知面板 + 活跃 Session
// ============================================
//
// Header 右侧铃铛按钮，点击展开下拉面板
// 面板分两个区域：
// 1. Active Sessions - 正在工作的 session 列表
// 2. Notifications - 通知历史列表

import { useEffect, useState, useRef, useCallback } from 'react'
import {
  useNotificationStore,
  useUnreadCount,
  notificationStore,
  type AppNotification,
  type NotificationType,
} from '../store/notificationStore'
import { BellIcon, CloseIcon, HandIcon, QuestionIcon, CheckIcon, AlertCircleIcon } from './Icons'
import { IconButton } from './ui'

// ============================================
// 类型配置
// ============================================

const typeConfig: Record<NotificationType, { icon: typeof HandIcon; color: string; bgColor: string }> = {
  permission: { icon: HandIcon, color: 'text-amber-400', bgColor: 'bg-amber-400/10' },
  question: { icon: QuestionIcon, color: 'text-blue-400', bgColor: 'bg-blue-400/10' },
  completed: { icon: CheckIcon, color: 'text-green-400', bgColor: 'bg-green-400/10' },
  error: { icon: AlertCircleIcon, color: 'text-red-400', bgColor: 'bg-red-400/10' },
}

// ============================================
// 时间格式化
// ============================================

function formatTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

// ============================================
// 通知条目
// ============================================

function NotificationItem({ notification, onNavigate }: {
  notification: AppNotification
  onNavigate: (n: AppNotification) => void
}) {
  const config = typeConfig[notification.type]
  const Icon = config.icon

  return (
    <div
      className={`
        group flex items-start gap-2.5 px-3 py-2.5 cursor-pointer
        transition-colors hover:bg-bg-200/50
        ${notification.read ? 'opacity-50' : ''}
      `}
      onClick={() => onNavigate(notification)}
    >
      {/* 未读指示 */}
      <div className="shrink-0 mt-1.5 w-1.5">
        {!notification.read && (
          <div className="w-1.5 h-1.5 rounded-full bg-accent-main-100" />
        )}
      </div>

      {/* Icon */}
      <div className={`shrink-0 mt-0.5 p-1 rounded-md ${config.bgColor} ${config.color}`}>
        <Icon size={12} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-text-100 truncate">
            {notification.title}
          </span>
          <span className="text-[10px] text-text-400 shrink-0 tabular-nums">
            {formatTime(notification.timestamp)}
          </span>
        </div>
        <div className="text-xs text-text-300 truncate mt-0.5">
          {notification.body}
        </div>
      </div>

      {/* 删除 */}
      <button
        className="shrink-0 p-0.5 mt-0.5 rounded-md text-text-400 opacity-0 group-hover:opacity-100 hover:text-text-200 hover:bg-bg-200 transition-all duration-150 active:scale-90"
        onClick={(e) => { e.stopPropagation(); notificationStore.remove(notification.id) }}
        aria-label="Remove"
      >
        <CloseIcon size={10} />
      </button>
    </div>
  )
}

// ============================================
// NotificationCenter
// ============================================

export function NotificationCenter() {
  const { notifications, centerOpen } = useNotificationStore()
  const unreadCount = useUnreadCount()
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // 动画：shouldRender + isVisible 两阶段
  const [shouldRender, setShouldRender] = useState(false)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (centerOpen) {
      setShouldRender(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true))
      })
    } else {
      setIsVisible(false)
      const timer = setTimeout(() => setShouldRender(false), 200)
      return () => clearTimeout(timer)
    }
  }, [centerOpen])

  // 点击外部关闭
  useEffect(() => {
    if (!centerOpen) return

    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        notificationStore.closeCenter()
      }
    }

    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handler)
    }
  }, [centerOpen])

  const handleNavigateToSession = useCallback((sessionId: string, directory?: string) => {
    notificationStore.closeCenter()
    if (sessionId) {
      const dir = directory ? `?dir=${directory}` : ''
      window.location.hash = `#/session/${sessionId}${dir}`
    }
  }, [])

  const handleNotificationClick = useCallback((notification: AppNotification) => {
    notificationStore.markRead(notification.id)
    handleNavigateToSession(notification.sessionId, notification.directory)
  }, [handleNavigateToSession])

  // 角标：未读数
  const badgeCount = unreadCount

  return (
    <div className="relative">
      {/* 铃铛按钮 */}
      <IconButton
        ref={buttonRef}
        aria-label="Notifications"
        onClick={() => notificationStore.toggleCenter()}
        className={`relative transition-colors ${centerOpen ? 'text-accent-main-100 bg-bg-200/50' : 'text-text-400 hover:text-text-100 hover:bg-bg-200/50'}`}
      >
        <BellIcon size={18} />
        {badgeCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center px-1 rounded-full bg-accent-main-100 text-[10px] font-bold text-white leading-none">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </IconButton>

      {/* 下拉面板 */}
      {shouldRender && (
        <div
          ref={panelRef}
          className="absolute top-full right-0 mt-2 w-80 bg-bg-000 border border-border-200/50 backdrop-blur-xl rounded-xl shadow-xl overflow-hidden z-50"
          style={{
            transition: 'all 200ms cubic-bezier(0.34, 1.15, 0.64, 1)',
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(-4px)',
            transformOrigin: 'top right',
          }}
        >
          {/* ====== 通知列表 Header ====== */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-200/50">
            <span className="text-[11px] font-medium text-text-400 uppercase tracking-wider">
              Notifications
              {unreadCount > 0 && (
                <span className="ml-1 normal-case tracking-normal">({unreadCount})</span>
              )}
            </span>
            <div className="flex items-center gap-0.5">
              {unreadCount > 0 && (
                <button
                  className="text-[11px] text-text-400 hover:text-text-200 px-1.5 py-0.5 rounded-md hover:bg-bg-200 transition-all duration-150 active:scale-95"
                  onClick={() => notificationStore.markAllRead()}
                >
                  Read all
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  className="text-[11px] text-text-400 hover:text-text-200 px-1.5 py-0.5 rounded-md hover:bg-bg-200 transition-all duration-150 active:scale-95"
                  onClick={() => notificationStore.clearAll()}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* ====== 通知列表 Body ====== */}
          <div className="overflow-y-auto max-h-72 custom-scrollbar">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-text-400">
                <BellIcon size={20} className="mb-2 opacity-30" />
                <span className="text-xs">No notifications</span>
              </div>
            ) : (
              <div className="py-0.5">
                {notifications.map(n => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onNavigate={handleNotificationClick}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
