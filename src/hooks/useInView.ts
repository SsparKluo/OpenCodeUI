import { useState, useEffect, useRef } from 'react'

export function useInView(options: IntersectionObserverInit & { triggerOnce?: boolean } = {}) {
  const [inView, setInView] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggeredRef = useRef(false)
  const { root = null, rootMargin, threshold, triggerOnce } = options

  useEffect(() => {
    // triggerOnce 已触发过，不再观察
    if (triggerOnce && triggeredRef.current) return

    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          if (triggerOnce) {
            triggeredRef.current = true
            observer.unobserve(element)
          }
        } else {
          if (!triggerOnce) {
            setInView(false)
          }
        }
      },
      { root, rootMargin, threshold },
    )

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [root, rootMargin, threshold, triggerOnce])

  // triggerOnce 模式下，一旦触发过就永远返回 true
  return { ref, inView: (triggerOnce && triggeredRef.current) || inView }
}
