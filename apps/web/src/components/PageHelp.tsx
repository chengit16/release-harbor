/** @description 次级操作说明按需展开；错误、执行授权和不可逆操作提醒仍在原业务位置完整显示。 */
import type { ReactNode } from 'react'
import { Collapse } from 'antd'

/** 常规帮助默认折叠，不接收或隐藏业务错误。 */
export function PageHelp({
  title,
  children,
}: {
  /** 可读的说明入口。 */ title: string
  /** 原始操作范围与限制说明。 */ children: ReactNode
}) {
  return (
    <Collapse
      className="page-help"
      ghost
      size="small"
      items={[{ key: 'help', label: title, children }]}
    />
  )
}
