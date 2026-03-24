import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MultiFileDiffModal } from './MultiFileDiffModal'

vi.mock('../api/session', () => ({
  getSessionDiff: vi.fn().mockResolvedValue([
    {
      file: 'src/app.ts',
      before: 'const a = 1',
      after: 'const a = 2',
      additions: 1,
      deletions: 1,
    },
  ]),
}))

vi.mock('./DiffViewer', () => ({
  DiffViewer: () => <div data-testid="diff-viewer">diff viewer</div>,
}))

vi.mock('./FullscreenViewer', async importOriginal => {
  const actual = await importOriginal<typeof import('./FullscreenViewer')>()
  return {
    ...actual,
    ViewModeSwitch: () => <div data-testid="view-mode-switch">switch</div>,
  }
})

describe('MultiFileDiffModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb =>
      window.setTimeout(() => cb(performance.now()), 0),
    )
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      clearTimeout(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('loads diffs and unmounts after close transition', async () => {
    const { rerender } = render(<MultiFileDiffModal isOpen={true} onClose={vi.fn()} sessionId="session-1" />)

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Session Changes')).toBeInTheDocument()
    expect(screen.getByText('app.ts')).toBeInTheDocument()
    expect(screen.getByTestId('diff-viewer')).toBeInTheDocument()

    rerender(<MultiFileDiffModal isOpen={false} onClose={vi.fn()} sessionId="session-1" />)

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
