import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiffViewer } from './DiffViewer'

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

vi.mock('../store/themeStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/themeStore')>()
  const snapshot = { diffStyle: 'lineNumbers' as const, codeWordWrap: false, codeFontScale: 0 }
  return {
    ...actual,
    themeStore: {
      subscribe: () => () => {},
      getSnapshot: () => snapshot,
    },
  }
})

vi.mock('../hooks/useSyntaxHighlight', () => ({
  useSyntaxHighlight: (code: string, options?: { mode?: 'html' | 'tokens' }) => ({
    output: options?.mode === 'tokens' ? code.split('\n').map(line => [{ content: line, color: '#fff' }]) : null,
    isLoading: false,
  }),
}))

describe('DiffViewer', () => {
  beforeEach(() => {
    copyTextToClipboardMock.mockClear()
  })

  it('uses wrapped rendering without proxy horizontal scrollbar when word wrap is enabled', () => {
    const { container } = render(
      <DiffViewer
        before={'const someRidiculouslyLongIdentifierName = oldValue'}
        after={'const someRidiculouslyLongIdentifierName = newValue'}
        language="ts"
        viewMode="unified"
        wordWrap={true}
      />,
    )

    expect(screen.getByText('const someRidiculouslyLongIdentifierName = oldValue')).toBeInTheDocument()
    expect(screen.getByText('const someRidiculouslyLongIdentifierName = newValue')).toBeInTheDocument()
    expect(container.querySelector('.sticky')).toBeNull()
  })

  it('keeps empty split content texture anchored while scrolling horizontally', async () => {
    const { container } = render(
      <DiffViewer
        before={['same', 'tail'].join('\n')}
        after={['same', 'added only line', 'tail'].join('\n')}
        language="ts"
        viewMode="split"
        wordWrap={false}
      />,
    )

    const scrollPanels = container.querySelectorAll('.scrollbar-none')
    const leftContent = scrollPanels[0] as HTMLDivElement

    const emptyBuffer = container.querySelector('.diff-empty-content-buffer.min-w-full') as HTMLDivElement
    const initialX = Number.parseFloat(emptyBuffer.style.backgroundPosition.split(' ')[0] ?? '0')

    Object.defineProperty(leftContent, 'scrollLeft', { value: 37, configurable: true })
    fireEvent.scroll(leftContent)

    await waitFor(() => {
      const updatedBuffer = container.querySelector('.diff-empty-content-buffer.min-w-full') as HTMLDivElement
      const updatedX = Number.parseFloat(updatedBuffer.style.backgroundPosition.split(' ')[0] ?? '0')
      expect(updatedX - initialX).toBe(37)
    })
  })

  it('keeps split word-diff changed text themed when syntax highlighting is unavailable', () => {
    const { container } = render(
      <DiffViewer before={['node_modules', '.git', '.gitignore'].join('\n')} after={['node_modules', 'root', '.gitignore'].join('\n')} language="text" viewMode="split" wordWrap={true} />,
    )

    const changedSegments = Array.from(container.querySelectorAll('span')).filter(
      segment => segment.classList.contains('bg-danger-100/30') || segment.classList.contains('bg-success-100/30'),
    )

    expect(changedSegments.length).toBeGreaterThan(0)
    for (const segment of changedSegments) {
      expect(segment.closest('.text-text-100')).not.toBeNull()
    }
  })

  it('does not duplicate trailing characters when split word diff is syntax highlighted', () => {
    const { container } = render(
      <DiffViewer
        before={'const [isLoading, setIsLoading] = useState(false)\nif (!enabled) return'}
        after={'const [isLoading, setIsLoading] = useState(false)\nif (!enabled || delayMs > 0) return'}
        language="ts"
        viewMode="split"
        wordWrap={false}
      />,
    )

    expect(container.textContent).toContain('if (!enabled) return')
    expect(container.textContent).not.toContain('returnn')
  })

  it('exposes a copy button that copies a unified diff (unified view)', async () => {
    render(
      <DiffViewer
        before={'const value = oldResult'}
        after={'const value = newResult'}
        language="ts"
        viewMode="unified"
        wordWrap={false}
        filePath="src/foo.ts"
      />,
    )

    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' })
    expect(copyButton).toBeInTheDocument()

    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1)
    })

    const copiedText = copyTextToClipboardMock.mock.calls[0]?.[0] as string
    expect(copiedText).toContain('Index: src/foo.ts')
    expect(copiedText).toContain('--- src/foo.ts')
    expect(copiedText).toContain('+++ src/foo.ts')
    expect(copiedText).toContain('@@')
    expect(copiedText).toContain('-const value = oldResult')
    expect(copiedText).toContain('+const value = newResult')
  })

  it('exposes a copy button that copies a unified diff (split view)', async () => {
    render(
      <DiffViewer
        before={'line one'}
        after={'line one\nline two'}
        language="ts"
        viewMode="split"
        wordWrap={false}
        filePath="src/bar.ts"
      />,
    )

    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1)
    })

    const copiedText = copyTextToClipboardMock.mock.calls[0]?.[0] as string
    expect(copiedText).toContain('Index: src/bar.ts')
    expect(copiedText).toContain('+line two')
  })

  it('exposes a copy button in the wrapped unified view', async () => {
    render(
      <DiffViewer
        before={'const value = old'}
        after={'const value = wrapped'}
        language="ts"
        viewMode="unified"
        wordWrap={true}
        filePath="x.ts"
      />,
    )

    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1)
    })

    const copiedText = copyTextToClipboardMock.mock.calls[0]?.[0] as string
    expect(copiedText).toContain('Index: x.ts')
    expect(copiedText).toContain('+const value = wrapped')
  })

  it('exposes a copy button in the wrapped split view', async () => {
    render(
      <DiffViewer
        before={'wrapped split before'}
        after={'wrapped split after'}
        language="ts"
        viewMode="split"
        wordWrap={true}
        filePath="y.ts"
      />,
    )

    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1)
    })

    const copiedText = copyTextToClipboardMock.mock.calls[0]?.[0] as string
    expect(copiedText).toContain('Index: y.ts')
  })

  it('falls back to "file" as the path when filePath is omitted', async () => {
    render(
      <DiffViewer before={'a'} after={'b'} language="ts" viewMode="unified" wordWrap={false} />,
    )

    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1)
    })

    const copiedText = copyTextToClipboardMock.mock.calls[0]?.[0] as string
    expect(copiedText).toContain('Index: file')
  })

  it('rewrites an absolute filePath to a path relative to projectDirectory', async () => {
    render(
      <DiffViewer
        before={'a'}
        after={'b'}
        language="ts"
        viewMode="unified"
        wordWrap={false}
        filePath="/repo/src/foo.ts"
        projectDirectory="/repo"
      />,
    )

    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(copyTextToClipboardMock).toHaveBeenCalledTimes(1)
    })

    const copiedText = copyTextToClipboardMock.mock.calls[0]?.[0] as string
    expect(copiedText).toContain('Index: src/foo.ts')
    expect(copiedText).not.toContain('/repo/')
  })
})
