import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useSyntaxHighlightRef, type HighlightTokens } from '../hooks/useSyntaxHighlight'
import { useDynamicVirtualScroll } from '../hooks/useDynamicVirtualScroll'
import { themeStore } from '../store/themeStore'

const LINE_HEIGHT = 20
const OVERSCAN = 5
const MAX_LINE_LENGTH = 5000
const LARGE_FILE_LINES = 2000
const LARGE_FILE_CHARS = 300000

interface CodePreviewProps {
  code: string
  language: string
  truncateLines?: boolean
  maxHeight?: number
  isResizing?: boolean
  wordWrap?: boolean
}

/**
 * CodePreview - 代码预览组件
 *
 * 默认路径保留现有虚拟滚动；启用自动换行后切到 wrapped 渲染，
 * 避免固定行高虚拟列表和可变行高互相打架。
 */
export function CodePreview(props: CodePreviewProps) {
  const { codeWordWrap } = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot)
  const resolvedWordWrap = props.wordWrap ?? codeWordWrap

  if (resolvedWordWrap) {
    return <WrappedCodePreview {...props} />
  }

  return <VirtualizedCodePreview {...props} />
}

function VirtualizedCodePreview({
  code,
  language,
  truncateLines = true,
  maxHeight,
  isResizing = false,
}: CodePreviewProps) {
  const { t } = useTranslation(['common'])
  const lines = useMemo(() => splitCodeLines(code), [code])
  const totalHeight = lines.length * LINE_HEIGHT
  const gutterCh = Math.max(2, String(lines.length).length)
  const gutterWidth = `calc(${gutterCh}ch + 1.75rem)`

  const enableHighlight = language !== 'text'
  const { tokensRef, version } = useSyntaxHighlightRef(code, {
    lang: language,
    enabled: enableHighlight,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const scrollSourceRef = useRef<'content' | 'scrollbar' | null>(null)
  const maxScrollWidthRef = useRef(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const [contentClientWidth, setContentClientWidth] = useState(0)

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

  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const inner = content.firstElementChild as HTMLElement

    const measure = () => {
      if (inner) {
        const sw = inner.scrollWidth
        if (sw > maxScrollWidthRef.current) {
          maxScrollWidthRef.current = sw
          inner.style.minWidth = `${sw}px`
        }
        setContentWidth(maxScrollWidthRef.current)
      }
      setContentClientWidth(content.clientWidth)
    }

    measure()
    const ro = new ResizeObserver(() => {
      maxScrollWidthRef.current = 0
      if (inner) inner.style.minWidth = ''
      measure()
    })
    ro.observe(content)
    const mo = new MutationObserver(measure)
    mo.observe(content, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [startIndex, endIndex])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const handleScrollbar = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (scrollSourceRef.current === 'content') return
    scrollSourceRef.current = 'scrollbar'
    if (contentRef.current) contentRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      scrollSourceRef.current = null
    })
  }, [])

  const handleContentScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    if (scrollSourceRef.current === 'scrollbar') return
    scrollSourceRef.current = 'content'
    if (scrollbarRef.current) scrollbarRef.current.scrollLeft = e.currentTarget.scrollLeft
    requestAnimationFrame(() => {
      scrollSourceRef.current = null
    })
  }, [])

  const { gutterRows, contentRows } = useMemo(() => {
    const tokens = tokensRef.current
    const gutters: React.ReactNode[] = []
    const contents: React.ReactNode[] = []

    for (let i = startIndex; i < endIndex; i++) {
      const rawLine = lines[i] || ' '
      const lineTokens = tokens?.[i]

      let displayContent: React.ReactNode
      let isTruncated = false

      if (lineTokens && lineTokens.length > 0) {
        if (truncateLines) {
          const { elements, truncated } = renderTokensTruncated(lineTokens)
          isTruncated = truncated
          displayContent = <span className="whitespace-pre">{elements}</span>
        } else {
          displayContent = (
            <span className="whitespace-pre">
              {lineTokens.map((token, j) => (
                <span key={j} style={token.color ? { color: token.color } : undefined}>
                  {token.content}
                </span>
              ))}
            </span>
          )
        }
      } else if (truncateLines && rawLine.length > MAX_LINE_LENGTH) {
        isTruncated = true
        displayContent = <span className="text-text-200 whitespace-pre">{rawLine.slice(0, MAX_LINE_LENGTH)}</span>
      } else {
        displayContent = <span className="text-text-200 whitespace-pre">{rawLine}</span>
      }

      gutters.push(
        <div
          key={i}
          className="text-text-500 text-right pr-3 pl-4 leading-5 select-none"
          style={{ height: LINE_HEIGHT }}
        >
          {i + 1}
        </div>,
      )

      contents.push(
        <div key={i} className="leading-5 pl-3 pr-4 whitespace-pre" style={{ height: LINE_HEIGHT }}>
          {displayContent}
          {isTruncated && <span className="text-text-500 ml-1">{t('common:truncated')}</span>}
        </div>,
      )
    }

    return { gutterRows: gutters, contentRows: contents }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version 用于在 tokensRef 更新时触发重算
  }, [startIndex, endIndex, lines, version, truncateLines, t])

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden code-scrollbar h-full font-mono text-[11px] leading-relaxed"
      onScroll={handleScroll}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0 flex" style={{ transform: `translateY(${offsetY}px)` }}>
          <div className="shrink-0 overflow-hidden" style={{ width: gutterWidth }}>
            {gutterRows}
          </div>

          <div
            ref={contentRef}
            className="flex-1 min-w-0 overflow-x-auto scrollbar-none"
            onScroll={handleContentScroll}
          >
            <div className="inline-block min-w-full">{contentRows}</div>
          </div>
        </div>
      </div>

      {contentWidth > contentClientWidth && (
        <div className="sticky bottom-0 z-10 flex">
          <div className="shrink-0" style={{ width: gutterWidth }} />
          <div ref={scrollbarRef} className="flex-1 min-w-0 overflow-x-auto code-scrollbar" onScroll={handleScrollbar}>
            <div style={{ width: contentWidth, height: 1 }} />
          </div>
        </div>
      )}
    </div>
  )
}

function WrappedCodePreview({ code, language, truncateLines = true, maxHeight, isResizing = false }: CodePreviewProps) {
  const { t } = useTranslation(['common'])
  const lines = useMemo(() => splitCodeLines(code), [code])
  const isLargeFile = lines.length > LARGE_FILE_LINES || code.length > LARGE_FILE_CHARS
  const gutterCh = Math.max(2, String(lines.length).length)
  const gutterWidth = `calc(${gutterCh}ch + 1.75rem)`

  const enableHighlight = !isResizing && language !== 'text' && !isLargeFile
  const { tokensRef, version } = useSyntaxHighlightRef(code, {
    lang: language,
    enabled: enableHighlight,
  })

  const { containerRef, totalHeight, startIndex, endIndex, offsetY, handleScroll, measureRef } =
    useDynamicVirtualScroll({ lineCount: lines.length, isResizing })

  const visibleRows = useMemo(() => {
    const tokens = tokensRef.current
    const rows: React.ReactNode[] = []
    for (let i = startIndex; i < endIndex; i++) {
      const rawLine = lines[i] || ' '
      const lineTokens = tokens?.[i]

      let displayContent: React.ReactNode
      let isTruncated = false

      if (lineTokens && lineTokens.length > 0) {
        if (truncateLines) {
          const { elements, truncated } = renderTokensTruncated(lineTokens)
          isTruncated = truncated
          displayContent = <>{elements}</>
        } else {
          displayContent = lineTokens.map((token, j) => (
            <span key={j} style={token.color ? { color: token.color } : undefined}>
              {token.content}
            </span>
          ))
        }
      } else if (truncateLines && rawLine.length > MAX_LINE_LENGTH) {
        isTruncated = true
        displayContent = <span className="text-text-200">{rawLine.slice(0, MAX_LINE_LENGTH)}</span>
      } else {
        displayContent = <span className="text-text-200">{rawLine}</span>
      }

      rows.push(
        <div key={i} ref={el => measureRef(i, el)} className="flex">
          <div
            className="shrink-0 text-text-500 text-right pr-3 pl-4 leading-5 select-none"
            style={{ width: gutterWidth, minHeight: LINE_HEIGHT }}
          >
            {i + 1}
          </div>
          <div
            className="min-w-0 flex-1 pl-3 pr-4 leading-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
            style={{ minHeight: LINE_HEIGHT }}
          >
            {displayContent}
            {isTruncated && <span className="text-text-500 ml-1">{t('common:truncated')}</span>}
          </div>
        </div>,
      )
    }
    return rows
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version 用于在 tokensRef 更新时触发重算
  }, [startIndex, endIndex, lines, version, truncateLines, t, gutterWidth, measureRef])

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden code-scrollbar h-full font-mono text-[11px] leading-relaxed"
      onScroll={handleScroll}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div className="absolute top-0 left-0 right-0" style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleRows}
        </div>
      </div>
    </div>
  )
}

type HighlightToken = HighlightTokens[number][number]

function renderTokensTruncated(lineTokens: HighlightToken[]): {
  elements: React.ReactNode[]
  truncated: boolean
} {
  const elements: React.ReactNode[] = []
  let charCount = 0
  let truncated = false

  for (let j = 0; j < lineTokens.length; j++) {
    const token = lineTokens[j]
    const remaining = MAX_LINE_LENGTH - charCount

    if (remaining <= 0) {
      truncated = true
      break
    }

    if (token.content.length > remaining) {
      elements.push(
        <span key={j} style={token.color ? { color: token.color } : undefined}>
          {token.content.slice(0, remaining)}
        </span>,
      )
      truncated = true
      break
    }

    elements.push(
      <span key={j} style={token.color ? { color: token.color } : undefined}>
        {token.content}
      </span>,
    )
    charCount += token.content.length
  }

  return { elements, truncated }
}

function splitCodeLines(code: string) {
  const raw = code.split('\n')
  if (raw.length > 1 && raw[raw.length - 1] === '' && code.endsWith('\n')) {
    raw.pop()
  }
  return raw
}
