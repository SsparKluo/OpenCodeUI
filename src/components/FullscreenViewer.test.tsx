import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FullscreenViewer } from './FullscreenViewer'

vi.mock('./DiffViewer', () => ({
  DiffViewer: () => <div data-testid="diff-viewer">diff viewer</div>,
  extractContentFromUnifiedDiff: () => ({ before: 'before', after: 'after' }),
  ViewModeSwitch: () => null,
}))

vi.mock('./CodePreview', () => ({
  CodePreview: ({ code }: { code: string }) => <div data-testid="code-preview">{code}</div>,
}))

describe('FullscreenViewer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      return window.setTimeout(() => cb(performance.now()), 0)
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps viewer mounted during exit animation for code mode', () => {
    const { rerender } = render(
      <FullscreenViewer isOpen={true} onClose={vi.fn()} mode="code" content={'line 1\nline 2'} filePath="src/app.ts" />,
    )

    act(() => {
      vi.runAllTimers()
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('app.ts')).toBeInTheDocument()
    expect(screen.getByTestId('code-preview')).toBeInTheDocument()

    rerender(
      <FullscreenViewer
        isOpen={false}
        onClose={vi.fn()}
        mode="code"
        content={'line 1\nline 2'}
        filePath="src/app.ts"
      />,
    )

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
