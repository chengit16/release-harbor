/** @description Apple 审核进程的私有工作协议；路径仅由宿主装配，所有公开结果经过合同校验。 */
import {
  isRecord,
  isChannelBinding,
  isAppleResourceId,
  isAppleReviewSnapshot,
  isAppleReviewCatalog,
  appleReviewMessages,
  type ChannelBinding,
  type AppleReviewSnapshot,
  type AppleReviewCatalog,
  type AppleReviewCode,
} from '@release-harbor/contracts'

/** 可信父进程恢复目标后才可派发；网页不能指定目录或方法路径。 */
export type AppleReviewJob =
  | { kind: 'catalog'; binding: ChannelBinding; identifier: string }
  | {
      kind: 'prepare'
      binding: ChannelBinding
      identifier: string
      buildId: string
      versionId: string
      action: 'submit' | 'release'
      mode: 'manual' | 'after_approval'
      notes: string
    }
  | { kind: 'execute'; snapshot: AppleReviewSnapshot }
/** 只允许安全目录、快照或固定结果，失败不携带原始异常。 */
export type AppleReviewReply =
  | {
      ok: true
      value: AppleReviewCatalog | AppleReviewSnapshot | 'submitted' | 'release_requested'
    }
  | { ok: false; code: AppleReviewCode }
/** 测试注入只影响独立 runner 端口，生产没有环境变量替身。 */
export interface AppleReviewRunner {
  run(job: AppleReviewJob, permit?: () => Promise<void>): Promise<AppleReviewReply>
  close(): void
}
/** 私有任务仍须运行时验证，拒绝额外载荷或不安全资源 ID。 */
export function isAppleReviewJob(v: unknown): v is AppleReviewJob {
  if (!isRecord(v)) return false
  if (v.kind === 'execute') return Object.keys(v).length === 2 && isAppleReviewSnapshot(v.snapshot)
  if (
    !isChannelBinding(v.binding) ||
    v.binding.channel !== 'app_store' ||
    typeof v.identifier !== 'string' ||
    !v.identifier ||
    v.identifier.length > 255 ||
    /[\x00-\x1f]/.test(v.identifier)
  )
    return false
  if (v.kind === 'catalog') return Object.keys(v).length === 3
  return (
    v.kind === 'prepare' &&
    Object.keys(v).length === 8 &&
    isAppleResourceId(v.buildId) &&
    isAppleResourceId(v.versionId) &&
    (v.action === 'submit' || v.action === 'release') &&
    (v.mode === 'manual' || v.mode === 'after_approval') &&
    typeof v.notes === 'string' &&
    v.notes.length <= 4000 &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v.notes) &&
    (v.action === 'release' || v.notes.trim().length > 0)
  )
}
/** 不信任子进程返回类型，成功分支也拒绝裸供应商对象。 */
export function isAppleReviewReply(v: unknown): v is AppleReviewReply {
  return (
    isRecord(v) &&
    Object.keys(v).length === 2 &&
    (v.ok === false
      ? typeof v.code === 'string' && Object.hasOwn(appleReviewMessages, v.code)
      : v.ok === true &&
        (v.value === 'submitted' ||
          v.value === 'release_requested' ||
          isAppleReviewSnapshot(v.value) ||
          isAppleReviewCatalog(v.value)))
  )
}
