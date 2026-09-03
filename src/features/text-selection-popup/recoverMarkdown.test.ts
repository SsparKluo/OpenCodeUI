import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  expandMarkdownSlice,
  findUniqueIndex,
  normalizeForMatch,
  recoverKatexFromRange,
  recoverMarkdownFromPlain,
  recoverSelectionMarkdown,
  wrapLatexSource,
} from './recoverMarkdown'

describe('normalizeForMatch', () => {
  it('strips emphasis markers and collapses whitespace', () => {
    expect(normalizeForMatch('**bold** text').text).toBe('bold text')
    expect(normalizeForMatch('a   b\nc').text).toBe('a b c')
  })

  it('maps normalized characters back to raw offsets', () => {
    const { text, map } = normalizeForMatch('**ab**')
    expect(text).toBe('ab')
    expect(map).toEqual([2, 3])
  })
})

describe('findUniqueIndex', () => {
  it('returns the sole match and rejects duplicates / misses', () => {
    expect(findUniqueIndex('one two one', 'two')).toBe(4)
    expect(findUniqueIndex('one two one', 'one')).toBe(-1)
    expect(findUniqueIndex('abc', 'z')).toBe(-1)
  })
})

describe('recoverMarkdownFromPlain', () => {
  it('recovers emphasis wrappers around a unique content match', () => {
    expect(recoverMarkdownFromPlain('say **bold** please', 'bold')).toBe('**bold**')
  })

  it('recovers inline code fences around the selection', () => {
    expect(recoverMarkdownFromPlain('use `npm install` now', 'npm install')).toBe('`npm install`')
  })

  it('recovers a full markdown link from its label', () => {
    expect(recoverMarkdownFromPlain('see [docs](https://example.com) here', 'docs')).toBe(
      '[docs](https://example.com)',
    )
  })

  it('recovers an ATX heading including the # markers', () => {
    expect(recoverMarkdownFromPlain('# Title\n\nbody', 'Title')).toBe('# Title')
  })

  it('recovers a whole fenced code block when selecting inside it', () => {
    const source = 'intro\n```ts\nconst x = 1\n```\noutro'
    expect(recoverMarkdownFromPlain(source, 'const x = 1')).toBe('```ts\nconst x = 1\n```\n')
  })

  it('returns null when the selection is ambiguous in the source', () => {
    expect(recoverMarkdownFromPlain('foo bar foo', 'foo')).toBeNull()
  })

  it('returns null when rendered text cannot be located', () => {
    expect(recoverMarkdownFromPlain('hello **world**', 'missing')).toBeNull()
  })
})

describe('expandMarkdownSlice', () => {
  it('expands both * and ** emphasis symmetrically', () => {
    expect(expandMarkdownSlice('*hi*', 1, 3)).toEqual({ start: 0, end: 4 })
    expect(expandMarkdownSlice('**hi**', 2, 4)).toEqual({ start: 0, end: 6 })
  })
})

describe('wrapLatexSource', () => {
  it('prefers the delimiter already present in the source', () => {
    expect(wrapLatexSource('before $$E=mc^2$$ after', 'E=mc^2')).toBe('$$E=mc^2$$')
    expect(wrapLatexSource('inline $x+y$ here', 'x+y')).toBe('$x+y$')
    expect(wrapLatexSource('paren \\(a+b\\) ok', 'a+b')).toBe('\\(a+b\\)')
  })

  it('defaults to $$ for multiline and $ for inline when source is unknown', () => {
    expect(wrapLatexSource(null, 'x+y')).toBe('$x+y$')
    expect(wrapLatexSource(null, 'a\nb')).toBe('$$a\nb$$')
  })
})

describe('recoverKatexFromRange', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    document.body.removeChild(container)
  })

  it('returns wrapped TeX when the range is entirely inside one .katex node', () => {
    container.innerHTML = `
      <div data-md-source="use $$E=mc^2$$ please">
        <span class="katex">
          <span class="katex-mathml">
            <math>
              <annotation encoding="application/x-tex">E=mc^2</annotation>
            </math>
          </span>
          <span class="katex-html">E=mc2</span>
        </span>
      </div>
    `
    const html = container.querySelector('.katex-html')!
    const range = document.createRange()
    range.selectNodeContents(html)

    expect(recoverKatexFromRange(range, 'use $$E=mc^2$$ please')).toBe('$$E=mc^2$$')
  })

  it('returns null when the range spans outside a single katex node', () => {
    container.innerHTML = `
      <div>
        <span class="katex">
          <annotation encoding="application/x-tex">x</annotation>
          <span class="katex-html">x</span>
        </span>
        <span id="outside">more</span>
      </div>
    `
    const range = document.createRange()
    range.setStart(container.querySelector('.katex-html')!.firstChild!, 0)
    range.setEnd(container.querySelector('#outside')!.firstChild!, 4)
    expect(recoverKatexFromRange(range, null)).toBeNull()
  })
})

describe('recoverSelectionMarkdown', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    document.body.removeChild(container)
  })

  function selectText(el: Element) {
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    return selection
  }

  it('recovers markdown from data-md-source for a unique plain selection', () => {
    container.innerHTML = `
      <div data-md-source="hello **world** today">
        <p><strong id="sel">world</strong></p>
      </div>
    `
    const selection = selectText(container.querySelector('#sel')!)
    expect(recoverSelectionMarkdown(selection)).toBe('**world**')
  })

  it('falls back to plain selection text when recovery fails', () => {
    container.innerHTML = `
      <div data-md-source="aaa bbb aaa">
        <p id="sel">aaa</p>
      </div>
    `
    const selection = selectText(container.querySelector('#sel')!)
    expect(recoverSelectionMarkdown(selection)).toBe('aaa')
  })

  it('prefers katex annotation over plain matching', () => {
    container.innerHTML = `
      <div data-md-source="formula $x+y$ here">
        <span class="katex">
          <annotation encoding="application/x-tex">x+y</annotation>
          <span class="katex-html" id="sel">x+y</span>
        </span>
      </div>
    `
    const selection = selectText(container.querySelector('#sel')!)
    expect(recoverSelectionMarkdown(selection)).toBe('$x+y$')
  })
})
