/** @description 管理员按应用配置成员权限；保存明确覆盖当前及后续渠道，旧渠道授权不自动扩大。 */
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Flex,
  Input,
  Modal,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import {
  teamMenus,
  teamOperations,
  type LocalTeamMember,
  type LocalTeamPermissions,
  type TeamGrantOption,
  type TeamApplicationGrant,
  type TeamMenu,
  type TeamOperation,
} from '@release-harbor/contracts'
import { setTeamPermissions, teamGrantOptions } from './teamApi.ts'

/** 授权草稿只保存在本窗口，提交成功后重新读取目录。 */
interface Props {
  /** 普通成员目标。 */ member: LocalTeamMember
  /** 关闭并丢弃草稿。 */ onClose: () => void
  /** 成功后刷新成员摘要。 */ onSaved: () => void
}
/** 每个应用只展示一组操作；旧权限必须由管理员显式重新选择，不猜测跨渠道合并。
 * 长函数保留原因：窗口的菜单和应用选择共用一次乐观版本提交，应用卡已独立，避免分散保存扩大授权。 */
export function TeamPermissions({ member, onClose, onSaved }: Props) {
  // 1. 读取可信应用候选，权限草稿保留至明确保存或关闭。
  const [value, setValue] = useState<LocalTeamPermissions>(
    member.permissions ?? { revision: 0, menus: [], grants: [], applications: [] },
  )
  const [options, setOptions] = useState<TeamGrantOption[]>()
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void teamGrantOptions(controller.signal).then(
      (v) => {
        if (!controller.signal.aborted) setOptions(v)
      },
      (e: unknown) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '应用读取失败')
      },
    )
    return () => controller.abort()
  }, [])
  // 2. 仅显式编辑的应用转为新授权，保存冲突保留草稿。
  function change(option: TeamGrantOption, operations: TeamOperation[]) {
    setValue((current) => ({
      ...current,
      // 仅替换本次应用，其他旧渠道授权保持原事实，避免只修改菜单也发生权限扩大。
      grants: current.grants.filter((g) => g.applicationId !== option.applicationId),
      applications: [
        ...(current.applications ?? []).filter((g) => g.applicationId !== option.applicationId),
        { projectId: option.projectId, applicationId: option.applicationId, operations },
      ],
    }))
  }
  async function save() {
    setBusy(true)
    setError('')
    try {
      await setTeamPermissions(member.id, value)
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存权限失败')
    } finally {
      setBusy(false)
    }
  }
  // 3. 搜索只改变展示；删除失效项和授权保存均需管理员明确操作。
  const filtered = options?.filter((o) =>
    `${o.label} ${o.platform}`.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const missing = options
    ? [...(value.applications ?? []), ...value.grants].filter(
        (g) => !options.some((o) => o.applicationId === g.applicationId),
      )
    : []
  return (
    <Modal
      title={`成员授权 · ${member.username}`}
      open
      width={860}
      onCancel={onClose}
      onOk={() => void save()}
      okText="保存权限"
      confirmLoading={busy}
      okButtonProps={{ disabled: !options }}
      closable={!busy}
      mask={{ closable: !busy }}
      keyboard={!busy}
    >
      <Flex vertical gap={16}>
        <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
          按应用分配操作权限，覆盖该应用当前及后续新增的全部渠道。成员使用管理员配置的商店账号；准备与确认执行分别授权。
        </Typography.Paragraph>
        {error && <Alert type="error" showIcon title={error} />}
        {missing.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title="部分授权应用已移除"
            description="原权限不会转移给其他应用，移除失效项后可继续保存。"
            action={
              <Button
                disabled={busy}
                onClick={() =>
                  setValue((v) => ({
                    ...v,
                    applications: v.applications?.filter((g) => !missing.includes(g)),
                    grants: v.grants.filter((g) => !missing.includes(g)),
                  }))
                }
              >
                移除失效授权
              </Button>
            }
          />
        )}
        <Card size="small" title="可见菜单">
          <Checkbox.Group
            disabled={busy}
            value={value.menus}
            options={Object.entries(teamMenus).map(([value, label]) => ({ value, label }))}
            onChange={(menus) =>
              setValue((v) => ({
                ...v,
                menus: menus.filter((m): m is TeamMenu => Object.hasOwn(teamMenus, m)),
              }))
            }
          />
        </Card>
        <Flex justify="space-between" align="center" wrap gap={8}>
          <Typography.Text strong>
            应用权限 · {value.applications?.length ?? 0} 个已授权应用
          </Typography.Text>
          <Input.Search
            aria-label="搜索授权应用"
            placeholder="搜索应用或项目"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: 240, maxWidth: '100%' }}
            allowClear
          />
        </Flex>
        {!options ? (
          <Spin />
        ) : !filtered?.length ? (
          <Empty description={options.length ? '没有匹配的应用' : '请先在应用管理创建应用'} />
        ) : (
          filtered.map((option) => {
            const grant = value.applications?.find((g) => g.applicationId === option.applicationId)
            const legacy = value.grants.filter((g) => g.applicationId === option.applicationId)
            return (
              <ApplicationPermissions
                key={option.applicationId}
                option={option}
                grant={grant}
                legacy={legacy.length}
                busy={busy}
                onChange={(operations) => change(option, operations)}
                onClear={() =>
                  setValue((v) => ({
                    ...v,
                    applications: v.applications?.filter(
                      (g) => g.applicationId !== option.applicationId,
                    ),
                    grants: v.grants.filter((g) => g.applicationId !== option.applicationId),
                  }))
                }
              />
            )
          })
        )}
      </Flex>
    </Modal>
  )
}

/** 应用身份与一组权限共用卡片；渠道只说明覆盖数量，不再逐渠道配置。 */
function ApplicationPermissions({
  option,
  grant,
  legacy,
  busy,
  onChange,
  onClear,
}: {
  option: TeamGrantOption
  grant?: TeamApplicationGrant
  legacy: number
  busy: boolean
  onChange: (operations: TeamOperation[]) => void
  onClear: () => void
}) {
  return (
    <Card size="small" className="team-application-permissions">
      <Flex justify="space-between" wrap gap={12} align="center" style={{ marginBottom: 16 }}>
        <Flex vertical gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>
            {option.label}
          </Typography.Text>
          <Flex wrap gap={4}>
            <Tag>{option.platform}</Tag>
            <Typography.Text type="secondary">
              全部渠道
              {option.channels.length ? ` · 当前 ${option.channels.length} 个` : ' · 尚未配置'}
            </Typography.Text>
          </Flex>
        </Flex>
        {(grant || legacy > 0) && (
          <Button size="small" disabled={busy} onClick={onClear}>
            移除应用授权
          </Button>
        )}
      </Flex>
      {legacy > 0 && (
        <Alert
          className="form-feedback"
          type="warning"
          showIcon
          title="旧渠道授权仍按原范围生效"
          description="重新勾选本应用操作后，将替换为覆盖全部渠道的应用授权；只修改菜单不会自动扩大权限。"
        />
      )}
      <Checkbox.Group
        disabled={busy}
        value={grant?.operations ?? []}
        options={Object.entries(teamOperations).map(([value, label]) => ({ value, label }))}
        onChange={(operations) =>
          onChange(operations.filter((o): o is TeamOperation => Object.hasOwn(teamOperations, o)))
        }
      />
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 12 }}>
        勾选准备或确认后，允许本应用各渠道对应的发布动作；执行时仍须核对摘要并明确确认。
      </Typography.Paragraph>
    </Card>
  )
}
