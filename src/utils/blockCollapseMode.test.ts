import { describe, expect, it } from 'vitest'
import { resolveBlockCollapseExpanded } from './blockCollapseMode'

describe('resolveBlockCollapseExpanded', () => {
  it('always_collapsed never auto-expands', () => {
    expect(resolveBlockCollapseExpanded('always_collapsed', { isLive: true, hasContent: true })).toBe(false)
  })

  it('auto_expand opens when content exists and stays open after live ends', () => {
    expect(resolveBlockCollapseExpanded('auto_expand', { isLive: false, hasContent: false })).toBe(false)
    expect(resolveBlockCollapseExpanded('auto_expand', { isLive: true, hasContent: true })).toBe(true)
    expect(resolveBlockCollapseExpanded('auto_expand', { isLive: false, hasContent: true })).toBe(true)
  })

  it('auto_toggle follows live state', () => {
    expect(resolveBlockCollapseExpanded('auto_toggle', { isLive: true, hasContent: true })).toBe(true)
    expect(resolveBlockCollapseExpanded('auto_toggle', { isLive: false, hasContent: true })).toBe(false)
    expect(resolveBlockCollapseExpanded('auto_toggle', { isLive: true, hasContent: false })).toBe(false)
  })
})