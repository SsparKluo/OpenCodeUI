/**
 * Tests for useScrollGestureDetector.
 *
 * Strategy: render the hook in a minimal test harness, drive the returned
 * handlers with synthetic event shapes, and assert on the internal
 * `hasGesture()` window.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SCROLL_GESTURE_DETECTOR_WINDOW_MS,
  useScrollGestureDetector,
} from './useScrollGestureDetector'

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

interface MountResult {
  result: ReturnType<typeof renderHook<ReturnType<typeof useScrollGestureDetector>, unknown>>['result']
  root: HTMLDivElement
}

function mountDetectorWithRoot(scrollHeight: number, scrollTop: number): MountResult {
  const { result } = renderHook(() => useScrollGestureDetector())
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 300 })
  el.scrollTop = scrollTop
  document.body.appendChild(el)
  act(() => result.current.setRoot(el))
  return { result, root: el }
}

function mountDetector(): MountResult {
  return mountDetectorWithRoot(1000, 100)
}

describe('useScrollGestureDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(0))
  })

  it('hasGesture() is false initially', () => {
    const { result } = mountDetector()
    expect(result.current.hasGesture()).toBe(false)
  })

  it('explicit markGesture() makes hasGesture() return true', () => {
    const { result } = mountDetector()
    act(() => result.current.markGesture())
    expect(result.current.hasGesture()).toBe(true)
  })

  it('gesture window expires after SCROLL_GESTURE_DETECTOR_WINDOW_MS', () => {
    const { result } = mountDetector()
    act(() => result.current.markGesture())
    expect(result.current.hasGesture()).toBe(true)
    act(() => vi.advanceTimersByTime(SCROLL_GESTURE_DETECTOR_WINDOW_MS + 1))
    expect(result.current.hasGesture()).toBe(false)
  })

  it('onPointerDown marks gesture when target is the root', () => {
    const { result, root } = mountDetector()
    act(() => result.current.onPointerDown({ target: root }))
    expect(result.current.hasGesture()).toBe(true)
  })

  it('onPointerDown does NOT mark gesture when target is a child', () => {
    const { result, root } = mountDetector()
    const child = document.createElement('div')
    root.appendChild(child)
    act(() => result.current.onPointerDown({ target: child }))
    expect(result.current.hasGesture()).toBe(false)
  })

  it('onKeyDown marks gesture on PageUp/PageDown/Home/End', () => {
    for (const key of ['PageUp', 'PageDown', 'Home', 'End']) {
      const { result } = mountDetector()
      act(() => result.current.onKeyDown({ key }))
      expect(result.current.hasGesture(), `key=${key}`).toBe(true)
    }
  })

  it('onKeyDown ignores other keys', () => {
    for (const key of ['a', 'Enter', 'ArrowDown', 'Tab']) {
      const { result } = mountDetector()
      act(() => result.current.onKeyDown({ key }))
      expect(result.current.hasGesture(), `key=${key}`).toBe(false)
    }
  })

  it('onWheel marks gesture when target is root and delta is non-zero', () => {
    // Use a root at max scroll so the downward gesture hits the bottom boundary.
    const { result, root } = mountDetectorWithRoot(1000, 700)
    act(() =>
      result.current.onWheel({
        deltaY: 50,
        deltaMode: 0,
        target: root,
      }),
    )
    expect(result.current.hasGesture()).toBe(true)
  })

  it('onWheel does NOT mark when delta is 0', () => {
    const { result, root } = mountDetector()
    act(() =>
      result.current.onWheel({
        deltaY: 0,
        deltaMode: 0,
        target: root,
      }),
    )
    expect(result.current.hasGesture()).toBe(false)
  })

  it('onWheel normalizes deltaMode=1 (line) for downstream consumers', () => {
    // rootHeight=300, max=700, scrollTop=100, deltaY=3, deltaMode=1 → 120px.
    // Wheel directly on root → markBoundaryGesture marks unconditionally.
    // (The normalization is verified separately in scrollGesture.test.ts.)
    const { result, root } = mountDetectorWithRoot(1000, 100)
    act(() =>
      result.current.onWheel({
        deltaY: 3,
        deltaMode: 1,
        target: root,
      }),
    )
    expect(result.current.hasGesture()).toBe(true)
  })

  it('onWheel marks when normalized delta exceeds remaining scroll', () => {
    // Root at scrollTop=695 (max=700), 50px down → exceeds remaining 5 → boundary.
    const { result, root } = mountDetectorWithRoot(1000, 695)
    act(() =>
      result.current.onWheel({
        deltaY: 50,
        deltaMode: 0,
        target: root,
      }),
    )
    expect(result.current.hasGesture()).toBe(true)
  })

  it('onWheel respects data-scrollable nested boundary opt-out', () => {
    // Root has room (max=700, scrollTop=100). Nested scroller with max=1800,
    // scrollTop=500 → 10px upward would land at 490, well above 0 → no boundary.
    const { result, root } = mountDetectorWithRoot(1000, 100)
    const nested = document.createElement('div')
    Object.defineProperty(nested, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(nested, 'clientHeight', { configurable: true, value: 200 })
    nested.setAttribute('data-scrollable', '')
    nested.scrollTop = 500
    root.appendChild(nested)
    const deep = document.createElement('span')
    nested.appendChild(deep)

    act(() =>
      result.current.onWheel({
        deltaY: -10,
        deltaMode: 0,
        target: deep,
      }),
    )
    expect(result.current.hasGesture()).toBe(false)
  })

  it('onTouchStart records Y; onTouchMove computes delta and runs boundary check', () => {
    // Finger drag: clientY 500 → 480 (drag down 20px → scroll up 20).
    // Touch on root → markBoundaryGesture marks unconditionally.
    // The nested boundary opt-out is verified in the dedicated test below.
    const { result, root } = mountDetector()
    act(() => result.current.onTouchStart({ touches: [{ clientY: 500 }] }))
    act(() => result.current.onTouchMove({ touches: [{ clientY: 480 }], target: root }))
    expect(result.current.hasGesture()).toBe(true)
  })

  it('onTouchMove marks when finger drags up at the top boundary', () => {
    // Root at scrollTop=0; finger drags up (500 → 520) → delta = -20, boundary hit.
    const { result, root } = mountDetectorWithRoot(1000, 0)
    act(() => result.current.onTouchStart({ touches: [{ clientY: 500 }] }))
    act(() => result.current.onTouchMove({ touches: [{ clientY: 520 }], target: root }))
    expect(result.current.hasGesture()).toBe(true)
  })

  it('onTouchMove respects data-scrollable nested boundary opt-out', () => {
    // Nested scroller with max=1800, scrollTop=500 → finger up (delta=-10) lands
    // at 490, well above 0 → no boundary → no gesture on root.
    const { result, root } = mountDetectorWithRoot(1000, 100)
    const nested = document.createElement('div')
    Object.defineProperty(nested, 'scrollHeight', { configurable: true, value: 2000 })
    Object.defineProperty(nested, 'clientHeight', { configurable: true, value: 200 })
    nested.setAttribute('data-scrollable', '')
    nested.scrollTop = 500
    root.appendChild(nested)
    const deep = document.createElement('span')
    nested.appendChild(deep)

    act(() => result.current.onTouchStart({ touches: [{ clientY: 500 }] }))
    act(() => result.current.onTouchMove({ touches: [{ clientY: 510 }], target: deep }))
    // delta = 500 - 510 = -10, nested at 500, would land at 490, no boundary
    expect(result.current.hasGesture()).toBe(false)
  })

  it('onTouchEnd clears the Y tracker', () => {
    const { result } = mountDetector()
    act(() => result.current.onTouchStart({ touches: [{ clientY: 100 }] }))
    act(() => result.current.onTouchEnd())
    act(() => result.current.onTouchMove({ touches: [{ clientY: 200 }], target: null }))
    // After touchend, no prev Y → no gesture
    expect(result.current.hasGesture()).toBe(false)
  })

  it('onWheel is a no-op when setRoot has not been called', () => {
    const { result } = renderHook(() => useScrollGestureDetector())
    act(() => result.current.onWheel({ deltaY: 100, deltaMode: 0, target: null }))
    expect(result.current.hasGesture()).toBe(false)
  })
})
