/** @description OPPO 官方审核字典投影；资质、运营与整包通过分别表达，不借用应用在架或异步任务状态。 */
import type { StoreVersionStatus } from '@release-harbor/contracts'
import { storeScalar } from './store-client.ts'

const states: Record<string, { label: string; state: StoreVersionStatus['state'] }> = {
  '0': { label: '未发布', state: 'unpublished' },
  '1': { label: '审核中', state: 'in_review' },
  '2': { label: '审核通过', state: 'approved' },
  '3': { label: '测试不通过', state: 'rejected' },
  '4': { label: '运营审核中', state: 'in_review' },
  '5': { label: '运营打回', state: 'rejected' },
  '6': { label: '运营通过', state: 'operations_approved' },
  '7': { label: '定时发布', state: 'pending_release' },
  '00': { label: '资质审核中', state: 'qualification_review' },
  '11': { label: '资质审核通过', state: 'qualification_approved' },
  '-11': { label: '资质审核不通过', state: 'qualification_rejected' },
  '-22': { label: '报备提交成功', state: 'filing_submitted' },
  '22': { label: '已冻结', state: 'frozen' },
  '111': { label: '上线', state: 'published' },
  '222': { label: '下线', state: 'removed' },
  '444': { label: '审核不通过', state: 'rejected' },
  x: { label: '其他', state: 'unknown' },
}

/** 官方 doc11176 配合普通包详情 doc11004；字符串码“00”与“0”必须保留区别。 */
export function oppoReviewState(
  app: Record<string, unknown>,
): Pick<StoreVersionStatus, 'state' | 'rawState'> {
  const code = storeScalar(app.audit_status)
  const description = storeScalar(app.audit_status_name)
  const byCode = Object.hasOwn(states, code) ? states[code] : undefined
  const byDescription = Object.values(states).find((item) => item.label === description)
  const hasCode =
    app.audit_status !== undefined && app.audit_status !== null && app.audit_status !== ''
  // 未知码不能被成功文案覆盖；无码的官方旧样例仍可按已核实描述识别。
  const state =
    (hasCode && !byCode) ||
    (description && !byDescription) ||
    (byCode && byDescription && byCode.state !== byDescription.state)
      ? 'unknown'
      : (byDescription?.state ?? byCode?.state ?? 'unknown')
  const rawState = /^(0|[1-9]\d{0,3})$/.test(code) && Number(code) <= 1000 ? Number(code) : null
  return { state, rawState }
}
