/** @description 上架意图的用例校验，守卫只针对当前动作，不回填或改写历史记录。 */
import {
  isReleasePolicy,
  isReleasePolicyCurrent,
  type ReleasePolicy,
} from '@release-harbor/contracts'
import { DomainError } from './errors.ts'

/** 显式提供策略时严格检查；历史缺失保留缺失，不默认为已向商店设置立即上架。 */
export function validateReleasePolicy(value: unknown, now = Date.now()): ReleasePolicy {
  if (!isReleasePolicy(value)) throw new DomainError('请选择当前平台支持的发布方式或有效上架时间')
  if (!isReleasePolicyCurrent(value, now))
    throw new DomainError('指定上架时间已到或已过期，请重新选择未来时间')
  return structuredClone(value)
}
