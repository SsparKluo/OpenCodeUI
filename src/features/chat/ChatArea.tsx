// ============================================
// ChatArea - 聊天消息显示区域
// ============================================

import { useRef, useImperativeHandle, forwardRef, useState, memo, useCallback, useEffect, useMemo } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { MessageRenderer } from '../message'
import { messageStore } from '../../store'
import type { Message } from '../../types/message'
import {
  VIRTUOSO_START_INDEX,
  AUTO_SCROLL_THRESHOLD_PX,
  SCROLL_CHECK_INTERVAL_MS,
  SCROLL_RESUME_DELAY_MS,
  AT_BOTTOM_THRESHOLD_PX,
  VIRTUOSO_OVERSCAN_PX,
  VIRTUOSO_ESTIMATED_ITEM_HEIGHT,
  MESSAGE_PREFETCH_BUFFER,
} from '../../constants'

interface ChatAreaProps {
  messages: Message[]
  /** 当前 session ID，用于检测 session 切换并触发过渡动画 */
  sessionId?: string | null
  /** 是否正在 streaming，用于定时自动滚动 */
  isStreaming?: boolean
  /** 累计向前加载的消息数量，用于计算 Virtuoso 的 firstItemIndex */
  prependedCount?: number
  onLoadMore?: () => void
  onUndo?: (userMessageId: string) => void
  canUndo?: boolean
  registerMessage?: (id: string, element: HTMLElement | null) => void
  isWideMode?: boolean
  onVisibleMessageIdsChange?: (ids: string[]) => void
}

export type ChatAreaHandle = {
  scrollToBottom: (instant?: boolean) => void
  /** 只有用户在底部时才滚动 */
  scrollToBottomIfAtBottom: () => void
  /** 滚动到最后一条消息（显示在视口上部，用于 Undo 后） */
  scrollToLastMessage: () => void
  /** 临时禁用自动滚动（用于 undo/redo） */
  suppressAutoScroll: (duration?: number) => void
  /** 滚动到指定索引的消息（用于目录导航） */
  scrollToMessageIndex: (index: number) => void
}

// 检查消息是否有可见内容
function messageHasContent(msg: Message): boolean {
  if (msg.parts.length === 0) return true
  return msg.parts.some(part => {
    switch (part.type) {
      case 'text':
        return part.text?.trim().length > 0
      case 'reasoning':
        return part.text?.trim().length > 0
      case 'tool':
      case 'file':
      case 'agent':
      case 'step-finish':
      case 'subtask':
        return true
      default:
        return false
    }
  })
}

// 大数字作为起始索引，允许向前 prepend
const START_INDEX = VIRTUOSO_START_INDEX

export const ChatArea = memo(forwardRef<ChatAreaHandle, ChatAreaProps>(({ 
  messages, 
  sessionId,
  isStreaming = false,
  prependedCount = 0,
  onLoadMore,
  onUndo,
  canUndo,
  registerMessage,
  isWideMode = false,
  onVisibleMessageIdsChange,
}, ref) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null)
  // 外部滚动容器
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  // 追踪用户是否在底部附近 - 用于决定是否自动滚动
  const isUserAtBottomRef = useRef(true)
  // 临时禁用自动滚动的标志
  const suppressScrollRef = useRef(false)
  // 用户正在滚动的标志 - 滚动期间不触发自动滚动
  const isUserScrollingRef = useRef(false)
  const scrollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  // Session 切换过渡：简单的淡入效果
  // 使用 sessionId 作为 key，切换时会触发组件重新挂载从而产生 CSS 动画
  const transitionKey = sessionId || 'empty'
  
  // 过滤空消息（有 memo 避免每次 render 都创建新数组）
  const visibleMessages = useMemo(() => messages.filter(messageHasContent), [messages])
  
  // 用 ref 追踪最新的消息数量，确保回调和 effect 中能获取到
  const visibleMessagesCountRef = useRef(visibleMessages.length)
  visibleMessagesCountRef.current = visibleMessages.length
  
  // 定时自动滚动：在 streaming 时定期检查是否需要滚动
  // 这样打字机效果导致的内容增长也会触发滚动
  useEffect(() => {
    if (!isStreaming) return
    
    const scrollInterval = setInterval(() => {
      // 如果用户正在滚动或被禁用，绝对不自动滚
      if (isUserScrollingRef.current || suppressScrollRef.current) {
        return
      }
      
      const shouldForceScroll = (() => {
        if (!scrollParent) return false
        const distanceToBottom = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight
        // 关键逻辑：
        // 1. 如果 Virtuoso 认为在底部，那就滚
        // 2. 如果 Virtuoso 认为不在底部，但实际距离 < 150px，那说明是打字机导致的"假"脱离底部，强制拉回来
        // 3. 只有当用户真的往上翻了很多（> 150px），才停止滚动
        return isUserAtBottomRef.current || distanceToBottom < AUTO_SCROLL_THRESHOLD_PX
      })()

      if (!shouldForceScroll) return
      
      // 1. Virtuoso 滚动
      virtuosoRef.current?.scrollToIndex({ 
        index: visibleMessagesCountRef.current - 1, 
        align: 'end', 
        behavior: 'auto' 
      })
      
      // 2. 强制 DOM 滚动补充
      if (scrollParent) {
        const distanceToBottom = scrollParent.scrollHeight - scrollParent.scrollTop - scrollParent.clientHeight
        if (distanceToBottom > 10) { 
           scrollParent.scrollTop = scrollParent.scrollHeight
        }
      }
    }, SCROLL_CHECK_INTERVAL_MS)  // 加快检查频率
    
    return () => clearInterval(scrollInterval)
  }, [isStreaming, scrollParent])
  
  // 清理 scrollingTimeoutRef 防止内存泄漏
  useEffect(() => {
    return () => {
      if (scrollingTimeoutRef.current) {
        clearTimeout(scrollingTimeoutRef.current)
        scrollingTimeoutRef.current = null
      }
    }
  }, [])
  
  // firstItemIndex：基于 prependedCount 计算，确保和 messages 同步
  const firstItemIndex = START_INDEX - prependedCount

  useImperativeHandle(ref, () => ({
    scrollToBottom: (instant = false) => {
      virtuosoRef.current?.scrollToIndex({ 
        index: visibleMessages.length - 1, 
        align: 'end', 
        behavior: instant ? 'auto' : 'smooth' 
      })
    },
    scrollToBottomIfAtBottom: () => {
      // 用户正在滚动、被禁用、或不在底部时，不自动滚动
      if (isUserScrollingRef.current || suppressScrollRef.current || !isUserAtBottomRef.current) {
        return
      }
      // 使用 auto 而不是 smooth，减少和用户滚动的冲突
      virtuosoRef.current?.scrollToIndex({ 
        index: visibleMessagesCountRef.current - 1, 
        align: 'end', 
        behavior: 'auto' 
      })
    },
    scrollToLastMessage: () => {
      // 滚动到最后一条消息，显示在视口上部（用于 Undo 后）
      const count = visibleMessagesCountRef.current
      if (count > 0) {
        virtuosoRef.current?.scrollToIndex({ 
          index: count - 1, 
          align: 'start', 
          behavior: 'auto' 
        })
      }
    },
    suppressAutoScroll: (duration = 500) => {
      suppressScrollRef.current = true
      setTimeout(() => {
        suppressScrollRef.current = false
      }, duration)
    },
    scrollToMessageIndex: (index: number) => {
      if (index >= 0 && index < visibleMessagesCountRef.current) {
        // 临时禁用自动滚动，避免被拉回底部
        suppressScrollRef.current = true
        setTimeout(() => { suppressScrollRef.current = false }, 1000)
        
        virtuosoRef.current?.scrollToIndex({
          index,
          align: 'start',
          behavior: 'smooth',
        })
      }
    },
  }))
  
  // followOutput: 完全禁用，改用手动控制
  // Virtuoso 的 followOutput 会在每次数据变化时触发，太频繁了
  const handleFollowOutput = useCallback(() => false, [])
  
  // 追踪用户滚动位置
  const handleAtBottomStateChange = useCallback((atBottom: boolean) => {
    isUserAtBottomRef.current = atBottom
  }, [])
  
  // 追踪用户是否正在滚动
  const handleIsScrolling = useCallback((scrolling: boolean) => {
    if (scrolling) {
      // 用户开始滚动，立即禁用自动滚动
      isUserScrollingRef.current = true
      // 清除之前的 timeout
      if (scrollingTimeoutRef.current) {
        clearTimeout(scrollingTimeoutRef.current)
        scrollingTimeoutRef.current = null
      }
    } else {
      // 滚动停止后延迟 500ms 才允许自动滚动
      // 给用户足够的缓冲时间
      scrollingTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false
      }, SCROLL_RESUME_DELAY_MS)
    }
  }, [])

  // 消息项渲染 - 带 ref 注册
  const renderMessage = useCallback((msg: Message) => {
    const handleRef = (el: HTMLDivElement | null) => {
      if (el) {
        // 清除可能残留的动画样式
        el.style.opacity = ''
        el.style.transform = ''
        el.style.transition = ''
      }
      registerMessage?.(msg.info.id, el)
    }
    
    const maxWidthClass = isWideMode ? 'max-w-[95%] xl:max-w-6xl' : 'max-w-2xl'

    return (
      <div ref={handleRef} className={`w-full ${maxWidthClass} mx-auto px-4 py-3 transition-[max-width] duration-300 ease-in-out`}>
        <div className={`flex ${msg.info.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div className={`min-w-0 group ${msg.info.role === 'assistant' ? 'w-full' : ''}`}>
            <MessageRenderer
              message={msg}
              onUndo={onUndo}
              canUndo={canUndo}
              onEnsureParts={(id) => {
                if (!sessionId) return
                void messageStore.hydrateMessageParts(sessionId, id)
              }}
            />
          </div>
        </div>
      </div>
    )
  }, [registerMessage, onUndo, canUndo, isWideMode, sessionId])

  return (
    <div className="h-full overflow-hidden contain-strict">
      <div 
        key={transitionKey}
        ref={setScrollParent} 
        className="h-full overflow-y-auto custom-scrollbar animate-fade-in contain-content"
      >
        {scrollParent && (
          <Virtuoso
            ref={virtuosoRef}
            data={visibleMessages}
            customScrollParent={scrollParent}
            firstItemIndex={firstItemIndex}
            initialTopMostItemIndex={visibleMessages.length - 1}
            startReached={onLoadMore}
            followOutput={handleFollowOutput}
            atBottomStateChange={handleAtBottomStateChange}
            isScrolling={handleIsScrolling}
            atBottomThreshold={AT_BOTTOM_THRESHOLD_PX}
            // 预估消息高度，减少初始渲染时的布局跳动 (CLS)
            defaultItemHeight={VIRTUOSO_ESTIMATED_ITEM_HEIGHT}
            // 减少 prepend 时的闪烁，跳过 ResizeObserver 的 requestAnimationFrame
            // 可能产生 console 警告但能改善体验
            skipAnimationFrameInResizeObserver
            // 增加 overscan 预渲染更多内容，减少滚动时的实时渲染压力
            overscan={{ main: VIRTUOSO_OVERSCAN_PX, reverse: VIRTUOSO_OVERSCAN_PX }}
            components={{
              Header: () => <div className="h-20" />,
              Footer: () => <div className="h-64" />
            }}
            rangeChanged={(range) => {
              if (!onVisibleMessageIdsChange) return
              const start = Math.max(0, range.startIndex - MESSAGE_PREFETCH_BUFFER)
              const end = Math.min(visibleMessages.length - 1, range.endIndex + MESSAGE_PREFETCH_BUFFER)
              const ids: string[] = []
              for (let i = start; i <= end; i++) {
                const id = visibleMessages[i]?.info.id
                if (id) ids.push(id)
              }
              onVisibleMessageIdsChange(ids)
            }}
            itemContent={(_, msg) => renderMessage(msg)}
          />
        )}
      </div>
    </div>
  )
}))
