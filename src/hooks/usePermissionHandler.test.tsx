import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePermissionHandler } from './usePermissionHandler'

const { replyPermissionMock, getPendingPermissionsMock, replyQuestionMock, rejectQuestionMock, activeSessionStoreMock } =
  vi.hoisted(() => ({
    replyPermissionMock: vi.fn(() => Promise.resolve(true)),
    getPendingPermissionsMock: vi.fn(() => Promise.resolve([])),
    replyQuestionMock: vi.fn((..._args: unknown[]) => Promise.resolve(true)),
    rejectQuestionMock: vi.fn((..._args: unknown[]) => Promise.resolve(true)),
    activeSessionStoreMock: {
      resolvePendingRequest: vi.fn(),
    },
  }))

vi.mock('../api', () => ({
  replyPermission: replyPermissionMock,
  replyQuestion: replyQuestionMock,
  rejectQuestion: rejectQuestionMock,
  getPendingPermissions: getPendingPermissionsMock,
  getPendingQuestions: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../store', () => ({
  activeSessionStore: activeSessionStoreMock,
}))

vi.mock('../utils', () => ({
  permissionErrorHandler: vi.fn(),
}))

describe('usePermissionHandler', () => {
  beforeEach(() => {
    replyPermissionMock.mockReset()
    replyPermissionMock.mockResolvedValue(true)
    getPendingPermissionsMock.mockReset()
    getPendingPermissionsMock.mockResolvedValue([])
    activeSessionStoreMock.resolvePendingRequest.mockClear()
  })

  it('clears pending permission locally after a successful reply', async () => {
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingPermissionRequests([
        {
          id: 'perm-1',
          sessionID: 'session-1',
          permission: 'bash',
          patterns: ['npm test'],
          metadata: {},
          always: [],
        },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handlePermissionReply('perm-1', 'once', '/workspace', 'session-1')
    })

    expect(success).toBe(true)
    expect(replyPermissionMock).toHaveBeenCalledWith('perm-1', 'once', undefined, '/workspace', 'session-1', 'local')
    expect(result.current.pendingPermissionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-1')
  })

  it('clears stale permission when reply fails but server no longer lists it as pending', async () => {
    replyPermissionMock.mockRejectedValue(new Error('permission already handled'))
    getPendingPermissionsMock.mockResolvedValue([])
    const { result } = renderHook(() => usePermissionHandler('local'))

    act(() => {
      result.current.setPendingPermissionRequests([
        {
          id: 'perm-stale',
          sessionID: 'session-1',
          permission: 'bash',
          patterns: ['npm test'],
          metadata: {},
          always: [],
        },
      ])
    })

    let success = false
    await act(async () => {
      success = await result.current.handlePermissionReply('perm-stale', 'once', '/workspace', 'session-1')
    })

    expect(success).toBe(true)
    expect(getPendingPermissionsMock).toHaveBeenCalledWith('session-1', '/workspace', 'local')
    expect(result.current.pendingPermissionRequests).toEqual([])
    expect(activeSessionStoreMock.resolvePendingRequest).toHaveBeenCalledWith('perm-stale')
  })

  // 核心契约：请求必须打到「当前」绑定的服务器。
  // pane 首次渲染时活动服务器可能是 local，之后切到别的服务器（多服务器 / WSL sidecar 就绪后切回），
  // 一旦回调把 serverId 冻在旧值上，回复就会发到旧服务器：旧服务器报错、真实服务器仍 pending、
  // 弹窗消失后又冒出来，对话永远不前进。
  it('routes replies to the server the pane is bound to now, not the one captured at mount', async () => {
    const { result, rerender } = renderHook(({ serverId }) => usePermissionHandler(serverId), {
      initialProps: { serverId: 'local' },
    })

    rerender({ serverId: 'wsl:Ubuntu' })

    await act(async () => {
      await result.current.handleQuestionReply('question-1', [['A']], '/home/u/project')
      await result.current.handleQuestionReject('question-2', '/home/u/project')
    })

    expect(replyQuestionMock).toHaveBeenCalledWith('question-1', [['A']], '/home/u/project', 'wsl:Ubuntu')
    expect(rejectQuestionMock).toHaveBeenCalledWith('question-2', '/home/u/project', 'wsl:Ubuntu')
  })
})
