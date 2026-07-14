/** 与消息入场生长动画一致（motion duration 0.2s） */
export const ENTRY_GROW_DURATION_MS = 200
/** 超过此时长的消息不再播入场生长 */
export const ENTRY_GROW_MAX_AGE_MS = 3000

const completedIds = new Set<string>()

export function isEntryGrowComplete(id: string): boolean {
  return completedIds.has(id)
}

export function markEntryGrowComplete(id: string): void {
  completedIds.add(id)
}

export function shouldPlayEntryGrow(created: number, now = Date.now()): boolean {
  return now - created <= ENTRY_GROW_MAX_AGE_MS
}

/** 仅测试用 */
export function resetEntryGrowCompletionsForTests(): void {
  completedIds.clear()
}
