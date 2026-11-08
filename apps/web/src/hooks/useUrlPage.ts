/** @description 公开列表的 URL 分页；非法和过大页码只在展示时夹紧，不在读取期间改写历史。 */
import { updateUrlState, useUrlState } from '../app/useUrlState.ts'

/** 按当前结果数恢复页码；筛选变动由调用方清空自己的页码字段，不保存勾选或操作许可。 */
export function useUrlPage(key: string, total: number, pageSize: number) {
  const raw = useUrlState().get(key) ?? '1'
  const requested = /^\d{1,9}$/.test(raw) ? Number(raw) : 1
  return {
    current: Math.max(1, Math.min(requested, Math.max(1, Math.ceil(total / pageSize)))),
    pageSize,
    showSizeChanger: false,
    onChange: (page: number) => updateUrlState({ [key]: page > 1 ? String(page) : '' }),
  }
}
