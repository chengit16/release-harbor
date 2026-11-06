/** @description 全局导航文案、分组和矢量图标；发布与配置分开，稳定 URL 标识兼容既有链接。 */
import { Badge, Menu, type MenuProps } from 'antd'

/** 菜单、面包屑和页面标题共用同一组名称，避免入口与内容命名不一致。 */
export const workbenchPages = {
  releases: {
    title: '发布中心',
    section: '发布',
    eyebrow: 'RELEASES',
    description: '集中发起应用发布，查看单渠道计划、多渠道批次与真实执行回执。',
  },
  reviews: {
    title: '审核状态',
    section: '发布',
    eyebrow: 'REVIEWS',
    description: '按应用与渠道查询商店官方版本和审核状态，无需先在本工具发布。',
  },
  projects: {
    title: '应用管理',
    section: '配置',
    eyebrow: 'APPLICATIONS',
    description: '按项目管理应用身份、商店绑定和安装包，为每次发布准备好配置。',
  },
  accounts: {
    title: '商店账号',
    section: '配置',
    eyebrow: 'ACCOUNTS',
    description: '配置一次，在应用中选择复用。凭据保存在本机，身份与发布事实分别核对。',
  },
  issues: {
    title: '问题档案',
    section: '了解与支持',
    eyebrow: 'ISSUES',
    description: '查询遇到的问题、已确认的原因、处理方法和实际验证记录。',
  },
  channels: {
    title: '商店指南',
    section: '了解与支持',
    eyebrow: 'GUIDES',
    description: '查看各商店支持的平台、发布动作与当前接入和验收范围。',
  },
  roadmap: {
    title: '产品路线图',
    section: '了解与支持',
    eyebrow: 'ROADMAP',
    description: '了解产品的阶段目标、当前进度与后续建设方向。',
  },
} as const

/** 稳定的页面 URL 标识，显示名称变化不破坏历史定位。 */
export type WorkbenchView = keyof typeof workbenchPages

const iconPaths: Record<WorkbenchView, string> = {
  releases: 'M4 15l6-6m-6 0v6h6M14 3h7v7M10 14l11-11M4 20h16',
  reviews: 'M4 3h16v18H4zM8 8l2 2 5-5M8 14h8M8 18h5',
  projects: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  accounts: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-2a8 8 0 0 1 16 0v2',
  issues: 'M4 3h16v18H4zM8 8h8M8 12h8M8 16h5',
  channels: 'M3 4h7l2 2 2-2h7v16h-7l-2 2-2-2H3zM12 6v16',
  roadmap: 'M5 3v18M5 5h12l-3 4 3 4H5M12 17h8M16 14l4 3-4 3',
}

/** 只负责菜单切换，不能携带业务授权或自动发起操作。 */
interface Props {
  /** 当前受限页面。 */
  view: WorkbenchView
  /** 窄屏使用可横向滚动的扁平导航，桌面保留业务分组。 */
  compact: boolean
  /** 项目数量仅作为配置入口提示。 */
  projectCount: number
  /** 明确点击菜单后更新 URL。 */
  onSelect: (view: WorkbenchView) => void
}

/** 桌面按发布、配置和支持分组，窄屏保留所有入口及当前选中态。 */
export function WorkbenchNavigation({ view, compact, projectCount, onSelect }: Props) {
  function item(key: WorkbenchView) {
    return {
      key,
      icon: compact ? undefined : (
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={iconPaths[key]} />
        </svg>
      ),
      label: (
        <span className="menu-label">
          {workbenchPages[key].title}
          {key === 'projects' && !compact && (
            <Badge count={projectCount} showZero color="var(--muted)" />
          )}
        </span>
      ),
    }
  }
  const items: MenuProps['items'] = compact
    ? (Object.keys(workbenchPages) as WorkbenchView[]).map(item)
    : [
        { type: 'group', label: '发布', children: [item('releases'), item('reviews')] },
        { type: 'group', label: '配置', children: [item('projects'), item('accounts')] },
        {
          type: 'group',
          label: '了解与支持',
          children: [item('issues'), item('channels'), item('roadmap')],
        },
      ]
  return (
    <nav aria-label="工作台导航" className="workspace-navigation">
      <Menu
        mode={compact ? 'horizontal' : 'inline'}
        theme="light"
        disabledOverflow
        selectedKeys={[view]}
        style={{ background: 'transparent', border: 0, minWidth: 0, width: '100%' }}
        items={items}
        onClick={({ key }) => {
          if (Object.hasOwn(workbenchPages, key)) onSelect(key as WorkbenchView)
        }}
      />
    </nav>
  )
}
