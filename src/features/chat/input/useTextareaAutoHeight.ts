import { useCallback, useLayoutEffect, useEffect, type RefObject } from 'react'
import { measureTextareaContentHeight } from './measureTextareaContentHeight'

const MIN_TEXTAREA_HEIGHT_PX = 24

export interface UseTextareaAutoHeightOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  text: string
  isCompact: boolean
  /**
   * External upper bound for the textarea content height in px.
   * When provided, overrides the viewport-based fallback so the hook can
   * stay in sync with a caller-driven height budget (e.g. composer maxHeight
   * derived from the chat pane container).
   */
  maxHeight?: number
  /** When true, nudge chat scroll after dock height changes (caller should gate follow mode). */
  shouldNudgeChatScroll?: boolean
  onDockResize?: () => void
}

function fallbackMaxHeight(viewportH: number, isCompact: boolean): number {
  return isCompact ? Math.max(80, viewportH - 48 - 100 - 72) : viewportH * 0.35
}

export function useTextareaAutoHeight({
  textareaRef,
  text,
  isCompact,
  maxHeight,
  shouldNudgeChatScroll = false,
  onDockResize,
}: UseTextareaAutoHeightOptions): void {
  const applyHeight = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    if (text.length === 0) {
      textarea.style.height = `${MIN_TEXTAREA_HEIGHT_PX}px`
      textarea.style.overflowY = 'hidden'
      if (shouldNudgeChatScroll) onDockResize?.()
      return
    }

    const prevScrollTop = textarea.scrollTop
    const contentHeight = measureTextareaContentHeight(textarea, text)
    const effectiveMax = maxHeight ?? fallbackMaxHeight(window.innerHeight, isCompact)
    const nextHeight = Math.max(MIN_TEXTAREA_HEIGHT_PX, Math.min(contentHeight, effectiveMax))
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = contentHeight > effectiveMax ? 'auto' : 'hidden'
    textarea.scrollTop = prevScrollTop

    if (shouldNudgeChatScroll) onDockResize?.()
  }, [textareaRef, text, isCompact, maxHeight, shouldNudgeChatScroll, onDockResize])

  useLayoutEffect(() => {
    applyHeight()
  }, [applyHeight])

  useEffect(() => {
    const textarea = textareaRef.current
    const observeTarget = textarea?.parentElement
    if (!textarea || !observeTarget || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      applyHeight()
    })
    observer.observe(observeTarget)
    window.addEventListener('resize', applyHeight)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', applyHeight)
    }
  }, [textareaRef, applyHeight])
}