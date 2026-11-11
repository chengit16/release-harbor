/** @description 在线安装包定期回收；与页面读取无关，在空间锁下再次判断过期及引用保护。 */
import type { Pool } from 'pg'
import { hostedArtifactLimits } from '@release-harbor/contracts'
import { transaction } from '../database.ts'
import { artifactHasHold, expiredArtifactCandidates, hostedArtifactRow } from './repository.ts'
import { HostedArtifacts } from './service.ts'
import type { HostedArtifactStorage } from './storage.ts'

/** 回收一批到期记录；每项事务独立，失败留给后续回收而不释放配额。 */
export async function sweepHostedArtifacts(
  pool: Pool,
  storage: HostedArtifactStorage,
  signal?: AbortSignal,
): Promise<number> {
  const service = new HostedArtifacts(storage)
  let failures = 0
  for (const candidate of await expiredArtifactCandidates(pool)) {
    if (signal?.aborted) break
    try {
      await transaction(pool, async (client) => {
        await client.query('SELECT id FROM rh_hosted.workspaces WHERE id = $1 FOR NO KEY UPDATE', [
          candidate.workspaceId,
        ])
        const scope = { ...candidate, client }
        const row = await hostedArtifactRow(scope, candidate.id)
        if (row.status === 'receiving' && row.secondsLeft < 0) await service.cancel(scope, row.id)
        if (
          row.status === 'awaiting_check' &&
          row.receivedAt &&
          Date.now() - row.receivedAt.getTime() >= hostedArtifactLimits.retentionSeconds * 1000 &&
          !(await artifactHasHold(scope, row.id))
        )
          await service.remove(scope, row.id)
      })
    } catch {
      // 对象版本或取消状态无法核对时不回收配额，下一轮重新检查。
      failures++
    }
  }
  return failures
}

/** 仅在线存储已配置时定期回收；关闭时停止领取新记录并等待当前事务结束。 */
export function startHostedArtifactSweep(
  pool: Pool,
  storage: HostedArtifactStorage,
): () => Promise<void> {
  const controller = new AbortController()
  let pending: Promise<void> | undefined
  const timer = setInterval(
    () => {
      if (pending) return
      pending = sweepHostedArtifacts(pool, storage, controller.signal)
        .then((failures) => {
          if (failures) console.error('部分在线安装包回收未完成，将保留配额后续核对')
        })
        .catch(() => console.error('在线安装包回收暂不可用'))
        .finally(() => {
          pending = undefined
        })
    },
    15 * 60 * 1000,
  )
  timer.unref()
  return async () => {
    clearInterval(timer)
    controller.abort()
    await pending
  }
}
