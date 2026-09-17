import type { ServerChangeReason } from './serverStore'

/**
 * 评审 N3：onServerChange 门控的共享谓词——某次服务器变化是否应当影响
 * 「绑定某服务器」的消费方。所有门控消费方共用这一处语义，杜绝各文件手写
 * 比对时漏分支（评审 N2 的直接教训：BottomPanel 拿 changedId 与 active 比对，
 * 固定绑定 WSL 的面板被误跳过）。
 *
 * 设计为纯函数（activeServerId 由调用方现读传入），不闭合 serverStore 单例：
 * 消费方测试普遍整 mock serverStore 模块，闭包单例的谓词在 mock 环境要么丢失、
 * 要么读到与测试假象不一致的真实状态。纯函数 + 调用点传参让门控语义在任何
 * mock 组合下都保持单一真源。
 *
 * - boundServerId 为空（数据主体跟随 active 服务器）：
 *   - server-switch：active 本身换了（含删除回退）→ 影响
 *   - 端点变化类 reason（WSL 换端口等）：只有变的这台恰好是当前 active 才影响
 *     （非 active 重启不该让 active 数据「清空 → 重拉」闪烁）
 * - boundServerId 指定（面板/订阅固定绑定这台服务器）：变化发生在这台本身才影响
 */
export function affectsBoundServer(
  boundServerId: string | undefined | null,
  changedServerId: string,
  reason: ServerChangeReason,
  activeServerId: string,
): boolean {
  if (boundServerId) return changedServerId === boundServerId
  if (reason === 'server-switch') return true
  return activeServerId === changedServerId
}
