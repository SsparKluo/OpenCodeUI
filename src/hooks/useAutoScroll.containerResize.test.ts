// ============================================
// Repro: ChatArea height shrinks (textarea auto-resize) while user is at bottom.
// scrollTop is left at the OLD bottom position, since contentEl's height didn't change.
// Expected: auto-scroll re-snaps to the NEW bottom.
// ============================================

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoScroll } from './useAutoScroll'

// jsdom has no real ResizeObserver. Stub one that fires synchronously whenever
// the observed element's `clientHeight`/`scrollHeight` are reassigned, so the
// effect under test can run the same code path a real browser would.
class StubResizeObserver {
  static instances: StubResizeObserver[] = []
  private callback: ResizeObserverCallback
  private observed = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    StubResizeObserver.instances.push(this)
  }

  observe(target: Element) {
    this.observed.add(target)
    this.fire(target)
  }

  unobserve(target: Element) {
    this.observed.delete(target)
  }

  disconnect() {
    this.observed.clear()
  }

  fire(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: target.getBoundingClientRect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this,
    )
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', StubResizeObserver)
})
afterEach(() => {
  vi.unstubAllGlobals()
  StubResizeObserver.instances = []
  vi.useRealTimers()
  document.body.innerHTML = ''
})

function createScrollElement(initial: { scrollTop?: number; scrollHeight: number; clientHeight: number }) {
  const el = document.createElement('div') as HTMLElement & { scrollTop: number }
  el.scrollTop = initial.scrollTop ?? 0
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: initial.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: initial.clientHeight })
  return el
}

describe('useAutoScroll — container resize while following', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('re-snaps to bottom when the scroll container shrinks (e.g. textarea grew)', () => {
    const scrollEl = createScrollElement({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
    const contentEl = document.createElement('div')
    scrollEl.appendChild(contentEl)
    document.body.appendChild(scrollEl)

    const { result } = renderHook(() =>
      useAutoScroll({ working: true, reverse: false }),
    )
    act(() => {
      result.current.scrollRef(scrollEl)
      result.current.contentRef(contentEl)
    })
    expect(result.current.userScrolled).toBe(false)
    expect(scrollEl.scrollTop).toBe(500)

    // Simulate ChatArea shrinking by 24px (textarea auto-resize, 1 → 2 lines).
    // The total scrollHeight is unchanged.
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 476 })
    StubResizeObserver.instances.forEach(obs => obs.fire(scrollEl))

    // The new bottom is at scrollHeight - clientHeight = 524.
    // The user should be re-snapped to the new bottom.
    expect(scrollEl.scrollTop).toBe(524)
  })

  it('does NOT re-snap when the user has intentionally scrolled away', () => {
    const scrollEl = createScrollElement({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
    const contentEl = document.createElement('div')
    scrollEl.appendChild(contentEl)
    document.body.appendChild(scrollEl)

    const { result } = renderHook(() =>
      useAutoScroll({ working: true, reverse: false }),
    )
    act(() => {
      result.current.scrollRef(scrollEl)
      result.current.contentRef(contentEl)
    })

    // User scrolls up on purpose.
    act(() => {
      scrollEl.scrollTop = 100
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(true)

    // ChatArea shrinks due to textarea auto-resize.
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 476 })
    StubResizeObserver.instances.forEach(obs => obs.fire(scrollEl))

    // The user stays at their chosen position.
    expect(scrollEl.scrollTop).toBe(100)
  })
})
