/**
 * useAutoScroll — React 移植自 oc 的 createAutoScroll
 *
 * 核心机制：
 * - userScrolled: 用户主动上滚后置 true，阻止程序拉回底部
 * - markAuto/isAuto: 程序滚动时打标记（1500ms TTL, 2px 容差），
 *   防止自己的 scrollToBottom 被误判为用户滚动
 * - contentRef ResizeObserver: 流式内容增长时自动贴底
 * - 所有回调稳定（useCallback + useMemo），避免 ref 回调重挂载
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const AUTO_TTL = 1500
const AUTO_TOLERANCE = 2

export function useAutoScroll(bottomThreshold = 10) {
  const scrollElRef = useRef<HTMLElement | undefined>(undefined)
  const contentElRef = useRef<HTMLElement | undefined>(undefined)
  const userScrolledRef = useRef(false)
  const [userScrolled, setUserScrolled] = useState(false)

  const autoMark = useRef<{ top: number; time: number } | undefined>(undefined)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const setScrolled = useCallback((v: boolean) => {
    userScrolledRef.current = v
    setUserScrolled(v)
  }, [])

  const markAuto = useCallback((el: HTMLElement) => {
    autoMark.current = { top: el.scrollHeight - el.clientHeight, time: Date.now() }
    if (autoTimer.current) clearTimeout(autoTimer.current)
    autoTimer.current = setTimeout(() => { autoMark.current = undefined }, AUTO_TTL)
  }, [])

  const isAuto = useCallback((el: HTMLElement) => {
    const a = autoMark.current
    if (!a) return false
    if (Date.now() - a.time > AUTO_TTL) { autoMark.current = undefined; return false }
    return Math.abs(el.scrollTop - a.top) < AUTO_TOLERANCE
  }, [])

  const scrollToBottom = useCallback((force: boolean) => {
    const el = scrollElRef.current
    if (!el) return
    if (force && userScrolledRef.current) setScrolled(false)
    if (!force && userScrolledRef.current) return
    const max = el.scrollHeight - el.clientHeight
    if (max - el.scrollTop < 2) { markAuto(el); return }
    markAuto(el)
    el.scrollTop = el.scrollHeight
  }, [markAuto, setScrolled])

  const stop = useCallback(() => {
    const el = scrollElRef.current
    if (!el) return
    if (el.scrollHeight - el.clientHeight <= 1) { if (userScrolledRef.current) setScrolled(false); return }
    if (userScrolledRef.current) return
    setScrolled(true)
  }, [setScrolled])

  const handleScroll = useCallback(() => {
    const el = scrollElRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    if (max <= 1) { if (userScrolledRef.current) setScrolled(false); return }
    if (max - el.scrollTop < bottomThreshold) { if (userScrolledRef.current) setScrolled(false); return }
    if (!userScrolledRef.current && isAuto(el)) { scrollToBottom(false); return }
    stop()
  }, [bottomThreshold, isAuto, scrollToBottom, setScrolled, stop])

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.deltaY >= 0) return
    const el = scrollElRef.current
    if (!el) return
    const nested = (e.target instanceof Element ? e.target : undefined)?.closest('[data-scrollable]')
    if (nested && nested !== el) return
    stop()
  }, [stop])

  const handleInteraction = useCallback(() => {
    const sel = window.getSelection()
    if (sel && sel.toString().length > 0) stop()
  }, [stop])

  const setScrollRef = useCallback((el: HTMLElement | null) => {
    scrollElRef.current = el ?? undefined
    if (el) el.style.overflowAnchor = 'none'
  }, [])

  const setContentRef = useCallback((el: HTMLElement | null) => {
    contentElRef.current = el ?? undefined
  }, [])

  // contentRef ResizeObserver: 流式内容增长时自动贴底
  useEffect(() => {
    const content = contentElRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (userScrolledRef.current) return
      scrollToBottom(false)
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [scrollToBottom])

  useEffect(() => () => { if (autoTimer.current) clearTimeout(autoTimer.current) }, [])

  const resume = useCallback(() => { setScrolled(false); scrollToBottom(true) }, [scrollToBottom, setScrolled])
  const scrollToBottomCb = useCallback(() => scrollToBottom(false), [scrollToBottom])
  const forceScrollToBottom = useCallback(() => scrollToBottom(true), [scrollToBottom])

  return useMemo(() => ({
    setScrollRef,
    setContentRef,
    handleScroll,
    handleWheel,
    handleInteraction,
    pause: stop,
    resume,
    scrollToBottom: scrollToBottomCb,
    forceScrollToBottom,
    userScrolledRef,
    userScrolled,
  }), [
    setScrollRef, setContentRef, handleScroll, handleWheel, handleInteraction,
    stop, resume, scrollToBottomCb, forceScrollToBottom, userScrolled,
  ])
}
