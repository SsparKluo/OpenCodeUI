import { describe, expect, it } from 'vitest'
import { shouldBypassCache } from './cache'

describe('shouldBypassCache', () => {
  it('bypasses SSE global event', () => {
    const req = new Request('https://x/api/global/event', {
      headers: { Accept: 'text/event-stream' },
    })
    expect(shouldBypassCache(req, '/global/event')).toBe(true)
  })

  it('bypasses authorized GET', () => {
    const req = new Request('https://x/api/health', {
      headers: { Authorization: 'Basic x' },
    })
    expect(shouldBypassCache(req, '/health')).toBe(true)
  })

  it('allows anonymous GET health', () => {
    const req = new Request('https://x/api/health')
    expect(shouldBypassCache(req, '/health')).toBe(false)
  })
})