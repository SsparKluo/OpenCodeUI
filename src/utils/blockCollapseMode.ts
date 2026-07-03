import { useEffect } from 'react'
import type { BlockCollapseMode } from '../store/themeStore'
import { useUiDisclosureState } from './uiDisclosureState'

export interface BlockCollapseContext {
  /** Block is actively updating (streaming, running tool, etc.) */
  isLive: boolean
  /** Block has meaningful content to show when expanded */
  hasContent: boolean
}

export function isBlockCollapseMode(value: unknown): value is BlockCollapseMode {
  return value === 'auto_toggle' || value === 'auto_expand' || value === 'always_collapsed'
}

export function resolveBlockCollapseExpanded(mode: BlockCollapseMode, ctx: BlockCollapseContext): boolean {
  switch (mode) {
    case 'always_collapsed':
      return false
    case 'auto_expand':
      return ctx.hasContent
    case 'auto_toggle':
      return ctx.isLive && ctx.hasContent
  }
}

export type UiDisclosureSetter = (
  next: boolean | ((prev: boolean) => boolean),
  options?: { touched?: boolean; respectUser?: boolean },
) => void

/** Apply auto expand/collapse on the next frame, respecting manual user toggles. */
export function scheduleDisclosureSync(setExpanded: UiDisclosureSetter, expanded: boolean) {
  const frameId = requestAnimationFrame(() => {
    setExpanded(expanded, { touched: false, respectUser: true })
  })
  return () => cancelAnimationFrame(frameId)
}

export function useBlockCollapseDisclosure(
  stateKey: string,
  mode: BlockCollapseMode,
  ctx: BlockCollapseContext,
) {
  const target = resolveBlockCollapseExpanded(mode, ctx)
  const [expanded, setExpanded, touched] = useUiDisclosureState(stateKey, target)

  useEffect(() => scheduleDisclosureSync(setExpanded, resolveBlockCollapseExpanded(mode, ctx)), [
    mode,
    ctx.isLive,
    ctx.hasContent,
    setExpanded,
  ])

  return [expanded, setExpanded, touched] as const
}