/** @description 六期产品路线的展示，当前进行阶段与后续规划分开，不能替代真实验收进度。 */
import { Alert, Card, Steps, Tag } from 'antd'

const phases = [
  ['本地发布闭环', '项目与应用、安装包检查、计划确认、首批商店上传。'],
  ['多渠道交付', '渠道配置、逐渠道产物分配、批次调度与独立重跑。'],
  ['审核与资料追踪', '真实状态查询、审核拒绝原因、资料检查与交付记录。'],
  ['送审与上线编排', '按渠道能力逐步接入资料更新、送审与上线动作。'],
  ['在线控制台', '组织与成员、身份隔离、对象存储、受信任执行器连接。'],
  ['团队与自动化', '可信审批、独立任务调度、异常通知与运行保障。'],
]

/** 当前仅将第一期标为进行中，不把已有工程基础标为整期完成。 */
export function RoadmapPage() {
  return (
    <Card title="六期产品路线" extra={<Tag color="processing">第一期进行中</Tag>}>
      <Alert
        type="info"
        showIcon
        className="form-feedback"
        title="已开放应用、商店配置、产物检查、只读预检及计划冻结与人工确认；真实账号待验收，发布执行与回执待接入。"
      />
      <Steps
        current={0}
        orientation="vertical"
        items={phases.map(([title, description], index) => ({
          title: <h2 className="roadmap-step-title">{title}</h2>,
          content: (
            <div>
              <p>{description}</p>
              <Tag color={index === 0 ? 'processing' : 'default'}>
                {index === 0 ? '第一期进行中' : '规划中'}
              </Tag>
            </div>
          ),
        }))}
      />
    </Card>
  )
}
