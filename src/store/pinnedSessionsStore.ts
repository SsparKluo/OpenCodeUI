// ============================================
// PinnedSessionsStore — 置顶对话状态管理
// ============================================
//
// 跨工作区持久化的置顶会话列表。
// 存储 { sessionId, directory, title } 以便未加载 session 详情时也能渲染。

export interface PinnedSessionEntry {
  sessionId: string
  directory: string
  title: string
}

const STORAGE_KEY = 'opencode-pinned-sessions'

class PinnedSessionsStore {
  private entries: PinnedSessionEntry[] = []
  private listeners = new Set<() => void>()

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          this.entries = parsed.filter(
            (item): item is PinnedSessionEntry =>
              typeof item.sessionId === 'string' &&
              typeof item.directory === 'string' &&
              typeof item.title === 'string',
          )
        }
      }
    } catch {
      this.entries = []
    }
  }

  isPinned(sessionId: string): boolean {
    return this.entries.some(e => e.sessionId === sessionId)
  }

  pin(entry: PinnedSessionEntry) {
    const existingIndex = this.entries.findIndex(e => e.sessionId === entry.sessionId)
    if (existingIndex !== -1) {
      const existing = this.entries[existingIndex]
      if (existing.directory === entry.directory && existing.title === entry.title) return
      this.entries = [
        ...this.entries.slice(0, existingIndex),
        entry,
        ...this.entries.slice(existingIndex + 1),
      ]
      this.persist()
      this.emit()
      return
    }
    this.entries = [...this.entries, entry]
    this.persist()
    this.emit()
  }

  update(sessionId: string, patch: Partial<Omit<PinnedSessionEntry, 'sessionId'>>) {
    const index = this.entries.findIndex(e => e.sessionId === sessionId)
    if (index === -1) return
    const next = { ...this.entries[index], ...patch }
    if (next.directory === this.entries[index].directory && next.title === this.entries[index].title) return
    this.entries = [...this.entries.slice(0, index), next, ...this.entries.slice(index + 1)]
    this.persist()
    this.emit()
  }

  unpin(sessionId: string) {
    const idx = this.entries.findIndex(e => e.sessionId === sessionId)
    if (idx === -1) return
    this.entries = [...this.entries.slice(0, idx), ...this.entries.slice(idx + 1)]
    this.persist()
    this.emit()
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries))
    } catch {
      /* ignore persistence failures */
    }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): PinnedSessionEntry[] => {
    return this.entries
  }

  private emit() {
    this.listeners.forEach(fn => fn())
  }
}

export const pinnedSessionsStore = new PinnedSessionsStore()
