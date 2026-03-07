import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSyntaxHighlight } from '../hooks/useSyntaxHighlight'

const LINE_HEIGHT = 20
const OVERSCAN = 5
const MAX_LINE_LENGTH = 5000

interface CodePreviewProps {
  code: string
  language: string
  truncateLines?: boolean
  maxHeight?: number
  isResizing?: boolean
}

function truncateLine(line: string): { text: string; truncated: boolean } {
  if (line.length <= MAX_LINE_LENGTH) {
    return { text: line, truncated: false }
  }
  return {
    text: line.slice(0, MAX_LINE_LENGTH),
    truncated: true,
  }
}

function truncateHtml(html: string): { html: string; truncated: boolean } {
  if (html.length <= MAX_LINE_LENGTH * 2) {
    return { html, truncated: false }
  }

  return { html: html.slice(0, MAX_LINE_LENGTH * 2), truncated: true }
}

export function CodePreview({ code, language, truncateLines = true, maxHeight, isResizing = false }: CodePreviewProps) {
  const lines = useMemo(() => {
    const raw = code.split('\n')
    if (raw.length > 1 && raw[raw.length - 1] === '' && code.endsWith('\n')) {
      raw.pop()
    }
    return raw
  }, [code])
  const totalHeight = lines.length * LINE_HEIGHT

  const enableHighlight = language !== 'text' && !isResizing
  const { output: html, isLoading } = useSyntaxHighlight(code, { lang: language, enabled: enableHighlight })

  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  const highlightedLines = useMemo(() => {
    if (isLoading || !html) return null

    const parser = new DOMParser()
    const doc = parser.parseFromString(html as string, 'text/html')
    const lineElements = doc.querySelectorAll('.line')

    if (lineElements.length === 0) return null

    return Array.from(lineElements).map(el => el.innerHTML || '')
  }, [html, isLoading])

  const { startIndex, endIndex, offsetY } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN)
    const visibleCount = Math.ceil(containerHeight / LINE_HEIGHT)
    const end = Math.min(lines.length, start + visibleCount + OVERSCAN * 2)
    return {
      startIndex: start,
      endIndex: end,
      offsetY: start * LINE_HEIGHT,
    }
  }, [scrollTop, containerHeight, lines.length])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (isResizing) return

    let rafId: number | null = null
    const updateHeight = () => {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        setContainerHeight(container.clientHeight)
      })
    }

    setContainerHeight(container.clientHeight)

    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(container)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
    }
  }, [isResizing])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const visibleLines = useMemo(() => {
    const result: React.ReactNode[] = []

    for (let i = startIndex; i < endIndex; i++) {
      const rawLine = lines[i] || ' '
      const highlighted = highlightedLines?.[i]
      const isHtml = highlighted && highlighted.includes('<')

      let displayContent: React.ReactNode
      let isTruncated = false

      if (isHtml && highlighted) {
        if (truncateLines) {
          const { html: truncatedHtml, truncated } = truncateHtml(highlighted)
          isTruncated = truncated
          displayContent = <span className="whitespace-pre" dangerouslySetInnerHTML={{ __html: truncatedHtml }} />
        } else {
          displayContent = <span className="whitespace-pre" dangerouslySetInnerHTML={{ __html: highlighted }} />
        }
      } else if (truncateLines) {
        const { text, truncated } = truncateLine(highlighted || rawLine)
        isTruncated = truncated
        displayContent = <span className="text-text-200 whitespace-pre">{text}</span>
      } else {
        displayContent = <span className="text-text-200 whitespace-pre">{highlighted || rawLine}</span>
      }

      result.push(
        <div key={i} className="flex hover:bg-bg-200/30" style={{ height: LINE_HEIGHT }}>
          <span className="select-none text-text-500 w-10 text-right pr-3 shrink-0 border-r border-border-100/30 mr-3 leading-5">
            {i + 1}
          </span>
          <span className="leading-5 pr-4">
            {displayContent}
            {isTruncated && <span className="text-text-500 ml-1">… (truncated)</span>}
          </span>
        </div>,
      )
    }
    return result
  }, [startIndex, endIndex, lines, highlightedLines, truncateLines])

  return (
    <div
      ref={containerRef}
      className="overflow-auto code-scrollbar"
      onScroll={handleScroll}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${offsetY}px)`,
          }}
          className="font-mono text-[11px] leading-relaxed"
        >
          {visibleLines}
        </div>
      </div>
    </div>
  )
}
