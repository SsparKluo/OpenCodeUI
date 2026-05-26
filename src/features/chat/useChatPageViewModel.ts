import { useMemo } from 'react'
import type { Message } from '../../types/message'
import { buildOutlineSourceEntries, type OutlineSourceEntry } from '../../components/outlineIndexModel'
import { buildVisibleMessageEntries, getVisibleMessageForkTargetId } from './chatAreaVisibility'
import { buildContentKeyedChatPages, buildTurnDurationMap, type StableChatPage } from './chatPageModel'

export interface ChatPageViewModel {
  visibleMessages: Message[]
  pageRecords: StableChatPage[]
  outlineSourceEntries: OutlineSourceEntry[]
  forkTargetIdMap: Map<string, string | undefined>
  turnDurationMap: Map<string, number>
}

export function useChatPageViewModel(messages: Message[]): ChatPageViewModel {
  const visibleMessageEntries = useMemo(() => buildVisibleMessageEntries(messages), [messages])
  const visibleMessages = useMemo(() => visibleMessageEntries.map(entry => entry.message), [visibleMessageEntries])
  const pageRecords = useMemo(() => buildContentKeyedChatPages(visibleMessages), [visibleMessages])
  const forkTargetIdMap = useMemo(
    () => new Map(visibleMessageEntries.map(entry => [entry.message.info.id, getVisibleMessageForkTargetId(entry)])),
    [visibleMessageEntries],
  )
  const outlineSourceEntries = useMemo(() => buildOutlineSourceEntries(visibleMessages), [visibleMessages])
  const turnDurationMap = useMemo(() => buildTurnDurationMap(messages, visibleMessages), [messages, visibleMessages])

  return { visibleMessages, pageRecords, outlineSourceEntries, forkTargetIdMap, turnDurationMap }
}
