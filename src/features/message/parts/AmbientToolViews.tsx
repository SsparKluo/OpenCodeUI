import { memo, useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ToolPart, StepFinishPart } from '../../../types/message'
import { useDelayedRender } from '../../../hooks'
import { formatToolName, formatDuration } from '../../../utils/formatUtils'
import {
  extractToolData,
  getToolConfig,
  getToolCategory,
  DefaultRenderer,
  TodoRenderer,
  TaskRenderer,
  hasTodos,
  categorizeTools,
} from '../tools'
import { SmoothHeight } from '../../../components/ui'
import { StepFinishPartView } from './StepFinishPartView'
import { useAmbientPermission, findPermissionForTool, findQuestionForTool } from '../../chat/AmbientPermissionContext'
import { InlinePermission } from '../../chat/InlinePermission'
import { InlineQuestion } from '../../chat/InlineQuestion'

// ============================================
// AmbientToolGroup — 融入正文的工具调用摘要
//
// 设计原则：
// 1. 和正文同字号、同行高、同 font-family、同字体样式
// 2. 用 text-300 略淡于正文，但不跳出阅读流
// 3. running 时用 reasoning-shimmer-text 扫光动画
// 4. 错误信息自然融入句子："执行了 8 次，失败 1 次"
// 5. 没有 icon、没有箭头、没有控件外观
// ============================================

interface AmbientToolGroupProps {
  parts: ToolPart[]
  stepFinish?: StepFinishPart
  duration?: number
  turnDuration?: number
  isStreaming?: boolean
}

export const AmbientToolGroup = memo(function AmbientToolGroup({
  parts,
  stepFinish,
  duration,
  turnDuration,
  isStreaming,
}: AmbientToolGroupProps) {
  const { t } = useTranslation('message')

  const hasRunning = parts.some(p => p.state.status === 'running' || p.state.status === 'pending')
  const errorCount = parts.filter(p => p.state.status === 'error').length

  // 如果组内有 pending 权限/提问，强制展开（用户必须交互，不可收起）
  const { pendingPermissions, pendingQuestions } = useAmbientPermission()
  const hasPendingInteraction = parts.some(
    p => findPermissionForTool(pendingPermissions, p.callID) || findQuestionForTool(pendingQuestions, p.callID),
  )

  // 编辑/写入/执行类工具完成后——仅作为初始值展开，用户可以手动收起
  const hasSideEffectDone = parts.some(p => {
    const cat = getToolCategory(p.tool)
    return (cat === 'edit' || cat === 'execute') && (p.state.status === 'completed' || p.state.status === 'error')
  })

  const [expanded, setExpanded] = useState(hasSideEffectDone)
  // 只有 pending 交互强制展开，其他靠 state
  const effectiveExpanded = expanded || hasPendingInteraction
  const shouldRenderBody = useDelayedRender(effectiveExpanded)

  // 按状态分组统计
  const summaryText = useMemo(() => {
    const doneParts = parts.filter(p => p.state.status === 'completed' || p.state.status === 'error')
    const activeParts = parts.filter(p => p.state.status === 'running' || p.state.status === 'pending')

    const segments: string[] = []

    // 已完成的——完成时
    if (doneParts.length > 0) {
      const cats = categorizeTools(doneParts.map(p => p.tool))
      segments.push(cats.map(({ category, count }) => t(`ambient.${category}`, { count })).join(t('ambient.separator')))
    }

    // 进行中的——进行时
    if (activeParts.length > 0) {
      const cats = categorizeTools(activeParts.map(p => p.tool))
      segments.push(
        cats
          .map(({ category, count }) =>
            t(`ambient.${category}_active`, { count, defaultValue: t(`ambient.${category}`, { count }) }),
          )
          .join(t('ambient.separator')),
      )
    }

    let text = segments.join(t('ambient.separator'))

    if (errorCount > 0) {
      text += t('ambient.errorSuffix', { count: errorCount })
    }

    if (hasRunning) {
      text += t('ambient.runningSuffix')
    }

    return text
  }, [parts, errorCount, hasRunning, t])

  return (
    <SmoothHeight isActive={!!isStreaming}>
      <div className="py-0.5">
        {/* 摘要 — 纯文字，点击展开 */}
        <span
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(!expanded)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded)
          }}
          aria-expanded={effectiveExpanded}
          className={`text-sm leading-relaxed cursor-pointer hover:text-text-200 transition-colors ${
            hasRunning ? 'reasoning-shimmer-text' : 'text-text-300'
          }`}
        >
          {summaryText}
        </span>

        {/* 展开后的工具详情列表 */}
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
            effectiveExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="min-h-0 min-w-0 overflow-hidden" style={{ clipPath: 'inset(0 -100% 0 -100%)' }}>
            {shouldRenderBody && (
              <div className="pt-1.5 flex flex-col gap-0.5">
                {parts.map(part => (
                  <AmbientToolItem key={part.id} part={part} />
                ))}
              </div>
            )}
          </div>
        </div>

        {stepFinish && (
          <div className="mt-1">
            <StepFinishPartView part={stepFinish} duration={duration} turnDuration={turnDuration} />
          </div>
        )}
      </div>
    </SmoothHeight>
  )
})

// ============================================
// AmbientToolItem — 展开后的单个工具行
// 依然是文字风格，不是卡片，没有箭头
// ============================================

const AmbientToolItem = memo(function AmbientToolItem({ part }: { part: ToolPart }) {
  // 有副作用的工具（编辑/写入/执行）完成后默认展开，方便审查
  const category = getToolCategory(part.tool)
  const hasSideEffect = category === 'edit' || category === 'execute'
  const isFinished = part.state.status === 'completed' || part.state.status === 'error'
  const [expanded, setExpanded] = useState(hasSideEffect && isFinished)
  const shouldRenderBody = useDelayedRender(expanded)

  const { state, tool: toolName } = part
  const title = state.title || ''
  const dur = state.time?.start && state.time?.end ? state.time.end - state.time.start : undefined
  const isActive = state.status === 'running' || state.status === 'pending'
  const isError = state.status === 'error'

  // 关联的权限请求 / 提问请求
  const { pendingPermissions, pendingQuestions, onPermissionReply, onQuestionReply, onQuestionReject, isReplying } =
    useAmbientPermission()
  const permissionRequest = findPermissionForTool(pendingPermissions, part.callID)
  const questionRequest = findQuestionForTool(pendingQuestions, part.callID)

  // 有 pending question/permission 时，跳过工具名行，直接渲染 inline UI
  // 摘要里已经说了"正在提问"/"正在执行"，这里不需要再重复工具名
  if (permissionRequest) {
    return (
      <div className="min-w-0">
        <InlinePermission request={permissionRequest} onReply={onPermissionReply} isReplying={isReplying} />
      </div>
    )
  }

  if (questionRequest) {
    return (
      <div className="min-w-0">
        <InlineQuestion
          request={questionRequest}
          onReply={onQuestionReply}
          onReject={onQuestionReject}
          isReplying={isReplying}
        />
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <span
        role="button"
        tabIndex={0}
        className="group/item inline-flex items-baseline gap-1.5 w-full text-left py-0.5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded)
        }}
        aria-expanded={expanded}
      >
        {/* 工具名 */}
        <span
          className={`text-[12px] leading-5 shrink-0 ${
            isActive
              ? 'reasoning-shimmer-text'
              : isError
                ? 'text-danger-100'
                : 'text-text-400 group-hover/item:text-text-300'
          }`}
        >
          {formatToolName(toolName)}
        </span>

        {/* title / file path */}
        {title && (
          <span className="text-[12px] leading-5 text-text-400 truncate min-w-0 flex-1 opacity-60">{title}</span>
        )}

        {/* 状态 */}
        <span className="inline-flex items-center gap-1.5 ml-auto shrink-0">
          {dur !== undefined && state.status === 'completed' && (
            <span className="text-[11px] text-text-500 tabular-nums">{formatDuration(dur)}</span>
          )}
        </span>
      </span>

      {/* 可展开的详情 */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="min-h-0 min-w-0 overflow-hidden" style={{ clipPath: 'inset(0 -100% 0 -100%)' }}>
          {shouldRenderBody && (
            <div className="pb-1.5 pt-0.5">
              <AmbientToolBody part={part} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
})

// ============================================
// AmbientToolBody — 复用现有 renderer，沉浸模式只去掉 input
// edit/write 的 diff、files、diagnostics 全部保留
// ============================================

function AmbientToolBody({ part }: { part: ToolPart }) {
  const { tool } = part
  const lowerTool = tool.toLowerCase()
  const data = extractToolData(part)

  // Task 和 Todo 保持原有 renderer
  if (lowerTool === 'task') {
    return <TaskRenderer part={part} data={data} />
  }

  if (lowerTool.includes('todo') && hasTodos(part)) {
    return <TodoRenderer part={part} data={data} />
  }

  // 其他工具：用 DefaultRenderer 的 ambientMode，去掉 input，保留完整 output
  const config = getToolConfig(tool)
  if (config?.renderer) {
    const CustomRenderer = config.renderer
    return <CustomRenderer part={part} data={data} />
  }

  return <DefaultRenderer part={part} data={data} ambientMode />
}

// (end of file)
