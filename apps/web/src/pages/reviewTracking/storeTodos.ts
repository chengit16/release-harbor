/** @description 待办从已有官方快照及人工记录推导；没有网络请求，不把历史在架或人工结论当作新包审核证明。 */
import type {
  StoreManualRecord,
  StoreStatusSnapshot,
  StoreStatusTarget,
  StoreVersionStatus,
} from '@release-harbor/contracts'
import { storeMaterialLabels } from '@release-harbor/contracts'

/** 待办状态只用于浏览和指引，不参与发布授权。 */
export const storeTodoLabels = {
  rejected: '审核需处理',
  manual_release: '等待手动发布',
  query_failed: '查询失败',
  verify: '需后台核对',
  materials: '资料待完善',
} as const

/** 每项携带来源、具体版本及观察时间，null 时间表示尚无核对事实。 */
export interface StoreTodo {
  id: string
  target: StoreStatusTarget
  kind: keyof typeof storeTodoLabels
  source: 'official' | 'manual' | 'capability'
  checkedAt: string | null
  version: StoreVersionStatus | null
  guidance: string
}

function category(version: StoreVersionStatus): StoreTodo['kind'] | null {
  if (
    ['rejected', 'pre_rejected', 'qualification_rejected', 'removal_rejected'].includes(
      version.state,
    )
  )
    return 'rejected'
  if (version.state === 'pending_manual_release') return 'manual_release'
  if (version.state === 'draft') return 'materials'
  if (version.state === 'unknown' || version.state === 'frozen') return 'verify'
  return null
}

/** 最新人工事实按版本与构建分组；补充记录保留历史，旧状态不重复生成待办。 */
export function latestManualRecords(records: StoreManualRecord[]): StoreManualRecord[] {
  const seen = new Set<string>()
  return [...records]
    .sort(
      (a, b) =>
        Date.parse(b.checkedAt) - Date.parse(a.checkedAt) ||
        Date.parse(b.createdAt) - Date.parse(a.createdAt),
    )
    .filter((record) => {
      const key = JSON.stringify([record.bindingId, record.versionName, record.buildNumber])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/**
 * 查询失败只提示恢复；历史成功不参与当次待办判断，避免显示过期的可发布动作。
 * 长函数保留原因：按同一绑定依次归并状态范围、资料报告和人工来源，共用版本去重与待办集合，集中保护跨来源的时序规则。
 */
export function storeTodos(
  targets: StoreStatusTarget[],
  snapshots: StoreStatusSnapshot[],
  tracked: StoreStatusSnapshot[],
  manual: StoreManualRecord[],
  materialSnapshots: StoreStatusSnapshot[] = [],
): StoreTodo[] {
  const result: StoreTodo[] = []
  for (const target of targets) {
    // 1. 同一查询范围只使用第一条结果；失败后的旧成功保留在详情，不冒充最新事实。
    const scopes = new Set<string>()
    const latest = [...snapshots, ...tracked]
      .filter((item) => item.bindingId === target.bindingId)
      .filter((item) => {
        const key = item.query?.buildNumber ?? 'default'
        if (scopes.has(key)) return false
        scopes.add(key)
        return true
      })
      .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
    const versions = new Set<string>()
    for (const snapshot of latest) {
      if (snapshot.code !== 'observed') {
        // 指定构建失败后不从另一个更旧范围恢复该构建的待发布动作。
        if (snapshot.query) versions.add(`build:${snapshot.query.buildNumber}`)
        result.push({
          id: `${target.bindingId}:failed:${snapshot.query?.buildNumber ?? 'default'}`,
          target,
          kind: 'query_failed',
          source: 'official',
          checkedAt: snapshot.checkedAt,
          version: snapshot.query
            ? {
                versionId: null,
                versionName: null,
                buildNumber: snapshot.query.buildNumber,
                state: 'unknown',
                rawState: null,
              }
            : null,
          guidance: '打开详情查看失败原因；核对账号或网络后明确点击重新查询。',
        })
        continue
      }
      for (const version of snapshot.versions) {
        // 指定构建和默认返回同一个构建时只保留较新的观察；无版本关联的流程不合并。
        const key = version.buildNumber
          ? `build:${version.buildNumber}`
          : JSON.stringify([version.versionId, version.versionName])
        if (versions.has(key)) continue
        versions.add(key)
        const kind = category(version)
        // 应用宝版本资料没有审核关联，不能把这条资料生成第二个未知审核待办。
        if (
          !kind ||
          (target.channel === 'tencent' && version.buildNumber && version.state === 'unknown')
        )
          continue
        result.push({
          id: `${target.bindingId}:${key}`,
          target,
          kind,
          source: 'official',
          checkedAt: snapshot.checkedAt,
          version,
          guidance:
            kind === 'rejected'
              ? '前往官方后台查看该版本的审核意见并处理；重新送审通过发布中心发起。'
              : kind === 'manual_release'
                ? '该版本等待开发者手动发布；前往发布中心选择对应版本并核对摘要后执行。'
                : kind === 'materials'
                  ? '该版本尚在草稿阶段，请打开详情检查可见版本资料，并在官方后台完善审核材料。'
                  : '当前接口无法确认完整结论，请核对详情中的版本、查询范围及官方后台。',
        })
      }
    }
    // 2. 指定版本报告独立生成缺项或失败待办；旧成功不能掩盖最新检查失败。
    const checkedMaterials = new Set<string>()
    for (const report of materialSnapshots.filter((item) => item.bindingId === target.bindingId)) {
      if (!report.materialVersionId || checkedMaterials.has(report.materialVersionId)) continue
      checkedMaterials.add(report.materialVersionId)
      const version = report.versions[0] ?? {
        versionId: report.materialVersionId,
        versionName: null,
        buildNumber: null,
        state: 'unknown' as const,
        rawState: null,
      }
      if (report.code !== 'observed') {
        result.push({
          id: `${target.bindingId}:materials:${report.materialVersionId}`,
          target,
          kind: 'query_failed',
          source: 'official',
          checkedAt: report.checkedAt,
          version,
          guidance: `版本 ID ${report.materialVersionId} 的资料检查失败，请打开详情选择此版本核对；旧报告仅供参考。`,
        })
        continue
      }
      if (!report.materials || !['draft', 'rejected', 'withdrawn'].includes(version.state)) continue
      // 后续官方状态已经推进时，旧资料报告只能在详情参考，不能重建草稿补资料待办。
      const newer = latest
        .find(
          (item) =>
            item.code === 'observed' && Date.parse(item.checkedAt) > Date.parse(report.checkedAt),
        )
        ?.versions.find((item) => item.versionId === report.materialVersionId)
      if (newer && !['draft', 'rejected', 'withdrawn'].includes(newer.state)) continue
      const missing = Object.entries(report.materials.checks)
        .filter(([, state]) => state === 'missing')
        .map(([key]) => storeMaterialLabels[key as keyof typeof storeMaterialLabels])
      if (!missing.length) continue
      const guidance = `已读取的资料待补齐：${missing.join('、')}。请到官方后台处理，复查后再通过发布中心准备；完整合规资料仍未检查。`
      const existing = result.find(
        (item) =>
          item.target.bindingId === target.bindingId &&
          item.kind === 'materials' &&
          item.version?.versionId === version.versionId,
      )
      if (existing) {
        existing.guidance = guidance
        existing.checkedAt = report.checkedAt
      } else
        result.push({
          id: `${target.bindingId}:materials:${report.materialVersionId}`,
          target,
          kind: 'materials',
          source: 'official',
          checkedAt: report.checkedAt,
          version,
          guidance,
        })
    }
    // 3. 小米公开在架与人工核对独立；缺人工记录时直接提供后台核对指引。
    if (target.channel === 'xiaomi') {
      const records = latestManualRecords(
        manual.filter((item) => item.bindingId === target.bindingId),
      )
      if (!records.length)
        result.push({
          id: `${target.bindingId}:manual`,
          target,
          kind: 'verify',
          source: 'capability',
          checkedAt: null,
          version: null,
          guidance: '小米未开放审核进度查询，请到后台查看送审版本，必要时在详情添加人工核对记录。',
        })
      for (const record of records) {
        const version = {
          versionId: null,
          versionName: record.versionName,
          buildNumber: record.buildNumber,
          state: record.state,
          rawState: null,
        }
        const kind = category(version)
        if (kind)
          result.push({
            id: record.requestId,
            target,
            kind,
            source: 'manual',
            checkedAt: record.checkedAt,
            version,
            guidance: '此项来自人工核对，请到后台处理后追加新的核对记录；不会改写官方结果。',
          })
      }
    }
  }
  return result
}
