import { parseMarkdownIntoBlocks } from 'streamdown'

export type MarkdownStreamBlock = {
  key: string
  src: string
  mode: 'full' | 'live'
}

export type MarkdownStreamProjection = {
  text: string
  blocks: MarkdownStreamBlock[]
}

function hashString(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash.toString(36)
}

function hasReferenceDefinitions(markdown: string) {
  return /^\[[^\]]+\]:\s+\S+/m.test(markdown) || /^\[\^[^\]]+\]:\s+/m.test(markdown)
}

function getTrailingOpenFenceStart(markdown: string) {
  let openFence: { start: number; char: string; size: number } | null = null
  let offset = 0
  const lines = markdown.split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? ''
    const match = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(text)

    if (match?.[1] && !openFence) {
      openFence = { start: offset, char: match[1][0], size: match[1].length }
    } else if (openFence) {
      const closePattern = new RegExp(`^[ \\t]{0,3}${openFence.char}{${openFence.size},}[ \\t]*$`)
      if (closePattern.test(text)) openFence = null
    }

    offset += text.length + (index < lines.length - 1 ? 1 : 0)
  }

  return openFence?.start
}

function getOpeningFence(raw: string) {
  const match = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(raw)
  if (!match?.[1]) return null
  return { char: match[1][0], size: match[1].length }
}

function hasOpenFence(raw: string) {
  return getTrailingOpenFenceStart(raw) === 0
}

function suffixClosesOpenFence(raw: string, suffix: string) {
  const fence = getOpeningFence(raw)
  if (!fence) return suffix.includes('```') || suffix.includes('~~~')
  const prefix = raw.slice(-(fence.size - 1))
  return new RegExp(`^[\\s\\S]*(?:^|\\n)[ \\t]{0,3}${fence.char}{${fence.size},}[ \\t]*(?:\\n|$)`).test(prefix + suffix)
}

function splitMarkdownBlocks(markdown: string) {
  const blocks: Array<{ start: number; src: string }> = []
  let offset = 0

  for (const src of parseMarkdownIntoBlocks(markdown)) {
    const start = offset
    offset += src.length
    if (!src) continue

    if (src.trim() === '' && blocks.length > 0) {
      blocks[blocks.length - 1].src += src
      continue
    }

    blocks.push({ start, src })
  }

  return blocks.length > 0 ? blocks : [{ start: 0, src: markdown }]
}

export function splitMarkdownStream(markdown: string, isStreaming: boolean): MarkdownStreamBlock[] {
  if (!isStreaming) return [{ key: `full:${hashString(markdown)}`, src: markdown, mode: 'full' }]
  if (!markdown) return [{ key: 'live:empty', src: '', mode: 'live' }]
  if (hasReferenceDefinitions(markdown)) return [{ key: 'live:0:references', src: markdown, mode: 'live' }]

  const fenceStart = getTrailingOpenFenceStart(markdown)
  const blocks = splitMarkdownBlocks(markdown)
  if (blocks.length === 1) return [{ key: 'live:0:', src: markdown, mode: 'live' }]

  return blocks.map(block => {
    const isLiveTail = block === blocks[blocks.length - 1] || (fenceStart != null && block.start >= fenceStart)
    return {
      key: `${isLiveTail ? 'live' : 'stable'}:${block.start}:${isLiveTail ? '' : hashString(block.src)}`,
      src: block.src,
      mode: isLiveTail ? 'live' : 'full',
    }
  })
}

export function projectMarkdownStream(
  previous: MarkdownStreamProjection | undefined,
  markdown: string,
  isStreaming: boolean,
): MarkdownStreamProjection {
  if (!isStreaming || !previous || !markdown.startsWith(previous.text)) {
    return { text: markdown, blocks: splitMarkdownStream(markdown, isStreaming) }
  }

  const suffix = markdown.slice(previous.text.length)
  const tail = previous.blocks.at(-1)
  if (!suffix || tail?.mode !== 'live' || !hasOpenFence(tail.src) || suffixClosesOpenFence(tail.src, suffix)) {
    return { text: markdown, blocks: splitMarkdownStream(markdown, isStreaming) }
  }

  return {
    text: markdown,
    blocks: [
      ...previous.blocks.slice(0, -1),
      {
        ...tail,
        src: tail.src + suffix,
      },
    ],
  }
}
