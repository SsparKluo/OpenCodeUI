/**
 * useScrollGestureDetector — React adapter around `scrollGesture` pure functions.
 *
 * Encapsulates the opencode-style gesture lifecycle:
 * - Wheel: normalize deltaMode, run `markBoundaryGesture` (nested scroller opt-out).
 * - Touch: track Y on touchstart, compute delta on touchmove, mark on touchend.
 *   Mirrors opencode's `handleListTouchStart` / `handleListTouchMove` / `handleListTouchEnd`.
 * - Pointer: only count when target is the scroll root (scrollbar thumb drag).
 * - Keyboard: mark on PageUp/PageDown/Home/End so virtualizer-driven scroll
 *   events after a key press are correctly attributed to a user gesture.
 *
 * The hook stores a single `lastGestureAt` timestamp. Consumers query
 * `hasGesture()` to gate scroll-event handling (mirrors opencode's `hasScrollGesture`
 * / `ui.scrollGesture` + `scrollGestureWindowMs`).
 *
 * The window length matches opencode's `scrollGestureWindowMs = 250`.
 */

import { useCallback, useRef } from 'react'
import { markBoundaryGesture, markPointerGesture, normalizeWheelDelta } from './scrollGesture'

const SCROLL_GESTURE_WINDOW_MS = 250

export interface ScrollGestureDetector {
  /** Pass to the scroll root's onWheel. */
  onWheel: (event: { deltaY: number; deltaMode: number; target: EventTarget | null }) => void
  /** Pass to the scroll root's onPointerDown. */
  onPointerDown: (event: { target: EventTarget | null }) => void
  /** Pass to the scroll root's onTouchStart. */
  onTouchStart: (event: { touches: ArrayLike<{ clientY: number }> }) => void
  /** Pass to the scroll root's onTouchMove. */
  onTouchMove: (event: { touches: ArrayLike<{ clientY: number }>; target: EventTarget | null }) => void
  /** Pass to the scroll root's onTouchEnd. */
  onTouchEnd: () => void
  /** Pass to the scroll root's (or a global) onKeyDown. */
  onKeyDown: (event: { key: string }) => void
  /** True if a recent gesture (within SCROLL_GESTURE_WINDOW_MS) was marked. */
  hasGesture: () => boolean
  /** Mark a gesture explicitly (used by external listeners like load-more). */
  markGesture: () => void
  /** Ref callback to set the scroll root element. Required before handlers fire. */
  setRoot: (el: HTMLElement | null) => void
}

export function useScrollGestureDetector(): ScrollGestureDetector {
  const rootRef = useRef<HTMLElement | null>(null)
  const touchYRef = useRef<number | undefined>(undefined)
  // Initial value is far enough in the past that `hasGesture()` returns false
  // before any user interaction. Number.NEGATIVE_INFINITY is a defensive choice:
  // it works even with monotonic time sources and never collides with Date.now().
  const lastGestureAtRef = useRef<number>(Number.NEGATIVE_INFINITY)

  const setRoot = useCallback((el: HTMLElement | null) => {
    rootRef.current = el
  }, [])

  const markGesture = useCallback(() => {
    lastGestureAtRef.current = Date.now()
  }, [])

  const hasGesture = useCallback(() => {
    return Date.now() - lastGestureAtRef.current < SCROLL_GESTURE_WINDOW_MS
  }, [])

  // Wheel — normalize delta, run boundary check against the resolved target.
  // The handler is stable across renders because all state lives in refs.
  const onWheel = useCallback(
    (event: { deltaY: number; deltaMode: number; target: EventTarget | null }) => {
      const root = rootRef.current
      if (!root) return
      const delta = normalizeWheelDelta({
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        rootHeight: root.clientHeight,
      })
      if (!delta) return
      markBoundaryGesture({
        root,
        target: event.target,
        delta,
        onMarkScrollGesture: markGesture,
      })
    },
    [markGesture],
  )

  // Pointer — scrollbar thumb drag, only when target IS the root.
  const onPointerDown = useCallback(
    (event: { target: EventTarget | null }) => {
      const root = rootRef.current
      if (!root) return
      markPointerGesture({ root, target: event.target, onMarkScrollGesture: markGesture })
    },
    [markGesture],
  )

  // Touch — track Y on start, propagate delta through boundary check on move.
  const onTouchStart = useCallback((event: { touches: ArrayLike<{ clientY: number }> }) => {
    touchYRef.current = event.touches[0]?.clientY
  }, [])

  const onTouchMove = useCallback(
    (event: { touches: ArrayLike<{ clientY: number }>; target: EventTarget | null }) => {
      const root = rootRef.current
      if (!root) return
      const next = event.touches[0]?.clientY
      const prev = touchYRef.current
      touchYRef.current = next
      if (next === undefined || prev === undefined) return
      // ClientY delta: finger moves up (lower Y) means scroll down (positive
      // delta). Matches opencode's `prev - next` math.
      const delta = prev - next
      if (!delta) return
      markBoundaryGesture({
        root,
        target: event.target,
        delta,
        onMarkScrollGesture: markGesture,
      })
    },
    [markGesture],
  )

  const onTouchEnd = useCallback(() => {
    touchYRef.current = undefined
  }, [])

  // Keyboard — PageUp/PageDown/Home/End.
  // Mirrors opencode's session.tsx `if (event.key === 'PageUp' || ... 'End') markScrollGesture()`.
  const onKeyDown = useCallback(
    (event: { key: string }) => {
      if (
        event.key === 'PageUp' ||
        event.key === 'PageDown' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        markGesture()
      }
    },
    [markGesture],
  )

  return {
    onWheel,
    onPointerDown,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onKeyDown,
    hasGesture,
    markGesture,
    setRoot,
  }
}

/** Window length used by `useScrollGestureDetector`. Exposed for tests. */
export const SCROLL_GESTURE_DETECTOR_WINDOW_MS = SCROLL_GESTURE_WINDOW_MS
