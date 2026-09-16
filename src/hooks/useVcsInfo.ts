// ============================================
// useVcsInfo - VCS 信息 Hook
// 轮询获取当前项目的 Git 分支信息
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { getVcsInfo } from '../api/vcs'
import { affectsBoundServer } from '../store/serverChangeScope'
import { serverStore } from '../store/serverStore'
import type { VcsInfo } from '../types/api/vcs'

const POLL_INTERVAL = 15000 // 15s 轮询

export interface UseVcsInfoResult {
  vcsInfo: VcsInfo | null
  isLoading: boolean
  error: string | null
  refresh: () => void
}

export function useVcsInfo(directory?: string, serverId?: string): UseVcsInfoResult {
  const [vcsInfo, setVcsInfo] = useState<VcsInfo | null>(null)
  const [isLoading, setIsLoading] = useState(Boolean(directory))
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const requestIdRef = useRef(0)

  const fetchVcs = useCallback(async () => {
    const requestId = ++requestIdRef.current

    if (!directory) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setVcsInfo(null)
        setError(null)
        setIsLoading(false)
      }
      return
    }

    setIsLoading(true)
    try {
      const info = await getVcsInfo(directory, serverId)
      if (mountedRef.current && requestId === requestIdRef.current) {
        setVcsInfo(info)
        setError(null)
      }
    } catch (e) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setError(e instanceof Error ? e.message : 'Failed to fetch VCS info')
        setVcsInfo(null)
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [directory, serverId])

  // 初始加载 + 目录/服务器变化时重新获取
  useEffect(() => {
    mountedRef.current = true
    setVcsInfo(null)
    setError(null)
    setIsLoading(Boolean(directory))
    void fetchVcs()
    return () => {
      mountedRef.current = false
    }
  }, [directory, serverId, fetchVcs])

  // 轮询
  useEffect(() => {
    if (!directory) return

    const timer = setInterval(fetchVcs, POLL_INTERVAL)
    return () => clearInterval(timer)
  }, [directory, serverId, fetchVcs])

  useEffect(() => {
    if (!directory) return

    return serverStore.onServerChange((changedId, reason) => {
      // 数据主体是 serverId ?? active 服务器（评审 N3：统一走共享谓词）：
      // - 固定服务器模式：只有「这台」服务器端点变化才需要重置重拉，别的服务器切换与它无关
      // - 跟随 active 模式：非 active 服务器重启与当前数据无关（避免 VCS 徽章闪烁）
      if (!affectsBoundServer(serverId, changedId, reason, serverStore.getActiveServerId())) return
      setVcsInfo(null)
      setError(null)
      void fetchVcs()
    })
  }, [directory, serverId, fetchVcs])

  return { vcsInfo, isLoading, error, refresh: fetchVcs }
}
