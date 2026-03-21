/**
 * InlinePermission — 融入信息流的权限确认
 *
 * 复用 ContentBlock ambient variant，跟工具调用结果的渲染风格完全统一。
 * 操作按钮紧跟 ContentBlock 下方。
 */

import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiPermissionRequest, PermissionReply } from '../../api'
import { ContentBlock } from '../../components'
import { autoApproveStore } from '../../store'

interface InlinePermissionProps {
  request: ApiPermissionRequest
  onReply: (requestId: string, reply: PermissionReply) => void
  isReplying: boolean
}

export const InlinePermission = memo(function InlinePermission({
  request,
  onReply,
  isReplying,
}: InlinePermissionProps) {
  const { t } = useTranslation(['chat', 'common'])

  const metadata = request.metadata
  const diff = metadata?.diff as string | undefined
  const filepath = metadata?.filepath as string | undefined

  let diffData: { before: string; after: string } | string | undefined
  if (metadata?.filediff && typeof metadata.filediff === 'object') {
    const fd = metadata.filediff as Record<string, unknown>
    if (fd.before !== undefined && fd.after !== undefined) {
      diffData = { before: String(fd.before), after: String(fd.after) }
    }
  }
  if (!diffData && diff) {
    diffData = diff
  }

  const isFileEdit = request.permission === 'edit' || request.permission === 'write'
  const hasPatterns = request.patterns && request.patterns.length > 0
  const patternsText = hasPatterns ? request.patterns.map(p => p.replace(/\\n/g, '\n')).join('\n\n') : ''

  const handleAlways = () => {
    if (autoApproveStore.enabled) {
      const rulePatterns = [...(request.always || []), ...(request.patterns || [])]
      const unique = [...new Set(rulePatterns)]
      if (unique.length > 0) {
        autoApproveStore.addRules(request.sessionID, request.permission, unique)
        onReply(request.id, 'once')
        return
      }
    }
    onReply(request.id, 'always')
  }

  return (
    <div className="space-y-2">
      {/* 内容 — 复用 ContentBlock ambient variant，和工具调用结果一致 */}
      {isFileEdit && diffData ? (
        <ContentBlock
          label={request.permission}
          filePath={filepath}
          diff={diffData}
          variant="ambient"
          collapsible={false}
          maxHeight={150}
        />
      ) : patternsText ? (
        <ContentBlock
          label={request.permission}
          content={patternsText}
          language="bash"
          variant="ambient"
          collapsible={false}
          maxHeight={120}
        />
      ) : null}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onReply(request.id, 'once')}
          disabled={isReplying}
          className="px-2.5 py-0.5 rounded text-[12px] font-medium bg-text-100 text-bg-000 hover:bg-text-200 transition-colors disabled:opacity-50"
        >
          {t('permissionDialog.allowOnce')}
        </button>
        <button
          onClick={handleAlways}
          disabled={isReplying}
          className="px-2.5 py-0.5 rounded text-[12px] text-text-300 hover:text-text-100 transition-colors disabled:opacity-50"
        >
          {t('permissionDialog.alwaysAllow')}
        </button>
        <button
          onClick={() => onReply(request.id, 'reject')}
          disabled={isReplying}
          className="px-2.5 py-0.5 rounded text-[12px] text-text-400 hover:text-danger-100 transition-colors disabled:opacity-50"
        >
          {t('common:reject')}
        </button>
      </div>
    </div>
  )
})
