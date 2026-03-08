import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ApiSession } from '../../../api'
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, SpinnerIcon } from '../../../components/Icons'
import { useSessions } from '../../../hooks'
import { useInView } from '../../../hooks/useInView'
import { getDirectoryName, isSameDirectory } from '../../../utils'
import { SessionList } from '../../sessions'

const DIRECTORY_PAGE_SIZE = 8
const MAX_VISIBLE_SESSIONS = 6
const SESSION_LIST_MAX_HEIGHT = MAX_VISIBLE_SESSIONS * 56 + 12
const NOOP = () => {}

export interface FolderRecentProject {
  id: string
  name: string
  worktree: string
}

interface FolderRecentListProps {
  projects: FolderRecentProject[]
  currentDirectory?: string
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onDeleteSession: (session: ApiSession) => Promise<void>
}

function getInitialExpandedProjects(projects: FolderRecentProject[], currentDirectory?: string): string[] {
  if (projects.length === 0) return []

  const currentProject = currentDirectory
    ? projects.find(project => isSameDirectory(project.worktree, currentDirectory))
    : undefined

  return [currentProject?.id || projects[0].id]
}

export function FolderRecentList({
  projects,
  currentDirectory,
  selectedSessionId,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}: FolderRecentListProps) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() =>
    getInitialExpandedProjects(projects, currentDirectory),
  )

  useEffect(() => {
    setExpandedProjectIds(prev => {
      const next = prev.filter(id => projects.some(project => project.id === id))
      if (next.length > 0) return next
      return getInitialExpandedProjects(projects, currentDirectory)
    })
  }, [projects, currentDirectory])

  useEffect(() => {
    if (!currentDirectory) return
    const currentProject = projects.find(project => isSameDirectory(project.worktree, currentDirectory))
    if (!currentProject) return

    setExpandedProjectIds(prev => (prev.includes(currentProject.id) ? prev : [currentProject.id, ...prev]))
  }, [projects, currentDirectory])

  const expandedLookup = useMemo(() => new Set(expandedProjectIds), [expandedProjectIds])

  const handleToggleProject = useCallback((projectId: string) => {
    setExpandedProjectIds(prev =>
      prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId],
    )
  }, [])

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-2 py-2">
      {projects.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text-400 opacity-70">
          <p className="text-xs font-medium text-text-300">No project folders yet</p>
          <p className="mt-1 text-[11px] text-text-400/70">Add a project to browse recent chats by folder.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {projects.map(project => (
            <FolderRecentSection
              key={project.id}
              project={project}
              isExpanded={expandedLookup.has(project.id)}
              isCurrent={isSameDirectory(project.worktree, currentDirectory)}
              selectedSessionId={selectedSessionId}
              onToggle={() => handleToggleProject(project.id)}
              onSelectSession={onSelectSession}
              onRenameSession={onRenameSession}
              onDeleteSession={onDeleteSession}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface FolderRecentSectionProps {
  project: FolderRecentProject
  isExpanded: boolean
  isCurrent: boolean
  selectedSessionId: string | null
  onToggle: () => void
  onSelectSession: (session: ApiSession) => void
  onRenameSession: (session: ApiSession, newTitle: string) => Promise<void>
  onDeleteSession: (session: ApiSession) => Promise<void>
}

function FolderRecentSection({
  project,
  isExpanded,
  isCurrent,
  selectedSessionId,
  onToggle,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
}: FolderRecentSectionProps) {
  const { ref, inView } = useInView({ rootMargin: '180px 0px', triggerOnce: true })
  const shouldLoad = inView || isExpanded
  const { sessions, isLoading, isLoadingMore, hasMore, loadMore, refresh } = useSessions({
    directory: project.worktree,
    pageSize: DIRECTORY_PAGE_SIZE,
    enabled: shouldLoad,
  })

  const handleRename = useCallback(
    async (sessionId: string, newTitle: string) => {
      const session = sessions.find(item => item.id === sessionId)
      if (!session) return
      await onRenameSession(session, newTitle)
      await refresh()
    },
    [sessions, onRenameSession, refresh],
  )

  const handleDelete = useCallback(
    async (sessionId: string) => {
      const session = sessions.find(item => item.id === sessionId)
      if (!session) return
      await onDeleteSession(session)
      await refresh()
    },
    [sessions, onDeleteSession, refresh],
  )

  const projectName = project.name || getDirectoryName(project.worktree) || project.worktree
  const countLabel = !shouldLoad ? '...' : hasMore ? `${sessions.length}+` : String(sessions.length)
  const FolderDisplayIcon = isExpanded ? FolderOpenIcon : FolderIcon

  return (
    <div ref={ref} className="rounded-lg">
      <button
        onClick={onToggle}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
          isExpanded ? 'bg-bg-200/55' : 'hover:bg-bg-200/35'
        }`}
        title={project.worktree}
      >
        <ChevronRightIcon
          size={14}
          className={`shrink-0 text-text-500 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <FolderDisplayIcon
          size={15}
          className={isCurrent ? 'shrink-0 text-accent-main-100' : 'shrink-0 text-text-400'}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate text-[13px] font-medium text-text-100">{projectName}</span>
            {isCurrent && (
              <span className="shrink-0 rounded-full bg-accent-main-100/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent-main-100">
                Current
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] text-text-400/70">{project.worktree}</div>
        </div>

        <div className="shrink-0">
          {isLoading ? (
            <SpinnerIcon size={14} className="animate-spin text-text-400" />
          ) : (
            <span className="inline-flex min-w-[28px] items-center justify-center rounded-md border border-border-200/60 bg-bg-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-text-300">
              {countLabel}
            </span>
          )}
        </div>
      </button>

      <div
        className={`grid transition-all duration-200 ease-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <div className="ml-5 border-l border-border-200/45 pl-2 pt-1">
            <SessionList
              sessions={sessions}
              selectedId={selectedSessionId}
              isLoading={isLoading}
              isLoadingMore={isLoadingMore}
              hasMore={hasMore}
              search=""
              onSearchChange={NOOP}
              onSelect={onSelectSession}
              onDelete={handleDelete}
              onRename={handleRename}
              onLoadMore={loadMore}
              onNewChat={NOOP}
              showHeader={false}
              grouped={false}
              density="compact"
              showStats
              scrollMaxHeight={SESSION_LIST_MAX_HEIGHT}
              emptyStateLabel="No chats in this folder"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
