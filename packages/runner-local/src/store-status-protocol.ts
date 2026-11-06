/** @description 独立商店状态查询端口；只接受宿主恢复的绑定，不接受网页端点或凭据目录。 */
import type { StoreStatusJob, StoreStatusSnapshot } from '@release-harbor/contracts'
export type { StoreStatusJob } from '@release-harbor/contracts'

/** 独立可信进程完成只读查询；关闭会结束活动任务，不重试或取得发布许可。 */
export interface StoreStatusRunner {
  run(job: StoreStatusJob): Promise<StoreStatusSnapshot>
  close(): void
}
