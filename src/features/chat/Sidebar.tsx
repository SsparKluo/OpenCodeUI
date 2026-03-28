import { useState, useCallback, useEffect, useRef, memo } from 'react'
import { SidePanel } from './sidebar/SidePanel'
import { ProjectDialog } from './ProjectDialog'
import { useDirectory } from '../../hooks'
import { useInputCapabilities } from '../../hooks/useInputCapabilities'
import { type ApiSession } from '../../api'

const MIN_WIDTH = 240
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 288 // 18rem = 288px
const RAIL_WIDTH = 49 // 3.05rem ≈ 49px
const TOUCH_MIN_WIDTH = 220
const SMALL_DESKTOP_BREAKPOINT = 1100

function clampSidebarWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.min(Math.max(width, minWidth), maxWidth)
}

function getDesktopSidebarSizing(viewportWidth: number, preferTouchUi: boolean) {
  const minWidth = preferTouchUi ? TOUCH_MIN_WIDTH : MIN_WIDTH
  const responsiveMaxWidth =
    viewportWidth < SMALL_DESKTOP_BREAKPOINT ? Math.floor(viewportWidth * (preferTouchUi ? 0.46 : 0.4)) : MAX_WIDTH
  const maxWidth = clampSidebarWidth(responsiveMaxWidth, minWidth, MAX_WIDTH)
  const responsiveDefaultWidth =
    viewportWidth < SMALL_DESKTOP_BREAKPOINT ? Math.floor(viewportWidth * (preferTouchUi ? 0.34 : 0.3)) : DEFAULT_WIDTH

  return {
    minWidth,
    maxWidth,
    defaultWidth: clampSidebarWidth(responsiveDefaultWidth, minWidth, maxWidth),
  }
}

interface SidebarProps {
  isOpen: boolean
  selectedSessionId: string | null
  onSelectSession: (session: ApiSession) => void
  onNewSession: () => void
  onOpen: () => void
  onClose: () => void
  contextLimit?: number
  onOpenSettings?: () => void
  projectDialogOpen?: boolean
  onProjectDialogClose?: () => void
}

export const Sidebar = memo(function Sidebar({
  isOpen,
  selectedSessionId,
  onSelectSession,
  onNewSession,
  onOpen,
  onClose,
  contextLimit,
  onOpenSettings,
  projectDialogOpen,
  onProjectDialogClose,
}: SidebarProps) {
  const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false)
  const { addDirectory, pathInfo } = useDirectory()
  const { preferTouchUi, hasCoarsePointer, hasTouch } = useInputCapabilities()
  const touchCapable = preferTouchUi || hasCoarsePointer || hasTouch
  const [isMobile, setIsMobile] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  const isProjectDialogVisible = isProjectDialogOpen || !!projectDialogOpen
  const [hasCustomWidth, setHasCustomWidth] = useState(() => {
    try {
      return localStorage.getItem('sidebar-width') !== null
    } catch {
      return false
    }
  })
  const {
    minWidth: sidebarMinWidth,
    maxWidth: sidebarMaxWidth,
    defaultWidth: sidebarDefaultWidth,
  } = getDesktopSidebarSizing(viewportWidth, preferTouchUi)

  // Resizable state
  const [width, setWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('sidebar-width')
      return saved ? Math.min(Math.max(parseInt(saved), MIN_WIDTH), MAX_WIDTH) : DEFAULT_WIDTH
    } catch {
      return DEFAULT_WIDTH
    }
  })
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const currentWidthRef = useRef(width)
  const rafRef = useRef<number>(0)
  const renderedWidth = hasCustomWidth
    ? clampSidebarWidth(width, sidebarMinWidth, sidebarMaxWidth)
    : sidebarDefaultWidth

  const handleAddProject = useCallback(
    (path: string) => {
      addDirectory(path)
      if (!isMobile) {
        onOpen()
      }
    },
    [addDirectory, isMobile, onOpen],
  )

  const openProjectDialog = useCallback(() => {
    setIsProjectDialogOpen(true)
  }, [])

  const closeProjectDialog = useCallback(() => {
    setIsProjectDialogOpen(false)
    onProjectDialogClose?.()
  }, [onProjectDialogClose])

  // 检测移动端 (md breakpoint = 768px)
  useEffect(() => {
    const checkLayout = () => {
      const nextWidth = window.innerWidth
      setViewportWidth(nextWidth)
      setIsMobile(nextWidth < 768)
    }

    checkLayout()
    window.addEventListener('resize', checkLayout)
    return () => window.removeEventListener('resize', checkLayout)
  }, [])

  const persistSidebarWidth = useCallback(
    (nextWidth: number) => {
      const finalWidth = clampSidebarWidth(nextWidth, sidebarMinWidth, sidebarMaxWidth)
      setWidth(finalWidth)
      setHasCustomWidth(true)
      setIsResizing(false)
      try {
        localStorage.setItem('sidebar-width', finalWidth.toString())
      } catch {
        // ignore
      }
      return finalWidth
    },
    [sidebarMinWidth, sidebarMaxWidth],
  )

  // Resize logic (desktop only) — 纯 DOM 操作，不触发 React re-render
  const startResizing = useCallback(
    (e: React.MouseEvent) => {
      if (isMobile) return
      e.preventDefault()

      const sidebar = sidebarRef.current
      if (!sidebar) return

      setIsResizing(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          const newWidth = clampSidebarWidth(moveEvent.clientX, sidebarMinWidth, sidebarMaxWidth)
          sidebar.style.width = `${newWidth}px`
          currentWidthRef.current = newWidth
        })
      }

      const handleMouseUp = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)

        // 拖拽结束：同步 state + 持久化
        persistSidebarWidth(currentWidthRef.current)
      }

      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    },
    [isMobile, persistSidebarWidth, sidebarMinWidth, sidebarMaxWidth],
  )

  const startTouchResizing = useCallback(
    (e: React.TouchEvent) => {
      if (isMobile || !touchCapable || e.touches.length !== 1) return
      e.preventDefault()

      const sidebar = sidebarRef.current
      if (!sidebar) return

      setIsResizing(true)
      document.body.style.userSelect = 'none'

      const handleTouchMove = (moveEvent: TouchEvent) => {
        if (moveEvent.touches.length !== 1) return
        moveEvent.preventDefault()
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          const newWidth = clampSidebarWidth(moveEvent.touches[0].clientX, sidebarMinWidth, sidebarMaxWidth)
          sidebar.style.width = `${newWidth}px`
          currentWidthRef.current = newWidth
        })
      }

      const handleTouchEnd = () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        document.body.style.userSelect = ''
        document.removeEventListener('touchmove', handleTouchMove)
        document.removeEventListener('touchend', handleTouchEnd)
        document.removeEventListener('touchcancel', handleTouchEnd)
        persistSidebarWidth(currentWidthRef.current)
      }

      document.addEventListener('touchmove', handleTouchMove, { passive: false })
      document.addEventListener('touchend', handleTouchEnd)
      document.addEventListener('touchcancel', handleTouchEnd)
    },
    [isMobile, persistSidebarWidth, sidebarMinWidth, sidebarMaxWidth, touchCapable],
  )

  // 同步 width state → ref（isOpen 切换时 width 可能从外部改变）
  useEffect(() => {
    currentWidthRef.current = renderedWidth
  }, [renderedWidth])

  // 移动端遮罩点击关闭
  const handleBackdropClick = useCallback(() => {
    if (isMobile && isOpen) {
      onClose()
    }
  }, [isMobile, isOpen, onClose])

  const handleToggle = useCallback(() => {
    if (isOpen) {
      onClose()
    } else {
      onOpen()
    }
  }, [isOpen, onClose, onOpen])

  // 选择 session 后在移动端关闭侧边栏
  const handleSelectSession = useCallback(
    (session: ApiSession) => {
      onSelectSession(session)
      if (isMobile) {
        onClose()
      }
    },
    [onSelectSession, isMobile, onClose],
  )

  // ============================================
  // 移动端：Sidebar 完全不占位，作为 overlay 显示
  // 支持触摸滑动关闭
  // ============================================

  // 滑动关闭手势状态
  const touchStartX = useRef(0)
  const touchDeltaX = useRef(0)
  const [swipeX, setSwipeX] = useState(0)
  const isSwiping = useRef(false)
  const [isSwipingActive, setIsSwipingActive] = useState(false)

  const handleSidebarTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
    isSwiping.current = false
    setIsSwipingActive(false)
  }, [])

  const handleSidebarTouchMove = useCallback((e: React.TouchEvent) => {
    const deltaX = e.touches[0].clientX - touchStartX.current
    // 只有向左滑时才触发
    if (deltaX < -10) {
      isSwiping.current = true
      setIsSwipingActive(true)
      touchDeltaX.current = deltaX
      setSwipeX(deltaX)
    }
  }, [])

  const handleSidebarTouchEnd = useCallback(() => {
    if (isSwiping.current && touchDeltaX.current < -80) {
      // 滑动超过 80px，关闭侧边栏
      onClose()
    }
    isSwiping.current = false
    setIsSwipingActive(false)
    touchDeltaX.current = 0
    setSwipeX(0)
  }, [onClose])

  if (isMobile) {
    return (
      <>
        {/* Mobile Backdrop */}
        <div
          className={`
            fixed left-0 right-0 bg-[hsl(var(--always-black)/0.4)] z-30
            transition-opacity duration-300
            ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
          `}
          style={{ top: 'var(--safe-area-inset-top)', height: 'calc(100% - var(--safe-area-inset-top))' }}
          onClick={handleBackdropClick}
        />

        {/* Mobile Sidebar Overlay */}
        <div
          onTouchStart={handleSidebarTouchStart}
          onTouchMove={handleSidebarTouchMove}
          onTouchEnd={handleSidebarTouchEnd}
          className={`
            fixed left-0 z-40 
            flex flex-col bg-bg-100 shadow-xl
            ${isSwipingActive ? '' : 'transition-transform duration-300 ease-out'}
            ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
          style={{
            width: `${DEFAULT_WIDTH}px`,
            transform: isOpen ? `translateX(${Math.min(0, swipeX)}px)` : `translateX(-100%)`,
            top: 'var(--safe-area-inset-top)',
            height: 'calc(100% - var(--safe-area-inset-top))',
          }}
        >
          {/* 和桌面端展开时一样的内容 */}
          <SidePanel
            onNewSession={onNewSession}
            onSelectSession={handleSelectSession}
            onCloseMobile={onClose}
            selectedSessionId={selectedSessionId}
            onAddProject={openProjectDialog}
            isMobile={true}
            isExpanded={true} // 移动端展开时始终是 expanded 状态
            onToggleSidebar={onClose} // 移动端 toggle 就是关闭
            contextLimit={contextLimit}
            onOpenSettings={onOpenSettings}
          />
        </div>

        {/* Project Dialog */}
        <ProjectDialog
          isOpen={isProjectDialogVisible}
          onClose={closeProjectDialog}
          onSelect={handleAddProject}
          initialPath={pathInfo?.home}
        />
      </>
    )
  }

  // ============================================
  // 桌面端：Sidebar 始终在原位置，可展开/收起为 rail
  // ============================================
  return (
    <>
      <div
        ref={sidebarRef}
        style={{ width: isOpen ? `${renderedWidth}px` : `${RAIL_WIDTH}px` }}
        className={`
          relative flex flex-col h-full bg-bg-100 overflow-hidden shrink-0
          border-r border-border-200/50
          ${isResizing ? 'transition-none' : 'transition-[width] duration-300 ease-out'}
        `}
      >
        <SidePanel
          onNewSession={onNewSession}
          onSelectSession={onSelectSession}
          onCloseMobile={onClose}
          selectedSessionId={selectedSessionId}
          onAddProject={openProjectDialog}
          isMobile={false}
          isExpanded={isOpen}
          onToggleSidebar={handleToggle}
          contextLimit={contextLimit}
          onOpenSettings={onOpenSettings}
        />

        {/* Resizer Handle (Desktop only, when expanded) */}
        {isOpen && (
          <div
            className={`
              absolute top-0 right-0 h-full cursor-col-resize z-50 touch-none bg-transparent
              ${touchCapable ? 'w-4' : 'w-1'}
            `}
            onMouseDown={startResizing}
            onTouchStart={startTouchResizing}
          >
            <div
              aria-hidden="true"
              className={`absolute top-0 bottom-0 right-0 transition-colors ${touchCapable ? 'w-1 rounded-full' : 'w-full'} ${
                isResizing ? 'bg-accent-main-100' : 'bg-transparent hover:bg-accent-main-100/50'
              }`}
            />
          </div>
        )}
      </div>

      {/* Project Dialog */}
      <ProjectDialog
        isOpen={isProjectDialogVisible}
        onClose={closeProjectDialog}
        onSelect={handleAddProject}
        initialPath={pathInfo?.home}
      />
    </>
  )
})
