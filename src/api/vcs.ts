// ============================================
// VCS API - 版本控制信息
// ============================================

import { get } from './http'
import type { FileDiff } from './types'
import type { VcsDiffMode, VcsInfo } from '../types/api/vcs'
import { formatPathForApi } from '../utils/directoryUtils'

/**
 * 获取 VCS 信息
 */
export async function getVcsInfo(directory?: string): Promise<VcsInfo | null> {
  try {
    return await get<VcsInfo>('/vcs', { directory: formatPathForApi(directory) })
  } catch {
    // VCS 不可用时返回 null
    return null
  }
}

/**
 * 获取 Git 或分支维度的 diff
 */
export async function getVcsDiff(mode: VcsDiffMode, directory?: string): Promise<FileDiff[]> {
  return get<FileDiff[]>('/vcs/diff', { mode, directory: formatPathForApi(directory) })
}
