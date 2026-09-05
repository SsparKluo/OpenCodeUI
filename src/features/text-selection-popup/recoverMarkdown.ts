/**
 * Recover raw Markdown for a rendered text selection.
 *
 * Strategy:
 *  1. If the selection sits entirely inside a KaTeX node, return the TeX
 *     source from `data-latex` / MathML annotation, re-wrapped with the
 *     delimiter found in `sourceMarkdown`.
 *  2. Otherwise normalize away Markdown punctuation + collapse whitespace,
 *     uniquely locate the selection in the source, then rebuild the slice
 *     from the marked AST: fully covered wrapper tokens are emitted
 *     verbatim, partially covered ones re-emit only their markers around
 *     the selected content (`**something**` + select `thing` → `**thing**`).
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

type EmitSpan = {
  /** Absolute [start, end) of `token.raw` in the source. */
  start: number
  end: number
  /** Marker text before the token content ('**', '`', '[', '# ', '> '). */
  open: string
  /** Marker text after the token content ('**', '`', '](url)', '\n'). */
  close: string
  /** Close must always be emitted, even when the selection stops early. */
  closeRequired: boolean
  /** Unknown marker shape → fall back to emitting the whole raw on overlap. */
  verbatim: boolean
  children: EmitSpan[]
}

/**
 * Token types whose `raw` adds markers outside the visible text. Transparent
 * containers like `paragraph` / `list` are excluded so a partial selection
 * does not swallow the whole block.
 */
const WRAPPER_TOKEN_TYPES = new Set([
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

/** Detect a run delimiter (`*`/`_`/`~`) usable on both ends, capped per type. */
function detectRunMarkers(raw: string, cap: number): { open: string; close: string } | null {
  const ch = raw[0]
  if (ch !== '*' && ch !== '_' && ch !== '~') return null
  let openLen = 0
  while (raw[openLen] === ch) openLen++
  let closeLen = 0
  while (raw[raw.length - 1 - closeLen] === ch) closeLen++
  const len = Math.min(openLen, closeLen, cap)
  if (len < 1) return null
  const marker = ch.repeat(len)
  return { open: marker, close: marker }
}

function detectCodespanMarkers(raw: string): { open: string; close: string } | null {
  if (raw[0] !== '`') return null
  let openLen = 0
  while (raw[openLen] === '`') openLen++
  let closeLen = 0
  while (raw[raw.length - 1 - closeLen] === '`') closeLen++
  const len = Math.min(openLen, closeLen)
  if (len < 1) return null
  const marker = '`'.repeat(len)
  return { open: marker, close: marker }
}

function detectLinkMarkers(raw: string, isImage: boolean): { open: string; close: string } | null {
  const open = isImage ? raw.slice(0, 2) : raw.slice(0, 1)
  if (open !== (isImage ? '![' : '[')) return null
  const closeIdx = raw.lastIndexOf('](')
  if (closeIdx === -1 || closeIdx < open.length || !raw.endsWith(')')) return null
  return { open, close: raw.slice(closeIdx) }
}

function detectMarkers(token: Token, raw: string): Omit<EmitSpan, 'start' | 'end' | 'children'> | null {
  const blockClose = raw.endsWith('\n') ? '\n' : ''
  switch (token.type) {
    case 'strong': {
      const m = detectRunMarkers(raw, 2)
      return m && { ...m, closeRequired: true, verbatim: false }
    }
    case 'em': {
      const m = detectRunMarkers(raw, 1)
      return m && { ...m, closeRequired: true, verbatim: false }
    }
    case 'del': {
      const m = detectRunMarkers(raw, 2)
      return m && { ...m, closeRequired: true, verbatim: false }
    }
    case 'codespan': {
      const m = detectCodespanMarkers(raw)
      return m && { ...m, closeRequired: true, verbatim: false }
    }
    case 'link': {
      const m = detectLinkMarkers(raw, false)
      return m && { ...m, closeRequired: true, verbatim: false }
    }
    case 'image': {
      const m = detectLinkMarkers(raw, true)
      return m && { ...m, closeRequired: true, verbatim: false }
    }
    case 'heading': {
      const m = /^#{1,6}(?:[ \t]+|$)/.exec(raw)
      return m && { open: m[0], close: '', closeRequired: false, verbatim: false }
    }
    case 'blockquote': {
      const m = /^>[ \t]?/.exec(raw)
      return m && { open: m[0], close: blockClose, closeRequired: false, verbatim: false }
    }
    case 'list_item': {
      const m = /^\s*(?:[-+*]|\d+[.)])(?:[ \t]+\[[ xX]\])?[ \t]+/.exec(raw)
      return m && { open: m[0], close: blockClose, closeRequired: false, verbatim: false }
    }
    case 'code': {
      const lines = raw.split('\n')
      let last = lines.length - 1
      while (last > 0 && lines[last] === '') last--
      const fence = /^\s*(`{3,}|~{3,})/
      if (lines.length >= 2 && fence.test(lines[0]!) && fence.test(lines[last]!)) {
        const tail = '\n'.repeat(lines.length - 1 - last)
        return {
          open: `${lines[0]}\n`,
          close: `\n${lines[last]}${tail}`,
          closeRequired: true,
          verbatim: false,
        }
      }
      // Indented code has per-line markers we do not reconstruct.
      return { open: '', close: '', closeRequired: false, verbatim: true }
    }
    default:
      return null
  }
}

/**
 * Walk marked's lexer output and build a forest of wrapper spans with
 * absolute [start, end) offsets. Children are placed by searching for their
 * `raw` inside the parent's raw (unique within that parent). Tokens whose
 * marker shape cannot be detected become verbatim spans.
 */
function buildSpanForest(source: string): EmitSpan[] {
  const forest: EmitSpan[] = []

  const visit = (tokens: Token[], parentStart: number, parentRaw: string, out: EmitSpan[]) => {
    let cursor = 0
    for (const token of tokens) {
      const raw = typeof token.raw === 'string' ? token.raw : ''
      if (!raw) continue

      let rel = parentRaw.indexOf(raw, cursor)
      if (rel === -1) rel = parentRaw.indexOf(raw)
      if (rel === -1) continue

      const start = parentStart + rel
      const end = start + raw.length
      cursor = rel + raw.length

      const children: EmitSpan[] = []
      const nested = childTokens(token)
      if (nested && nested.length > 0) visit(nested, start, raw, children)

      if (WRAPPER_TOKEN_TYPES.has(token.type)) {
        const markers = detectMarkers(token, raw)
        if (markers) {
          out.push({ start, end, children, ...markers })
          continue
        }
      }
      out.push(...children)
    }
  }

  visit(marked.lexer(source) as Token[], 0, source, forest)
  return forest
}

/**
 * Emit the source slice [lo, hi) as markdown: fully covered spans verbatim,
 * partially covered wrappers as open + selected content + close. Gaps and
 * children that did not place flow through as raw source slices (which keeps
 * per-line prefixes like `> ` on blockquote continuation lines).
 */
function emitSpanSlice(spans: EmitSpan[], lo: number, hi: number, source: string): string {
  let out = ''
  let cursor = lo
  for (const span of spans) {
    if (span.end <= lo || span.start >= hi) continue
    if (span.start > cursor) out += source.slice(cursor, Math.min(span.start, hi))

    if (span.verbatim || (span.start >= lo && span.end <= hi)) {
      out += source.slice(span.start, span.end)
      cursor = span.end
      continue
    }

    const contentStart = span.start + span.open.length
    const contentEnd = span.end - span.close.length
    const from = Math.max(lo, contentStart)
    const to = Math.min(hi, contentEnd)
    cursor = Math.min(hi, span.end)
    // Selection only covered markers — nothing meaningful to wrap.
    if (to <= from) continue

    out += span.open
    out += emitSpanSlice(span.children, from, to, source)
    if (span.closeRequired || hi >= span.end) out += span.close
  }
  if (cursor < hi) out += source.slice(cursor, hi)
  return out
}

/**
 * Rebuild the raw markdown for a content range [start, end): wrapper tokens
 * partially covered by the range contribute their markers around the covered
 * content only, never the unselected remainder of the token.
 */
export function renderMarkdownSlice(source: string, start: number, end: number): string {
  const lo = Math.max(0, Math.min(start, source.length))
  const hi = Math.max(lo, Math.min(end, source.length))
  if (lo === hi) return source.slice(lo, hi)
  return emitSpanSlice(buildSpanForest(source), lo, hi, source)
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

  return renderMarkdownSlice(sourceMarkdown, raw.start, raw.end)
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
