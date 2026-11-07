/** @description Apple 指定版本只读资料检查；显式点击后查询，私人字段从不进入页面，失败保留旧报告时间。 */
import { useState } from 'react'
import { Alert, Button, Flex, List, Select, Tag, Typography } from 'antd'
import {
  storeMaterialLabels,
  storeMaterialStates,
  type StoreStatusSnapshot,
  type StoreVersionStatus,
} from '@release-harbor/contracts'
import { queryFailureLabels } from './StoreVersionResults.tsx'

const guidance = {
  build: '仅核对版本是否关联构建，不证明构建已处理完成或可送审。',
  description: '检查官方返回的各语言版本描述是否非空，不读取文案到页面。',
  support_url: '检查各语言支持网址是否填写有效 HTTP／HTTPS 地址，不验证网站内容。',
  screenshots:
    '每个已检查语种至少有一张完成上传的截图；不验证设备尺寸与截图内容。超过三个语种或六个截图组时未确认。',
  review_contact: '只检查姓名、邮箱和电话是否填写，不验证联系方式是否有效。',
  demo_access: '后台要求测试账号时检查账号和密码是否填写，不验证能否登录；私人材料不会返回页面。',
  privacy: '隐私政策与隐私标签当前未读取，请到 App Store Connect 核对。',
  compliance: '评级、加密、合同及其他合规材料当前未检查，以官方送审校验为准。',
}
const materialFields: { key: keyof typeof storeMaterialLabels; label: string }[] = [
  { key: 'build', label: storeMaterialLabels.build },
  { key: 'description', label: storeMaterialLabels.description },
  { key: 'support_url', label: storeMaterialLabels.support_url },
  { key: 'screenshots', label: storeMaterialLabels.screenshots },
  { key: 'review_contact', label: storeMaterialLabels.review_contact },
  { key: 'demo_access', label: storeMaterialLabels.demo_access },
  { key: 'privacy', label: storeMaterialLabels.privacy },
  { key: 'compliance', label: storeMaterialLabels.compliance },
]

/** 报告只表示字段完整性；拒绝意见仍到官方后台查看，再通过发布中心准备新动作。 */
export function AppleMaterialInspection({
  versions,
  reports,
  querying,
  onInspect,
}: {
  /** 当前已读取的版本目录，缺目录时不猜测版本 ID。 */
  versions: StoreVersionStatus[]
  /** 每个版本最近结果及失败前成功，按完成顺序排列。 */
  reports: StoreStatusSnapshot[]
  /** 有状态或资料请求运行时禁止重复派发。 */
  querying: boolean
  /** 只在用户点击后检查此确定版本。 */
  onInspect: (versionId: string) => void
}) {
  const [selected, setSelected] = useState('')
  const candidates = [
    ...new Map(
      [...reports.flatMap((item) => item.versions).reverse(), ...versions]
        .filter((item) => item.versionId)
        .map((item) => [item.versionId, item]),
    ).values(),
  ]
  const versionId =
    (candidates.some((item) => item.versionId === selected) ? selected : '') ||
    candidates.find((item) => ['draft', 'rejected', 'withdrawn'].includes(item.state))?.versionId ||
    candidates[0]?.versionId ||
    ''
  const matching = reports.filter((item) => item.materialVersionId === versionId)
  const latest = matching[0],
    success = matching.find((item) => item.code === 'observed')
  return (
    <section aria-label="Apple指定版本资料检查">
      <Flex wrap gap={8} align="center">
        <Select
          aria-label="资料检查版本"
          placeholder="请先查询商店版本"
          value={versionId || undefined}
          showSearch
          optionFilterProp="label"
          onChange={setSelected}
          style={{ width: '100%' }}
          options={candidates.map((item) => ({
            value: item.versionId,
            label: `${item.versionName ?? '未提供版本名'} · ID ${item.versionId} · 构建 ${item.buildNumber ?? '未关联'}`,
          }))}
        />
        <Button
          type="primary"
          disabled={!versionId || querying}
          onClick={() => onInspect(versionId)}
        >
          检查所选版本资料
        </Button>
      </Flex>
      <Typography.Paragraph type="secondary" className="form-feedback">
        只读检查，与商店状态查询共用十秒间隔。拒绝意见请到官方后台查看；处理后从发布中心准备新操作。字段齐全不代表审核通过或具备送审资格。
      </Typography.Paragraph>
      {latest && latest.code !== 'observed' && (
        <Alert
          type="warning"
          showIcon
          title="本次资料检查失败"
          description={`${queryFailureLabels[latest.code]} 检查时间：${new Date(latest.checkedAt).toLocaleString()}（非实时）。`}
        />
      )}
      {success?.materials ? (
        <>
          <Typography.Paragraph type="secondary">
            资料读取时间：{new Date(success.checkedAt).toLocaleString()}（非实时）
            {latest !== success && '，本次失败前的历史报告，仅供参考'}。
          </Typography.Paragraph>
          <List
            dataSource={materialFields}
            renderItem={({ key: field, label }) => {
              if (!success.materials) return null
              const state = success.materials.checks[field]
              return (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <>
                        {label}{' '}
                        <Tag
                          color={
                            state === 'missing'
                              ? 'warning'
                              : state === 'present'
                                ? 'success'
                                : 'default'
                          }
                        >
                          {storeMaterialStates[state]}
                        </Tag>
                      </>
                    }
                    description={guidance[field]}
                  />
                </List.Item>
              )
            }}
          />
        </>
      ) : (
        <Alert
          type="info"
          showIcon
          title="尚无所选版本资料报告"
          description="选择版本并明确点击检查；页面刷新不会自动读取资料。"
        />
      )}
    </section>
  )
}
