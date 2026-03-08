import { useCallback, useEffect, useState } from 'react'
import type { ApiSession } from '../../../api'
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, SpinnerIcon } from '../../../components/Icons'
import { useSessions } from '../../../hooks'
import { useInView } from '../../../hooks/useInView'
import { getDirectoryName, isSameDirectory } from '../../../utils'
import { SessionList } from '../../sessions'

const DIRECTORY_PAGE_SIZE = 8
const MAX_VISIBLE_SESSIONS = 6
const SESSION_LIST_MAX_HEIGHT = MAX_VISIBLE_SESSIONS * 40 + 12
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

  const handleToggleProject = useCallback((projectId: string) => {
    setExpandedProjectIds(prev =>
      prev.includes(projectId) ? prev.filter(id => id !== projectId) : [...prev, projectId],
    )
  }, [])

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-2 py-1.5">
      {projects.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center px-6 text-center text-text-400 opacity-70">
          <p className="text-xs font-medium text-text-300">No project folders yet</p>
          <p className="mt-1 text-[11px] text-text-400/70">Add a project to browse recent chats by folder.</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {projects.map(project => (
            <FolderRecentSection
              key={project.id}
              project={project}
              isExpanded={expandedProjectIds.includes(project.id)}
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
  const FolderDisplayIcon = isExpanded ? FolderOpenIcon : FolderIcon

  return (
    <div ref={ref} className="rounded-lg">
      <button
        onClick={onToggle}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors ${
          isExpanded ? 'bg-bg-200/35' : 'hover:bg-bg-200/25'
        }`}
        title={project.worktree}
      >
        <ChevronRightIcon
          size={14}
          className={`shrink-0 text-text-500 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
        />
        <FolderDisplayIcon
          size={15}
          className={isCurrent ? 'shrink-0 text-accent-main-100' : 'shrink-0 text-text-400/90'}
        />

        <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-100">{projectName}</div>

        {isExpanded && isLoading && <SpinnerIcon size={14} className="shrink-0 animate-spin text-text-400" />}
      </button>

      <div
        className={`grid transition-all duration-200 ease-out ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
      >
        <div className="overflow-hidden">
          <div className="pt-0.5">
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
              variant="tree"
              showStats={false}
              scrollMaxHeight={SESSION_LIST_MAX_HEIGHT}
              emptyStateLabel="No chats in this folder"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
