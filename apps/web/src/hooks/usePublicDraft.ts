/** @description 公开表单的页内存草稿；站内往返可恢复，刷新或关闭前提醒，不持久化材料或授权。 */
import { useState } from 'react'

const drafts = new Map<string, Record<string, string>>()
window.addEventListener('beforeunload', (event) => {
  if (drafts.size) {
    event.preventDefault()
    event.returnValue = ''
  }
})

/** 按资源隔离公开文本草稿；fields 必须显式列出非秘密字段，禁止用于凭据、产物或授权表单。
 * 内存仅属于当前页面实例，明确取消或服务端保存成功后调用 clear；不自动重放任何请求。 */
export function usePublicDraft(key: string, fields: readonly string[]) {
  const [initialValues, setInitialValues] = useState(() => drafts.get(key))
  return {
    /** 仅首次挂载回填，后台刷新不能覆盖正在编辑的内容。 */
    initialValues,
    /** 白名单只接收文本；日期、文件、服务端结果及一次性确认不能进入草稿。 */
    save(values: object): void {
      const content = Object.fromEntries(
        Object.entries(values).filter(
          ([field, value]) => fields.includes(field) && typeof value === 'string',
        ),
      )
      drafts.set(key, content)
    },
    /** 显式放弃或已保存后清理，避免下次创建沿用旧内容。 */
    clear(): void {
      drafts.delete(key)
      setInitialValues(undefined)
    },
  }
}
