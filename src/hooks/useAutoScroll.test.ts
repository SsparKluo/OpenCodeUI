import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoScroll } from './useAutoScroll'

interface FakeScrollElement extends HTMLElement {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

function createScrollElement(initial: { scrollTop?: number; scrollHeight: number; clientHeight: number }): FakeScrollElement {
  const el = document.createElement('div') as FakeScrollElement
  el.scrollTop = initial.scrollTop ?? 0
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: initial.scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: initial.clientHeight })
  return el
}

function mountAutoScroll(
  initial: Parameters<typeof createScrollElement>[0],
  options: { working?: boolean; onUserInteracted?: () => void; reverse?: boolean; bottomThreshold?: number } = {},
) {
  const scrollEl = createScrollElement(initial)
  const contentEl = document.createElement('div')
  scrollEl.appendChild(contentEl)
  document.body.appendChild(scrollEl)

  const result = renderHook(
    ({ working }: { working: boolean }) =>
      useAutoScroll({
        working,
        onUserInteracted: options.onUserInteracted,
        reverse: options.reverse ?? true,
        bottomThreshold: options.bottomThreshold,
      }),
    { initialProps: { working: options.working ?? true } },
  )

  act(() => {
    result.result.current.scrollRef(scrollEl)
    result.result.current.contentRef(contentEl)
  })

  return { ...result, scrollEl, contentEl }
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useAutoScroll (flex-col-reverse mode)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('starts at the bottom (scrollTop=0) when working turns on', () => {
    const { scrollEl, result, rerender } = mountAutoScroll(
      { scrollHeight: 1000, clientHeight: 300 },
      { working: false },
    )
    expect(result.current.userScrolled).toBe(false)
    rerender({ working: true })
    expect(scrollEl.scrollTop).toBe(0)
  })

  it('does not scroll when user has already scrolled away and stream starts', () => {
    const { scrollEl, result, rerender } = mountAutoScroll(
      { scrollHeight: 1000, clientHeight: 300 },
      { working: false },
    )
    // Simulate the user scrolled up — scrollTop becomes negative in reverse flow.
    scrollEl.scrollTop = -250
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(true)

    rerender({ working: true })
    // Auto-follow must NOT yank the user back to the bottom.
    expect(scrollEl.scrollTop).toBe(-250)
  })

  it('keeps scrollTop at 0 when content grows while following', () => {
    const { scrollEl, result } = mountAutoScroll({ scrollHeight: 500, clientHeight: 300, scrollTop: 0 })
    expect(result.current.userScrolled).toBe(false)

    // Simulate content growth pushing more height.
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 900 })
    act(() => {
      scrollEl.dispatchEvent(new Event('scroll'))
    })
    // Bottom is still 0 in reverse flow.
    expect(scrollEl.scrollTop).toBe(0)
  })

  it('marks userScrolled when the user wheels up', () => {
    const onUserInteracted = vi.fn()
    const { scrollEl, result } = mountAutoScroll(
      { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 },
      { onUserInteracted },
    )
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(true)
    expect(onUserInteracted).toHaveBeenCalledTimes(1)
  })

  it('does NOT mark userScrolled for downward wheel (overscroll / momentum)', () => {
    const { scrollEl, result } = mountAutoScroll({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(false)
  })

  it('ignores wheel events originating inside a [data-scrollable] region', () => {
    const { scrollEl, result } = mountAutoScroll({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    const nested = document.createElement('div')
    nested.setAttribute('data-scrollable', '')
    scrollEl.appendChild(nested)

    act(() => {
      nested.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(false)
  })

  it('clears userScrolled on resume() and snaps to bottom', () => {
    const { scrollEl, result } = mountAutoScroll({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    scrollEl.scrollTop = -250
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(true)

    act(() => {
      result.current.resume()
    })
    expect(result.current.userScrolled).toBe(false)
    expect(scrollEl.scrollTop).toBe(0)
  })

  it('forceScrollToBottom overrides userScrolled', () => {
    const { scrollEl, result } = mountAutoScroll({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    scrollEl.scrollTop = -250
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(true)

    act(() => {
      result.current.forceScrollToBottom()
    })
    expect(result.current.userScrolled).toBe(false)
    expect(scrollEl.scrollTop).toBe(0)
  })

  it('scrollToBottom() is a no-op when user has scrolled away', () => {
    const { scrollEl, result } = mountAutoScroll({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    scrollEl.scrollTop = -250
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(true)

    act(() => {
      result.current.scrollToBottom()
    })
    expect(scrollEl.scrollTop).toBe(-250)
  })

  it('handleScroll clears userScrolled when content shrinks below threshold', () => {
    const { scrollEl, result } = mountAutoScroll({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    scrollEl.scrollTop = -200
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(true)

    // Content shrinks so we're within the threshold again.
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 300 })
    scrollEl.scrollTop = -5
    act(() => {
      result.current.handleScroll()
    })
    expect(result.current.userScrolled).toBe(false)
  })

  it('handleInteraction stops follow when text is selected while working', () => {
    const { result } = mountAutoScroll({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    expect(result.current.userScrolled).toBe(false)

    // jsdom doesn't implement real selection, so we stub it.
    const selection = { toString: () => 'hello' }
    const original = window.getSelection
    window.getSelection = () => selection as unknown as Selection
    try {
      act(() => {
        result.current.handleInteraction()
      })
      expect(result.current.userScrolled).toBe(true)
    } finally {
      window.getSelection = original
    }
  })

  it('handleInteraction is a no-op when nothing is selected', () => {
    const { result } = mountAutoScroll({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    const selection = { toString: () => '' }
    const original = window.getSelection
    window.getSelection = () => selection as unknown as Selection
    try {
      act(() => {
        result.current.handleInteraction()
      })
      expect(result.current.userScrolled).toBe(false)
    } finally {
      window.getSelection = original
    }
  })

  it('settle window keeps follow active for 300ms after working turns off', () => {
    const { scrollEl, rerender } = mountAutoScroll(
      { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 },
      { working: true },
    )
    // working → false
    rerender({ working: false })
    // While settling, a content growth should still snap to bottom.
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1200 })
    act(() => {
      scrollEl.dispatchEvent(new Event('scroll'))
    })
    expect(scrollEl.scrollTop).toBe(0)

    // After 300ms, settle ends.
    act(() => {
      vi.advanceTimersByTime(300)
    })
    // From now on, a content growth should NOT auto-scroll.
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1500 })
    act(() => {
      scrollEl.dispatchEvent(new Event('scroll'))
    })
    // userScrolled is still false (we never moved away from bottom), so we
    // remain at scrollTop=0 — but a new incoming scroll event that pushes us
    // away should not trigger an auto-scroll back.
    expect(scrollEl.scrollTop).toBe(0)
  })

  it('overflow-anchor=dynamic applies "none" when following, "auto" when user has scrolled', () => {
    const { scrollEl, result } = mountAutoScroll({ scrollHeight: 1000, clientHeight: 300, scrollTop: 0 })
    expect(scrollEl.style.overflowAnchor).toBe('none')

    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(true)
    expect(scrollEl.style.overflowAnchor).toBe('auto')

    act(() => {
      result.current.resume()
    })
    expect(scrollEl.style.overflowAnchor).toBe('none')
  })

  it('overflow-anchor=none forces "none" regardless of state', () => {
    const scrollEl = createScrollElement({ scrollHeight: 1000, clientHeight: 300 })
    document.body.appendChild(scrollEl)

    const result = renderHook(() =>
      useAutoScroll({ working: true, overflowAnchor: 'none', reverse: true }),
    )

    act(() => {
      result.result.current.scrollRef(scrollEl)
    })
    expect(scrollEl.style.overflowAnchor).toBe('none')
  })
})

describe('useAutoScroll (normal flow mode)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('snaps to scrollHeight when working starts', () => {
    const { scrollEl, rerender } = mountAutoScroll(
      { scrollHeight: 1000, clientHeight: 300, scrollTop: 0 },
      { working: false, reverse: false },
    )
    rerender({ working: true })
    // Normal flow: bottom is scrollHeight, not 0.
    expect(scrollEl.scrollTop).toBe(1000)
  })

  it('marks userScrolled on wheel up', () => {
    const { scrollEl, result } = mountAutoScroll(
      { scrollHeight: 1000, clientHeight: 300, scrollTop: 1000 },
      { reverse: false },
    )
    scrollEl.scrollTop = 500
    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -50, bubbles: true }))
    })
    expect(result.current.userScrolled).toBe(true)
  })
})
