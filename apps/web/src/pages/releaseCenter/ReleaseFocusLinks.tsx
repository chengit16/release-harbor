/** @description 发布中心首屏的三个待处理入口，数字按本机记录计算，不触发远端查询。 */
import { Button, Flex, Typography } from 'antd'
import type { ReleaseCenterItem } from '@release-harbor/contracts'
import { matchesReleaseFocus } from './releaseFocus.ts'

/** 小量快捷入口与完整列表共用筛选，零条仍可查看空态。 */
export function ReleaseFocusLinks({
  items,
  selected,
  unavailable,
  onSelect,
}: {
  /** 当前目录筛选后的公开摘要。 */ items: ReleaseCenterItem[]
  /** URL 保存的快捷范围。 */ selected: string
  /** 读取失败或加载中不展示过期数字。 */ unavailable: boolean
  /** 显式点击只更新 URL。 */ onSelect: (value: string) => void
}) {
  return (
    <Flex wrap gap={12} aria-label="发布待处理入口" className="release-focus-links">
      {[
        { key: 'processing', label: '处理中', hint: '查看执行进度' },
        { key: 'confirmation', label: '待确认', hint: '核对摘要后继续' },
        { key: 'reconciliation', label: '结果待核对', hint: '先核对，避免重复提交' },
      ].map(({ key, label, hint }) => (
        <Button
          key={key}
          className="release-focus-link"
          type={selected === key ? 'primary' : 'default'}
          aria-pressed={selected === key}
          onClick={() => onSelect(selected === key ? '' : key)}
        >
          <span>
            {label}{' '}
            <strong>
              {unavailable ? '—' : items.filter((item) => matchesReleaseFocus(item, key)).length}
            </strong>
          </span>
          <Typography.Text type={selected === key ? undefined : 'secondary'}>
            {hint}
          </Typography.Text>
        </Button>
      ))}
      {selected && (
        <Button type="link" onClick={() => onSelect('')}>
          查看全部记录
        </Button>
      )}
    </Flex>
  )
}
