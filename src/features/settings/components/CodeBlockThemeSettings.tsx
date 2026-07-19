import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDownIcon } from '../../../components/Icons'
import { useTheme } from '../../../hooks'
import {
  AVAILABLE_CODE_BLOCK_THEMES,
  filterThemesByType,
} from '../../../lib/codeBlockThemes'
import { highlightHtmlInWorker } from '../../../lib/shikiWorkerClient'
import { SettingRow, SettingsSection, settingsFieldClass } from './SettingsUI'

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

function CodeBlockThemeSelect({
  value,
  onChange,
  type,
  ariaLabel,
  sameTypeLabel,
  otherTypeLabel,
}: {
  value: string
  onChange: (id: string) => void
  type: 'light' | 'dark'
  ariaLabel: string
  sameTypeLabel: string
  otherTypeLabel: string
}) {
  const sameType = useMemo(() => filterThemesByType(type), [type])
  const otherType = useMemo(() => filterThemesByType(type === 'light' ? 'dark' : 'light'), [type])

  return (
    <div className="relative inline-flex min-w-[11.5rem] max-w-[14rem]">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={`${settingsFieldClass} appearance-none cursor-pointer pr-8`}
      >
        <optgroup label={sameTypeLabel}>
          {sameType.map(theme => (
            <option key={theme.id} value={theme.id}>
              {theme.displayName}
            </option>
          ))}
        </optgroup>
        <optgroup label={otherTypeLabel}>
          {otherType.map(theme => (
            <option key={theme.id} value={theme.id}>
              {theme.displayName}
            </option>
          ))}
        </optgroup>
      </select>
      <ChevronDownIcon
        size={14}
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-text-400"
      />
    </div>
  )
}

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
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[length:var(--fs-sm)] font-medium text-text-100">{label}</p>
        <p className="text-[length:var(--fs-xs)] text-text-400 truncate">{themeDisplayName(themeId)}</p>
      </div>
      <div className="overflow-hidden rounded-md border border-border-200/50 text-[length:var(--fs-code)] leading-[var(--fs-code-line-height)]">
        {html ? (
          <div
            className="shiki-preview-container overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : error ? (
          <div className="px-3 py-2 bg-bg-200/40 text-text-400">{error}</div>
        ) : (
          <pre className="px-3 py-2 bg-bg-200/40 text-text-400">
            <code>{PREVIEW_CODE}</code>
          </pre>
        )}
      </div>
    </div>
  )
}

export function CodeBlockThemeSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const {
    codeBlockThemeLight,
    codeBlockThemeDark,
    setCodeBlockThemeLight,
    setCodeBlockThemeDark,
    resolvedTheme,
  } = useTheme()

  const lightGroupLabel = t('appearance.codeBlockThemeGroupLight')
  const darkGroupLabel = t('appearance.codeBlockThemeGroupDark')

  return (
    <SettingsSection title={t('appearance.codeBlockThemes')} description={t('appearance.codeBlockThemesDesc')}>
      <SettingRow label={t('appearance.codeBlockThemeLight')} description={t('appearance.codeBlockThemeLightDesc')}>
        <CodeBlockThemeSelect
          value={codeBlockThemeLight}
          onChange={setCodeBlockThemeLight}
          type="light"
          ariaLabel={t('appearance.codeBlockThemeLight')}
          sameTypeLabel={lightGroupLabel}
          otherTypeLabel={darkGroupLabel}
        />
      </SettingRow>

      <SettingRow label={t('appearance.codeBlockThemeDark')} description={t('appearance.codeBlockThemeDarkDesc')}>
        <CodeBlockThemeSelect
          value={codeBlockThemeDark}
          onChange={setCodeBlockThemeDark}
          type="dark"
          ariaLabel={t('appearance.codeBlockThemeDark')}
          sameTypeLabel={darkGroupLabel}
          otherTypeLabel={lightGroupLabel}
        />
      </SettingRow>

      <CodeBlockPreview
        themeId={resolvedTheme === 'dark' ? codeBlockThemeDark : codeBlockThemeLight}
        label={
          resolvedTheme === 'dark'
            ? t('appearance.codeBlockPreviewDark')
            : t('appearance.codeBlockPreviewLight')
        }
      />
    </SettingsSection>
  )
}
