// ============================================
// VCS (Version Control System) API Types
// 基于 OpenAPI 规范 v0.0.3
// ============================================

/**
 * VCS 信息
 * 后端 schema: { branch?: string, default_branch?: string }
 */
export interface VcsInfo {
  branch?: string
  default_branch?: string
}

export type VcsDiffMode = 'git' | 'branch'
