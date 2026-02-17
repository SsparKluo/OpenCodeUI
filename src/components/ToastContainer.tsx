// ============================================
// ToastContainer - 右下角通知弹窗
// ============================================
//
// 动画风格与项目一致：shouldRender + isVisible 两阶段
// transition + cubic-bezier(0.34, 1.15, 0.64, 1)

import { useState, useEffect } from 'react'
import { useNotificationStore, notificationStore, type ToastItem, type NotificationType } from '../store/notificationStore'
import { CloseIcon, HandIcon, QuestionIcon, CheckIcon, AlertCircleIcon } from './Icons'

// ============================================
// 类型图标映射
// ============================================

const typeConfig: Record<NotificationType, { icon: typeof HandIcon; color: string }> = {
  permission: { icon: HandIcon, color: 'text-amber-400' },
  question: { icon: QuestionIcon, color: 'text-blue-400' },
  completed: { icon: CheckIcon, color: 'text-green-400' },
  error: { icon: AlertCircleIcon, color: 'text-red-400' },
}

// ============================================
// 单个 Toast（自带进入/退出动画）
// ============================================

function Toast({ item, onDismiss, onClick }: {
  item: ToastItem
  onDismiss: () => void
  onClick: () => void
}) {
  const { notification, exiting } = item
  const config = typeConfig[notification.type]
  const Icon = config.icon

  // 进入动画：mount 后下一帧设为 visible
  const [isVisible, setIsVisible] = useState(false)
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setIsVisible(true))
    })
  }, [])

  // 退出时立即变为不可见
  const show = isVisible && !exiting

  return (
    <div
      style={{
        transition: 'all 200ms cubic-bezier(0.34, 1.15, 0.64, 1)',
        opacity: show ? 1 : 0,
        transform: show ? 'translateX(0) scale(1)' : 'translateX(16px) scale(0.95)',
        pointerEvents: show ? 'auto' : 'none',
      }}
      className="group relative flex items-start gap-2.5 p-3 pr-8 bg-bg-000 border border-border-200/50 backdrop-blur-xl rounded-xl shadow-xl cursor-pointer hover:bg-bg-100 hover:border-border-300"
      onClick={onClick}
      role="alert"
    >
      {/* Icon */}
      <div className={`shrink-0 mt-0.5 ${config.color}`}>
        <Icon size={16} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-text-100 truncate">
          {notification.title}
        </div>
        <div className="text-xs text-text-300 truncate mt-0.5">
          {notification.body}
        </div>
      </div>

      {/* Close */}
      <button
        className="absolute top-2 right-2 p-0.5 rounded-md text-text-400 opacity-0 group-hover:opacity-100 hover:text-text-200 hover:bg-bg-200 transition-all duration-150 active:scale-90"
        onClick={(e) => { e.stopPropagation(); onDismiss() }}
        aria-label="Dismiss"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  )
}

// ============================================
// Container
// ============================================

export function ToastContainer() {
  const { toasts } = useNotificationStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-72">
      {toasts.map(item => (
        <Toast
          key={item.notification.id}
          item={item}
          onDismiss={() => notificationStore.dismissToast(item.notification.id)}
          onClick={() => {
            const { sessionId, directory } = item.notification
            notificationStore.dismissToast(item.notification.id)
            notificationStore.markRead(item.notification.id)
            if (sessionId) {
              const dir = directory ? `?dir=${directory}` : ''
              window.location.hash = `#/session/${sessionId}${dir}`
            }
          }}
        />
      ))}
    </div>
  )
}
