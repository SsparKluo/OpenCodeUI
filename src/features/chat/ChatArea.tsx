/**
 * ChatArea — 基于 @tanstack/react-virtual 的消息流虚拟化
 *
 * 对齐 oc message-timeline 的关键点：
 * 1. parent 在 messages ready 后 key={sessionId} remount
 * 2. mount 时读 sessionCache → initialMeasurementsCache
 * 3. 冷启动 initialOffset 估在底部 + scrollToFn 预写 total height
 * 4. anchorTo/followOnAppend + 贴底时 size change 直接 scrollToEnd
 * 5. unmount takeSnapshot 写回 cache
 * 6. directDomUpdates 滚动写 transform，不触发 React 重渲染
 */
import {
  useRef, useImperativeHandle, forwardRef, memo,
  useCallback, useEffect, useLayoutEffect, useMemo, useState,
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

const NOOP = () => {}
const ROW_ESTIMATE = 60
const DEFAULT_BOTTOM_SPACER = 256
const SESSION_CACHE_LIMIT = 16

const bottomSpacerHeight = (bottomPadding: number) =>
  bottomPadding > 0 ? bottomPadding + 48 : DEFAULT_BOTTOM_SPACER

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
      // userScrolled 判定用小阈值（10px），和 UI 回底按钮的 60/150 阈值分开。
      // 否则上滚一点点仍在“底部区”里，userScrolled 会被立刻清掉，
      // 再碰上最后一条 HTML 时钟每秒重测 → scrollToEnd，怎么滚都拉回底。
      const auto = useAutoScroll(10)
      const autoSetScrollRef = auto.setScrollRef
      const autoSetContentRef = auto.setContentRef
      const autoHandleScroll = auto.handleScroll
      const autoHandleWheel = auto.handleWheel
      const autoHandleInteraction = auto.handleInteraction
      const autoForceScroll = auto.forceScrollToBottom
      const autoScrollBottom = auto.scrollToBottom
      const autoPause = auto.pause
      const autoMarkAuto = auto.markAuto
      const userScrolledRef = auto.userScrolledRef
      const spacerHeight = bottomSpacerHeight(bottomPadding)
      // 贴底判断必须读 ref：wheel→stop 后 state 还没 re-render，
      // 若仍用 state，同一帧的 ResizeObserver 会误判仍可贴底。
      const shouldAnchorBottom = () => !userScrolledRef.current

      // ── 滚动状态（同步计算，不使用 rAF） ──
      const prevState = useRef({ overflow: false, bottom: true, jump: false })
      const computeScrollState = useCallback(() => {
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
      }, [])

      // ── Virtualizer ──
      // parent key={sessionId} remount 后，这里只在 mount 时读一次 cache
      const initialCacheRef = useRef(sessionId ? sessionCache.get(sessionId)?.measurements : undefined)
      const coldBottomMount = !initialCacheRef.current?.length
      const [renderOverscan, setRenderOverscan] = useState(
        initialCacheRef.current?.length || coldBottomMount ? 6 : 15,
      )
      const resizePinnedRef = useRef<number[]>([])
      const resizePinFrame = useRef<number | undefined>(undefined)
      const resizeAnchorScheduled = useRef(false)

      // 冷启动估在底部：有 cache 用 cache 总高，否则 estimate*count + paddingEnd。
      // 不用 MAX_SAFE_INTEGER（单列 range 不会向前扩，只会渲染最后一项）。
      const estimatedBottomOffset = useMemo(() => {
        const cached = initialCacheRef.current
        if (cached?.length) {
          const last = cached[cached.length - 1]
          return Math.max(0, (last?.end ?? 0) + spacerHeight - 600)
        }
        return Math.max(0, visibleMessages.length * ROW_ESTIMATE + spacerHeight - 600)
        // 只在 mount 用初始 count 估一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: visibleMessages.length,
        getScrollElement: () => scrollRef.current,
        initialOffset: estimatedBottomOffset,
        initialMeasurementsCache: initialCacheRef.current,
        estimateSize: () => ROW_ESTIMATE,
        getItemKey: (i) => visibleMessages[i]?.info.id ?? `removed:${i}`,
        paddingEnd: spacerHeight,
        scrollEndThreshold: 80,
        // 预写 total height，避免浏览器把新 offset clamp 到旧高度（oc 同款）
        scrollToFn: (offset, options, instance) => {
          if (contentRef.current) contentRef.current.style.height = `${instance.getTotalSize()}px`
          autoMarkAuto(scrollRef.current)
          elementScroll(offset, options, instance)
        },
        anchorTo: 'end',
        followOnAppend: true,
        overscan: 50,
        directDomUpdates: true,
        directDomUpdatesMode: 'transform',
        rangeExtractor: (range) => {
          const indexes = defaultRangeExtractor({ ...range, overscan: renderOverscan })
          if (resizePinnedRef.current.length === 0) return indexes
          return [...new Set([...resizePinnedRef.current, ...indexes])].sort((a, b) => a - b)
        },
      })

      // 一次性 overrides（resizeItem + shouldAdjust）——对齐 oc
      const overridesApplied = useRef(false)
      if (!overridesApplied.current) {
        const origResize = virtualizer.resizeItem
        virtualizer.resizeItem = (index: number, size: number) => {
          const item = (virtualizer as any).measurementsCache[index]
          const prev = item ? ((virtualizer as any).itemSizeCache.get(item.key) ?? item.size) : undefined
          const root = scrollRef.current
          if (root && prev !== undefined && Math.abs(size - prev) > root.clientHeight) {
            const view = root.getBoundingClientRect()
            resizePinnedRef.current = [...root.querySelectorAll<HTMLElement>('[data-index]')]
              .filter(el => {
                const r = el.getBoundingClientRect()
                return r.bottom > view.top && r.top < view.bottom
              })
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
          // 仅在用户仍贴底时，对 size change 做 scrollToEnd。
          // 用户已上滚（userScrolledRef）时绝不拉回——否则 HTML 时钟/字体加载
          // 每秒重测会把视口拽回底部。
          if (
            root
            && shouldAnchorBottom()
            && !resizeAnchorScheduled.current
            && (virtualizer as any).isAtEnd?.(80)
          ) {
            resizeAnchorScheduled.current = true
            queueMicrotask(() => {
              resizeAnchorScheduled.current = false
              if (!shouldAnchorBottom()) return
              if (!(virtualizer as any).isAtEnd?.(80)) return
              autoMarkAuto(scrollRef.current)
              virtualizer.scrollToEnd()
            })
          }
        }
        virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item: VirtualItem, _delta: number, instance: any) => {
          // 用户已离底：只补偿视口上方行（默认行为）
          // 用户贴底：关掉 adjust，交给上面的 isAtEnd + scrollToEnd
          if (shouldAnchorBottom()) return false
          return item.end <= (instance.getScrollOffset?.() ?? 0) + (instance.scrollAdjustments ?? 0)
        }
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

      const updatePrependAnchor = useCallback(() => {
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

      const applyPrependAnchor = useCallback(() => {
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

      const capturePrepend = useCallback(() => {
        prependLoading.current = true
        updatePrependAnchor()
      }, [updatePrependAnchor])

      const restorePrepend = useCallback((done: boolean) => {
        if (done) prependLoading.current = false
        applyPrependAnchor()
      }, [applyPrependAnchor])

      const loadMore = useCallback(() => {
        capturePrepend()
        setIsLoadingMore(true); loadingMoreRef.current = true
        Promise.resolve(onLoadMoreRef.current?.())
          .catch(() => {})
          .finally(() => {
            setIsLoadingMore(false); loadingMoreRef.current = false
            restorePrepend(true)
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
        if (el) { computeScrollState(); fill() }
      }, [autoSetScrollRef, computeScrollState, fill])

      const setVirtualContent = useCallback((el: HTMLDivElement | null) => {
        contentRef.current = el
        autoSetContentRef(el)
        virtualizer.containerRef(el)
        if (el && scrollRef.current) computeScrollState()
      }, [autoSetContentRef, virtualizer, computeScrollState])

      const pinToBottom = useCallback(() => {
        if (visibleMessages.length === 0) return
        autoMarkAuto(scrollRef.current)
        virtualizer.scrollToEnd()
      }, [autoMarkAuto, virtualizer, visibleMessages.length])

      // ── 事件处理 ──
      const onScroll = useCallback(() => {
        if (prependLoading.current) updatePrependAnchor()
        computeScrollState()
        if (
          userScrolledRef.current
          && (scrollRef.current?.scrollTop ?? 0) < 200
          && !loadingMoreRef.current
          && hasMoreRef.current
        ) {
          void loadMore()
        }
        // 始终走 handleScroll：滚动条/键盘也能离底；程序贴底靠 markAuto 过滤
        autoHandleScroll()
      }, [updatePrependAnchor, computeScrollState, autoHandleScroll, loadMore, userScrolledRef])

      const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        if (!prependLoading.current) clearPrepend()
        autoHandleWheel(e.nativeEvent)
      }, [autoHandleWheel, clearPrepend])

      const onTouchStart = useCallback(() => {
        if (!prependLoading.current) clearPrepend()
      }, [clearPrepend])

      // ── Effects（parent key remount 后，这里只处理本实例生命周期） ──

      // 冷启动 / 回流：双 rAF 贴底 + 抬 overscan（对齐 oc onMount）
      useEffect(() => {
        let cancelled = false
        let outer = 0
        let inner = 0
        outer = requestAnimationFrame(() => {
          if (cancelled) return
          if (shouldAnchorBottom()) pinToBottom()
          inner = requestAnimationFrame(() => {
            if (cancelled) return
            if (renderOverscan < 15) setRenderOverscan(15)
            if (shouldAnchorBottom()) pinToBottom()
          })
        })
        return () => {
          cancelled = true
          cancelAnimationFrame(outer)
          cancelAnimationFrame(inner)
        }
        // mount-only
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // rows 变化且应贴底时再确认一次（append / 首批消息）
      // prepend 由 anchorTo + prepend 锚点处理，这里在 userScrolled 时不跟
      useLayoutEffect(() => {
        if (visibleMessages.length === 0) return
        if (!shouldAnchorBottom() || prependLoading.current) return
        pinToBottom()
      }, [visibleMessages.length, pinToBottom])

      // 用户返回底部时重新贴底
      const userScrolledInit = useRef(false)
      useEffect(() => {
        if (!userScrolledInit.current) {
          userScrolledInit.current = true
          return
        }
        if (auto.userScrolled) return
        const frame = requestAnimationFrame(() => {
          autoScrollBottom()
          pinToBottom()
        })
        return () => cancelAnimationFrame(frame)
      }, [auto.userScrolled, autoScrollBottom, pinToBottom])

      // fill effect
      useEffect(() => {
        if (!sessionId || loadState !== 'loaded' || isLoadingMore || auto.userScrolled || !hasMoreHistory) return
        fill()
      }, [sessionId, loadState, isLoadingMore, auto.userScrolled, hasMoreHistory, fill])

      // unmount：snapshot 写回 cache（对齐 oc onCleanup）
      useLayoutEffect(() => {
        const sid = sessionId
        return () => {
          if (fillFrame.current !== undefined) cancelAnimationFrame(fillFrame.current)
          if (resizePinFrame.current !== undefined) cancelAnimationFrame(resizePinFrame.current)
          clearPrepend()
          if (!sid) return
          sessionCache.delete(sid)
          sessionCache.set(sid, { measurements: virtualizer.takeSnapshot() })
          while (sessionCache.size > SESSION_CACHE_LIMIT) {
            sessionCache.delete(sessionCache.keys().next().value!)
          }
        }
      }, [sessionId, virtualizer, clearPrepend])

      // ── 渲染数据 ──
      const items = virtualizer.getVirtualItems()
      const mountedMessageIdsKey = useMemo(
        () => items.map(item => visibleMessages[item.index]?.info.id).filter(Boolean).join(','),
        [items, visibleMessages],
      )

      // Outline 可见消息：跟随虚拟行挂载变化
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
              if (entry.isIntersecting) {
                if (!visible.has(id)) {
                  visible.add(id)
                  changed = true
                }
              } else if (visible.has(id)) {
                visible.delete(id)
                changed = true
              }
            }
            if (changed) onVisibleIdsRef.current?.(Array.from(visible))
          },
          { root, rootMargin: '100% 0px' },
        )
        root.querySelectorAll<HTMLElement>('[data-message-id]').forEach(el => observer.observe(el))
        return () => observer.disconnect()
      }, [mountedMessageIdsKey])

      // ── 命令式接口 ──
      useImperativeHandle(ref, () => ({
        scrollToBottom: () => {
          autoForceScroll()
          pinToBottom()
        },
        scrollToBottomIfAtBottom: () => {
          if (!prevState.current.bottom) return
          autoForceScroll()
          pinToBottom()
        },
        scrollToLastMessage: () => {
          if (visibleMessages.length === 0) return
          autoMarkAuto(scrollRef.current)
          virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end' })
        },
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
      }), [autoForceScroll, autoPause, autoMarkAuto, pinToBottom, virtualizer, visibleMessages])

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
            style={{
              overflowAnchor: 'none',
              paddingTop: 'calc(5rem + var(--app-safe-top, 0px))',
            }}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onScroll={onScroll}
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
          </div>
        </div>
      )
    },
  ),
)
