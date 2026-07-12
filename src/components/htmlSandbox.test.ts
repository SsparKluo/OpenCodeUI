import { describe, expect, it } from 'vitest'
import {
  createHtmlSandboxMeasureScript,
  HTML_SANDBOX_EDGE_OVERFLOW_TOLERANCE,
  normalizeHtmlSandboxContentWidth,
} from './htmlSandbox'

describe('HTML sandbox measurement', () => {
  it('ignores tiny edge overflow from responsive content borders and rounding', () => {
    expect(normalizeHtmlSandboxContentWidth(601, 600)).toBe(600)
    expect(normalizeHtmlSandboxContentWidth(602, 600)).toBe(600)
  })

  it('preserves real horizontal overflow', () => {
    expect(normalizeHtmlSandboxContentWidth(1200, 600)).toBe(1200)
    expect(normalizeHtmlSandboxContentWidth(600 + HTML_SANDBOX_EDGE_OVERFLOW_TOLERANCE + 1, 600)).toBe(603)
  })

  it('applies the same edge tolerance inside the iframe measurement bridge', () => {
    const script = createHtmlSandboxMeasureScript('preview')

    expect(script).toContain(`measuredWidth<=viewportWidth+${HTML_SANDBOX_EDGE_OVERFLOW_TOLERANCE}`)
  })
})
