import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { marked } from 'marked'
import type { Tokens as MarkedTokens } from 'marked'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import DOMPurify from 'dompurify'
import { CodeBlock } from './CodeBlock'
import { HandIcon, RetryIcon, ZoomInIcon, ZoomOutIcon } from './Icons'
import { CopyButton } from './ui'
import { useTheme } from '../hooks/useTheme'
import { useInputCapabilities } from '../hooks/useInputCapabilities'
import { detectLanguage } from '../utils/languageUtils'
import { isTauri } from '../utils/tauri'
import { splitMarkdownStream } from './markdownStream'

interface MarkdownRendererProps {
  content: string
  className?: string
  /** Whether the content is actively being streamed */
  isStreaming?: boolean
  /** Display variant: 'default' for normal content, 'reasoning' for subdued thinking blocks */
  variant?: 'default' | 'reasoning'
}

const MERMAID_MIN_SCALE = 0.5
const MERMAID_MAX_SCALE = 3
const MERMAID_SCALE_STEP = 0.15
const MERMAID_CONTROL_BUTTON_BASE_CLASS =
  'inline-flex h-8 w-8 items-center justify-center rounded-md bg-bg-300/70 backdrop-blur-md transition-colors duration-150 hover:bg-bg-300/85 disabled:opacity-40 disabled:cursor-not-allowed'
const MERMAID_CONTROL_BUTTON_CLASS = `${MERMAID_CONTROL_BUTTON_BASE_CLASS} text-text-400 hover:text-text-200`
const LOCAL_FILE_LINK_PREFIX = '#opencode-local-file:'

type DiagramPointer = { x: number; y: number }

type PinchGesture = {
  startDistance: number
  startScale: number
  startOffset: { x: number; y: number }
  startCenter: { x: number; y: number }
}

type MarkdownRenderContext = {
  isReasoning: boolean
  isStreaming: boolean
  streamingCodeHighlight: boolean
}

type MermaidRendererProps = {
  code: string
  language?: string
  isIncomplete?: boolean
}

let mermaidRenderCounter = 0

function createMermaidRenderId(prefix: string) {
  mermaidRenderCounter += 1
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '') || 'diagram'
  return `mermaid-${safePrefix}-${mermaidRenderCounter}`
}

function clampMermaidScale(scale: number) {
  return Math.min(MERMAID_MAX_SCALE, Math.max(MERMAID_MIN_SCALE, Number(scale.toFixed(2))))
}

function getPointerDistance(first: DiagramPointer, second: DiagramPointer) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function getPointerCenter(first: DiagramPointer, second: DiagramPointer) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
}

function getRelativeCenter(target: HTMLDivElement, first: DiagramPointer, second: DiagramPointer) {
  const center = getPointerCenter(first, second)
  const rect = target.parentElement?.getBoundingClientRect()
  if (!rect) return center
  return {
    x: center.x - rect.left,
    y: center.y - rect.top,
  }
}

// ─── Inline Code ───────────────────────────────────────────────

const InlineCode = memo(function InlineCode({
  children,
  variant = 'default',
}: {
  children: React.ReactNode
  variant?: 'default' | 'reasoning'
}) {
  return (
    <code
      className={
        variant === 'reasoning'
          ? 'font-mono text-accent-main-100 text-[0.9em] align-baseline break-words'
          : 'text-accent-main-100 text-[0.9em] font-mono align-baseline break-words'
      }
    >
      {children}
    </code>
  )
})

const MarkdownImage = memo(function MarkdownImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  if (!src || isUnsafeImageSrc(src)) return null

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block max-w-full align-top"
      title={title || alt || undefined}
    >
      <img src={src} alt={alt || ''} title={title} loading="lazy" className="block max-w-full rounded-md" />
    </a>
  )
})

// ─── Helpers ───────────────────────────────────────────────────

/** Extract text content from React node tree */
function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode }
    return extractText(props.children)
  }
  return ''
}

function decodeHref(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getWindowsAbsolutePath(value: string): string | null {
  const decoded = decodeHref(value)
  return /^[A-Za-z]:[\\/]/.test(decoded) ? decoded : null
}

function encodeLocalFileHref(filePath: string): string {
  return `${LOCAL_FILE_LINK_PREFIX}${encodeURIComponent(filePath)}`
}

function decodeLocalFileHref(href?: string): string | null {
  if (!href?.startsWith(LOCAL_FILE_LINK_PREFIX)) return null

  try {
    return decodeURIComponent(href.slice(LOCAL_FILE_LINK_PREFIX.length))
  } catch {
    return null
  }
}

function getLanguage(value: string | undefined): string | undefined {
  return value?.trim().split(/\s+/, 1)[0] || undefined
}

function isUnsafeHref(href?: string): boolean {
  if (!href) return false
  const normalized = Array.from(href.trim())
    .filter(char => {
      const code = char.charCodeAt(0)
      return code > 0x1f && code !== 0x7f && !/\s/.test(char)
    })
    .join('')
    .toLowerCase()
  return normalized.startsWith('javascript:') || normalized.startsWith('vbscript:') || normalized.startsWith('data:')
}

function isUnsafeImageSrc(src?: string): boolean {
  if (!src) return false
  const trimmed = src.trim()
  if (/^data:/i.test(trimmed)) return !/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(trimmed)
  return isUnsafeHref(src)
}

function rewriteRawHtmlLocalLinks(html: string): string {
  if (typeof document === 'undefined') return html
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
    const href = anchor.getAttribute('href') ?? ''
    const localPath = decodeLocalFileHref(href) ?? getWindowsAbsolutePath(href)
    if (!localPath) return
    anchor.setAttribute('href', encodeLocalFileHref(localPath))
    anchor.setAttribute('title', localPath)
  })
  return template.innerHTML
}

function sanitizeHtml(html: string): string {
  if (!DOMPurify.isSupported) return ''
  const clean = DOMPurify.sanitize(rewriteRawHtmlLocalLinks(html), {
    USE_PROFILES: { html: true, mathMl: true, svg: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  }) as unknown as string

  if (typeof document === 'undefined') return clean

  const template = document.createElement('template')
  template.innerHTML = clean
  template.content.querySelectorAll<HTMLElement>('[style]').forEach(element => {
    const style = element.getAttribute('style') ?? ''
    if (/url\s*\(|expression\s*\(|behavior\s*:|-moz-binding\s*:/i.test(style)) {
      element.removeAttribute('style')
    }
  })
  return template.innerHTML
}

function openLocalFilePath(filePath: string) {
  if (!isTauri()) return
  import('@tauri-apps/plugin-opener').then(mod => mod.openPath(filePath)).catch(() => {})
}

function textFromInlineTokens(tokens: unknown[] | undefined): string {
  if (!tokens) return ''
  return tokens
    .map(token => {
      const item = token as Record<string, unknown>
      if (typeof item.text === 'string') return item.text
      if (typeof item.raw === 'string') return item.raw
      return textFromInlineTokens(item.tokens as unknown[] | undefined)
    })
    .join('')
}

function renderKatex(source: string, displayMode: boolean, key: string) {
  try {
    return (
      <span
        key={key}
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(source, {
            displayMode,
            throwOnError: false,
            strict: false,
            trust: false,
          }),
        }}
      />
    )
  } catch {
    return <span key={key}>{displayMode ? `$$${source}$$` : `$${source}$`}</span>
  }
}

function getDisplayMathSource(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('$$') || !trimmed.endsWith('$$') || trimmed.length < 4) return null
  return trimmed.slice(2, -2).trim()
}

function isEscapedAt(text: string, index: number): boolean {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashCount += 1
  return slashCount % 2 === 1
}

function isHtmlOnlyParagraph(item: Record<string, unknown>): boolean {
  const raw = String(item.raw ?? '').trim()
  if (!raw.startsWith('<') || !raw.endsWith('>')) return false
  return (item.tokens as Array<Record<string, unknown>> | undefined)?.some(token => token.type === 'html' || token.type === 'tag') ?? false
}

function hasInlineHtml(item: Record<string, unknown>): boolean {
  return (item.tokens as Array<Record<string, unknown>> | undefined)?.some(token => token.type === 'html' || token.type === 'tag') ?? false
}

function parseInlineMarkdownHtml(source: string): string {
  try {
    return marked.parseInline(source) as string
  } catch {
    return source
  }
}

function renderTextWithMath(text: string, keyPrefix: string): React.ReactNode {
  if (!text.includes('$')) return text

  const nodes: React.ReactNode[] = []
  let cursor = 0
  let lastIndex = 0
  let mathIndex = 0

  while (cursor < text.length) {
    if (text[cursor] !== '$' || isEscapedAt(text, cursor)) {
      cursor += 1
      continue
    }

    const display = text[cursor + 1] === '$'
    const marker = display ? '$$' : '$'
    const start = cursor + marker.length
    let end = start
    let close = -1

    while (end < text.length) {
      const next = text.indexOf(marker, end)
      if (next === -1) break
      if (!isEscapedAt(text, next)) {
        close = next
        break
      }
      end = next + marker.length
    }

    if (close === -1) {
      cursor += marker.length
      continue
    }

    const source = text.slice(start, close)
    if (!display && (!source || source.includes('\n'))) {
      cursor += marker.length
      continue
    }

    if (cursor > lastIndex) nodes.push(text.slice(lastIndex, cursor))
    nodes.push(renderKatex(source, display, `${keyPrefix}:math:${mathIndex++}`))
    cursor = close + marker.length
    lastIndex = cursor
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes.length > 0 ? nodes : text
}

// ─── Markdown Table ────────────────────────────────────────────

/**
 * Extract table AST into rows of cell text for markdown copy.
 * Walks thead/tbody > tr > th|td children.
 */
function extractTableData(children: React.ReactNode): { headers: string[]; rows: string[][] } {
  const headers: string[] = []
  const rows: string[][] = []

  const childArr = Array.isArray(children) ? children : [children]
  for (const section of childArr) {
    if (!isValidElement(section)) continue
    const sectionProps = section.props as { children?: React.ReactNode }
    const trArr = Array.isArray(sectionProps.children) ? sectionProps.children : [sectionProps.children]

    for (const tr of trArr) {
      if (!isValidElement(tr)) continue
      const trProps = tr.props as { children?: React.ReactNode }
      const cells = Array.isArray(trProps.children) ? trProps.children : [trProps.children]
      const texts = cells
        .filter(isValidElement)
        .map(c => extractText((c as React.ReactElement<{ children?: React.ReactNode }>).props?.children ?? ''))

      // If this row is inside thead (section type name check), treat as headers
      const sectionType = typeof section.type === 'string' ? section.type : (section.type as { name?: string })?.name
      if (sectionType === 'thead' || String(sectionType).toLowerCase().includes('thead')) {
        headers.push(...texts)
      } else {
        rows.push(texts)
      }
    }
  }
  return { headers, rows }
}

function tableToMarkdown(headers: string[], rows: string[][]): string {
  if (!headers.length) return ''
  const sep = headers.map(() => '---')
  const lines = [`| ${headers.join(' | ')} |`, `| ${sep.join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`)]
  return lines.join('\n')
}

function getOrderedListStyle(start: unknown, children: React.ReactNode): React.CSSProperties {
  const startNumber = typeof start === 'number' && Number.isFinite(start) ? start : 1
  const itemCount = Math.max(Children.count(children), 1)
  const endNumber = Math.max(startNumber + itemCount - 1, startNumber)
  const markerChars = String(Math.abs(endNumber)).length + (endNumber < 0 ? 1 : 0)

  return {
    paddingInlineStart: `${Math.max(3, markerChars + 2)}ch`,
  }
}

function injectTableCopyButton(
  children: React.ReactNode,
  copyText: string,
): { children: React.ReactNode; inserted: boolean } {
  let inserted = false

  const nextChildren = Children.map(children, section => {
    if (!isValidElement(section)) return section

    const sectionType = typeof section.type === 'string' ? section.type : (section.type as { name?: string })?.name
    if (sectionType !== 'thead' && !String(sectionType).toLowerCase().includes('thead')) return section

    const sectionElement = section as React.ReactElement<{ children?: React.ReactNode }>
    const rows = Children.toArray(sectionElement.props.children)
    if (rows.length === 0) return section

    return cloneElement(
      sectionElement,
      undefined,
      rows.map((row, rowIndex) => {
        if (!isValidElement(row) || rowIndex !== rows.length - 1) return row

        const rowElement = row as React.ReactElement<{ children?: React.ReactNode }>
        const cells = Children.toArray(rowElement.props.children)
        if (cells.length === 0) return row

        return cloneElement(
          rowElement,
          undefined,
          cells.map((cell, cellIndex) => {
            if (!isValidElement(cell) || cellIndex !== cells.length - 1 || inserted) return cell

            inserted = true
            const cellElement = cell as React.ReactElement<{ children?: React.ReactNode }>

            return cloneElement(
              cellElement,
              undefined,
              <>
                <span className="block pr-8">{cellElement.props.children}</span>
                <span className="absolute inset-y-0 right-0 flex items-center px-2">
                  <CopyButton
                    text={copyText}
                    position="static"
                    className="!p-1 opacity-0 group-hover/table:opacity-100 group-focus-within/table:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                  />
                </span>
              </>,
            )
          }),
        )
      }),
    )
  })

  return { children: nextChildren ?? children, inserted }
}

const MarkdownTable = memo(function MarkdownTable({
  children,
  isReasoning,
}: {
  children: React.ReactNode
  isReasoning: boolean
}) {
  const copyText = useMemo(() => {
    const { headers, rows } = extractTableData(children)
    return tableToMarkdown(headers, rows)
  }, [children])

  const { children: tableChildren, inserted: hasInlineCopyButton } = useMemo(() => {
    if (isReasoning || !copyText) return { children, inserted: false }
    return injectTableCopyButton(children, copyText)
  }, [children, copyText, isReasoning])

  if (isReasoning) {
    return (
      <div className="overflow-x-auto my-2 first:mt-0 last:mb-0 w-full">
        <table className="min-w-full border-collapse text-[length:var(--fs-sm)]">{children}</table>
      </div>
    )
  }

  return (
    <div className="group/table relative my-5 first:mt-0 last:mb-0 rounded-md border border-border-200/35 w-full">
      {/* Scrollable table area */}
      <div className="overflow-x-auto">
        <table className="w-full text-[length:var(--fs-md)] border-collapse">{tableChildren}</table>
      </div>
      {/* Copy button — outside scroll, pinned to visible top-right */}
      {copyText && !hasInlineCopyButton && (
        <CopyButton
          text={copyText}
          position="absolute"
          className="!top-1.5 !right-2 opacity-0 group-hover/table:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity z-20"
        />
      )}
    </div>
  )
})

const MarkdownMermaid = memo(function MarkdownMermaid({ code, isIncomplete }: MermaidRendererProps) {
  const { resolvedTheme } = useTheme()
  const { hasCoarsePointer, hasTouch, preferTouchUi } = useInputCapabilities()
  const supportsTouchGestures = hasCoarsePointer || hasTouch
  const renderPrefix = useId()
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const touchPointersRef = useRef<Map<number, DiagramPointer>>(new Map())
  const pinchRef = useRef<PinchGesture | null>(null)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isTouchPanEnabled, setIsTouchPanEnabled] = useState(false)

  const resetView = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const zoomBy = useCallback((delta: number) => {
    setScale(current => clampMermaidScale(current + delta))
  }, [])

  const clearTouchGesture = useCallback(() => {
    touchPointersRef.current.clear()
    pinchRef.current = null
    dragRef.current = null
  }, [])

  const beginPinchGesture = useCallback(
    (target: HTMLDivElement) => {
      const pointers = Array.from(touchPointersRef.current.values())
      if (pointers.length < 2) return
      const [first, second] = pointers
      pinchRef.current = {
        startDistance: Math.max(1, getPointerDistance(first, second)),
        startScale: scale,
        startOffset: offset,
        startCenter: getRelativeCenter(target, first, second),
      }
      dragRef.current = null
    },
    [offset, scale],
  )

  const handleContainerClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!preferTouchUi) return
      if (event.target instanceof HTMLElement && event.target.closest('button')) return
      event.currentTarget.focus({ preventScroll: true })
    },
    [preferTouchUi],
  )

  const handleContainerBlur = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      if (!preferTouchUi) return
      const nextTarget = event.relatedTarget
      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
      setIsTouchPanEnabled(false)
      clearTouchGesture()
    },
    [clearTouchGesture, preferTouchUi],
  )

  useEffect(() => {
    if (isTouchPanEnabled) return
    clearTouchGesture()
  }, [clearTouchGesture, isTouchPanEnabled])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (supportsTouchGestures && event.pointerType !== 'mouse' && !isTouchPanEnabled) return
      if (event.pointerType !== 'mouse') {
        touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (touchPointersRef.current.size >= 2) {
          beginPinchGesture(event.currentTarget)
          event.currentTarget.setPointerCapture?.(event.pointerId)
          return
        }
      }
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: offset.x,
        originY: offset.y,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [beginPinchGesture, supportsTouchGestures, isTouchPanEnabled, offset.x, offset.y],
  )

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' && touchPointersRef.current.has(event.pointerId)) {
      touchPointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const pointers = Array.from(touchPointersRef.current.values())
      const pinch = pinchRef.current
      if (pointers.length >= 2 && pinch) {
        const [first, second] = pointers
        const distance = Math.max(1, getPointerDistance(first, second))
        const center = getRelativeCenter(event.currentTarget, first, second)
        const nextScale = clampMermaidScale(pinch.startScale * (distance / pinch.startDistance))
        const anchorX = (pinch.startCenter.x - pinch.startOffset.x) / pinch.startScale
        const anchorY = (pinch.startCenter.y - pinch.startOffset.y) / pinch.startScale

        event.preventDefault()
        setScale(nextScale)
        setOffset({
          x: center.x - anchorX * nextScale,
          y: center.y - anchorY * nextScale,
        })
        return
      }
    }

    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    setOffset({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    })
  }, [])

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') {
      touchPointersRef.current.delete(event.pointerId)
      if (touchPointersRef.current.size < 2) pinchRef.current = null
    }
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  useEffect(() => {
    if (isIncomplete || !code.trim()) {
      setSvg('')
      setError('')
      resetView()
      return
    }

    let cancelled = false

    async function renderDiagram() {
      try {
        setSvg('')
        setError('')
        resetView()
        const { default: mermaid } = await import('mermaid')
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        })
        const result = await mermaid.render(createMermaidRenderId(renderPrefix), code)
        if (!cancelled) setSvg(result.svg)
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[Markdown] Mermaid render failed:', err)
        }
        if (!cancelled) {
          setSvg('')
          setError(err instanceof Error ? err.message : 'Failed to render Mermaid diagram')
        }
      }
    }

    void renderDiagram()

    return () => {
      cancelled = true
    }
  }, [code, isIncomplete, renderPrefix, resetView, resolvedTheme])

  if (isIncomplete) {
    return <CodeBlock code={code} language="mermaid" deferHighlight />
  }

  if (error) {
    return (
      <div className="my-4 first:mt-0 last:mb-0 rounded-md border border-danger-100/30 bg-danger-bg/40 p-3">
        <p className="mb-2 text-[length:var(--fs-sm)] font-medium text-danger-100">Mermaid render failed</p>
        <CodeBlock code={code} language="mermaid" />
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        className="my-4 first:mt-0 last:mb-0 flex min-h-40 items-center justify-center"
        aria-label="Rendering diagram"
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-text-400/25 border-t-text-400" />
      </div>
    )
  }

  return (
    <div
      className={`group/mermaid relative my-4 first:mt-0 last:mb-0 overflow-hidden ${preferTouchUi ? 'focus:outline-none' : ''}`}
      tabIndex={preferTouchUi ? 0 : undefined}
      onClick={preferTouchUi ? handleContainerClick : undefined}
      onBlur={preferTouchUi ? handleContainerBlur : undefined}
    >
      <div
        className={`absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/mermaid:opacity-100 group-focus-within/mermaid:opacity-100 ${preferTouchUi ? '[@media(hover:none)]:opacity-0' : '[@media(hover:none)]:opacity-100'}`}
        onMouseDown={event => event.preventDefault()}
      >
        <CopyButton text={code} position="static" className={`!h-8 !w-8 !p-2 ${MERMAID_CONTROL_BUTTON_BASE_CLASS}`} />
        {preferTouchUi && (
          <button
            type="button"
            className={`${MERMAID_CONTROL_BUTTON_CLASS} ${isTouchPanEnabled ? 'ring-1 ring-accent-main-100/60 !text-accent-main-100' : ''}`}
            onClick={() => setIsTouchPanEnabled(current => !current)}
            title={isTouchPanEnabled ? 'Disable diagram pan' : 'Enable diagram pan'}
            aria-label={isTouchPanEnabled ? 'Disable diagram pan' : 'Enable diagram pan'}
            aria-pressed={isTouchPanEnabled}
          >
            <HandIcon />
          </button>
        )}
        {!preferTouchUi && (
          <>
            <button
              type="button"
              className={MERMAID_CONTROL_BUTTON_CLASS}
              onClick={() => zoomBy(-MERMAID_SCALE_STEP)}
              disabled={scale <= MERMAID_MIN_SCALE}
              title="Zoom out"
              aria-label="Zoom out diagram"
            >
              <ZoomOutIcon />
            </button>
            <button
              type="button"
              className={MERMAID_CONTROL_BUTTON_CLASS}
              onClick={() => zoomBy(MERMAID_SCALE_STEP)}
              disabled={scale >= MERMAID_MAX_SCALE}
              title="Zoom in"
              aria-label="Zoom in diagram"
            >
              <ZoomInIcon />
            </button>
          </>
        )}
        <button
          type="button"
          className={MERMAID_CONTROL_BUTTON_CLASS}
          onClick={resetView}
          title="Reset view"
          aria-label="Reset diagram view"
        >
          <RetryIcon />
        </button>
      </div>
      <div
        className={`mermaid-diagram min-h-40 min-w-fit select-none overflow-hidden p-1 [&_svg]:max-w-full [&_svg]:h-auto ${supportsTouchGestures && !isTouchPanEnabled ? 'cursor-default touch-pan-y' : 'cursor-grab touch-none active:cursor-grabbing'}`}
        role="img"
        aria-label="Mermaid diagram"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: 'top left',
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
})

const STREAM_MIN_COMMIT_INTERVAL_MS = 32
const STREAM_MAX_COMMIT_INTERVAL_MS = 96
const STREAM_TAIL_SCALE_CHARS = 256
const STREAM_FLUSH_CHARS_PER_SECOND = 260

function findMarkdownTailLength(content: string) {
  const boundary = content.lastIndexOf('\n\n')
  return boundary === -1 ? content.length : content.length - boundary - 2
}

function useSmoothMarkdownStream(content: string, enabled: boolean) {
  const [displayedContent, setDisplayedContent] = useState(content)
  const displayedRef = useRef(content)
  const targetRef = useRef(content)
  const rafRef = useRef<number | null>(null)
  const lastCommitRef = useRef(0)

  const stop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  useEffect(() => {
    if (!enabled) {
      stop()
      targetRef.current = content
      displayedRef.current = content
      setDisplayedContent(content)
      return
    }

    targetRef.current = content
    if (!content.startsWith(displayedRef.current)) {
      displayedRef.current = content
      setDisplayedContent(content)
      return
    }

    if (rafRef.current !== null) return

    const tick = (timestamp: number) => {
      const target = targetRef.current
      const current = displayedRef.current
      const backlog = target.length - current.length
      if (backlog <= 0) {
        rafRef.current = null
        return
      }

      const tailLength = findMarkdownTailLength(current)
      const minInterval = Math.min(
        STREAM_MAX_COMMIT_INTERVAL_MS,
        STREAM_MIN_COMMIT_INTERVAL_MS * (1 + tailLength / STREAM_TAIL_SCALE_CHARS),
      )
      if (timestamp - lastCommitRef.current < minInterval) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      const elapsedSeconds = Math.max(0.016, Math.min((timestamp - lastCommitRef.current) / 1000, 0.12))
      const nextChars = Math.max(1, Math.ceil(STREAM_FLUSH_CHARS_PER_SECOND * elapsedSeconds))
      const nextContent = target.slice(0, current.length + Math.min(backlog, nextChars))
      lastCommitRef.current = timestamp
      displayedRef.current = nextContent
      setDisplayedContent(nextContent)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return stop
  }, [content, enabled, stop])

  return displayedContent
}

function renderInlineTokens(tokens: unknown[] | undefined, ctx: MarkdownRenderContext, keyPrefix: string): React.ReactNode {
  if (!tokens || tokens.length === 0) return null

  return tokens.map((token, index) => {
    const item = token as Record<string, unknown>
    const key = `${keyPrefix}:${index}`
    const type = item.type

    switch (type) {
      case 'escape':
      case 'text': {
        const nested = item.tokens as unknown[] | undefined
        if (nested?.length) return <span key={key}>{renderInlineTokens(nested, ctx, key)}</span>
        return <span key={key}>{renderTextWithMath(String(item.text ?? item.raw ?? ''), key)}</span>
      }
      case 'codespan':
        return (
          <InlineCode key={key} variant={ctx.isReasoning ? 'reasoning' : 'default'}>
            {String(item.text ?? '')}
          </InlineCode>
        )
      case 'strong':
        return (
          <strong key={key} className={ctx.isReasoning ? 'font-semibold text-text-300' : 'font-semibold text-text-100'}>
            {renderInlineTokens(item.tokens as unknown[] | undefined, ctx, key)}
          </strong>
        )
      case 'em':
        return (
          <em key={key} className={ctx.isReasoning ? 'italic text-text-300' : 'italic text-text-200'}>
            {renderInlineTokens(item.tokens as unknown[] | undefined, ctx, key)}
          </em>
        )
      case 'del':
        return (
          <del
            key={key}
            className={
              ctx.isReasoning
                ? 'text-[length:var(--fs-sm)] text-text-500 line-through decoration-text-500/50'
                : 'text-text-400 line-through decoration-text-400/50'
            }
          >
            {renderInlineTokens(item.tokens as unknown[] | undefined, ctx, key)}
          </del>
        )
      case 'link': {
        const href = typeof item.href === 'string' ? item.href : undefined
        if (isUnsafeHref(href)) {
          return <span key={key}>{textFromInlineTokens(item.tokens as unknown[] | undefined)} [blocked]</span>
        }
        const localPath = decodeLocalFileHref(href) ?? (href ? getWindowsAbsolutePath(href) : null)
        const normalizedHref = localPath ? encodeLocalFileHref(localPath) : href
        const className = ctx.isReasoning
          ? 'text-[length:var(--fs-sm)] font-medium text-accent-main-200/80 hover:text-accent-main-200 underline underline-offset-2 transition-colors'
          : 'font-medium text-accent-main-100 hover:text-accent-main-200 underline underline-offset-2 transition-colors'

        if (localPath) {
          return (
            <a
              key={key}
              href={normalizedHref}
              title={localPath}
              className={className}
              onClick={event => {
                event.preventDefault()
                openLocalFilePath(localPath)
              }}
            >
              {renderInlineTokens(item.tokens as unknown[] | undefined, ctx, key)}
            </a>
          )
        }

        return (
          <a key={key} href={normalizedHref} target="_blank" rel="noopener noreferrer" className={className}>
            {renderInlineTokens(item.tokens as unknown[] | undefined, ctx, key)}
          </a>
        )
      }
      case 'image':
        return (
          <MarkdownImage
            key={key}
            src={typeof item.href === 'string' ? item.href : undefined}
            alt={typeof item.text === 'string' ? item.text : undefined}
            title={typeof item.title === 'string' ? item.title : undefined}
          />
        )
      case 'br':
        return <br key={key} />
      case 'html':
      case 'tag':
        return <span key={key} dangerouslySetInnerHTML={{ __html: sanitizeHtml(String(item.raw ?? '')) }} />
      default:
        return <span key={key}>{String(item.text ?? item.raw ?? '')}</span>
    }
  })
}

function renderBlockTokens(tokens: unknown[] | undefined, ctx: MarkdownRenderContext, keyPrefix: string): React.ReactNode {
  if (!tokens || tokens.length === 0) return null

  return tokens.map((token, index) => renderBlockToken(token as MarkedTokens.Generic, ctx, `${keyPrefix}:${index}`))
}

function renderListItem(item: Record<string, unknown>, ctx: MarkdownRenderContext, key: string) {
  const children = renderBlockTokens(item.tokens as unknown[] | undefined, ctx, key)
  const task = item.task === true
  const checked = item.checked === true
  return (
    <li
      key={key}
      className={ctx.isReasoning ? 'text-[length:var(--fs-sm)] text-text-400 pl-1 leading-5' : 'text-text-200 pl-1 leading-7'}
    >
      {task && <input type="checkbox" checked={checked} readOnly className="mr-2 align-middle" />}
      {children}
    </li>
  )
}

function renderTableCell(
  cell: Record<string, unknown>,
  ctx: MarkdownRenderContext,
  key: string,
  type: 'th' | 'td',
) {
  const children = renderInlineTokens(cell.tokens as unknown[] | undefined, ctx, key)
  const align = typeof cell.align === 'string' ? cell.align : undefined
  const style = align ? { textAlign: align as React.CSSProperties['textAlign'] } : undefined

  if (type === 'th') {
    return (
      <th
        key={key}
        style={style}
        className={
          ctx.isReasoning
            ? 'px-3 py-1.5 text-left text-[length:var(--fs-sm)] font-medium whitespace-nowrap border-b border-border-200/32'
            : 'relative px-3 py-2.5 text-left text-[length:var(--fs-md)] font-semibold whitespace-nowrap border-b border-border-200/38'
        }
      >
        {children}
      </th>
    )
  }

  return (
    <td
      key={key}
      style={style}
      className={
        ctx.isReasoning
          ? 'px-3 py-1.5 text-[length:var(--fs-sm)] text-text-300 w-max border-b border-border-200/18'
          : 'px-3 py-2 text-[length:var(--fs-md)] text-text-300 leading-[1.55] w-max border-b border-border-200/14'
      }
    >
      {children}
    </td>
  )
}

function renderBlockToken(token: MarkedTokens.Generic, ctx: MarkdownRenderContext, key: string): React.ReactNode {
  const item = token as unknown as Record<string, unknown>

  switch (item.type) {
    case 'space':
    case 'def':
      return null
    case 'heading': {
      const depth = Number(item.depth) || 1
      const children = renderInlineTokens(item.tokens as unknown[] | undefined, ctx, key)
      const className = ctx.isReasoning
        ? 'text-[length:var(--fs-sm)] font-semibold text-text-300 mt-2 mb-1 first:mt-0 last:mb-0'
        : depth === 1
          ? 'text-[length:var(--fs-heading-1)] font-bold text-text-100 mt-8 mb-4 first:mt-0 last:mb-0 tracking-tight'
          : depth === 2
            ? 'text-[length:var(--fs-heading-2)] font-bold text-text-100 mt-6 mb-3 first:mt-0 last:mb-0 tracking-tight pb-1.5 border-b border-border-100/40'
            : depth === 3
              ? 'text-[length:var(--fs-heading-3)] font-semibold text-text-100 mt-5 mb-2 first:mt-0 last:mb-0 tracking-tight'
              : 'text-[length:var(--fs-base)] font-semibold text-text-100 mt-4 mb-2 first:mt-0 last:mb-0 tracking-tight'

      if (depth === 1) return <h1 key={key} className={className}>{children}</h1>
      if (depth === 2) return <h2 key={key} className={className}>{children}</h2>
      if (depth === 3) return <h3 key={key} className={className}>{children}</h3>
      return <h4 key={key} className={className}>{children}</h4>
    }
    case 'paragraph':
      {
        const displayMath = getDisplayMathSource(String(item.raw ?? item.text ?? ''))
        if (displayMath != null) {
          return (
            <div key={key} className={ctx.isReasoning ? 'my-2 overflow-x-auto text-text-400' : 'my-4 overflow-x-auto text-text-200'}>
              {renderKatex(displayMath, true, `${key}:math`)}
            </div>
          )
        }
        if (hasInlineHtml(item)) {
          const raw = String(item.raw ?? '')
          const html = sanitizeHtml(parseInlineMarkdownHtml(raw))
          const className = ctx.isReasoning
            ? 'text-[length:var(--fs-sm)] mb-2 last:mb-0 leading-5 text-text-400'
            : 'mb-4 last:mb-0 leading-7 text-text-200'
          if (isHtmlOnlyParagraph(item)) {
            return <div key={key} className={className} dangerouslySetInnerHTML={{ __html: html }} />
          }
          return (
            <p
              key={key}
              className={className}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )
        }
      }
      return (
        <p
          key={key}
          className={
            ctx.isReasoning
              ? 'text-[length:var(--fs-sm)] mb-2 last:mb-0 leading-5 text-text-400'
              : 'mb-4 last:mb-0 leading-7 text-text-200'
          }
        >
          {renderInlineTokens(item.tokens as unknown[] | undefined, ctx, key)}
        </p>
      )
    case 'text': {
      const nested = item.tokens as unknown[] | undefined
      return nested?.length ? (
        <p key={key} className={ctx.isReasoning ? 'text-[length:var(--fs-sm)] mb-2 last:mb-0 leading-5 text-text-400' : 'mb-4 last:mb-0 leading-7 text-text-200'}>
          {renderInlineTokens(nested, ctx, key)}
        </p>
      ) : (
        <p key={key} className={ctx.isReasoning ? 'text-[length:var(--fs-sm)] mb-2 last:mb-0 leading-5 text-text-400' : 'mb-4 last:mb-0 leading-7 text-text-200'}>
          {renderTextWithMath(String(item.text ?? item.raw ?? ''), key)}
        </p>
      )
    }
    case 'blockquote':
      return (
        <blockquote
          key={key}
          className={
            ctx.isReasoning
              ? 'border-l-2 border-text-500/30 pl-3 py-0.5 my-2 first:mt-0 last:mb-0 text-text-400'
              : 'border-l-2 border-accent-main-100/60 pl-4 py-1 my-4 first:mt-0 last:mb-0 text-text-300 italic'
          }
        >
          {renderBlockTokens(item.tokens as unknown[] | undefined, ctx, key)}
        </blockquote>
      )
    case 'list': {
      const ordered = item.ordered === true
      const children = (item.items as unknown[] | undefined)?.map((listItem, index) =>
        renderListItem(listItem as Record<string, unknown>, ctx, `${key}:li:${index}`),
      )
      if (ordered) {
        return (
          <ol
            key={key}
            start={typeof item.start === 'number' ? item.start : undefined}
            style={getOrderedListStyle(item.start, children)}
            className={
              ctx.isReasoning
                ? 'text-[length:var(--fs-sm)] list-decimal list-outside mb-2 last:mb-0 space-y-0.5 marker:text-text-500/60'
                : 'list-decimal list-outside mb-4 last:mb-0 space-y-1 marker:text-text-400/80'
            }
          >
            {children}
          </ol>
        )
      }
      return (
        <ul
          key={key}
          className={
            ctx.isReasoning
              ? 'text-[length:var(--fs-sm)] list-disc list-outside ml-4 mb-2 last:mb-0 space-y-0.5 marker:text-text-500/60'
              : 'list-disc list-outside ml-5 mb-4 last:mb-0 space-y-1 marker:text-text-400/80'
          }
        >
          {children}
        </ul>
      )
    }
    case 'code': {
      const code = String(item.text ?? '')
      const language = getLanguage(typeof item.lang === 'string' ? item.lang : undefined)
      if (language?.toLowerCase() === 'mermaid') {
        return <MarkdownMermaid key={key} code={code} language="mermaid" isIncomplete={ctx.isStreaming} />
      }
      return (
        <div key={key} className={ctx.isReasoning ? 'my-2 first:mt-0 last:mb-0 w-full' : 'my-4 first:mt-0 last:mb-0 w-full'}>
          <CodeBlock
            code={code}
            language={language}
            variant={ctx.isReasoning ? 'reasoning' : 'default'}
            wordwrap={ctx.isReasoning}
            forceHighlight={ctx.streamingCodeHighlight}
            streamingHighlight={ctx.streamingCodeHighlight}
          />
        </div>
      )
    }
    case 'table': {
      const header = (item.header as unknown[] | undefined) ?? []
      const rows = (item.rows as unknown[] | undefined) ?? []
      return (
        <MarkdownTable key={key} isReasoning={ctx.isReasoning}>
          <thead className={ctx.isReasoning ? 'text-text-400' : 'text-text-200'}>
            <tr className={ctx.isReasoning ? 'hover:bg-bg-200/10 transition-colors' : 'hover:bg-bg-200/12 transition-colors'}>
              {header.map((cell, index) => renderTableCell(cell as Record<string, unknown>, ctx, `${key}:h:${index}`, 'th'))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={`${key}:r:${rowIndex}`} className={ctx.isReasoning ? 'hover:bg-bg-200/10 transition-colors' : 'hover:bg-bg-200/12 transition-colors'}>
                {((row as unknown[]) ?? []).map((cell, cellIndex) =>
                  renderTableCell(cell as Record<string, unknown>, ctx, `${key}:r:${rowIndex}:c:${cellIndex}`, 'td'),
                )}
              </tr>
            ))}
          </tbody>
        </MarkdownTable>
      )
    }
    case 'hr':
      return (
        <hr
          key={key}
          className={ctx.isReasoning ? 'border-border-200/40 my-4 first:mt-0 last:mb-0' : 'border-border-200/60 my-8 first:mt-0 last:mb-0'}
        />
      )
    case 'html':
      return <div key={key} dangerouslySetInnerHTML={{ __html: sanitizeHtml(String(item.raw ?? '')) }} />
    default:
      return null
  }
}

const MarkdownStreamBlock = memo(function MarkdownStreamBlock({
  src,
  isReasoning,
  isStreaming,
  streamingCodeHighlight,
  isFirst,
  isLast,
}: {
  src: string
  isReasoning: boolean
  isStreaming: boolean
  streamingCodeHighlight: boolean
  isFirst: boolean
  isLast: boolean
}) {
  const content = useMemo(() => {
    try {
      return renderBlockTokens(marked.lexer(src), { isReasoning, isStreaming, streamingCodeHighlight }, 'md')
    } catch {
      return <p className={isReasoning ? 'text-[length:var(--fs-sm)] mb-2 last:mb-0 leading-5 text-text-400' : 'mb-4 last:mb-0 leading-7 text-text-200'}>{src}</p>
    }
  }, [isReasoning, isStreaming, src, streamingCodeHighlight])

  return (
    <div
      className={`markdown-stream-block ${isFirst ? 'markdown-stream-block-first' : 'markdown-stream-block-not-first'} ${
        isLast ? 'markdown-stream-block-last' : 'markdown-stream-block-not-last'
      }`}
    >
      {content}
    </div>
  )
})

// ─── Main Renderer ─────────────────────────────────────────────

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = '',
  isStreaming = false,
  variant = 'default',
}: MarkdownRendererProps) {
  const isReasoning = variant === 'reasoning'
  const smoothedContent = useSmoothMarkdownStream(content, isStreaming)
  const renderedContent = isStreaming ? smoothedContent : content
  const streamBlocks = useMemo(() => splitMarkdownStream(renderedContent, isStreaming), [renderedContent, isStreaming])
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    const target = event.target instanceof Element ? event.target : null
    const anchor = target?.closest<HTMLAnchorElement>(`a[href^="${LOCAL_FILE_LINK_PREFIX}"]`)
    const localPath = decodeLocalFileHref(anchor?.getAttribute('href') ?? undefined)
    if (!anchor || !localPath) return
    event.preventDefault()
    openLocalFilePath(localPath)
  }, [])

  return (
    <div
      className={`markdown-content ${isReasoning ? 'text-[length:var(--fs-sm)] leading-5 text-text-400' : 'text-[length:var(--fs-base)] leading-relaxed text-text-100'} break-words min-w-0 overflow-hidden ${className}`}
      onClick={handleClick}
    >
      {streamBlocks.map((block, index) => (
        <MarkdownStreamBlock
          key={block.key}
          src={block.src}
          isReasoning={isReasoning}
          isStreaming={isStreaming}
          streamingCodeHighlight={isStreaming && block.mode === 'live'}
          isFirst={index === 0}
          isLast={index === streamBlocks.length - 1}
        />
      ))}
    </div>
  )
})

// ─── Standalone Code Highlighter ───────────────────────────────

/**
 * Standalone code highlighter for tool previews.
 * Uses file extension to determine language.
 */
export const HighlightedCode = memo(function HighlightedCode({
  code,
  filePath,
  language,
  maxHeight,
  className = '',
}: {
  code: string
  filePath?: string
  language?: string
  maxHeight?: number
  className?: string
}) {
  const lang = useMemo(() => {
    return language || detectLanguage(filePath)
  }, [filePath, language])

  return (
    <div className={`overflow-auto ${className}`} style={maxHeight ? { maxHeight } : undefined}>
      <CodeBlock code={code} language={lang} />
    </div>
  )
})

export default MarkdownRenderer
