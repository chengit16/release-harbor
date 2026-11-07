/** @description 根据官方已读取字段展示有限资料检查；未读取的合规材料明确标为未检查。 */
import { List, Tag, Typography } from 'antd'
import type { StoreStatusSnapshot, StoreStatusTarget } from '@release-harbor/contracts'
import { AppleMaterialInspection } from './AppleMaterialInspection.tsx'

/** 资料完整度不代表送审资格，缺失版本字段也不自动判定安装包缺失。 */
export function StoreMaterialChecks({
  target,
  snapshot,
  reports,
  appleVersions,
  querying,
  onInspect,
}: {
  /** 当前可信应用绑定。 */
  target: StoreStatusTarget
  /** 最近一次官方查询，失败时不借旧成功给出通过结论。 */
  snapshot: StoreStatusSnapshot | undefined
  /** 当前绑定指纹下已保存的指定版本报告。 */
  reports: StoreStatusSnapshot[]
  /** 最新成功官方目录版本；本次查询失败时仍能检查已明确定位的历史版本。 */
  appleVersions: StoreStatusSnapshot['versions']
  /** 与状态查询共用互斥状态，仅控制界面防重复。 */
  querying: boolean
  /** 用户明确点击所选版本才触发检查。 */
  onInspect: (versionId: string) => void
}) {
  const observed = snapshot?.code === 'observed'
  const missingAppleBuild =
    observed &&
    target.channel === 'app_store' &&
    snapshot.versions.some((v) => v.state === 'draft' && !v.buildNumber)
  const checks = [
    {
      name: '应用目标',
      state: observed ? '已核对' : '未确认',
      text: observed ? '本次官方读取已核对应用目标。' : '请先完成一次官方查询。',
    },
    {
      name: '版本定位字段',
      state:
        observed &&
        snapshot.versions.length &&
        snapshot.versions.every((v) => v.versionName && (v.buildNumber || v.versionId))
          ? '已读取'
          : '信息有限',
      text: '以每条结果明确返回的版本、构建号或商店版本 ID 为准；缺失字段不能从旧版本补猜。',
    },
    {
      name: 'iOS 草稿构建',
      state: !observed
        ? '未检查'
        : missingAppleBuild
          ? '待补齐'
          : observed && snapshot.versions.some((v) => v.state === 'draft')
            ? '已关联'
            : '不适用',
      text: missingAppleBuild
        ? '官方目录中存在尚未关联构建的草稿版本，请到 App Store Connect 选择构建。'
        : '仅检查本次返回的 Apple 草稿构建关系，不证明构建可用或审核资料完整；没有草稿时此项不适用。',
    },
    {
      name: target.channel === 'app_store' ? '隐私与完整合规材料' : '隐私、截图与合规材料',
      state: '未检查',
      text: '状态查询未读取完整审核材料，请在官方后台维护；未检查不代表已通过。',
    },
  ].filter((item) =>
    item.name === 'iOS 草稿构建'
      ? target.channel === 'app_store'
      : item.name === '隐私与完整合规材料'
        ? target.channel !== 'app_store'
        : true,
  )
  return (
    <section className="store-tracking-section" aria-label="资料检查">
      <Typography.Title level={5}>资料检查</Typography.Title>
      <List
        dataSource={checks}
        renderItem={(item) => (
          <List.Item>
            <List.Item.Meta
              title={
                <>
                  {item.name}{' '}
                  <Tag color={item.state === '待补齐' ? 'warning' : 'default'}>{item.state}</Tag>
                </>
              }
              description={item.text}
            />
          </List.Item>
        )}
      />
      {(target.channel === 'app_store' || target.channel === 'meizu') && (
        <AppleMaterialInspection
          key={target.bindingId}
          channel={target.channel}
          versions={appleVersions}
          reports={reports}
          querying={querying}
          onInspect={onInspect}
        />
      )}
    </section>
  )
}
