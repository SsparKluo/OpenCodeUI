/**
 * Recover raw Markdown for a rendered text selection.
 *
 * Strategy:
 *  1. If the selection sits entirely inside a KaTeX node, return the TeX
 *     source from `data-latex` / MathML annotation, re-wrapped with the
 *     delimiter found in `sourceMarkdown`.
 *  2. Otherwise normalize away Markdown punctuation + collapse whitespace,
 *     uniquely locate the selection in the source, then expand the raw
 *     slice via the marked AST: any token only partially covered is grown
 *     to its full `token.raw` (so nested strong+codespan never loses a closer).
 *  3. Return null when recovery is ambiguous or impossible — caller falls
 *     back to the rendered plain text.
 */

import { marked, type Token, type Tokens } from 'marked'

const MARKUP_CHAR = /[`*_~$[\]()#>|!\\]/
const WHITESPACE = /\s/
/** Trailing spaces before these are layout artifacts from block/formula boundaries. */
const PUNCT_AFTER_SPACE = /[.,!?;:]/
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

function nextContentChar(value: string, from: number): string | null {
  for (let i = from; i < value.length; ) {
    const markerLen = listMarkerLength(value, i)
    if (markerLen > 0) {
      i += markerLen
      continue
    }
    const ch = value[i]!
    if (MARKUP_CHAR.test(ch) || WHITESPACE.test(ch)) {
      i++
      continue
    }
    return ch
  }
  return null
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
      // Drop spaces that only exist because a formula/block boundary sat
      // between content and trailing punctuation ("Wl$ ." vs "Wl$.").
      const next = nextContentChar(value, i + 1)
      if (next && PUNCT_AFTER_SPACE.test(next)) {
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

type AstSpan = { start: number; end: number; type: string }

/**
 * Token types whose `raw` adds markers outside the visible text. Transparent
 * containers like `paragraph` / `list` are excluded so a partial selection
 * does not swallow the whole block.
 */
const EXPAND_TOKEN_TYPES = new Set([
  'strong',
  'em',
  'del',
  'codespan',
  'link',
  'image',
  'heading',
  'blockquote',
  'list_item',
  'code',
])

function childTokens(token: Token): Token[] | null {
  if ('tokens' in token && Array.isArray(token.tokens)) return token.tokens as Token[]
  if (token.type === 'list' && 'items' in token) return (token as Tokens.List).items as Token[]
  return null
}

/**
 * Walk marked's lexer output and record absolute [start, end) spans for every
 * token that owns a `raw` string. Children are placed by searching for their
 * `raw` inside the parent's raw (unique within that parent).
 */
export function collectMarkdownSpans(source: string): AstSpan[] {
  const spans: AstSpan[] = []

  const visit = (tokens: Token[], parentStart: number, parentRaw: string) => {
    let cursor = 0
    for (const token of tokens) {
      const raw = typeof token.raw === 'string' ? token.raw : ''
      if (!raw) continue

      let rel = parentRaw.indexOf(raw, cursor)
      if (rel === -1) rel = parentRaw.indexOf(raw)
      if (rel === -1) continue

      const start = parentStart + rel
      const end = start + raw.length
      spans.push({ start, end, type: token.type })
      cursor = rel + raw.length

      const children = childTokens(token)
      if (children && children.length > 0) visit(children, start, raw)
    }
  }

  visit(marked.lexer(source) as Token[], 0, source)
  return spans
}

/**
 * Expand a raw [start, end) content match so every marked wrapper token it
 * partially covers is included in full via `token.raw`. This is what keeps
 * nested strong+codespan closed when the selection only saw the inner word.
 */
export function expandMarkdownSlice(source: string, start: number, end: number): { start: number; end: number } {
  let lo = Math.max(0, Math.min(start, source.length))
  let hi = Math.max(lo, Math.min(end, source.length))
  if (lo === hi) return { start: lo, end: hi }

  const spans = collectMarkdownSpans(source)
  let changed = true
  while (changed) {
    changed = false
    for (const span of spans) {
      if (!EXPAND_TOKEN_TYPES.has(span.type)) continue
      if (span.end <= lo || span.start >= hi) continue
      if (span.start >= lo && span.end <= hi) continue
      if (span.start < lo) {
        lo = span.start
        changed = true
      }
      if (span.end > hi) {
        hi = span.end
        changed = true
      }
    }
  }

  return { start: lo, end: hi }
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

function rangeEdgeElement(container: Node): Element | null {
  return container.nodeType === Node.ELEMENT_NODE
    ? (container as Element)
    : container.parentElement
}

export function readKatexLatex(katexEl: Element): string | null {
  return (
    katexEl.getAttribute('data-latex') ??
    katexEl.querySelector('annotation[encoding="application/x-tex"]')?.textContent ??
    null
  )
}

/**
 * Expand a live Range so any intersecting `.katex` node is included in full.
 * Partial formula selections have no stable rendered substring, so we always
 * take the whole formula.
 */
export function expandRangeToKatexBoundaries(range: Range): Range {
  const expanded = range.cloneRange()
  const startKatex = rangeEdgeElement(range.startContainer)?.closest('.katex')
  const endKatex = rangeEdgeElement(range.endContainer)?.closest('.katex')
  if (startKatex) expanded.setStartBefore(startKatex)
  if (endKatex) expanded.setEndAfter(endKatex)
  return expanded
}

/**
 * If `range` is entirely inside a single `.katex` node, return the wrapped
 * TeX source. Otherwise null.
 */
export function recoverKatexFromRange(
  range: Range,
  sourceMarkdown: string | null,
): string | null {
  const startEl = rangeEdgeElement(range.startContainer)
  const endEl = rangeEdgeElement(range.endContainer)
  if (!startEl || !endEl) return null

  const startKatex = startEl.closest('.katex')
  const endKatex = endEl.closest('.katex')
  if (!startKatex || startKatex !== endKatex) return null

  const latex = readKatexLatex(startKatex)
  if (!latex) return null

  return wrapLatexSource(sourceMarkdown, latex)
}

/**
 * Serialize a range to text, substituting each `.katex` node with its wrapped
 * TeX source. Used for mixed selections (prose + formula) where
 * `selection.toString()` would otherwise emit rendered glyphs / MathML soup.
 */
export function serializeRangeWithLatex(
  range: Range,
  sourceMarkdown: string | null,
): string {
  const expanded = expandRangeToKatexBoundaries(range)
  const fragment = expanded.cloneContents()
  const katexNodes = fragment.querySelectorAll('.katex')
  if (katexNodes.length === 0) return expanded.toString()

  katexNodes.forEach(node => {
    const latex = readKatexLatex(node)
    const replacement = latex ? wrapLatexSource(sourceMarkdown, latex) : ''
    node.replaceWith(document.createTextNode(replacement))
  })

  return fragment.textContent ?? ''
}

function rangeIntersectsKatex(range: Range): boolean {
  const startKatex = rangeEdgeElement(range.startContainer)?.closest('.katex')
  const endKatex = rangeEdgeElement(range.endContainer)?.closest('.katex')
  if (startKatex || endKatex) return true

  const root = range.commonAncestorContainer
  const rootEl = rangeEdgeElement(root)
  if (!rootEl) return false
  return [...rootEl.querySelectorAll('.katex')].some(el => {
    try {
      return range.intersectsNode(el)
    } catch {
      return false
    }
  })
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
    const range = selection.getRangeAt(0)

    // Selection entirely inside one formula → just the wrapped TeX.
    const pureKatex = recoverKatexFromRange(range, source)
    if (pureKatex != null) return pureKatex

    // Mixed prose + formula: substitute TeX into the selected text first so
    // normalize-matching sees `\times` / `_l` instead of rendered glyphs.
    if (rangeIntersectsKatex(range)) {
      const withLatex = serializeRangeWithLatex(range, source)
      if (source) {
        const recovered = recoverMarkdownFromPlain(source, withLatex)
        if (recovered != null) return recovered
      }
      return withLatex
    }
  }

  if (source) {
    const recovered = recoverMarkdownFromPlain(source, plain)
    if (recovered != null) return recovered
  }

  return plain
}
