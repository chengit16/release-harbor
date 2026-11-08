/** @description 帮助内容收敛为一个菜单，旧 URL 继续恢复对应内容，不发起商店操作。 */
import type { ReactNode } from 'react'
import { Tabs, Typography } from 'antd'
import { updateUrlState, useUrlState } from '../../app/useUrlState.ts'

/** 使用原页面的懒加载边界，仅在选中后展示帮助内容。 */
export function HelpPage({
  view,
  render,
}: {
  /** 兼容旧问题、指南及路线图 URL。 */ view: string
  /** 由壳层提供现有帮助页面。 */ render: (key: string) => ReactNode
}) {
  const params = useUrlState()
  const requested = view === 'help' ? params.get('helpTab') : view
  const active = requested === 'issues' || requested === 'roadmap' ? requested : 'channels'
  return (
    <Tabs
      activeKey={active}
      destroyOnHidden
      onChange={(key) => updateUrlState({ view: 'help', helpTab: key })}
      items={[
        { key: 'channels', label: '商店指南' },
        { key: 'issues', label: '问题档案' },
        { key: 'roadmap', label: '产品路线图' },
      ].map((item) => ({
        ...item,
        children: (
          <>
            {view === 'help' && <Typography.Title level={2}>{item.label}</Typography.Title>}
            {render(item.key)}
          </>
        ),
      }))}
    />
  )
}
