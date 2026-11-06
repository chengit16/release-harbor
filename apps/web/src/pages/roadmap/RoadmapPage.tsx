/** @description 六期产品路线的展示，当前进行阶段与后续规划分开，不能替代真实验收进度。 */
import { Alert, Card, Steps, Tag } from 'antd'

const phases = [
  ['本地发布闭环', '项目与应用、安装包检查、计划确认、首批商店上传。'],
  ['多渠道交付', '渠道配置、逐渠道产物分配、串行批次及剩余项重新准备与确认。'],
  ['审核与资料追踪', '真实状态查询、审核拒绝原因、资料检查与交付记录。'],
  ['送审与上线编排', '按渠道能力逐步接入资料更新、送审与上线动作。'],
  ['在线控制台', '组织与成员、身份隔离、对象存储、受信任执行器连接。'],
  ['团队与自动化', '可信审批、独立任务调度、异常通知与运行保障。'],
]

const progress = [
  ['工程已交付', 'success'],
  ['工程已交付 · 体验收尾', 'processing'],
  ['暂缓启动', 'default'],
  ['后续规划', 'default'],
  ['后续规划', 'default'],
  ['后续规划', 'default'],
] as const

/** 工程交付、用户反馈和逐项真实验收分别表述；当前停留第二期收尾，不自动启动第三期。 */
export function RoadmapPage() {
  return (
    <Card title="六期产品路线" extra={<Tag color="processing">第二期体验收尾</Tag>}>
      <Alert
        type="info"
        showIcon
        className="form-feedback"
        title="当前重点：发布中心完善与体验收尾，第三期暂缓启动。"
        description="已接入 Android 各渠道、iOS 构建上传与审核／手动发布、应用宝与鸿蒙，以及同一 Android 应用的多商店串行批次。用户已反馈既有 Android 渠道和 iOS 可用；新增能力及真实批次按具体目标分别验收，工程通过不替代商店审核或上架结果。"
      />
      <Steps
        current={1}
        orientation="vertical"
        items={phases.map(([title, description], index) => ({
          title: <h2 className="roadmap-step-title">{title}</h2>,
          content: (
            <div>
              <p>{description}</p>
              <Tag color={progress[index]?.[1]}>{progress[index]?.[0]}</Tag>
            </div>
          ),
        }))}
      />
    </Card>
  )
}
