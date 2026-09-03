/**
 * Recover raw Markdown for a rendered text selection.
 *
 * Strategy:
 *  1. If the selection sits entirely inside a KaTeX node, return the TeX
 *     source from `annotation[encoding=application/x-tex]`, re-wrapped with
 *     the delimiter found in `sourceMarkdown` (or a sensible default).
 *  2. Otherwise normalize away Markdown punctuation + collapse whitespace on
 *     both the selection and the source, find a unique match, map back to
 *     raw offsets, then expand to include adjacent markup (`**`, `` ` ``,
 *     `[…](…)`, heading `#`, fenced code).
 *  3. Return null when recovery is ambiguous or impossible — caller falls
 *     back to the rendered plain text.
 */

const MARKUP_CHAR = /[`*_~[\]()#>|!\\]/
const WHITESPACE = /\s/
const ORDERED_LIST_MARKER = /^\d+\.\s+/
const UNORDERED_LIST_MARKER = /^[*+-]\s+/

export type NormalizedIndex = {
  /** Markup-stripped, whitespace-collapsed text. */
  text: string
  /** `map[i]` = index in the original string of `text[i]`. */
  map: number[]
}

function isLineStart(value: string, index: number): boolean {
  return index === 0 || value[index - 1] === '\n'
}

/** Length of a list marker at `index`, or 0 when none. */
function listMarkerLength(value: string, index: number): number {
  if (!isLineStart(value, index)) return 0
  const slice = value.slice(index)
  const ordered = ORDERED_LIST_MARKER.exec(slice)
  if (ordered) return ordered[0].length
  const unordered = UNORDERED_LIST_MARKER.exec(slice)
  return unordered ? unordered[0].length : 0
}

/**
 * Strip Markdown punctuation and collapse whitespace so rendered plain text
 * can be located inside the raw source.
 */
export function normalizeForMatch(value: string): NormalizedIndex {
  const map: number[] = []
  let text = ''

  for (let i = 0; i < value.length; ) {
    const markerLen = listMarkerLength(value, i)
    if (markerLen > 0) {
      i += markerLen
      continue
    }

    const ch = value[i]!
    if (MARKUP_CHAR.test(ch)) {
      i++
      continue
    }
    if (WHITESPACE.test(ch)) {
      if (text.length === 0 || text.endsWith(' ')) {
        i++
        continue
      }
      text += ' '
      map.push(i)
      i++
      continue
    }
    text += ch
    map.push(i)
    i++
  }

  // Trim trailing collapsed space
  if (text.endsWith(' ')) {
    text = text.slice(0, -1)
    map.pop()
  }

  return { text, map }
}

/**
 * Find a unique occurrence of `needle` inside `haystack`. Returns the start
 * index, or -1 when missing / ambiguous.
 */
export function findUniqueIndex(haystack: string, needle: string): number {
  if (needle.length === 0) return -1
  const first = haystack.indexOf(needle)
  if (first === -1) return -1
  const second = haystack.indexOf(needle, first + 1)
  if (second !== -1) return -1
  return first
}

/**
 * Expand a raw [start, end) slice so adjacent Markdown markers travel with
 * the content (emphasis, inline code, links, headings, fenced blocks).
 */
export function expandMarkdownSlice(source: string, start: number, end: number): { start: number; end: number } {
  let lo = Math.max(0, start)
  let hi = Math.min(source.length, end)

  // Inline code: one or more backticks on both sides
  const code = expandInlineCode(source, lo, hi)
  if (code) return code

  // Links: [label](url) or ![alt](url) when the slice sits on the label
  const link = expandLink(source, lo, hi)
  if (link) {
    lo = link.start
    hi = link.end
  }

  // Emphasis / strong: include openers before the slice and/or closers after
  // it, even when the selection only covers part of the emphasized span plus
  // surrounding text (e.g. selecting "bold text" from "**bold** text").
  ;({ start: lo, end: hi } = expandEmphasis(source, lo, hi))

  // ATX heading: include leading #'s on the same line
  ;({ start: lo, end: hi } = expandHeading(source, lo, hi))

  // Blockquote / list: include leading line markers the content match omitted
  ;({ start: lo, end: hi } = expandBlockquote(source, lo, hi))
  ;({ start: lo, end: hi } = expandListMarker(source, lo, hi))

  // Fenced code block: if inside ```…```, take the whole fence
  const fence = expandFence(source, lo, hi)
  if (fence) return fence

  return { start: lo, end: hi }
}

function expandInlineCode(
  source: string,
  lo: number,
  hi: number,
): { start: number; end: number } | null {
  // Symmetric: backticks tight on both sides
  let left = lo
  while (left > 0 && source[left - 1] === '`') left--
  const leftTicks = lo - left
  if (leftTicks > 0) {
    let right = hi
    while (right < source.length && source[right] === '`') right++
    if (right - hi >= leftTicks) return { start: left, end: hi + leftTicks }

    // Opener before lo, closer inside the slice (partial span + trailing text)
    const closer = findCloserRun(source, lo, hi, '`', leftTicks)
    if (closer !== -1) return { start: left, end: hi }
  }

  // Closer after hi, opener inside the slice (leading text + partial span)
  let right = hi
  while (right < source.length && source[right] === '`') right++
  const rightTicks = right - hi
  if (rightTicks > 0) {
    const opener = findOpenerRun(source, lo, hi, '`', rightTicks)
    if (opener !== -1) return { start: lo, end: hi + rightTicks }
  }

  return null
}

function expandLink(
  source: string,
  lo: number,
  hi: number,
): { start: number; end: number } | null {
  // Walk left for an unescaped '[' (optional leading '!')
  let bracket = -1
  for (let i = lo - 1; i >= 0; i--) {
    const ch = source[i]
    if (ch === ']') return null // crossed another link end
    if (ch === '[') {
      bracket = i
      break
    }
    if (ch === '\n') return null
  }
  if (bracket === -1) return null

  const start = bracket > 0 && source[bracket - 1] === '!' ? bracket - 1 : bracket
  if (source[hi] !== ']') return null

  // Expect ](url) immediately after the label
  if (source[hi + 1] !== '(') return null
  const closeParen = source.indexOf(')', hi + 2)
  if (closeParen === -1) return null

  return { start, end: closeParen + 1 }
}

function measureRun(source: string, index: number, direction: -1 | 1, char: string): number {
  let count = 0
  let i = index
  while (i >= 0 && i < source.length && source[i] === char) {
    count++
    i += direction
  }
  return count
}

function findCloserRun(
  source: string,
  from: number,
  to: number,
  char: string,
  runLen: number,
): number {
  // First run of `char` repeated >= runLen times in [from, to).
  let i = from
  while (i < to) {
    if (source[i] !== char) {
      i++
      continue
    }
    const run = measureRun(source, i, 1, char)
    if (run >= runLen) return i
    i += run
  }
  return -1
}

function findOpenerRun(
  source: string,
  from: number,
  to: number,
  char: string,
  runLen: number,
): number {
  // Last run of `char` repeated >= runLen times in [from, to), returning its start.
  let i = to - 1
  while (i >= from) {
    if (source[i] !== char) {
      i--
      continue
    }
    const run = measureRun(source, i, -1, char)
    const start = i - run + 1
    if (run >= runLen) return start
    i = start - 1
  }
  return -1
}

function expandEmphasis(
  source: string,
  lo: number,
  hi: number,
): { start: number; end: number } {
  let changed = true
  while (changed) {
    changed = false

    // Symmetric: markers tight on both sides of the current slice
    if (lo > 0 && hi < source.length) {
      const leftChar = source[lo - 1]
      if (leftChar === '*' || leftChar === '_') {
        const leftRun = measureRun(source, lo - 1, -1, leftChar)
        const rightRun = measureRun(source, hi, 1, leftChar)
        const take = Math.min(leftRun, rightRun)
        if (take > 0) {
          lo -= take
          hi += take
          changed = true
          continue
        }
      }
    }

    // Opener immediately before lo, closer somewhere inside [lo, hi]
    // (selection covers emphasized content + trailing text).
    if (lo > 0) {
      const leftChar = source[lo - 1]
      if (leftChar === '*' || leftChar === '_') {
        const leftRun = measureRun(source, lo - 1, -1, leftChar)
        const closer = findCloserRun(source, lo, hi, leftChar, leftRun)
        if (closer !== -1) {
          lo -= leftRun
          changed = true
          continue
        }
      }
    }

    // Closer immediately after hi, opener somewhere inside [lo, hi]
    // (selection covers leading text + emphasized content).
    if (hi < source.length) {
      const rightChar = source[hi]
      if (rightChar === '*' || rightChar === '_') {
        const rightRun = measureRun(source, hi, 1, rightChar)
        const opener = findOpenerRun(source, lo, hi, rightChar, rightRun)
        if (opener !== -1) {
          hi += rightRun
          changed = true
          continue
        }
      }
    }
  }
  return { start: lo, end: hi }
}

function expandBlockquote(
  source: string,
  lo: number,
  hi: number,
): { start: number; end: number } {
  // Pull in a leading `>` on the first line of the slice, and leave interior
  // `>` markers alone — they already sit inside [lo, hi) once the first line
  // is anchored and the content match spans subsequent lines.
  let lineStart = lo
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--
  if (source.startsWith('>', lineStart) && lineStart < lo) {
    lo = lineStart
  }
  return { start: lo, end: hi }
}

function expandListMarker(
  source: string,
  lo: number,
  hi: number,
): { start: number; end: number } {
  let lineStart = lo
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--
  const markerLen = listMarkerLength(source, lineStart)
  if (markerLen > 0 && lineStart < lo) {
    lo = lineStart
  }
  return { start: lo, end: hi }
}

function expandHeading(
  source: string,
  lo: number,
  hi: number,
): { start: number; end: number } {
  // Find start of line
  let lineStart = lo
  while (lineStart > 0 && source[lineStart - 1] !== '\n') lineStart--

  const heading = /^#{1,6}[ \t]+/.exec(source.slice(lineStart, lo + 1))
  if (!heading) return { start: lo, end: hi }
  // Only expand when the slice begins at/after the heading marker's content
  if (lo > lineStart + heading[0].length) return { start: lo, end: hi }
  return { start: lineStart, end: hi }
}

function expandFence(
  source: string,
  lo: number,
  hi: number,
): { start: number; end: number } | null {
  // Find the nearest opening fence line before `lo`.
  const before = source.slice(0, lo)
  const openMatch = before.match(/(?:^|\n)(```[^\n]*\n)(?:(?!```)[\s\S])*$/)
  if (!openMatch || openMatch.index === undefined) return null

  const openLineStart = openMatch[0].startsWith('\n') ? openMatch.index + 1 : openMatch.index
  if (!source.startsWith('```', openLineStart)) return null

  const closeIdx = source.indexOf('\n```', hi)
  if (closeIdx === -1) return null

  let closeEnd = closeIdx + 1 // points at first `
  while (closeEnd < source.length && source[closeEnd] === '`') closeEnd++
  // Consume optional language-less trailing spaces / final newline
  while (closeEnd < source.length && source[closeEnd] !== '\n' && /\s/.test(source[closeEnd]!)) {
    closeEnd++
  }
  if (closeEnd < source.length && source[closeEnd] === '\n') closeEnd++

  return { start: openLineStart, end: closeEnd }
}

/**
 * Map a normalized match back to a raw [start, end) range (end exclusive,
 * pointing one past the last matched content character).
 */
export function normalizedMatchToRawRange(
  normalized: NormalizedIndex,
  matchStart: number,
  matchLength: number,
): { start: number; end: number } | null {
  if (matchLength <= 0) return null
  if (matchStart < 0 || matchStart + matchLength > normalized.map.length) return null
  const start = normalized.map[matchStart]
  const last = normalized.map[matchStart + matchLength - 1]
  if (start === undefined || last === undefined) return null
  return { start, end: last + 1 }
}

/**
 * Recover a raw Markdown slice from rendered plain text + source.
 * Returns null when the match is missing or not unique.
 */
export function recoverMarkdownFromPlain(
  sourceMarkdown: string,
  selectedPlain: string,
): string | null {
  const selected = normalizeForMatch(selectedPlain)
  if (selected.text.length === 0) return null

  const source = normalizeForMatch(sourceMarkdown)
  const matchStart = findUniqueIndex(source.text, selected.text)
  if (matchStart === -1) return null

  const raw = normalizedMatchToRawRange(source, matchStart, selected.text.length)
  if (!raw) return null

  const expanded = expandMarkdownSlice(sourceMarkdown, raw.start, raw.end)
  return sourceMarkdown.slice(expanded.start, expanded.end)
}

/**
 * Given TeX body from a KaTeX annotation, re-wrap with the delimiter used in
 * the source (preferred) or a default `$` / `$$`.
 */
export function wrapLatexSource(sourceMarkdown: string | null, latex: string): string {
  const trimmed = latex.trim()
  if (!trimmed) return latex

  if (sourceMarkdown) {
    const candidates = [
      `$$${trimmed}$$`,
      `\\[${trimmed}\\]`,
      `$${trimmed}$`,
      `\\(${trimmed}\\)`,
      // allow original spacing variants already in source via indexOf on body only —
      // fall through to exact wrapped forms above first.
    ]
    for (const candidate of candidates) {
      if (sourceMarkdown.includes(candidate)) return candidate
    }

    // Body appears inside source with unknown delimiter — try to sniff nearby
    const bodyIdx = sourceMarkdown.indexOf(trimmed)
    if (bodyIdx !== -1) {
      const before = sourceMarkdown.slice(Math.max(0, bodyIdx - 2), bodyIdx)
      const after = sourceMarkdown.slice(bodyIdx + trimmed.length, bodyIdx + trimmed.length + 2)
      if (before.endsWith('$$') && after.startsWith('$$')) return `$$${trimmed}$$`
      if (before.endsWith('\\[') && after.startsWith('\\]')) return `\\[${trimmed}\\]`
      if (before.endsWith('\\(') && after.startsWith('\\)')) return `\\(${trimmed}\\)`
      if (before.endsWith('$') && after.startsWith('$')) return `$${trimmed}$`
    }
  }

  return trimmed.includes('\n') ? `$$${trimmed}$$` : `$${trimmed}$`
}

/**
 * If `range` is entirely inside a single `.katex` node, return the wrapped
 * TeX source. Otherwise null.
 */
export function recoverKatexFromRange(
  range: Range,
  sourceMarkdown: string | null,
): string | null {
  const startEl =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement
  const endEl =
    range.endContainer.nodeType === Node.ELEMENT_NODE
      ? (range.endContainer as Element)
      : range.endContainer.parentElement
  if (!startEl || !endEl) return null

  const startKatex = startEl.closest('.katex')
  const endKatex = endEl.closest('.katex')
  if (!startKatex || startKatex !== endKatex) return null

  const annotation = startKatex.querySelector('annotation[encoding="application/x-tex"]')
  const latex = annotation?.textContent
  if (!latex) return null

  return wrapLatexSource(sourceMarkdown, latex)
}

/**
 * Walk up from a Selection anchor to the nearest `[data-md-source]` carrier.
 */
export function findMarkdownSourceRoot(selection: Selection | null): HTMLElement | null {
  if (!selection || selection.rangeCount === 0) return null
  const anchor = selection.anchorNode
  if (!anchor) return null
  const start =
    anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement
  if (!start) return null
  return start.closest<HTMLElement>('[data-md-source]')
}

/**
 * Top-level recovery used by the floating popup.
 * Always returns a string — falls back to `selection.toString()` on failure.
 */
export function recoverSelectionMarkdown(selection: Selection): string {
  const plain = selection.toString()
  const root = findMarkdownSourceRoot(selection)
  const source = root?.getAttribute('data-md-source') ?? null

  if (selection.rangeCount > 0) {
    const katex = recoverKatexFromRange(selection.getRangeAt(0), source)
    if (katex != null) return katex
  }

  if (source) {
    const recovered = recoverMarkdownFromPlain(source, plain)
    if (recovered != null) return recovered
  }

  return plain
}
