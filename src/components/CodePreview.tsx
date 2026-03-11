import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSyntaxHighlightRef, type HighlightTokens } from '../hooks/useSyntaxHighlight'

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

export function CodePreview({ code, language, truncateLines = true, maxHeight, isResizing = false }: CodePreviewProps) {
  const lines = useMemo(() => {
    const raw = code.split('\n')
    if (raw.length > 1 && raw[raw.length - 1] === '' && code.endsWith('\n')) {
      raw.pop()
    }
    return raw
  }, [code])
  const totalHeight = lines.length * LINE_HEIGHT

  // tokens 存在 ref 里，不经过 React state/props
  // version 是一个自增 number，只用来通知 useMemo 重算可视行
  const enableHighlight = language !== 'text'
  const { tokensRef, version } = useSyntaxHighlightRef(code, {
    lang: language,
    enabled: enableHighlight,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

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

  // 直接在 useMemo 里读 ref，通过 version 触发重算
  // tokens 数组本身不出现在任何 React 管线里
  const visibleLines = useMemo(() => {
    // version 在依赖里只是触发重算的信号，不实际使用
    void version
    const tokens = tokensRef.current
    const result: React.ReactNode[] = []

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
      } else {
        // 无 token，纯文本 fallback
        if (truncateLines && rawLine.length > MAX_LINE_LENGTH) {
          isTruncated = true
          displayContent = <span className="text-text-200 whitespace-pre">{rawLine.slice(0, MAX_LINE_LENGTH)}</span>
        } else {
          displayContent = <span className="text-text-200 whitespace-pre">{rawLine}</span>
        }
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
  }, [startIndex, endIndex, lines, version, tokensRef, truncateLines])

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto overflow-x-hidden code-scrollbar h-full"
      onScroll={handleScroll}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
    >
      {/* 虚拟滚动占位：contain: strict 隔离内部 layout，
          外层容器宽度变化时浏览器不会对这块做 reflow */}
      <div style={{ height: totalHeight, position: 'relative', contain: 'strict' }}>
        {/* 可见行区域：独立横向滚动，只有 20-30 行参与 layout */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${offsetY}px)`,
          }}
          className="font-mono text-[11px] leading-relaxed overflow-x-auto code-scrollbar"
        >
          {visibleLines}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Token 截断渲染
// ============================================

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
