/** @description vivo 合成材料和公开详情；只用于隔离注入，不代表任何真实账号或商店结果。 */
import type { VivoUpdateDetails } from '../../packages/contracts/src/index.ts'
/** 合成账号由内存安全库持有，禁止向真实商店请求。 */
export const vivoCredentials = {
  accessKey: 'synthetic-vivo-key',
  accessSecret: 'synthetic-vivo-secret',
}
/** 构建号低于合成 APK 的 7，确保只测试递增更新。 */
export const vivoDetails: VivoUpdateDetails = { sourceVersionCode: '6', compatibleDevice: '2' }
/** 未列入安全摘要的测试材料必须始终留在 provider 内存。 */
export function vivoApp(identifier = 'com.example.android'): Record<string, unknown> {
  return {
    packageName: identifier,
    appType: 1,
    saleStatus: 1,
    status: 3,
    versionCode: 6,
    compatibleDevice: 2,
    mainTitle: '合成应用',
    testAccount: 'private-fixture-not-public',
    remark: 'private-fixture-not-public',
  }
}
