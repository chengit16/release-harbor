/** @description 商店查询详情；明确区分未查询、失败、官方空目录和未知状态，不借用本地发布结论。 */
import { Alert, Button, Descriptions, Drawer, Flex, List, Tag, Typography } from 'antd'
import {
  channelLabels,
  storeVersionStates,
  type StoreStatusSnapshot,
  type StoreStatusTarget,
} from '@release-harbor/contracts'

/** 固定错误文案不展示商店原始正文或凭据。 */
export const queryFailureLabels = {
  authentication: '账号验证失败，请在商店账号中核对材料及官方查询权限。',
  network: '商店查询未完成，请检查网络后再查询，或到商店后台核对。',
  invalid_response: '商店响应的身份或字段无法安全核对，请到商店后台核对。',
  unsupported: '当前查询能力尚未接入，请到商店后台核对。',
  observed: '',
}

/** 详情按官方版本 ID 展示；缺失版本名与构建号均明确标记。 */
export function StoreStatusDetails({
  target,
  snapshots,
  querying,
  onClose,
  onQuery,
}: {
  /** 当前 URL 选中的绑定；省略时关闭详情。 */
  target: StoreStatusTarget | undefined
  /** 最近查询及可选的上次成功结果，各自保留查询时间。 */
  snapshots: StoreStatusSnapshot[]
  /** 当前正在查询的绑定 ID，用于阻止重复操作。 */
  querying: string
  /** 关闭详情并清理 URL 定位，不撤销服务端已开始的只读查询。 */
  onClose: () => void
  /** 用户点击按钮才访问商店，不产生发布授权。 */
  onQuery: (target: StoreStatusTarget) => void
}) {
  const latest = snapshots.find((item) => item.bindingId === target?.bindingId)
  const success = snapshots.find(
    (item) => item.bindingId === target?.bindingId && item.code === 'observed',
  )
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
            <Typography.Title level={4} style={{ margin: 0 }}>
              {target.applicationName}
            </Typography.Title>
            <Tag>{channelLabels[target.channel]}</Tag>
          </Flex>
          <Descriptions
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
          {!latest && target.querySupported && (
            <Alert
              type="info"
              showIcon
              title="尚未查询商店状态"
              description="点击查询即可读取官方版本，不需要本地发布记录。"
            />
          )}
          {latest && latest.code !== 'observed' && (
            <Alert
              type="warning"
              showIcon
              title="本次查询失败"
              description={queryFailureLabels[latest.code]}
            />
          )}
          {success && (
            <>
              <Typography.Paragraph type="secondary" style={{ marginTop: 16 }}>
                以下为 {new Date(success.checkedAt).toLocaleString()} 的官方查询结果（非实时）
                {latest !== success ? '，本次失败前的历史结果，仅供参考' : ''}。
              </Typography.Paragraph>
              <List
                dataSource={success.versions}
                locale={{ emptyText: '官方接口本次未返回版本' }}
                renderItem={(version) => (
                  <List.Item>
                    <List.Item.Meta
                      title={version.versionName ?? '商店未提供版本名'}
                      description={
                        <>
                          {version.buildNumber
                            ? `构建号 ${version.buildNumber}`
                            : '商店未提供构建号'}
                          {version.versionId && ` · 版本 ID ${version.versionId}`}
                        </>
                      }
                    />
                    <Tag
                      color={
                        version.state === 'published'
                          ? 'success'
                          : version.state === 'rejected'
                            ? 'error'
                            : 'default'
                      }
                    >
                      {storeVersionStates[version.state]}
                    </Tag>
                  </List.Item>
                )}
              />
            </>
          )}
          {target.querySupported && (
            <Button
              type="primary"
              style={{ marginTop: 16 }}
              disabled={!!querying && querying !== target.bindingId}
              loading={querying === target.bindingId}
              onClick={() => onQuery(target)}
            >
              查询商店状态
            </Button>
          )}
        </>
      )}
    </Drawer>
  )
}
