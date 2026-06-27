import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageRenderer } from './MessageRenderer'
import type { AssistantMessageInfo, Message, TokenUsage } from '../../types/message'

let mockRenderUserMarkdown = false
let mockStepFinishDisplay: Record<string, boolean> = { turnDuration: false, aggregateStepFinish: false }
const stepFinishViewCalls: Array<Record<string, unknown>> = []

vi.mock('motion/mini', () => ({
  animate: () => Promise.resolve(),
}))

vi.mock('../../hooks', () => ({
  useDelayedRender: (show: boolean) => show,
}))

vi.mock('../../hooks/useTheme', () => ({
  useTheme: () => ({
    collapseUserMessages: false,
    renderUserMarkdown: mockRenderUserMarkdown,
    stepFinishDisplay: mockStepFinishDisplay,
    descriptiveToolSteps: false,
    inlineToolRequests: false,
    immersiveMode: false,
  }),
}))

vi.mock('../../components/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="user-markdown">{content}</div>,
}))

vi.mock('../../components/ui', () => ({
  CopyButton: ({ text }: { text: string }) => <button type="button">copy:{text}</button>,
  SmoothHeight: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./parts', () => ({
  TextPartView: ({ part }: { part: { text: string } }) => <div>{part.text}</div>,
  ReasoningPartView: () => null,
  ToolPartView: () => null,
  FilePartView: () => null,
  AgentPartView: () => null,
  SyntheticTextPartView: () => null,
  StepFinishPartView: (props: Record<string, unknown>) => {
    stepFinishViewCalls.push(props)
    return null
  },
  SubtaskPartView: () => null,
  RetryPartView: () => null,
  CompactionPartView: () => <div>History compacted</div>,
  MessageErrorView: () => null,
}))

function createAssistantInfo(overrides: Partial<AssistantMessageInfo> = {}): AssistantMessageInfo {
  return {
    id: 'assistant-1',
    sessionID: 'session-1',
    role: 'assistant',
    parentID: 'user-1',
    modelID: 'model-1',
    providerID: 'provider-1',
    mode: 'chat',
    agent: 'build',
    path: { cwd: '/workspace', root: '/workspace' },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    time: { created: 1 },
    ...overrides,
  }
}

function createAssistantMessage(overrides: Partial<AssistantMessageInfo> = {}): Message {
  return {
    info: createAssistantInfo(overrides),
    parts: [
      {
        id: 'text-1',
        sessionID: 'session-1',
        messageID: 'assistant-1',
        type: 'text',
        text: 'assistant reply',
      },
    ],
    isStreaming: false,
  }
}

function createUserMessage(): Message {
  return {
    info: {
      id: 'user-1',
      sessionID: 'session-1',
      role: 'user',
      time: { created: 1 },
      agent: 'build',
      model: { modelID: 'model-1', providerID: 'provider-1' },
    },
    parts: [],
    isStreaming: false,
  }
}

function createUserTextMessage(text: string): Message {
  const message = createUserMessage()
  message.parts = [
    {
      id: 'text-user-1',
      sessionID: 'session-1',
      messageID: 'user-1',
      type: 'text',
      text,
    },
  ]
  return message
}

function createAssistantWithStepFinish(): Message {
  const message = createAssistantMessage({
    time: { created: 1_000, completed: 3_000 },
    cost: 0.42,
    tokens: { input: 100, output: 200, reasoning: 50, cache: { read: 30, write: 20 } } satisfies TokenUsage,
  })
  message.parts = [
    {
      id: 'text-1',
      sessionID: 'session-1',
      messageID: 'assistant-1',
      type: 'text',
      text: 'hello',
    },
    {
      id: 'step-finish-1',
      sessionID: 'session-1',
      messageID: 'assistant-1',
      type: 'step-finish',
      reason: 'stop',
      cost: 0.18,
      tokens: { input: 40, output: 80, reasoning: 20, cache: { read: 10, write: 5 } },
    },
    {
      id: 'step-finish-2',
      sessionID: 'session-1',
      messageID: 'assistant-1',
      type: 'step-finish',
      reason: 'stop',
      cost: 0.24,
      tokens: { input: 60, output: 120, reasoning: 30, cache: { read: 20, write: 15 } },
    },
  ]
  return message
}

describe('MessageRenderer assistant fork', () => {
  beforeEach(() => {
    mockRenderUserMarkdown = false
    mockStepFinishDisplay = { turnDuration: false, aggregateStepFinish: false }
  })

  it('passes the explicit fork target id when forking an assistant message', async () => {
    const onFork = vi.fn()
    const message = createAssistantMessage()

    render(<MessageRenderer message={message} onFork={onFork} forkMessageId="assistant-2" />)

    fireEvent.click(screen.getByRole('button', { name: /fork|分叉/i }))

    await waitFor(() => {
      expect(onFork).toHaveBeenCalledWith(message, 'assistant-2')
    })
  })

  it('hides fork when the assistant message has no copyable text', () => {
    const onFork = vi.fn()
    const message = createAssistantMessage()
    message.parts = [
      {
        id: 'text-blank',
        sessionID: 'session-1',
        messageID: 'assistant-1',
        type: 'text',
        text: '   ',
      },
    ]

    render(<MessageRenderer message={message} onFork={onFork} forkMessageId="assistant-2" />)

    expect(screen.queryByRole('button', { name: /fork|分叉/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /copy/i })).toBeNull()
  })

  it('renders compaction parts inside user messages', () => {
    const message = createUserMessage()
    message.parts = [
      {
        id: 'compaction-1',
        sessionID: 'session-1',
        messageID: 'user-1',
        type: 'compaction',
        auto: true,
      },
    ]

    render(<MessageRenderer message={message} />)

    expect(screen.getByText('History compacted')).toBeInTheDocument()
  })

  it('keeps user text plain by default', () => {
    render(<MessageRenderer message={createUserTextMessage('Use **bold** text')} />)

    expect(screen.queryByTestId('user-markdown')).toBeNull()
    expect(screen.getByText('Use **bold** text')).toBeInTheDocument()
  })

  it('renders user text through markdown when enabled', () => {
    mockRenderUserMarkdown = true

    render(<MessageRenderer message={createUserTextMessage('Use **bold** text')} />)

    expect(screen.getByTestId('user-markdown')).toHaveTextContent('Use **bold** text')
  })

  it('renders per-step step-finish when aggregate is disabled', () => {
    const message = createAssistantWithStepFinish()
    stepFinishViewCalls.length = 0
    mockStepFinishDisplay = {
      turnDuration: false,
      aggregateStepFinish: false,
      tokens: true,
      cost: true,
      cache: true,
    }

    render(<MessageRenderer message={message} />)

    // 默认：每个 step-finish 都渲染一次 (2 个 part)
    const parts = stepFinishViewCalls
      .map(call => call.part as { id: string; type: string } | undefined)
      .filter((part): part is { id: string; type: string } => part?.type === 'step-finish')
    expect(parts).toHaveLength(2)
    expect(parts.map(p => p.id)).toEqual(['step-finish-1', 'step-finish-2'])
  })

  it('skips per-step step-finish and renders a single aggregated view when enabled', () => {
    const message = createAssistantWithStepFinish()
    stepFinishViewCalls.length = 0
    mockStepFinishDisplay = {
      turnDuration: false,
      aggregateStepFinish: true,
      tokens: true,
      cost: true,
      cache: true,
    }

    render(<MessageRenderer message={message} />)

    // 聚合：只渲染一次 (合成的 step-finish)
    const parts = stepFinishViewCalls
      .map(call => call.part as { type: string; reason: string; cost: number; tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } } | undefined)
      .filter((part): part is { type: string; reason: string; cost: number; tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } } } => part?.type === 'step-finish')
    expect(parts).toHaveLength(1)
    expect(parts[0].reason).toBe('aggregated')
    // 使用 message-level 真实汇总 (info.cost + info.tokens)
    expect(parts[0].cost).toBe(0.42)
    expect(parts[0].tokens.input).toBe(100)
    expect(parts[0].tokens.output).toBe(200)
    expect(parts[0].tokens.reasoning).toBe(50)
    expect(parts[0].tokens.cache.read).toBe(30)
    expect(parts[0].tokens.cache.write).toBe(20)
  })

  it('does not render the aggregated footer when aggregate is enabled but message has no step-finish parts', () => {
    const message = createAssistantMessage({
      time: { created: 1_000, completed: 3_000 },
      cost: 0.42,
      tokens: { input: 100, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    stepFinishViewCalls.length = 0
    mockStepFinishDisplay = {
      turnDuration: true,
      aggregateStepFinish: true,
      tokens: true,
      cost: true,
      cache: true,
      completedAt: true,
    }

    render(<MessageRenderer message={message} turnDuration={2000} />)

    // 没有 step-finish part：聚合 footer 不应渲染
    const stepFinishParts = stepFinishViewCalls
      .map(call => call.part as { type: string } | undefined)
      .filter(part => part?.type === 'step-finish')
    expect(stepFinishParts).toHaveLength(0)
  })

  it('does not render the aggregated footer when every toggle is disabled in aggregate mode', () => {
    const message = createAssistantWithStepFinish()
    stepFinishViewCalls.length = 0
    mockStepFinishDisplay = {
      turnDuration: false,
      aggregateStepFinish: true,
      tokens: false,
      cost: false,
      cache: false,
      agent: false,
      model: false,
      completedAt: false,
    }

    render(<MessageRenderer message={message} turnDuration={2000} />)

    // 所有 item 开关全关：聚合 footer 不渲染
    const stepFinishParts = stepFinishViewCalls
      .map(call => call.part as { type: string; reason?: string } | undefined)
      .filter((part): part is { type: string; reason?: string } => part?.type === 'step-finish')
    expect(stepFinishParts.find(p => p.reason === 'aggregated')).toBeUndefined()
  })
})
