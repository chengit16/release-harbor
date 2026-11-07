/** @description 官方版本结果按流程、在架和历史分组；失败与上次成功分别显示，不把缓存当实时状态。 */
import { Alert, Collapse, List, Tag, Typography } from 'antd'
import type {
  BindingChannel,
  StoreStatusSnapshot,
  StoreVersionStatus,
} from '@release-harbor/contracts'
import {
  storeMaterialExtraLabels,
  storeMaterialLabels,
  storeMaterialStates,
  storeRejectionLabels,
} from '@release-harbor/contracts'
import { StoreVersionTag } from './StoreVersionTag.tsx'
import { storeVersionTitle } from './storeStatusPresentation.ts'

/** 固定错误建议不包含供应商原文或秘密。 */
export const queryFailureLabels = {
  authentication: '账号验证失败，请在商店账号中核对材料及官方查询权限。',
  request_rejected:
    '商店拒绝了查询请求，请核对账号的查询权限；若权限正常，请更新程序后重查或到商店后台核对。',
  network: '商店查询未完成，请检查网络后再查询，或到商店后台核对。',
  invalid_response: '商店响应的身份、构建号或字段无法安全核对，请到商店后台核对。',
  unsupported: '当前查询能力尚未接入，请到商店后台核对。',
  observed: '',
}

function versionList(channel: BindingChannel, versions: StoreVersionStatus[]) {
  return (
    <List
      dataSource={versions}
      renderItem={(version) => (
        <List.Item>
          <List.Item.Meta
            style={{ minWidth: 0, overflowWrap: 'anywhere' }}
            title={storeVersionTitle(channel, version)}
            description={
              <div>
                {version.buildNumber ? `构建号 ${version.buildNumber}` : '商店未提供构建号'}
                {version.versionId &&
                  ` · ${channel === 'honor' ? '审核单 / 版本 ID' : '版本 ID'} ${version.versionId}`}
                {version.rejection && (
                  <Alert
                    className="store-version-rejection"
                    type="warning"
                    showIcon
                    title="审核原因分类提示"
                    description={
                      version.rejection.availability === 'not_provided'
                        ? '官方响应未提供原因；请到商店后台查看完整审核意见。'
                        : version.rejection.availability === 'unclassified'
                          ? '已收到原因但未匹配分类；请到商店后台查看完整审核意见。'
                          : `可能涉及：${version.rejection.categories.map((key) => storeRejectionLabels[key]).join('、')}。此分类不完整，完整意见请到商店后台查看。`
                    }
                  />
                )}
                {version.materials && (
                  <div className="store-version-materials">
                    {Object.entries(version.materials.checks)
                      .filter(([, state]) => state !== 'unchecked')
                      .map(([key, state]) => (
                        <Tag
                          key={key}
                          color={
                            state === 'missing'
                              ? 'warning'
                              : state === 'present'
                                ? 'success'
                                : 'default'
                          }
                        >
                          {storeMaterialLabels[key as keyof typeof storeMaterialLabels]}：
                          {storeMaterialStates[state]}
                        </Tag>
                      ))}
                    {Object.entries(version.materials.extraChecks ?? {}).map(
                      ([key, state]) =>
                        state && (
                          <Tag
                            key={key}
                            color={
                              state === 'missing'
                                ? 'warning'
                                : state === 'present'
                                  ? 'success'
                                  : 'default'
                            }
                          >
                            {storeMaterialExtraLabels[key as keyof typeof storeMaterialExtraLabels]}
                            ：{storeMaterialStates[state]}
                          </Tag>
                        ),
                    )}
                  </div>
                )}
              </div>
            }
          />
          <div className="store-status-detail-tag">
            <StoreVersionTag channel={channel} version={version} />
          </div>
        </List.Item>
      )}
    />
  )
}

/** 同一查询范围按最近结果展示；失败时仍保留上次成功及原时间，默认目录和指定构建分别调用。 */
export function StoreVersionResults({
  channel,
  snapshots,
  label,
}: {
  /** 目标渠道，用于公开在架等范围提示。 */
  channel: BindingChannel
  /** 同一绑定、同一构建查询范围，最近结果优先。 */
  snapshots: StoreStatusSnapshot[]
  /** 官方目录或指定构建的可读标题。 */
  label: string
}) {
  const latest = snapshots[0]
  const success = snapshots.find((item) => item.code === 'observed')
  const current =
    success?.versions.filter((v) => !['published', 'removed', 'superseded'].includes(v.state)) ?? []
  const published = success?.versions.filter((v) => v.state === 'published') ?? []
  const history = success?.versions.filter((v) => ['removed', 'superseded'].includes(v.state)) ?? []
  return (
    <section className="store-tracking-section" aria-label={label}>
      <Typography.Title level={5}>{label}</Typography.Title>
      {latest && latest.code !== 'observed' && (
        <Alert
          type="warning"
          showIcon
          title="本次查询失败"
          description={`${queryFailureLabels[latest.code]} 查询时间：${new Date(latest.checkedAt).toLocaleString()}（非实时）。`}
        />
      )}
      {success && (
        <>
          <Typography.Paragraph type="secondary">
            以下为 {new Date(success.checkedAt).toLocaleString()} 的官方查询结果（非实时）
            {latest !== success ? '，本次失败前的历史结果，仅供参考' : ''}。
          </Typography.Paragraph>
          {!!current.length && (
            <>
              <Tag color="processing">审核与发布流程 / 版本资料</Tag>
              {versionList(channel, current)}
            </>
          )}
          {!!published.length && (
            <>
              <Tag>在架版本</Tag>
              {versionList(channel, published)}
            </>
          )}
          {!!history.length && (
            <Collapse
              items={[
                {
                  key: 'history',
                  label: `历史版本（${history.length}）`,
                  children: versionList(channel, history),
                },
              ]}
            />
          )}
          {!success.versions.length && (
            <Typography.Text type="secondary">官方接口本次未返回版本</Typography.Text>
          )}
        </>
      )}
    </section>
  )
}
