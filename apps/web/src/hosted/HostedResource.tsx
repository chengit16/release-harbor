/** @description 在线目录的通用读取反馈，区分失败、空数据和会话状态。 */
import { Alert, Button, Spin } from 'antd'
import type { ReactNode } from 'react'
import type { HostedData } from './useHostedData.ts'

/** 资源读取结果及成功渲染函数。 */
export interface HostedResourceProps<T> {
  /** 此资源的查询状态，失败时允许显式重试。 */
  resource: HostedData<T>
  /** 仅在读取成功时调用。 */
  children: (value: T) => ReactNode
}

/** 只展示本次读取的结果；错误不会退回到上一空间内容。 */
export function HostedResource<T>({ resource, children }: HostedResourceProps<T>) {
  if (resource.loading)
    return (
      <div className="hosted-loading" role="status" aria-label="正在加载">
        <Spin />
      </div>
    )
  if (resource.error)
    return (
      <Alert
        type="error"
        showIcon
        title={resource.error.message}
        action={<Button onClick={resource.refresh}>重新读取</Button>}
      />
    )
  return resource.data === undefined ? null : children(resource.data)
}
