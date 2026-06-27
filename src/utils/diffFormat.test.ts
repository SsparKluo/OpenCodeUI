import { describe, expect, it } from 'vitest'
import { buildUnifiedDiff } from './diffFormat'

describe('buildUnifiedDiff', () => {
  it('produces a git-style unified diff with headers', () => {
    const result = buildUnifiedDiff('const x = 1\nconst y = 2', 'const x = 1\nconst y = 99', 'src/foo.ts')

    expect(result).toContain('Index: src/foo.ts')
    expect(result).toContain('--- src/foo.ts')
    expect(result).toContain('+++ src/foo.ts')
    expect(result).toContain('@@')
    expect(result).toContain('-const y = 2')
    expect(result).toContain('+const y = 99')
  })

  it('falls back to "file" when no path is provided', () => {
    const result = buildUnifiedDiff('a', 'b')

    expect(result).toContain('Index: file')
  })

  it('handles empty before (new file) as all-additions', () => {
    const result = buildUnifiedDiff('', 'line a\nline b', 'new.ts')

    expect(result).toContain('+line a')
    expect(result).toContain('+line b')
    expect(result).not.toContain('-line a')
  })

  it('converts an absolute filePath to a path relative to projectDirectory', () => {
    const result = buildUnifiedDiff('a', 'b', '/repo/src/foo.ts', '/repo')

    expect(result).toContain('Index: src/foo.ts')
    expect(result).toContain('--- src/foo.ts')
    expect(result).toContain('+++ src/foo.ts')
    expect(result).not.toContain('/repo/')
  })

  it('preserves the filePath when it does not live under projectDirectory', () => {
    const result = buildUnifiedDiff('a', 'b', '/other/src/foo.ts', '/repo')

    expect(result).toContain('Index: /other/src/foo.ts')
  })

  it('preserves the filePath when projectDirectory is missing', () => {
    const result = buildUnifiedDiff('a', 'b', '/repo/src/foo.ts')

    expect(result).toContain('Index: /repo/src/foo.ts')
  })

  it('preserves the filePath when the filePath is already relative', () => {
    const result = buildUnifiedDiff('a', 'b', 'src/foo.ts', '/repo')

    expect(result).toContain('Index: src/foo.ts')
  })

  it('handles Windows-style absolute paths case-insensitively', () => {
    const result = buildUnifiedDiff('a', 'b', 'C:\\Repo\\src\\foo.ts', 'C:\\repo')

    expect(result).toContain('Index: src\\foo.ts')
  })
})
