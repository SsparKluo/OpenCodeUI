import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CodePreview } from './CodePreview'

const { copyTextToClipboardMock } = vi.hoisted(() => ({
  copyTextToClipboardMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../utils/clipboard', async importOriginal => {
  const actual = await importOriginal<typeof import('../utils/clipboard')>()
  return {
    ...actual,
    copyTextToClipboard: copyTextToClipboardMock,
  }
})

vi.mock('../store/themeStore', () => ({
  themeStore: {
    subscribe: () => () => {},
    getSnapshot: () => mockThemeSnapshot,
  },
}))

vi.mock('../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlightRef: () => ({
    tokensRef: { current: null },
    version: 0,
  }),
}))

const mockThemeSnapshot = {
  codeWordWrap: false,
  codeFontScale: 0,
}

describe('CodePreview', () => {
  beforeEach(() => {
    copyTextToClipboardMock.mockClear()
  })

  it('renders code through CodeMirror with line numbers', () => {
    const { container } = render(<CodePreview code={'first line\nsecond line'} language="text" />)

    expect(screen.getByText('first line')).toBeInTheDocument()
    expect(screen.getByText('second line')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(container.querySelector('.cm-editor')).toBeInTheDocument()
  })

  it('keeps the editor focusable while read-only', () => {
    const { container } = render(
      <CodePreview code={'const someRidiculouslyLongIdentifierName = "value"\nsecond line'} language="text" />,
    )

    expect(container.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'true')
  })

  it('opens CodeMirror search from the preview Ctrl+F fallback', () => {
    const { container } = render(<CodePreview code={'first line\nsecond line'} language="text" />)

    const cmWrapper = container.querySelector('.cm-editor')?.parentElement
    if (!cmWrapper) throw new Error('CodeMirror wrapper not found')
    fireEvent.keyDown(cmWrapper, { key: 'f', ctrlKey: true })

    expect(screen.getByPlaceholderText('Find')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Match case' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use regular expression' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Match whole word' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
    expect(screen.getByText('No results')).toBeInTheDocument()
  })

  it('exposes a copy button that copies the code on click', async () => {
    const code = 'const value = 42'
    render(<CodePreview code={code} language="ts" />)

    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' })
    expect(copyButton).toBeInTheDocument()

    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledWith(code)
    })
  })
})
