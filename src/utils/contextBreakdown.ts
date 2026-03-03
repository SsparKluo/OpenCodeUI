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

const estimateTokens = (chars: number) => Math.ceil(chars / 4)
const toPercent = (tokens: number, input: number) => (tokens / input) * 100
const toPercentLabel = (tokens: number, input: number) =>
  Math.round(toPercent(tokens, input) * 10) / 10

const charsFromUserPart = (part: Part): number => {
  if (part.type === 'text' && !part.synthetic) return part.text.length
  if (part.type === 'file') return part.source && 'text' in part.source ? part.source.text.value?.length ?? 0 : 0
  if (part.type === 'agent') return part.source?.value?.length ?? 0
  return 0
}

const charsFromAssistantPart = (part: Part): { assistant: number; tool: number } => {
  if (part.type === 'text') return { assistant: part.text.length, tool: 0 }
  if (part.type === 'reasoning') return { assistant: part.text.length, tool: 0 }
  if (part.type !== 'tool') return { assistant: 0, tool: 0 }

  const input = part.state.input ? Object.keys(part.state.input).length * 16 : 0
  if (part.state.status === 'pending') return { assistant: 0, tool: input + (part.state.raw?.length ?? 0) }
  if (part.state.status === 'completed') return { assistant: 0, tool: input + (part.state.output?.length ?? 0) }
  if (part.state.status === 'error') return { assistant: 0, tool: input + (part.state.error?.length ?? 0) }
  return { assistant: 0, tool: input }
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

export function estimateContextBreakdown(args: {
  messages: Message[]
  input: number
}): ContextBreakdownSegment[] {
  if (!args.input) return []

  const counts = args.messages.reduce(
    (acc, msg) => {
      const parts = msg.parts
      if (msg.info.role === 'user') {
        const user = parts.reduce((sum, part) => sum + charsFromUserPart(part), 0)
        const system = parts.reduce((sum, part) => sum + charsFromSystemPart(part), 0)
        return { ...acc, user: acc.user + user, system: acc.system + system }
      }

      if (msg.info.role !== 'assistant') return acc
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

  // Scale down proportionally when estimates exceed actual input tokens
  const scale = args.input / estimated
  const scaled = {
    system: Math.floor(tokens.system * scale),
    user: Math.floor(tokens.user * scale),
    assistant: Math.floor(tokens.assistant * scale),
    tool: Math.floor(tokens.tool * scale),
  }
  const total = scaled.system + scaled.user + scaled.assistant + scaled.tool
  return build({ ...scaled, other: Math.max(0, args.input - total) }, args.input)
}
