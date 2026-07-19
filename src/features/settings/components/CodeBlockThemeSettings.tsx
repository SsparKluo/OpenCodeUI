import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingRow, SettingsSection } from './SettingsUI'
import { useTheme } from '../../../hooks'
import {
  AVAILABLE_CODE_BLOCK_THEMES,
  filterThemesByType,
  type CodeBlockThemeInfo,
} from '../../../lib/codeBlockThemes'
import { highlightHtmlInWorker } from '../../../lib/shikiWorkerClient'
import { ChevronDownIcon } from '../../../components/Icons'

// 共享的预览代码片段：覆盖关键字、字符串、注释、数字、函数调用、属性等常见 token
const PREVIEW_CODE = `// greet user by name
function greet(name: string): string {
  const message = \`Hello, \${name}!\`
  return message
}

const result = greet("world")
console.log(result)`

const PREVIEW_LANGUAGE = 'ts'

function themeDisplayName(id: string): string {
  return AVAILABLE_CODE_BLOCK_THEMES.find(t => t.id === id)?.displayName ?? id
}

// ============================================
// Theme select dropdown
// ============================================

function CodeBlockThemeSelect({
  value,
  onChange,
  type,
}: {
  value: string
  onChange: (id: string) => void
  type: 'light' | 'dark'
}) {
  // 同 type 的主题作为默认推荐组，其它 type 作为另一组放下面（用户仍可混搭）
  const sameType = useMemo(() => filterThemesByType(type), [type])
  const otherType = useMemo(() => filterThemesByType(type === 'light' ? 'dark' : 'light'), [type])

  return (
    <div className="relative inline-flex min-w-[180px]">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={`${type} code block theme`}
        className="appearance-none pl-2 pr-8 py-1 text-[length:var(--fs-sm)] bg-bg-200/50 border border-border-200 rounded-md text-text-100 focus:outline-none focus:border-accent-main-100/50 cursor-pointer max-w-[220px]"
      >
        <optgroup label={type === 'light' ? 'Light themes' : 'Dark themes'}>
          {sameType.map(t => (
            <option key={t.id} value={t.id} className="bg-bg-100 text-text-100">
              {t.displayName}
            </option>
          ))}
        </optgroup>
        <optgroup label={type === 'light' ? 'Dark themes' : 'Light themes'}>
          {otherType.map(t => (
            <option key={t.id} value={t.id} className="bg-bg-100 text-text-100">
              {t.displayName}
            </option>
          ))}
        </optgroup>
      </select>
      <ChevronDownIcon
        size={14}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-300"
      />
    </div>
  )
}

// ============================================
// Live preview using Shiki
// ============================================

function CodeBlockPreview({ themeId, label }: { themeId: string; label: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestKeyRef = useRef(0)

  useEffect(() => {
    const key = `preview-${themeId}`
    const myKey = ++requestKeyRef.current

    let cancelled = false
    highlightHtmlInWorker({
      key,
      text: PREVIEW_CODE,
      language: PREVIEW_LANGUAGE,
      theme: themeId as Parameters<typeof highlightHtmlInWorker>[0]['theme'],
    })
      .then(result => {
        if (cancelled || myKey !== requestKeyRef.current) return
        setHtml(result.html)
        setError(null)
      })
      .catch(err => {
        if (cancelled || myKey !== requestKeyRef.current) return
        setError(err instanceof Error ? err.message : String(err))
        setHtml(null)
      })

    return () => {
      cancelled = true
    }
  }, [themeId])

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <p className="text-[length:var(--fs-sm)] text-text-200">{label}</p>
        <p className="text-[length:var(--fs-xs)] text-text-500">{themeDisplayName(themeId)}</p>
      </div>
      <div className="rounded-md overflow-hidden border border-border-200/40 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)]">
        {html ? (
          <div
            className="shiki-preview-container overflow-x-auto"
            // shiki 返回的 <pre><code> 自带 inline style (bg/fg/color)，直接渲染
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : error ? (
          <div className="px-3 py-2 bg-bg-200 text-text-400">{error}</div>
        ) : (
          <pre className="px-3 py-2 bg-bg-200 text-text-400">
            <code>{PREVIEW_CODE}</code>
          </pre>
        )}
      </div>
    </div>
  )
}

// ============================================
// Main section
// ============================================

export function CodeBlockThemeSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const {
    codeBlockThemeLight,
    codeBlockThemeDark,
    setCodeBlockThemeLight,
    setCodeBlockThemeDark,
    resolvedTheme,
  } = useTheme()

  return (
    <SettingsSection title={t('appearance.codeBlockThemes')}>
      <p className="text-[length:var(--fs-sm)] text-text-400">{t('appearance.codeBlockThemesDesc')}</p>

      <SettingRow
        label={t('appearance.codeBlockThemeLight')}
        description={t('appearance.codeBlockThemeLightDesc')}
      >
        <CodeBlockThemeSelect
          value={codeBlockThemeLight}
          onChange={setCodeBlockThemeLight}
          type="light"
        />
      </SettingRow>

      <SettingRow
        label={t('appearance.codeBlockThemeDark')}
        description={t('appearance.codeBlockThemeDarkDesc')}
      >
        <CodeBlockThemeSelect
          value={codeBlockThemeDark}
          onChange={setCodeBlockThemeDark}
          type="dark"
        />
      </SettingRow>

      <div className="space-y-4">
        <CodeBlockPreview
          themeId={resolvedTheme === 'dark' ? codeBlockThemeDark : codeBlockThemeLight}
          label={
            resolvedTheme === 'dark'
              ? t('appearance.codeBlockPreviewDark')
              : t('appearance.codeBlockPreviewLight')
          }
        />
      </div>
    </SettingsSection>
  )
}

// 导出 unused type 仅用于未来扩展（被引用以避免 tree-shake 误删）
export type { CodeBlockThemeInfo }
