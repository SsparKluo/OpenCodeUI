import { describe, expect, it } from 'vitest'

import { affectsBoundServer } from './serverChangeScope'

// 评审 N3：共享门控谓词的语义契约（纯函数直测，无需 mock）
describe('affectsBoundServer', () => {
  it('follow-active: switch always affects, endpoint changes only for the active one', () => {
    // 任何切换（含删除回退）都意味着 active 数据源换了
    expect(affectsBoundServer(undefined, 'wsl:Ubuntu', 'server-switch', 'local')).toBe(true)
    // 端点变化类 reason：只有变的这台恰好是 active 才相关
    expect(affectsBoundServer(undefined, 'local', 'server-runtime-updated', 'local')).toBe(true)
    expect(affectsBoundServer(undefined, 'wsl:Ubuntu', 'server-runtime-updated', 'local')).toBe(false)
    expect(affectsBoundServer(undefined, 'wsl:Ubuntu', 'local-runtime-url', 'local')).toBe(false)
  })

  it('fixed binding: only changes on the bound server itself affect', () => {
    // 切到别的服务器、别的服务器重启，都与固定绑定的消费方无关
    expect(affectsBoundServer('wsl:Ubuntu', 'local', 'server-switch', 'local')).toBe(false)
    expect(affectsBoundServer('wsl:Ubuntu', 'wsl:Debian', 'server-runtime-updated', 'local')).toBe(false)
    // 「这台」自身的变化（无论何种 reason）才需要响应；active 参数在固定模式下不参与判断
    expect(affectsBoundServer('wsl:Ubuntu', 'wsl:Ubuntu', 'server-runtime-updated', 'local')).toBe(true)
    expect(affectsBoundServer('wsl:Ubuntu', 'wsl:Ubuntu', 'server-switch', 'local')).toBe(true)
  })
})
