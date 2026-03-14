import { useEffect, useRef } from 'react'
import { animate } from 'motion'

/**
 * SmoothHeight - 内容高度变化时平滑过渡
 *
 * 始终渲染同一 DOM 结构（普通 div），不因 isActive 切换重建子树。
 * isActive=true 时：ResizeObserver + 命令式 animate() 驱动容器生长
 * isActive=false 时：零开销（无 ResizeObserver、无动画、无 motion 组件）
 */
export function SmoothHeight({
  isActive,
  children,
  className,
}: {
  isActive: boolean
  children: React.ReactNode
  className?: string
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<ReturnType<typeof animate> | null>(null)

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner || !isActive) {
      // 非活跃：清除动画，恢复 auto
      animRef.current?.stop()
      animRef.current = null
      if (outer) {
        outer.style.height = ''
        outer.style.overflow = ''
      }
      return
    }

    // 活跃：监听内容高度变化，命令式动画驱动容器
    const update = () => {
      const target = inner.scrollHeight
      const current = outer.offsetHeight
      // 差值 < 1px 不值得动画
      if (Math.abs(target - current) < 1) return

      animRef.current?.stop()
      outer.style.overflow = 'hidden'
      animRef.current = animate(outer, { height: `${target}px` }, { duration: 0.12, ease: 'ease-out' })
      // 动画结束后让 height 回到 auto，避免后续 resize 被 inline style 卡住
      animRef.current
        .then(() => {
          if (outer && isActive) {
            outer.style.height = 'auto'
          }
        })
        .catch(() => {})
    }

    update()

    const ro = new ResizeObserver(update)
    ro.observe(inner)

    return () => {
      ro.disconnect()
      animRef.current?.stop()
      animRef.current = null
    }
  }, [isActive])

  return (
    <div ref={outerRef} className={className}>
      <div ref={innerRef}>{children}</div>
    </div>
  )
}
