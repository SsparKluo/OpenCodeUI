import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  getDroppedPathsInfo,
  isTauriDropPointInsideElement,
  subscribeTauriDragDrop,
  type TauriDragDropEvent,
  type TauriDropPosition,
} from '../../lib/tauriDragDrop'

/**
 * 桌面端：把文件夹拖到信息流区域 → 添加项目。
 * 落在输入框上时让出，由 InputBox 处理附件 / @ 引用。
 */
export function useFolderProjectDrop(
  paneRootRef: RefObject<HTMLElement | null>,
  addDirectory: (path: string) => void,
): boolean {
  const [isActive, setIsActive] = useState(false)
  const pathsRef = useRef<string[] | null>(null)
  const hasFolderRef = useRef(false)
  const inspectIdRef = useRef(0)
  const positionRef = useRef<TauriDropPosition | null>(null)
  const addDirectoryRef = useRef(addDirectory)
  addDirectoryRef.current = addDirectory

  const resolveTarget = useCallback(
    (position: TauriDropPosition) => {
      const pane = paneRootRef.current
      if (!pane || !isTauriDropPointInsideElement(position, pane)) return null
      const input = pane.querySelector<HTMLElement>('[data-input-box]')
      if (isTauriDropPointInsideElement(position, input)) return 'input' as const
      return 'stream' as const
    },
    [paneRootRef],
  )

  useEffect(() => {
    let alive = true

    const setActive = (next: boolean) => {
      if (alive) setIsActive(next)
    }

    const unlisten = subscribeTauriDragDrop((event: TauriDragDropEvent) => {
      if (event.type === 'leave') {
        inspectIdRef.current += 1
        pathsRef.current = null
        hasFolderRef.current = false
        positionRef.current = null
        setActive(false)
        return
      }

      positionRef.current = event.position

      if (event.type === 'enter') {
        pathsRef.current = event.paths
        hasFolderRef.current = false
        const inspectId = ++inspectIdRef.current
        const paths = event.paths
        void getDroppedPathsInfo(paths)
          .then(items => {
            if (!alive || inspectId !== inspectIdRef.current) return
            hasFolderRef.current = items.some(item => item.type === 'folder')
            const pos = positionRef.current
            if (hasFolderRef.current && pos && resolveTarget(pos) === 'stream') {
              setActive(true)
            }
          })
          .catch(() => {
            if (!alive || inspectId !== inspectIdRef.current) return
            hasFolderRef.current = false
          })
      }

      if (event.type === 'drop') {
        pathsRef.current = event.paths
      }

      const target = resolveTarget(event.position)
      if (event.type === 'enter' || event.type === 'over') {
        setActive(target === 'stream' && hasFolderRef.current)
        return
      }

      // drop：实际添加不依赖 inspect 是否完成，只认落点 + 路径类型
      setActive(false)
      const paths = event.paths.length > 0 ? event.paths : pathsRef.current
      pathsRef.current = null
      hasFolderRef.current = false
      positionRef.current = null
      inspectIdRef.current += 1
      if (target !== 'stream' || !paths || paths.length === 0) return

      void getDroppedPathsInfo(paths)
        .then(items => {
          if (!alive) return
          for (const item of items) {
            if (item.type === 'folder') addDirectoryRef.current(item.path)
          }
        })
        .catch(err => {
          console.warn('[useFolderProjectDrop] Failed to add dropped folders:', err)
        })
    })

    return () => {
      alive = false
      unlisten()
    }
  }, [resolveTarget])

  return isActive
}
