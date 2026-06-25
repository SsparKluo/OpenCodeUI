/**
 * useAutoScroll — React port of OpenCode's `createAutoScroll` (SolidJS).
 *
 * The scroll container uses a single direction convention:
 * - `reverse: false` (default) — normal flow. `scrollTop = 0` is the top of the
 *   scrollable content; the "at bottom" position is `scrollHeight - clientHeight`.
 *   This is what plain `<div>` flex/grid children produce.
 * - `reverse: true` — the container renders children in `flex-col-reverse` (or
 *   similar). `scrollTop = 0` is the visual bottom; scrolling up produces a
 *   negative `scrollTop`. The "at bottom" position is `scrollTop = 0`.
 *   This is what OpenCodeUI's ChatArea uses.
 *
 * Public API mirrors OpenCode's `createAutoScroll`:
 * - `scrollRef` / `contentRef` — ref setters
 * - `handleScroll` — pass to the scroll container's `onScroll`
 * - `handleInteraction` — pass to the content wrapper's `onClick` (catches the
 *   "user is selecting text while stream is active" case)
 * - `pause()` — mark user-scrolled, stop following
 * - `resume()` — clear user-scrolled, snap to bottom
 * - `scrollToBottom()` — soft (gated by userScrolled)
 * - `forceScrollToBottom()` — hard (always)
 * - `userScrolled` — boolean state for reactive consumers
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface UseAutoScrollOptions {
  /** Whether the content is actively growing (e.g. assistant is streaming). */
  working: boolean
  /** Fired when the user explicitly leaves "follow bottom" mode. */
  onUserInteracted?: () => void
  /** CSS overflow-anchor mode. Defaults to "dynamic" (auto when following, none when user-scrolled). */
  overflowAnchor?: 'none' | 'auto' | 'dynamic'
  /** Pixel threshold for "is at the bottom". Defaults to 10. */
  bottomThreshold?: number
  /**
   * True when the scroll container lays out content in reverse (e.g.
   * `flex-col-reverse`), so `scrollTop = 0` is the visual bottom. Defaults to
   * false to match OpenCode's normal-flow convention; OpenCodeUI's ChatArea
   * sets this to true.
   */
  reverse?: boolean
}

interface AutoMarker {
  /** The `scrollTop` value that corresponds to the "at bottom" position. */
  top: number
  /** Timestamp the marker was set (used to age it out). */
  time: number
}

const AUTO_MARK_TIMEOUT_MS = 1500
const SETTLE_TIMEOUT_MS = 300

export interface UseAutoScrollReturn {
  scrollRef: (el: HTMLElement | null) => void
  contentRef: (el: HTMLElement | null) => void
  handleScroll: () => void
  handleInteraction: () => void
  pause: () => void
  resume: () => void
  scrollToBottom: () => void
  forceScrollToBottom: () => void
  userScrolled: boolean
}

export function useAutoScroll(options: UseAutoScrollOptions): UseAutoScrollReturn {
  const { working, onUserInteracted, overflowAnchor = 'dynamic', bottomThreshold = 10, reverse = false } = options

  // State-backed refs: when these change, all dependent effects re-attach.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null)

  // Refs that are read inside event listeners / callbacks. They need to point
  // at the *current* element, not the one captured at callback creation time.
  // Mirrored via a layout effect (see below) so the ref is up to date before
  // any listener fires.
  const scrollElRef = useRef<HTMLElement | null>(null)
  const contentElRef = useRef<HTMLElement | null>(null)

  // Internal state for the auto-follow logic.
  const userScrolledRef = useRef(false)
  const autoRef = useRef<AutoMarker | undefined>(undefined)
  const settlingRef = useRef(false)
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mirror `userScrolled` to React state so consumers can re-render on change.
  const [userScrolled, setUserScrolledState] = useState(false)

  // `working`, `reverse`, and `bottomThreshold` are read inside event
  // listeners — keep refs so the callbacks always see the latest value
  // without re-binding. Mirrored via layout effect below.
  const workingRef = useRef(working)
  const reverseRef = useRef(reverse)
  const bottomThresholdRef = useRef(bottomThreshold)

  const setUserScrolled = useCallback((next: boolean) => {
    if (userScrolledRef.current === next) return
    userScrolledRef.current = next
    setUserScrolledState(next)
  }, [])

  // Mirror state into refs so event listeners can read the latest values
  // without re-binding. Layout effect runs after render, before paint, so
  // any wheel/scroll event in the next frame sees the up-to-date ref.
  useLayoutEffect(() => {
    scrollElRef.current = scrollEl
  }, [scrollEl])
  useLayoutEffect(() => {
    contentElRef.current = contentEl
  }, [contentEl])
  useLayoutEffect(() => {
    workingRef.current = working
  }, [working])
  useLayoutEffect(() => {
    reverseRef.current = reverse
  }, [reverse])
  useLayoutEffect(() => {
    bottomThresholdRef.current = bottomThreshold
  }, [bottomThreshold])

  // ============================================================
  // Helpers — distance / canScroll / at-bottom position.
  // Read `reverse` from a ref so the callbacks that wrap these stay stable.
  // ============================================================
  const distanceFromBottom = (el: HTMLElement): number => {
    if (reverseRef.current) {
      return Math.abs(el.scrollTop)
    }
    return el.scrollHeight - el.clientHeight - el.scrollTop
  }

  const canScroll = (el: HTMLElement): boolean => {
    return el.scrollHeight - el.clientHeight > 1
  }

  // The `scrollTop` value that means "at the bottom". In normal flow this is
  // the max scroll position; in reverse flow it is 0.
  const bottomScrollTop = (el: HTMLElement): number => {
    if (reverseRef.current) return 0
    return Math.max(0, el.scrollHeight - el.clientHeight)
  }

  // ============================================================
  // Auto-marker — distinguish our own scrollTo from user gestures
  // ============================================================
  const clearAutoTimer = () => {
    if (autoTimerRef.current !== null) {
      clearTimeout(autoTimerRef.current)
      autoTimerRef.current = null
    }
  }

  const markAuto = (el: HTMLElement) => {
    autoRef.current = {
      top: bottomScrollTop(el),
      time: Date.now(),
    }
    clearAutoTimer()
    autoTimerRef.current = setTimeout(() => {
      autoRef.current = undefined
      autoTimerRef.current = null
    }, AUTO_MARK_TIMEOUT_MS)
  }

  const isAuto = (el: HTMLElement): boolean => {
    const a = autoRef.current
    if (!a) return false
    if (Date.now() - a.time > AUTO_MARK_TIMEOUT_MS) {
      autoRef.current = undefined
      return false
    }
    return Math.abs(el.scrollTop - a.top) < 2
  }

  // ============================================================
  // Scroll-to-bottom
  // ============================================================
  // `markAuto` reads only refs, so the callback identity is stable across
  // renders — no need to include it in the deps.
  const scrollToBottomNow = useCallback((behavior: ScrollBehavior) => {
    const el = scrollElRef.current
    if (!el) return
    markAuto(el)
    if (reverseRef.current) {
      // For `flex-col-reverse` containers, "at bottom" is scrollTop = 0.
      // `scrollTo({ top: 0, behavior: 'smooth' })` respects smooth behavior;
      // `scrollTop = 0` bypasses CSS `scroll-behavior: smooth`.
      if (behavior === 'smooth') {
        el.scrollTo({ top: 0, behavior })
      } else {
        el.scrollTop = 0
      }
      return
    }
    if (behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior })
    } else {
      el.scrollTop = el.scrollHeight
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const active = (): boolean => workingRef.current || settlingRef.current

  const scrollToBottom = useCallback(
    (force: boolean) => {
      if (force && userScrolledRef.current) setUserScrolled(false)

      const el = scrollElRef.current
      if (!el) return

      if (!force && userScrolledRef.current) return

      const distance = distanceFromBottom(el)
      if (distance < 2) {
        markAuto(el)
        return
      }

      // For auto-following content we prefer immediate updates to avoid
      // visible "catch up" animations while content is still settling.
      scrollToBottomNow('auto')
    },
    // `markAuto` reads only refs — identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrollToBottomNow, setUserScrolled],
  )

  // ============================================================
  // stop() / handleWheel — user has explicitly left "follow bottom"
  // ============================================================
  const stop = useCallback(() => {
    const el = scrollElRef.current
    if (!el) return
    if (!canScroll(el)) {
      if (userScrolledRef.current) setUserScrolled(false)
      return
    }
    if (userScrolledRef.current) return

    setUserScrolled(true)
    onUserInteracted?.()
  }, [onUserInteracted, setUserScrolled])

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Only "up" gestures (toward earlier content) can leave follow mode;
      // downward gestures are part of normal following and may be produced by
      // overscroll, momentum, etc.
      if (e.deltaY >= 0) return
      const el = scrollElRef.current
      const target = e.target instanceof Element ? e.target : undefined
      // Nested scrollable regions (tool output, code block) opt out via
      // `data-scrollable`. If the wheel started inside one of them, don't
      // treat it as leaving the main scroll's follow mode.
      const nested = target?.closest('[data-scrollable]')
      if (el && nested && nested !== el) return
      stop()
    },
    [stop],
  )

  // ============================================================
  // handleScroll — update userScrolled from current scroll position
  // ============================================================
  const clearSnapTimer = useCallback(() => {
    if (snapTimerRef.current !== null) {
      clearTimeout(snapTimerRef.current)
      snapTimerRef.current = null
    }
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollElRef.current
    if (!el) return

    if (!canScroll(el)) {
      if (userScrolledRef.current) setUserScrolled(false)
      return
    }

    if (distanceFromBottom(el) < bottomThresholdRef.current) {
      if (userScrolledRef.current) setUserScrolled(false)
      // Deferred snap: once the user stops scrolling within the snap zone,
      // smoothly scroll to the very bottom so latest content is fully visible.
      if (snapTimerRef.current === null) {
        snapTimerRef.current = setTimeout(() => {
          snapTimerRef.current = null
          const current = scrollElRef.current
          if (!current || userScrolledRef.current) return
          if (distanceFromBottom(current) < bottomThresholdRef.current) {
            scrollToBottomNow('smooth')
          }
        }, 150)
      }
      return
    }

    // User scrolled outside the snap zone → cancel pending snap
    clearSnapTimer()

    // Ignore scroll events triggered by our own scrollToBottom calls — they
    // can fire asynchronously after new content has been inserted, which
    // would otherwise look like a user scroll.
    if (!userScrolledRef.current && isAuto(el)) {
      scrollToBottom(false)
      return
    }

    stop()
  }, [scrollToBottom, setUserScrolled, stop, scrollToBottomNow, clearSnapTimer])

  // ============================================================
  // handleInteraction — user is interacting with the content (text
  // selection during a live stream = they want to stop following)
  // ============================================================
  const handleInteraction = useCallback(() => {
    if (!active()) return
    const selection = typeof window !== 'undefined' ? window.getSelection() : null
    if (selection && selection.toString().length > 0) {
      stop()
    }
  }, [stop])

  // ============================================================
  // overflowAnchor management
  // ============================================================
  const updateOverflowAnchor = useCallback(
    (el: HTMLElement) => {
      if (overflowAnchor === 'none') {
        el.style.overflowAnchor = 'none'
        return
      }
      if (overflowAnchor === 'auto') {
        el.style.overflowAnchor = 'auto'
        return
      }
      // 'dynamic' — anchor disabled while following, enabled when user has
      // scrolled away (so their viewport doesn't jump when content grows).
      el.style.overflowAnchor = userScrolledRef.current ? 'auto' : 'none'
    },
    [overflowAnchor],
  )

  // ============================================================
  // Ref setters
  // ============================================================
  const setScrollRef = useCallback(
    (el: HTMLElement | null) => {
      setScrollEl(el)
      if (el) updateOverflowAnchor(el)
    },
    [updateOverflowAnchor],
  )

  const setContentRef = useCallback((el: HTMLElement | null) => {
    setContentEl(el)
  }, [])

  // ============================================================
  // ResizeObserver on content — keep the bottom locked in view.
  // Fires on every content height change (streaming, block expansion,
  // tool results rendering). Only gated by userScrolled — we always
  // follow when the user hasn't explicitly scrolled away.
  // ============================================================
  useEffect(() => {
    if (!contentEl || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      const scrollElLocal = scrollElRef.current
      if (scrollElLocal && !canScroll(scrollElLocal)) {
        if (userScrolledRef.current) setUserScrolled(false)
        return
      }
      if (userScrolledRef.current) return
      scrollToBottom(false)
    })
    observer.observe(contentEl)
    return () => observer.disconnect()
  }, [contentEl, scrollToBottom, setUserScrolled])

  // ============================================================
  // working edge — start/clear the settle window
  // ============================================================
  useLayoutEffect(() => {
    settlingRef.current = false
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }

    if (working) {
      // Stream just started — snap to bottom (force=true) so we don't
      // appear stuck at an old scroll position.
      if (!userScrolledRef.current) scrollToBottom(true)
      return
    }

    // Stream just stopped — give the layout 300ms to settle (final tokens
    // can land a few frames later) before pausing follow mode.
    settlingRef.current = true
    settleTimerRef.current = setTimeout(() => {
      settlingRef.current = false
      settleTimerRef.current = null
    }, SETTLE_TIMEOUT_MS)
  }, [working, scrollToBottom])

  // ============================================================
  // userScrolled → update overflow-anchor on the scroll element
  // ============================================================
  useLayoutEffect(() => {
    if (!scrollEl) return
    updateOverflowAnchor(scrollEl)
  }, [userScrolled, scrollEl, updateOverflowAnchor])

  // ============================================================
  // wheel listener — attached imperatively so it doesn't re-bind on
  // every render. Re-attaches when the scroll element changes.
  // ============================================================
  useEffect(() => {
    if (!scrollEl) return
    scrollEl.addEventListener('wheel', handleWheel, { passive: true })
    return () => scrollEl.removeEventListener('wheel', handleWheel)
  }, [scrollEl, handleWheel])

  // ============================================================
  // Cleanup timers on unmount.
  // ============================================================
  useEffect(() => {
    return () => {
      if (snapTimerRef.current !== null) clearTimeout(snapTimerRef.current)
      if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current)
      if (autoTimerRef.current !== null) clearTimeout(autoTimerRef.current)
    }
  }, [])

  return {
    scrollRef: setScrollRef,
    contentRef: setContentRef,
    handleScroll,
    handleInteraction,
    pause: stop,
    resume: () => {
      if (userScrolledRef.current) setUserScrolled(false)
      scrollToBottom(true)
    },
    scrollToBottom: () => scrollToBottom(false),
    forceScrollToBottom: () => scrollToBottom(true),
    userScrolled,
  }
}
