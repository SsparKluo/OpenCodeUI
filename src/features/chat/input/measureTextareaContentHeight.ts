const MIRROR_ID = 'opencodeui-textarea-height-mirror'

function getMirrorTextarea(): HTMLTextAreaElement {
  let mirror = document.getElementById(MIRROR_ID) as HTMLTextAreaElement | null
  if (!mirror) {
    mirror = document.createElement('textarea')
    mirror.id = MIRROR_ID
    mirror.setAttribute('aria-hidden', 'true')
    mirror.tabIndex = -1
    mirror.setAttribute('readonly', 'true')
    mirror.rows = 1
    mirror.style.position = 'fixed'
    mirror.style.left = '-9999px'
    mirror.style.top = '0'
    mirror.style.visibility = 'hidden'
    mirror.style.pointerEvents = 'none'
    mirror.style.overflow = 'hidden'
    mirror.style.resize = 'none'
    mirror.style.margin = '0'
    document.body.appendChild(mirror)
  }
  return mirror
}

function copyTextareaMetrics(source: HTMLTextAreaElement, mirror: HTMLTextAreaElement): void {
  const computed = getComputedStyle(source)
  const rectWidth = source.getBoundingClientRect().width
  const widthPx = Math.max(1, rectWidth > 0 ? rectWidth : source.offsetWidth || parseFloat(computed.width) || 1)

  mirror.className = source.className
  mirror.rows = source.rows

  mirror.style.boxSizing = computed.boxSizing
  mirror.style.width = `${widthPx}px`
  mirror.style.paddingTop = computed.paddingTop
  mirror.style.paddingRight = computed.paddingRight
  mirror.style.paddingBottom = computed.paddingBottom
  mirror.style.paddingLeft = computed.paddingLeft
  mirror.style.borderTopWidth = computed.borderTopWidth
  mirror.style.borderRightWidth = computed.borderRightWidth
  mirror.style.borderBottomWidth = computed.borderBottomWidth
  mirror.style.borderLeftWidth = computed.borderLeftWidth
  mirror.style.borderStyle = computed.borderStyle
  mirror.style.fontFamily = computed.fontFamily
  mirror.style.fontSize = computed.fontSize
  mirror.style.fontWeight = computed.fontWeight
  mirror.style.lineHeight = computed.lineHeight
  mirror.style.letterSpacing = computed.letterSpacing
  mirror.style.whiteSpace = computed.whiteSpace
  mirror.style.wordBreak = computed.wordBreak
  mirror.style.overflowWrap = computed.overflowWrap
}

/**
 * Measure wrapped text height without collapsing the visible textarea
 * (avoids layout flicker on the chat scroll sibling).
 */
export function measureTextareaContentHeight(textarea: HTMLTextAreaElement, content: string): number {
  const mirror = getMirrorTextarea()
  copyTextareaMetrics(textarea, mirror)

  // ZWSP on the row after a trailing newline so scrollHeight includes the caret line.
  mirror.value = content.endsWith('\n') ? `${content}\u200b` : content
  mirror.style.height = 'auto'
  return mirror.scrollHeight
}