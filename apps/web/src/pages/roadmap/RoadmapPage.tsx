/** @description 六期产品路线的展示，工程交付与真实商店验收分开，不以规划代替远端事实。 */
import { Alert, Card, Steps, Tag } from 'antd'
import { PageHelp } from '../../components/PageHelp.tsx'

const phases = [
  ['本地发布闭环', '项目与应用、安装包检查、计划确认、首批商店上传。'],
  ['多渠道交付', '渠道配置、逐渠道产物分配、串行批次及剩余项重新准备与确认。'],
  ['审核与资料追踪', '真实状态查询、审核拒绝原因、资料检查与交付记录。'],
  ['送审与上线编排', '按渠道能力逐步接入资料更新、送审与上线动作。'],
  ['本机团队工作台', '本机账号、成员管理，以及按应用和渠道授权发布与审核。'],
  ['审批与自动化', '可信审批、独立任务调度、异常通知与运行保障。'],
]

const progress = [
  ['工程已交付', 'success'],
  ['工程已交付 · 体验验收通过', 'success'],
  ['工程完成 · 渠道远端验收待做', 'success'],
  ['工程完成 · 渠道远端验收待做', 'success'],
  ['实施中 · 成员授权与发布权限已接入', 'processing'],
  ['后续规划', 'default'],
] as const

/** 工程交付、用户反馈和逐项真实验收分别表述；第三、四期工程完成，实际商店结果继续逐渠道核对。 */
export function RoadmapPage() {
  return (
    <Card title="六期产品路线" extra={<Tag color="processing">第五期实施中</Tag>}>
      <Alert
        type="info"
        showIcon
        className="form-feedback"
        title="当前优先：本机团队工作台"
        description="在原工作台中按成员分配菜单、应用渠道，以及审核查询、发布准备和确认权限；下一步补齐操作审计。服务仍在本机运行。"
      />
      <PageHelp title="第三、四期交付范围与验收边界">
        <Alert
          type="info"
          showIcon
          className="form-feedback"
          title="第三期工程范围已完成；真实商店送审与审核结果仍按渠道验收。"
          description="审核状态直接查询绑定应用，不需要本地发布记录。已完成九渠道状态查询、OPPO 构建定位、Apple 与魅族指定版本资料检查、其余可读渠道的有限资料投影、拒绝原因安全分类、待办和查询变化记录。小米不提供公开审核进度；应用宝审核意见没有版本标识；Apple 审核员意见与完整合规不由公开 API 提供，均需在官方后台核对。"
        />
        <Alert
          type="info"
          showIcon
          className="form-feedback"
          title="第四期工程范围已完成"
          description="已完成渠道能力盘点、华为 Android 正式更新送审、版本防重、资料修改范围与语种摘要、异步阶段回执和上线策略核对。日常复用现有资料，完整图文及合规编辑在官方后台维护；本项目 iOS 仅提供自动／手动发布。逐渠道真实送审、定时生效与上架仍需实际版本验收。"
        />
      </PageHelp>
      <Steps
        current={4}
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
