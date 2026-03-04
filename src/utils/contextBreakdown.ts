import type { Message, Part } from '../types/message'

export type ContextBreakdownKey = 'system' | 'user' | 'assistant' | 'tool' | 'other'

export interface ContextBreakdownSegment {
  key: ContextBreakdownKey
  tokens: number
  width: number
  percent: number
}

export const BREAKDOWN_COLORS: Record<ContextBreakdownKey, string> = {
  system: 'bg-purple-400',
  user: 'bg-green-500',
  assistant: 'bg-blue-400',
  tool: 'bg-yellow-500',
  other: 'bg-gray-500',
}

export const BREAKDOWN_LABELS: Record<ContextBreakdownKey, string> = {
  system: 'System',
  user: 'User',
  assistant: 'Assistant',
  tool: 'Tool Calls',
  other: 'Other',
}

const CHARS_PER_TOKEN = 4

const estimateTokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)
const estimateCharsFromTokens = (tokens: number) => Math.max(0, tokens) * CHARS_PER_TOKEN
const toPercent = (tokens: number, input: number) => (tokens / input) * 100
const toPercentLabel = (tokens: number, input: number) =>
  Math.round(toPercent(tokens, input) * 10) / 10

const charsFromValue = (value: unknown): number => {
  if (value === null || value === undefined) return 0
  if (typeof value === 'string') return value.length
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).length
  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

const charsFromToolPart = (part: Extract<Part, { type: 'tool' }>): number => {
  const state = part.state
  return (
    part.tool.length +
    charsFromValue(state.input) +
    charsFromValue(state.raw) +
    charsFromValue(state.output) +
    charsFromValue(state.error) +
    charsFromValue(state.metadata)
  )
}

const charsFromUserPart = (part: Part): number => {
  if (part.type === 'text' && !part.synthetic) return part.text.length
  if (part.type === 'file') return part.source && 'text' in part.source ? part.source.text.value?.length ?? 0 : 0
  if (part.type === 'agent') return part.source?.value?.length ?? 0
  if (part.type === 'subtask') {
    return part.prompt.length + part.description.length + part.agent.length + (part.command?.length ?? 0)
  }
  if (part.type === 'snapshot') return part.snapshot.length
  if (part.type === 'patch') return part.hash.length + part.files.join('\n').length
  if (part.type === 'retry') return charsFromValue(part.error)
  return 0
}

const charsFromUserFallback = (message: Message): number => {
  if (message.info.role !== 'user') return 0
  const summary = message.info.summary
  if (!summary || typeof summary !== 'object') return 0
  const title = typeof summary.title === 'string' ? summary.title.length : 0
  const body = typeof summary.body === 'string' ? summary.body.length : 0
  return title + body
}

const charsFromAssistantPart = (part: Part): { assistant: number; tool: number } => {
  if (part.type === 'text') {
    return part.synthetic ? { assistant: 0, tool: 0 } : { assistant: part.text.length, tool: 0 }
  }
  if (part.type === 'reasoning') return { assistant: part.text.length, tool: 0 }
  if (part.type === 'tool') return { assistant: 0, tool: charsFromToolPart(part) }
  if (part.type === 'file') {
    return {
      assistant: part.source && 'text' in part.source ? part.source.text.value?.length ?? 0 : 0,
      tool: 0,
    }
  }
  if (part.type === 'agent') return { assistant: part.source?.value?.length ?? 0, tool: 0 }
  if (part.type === 'subtask') {
    return {
      assistant: 0,
      tool: part.prompt.length + part.description.length + part.agent.length + (part.command?.length ?? 0),
    }
  }
  if (part.type === 'snapshot') return { assistant: 0, tool: part.snapshot.length }
  if (part.type === 'patch') return { assistant: 0, tool: part.hash.length + part.files.join('\n').length }
  if (part.type === 'step-start') return { assistant: 0, tool: part.snapshot?.length ?? 0 }
  if (part.type === 'step-finish') {
    return {
      assistant: part.reason.length,
      tool: part.snapshot?.length ?? 0,
    }
  }
  if (part.type === 'retry') return { assistant: 0, tool: charsFromValue(part.error) }
  if (part.type === 'compaction') return { assistant: 0, tool: 16 }
  return { assistant: 0, tool: 0 }
}

const charsFromAssistantFallback = (message: Message): number => {
  if (message.info.role !== 'assistant') return 0
  // Fallback for compacted messages with unloaded parts.
  return estimateCharsFromTokens(message.info.tokens.output + message.info.tokens.reasoning)
}

const charsFromSystemPart = (part: Part): number => {
  if (part.type === 'text' && part.synthetic) return part.text.length
  return 0
}

function build(
  tokens: { system: number; user: number; assistant: number; tool: number; other: number },
  input: number,
): ContextBreakdownSegment[] {
  return (
    [
      { key: 'system' as const, tokens: tokens.system },
      { key: 'user' as const, tokens: tokens.user },
      { key: 'assistant' as const, tokens: tokens.assistant },
      { key: 'tool' as const, tokens: tokens.tool },
      { key: 'other' as const, tokens: tokens.other },
    ] satisfies { key: ContextBreakdownKey; tokens: number }[]
  )
    .filter((x) => x.tokens > 0)
    .map((x) => ({
      key: x.key,
      tokens: x.tokens,
      width: toPercent(x.tokens, input),
      percent: toPercentLabel(x.tokens, input),
    }))
}

function scaleDownToInput(
  tokens: { system: number; user: number; assistant: number; tool: number },
  input: number,
): { system: number; user: number; assistant: number; tool: number; other: number } {
  const entries = [
    { key: 'system' as const, value: tokens.system },
    { key: 'user' as const, value: tokens.user },
    { key: 'assistant' as const, value: tokens.assistant },
    { key: 'tool' as const, value: tokens.tool },
  ]

  const total = entries.reduce((sum, x) => sum + x.value, 0)
  if (total <= 0) {
    return { system: 0, user: 0, assistant: 0, tool: 0, other: input }
  }

  const scale = input / total
  const raw = entries.map((x) => ({
    ...x,
    scaled: x.value * scale,
  }))

  const floored = raw.map((x) => ({
    key: x.key,
    value: Math.floor(x.scaled),
    frac: x.scaled - Math.floor(x.scaled),
  }))

  let assigned = floored.reduce((sum, x) => sum + x.value, 0)
  let remaining = input - assigned

  if (remaining > 0) {
    const order = [...floored].sort((a, b) => b.frac - a.frac)
    let idx = 0
    while (remaining > 0 && order.length > 0) {
      order[idx % order.length].value += 1
      remaining -= 1
      idx += 1
    }
    assigned = floored.reduce((sum, x) => sum + x.value, 0)
  }

  const mapped = {
    system: floored.find((x) => x.key === 'system')?.value ?? 0,
    user: floored.find((x) => x.key === 'user')?.value ?? 0,
    assistant: floored.find((x) => x.key === 'assistant')?.value ?? 0,
    tool: floored.find((x) => x.key === 'tool')?.value ?? 0,
  }

  return {
    ...mapped,
    other: Math.max(0, input - assigned),
  }
}

export function estimateContextBreakdown(args: {
  messages: Message[]
  input: number
}): ContextBreakdownSegment[] {
  if (!args.input) return []

  const counts = args.messages.reduce(
    (acc, msg) => {
      const parts = msg.parts
      if (msg.info.role === 'user') {
        if (parts.length === 0) {
          return { ...acc, user: acc.user + charsFromUserFallback(msg) }
        }
        const user = parts.reduce((sum, part) => sum + charsFromUserPart(part), 0)
        const system = parts.reduce((sum, part) => sum + charsFromSystemPart(part), 0)
        return { ...acc, user: acc.user + user, system: acc.system + system }
      }

      if (msg.info.role !== 'assistant') return acc
      if (parts.length === 0) {
        return { ...acc, assistant: acc.assistant + charsFromAssistantFallback(msg) }
      }

      const result = parts.reduce(
        (sum, part) => {
          const system = charsFromSystemPart(part)
          const next = charsFromAssistantPart(part)
          return {
            assistant: sum.assistant + next.assistant,
            tool: sum.tool + next.tool,
            system: sum.system + system,
          }
        },
        { assistant: 0, tool: 0, system: 0 },
      )
      return {
        ...acc,
        assistant: acc.assistant + result.assistant,
        tool: acc.tool + result.tool,
        system: acc.system + result.system,
      }
    },
    { system: 0, user: 0, assistant: 0, tool: 0 },
  )

  const tokens = {
    system: estimateTokens(counts.system),
    user: estimateTokens(counts.user),
    assistant: estimateTokens(counts.assistant),
    tool: estimateTokens(counts.tool),
  }
  const estimated = tokens.system + tokens.user + tokens.assistant + tokens.tool

  if (estimated <= args.input) {
    return build({ ...tokens, other: args.input - estimated }, args.input)
  }

  // Scale down proportionally when estimates exceed actual input tokens.
  return build(scaleDownToInput(tokens, args.input), args.input)
}
