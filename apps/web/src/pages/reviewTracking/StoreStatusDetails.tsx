/** @description 商店查询详情；明确区分未查询、失败、官方空目录和未知状态，不借用本地发布结论。 */
import { Alert, Button, Collapse, Descriptions, Drawer, Flex, Input, Tag, Typography } from 'antd'
import { useState } from 'react'
import {
  channelLabels,
  type StoreStatusSnapshot,
  type StoreStatusTarget,
  type StoreManualRecord,
  type StoreVersionQuery,
} from '@release-harbor/contracts'
import { useTeamAccess } from '../team/teamAccess.tsx'
import { FollowPanel } from '../localSettings/FollowPanel.tsx'
import { StoreVersionResults } from './StoreVersionResults.tsx'
import { StoreMaterialChecks } from './StoreMaterialChecks.tsx'
import { StoreManualNotes } from './StoreManualNotes.tsx'
import { StoreQueryHistory } from './StoreQueryHistory.tsx'

/** 详情按官方版本 ID 展示；缺失版本名与构建号均明确标记。 */
export function StoreStatusDetails({
  target,
  snapshots,
  trackedSnapshots,
  manualRecords,
  queryHistory,
  materialSnapshots,
  querying,
  operationError,
  onClose,
  onQuery,
  onInspect,
  onManualSaved,
}: {
  /** 当前 URL 选中的绑定；省略时关闭详情。 */
  target: StoreStatusTarget | undefined
  /** 最近查询及可选的上次成功结果，各自保留查询时间。 */
  snapshots: StoreStatusSnapshot[]
  /** OPPO 按构建号定位形成的独立历史结果。 */
  trackedSnapshots: StoreStatusSnapshot[]
  /** 小米人工核对历史，来源与官方查询结果分开显示。 */
  manualRecords: StoreManualRecord[]
  /** 当前绑定指纹下最近完成的官方查询留存，不与人工来源混合。 */
  queryHistory: StoreStatusSnapshot[]
  /** 指定 Apple 版本的独立资料报告，失败和旧成功分开。 */
  materialSnapshots: StoreStatusSnapshot[]
  /** 当前正在查询的绑定 ID，用于阻止重复操作。 */
  querying: string
  /** 最近一次页面操作错误，在抽屉内也可见，避免被遮罩挡住。 */
  operationError: string
  /** 关闭详情并清理 URL 定位，不撤销服务端已开始的只读查询。 */
  onClose: () => void
  /** 用户点击按钮才访问商店，不产生发布授权。 */
  onQuery: (target: StoreStatusTarget, query?: StoreVersionQuery) => void
  /** 明确检查所选版本，仅从官方固定只读接口读取资料。 */
  onInspect: (target: StoreStatusTarget, versionId: string) => void
  /** 保存人工记录后只读刷新目录。 */
  onManualSaved: () => void
}) {
  const access = useTeamAccess()
  const canQuery =
    !!target && access.can(target.bindingId, 'review_query', undefined, target.applicationId)
  const [buildNumber, setBuildNumber] = useState('')
  const latest = snapshots.find((item) => item.bindingId === target?.bindingId)
  const tracked = trackedSnapshots.filter((item) => item.bindingId === target?.bindingId)
  const queryBuild = /^([1-9]\d{0,17})$/.test(buildNumber) ? buildNumber : ''
  return (
    <Drawer
      extra={<Button onClick={onClose}>关闭商店详情</Button>}
      title="商店状态详情"
      open={!!target}
      onClose={onClose}
      size="large"
      styles={{ wrapper: { maxWidth: '100vw' } }}
    >
      {target && (
        <>
          <Flex wrap gap={8} align="center">
            <Typography.Title level={2} style={{ margin: 0, fontSize: 20 }}>
              {target.applicationName}
            </Typography.Title>
            <Tag>{channelLabels[target.channel]}</Tag>
          </Flex>
          <Descriptions
            styles={{ content: { overflowWrap: 'anywhere' } }}
            column={1}
            className="form-feedback"
            items={[
              { key: 'project', label: '项目', children: target.projectName },
              { key: 'app', label: '商店目标', children: target.appId },
              { key: 'identifier', label: '包名 / Bundle ID', children: target.identifier },
              {
                key: 'checked',
                label: '最近查询',
                children: latest
                  ? `${new Date(latest.checkedAt).toLocaleString()}（非实时）`
                  : '尚未查询',
              },
            ]}
          />
          {target.queryNotice && (
            <Alert type="info" showIcon title="渠道查询范围" description={target.queryNotice} />
          )}
          {operationError && (
            <Alert
              role="alert"
              type="error"
              showIcon
              title="最近一次操作未完成"
              description={operationError}
            />
          )}
          {target.querySupported && (
            <Flex wrap gap={8} style={{ marginTop: 16 }}>
              <Button
                type="primary"
                disabled={!canQuery || (!!querying && querying !== target.bindingId)}
                loading={querying === target.bindingId}
                onClick={() => onQuery(target)}
              >
                查询商店状态
              </Button>
              {target.channel === 'oppo' && (
                <Flex wrap gap={8} align="center">
                  <Input
                    aria-label="OPPO 构建号"
                    value={buildNumber}
                    placeholder="输入构建号"
                    inputMode="numeric"
                    maxLength={18}
                    onChange={(event) => setBuildNumber(event.target.value.trim())}
                    style={{ width: 150 }}
                  />
                  <Button
                    disabled={
                      !canQuery || !queryBuild || (!!querying && querying !== target.bindingId)
                    }
                    loading={querying === target.bindingId && !!queryBuild}
                    onClick={() => onQuery(target, { kind: 'oppo_build', buildNumber: queryBuild })}
                  >
                    按构建号查询
                  </Button>
                </Flex>
              )}
            </Flex>
          )}
          {target.channel === 'oppo' && (
            <Typography.Paragraph type="secondary" className="form-feedback">
              构建号来自 APK 的 versionCode
              或商店后台。指定查询单独保存，不覆盖默认版本；连续查询需间隔十秒。
            </Typography.Paragraph>
          )}
          <StoreVersionResults
            channel={target.channel}
            snapshots={snapshots.filter((item) => item.bindingId === target.bindingId)}
            label="官方版本结果"
          />
          {[...new Set(tracked.map((item) => item.query?.buildNumber))].map((build) => (
            <StoreVersionResults
              key={build}
              channel={target.channel}
              snapshots={tracked.filter((item) => item.query?.buildNumber === build)}
              label={`指定构建 ${build}`}
            />
          ))}
          <Collapse
            className="form-feedback"
            items={[
              {
                key: 'materials',
                label: '检查商店资料（按需）',
                children: (
                  <StoreMaterialChecks
                    target={target}
                    snapshot={latest}
                    reports={materialSnapshots.filter(
                      (item) => item.bindingId === target.bindingId,
                    )}
                    appleVersions={
                      snapshots.find(
                        (item) => item.bindingId === target.bindingId && item.code === 'observed',
                      )?.versions ?? []
                    }
                    querying={!canQuery || !!querying}
                    onInspect={(versionId) => onInspect(target, versionId)}
                  />
                ),
              },
            ]}
          />
          {!access.restricted && (
            <Collapse
              className="form-feedback"
              items={[
                {
                  key: 'follow',
                  label: '设置审核自动跟踪',
                  children: <FollowPanel target={target} versions={latest?.versions ?? []} />,
                },
              ]}
            />
          )}
          <StoreQueryHistory
            history={queryHistory.filter((item) => item.bindingId === target.bindingId)}
          />
          {target.channel === 'xiaomi' &&
            access.can(target.bindingId, 'release_reconcile', undefined, target.applicationId) && (
              <StoreManualNotes
                target={target}
                records={manualRecords.filter((record) => record.bindingId === target.bindingId)}
                onSaved={onManualSaved}
              />
            )}
        </>
      )}
    </Drawer>
  )
}
