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
  ['工程已交付 · 体验验收通过', 'success'],
  ['进行中 · 荣耀状态查询', 'processing'],
  ['后续规划', 'default'],
  ['后续规划', 'default'],
  ['后续规划', 'default'],
] as const

/** 工程交付、用户反馈和逐项真实验收分别表述；第二期发布中心体验已获用户验收，按最新授权推进第三期荣耀首片。 */
export function RoadmapPage() {
  return (
    <Card title="六期产品路线" extra={<Tag color="processing">第三期进行中</Tag>}>
      <Alert
        type="info"
        showIcon
        className="form-feedback"
        title="当前重点：审核与资料追踪，首片接入荣耀版本状态查询。"
        description="已接入 Android 各渠道、iOS 构建上传与审核／手动发布、应用宝与鸿蒙，以及同一 Android 应用的多商店串行批次。用户已确认发布中心体验验证完成。第三期先提供荣耀手动查询及带时间的观察记录，逐渠道扩展集中跟踪与资料待办；各渠道审核与上架事实以对应版本证据为准。"
      />
      <Steps
        current={2}
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
