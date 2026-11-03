/** @description 组合最新事实、分页历史与按需详情，选择记录只影响本地展示，不触发商店操作。 */
import { useState } from 'react'
import { Card, Empty } from 'antd'
import type { PreflightView } from '@release-harbor/contracts'
import { PreflightSummary } from './PreflightSummary.tsx'
import { PreflightHistory } from './PreflightHistory.tsx'
import { PreflightDetails } from './PreflightDetails.tsx'
import type { PreflightContext } from './preflightPresentation.ts'

/** 预检结果使用服务端完整事实，不以当前表单选择过滤历史。 */
interface PreflightResultsProps {
  /** 当前应用的全部历史及当前有效性。 */
  views: PreflightView[]
  /** 当前可读名称，不含任何凭据材料。 */
  context: PreflightContext
}

/** 最新以创建时间确定，较早通过不会掩盖新失败；详情始终关联当前数据中的相同 ID。 */
export function PreflightResults({ views, context }: PreflightResultsProps) {
  const [selectedId, setSelectedId] = useState<string>()
  const ordered = [...views].sort((a, b) => b.record.createdAt.localeCompare(a.record.createdAt))
  const latest = ordered[0]
  return (
    <div className="preflight-results">
      <section aria-label="最新预检">
        {latest ? (
          <PreflightSummary
            view={latest}
            context={context}
            onDetails={() => setSelectedId(latest.record.id)}
          />
        ) : (
          <Card title={<h2>最新预检</h2>}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="选择商店绑定与安装包，运行首次只读预检。"
            />
          </Card>
        )}
      </section>
      <PreflightHistory views={ordered} context={context} onDetails={setSelectedId} />
      <PreflightDetails
        view={ordered.find((view) => view.record.id === selectedId)}
        context={context}
        onClose={() => setSelectedId(undefined)}
      />
    </div>
  )
}
