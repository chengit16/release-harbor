/** @description 预检事实的页面呈现，公开名称仅从当前目录关联，不推导授权或重写历史快照。 */
import type { ArtifactRecord, CredentialAccount, PreflightView } from '@release-harbor/contracts'

/** 只使用公开账号与产物资料补全可读标签。 */
export interface PreflightContext {
  /** 当前账号目录，目录缺失时展示固定兜底并在详情保留原引用。 */
  accounts: CredentialAccount[]
  /** 当前应用的产物记录，不使用文件路径。 */
  artifacts: ArtifactRecord[]
}

/** 失效只解释当前有效性，不否定历史检查事实。 */
export const invalidationLabels = {
  expired: '超过五分钟有效期',
  binding_changed: '商店绑定已变化',
  artifact_changed: '产物记录或字节已变化',
  profile_changed: '凭据目录已变化',
  profile_unavailable: '凭据档案不可用',
}

/** 历史通过必须显示失效，最新失败不能被较早成功掩盖。 */
export function preflightStatus(view: PreflightView): { text: string; color: string } {
  if (view.current) return { text: '当前通过', color: 'success' }
  if (view.record.status === 'running') return { text: '核验中', color: 'processing' }
  if (view.record.status === 'passed') return { text: '历史通过 · 已失效', color: 'warning' }
  if (view.record.status === 'failed') return { text: '失败', color: 'error' }
  return { text: '无法验证', color: 'default' }
}

/** 只关联原始引用，名称变更不改变原始检查记录。 */
export function preflightAccount(view: PreflightView, context: PreflightContext): string {
  return (
    context.accounts.find((a) => a.reference === view.record.credentialReference)?.displayName ??
    '原账号待核对'
  )
}

/** 版本无法取得时明确缺失，不从文件名猜测版本。 */
export function preflightArtifact(view: PreflightView, context: PreflightContext) {
  const artifact = context.artifacts.find((a) => a.id === view.record.artifactId)
  return {
    fileName: artifact?.fileName ?? '原安装包记录不可用',
    version: artifact?.identity?.versionName ?? '版本未知',
  }
}

/** 浏览器本地时区显示检查时间，原始 UTC 事实在服务端保留。 */
export function preflightTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
