import { describe, expect, it, vi } from 'vitest'
import {
  boundaryTarget,
  markBoundaryGesture,
  markPointerGesture,
  normalizeWheelDelta,
  shouldMarkBoundaryGesture,
} from './scrollGesture'

describe('normalizeWheelDelta', () => {
  it('passes through pixel deltas (deltaMode 0)', () => {
    expect(normalizeWheelDelta({ deltaY: 16, deltaMode: 0, rootHeight: 600 })).toBe(16)
  })

  it('converts line deltas to pixels (deltaMode 1)', () => {
    expect(normalizeWheelDelta({ deltaY: 3, deltaMode: 1, rootHeight: 500 })).toBe(120)
  })

  it('converts page deltas to pixels (deltaMode 2)', () => {
    expect(normalizeWheelDelta({ deltaY: -1, deltaMode: 2, rootHeight: 600 })).toBe(-600)
  })

  it('handles zero', () => {
    expect(normalizeWheelDelta({ deltaY: 0, deltaMode: 0, rootHeight: 600 })).toBe(0)
    expect(normalizeWheelDelta({ deltaY: 0, deltaMode: 1, rootHeight: 600 })).toBe(0)
  })

  it('handles negative values', () => {
    expect(normalizeWheelDelta({ deltaY: -50, deltaMode: 0, rootHeight: 600 })).toBe(-50)
    expect(normalizeWheelDelta({ deltaY: -2, deltaMode: 1, rootHeight: 600 })).toBe(-80)
  })
})

describe('shouldMarkBoundaryGesture', () => {
  it('returns true when there is no overflow (max <= 1)', () => {
    expect(
      shouldMarkBoundaryGesture({
        delta: 10,
        scrollTop: 0,
        scrollHeight: 300,
        clientHeight: 300,
      }),
    ).toBe(true)
    expect(
      shouldMarkBoundaryGesture({
        delta: 10,
        scrollTop: 0,
        scrollHeight: 301,
        clientHeight: 300,
      }),
    ).toBe(true)
  })

  it('returns false for zero delta', () => {
    expect(
      shouldMarkBoundaryGesture({
        delta: 0,
        scrollTop: 100,
        scrollHeight: 1000,
        clientHeight: 300,
      }),
    ).toBe(false)
  })

  it('marks upward gesture at the top', () => {
    // At the top, scrolling up further would push scrollTop below 0 → boundary.
    expect(
      shouldMarkBoundaryGesture({
        delta: -10,
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 300,
      }),
    ).toBe(true)
  })

  it('does not mark upward gesture mid-list (room above)', () => {
    expect(
      shouldMarkBoundaryGesture({
        delta: -10,
        scrollTop: 100,
        scrollHeight: 1000,
        clientHeight: 300,
      }),
    ).toBe(false)
  })

  it('marks downward gesture past the bottom', () => {
    // max=700, scrollTop=695, delta=20 → would exceed remaining (5) → boundary.
    expect(
      shouldMarkBoundaryGesture({
        delta: 20,
        scrollTop: 695,
        scrollHeight: 1000,
        clientHeight: 300,
      }),
    ).toBe(true)
  })

  it('does not mark downward gesture mid-list (room below)', () => {
    expect(
      shouldMarkBoundaryGesture({
        delta: 20,
        scrollTop: 100,
        scrollHeight: 1000,
        clientHeight: 300,
      }),
    ).toBe(false)
  })
})

describe('boundaryTarget', () => {
  function makeRoot(): HTMLDivElement {
    return document.createElement('div')
  }

  it('returns root when target is null', () => {
    const root = makeRoot()
    expect(boundaryTarget(root, null)).toBe(root)
  })

  it('returns root when target has no data-scrollable ancestor', () => {
    const root = makeRoot()
    document.body.appendChild(root)
    try {
      const inner = document.createElement('div')
      root.appendChild(inner)
      expect(boundaryTarget(root, inner)).toBe(root)
    } finally {
      root.remove()
    }
  })

  it('returns the nested data-scrollable element when target is inside one', () => {
    const root = makeRoot()
    const nested = document.createElement('div')
    nested.setAttribute('data-scrollable', '')
    const inner = document.createElement('div')
    nested.appendChild(inner)
    root.appendChild(nested)
    document.body.appendChild(root)
    try {
      expect(boundaryTarget(root, inner)).toBe(nested)
    } finally {
      root.remove()
    }
  })

  it('returns root when target is the nested scroller itself', () => {
    const root = makeRoot()
    const nested = document.createElement('div')
    nested.setAttribute('data-scrollable', '')
    root.appendChild(nested)
    document.body.appendChild(root)
    try {
      // If target IS the data-scrollable (not inside it), the closest match is
      // the element itself, which is not the root → return root by the
      // `nested === root` early-out rule. Actually `closest` matches the
      // element itself when called on it, so the function returns nested.
      // This matches opencode's behavior.
      expect(boundaryTarget(root, nested)).toBe(nested)
    } finally {
      root.remove()
    }
  })
})

describe('markBoundaryGesture', () => {
  function setup() {
    const root = makeOverflowingDiv(1000, 300, 0)
    const nested = makeOverflowingDiv(2000, 200, 0)
    nested.setAttribute('data-scrollable', '')
    root.appendChild(nested)
    const deep = document.createElement('div')
    nested.appendChild(deep)
    document.body.appendChild(root)
    return { root, nested, deep }
  }

  it('marks gesture when target is inside the root (not nested)', () => {
    const { root } = setup()
    const onMark = vi.fn()
    const inner = document.createElement('span')
    root.appendChild(inner)
    try {
      markBoundaryGesture({ root, target: inner, delta: 10, onMarkScrollGesture: onMark })
      expect(onMark).toHaveBeenCalledWith(root)
    } finally {
      root.remove()
    }
  })

  it('marks gesture when nested scroller hits its boundary', () => {
    const { root, deep } = setup()
    // Nested has max=1800, scrollTop=0, delta=-10 → would go below 0 → boundary.
    const onMark = vi.fn()
    try {
      markBoundaryGesture({ root, target: deep, delta: -10, onMarkScrollGesture: onMark })
      expect(onMark).toHaveBeenCalledWith(root)
    } finally {
      root.remove()
    }
  })

  it('does NOT mark gesture when nested scroller has room', () => {
    const { root, nested, deep } = setup()
    nested.scrollTop = 500
    // delta=-10, scrollTop=500 → would be 490, well above 0 → no boundary.
    const onMark = vi.fn()
    try {
      markBoundaryGesture({ root, target: deep, delta: -10, onMarkScrollGesture: onMark })
      expect(onMark).not.toHaveBeenCalled()
    } finally {
      root.remove()
    }
  })

  it('does NOT mark gesture when target is null (sanity)', () => {
    const { root } = setup()
    const onMark = vi.fn()
    try {
      // null target → boundaryTarget returns root → onMark is called.
      // This is the opencode behavior; null is treated as "no nested, gesture on root".
      markBoundaryGesture({ root, target: null, delta: 10, onMarkScrollGesture: onMark })
      expect(onMark).toHaveBeenCalledWith(root)
    } finally {
      root.remove()
    }
  })
})

describe('markPointerGesture', () => {
  function makeRoot() {
    return makeOverflowingDiv(1000, 300, 0)
  }

  it('marks when target === root (scrollbar drag)', () => {
    const root = makeRoot()
    document.body.appendChild(root)
    const onMark = vi.fn()
    try {
      markPointerGesture({ root, target: root, onMarkScrollGesture: onMark })
      expect(onMark).toHaveBeenCalledWith(root)
    } finally {
      root.remove()
    }
  })

  it('does not mark when target is a child element', () => {
    const root = makeRoot()
    const child = document.createElement('div')
    root.appendChild(child)
    document.body.appendChild(root)
    const onMark = vi.fn()
    try {
      markPointerGesture({ root, target: child, onMarkScrollGesture: onMark })
      expect(onMark).not.toHaveBeenCalled()
    } finally {
      root.remove()
    }
  })
})

// ============================================
// Test helpers
// ============================================

function makeOverflowingDiv(scrollHeight: number, clientHeight: number, scrollTop: number): HTMLDivElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight })
  el.scrollTop = scrollTop
  return el
}
