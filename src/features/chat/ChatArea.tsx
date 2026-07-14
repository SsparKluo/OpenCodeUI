/**
 * ChatArea — 基于 @tanstack/react-virtual 的消息流虚拟化
 *
 * 核心架构（学习 oc 的底层机制）：
 *
 * 1. directDomUpdates: 滚动时 virtualizer 直接写 transform 到 DOM，
 *    不触发 React 重渲染（只有 range 变化时才 rerender）。
 *    这是滚动丝滑的关键——oc 用 Solid 天然有此能力，React 需显式开启。
 *
 * 2. key={sessionId}: 切换 session 时整个组件 remount，
 *    virtualizer 用 initialOffset=MAX_SAFE_INTEGER 创建，
 *    _willUpdate 在 useLayoutEffect 中（paint 前）把 scrollTop 设到底部。
 *
 * 3. 行结构: 单个 absolute 元素（top:0 + transform 定位），
 *    不设 height/overflow:clip——否则 measureElement 读 offsetHeight
 *    会返回设定值而非内容高度，形成测量反馈循环。
 *
 * 4. scrollToFn override: 预写入 content height，避免浏览器 clamp
 *    scrollTop 导致初始滚动不到位。
 *
 * 5. shouldAdjustScrollPositionOnItemSizeChange: 只补偿视口上方的行，
 *    用 instance.getScrollOffset() 而非 DOM scrollTop（children 的
 *    useLayoutEffect 比 parent 的 _willUpdate 先执行，此时 scrollTop=0）。
 *
 * 6. resizeItem override: 大尺寸变化（懒加载 markdown/代码块）时
 *    锁定视口行索引，防止跳动。
 *
 * 7. 手势检测: onScroll handler 被 hasScrollGesture() gate，
 *    程序触发的 scroll 不误判为用户滚动。中键自动滚动单独追踪。
 */
import {
  useRef, useImperativeHandle, forwardRef, memo,
  useCallback, useEffect, useLayoutEffect, useMemo,   useState,
} from 'react'
import {
  useVirtualizer, elementScroll, defaultRangeExtractor,
  type VirtualItem,
} from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { MessageRenderer } from '../message'
import { MessageErrorView } from '../message/parts'
import type { Message, MessageError } from '../../types/message'
import { RetryStatusInline, type RetryStatusInlineData } from './RetryStatusInline'
import { buildVisibleMessageEntries, getVisibleMessageForkTargetId } from './chatAreaVisibility'
import { AT_BOTTOM_THRESHOLD_PX } from '../../constants'
import { useChatViewport } from './chatViewport'
import { buildTurnDurationMap, buildTurnLatestAssistantIdSet, type StableChatPage } from './chatPageModel'
import { useTheme } from '../../hooks/useTheme'
import { useAutoScroll } from './virtual/useAutoScroll'
import { normalizeWheelDelta, markBoundaryGesture } from './virtual/messageGesture'

const NOOP = () => {}
const GESTURE_WINDOW_MS = 250
const ROW_ESTIMATE = 60

// ─── 接口定义（保持不变） ───────────────────────────────────────

interface ChatAreaProps {
  messages: Message[]
  pageRecords?: StableChatPage[]
  visibleMessages?: Message[]
  forkTargetIdMap?: Map<string, string | undefined>
  turnDurationMap?: Map<string, number>
  turnLatestAssistantIds?: Set<string>
  sessionId?: string | null
  isStreaming?: boolean
  allowStreamingLayoutAnimation?: boolean
  loadState?: 'idle' | 'loading' | 'loaded' | 'error'
  loadError?: MessageError
  connectionError?: MessageError
  onOpenSettings?: () => void
  hasMoreHistory?: boolean
  onLoadMore?: () => void | Promise<void>
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => void | Promise<void>
  canUndo?: boolean
  registerMessage?: (id: string, element: HTMLElement | null) => void
  retryStatus?: RetryStatusInlineData | null
  bottomPadding?: number
  onVisibleMessageIdsChange?: (ids: string[]) => void
  onAtBottomChange?: (atBottom: boolean) => void
}

export type ChatAreaHandle = {
  scrollToBottom: (instant?: boolean) => void
  scrollToBottomIfAtBottom: () => void
  scrollToLastMessage: () => void
  scrollToMessageIndex: (index: number) => void
  scrollToMessageId: (messageId: string) => void
}

// ─── 虚拟行 ──────────────────────────────────────────────────

interface RowProps {
  virtualItem: VirtualItem
  message: Message
  maxWidthClass: string
  paddingClass: string
  registerMessage?: (id: string, element: HTMLElement | null) => void
  onUndo?: (userMessageId: string) => void
  onFork?: (message: Message, forkMessageId?: string) => void | Promise<void>
  canUndo?: boolean
  forkMessageId?: string
  turnDuration?: number
  isTurnLatestAssistant?: boolean
  allowStreamingLayoutAnimation: boolean
  measureElement: (el: HTMLElement | null) => void
}

const VirtualRow = memo(function VirtualRow({
  virtualItem, message, maxWidthClass, paddingClass,
  registerMessage, onUndo, onFork, canUndo, forkMessageId,
  turnDuration, isTurnLatestAssistant, allowStreamingLayoutAnimation, measureElement,
}: RowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const messageId = message.info.id
  const isUser = message.info.role === 'user'

  // ref 回调: 注册到 virtualizer 的 elementsCache，触发 measureElement 内置 RO
  const setRef = useCallback((el: HTMLDivElement | null) => {
    rowRef.current = el
    measureElement(el)
  }, [measureElement])

  // index 变化时重新测量（行被复用）
  useLayoutEffect(() => {
    if (rowRef.current) measureElement(rowRef.current)
  }, [measureElement, virtualItem.index])

  return (
    <div
      ref={setRef}
      data-timeline-key={messageId}
      data-index={virtualItem.index}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}
    >
      <div
        ref={node => registerMessage?.(messageId, node as HTMLDivElement | null)}
        data-message-id={messageId}
        data-anchor-source-id={forkMessageId ?? messageId}
      >
        <div className={`w-full ${maxWidthClass} mx-auto ${paddingClass} py-3 transition-[max-width] duration-300 ease-in-out`}>
          <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`message-renderer-shell min-w-0 group ${!isUser ? 'w-full' : ''} flex flex-col gap-2`}>
              <MessageRenderer
                message={message}
                allowStreamingLayoutAnimation={message.isStreaming ? allowStreamingLayoutAnimation : false}
                turnDuration={turnDuration}
                isTurnLatestAssistant={isTurnLatestAssistant}
                onUndo={isUser ? onUndo : undefined}
                onFork={onFork}
                forkMessageId={forkMessageId}
                canUndo={isUser ? canUndo : undefined}
                onEnsureParts={NOOP}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}, (prev, next) =>
  prev.virtualItem.index === next.virtualItem.index &&
  prev.virtualItem.start === next.virtualItem.start &&
  prev.virtualItem.size === next.virtualItem.size &&
  prev.message === next.message &&
  prev.maxWidthClass === next.maxWidthClass &&
  prev.paddingClass === next.paddingClass &&
  prev.registerMessage === next.registerMessage &&
  prev.onUndo === next.onUndo &&
  prev.onFork === next.onFork &&
  prev.canUndo === next.canUndo &&
  prev.forkMessageId === next.forkMessageId &&
  prev.turnDuration === next.turnDuration &&
  prev.isTurnLatestAssistant === next.isTurnLatestAssistant &&
  prev.allowStreamingLayoutAnimation === next.allowStreamingLayoutAnimation &&
  prev.measureElement === next.measureElement
)

// ─── 会话缓存（LRU 16） ───────────────────────────────────────

const sessionCache = new Map<string, { measurements: VirtualItem[] }>()

// ─── ChatArea ────────────────────────────────────────────────

export const ChatArea = memo(
  forwardRef<ChatAreaHandle, ChatAreaProps>(
    (
      {
        messages, visibleMessages: visibleMessagesProp,
        forkTargetIdMap: forkTargetIdMapProp, turnDurationMap: turnDurationMapProp,
        turnLatestAssistantIds: turnLatestAssistantIdsProp,
        sessionId, allowStreamingLayoutAnimation = true,
        loadState = 'idle', loadError, connectionError, onOpenSettings,
        hasMoreHistory = false, onLoadMore, onUndo, onFork, canUndo,
        registerMessage, retryStatus = null, bottomPadding = 0,
        onVisibleMessageIdsChange, onAtBottomChange,
      },
      ref,
    ) => {
      const { t } = useTranslation('chat')
      const { isWideMode } = useTheme()
      const { presentation } = useChatViewport()
      const atBottomThreshold = presentation.isCompact ? 150 : AT_BOTTOM_THRESHOLD_PX
      const paddingClass = presentation.isCompact ? 'px-3' : 'px-5'
      const maxWidthClass = isWideMode ? 'max-w-[95%] xl:max-w-6xl' : 'max-w-2xl'

      // ── 派生数据 ──
      const entries = useMemo(() => buildVisibleMessageEntries(messages), [messages])
      const visibleMessages = useMemo(
        () => visibleMessagesProp ?? entries.map(e => e.message),
        [entries, visibleMessagesProp],
      )
      const forkMap = useMemo(
        () => forkTargetIdMapProp ?? new Map(entries.map(e => [e.message.info.id, getVisibleMessageForkTargetId(e)])),
        [forkTargetIdMapProp, entries],
      )
      const turnDurationMap = useMemo(
        () => turnDurationMapProp ?? buildTurnDurationMap(messages, visibleMessages),
        [messages, turnDurationMapProp, visibleMessages],
      )
      const turnLatestAssistantIds = useMemo(
        () => turnLatestAssistantIdsProp ?? buildTurnLatestAssistantIdSet(visibleMessages),
        [turnLatestAssistantIdsProp, visibleMessages],
      )

      // ── Refs（避免闭包过期） ──
      const scrollRef = useRef<HTMLDivElement | null>(null)
      const contentRef = useRef<HTMLDivElement | null>(null)
      const sessionIdRef = useRef(sessionId); sessionIdRef.current = sessionId
      const onLoadMoreRef = useRef(onLoadMore); onLoadMoreRef.current = onLoadMore
      const onVisibleIdsRef = useRef(onVisibleMessageIdsChange); onVisibleIdsRef.current = onVisibleMessageIdsChange
      const onAtBottomRef = useRef(onAtBottomChange); onAtBottomRef.current = onAtBottomChange
      const hasMoreRef = useRef(hasMoreHistory); hasMoreRef.current = hasMoreHistory
      const loadStateRef = useRef(loadState); loadStateRef.current = loadState
      const thresholdRef = useRef(atBottomThreshold); thresholdRef.current = atBottomThreshold

      const [isLoadingMore, setIsLoadingMore] = useState(false)
      const loadingMoreRef = useRef(false)

      // ── 自动滚动 ──
      const auto = useAutoScroll(10)
      // 提取稳定方法，防止 ref 回调因 userScrolled 变化而重挂载
      const autoSetScrollRef = auto.setScrollRef
      const autoSetContentRef = auto.setContentRef
      const autoHandleScroll = auto.handleScroll
      const autoHandleWheel = auto.handleWheel
      const autoHandleInteraction = auto.handleInteraction
      const autoForceScroll = auto.forceScrollToBottom
      const autoScrollBottom = auto.scrollToBottom
      const autoPause = auto.pause
      const userScrolledRef = auto.userScrolledRef

      // ── 滚动手势检测 ──
      const gestureRef = useRef(0)
      const markGesture = useCallback((target?: EventTarget | null) => {
        const nested = (target instanceof Element ? target : undefined)?.closest('[data-scrollable]')
        if (nested && nested !== scrollRef.current) return
        gestureRef.current = Date.now()
      }, [])
      const hasGesture = useCallback(() => Date.now() - gestureRef.current < GESTURE_WINDOW_MS, [])
      const middleClickRef = useRef(false)

      // ── 滚动状态（rAF 批处理） ──
      const stateFrame = useRef<number | undefined>(undefined)
      const prevState = useRef({ overflow: false, bottom: true, jump: false })
      const scheduleScrollState = useCallback(() => {
        if (stateFrame.current !== undefined) return
        stateFrame.current = requestAnimationFrame(() => {
          stateFrame.current = undefined
          const el = scrollRef.current
          if (!el) return
          const max = el.scrollHeight - el.clientHeight
          const dist = max - el.scrollTop
          const overflow = max > 1
          const bottom = !overflow || dist <= thresholdRef.current
          const jump = overflow && dist > Math.max(400, el.clientHeight)
          const p = prevState.current
          if (p.overflow !== overflow || p.bottom !== bottom || p.jump !== jump) {
            prevState.current = { overflow, bottom, jump }
            onAtBottomRef.current?.(bottom)
          }
        })
      }, [])

      // ── Virtualizer ──
      const cached = sessionId ? sessionCache.get(sessionId) : undefined
      const hasCache = !!cached?.measurements?.length
      const [renderOverscan, setRenderOverscan] = useState(hasCache ? 20 : 6)
      const resizePinnedRef = useRef<number[]>([])
      const resizePinFrame = useRef<number | undefined>(undefined)

      const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: visibleMessages.length,
        getScrollElement: () => scrollRef.current,
        // 不用 MAX_SAFE_INTEGER：单列模式下 calculateRangeImpl 不向前扩展，
        // MAX_SAFE_INTEGER 会导致 startIndex=lastIndex，只有最后一条可见。
        // 用 0，靠 scrollToEnd() 在 layout effect 中贴底（directDomUpdates 下 paint 前完成）。
        initialOffset: 0,
        initialMeasurementsCache: cached?.measurements,
        estimateSize: () => ROW_ESTIMATE,
        getItemKey: (i) => visibleMessages[i]?.info.id ?? `removed:${i}`,
        // 预写入 content height，避免浏览器 clamp scrollTop
        scrollToFn: (offset, options, instance) => {
          if (contentRef.current) contentRef.current.style.height = `${instance.getTotalSize()}px`
          elementScroll(offset, options, instance)
        },
        anchorTo: 'end',
        followOnAppend: true,
        scrollEndThreshold: 80,
        overscan: 50,
        // 滚动时直接写 transform 到 DOM，不触发 React 重渲染
        directDomUpdates: true,
        directDomUpdatesMode: 'transform',
        rangeExtractor: (range) => {
          const indexes = defaultRangeExtractor({ ...range, overscan: renderOverscan })
          return [...new Set([...resizePinnedRef.current, ...indexes])].sort((a, b) => a - b)
        },
      })

      // 一次性 overrides（resizeItem + shouldAdjust）
      const overridesApplied = useRef(false)
      if (!overridesApplied.current) {
        const origResize = virtualizer.resizeItem
        virtualizer.resizeItem = (index: number, size: number) => {
          // 大尺寸变化时锁定视口行，防止跳动
          const item = (virtualizer as any).measurementsCache[index]
          const prev = item ? ((virtualizer as any).itemSizeCache.get(item.key) ?? item.size) : undefined
          const root = scrollRef.current
          if (root && prev !== undefined && Math.abs(size - prev) > root.clientHeight) {
            const view = root.getBoundingClientRect()
            resizePinnedRef.current = [...root.querySelectorAll<HTMLElement>('[data-index]')]
              .filter(el => { const r = el.getBoundingClientRect(); return r.bottom > view.top && r.top < view.bottom })
              .map(el => Number(el.dataset.index))
            if (resizePinFrame.current !== undefined) cancelAnimationFrame(resizePinFrame.current)
            resizePinFrame.current = requestAnimationFrame(() => {
              resizePinFrame.current = requestAnimationFrame(() => {
                resizePinFrame.current = undefined
                resizePinnedRef.current = []
              })
            })
          }
          origResize(index, size)
        }
        // 只补偿视口上方的行（用 instance API 而非 DOM scrollTop，
        // 因为 children 的 useLayoutEffect 比 parent 的 _willUpdate 先执行）
        virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item: VirtualItem, _delta: number, instance: any) =>
          item.end <= (instance.getScrollOffset?.() ?? 0) + (instance.scrollAdjustments ?? 0)
        overridesApplied.current = true
      }

      // ── 历史加载（prepend 锚点） ──
      const prependAnchor = useRef<{ key: string; offset: number } | undefined>(undefined)
      const prependFrame = useRef<number | undefined>(undefined)
      const prependLoading = useRef(false)

      const clearPrepend = useCallback(() => {
        prependLoading.current = false
        prependAnchor.current = undefined
        if (prependFrame.current !== undefined) { cancelAnimationFrame(prependFrame.current); prependFrame.current = undefined }
      }, [])

      const capturePrepend = useCallback(() => {
        prependLoading.current = true
        const root = scrollRef.current
        if (!root) return
        const view = root.getBoundingClientRect()
        const anchor = [...root.querySelectorAll<HTMLElement>('[data-timeline-key]')]
          .map(el => ({ el, rect: el.getBoundingClientRect() }))
          .filter(x => x.rect.bottom > view.top && x.rect.top < view.bottom)
          .sort((a, b) => a.rect.top - b.rect.top)[0]
        if (anchor?.el.dataset.timelineKey) {
          prependAnchor.current = { key: anchor.el.dataset.timelineKey, offset: anchor.rect.top - view.top }
        }
      }, [])

      const restorePrepend = useCallback(() => {
        const root = scrollRef.current
        if (!root || !prependAnchor.current) return
        if (prependFrame.current !== undefined) cancelAnimationFrame(prependFrame.current)
        let frames = 0, stable = 0
        const apply = () => {
          prependFrame.current = undefined
          const a = prependAnchor.current
          if (!a) return
          const el = root.querySelector<HTMLElement>(`[data-timeline-key="${CSS.escape(a.key)}"]`)
          const delta = el ? el.getBoundingClientRect().top - root.getBoundingClientRect().top - a.offset : undefined
          if (delta !== undefined && Math.abs(delta) > 0.5) { root.scrollTop += delta; stable = 0 }
          else stable++
          if (++frames >= 180 || stable >= 30) { if (!prependLoading.current) prependAnchor.current = undefined; return }
          prependFrame.current = requestAnimationFrame(apply)
        }
        prependFrame.current = requestAnimationFrame(apply)
      }, [])

      const loadMore = useCallback(() => {
        capturePrepend()
        setIsLoadingMore(true); loadingMoreRef.current = true
        Promise.resolve(onLoadMoreRef.current?.())
          .catch(() => {})
          .finally(() => {
            prependLoading.current = false
            restorePrepend()
            setIsLoadingMore(false); loadingMoreRef.current = false
          })
      }, [capturePrepend, restorePrepend])

      // fill: 内容不足以填满视口时自动加载
      const fillFrame = useRef<number | undefined>(undefined)
      const fill = useCallback(() => {
        if (fillFrame.current !== undefined) return
        fillFrame.current = requestAnimationFrame(() => {
          fillFrame.current = undefined
          if (!sessionIdRef.current || loadStateRef.current !== 'loaded') return
          if (userScrolledRef.current || loadingMoreRef.current) return
          const el = scrollRef.current
          if (el && el.scrollHeight > el.clientHeight + 1) return
          if (!hasMoreRef.current) return
          void loadMore()
        })
      }, [loadMore, userScrolledRef])

      // ── Ref 回调 ──
      const setScrollRoot = useCallback((el: HTMLDivElement | null) => {
        scrollRef.current = el
        autoSetScrollRef(el)
        if (el) { scheduleScrollState(); fill() }
      }, [autoSetScrollRef, scheduleScrollState, fill])

      const setVirtualContent = useCallback((el: HTMLDivElement | null) => {
        contentRef.current = el
        autoSetContentRef(el)
        virtualizer.containerRef(el)
        if (el && scrollRef.current) scheduleScrollState()
      }, [autoSetContentRef, virtualizer, scheduleScrollState])

      // ── 事件处理 ──
      const onScroll = useCallback(() => {
        if (prependLoading.current) { /* 更新锚点 */ }
        scheduleScrollState()
        if (userScrolledRef.current && (scrollRef.current?.scrollTop ?? 0) < 200 && !loadingMoreRef.current && hasMoreRef.current) {
          void loadMore()
        }
        if (middleClickRef.current) markGesture(scrollRef.current)
        if (!hasGesture()) return
        autoHandleScroll()
        markGesture(scrollRef.current)
      }, [scheduleScrollState, markGesture, hasGesture, autoHandleScroll, loadMore, userScrolledRef])

      const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        if (!prependLoading.current) clearPrepend()
        autoHandleWheel(e.nativeEvent)
        const root = e.currentTarget
        const delta = normalizeWheelDelta({ deltaY: e.deltaY, deltaMode: e.deltaMode, rootHeight: root.clientHeight })
        if (delta) markBoundaryGesture({ root, target: e.target, delta, onMarkScrollGesture: markGesture })
      }, [autoHandleWheel, clearPrepend, markGesture])

      const onTouchStart = useCallback(() => {
        if (!prependLoading.current) clearPrepend()
        markGesture(scrollRef.current)
      }, [clearPrepend, markGesture])

      const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
        markBoundaryGesture({ root: e.currentTarget, target: e.target, delta: 1, onMarkScrollGesture: markGesture })
      }, [markGesture])

      const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button === 1) { middleClickRef.current = true; markGesture(e.currentTarget) }
      }, [markGesture])

      // ── Effects ──

      // Session 切换: 重置 userScrolled + 重新测量 + 滚动到底部
      // 没有 key={sessionId}，所以 virtualizer 不会重建，需要手动重置
      const prevSessionRef = useRef<string | null | undefined>(sessionId)
      useLayoutEffect(() => {
        if (prevSessionRef.current === sessionId) return
        prevSessionRef.current = sessionId
        auto.resume()
        virtualizer.measure()
        if (visibleMessages.length > 0) virtualizer.scrollToEnd()
      }, [sessionId, virtualizer, visibleMessages.length, auto])

      // 冷启动: paint 前滚动到底部（首次加载 session 时消息到达）
      useLayoutEffect(() => {
        if (visibleMessages.length > 0) virtualizer.scrollToEnd()
      }, [virtualizer, visibleMessages.length])

      // rAF 后提升 overscan + 再次确认底部
      useEffect(() => {
        const frame = requestAnimationFrame(() => {
          setRenderOverscan(20)
          if (!auto.userScrolledRef.current) virtualizer.scrollToEnd()
        })
        return () => cancelAnimationFrame(frame)
      }, [virtualizer, auto.userScrolledRef])

      // 用户返回底部时重新贴底
      const userScrolledInit = useRef(false)
      useEffect(() => {
        if (!userScrolledInit.current) { userScrolledInit.current = true; return }
        if (auto.userScrolled) return
        const frame = requestAnimationFrame(() => autoScrollBottom())
        return () => cancelAnimationFrame(frame)
      }, [auto.userScrolled, autoScrollBottom])

      // fill effect
      useEffect(() => {
        if (!sessionId || loadState !== 'loaded' || isLoadingMore || auto.userScrolled || !hasMoreHistory) return
        fill()
      }, [sessionId, loadState, isLoadingMore, auto.userScrolled, hasMoreHistory, fill])

      // 缓存保存: session 切换或 unmount 时保存测量结果
      useLayoutEffect(() => {
        return () => {
          if (stateFrame.current !== undefined) cancelAnimationFrame(stateFrame.current)
          if (fillFrame.current !== undefined) cancelAnimationFrame(fillFrame.current)
          if (resizePinFrame.current !== undefined) cancelAnimationFrame(resizePinFrame.current)
          clearPrepend()
        }
      }, [clearPrepend])

      // session 切换时保存旧 session 的缓存
      const cacheSessionRef = useRef<string | null | undefined>(sessionId)
      useEffect(() => {
        if (cacheSessionRef.current === sessionId) return
        const oldSid = cacheSessionRef.current
        cacheSessionRef.current = sessionId
        if (oldSid) {
          sessionCache.delete(oldSid)
          sessionCache.set(oldSid, { measurements: virtualizer.takeSnapshot() })
          while (sessionCache.size > 16) sessionCache.delete(sessionCache.keys().next().value!)
        }
      }, [sessionId, virtualizer])

      // 中键清理
      useEffect(() => {
        const clear = (e: MouseEvent) => { if (e.button !== 1) middleClickRef.current = false }
        const clearKey = () => { middleClickRef.current = false }
        document.addEventListener('mousedown', clear)
        document.addEventListener('keydown', clearKey)
        return () => {
          document.removeEventListener('mousedown', clear)
          document.removeEventListener('keydown', clearKey)
        }
      }, [])

      // IntersectionObserver for OutlineIndex
      const msgIdsKey = useMemo(() => visibleMessages.map(m => m.info.id).join(','), [visibleMessages])
      useEffect(() => {
        const root = scrollRef.current
        if (!root) return
        const visible = new Set<string>()
        const observer = new IntersectionObserver(
          entries => {
            let changed = false
            for (const entry of entries) {
              const id = entry.target.getAttribute('data-message-id')
              if (!id) continue
              if (entry.isIntersecting) { if (!visible.has(id)) { visible.add(id); changed = true } }
              else if (visible.has(id)) { visible.delete(id); changed = true }
            }
            if (changed) onVisibleIdsRef.current?.(Array.from(visible))
          },
          { root, rootMargin: '100% 0px' },
        )
        root.querySelectorAll<HTMLElement>('[data-message-id]').forEach(el => observer.observe(el))
        return () => observer.disconnect()
      }, [msgIdsKey])

      // ── 命令式接口 ──
      useImperativeHandle(ref, () => ({
        scrollToBottom: () => autoForceScroll(),
        scrollToBottomIfAtBottom: () => { if (prevState.current.bottom) autoForceScroll() },
        scrollToLastMessage: () => { if (visibleMessages.length > 0) virtualizer.scrollToIndex(visibleMessages.length - 1) },
        scrollToMessageIndex: (index: number) => {
          if (index < 0 || index >= visibleMessages.length) return
          autoPause()
          virtualizer.scrollToIndex(index, { align: 'center' })
        },
        scrollToMessageId: (messageId: string) => {
          const index = visibleMessages.findIndex(m => m.info.id === messageId)
          if (index < 0) return
          autoPause()
          virtualizer.scrollToIndex(index, { align: 'center' })
        },
      }), [autoForceScroll, autoPause, virtualizer, visibleMessages])

      // ── 渲染 ──
      const items = virtualizer.getVirtualItems()

      return (
        <div className="h-full overflow-hidden contain-strict relative">
          {loadState === 'loading' && visibleMessages.length === 0 && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-text-400 session-loading-indicator">
                <span className="w-5 h-5 border-2 border-text-400/30 border-t-text-400 rounded-full animate-spin" />
                <span className="text-[length:var(--fs-base)]">{t('chatArea.loadingSession')}</span>
              </div>
            </div>
          )}

          <div
            ref={setScrollRoot}
            data-chat-scroll-root="true"
            className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar contain-content"
            style={{ overflowAnchor: 'none' }}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onScroll={onScroll}
            onMouseDown={onMouseDown}
            onClick={autoHandleInteraction}
          >
            {visibleMessages.length > 0 && isLoadingMore && (
              <div className="relative h-0 overflow-visible pointer-events-none" aria-hidden="true">
                <div className="absolute left-0 right-0 top-2 z-10 flex justify-center">
                  <div className="flex items-center gap-2 rounded-full bg-bg-100/90 px-3 py-1.5 text-text-400 text-[length:var(--fs-sm)] shadow-sm">
                    <span className="w-3.5 h-3.5 border-2 border-text-400/30 border-t-text-400 rounded-full animate-spin" />
                    {t('chatArea.loadingHistory')}
                  </div>
                </div>
              </div>
            )}

            <div ref={setVirtualContent} style={{ position: 'relative', width: '100%' }}>
              {items.map(item => {
                const message = visibleMessages[item.index]
                if (!message) return null
                return (
                  <VirtualRow
                    key={item.key}
                    virtualItem={item}
                    message={message}
                    maxWidthClass={maxWidthClass}
                    paddingClass={paddingClass}
                    registerMessage={registerMessage}
                    onUndo={onUndo}
                    onFork={onFork}
                    canUndo={canUndo}
                    forkMessageId={forkMap.get(message.info.id)}
                    turnDuration={turnDurationMap.get(message.info.id)}
                    isTurnLatestAssistant={
                      message.info.role === 'assistant'
                        ? turnLatestAssistantIds.has(message.info.id)
                        : undefined
                    }
                    allowStreamingLayoutAnimation={allowStreamingLayoutAnimation}
                    measureElement={virtualizer.measureElement as (el: HTMLElement | null) => void}
                  />
                )
              })}
            </div>

            {retryStatus && (
              <div className={`w-full ${maxWidthClass} mx-auto ${paddingClass}`}>
                <div className="flex justify-start">
                  <div className="w-full min-w-0">
                    <RetryStatusInline status={retryStatus} />
                  </div>
                </div>
              </div>
            )}

            {visibleMessages.length === 0 && (loadError || connectionError) && (
              <div className={`w-full ${maxWidthClass} mx-auto ${paddingClass}`}>
                <div className="flex justify-start">
                  <div className="w-full min-w-0 space-y-2">
                    <MessageErrorView error={loadError ?? connectionError!} />
                    {connectionError && onOpenSettings && (
                      <button
                        type="button"
                        onClick={onOpenSettings}
                        className="rounded-md border border-border-200 bg-bg-100 px-3 py-1.5 text-[length:var(--fs-sm)] text-text-200 transition-colors hover:bg-bg-200"
                      >
                        Open server settings
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div style={{ height: bottomPadding > 0 ? `${bottomPadding + 48}px` : '256px' }} />
          </div>
        </div>
      )
    },
  ),
)
