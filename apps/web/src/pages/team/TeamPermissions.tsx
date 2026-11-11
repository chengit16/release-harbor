/** @description 管理员按菜单、应用绑定与真实动作分配成员权限；关闭即丢弃草稿，不修改商店配置。 */
import { Alert, Button, Card, Checkbox, Empty, Flex, Modal, Spin, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import {
  channelLabels,
  teamMenus,
  teamOperations,
  teamReleaseActions,
  type LocalTeamMember,
  type LocalTeamPermissions,
  type TeamGrantOption,
  type TeamBindingGrant,
  type TeamMenu,
  type TeamOperation,
  type TeamReleaseAction,
} from '@release-harbor/contracts'
import { setTeamPermissions, teamGrantOptions } from './teamApi.ts'

/** 授权完成后刷新成员目录，避免用旧 revision 覆盖新授权。 */
interface Props {
  /** 只允许普通成员作为目标。 */ member: LocalTeamMember
  /** 关闭并销毁当前未提交草稿。 */ onClose: () => void
  /** 保存成功后重新读取成员。 */ onSaved: () => void
}
/** 空权限、过期绑定和并发冲突均明确呈现；不提供一键扩大所有权限。
 * 长函数保留原因：菜单、绑定和真实动作共用一份未保存授权草稿，声明式选项集中用于完整核对。 */
export function TeamPermissions({ member, onClose, onSaved }: Props) {
  const [value, setValue] = useState<LocalTeamPermissions>(
    member.permissions ?? { revision: 0, menus: [], grants: [] },
  )
  const [options, setOptions] = useState<TeamGrantOption[]>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void teamGrantOptions(controller.signal).then(
      (v) => {
        if (!controller.signal.aborted) setOptions(v)
      },
      (e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '授权候选读取失败')
      },
    )
    return () => controller.abort()
  }, [])
  function change(option: TeamGrantOption, patch: Partial<TeamBindingGrant>) {
    setValue((current) => {
      const saved = current.grants.find((g) => g.bindingId === option.bindingId)
      // 改绑后只保留本次明确勾选，不能把旧账号下的其他动作顺带授给新目标。
      const old = saved?.fingerprint === option.fingerprint ? saved : undefined
      const grant: TeamBindingGrant = {
        projectId: option.projectId,
        applicationId: option.applicationId,
        bindingId: option.bindingId,
        fingerprint: option.fingerprint,
        operations: old?.operations ?? [],
        releaseActions: old?.releaseActions ?? [],
        ...patch,
      }
      return {
        ...current,
        grants: [...current.grants.filter((g) => g.bindingId !== option.bindingId), grant],
      }
    })
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
  const stale = value.grants.filter(
    (g) => !options?.some((o) => o.bindingId === g.bindingId && o.fingerprint === g.fingerprint),
  )
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
          菜单决定入口，渠道决定可见范围，操作分别授权。成员使用已配置的账号；查看缓存不会查询官方，准备发布不等于确认执行。
        </Typography.Paragraph>
        {error && <Alert type="error" showIcon title={error} />}
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
        {options && stale.length > 0 && (
          <Alert
            type="warning"
            showIcon
            title={`${stale.length} 项授权的渠道配置已变化或已移除`}
            description="旧授权不会生效。可移除失效项，或在下方重新选择操作以授权当前配置。"
            action={
              <Button
                disabled={busy}
                onClick={() =>
                  setValue((v) => ({ ...v, grants: v.grants.filter((g) => !stale.includes(g)) }))
                }
              >
                移除失效项
              </Button>
            }
          />
        )}
        {!options ? (
          <Spin />
        ) : !options.length ? (
          <Empty description="请先在应用管理配置渠道" />
        ) : (
          options.map((option) => {
            const grant = value.grants.find((g) => g.bindingId === option.bindingId)
            const current = grant?.fingerprint === option.fingerprint
            const entries = Object.entries(teamReleaseActions).filter(([action]) =>
              option.channel === 'app_store'
                ? action.startsWith('apple_')
                : action.startsWith(option.channel + '_'),
            )
            return (
              <Card key={option.bindingId} size="small" styles={{ body: { padding: 12 } }}>
                <Flex
                  wrap
                  gap={8}
                  justify="space-between"
                  align="center"
                  style={{ marginBottom: 16 }}
                >
                  <Flex vertical gap={4} style={{ minWidth: 0, flex: 1 }}>
                    <Typography.Text strong style={{ overflowWrap: 'anywhere' }}>
                      {option.label}
                    </Typography.Text>
                    <span>
                      <Tag>{channelLabels[option.channel]}</Tag>
                    </span>
                  </Flex>
                  {grant && (
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() =>
                        setValue((v) => ({
                          ...v,
                          grants: v.grants.filter((g) => g.bindingId !== option.bindingId),
                        }))
                      }
                    >
                      清除此渠道
                    </Button>
                  )}
                </Flex>
                <Flex vertical gap={12}>
                  <Checkbox.Group
                    disabled={busy}
                    value={current ? grant.operations : []}
                    options={Object.entries(teamOperations).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                    onChange={(operations) =>
                      change(option, {
                        operations: operations.filter((o): o is TeamOperation =>
                          Object.hasOwn(teamOperations, o),
                        ),
                      })
                    }
                  />
                  <Typography.Text type="secondary">
                    允许的发布动作（同时需要准备或确认权限）
                  </Typography.Text>
                  <Checkbox.Group
                    disabled={busy}
                    value={current ? grant.releaseActions : []}
                    options={entries.map(([value, label]) => ({ value, label }))}
                    onChange={(releaseActions) =>
                      change(option, {
                        releaseActions: releaseActions.filter((a): a is TeamReleaseAction =>
                          Object.hasOwn(teamReleaseActions, a),
                        ),
                      })
                    }
                  />
                </Flex>
              </Card>
            )
          })
        )}
      </Flex>
    </Modal>
  )
}
