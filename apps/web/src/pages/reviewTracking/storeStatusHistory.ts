/** @description 同一绑定与查询范围的历史比较；仅比较可定位的相同版本，不把目录缺项推断成下架。 */
import type { StoreStatusSnapshot, StoreVersionStatus } from '@release-harbor/contracts'

/** 差异是两次读取的比较结果，不能作为状态真实发生时间或原执行的关联证明。 */
export interface StoreStatusChange {
  /** 新读取、状态不同或本次未返回；后者不代表下架或删除。 */
  kind: 'read' | 'changed' | 'not_returned'
  /** 当前版本；本次未返回时为上次版本，仅用于标识。 */
  version: StoreVersionStatus
  /** 仅确定为同一版本且状态不同才携带旧结论。 */
  previous?: StoreVersionStatus
}

function scope(snapshot: StoreStatusSnapshot): string {
  return snapshot.query?.buildNumber ?? 'default'
}

function identity(version: StoreVersionStatus): string | null {
  // 版本名不具有唯一性；缺 ID 与构建号时不能把两次应用级流程关联成同一个包。
  if (!version.versionId && !version.buildNumber) return null
  return JSON.stringify([version.versionId, version.versionName, version.buildNumber])
}

function uniqueVersions(versions: StoreVersionStatus[]): Map<string, StoreVersionStatus> {
  const entries = versions.map((version) => [identity(version), version] as const)
  return new Map(
    entries.filter(
      (entry): entry is readonly [string, StoreVersionStatus] =>
        entry[0] !== null && entries.filter(([key]) => key === entry[0]).length === 1,
    ),
  )
}

/** 失败不产生状态变化；比较同范围最近的较早成功，缺身份或重复身份时只展示本次读取。 */
export function compareStoreStatusHistory(
  history: StoreStatusSnapshot[],
  index: number,
): { baseline: StoreStatusSnapshot | undefined; changes: StoreStatusChange[] } {
  const current = history[index]
  if (!current || current.code !== 'observed') return { baseline: undefined, changes: [] }
  // 1. 留存顺序是完成顺序；跳过失败，但不跨绑定、渠道或构建查询范围。
  const baseline = history
    .slice(index + 1)
    .find(
      (item) =>
        item.bindingId === current.bindingId &&
        item.channel === current.channel &&
        scope(item) === scope(current) &&
        item.code === 'observed',
    )
  const before = uniqueVersions(baseline?.versions ?? [])
  const after = uniqueVersions(current.versions)
  const changes: StoreStatusChange[] = []
  // 2. 仅唯一、完整相同的定位字段允许比较状态；缺失或更换字段不猜补关联。
  for (const version of current.versions) {
    const key = identity(version)
    const previous = key && after.has(key) ? before.get(key) : undefined
    if (!previous) changes.push({ kind: 'read', version })
    else if (previous.state !== version.state) changes.push({ kind: 'changed', version, previous })
  }
  // 3. 官方目录可能缩小或有界截断；未返回只能说明本次读取范围的差异。
  for (const [key, version] of before) {
    if (!current.versions.some((item) => identity(item) === key))
      changes.push({ kind: 'not_returned', version })
  }
  return { baseline, changes }
}
