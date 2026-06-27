import { createPatch } from 'diff'
import { isAbsolutePath } from './directoryUtils'

/**
 * Build a unified diff patch string for clipboard copying.
 *
 * Output is compatible with `git apply` / `patch -p1` and mirrors what
 * the user would see from `git diff` for the same change.
 *
 * @param before Original file content (may be empty for newly created files)
 * @param after Modified file content
 * @param filePath Used for the `Index:`, `---`, and `+++` headers. Falls back
 *                 to `'file'` when the caller has no filename.
 * @param projectDirectory Optional session project root. When both `filePath`
 *                         and `projectDirectory` are absolute and `filePath`
 *                         lives under `projectDirectory`, the diff header uses
 *                         the relative path so the output matches `git diff`
 *                         behavior.
 */
export function buildUnifiedDiff(before: string, after: string, filePath?: string, projectDirectory?: string): string {
  const name = toRelativePath(filePath, projectDirectory) ?? 'file'
  return createPatch(name, before, after, undefined, undefined, { context: 3 })
}

/**
 * Convert an absolute file path to a path relative to `projectDirectory`
 * when possible. Returns `undefined` when the conversion can't be done
 * safely, so callers can fall back to the original path.
 */
function toRelativePath(filePath: string | undefined, projectDirectory?: string): string | undefined {
  const raw = filePath?.trim()
  if (!raw) return undefined
  if (!projectDirectory || !isAbsolutePath(raw) || !isAbsolutePath(projectDirectory)) {
    return raw
  }

  const relative = makeRelative(raw, projectDirectory)
  return relative ?? raw
}

/**
 * Compute a path relative to `root`, matching on the longest common
 * directory prefix. Returns `null` if `path` doesn't actually live under
 * `root` (e.g. it's a sibling project or symlinked elsewhere).
 */
function makeRelative(path: string, root: string): string | null {
  const pathSep = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const rootSep = pathSep

  const normalize = (p: string, sep: string) => {
    const trimmed = p.replace(/[\\/]+$/, '')
    return sep === '\\' ? trimmed.toLowerCase().replace(/\//g, '\\') : trimmed
  }

  const normPath = normalize(path, pathSep)
  const normRoot = normalize(root, rootSep)

  if (pathSep === '\\') {
    // Windows: case-insensitive
    if (normPath === normRoot) return ''
    const rootWithSep = normRoot + '\\'
    if (!normPath.startsWith(rootWithSep)) return null
    return normPath.slice(rootWithSep.length)
  }

  if (normPath === normRoot) return ''
  const rootWithSep = normRoot + '/'
  if (!normPath.startsWith(rootWithSep)) return null
  return normPath.slice(rootWithSep.length)
}
