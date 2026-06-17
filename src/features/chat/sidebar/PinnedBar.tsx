import { useSyncExternalStore, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PencilIcon, PinIcon } from '../../../components/Icons'
import { pinnedSessionsStore, type PinnedSessionEntry } from '../../../store/pinnedSessionsStore'
import { useSessionActiveEntry } from '../../../store/activeSessionStore'
import { useHasUnreadCompletedNotification } from '../../../store/notificationStore'
import { formatRelativeTime } from '../../../utils/dateUtils'
import type { ApiSession } from '../../../api'

interface PinnedBarProps {
  sessionLookup: Map<string, ApiSession>
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (sessionId: string, newTitle: string) => void
}

export function PinnedBar({ sessionLookup, selectedSessionId, onSelectSession, onRenameSession }: PinnedBarProps) {
  const entries = useSyncExternalStore(
    pinnedSessionsStore.subscribe,
    pinnedSessionsStore.getSnapshot,
  )

  if (!entries || entries.length === 0) return null

  return (
    <div className="mx-2 mt-1 mb-1 rounded-[12px] bg-bg-100/60 ring-1 ring-border-200/30 px-1 py-1">
      {entries.map(entry => (
        <PinnedItem
          key={entry.sessionId}
          entry={entry}
          resolvedSession={sessionLookup.get(entry.sessionId)}
          isSelected={entry.sessionId === selectedSessionId}
          onSelect={onSelectSession}
          onRename={onRenameSession}
        />
      ))}
    </div>
  )
}

interface PinnedItemProps {
  entry: PinnedSessionEntry
  resolvedSession?: ApiSession
  isSelected: boolean
  onSelect: (session: ApiSession) => void
  onRename: (sessionId: string, newTitle: string) => void
}

function PinnedItem({ entry, resolvedSession, isSelected, onSelect, onRename }: PinnedItemProps) {
  const { t } = useTranslation(['commands', 'common', 'chat'])
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(entry.title)
  const displayTitle = resolvedSession?.title || entry.title || entry.sessionId.slice(0, 12) + '...'

  // 活跃状态
  const activeEntry = useSessionActiveEntry(entry.sessionId)
  const activeStatus = activeEntry
    ? activeEntry.pendingAction?.type === 'permission'
      ? { dot: 'bg-warning-100', pulse: false }
      : activeEntry.pendingAction?.type === 'question'
        ? { dot: 'bg-info-100', pulse: false }
        : activeEntry.status.type === 'retry'
          ? { dot: 'bg-warning-100', pulse: false }
          : { dot: 'bg-success-100', pulse: true }
    : null
  const hasUnreadCompletedNotification = useHasUnreadCompletedNotification(entry.sessionId)
  const hasStats = Boolean(
    resolvedSession?.summary &&
    (resolvedSession.summary.additions > 0 || resolvedSession.summary.deletions > 0 || resolvedSession.summary.files > 0),
  )

  const handleClick = () => {
    if (isEditing) return
    if (resolvedSession) {
      onSelect(resolvedSession)
    }
  }

  const handleUnpin = (e: React.MouseEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).blur()
    pinnedSessionsStore.unpin(entry.sessionId)
  }

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditTitle(displayTitle)
    setIsEditing(true)
  }

  const handleSaveEdit = () => {
    const trimmed = editTitle.trim()
    if (trimmed && trimmed !== displayTitle) {
      onRename(entry.sessionId, trimmed)
    }
    setIsEditing(false)
  }

  const handleCancelEdit = () => {
    setEditTitle(displayTitle)
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveEdit()
    else if (e.key === 'Escape') handleCancelEdit()
  }

  if (isEditing) {
    return (
      <div className="px-2 py-1">
        <input
          type="text"
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          onBlur={handleSaveEdit}
          onKeyDown={handleKeyDown}
          onClick={e => e.stopPropagation()}
          className="w-full bg-bg-000 border border-accent-main-100/50 rounded px-2 py-1 text-[length:var(--fs-sm)] text-text-100 focus:outline-none focus:ring-1 focus:ring-accent-main-100/30"
        />
      </div>
    )
  }

  return (
    <div
      onClick={handleClick}
      className={`group relative flex items-start pl-[6px] pr-3 py-2 rounded-lg cursor-pointer transition-all duration-200 border border-transparent ${
        isSelected ? 'bg-bg-000 shadow-sm ring-1 ring-border-200/50' : 'hover:bg-bg-200/40'
      }`}
    >
      <div className="flex-1 min-w-0 mr-1 group-hover:mr-[56px] transition-[margin] duration-200">
        <p
          className={`text-[length:var(--fs-base)] truncate font-medium ${
            isSelected ? 'text-text-100' : 'text-text-200 group-hover:text-text-100'
          }`}
          title={displayTitle}
        >
          {displayTitle}
        </p>
        <div className="flex items-center mt-1.5 h-4 text-[length:var(--fs-xxs)] text-text-400 gap-1 overflow-hidden">
          {/* 活跃状态标记 */}
          {activeStatus ? (
            <>
              <span className="relative shrink-0 flex items-center justify-center w-3 h-3">
                <span className={`absolute w-1.5 h-1.5 rounded-full ${activeStatus.dot}`} />
                {activeStatus.pulse && (
                  <span className={`absolute w-1.5 h-1.5 rounded-full ${activeStatus.dot} animate-ping opacity-50`} />
                )}
              </span>
              <span className="opacity-30 shrink-0">·</span>
            </>
          ) : hasUnreadCompletedNotification ? (
            <>
              <span className="relative shrink-0 flex items-center justify-center w-3 h-3" title={t('chat:notification.completed')}>
                <span className="absolute w-1.5 h-1.5 rounded-full bg-accent-main-100" />
              </span>
              <span className="opacity-30 shrink-0">·</span>
            </>
          ) : null}
          {/* 时间 */}
          {resolvedSession?.time?.updated && (
            <span className="shrink-0 opacity-60">{formatRelativeTime(resolvedSession.time.updated)}</span>
          )}
          {/* Stats */}
          {hasStats && resolvedSession?.summary && (
            <>
              <span className="opacity-30">·</span>
              <span className="shrink-0 opacity-50">
                +{resolvedSession.summary.additions}/-{resolvedSession.summary.deletions}
              </span>
              {resolvedSession.summary.files > 0 && (
                <>
                  <span className="opacity-30">·</span>
                  <span className="shrink-0 opacity-50">{resolvedSession.summary.files} files</span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity duration-150 z-10">
        <button
          type="button"
          onClick={handleStartEdit}
          className="p-1 rounded hover:bg-bg-300 text-text-500 hover:text-text-200 transition-colors"
          title={t('sessions.rename')}
        >
          <PencilIcon className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={handleUnpin}
          className="p-1 rounded text-accent-main-100 hover:text-accent-main-200 transition-colors"
          title={t('sessions.unpin')}
        >
          <PinIcon className="w-3 h-3" />
        </button>
      </div>
    </div>
  )
}
