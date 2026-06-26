/**
 * scrollGesture — Pure functions for classifying scroll gestures.
 *
 * Ported from opencode's `packages/app/src/pages/session/message-gesture.ts` and
 * the `boundaryTarget` / `markBoundaryGesture` helpers in
 * `packages/app/src/pages/session/timeline/message-timeline.tsx`.
 *
 * Why this exists:
 * ChatArea has a scroll-root container that hosts nested scrollers (code blocks,
 * file diffs, attachment previews marked with `data-scrollable`). When the user
 * scrolls inside one of those nested regions, the outer scroll-root receives the
 * wheel/touch events too — but those events shouldn't be treated as a gesture
 * on the outer scroll, otherwise the auto-follow "stop" logic fires and the
 * user can't scroll a long code block without ChatArea leaving follow mode.
 *
 * The two-tier boundary check:
 * 1. `boundaryTarget` — find the closest `data-scrollable` ancestor. If none,
 *    the scroll root itself is the target.
 * 2. `shouldMarkBoundaryGesture` — if the target is a nested scroller, only
 *    count the gesture when that nested scroller has hit its scroll boundary
 *    (no more room in the direction the user is trying to move).
 *
 * The wheel delta is normalized across `deltaMode` values:
 * - 0: pixel (no change)
 * - 1: line × 40 (≈ Linux defaults)
 * - 2: page × rootHeight
 */

const LINE_TO_PIXEL = 40

export interface NormalizeWheelDeltaInput {
  deltaY: number
  deltaMode: number
  rootHeight: number
}

export function normalizeWheelDelta({ deltaY, deltaMode, rootHeight }: NormalizeWheelDeltaInput): number {
  if (deltaMode === 1) return deltaY * LINE_TO_PIXEL
  if (deltaMode === 2) return deltaY * rootHeight
  return deltaY
}

export interface ShouldMarkBoundaryGestureInput {
  delta: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export function shouldMarkBoundaryGesture({
  delta,
  scrollTop,
  scrollHeight,
  clientHeight,
}: ShouldMarkBoundaryGestureInput): boolean {
  const max = scrollHeight - clientHeight
  // No overflow — every scroll attempt is a "boundary" (the user is trying to
  // move but there's nothing to scroll, so the gesture propagates outward).
  if (max <= 1) return true
  if (!delta) return false

  if (delta < 0) {
    // Moving up (toward earlier content) — boundary hit when already at top.
    return scrollTop + delta <= 0
  }

  // Moving down — boundary hit when there's no room left.
  const remaining = max - scrollTop
  return delta > remaining
}

/**
 * Resolve the scrollable target of a wheel/touch event.
 *
 * Walks up from `target` to the closest `[data-scrollable]` ancestor. If the
 * event originated inside a nested scroller, returns that element. Otherwise
 * returns the scroll root itself.
 */
export function boundaryTarget(root: HTMLElement, target: EventTarget | null): HTMLElement {
  const current = target instanceof Element ? target : undefined
  const nested = current?.closest('[data-scrollable]')
  if (!nested || nested === root) return root
  if (!(nested instanceof HTMLElement)) return root
  return nested
}

export interface MarkBoundaryGestureInput {
  root: HTMLElement
  target: EventTarget | null
  delta: number
  onMarkScrollGesture: (target?: EventTarget | null) => void
}

/**
 * Mark a scroll gesture only if the target (root or nested scroller) hit a
 * boundary. Mirrors opencode's `markBoundaryGesture` exactly.
 */
export function markBoundaryGesture({
  root,
  target,
  delta,
  onMarkScrollGesture,
}: MarkBoundaryGestureInput): void {
  const resolved = boundaryTarget(root, target)
  if (resolved === root) {
    onMarkScrollGesture(root)
    return
  }
  if (
    shouldMarkBoundaryGesture({
      delta,
      scrollTop: resolved.scrollTop,
      scrollHeight: resolved.scrollHeight,
      clientHeight: resolved.clientHeight,
    })
  ) {
    onMarkScrollGesture(root)
  }
}

/**
 * Mark a scroll gesture from a pointer event (scrollbar thumb drag, etc).
 *
 * Mirrors opencode's `handleListPointerDown`: only counts when the pointer
 * landed directly on the scroll root (not inside a nested scroller). When
 * `target === root`, the user is dragging the scrollbar or empty area and
 * the gesture should propagate.
 */
export function markPointerGesture({
  root,
  target,
  onMarkScrollGesture,
}: {
  root: HTMLElement
  target: EventTarget | null
  onMarkScrollGesture: (target?: EventTarget | null) => void
}): void {
  if (target !== root) return
  onMarkScrollGesture(root)
}
