import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeBlock } from './CodeBlock'

const useIsMobileMock = vi.fn(() => false)
const useSyntaxHighlightMock = vi.fn((_code: string, _options: unknown) => ({
  output: '<pre><code>highlighted</code></pre>',
}))
const themeSnapshot = { codeWordWrap: false }

vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => useIsMobileMock(),
}))

vi.mock('../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: (code: string, options: unknown) => useSyntaxHighlightMock(code, options),
}))

vi.mock('../hooks/useInView', () => ({
  useInView: () => ({ ref: vi.fn(), inView: false }),
}))

vi.mock('../store/themeStore', () => ({
  themeStore: {
    subscribe: () => () => {},
    getSnapshot: () => themeSnapshot,
  },
}))

vi.mock('./ui', () => ({
  CopyButton: ({ className }: { className?: string }) => (
    <button aria-label="Copy to clipboard" className={className}>
      copy
    </button>
  ),
}))

describe('CodeBlock', () => {
  beforeEach(() => {
    useIsMobileMock.mockReset()
    useIsMobileMock.mockReturnValue(false)
    useSyntaxHighlightMock.mockClear()
    useSyntaxHighlightMock.mockReturnValue({ output: '<pre><code>highlighted</code></pre>' })
  })

  it('requires tap-to-reveal copy button for unlabeled mobile code blocks', () => {
    useIsMobileMock.mockReturnValue(true)

    const { container } = render(<CodeBlock code="const value = 1" />)

    expect(container.firstChild).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', { name: 'Copy to clipboard' }).parentElement?.className).toContain(
      '[@media(hover:none)]:opacity-0',
    )
  })

  it('keeps labeled mobile code blocks unchanged', () => {
    useIsMobileMock.mockReturnValue(true)

    const { container } = render(<CodeBlock code="const value = 1" language="ts" />)

    expect(container.firstChild).not.toHaveAttribute('tabindex')
    expect(screen.getByText('ts')).toBeInTheDocument()
  })

  it('renders current plain code while highlight is deferred', () => {
    render(<CodeBlock code="const value = 1" language="ts" deferHighlight />)

    expect(screen.getByText('const value = 1')).toBeInTheDocument()
    expect(screen.queryByText('highlighted')).not.toBeInTheDocument()
    expect(useSyntaxHighlightMock).toHaveBeenCalledWith(
      'const value = 1',
      expect.objectContaining({ enabled: false, lang: 'ts' }),
    )
  })
})
