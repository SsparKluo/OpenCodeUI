// ============================================
// MultiServerFolderList - 多服务器模式的文件夹分组会话列表
//
// 结构 = 文件夹模式 + 服务器层级：
//   ● 服务器1（状态点 + 服务器名；行结构、拖拽方式、拖拽时自动收起与文件夹行完全一致）
//      FolderRecentList（原封不动的文件夹模式：全局 + 工作区文件夹 → session）
//   ● 服务器2
//      ...
//
// 实现方式：根容器与 FolderRecentList 相同的 px-1.5 内边距（保证图标对齐）；
// 服务器节点行复用文件夹行的结构与 useReorderableList 拖拽 + 拖拽时收起；
// 展开后原封不动挂载 FolderRecentList（仅透传 serverId 让 sessions 从该服务器拉取）。
// ============================================

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useServerStore } from '../../../hooks/useServerStore'
import { useDirectory } from '../../../contexts/useDirectory'
import { isSameDirectory } from '../../../utils'
import { serverStore } from '../../../store/serverStore'
import { multiServerStore } from '../../../store/multiServerStore'
import { subscribeToServerConnectionState, getServerConnectionInfo, type ConnectionInfo } from '../../../api/events'
import { ExpandableSection } from '../../../components/ui'
import { GripVerticalIcon } from '../../../components/Icons'
import type { ApiSession } from '../../../api'
import {
  FolderRecentList,
  createDirectoryProject,
  useReorderableList,
  useCollapseExpandedIdsOnDrag,
  type FolderRecentProject,
} from './FolderRecentList'

interface MultiServerFolderListProps {
  serverIds: string[]
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession & { serverId?: string }) => void
}

function useServerConnectionState(serverId: string): ConnectionInfo {
  return useSyncExternalStore(
    onStoreChange => (serverId ? subscribeToServerConnectionState(serverId, onStoreChange) : () => {}),
    () => getServerConnectionInfo(serverId),
    () => getServerConnectionInfo(serverId),
  )
}

function statusDotClass(state: ConnectionInfo['state']): string {
  switch (state) {
    case 'connected':
      return 'bg-success-100'
    case 'connecting':
      return 'bg-warning-100'
    case 'error':
      return 'bg-error-100'
    default:
      return 'bg-text-500/50'
  }
}

function ServerFolderGroup({
  serverId,
  selectedSessionId,
  onSelectSession,
  isExpanded,
  onToggleExpanded,
  isDragged,
  registerRef,
  onDragStart,
  onTouchDragStart,
  onTouchMove,
  onTouchEnd,
}: {
  serverId: string
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession & { serverId?: string }) => void
  isExpanded: boolean
  onToggleExpanded: () => void
  isDragged: boolean
  registerRef: (el: HTMLDivElement | null) => void
  onDragStart: (e: React.PointerEvent) => void
  onTouchDragStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
}) {
  // 与 FolderRecentList / SidePanel 一致的 namespace，保证 t('sidebar.global') 等翻译正确
  const { t } = useTranslation(['chat', 'common'])
  const { activeServer, getHealth } = useServerStore()
  const server = serverStore.getServer(serverId)
  const health = getHealth(serverId)
  const connectionState = useServerConnectionState(serverId)
  const { currentDirectory, setCurrentDirectory } = useDirectory()
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>([])

  // 与文件夹模式一致的点击行为：点击目录文件夹 → 切换项目选择器焦点；
  // 已在焦点目录则只展开/收起（FolderRecentSection 内部已 toggle）
  const handleSelectProject = useCallback(
    (project: FolderRecentProject) => {
      // 项目选择器焦点同步到该文件夹所在的服务器
      multiServerStore.setFocusedServerId(serverId)
      if (!project.worktree) {
        // 全局文件夹：回到全局
        if (!currentDirectory) return
        setCurrentDirectory(undefined)
        return
      }
      if (currentDirectory && isSameDirectory(currentDirectory, project.worktree)) return
      setCurrentDirectory(project.worktree)
    },
    [currentDirectory, setCurrentDirectory, serverId],
  )

  // 仅当当前选中的 session 属于本服务器时才高亮（复合 key 前缀匹配），
  // 避免多个服务器连同一后端时同名 session 串高亮
  const localSelectedSessionId = useMemo(() => {
    const prefix = `${serverId}::`
    return selectedSessionId && selectedSessionId.startsWith(prefix)
      ? selectedSessionId.slice(prefix.length)
      : null
  }, [serverId, selectedSessionId])

  // 该服务器的工作区 = 用户通过项目管理面板添加的目录（按服务器持久化）
  const multiServerSnapshot = useSyncExternalStore(
    listener => multiServerStore.subscribe(listener),
    () => multiServerStore.getSnapshot(),
    () => multiServerStore.getSnapshot(),
  )
  const order = useMemo(() => {
    void multiServerSnapshot
    return multiServerStore.getServerWorkspacesOrder(serverId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, multiServerSnapshot])

  // 展示顺序（含 'global' 占位）——与文件夹模式一致，全局文件夹也可拖拽排序
  const projects = useMemo<FolderRecentProject[]>(() => {
    const globalProject: FolderRecentProject = {
      id: 'global',
      worktree: '',
      name: t('sidebar.global'),
      sectionKind: 'project',
      canReorder: true,
    }
    return order.map(item => {
      if (item === 'global') return globalProject
      return { ...createDirectoryProject(item, 'project'), canReorder: true }
    })
  }, [order, t])

  const displayName = server?.name ?? serverId
  const isActiveServer = activeServer?.id === serverId

  return (
    <div
      ref={registerRef}
      onTouchStart={onTouchDragStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={`relative transition-all duration-150 group/folder ${
        isDragged
          ? 'z-10 shadow-lg shadow-black/20 ring-1 ring-inset ring-accent-main-100/30 rounded-md bg-bg-100'
          : ''
      }`}
    >
      {/* 服务器节点行 — 与文件夹行结构完全一致（含 drag-handle），图标位换成连接状态点 */}
      <div className="relative flex w-full items-center transition-colors duration-150 select-none rounded-md hover:bg-bg-200/40">
        <button
          type="button"
          onClick={() => {
            // 项目选择器焦点同步到该服务器。
            // 已在焦点 → 展开/收起；未在焦点 → 只切焦点（保持/展开节点），不收起
            const wasFocused = multiServerStore.getFocusedServerId() === serverId
            multiServerStore.setFocusedServerId(serverId)
            if (wasFocused) {
              onToggleExpanded()
            } else if (!isExpanded) {
              onToggleExpanded()
            }
          }}
          className="flex flex-1 min-w-0 items-center gap-2 pl-2 pr-2 py-1.5 text-left cursor-default select-none"
          title={server?.url ?? serverId}
        >
          {/* size-5 图标位 → 连接状态点 */}
          <span className="relative size-5 shrink-0 flex items-center justify-center">
            <span className={`h-2 w-2 rounded-full ${statusDotClass(connectionState.state)}`} />
            {connectionState.state === 'connected' && (
              <span
                className={`absolute h-2 w-2 rounded-full ${statusDotClass(connectionState.state)} animate-ping opacity-50`}
              />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] font-medium text-text-300">
            {displayName}
            {isActiveServer && <span className="ml-1.5 text-[length:var(--fs-xxs)] text-text-400">●</span>}
            {health?.status === 'online' && health.version ? ` · v${health.version}` : ''}
          </span>
        </button>
        {/* 拖拽把手 — 与文件夹行完全一致（服务器拖拽排序） */}
        <span
          data-drag-handle
          onPointerDown={onDragStart}
          className="shrink-0 flex items-center justify-center w-0 group-hover/folder:w-5 overflow-hidden cursor-grab active:cursor-grabbing text-text-500 opacity-0 group-hover/folder:opacity-60 hover:!opacity-100 transition-all duration-150 touch-none"
          title={t('sidebar.dragToReorder', { defaultValue: 'Drag to reorder' })}
        >
          <GripVerticalIcon size={12} />
        </span>
      </div>

      {/* 展开内容：文件夹缩进在服务器节点下，内部滚动限制最大高度（工作区多时不会撑太长） */}
      <ExpandableSection show={isExpanded}>
        <div className="pl-3">
          <div className="max-h-[45vh] overflow-y-auto">
          <FolderRecentList
            key={serverId}
            serverId={serverId}
            projects={projects}
          selectedSessionId={localSelectedSessionId}
          expandedProjectIds={expandedProjectIds}
          onExpandedProjectIdsChange={setExpandedProjectIds}
          onSelectProject={handleSelectProject}
          onSelectSession={session => onSelectSession({ ...session, serverId } as ApiSession & { serverId?: string })}
          onRenameSession={async () => {}}
          onDeleteSession={async () => {}}
          onReorderProject={(draggedPath, targetPath) => {
            const currentOrder = multiServerStore.getServerWorkspacesOrder(serverId)
            const next = [...currentOrder]
            const from = next.indexOf(draggedPath)
            const to = next.indexOf(targetPath)
            if (from !== -1 && to !== -1) {
              next.splice(from, 1)
              next.splice(to, 0, draggedPath)
              multiServerStore.setServerWorkspacesOrder(serverId, next)
            }
          }}
          pinnedSessions={[]}
          />
          </div>
        </div>
      </ExpandableSection>
    </div>
  )
}

export function MultiServerFolderList({
  serverIds,
  selectedSessionId,
  onSelectSession,
}: MultiServerFolderListProps) {
  // 服务器展开状态（父级管理，拖拽时自动收起/恢复 — 与文件夹模式对齐）
  const [expandedServerIds, setExpandedServerIds] = useState<string[]>(() => [...serverIds])
  useEffect(() => {
    setExpandedServerIds(prev => {
      const missing = serverIds.filter(id => !prev.includes(id))
      return missing.length > 0 ? [...prev, ...missing] : prev
    })
  }, [serverIds])

  const { handleDragActivated, handleDragFinished } = useCollapseExpandedIdsOnDrag(
    expandedServerIds,
    setExpandedServerIds,
  )

  // 服务器节点列表的拖拽 — 与文件夹模式完全相同的 useReorderableList 实现（拖拽时收起）
  const {
    draggedId,
    displayOrder,
    handlePointerStart,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    registerRef,
  } = useReorderableList({
    ids: serverIds,
    canDrag: () => true,
    onCommit: (draggedId, targetId) => {
      const current = multiServerStore.getSubscribedServerIds()
      const next = [...current]
      const from = next.indexOf(draggedId)
      const to = next.indexOf(targetId)
      if (from !== -1 && to !== -1) {
        next.splice(from, 1)
        next.splice(to, 0, draggedId)
        multiServerStore.setSubscribedServerIds(next)
      }
    },
    onDragActivated: handleDragActivated,
    onDragFinished: handleDragFinished,
  })

  const handleToggleServer = useCallback((serverId: string) => {
    setExpandedServerIds(prev => (prev.includes(serverId) ? prev.filter(id => id !== serverId) : [...prev, serverId]))
  }, [])

  return (
    // 根容器与 FolderRecentList 相同的 px-1.5 内边距，保证服务器行图标与文件夹图标对齐
    <div className="h-full overflow-y-auto custom-scrollbar px-1.5">
      {displayOrder.map(serverId => (
        <ServerFolderGroup
          key={serverId}
          serverId={serverId}
          selectedSessionId={selectedSessionId}
          onSelectSession={onSelectSession}
          isExpanded={expandedServerIds.includes(serverId)}
          onToggleExpanded={() => handleToggleServer(serverId)}
          isDragged={draggedId === serverId}
          registerRef={el => registerRef(serverId, el)}
          onDragStart={e => handlePointerStart(serverId, e)}
          onTouchDragStart={e => handleTouchStart(serverId, e)}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        />
      ))}
    </div>
  )
}
