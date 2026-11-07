/** @description Apple、OPPO、应用宝及华为的独立版本读取；复用固定官方客户端，不取得发布许可或修改资料。 */
import type { CredentialProfileStore } from '@huoye/app-ship'
import { type StoreStatusJob, type StoreVersionStatus } from '@release-harbor/contracts'
import { appleReviewClient } from './apple-review-client.ts'
import { readAppleStoreStatus } from './apple-store-status.ts'
import { oppoRequest, oppoSession } from './oppo-client.ts'
import { oppoReviewState } from './oppo-store-status.ts'
import { tencentRequest } from './tencent-harmony-client.ts'
import { readHuaweiStoreStatus } from './huawei-store-status.ts'
import {
  materialReport,
  materialText,
  materialUrl,
  materialImages,
  rejectionSummary,
} from './store-material-projection.ts'
import { storeScalar } from './store-client.ts'

/** 查询结果先核对身份，再投影字段；未核实的审核字典只能保留未知。 */
export async function readOtherStoreVersions(
  job: StoreStatusJob,
  store: CredentialProfileStore,
  transport: typeof fetch,
): Promise<StoreVersionStatus[]> {
  // 1. Apple 版本与构建均来自官方目录，官网提交版本不需要本地执行记录。
  if (job.binding.channel === 'app_store') {
    return readAppleStoreStatus(
      await appleReviewClient(store, job.binding.credentialReference, transport),
      job,
    )
  }

  // 2. 固定渠道凭据仅在可信进程解析；API 和页面不接收原文。
  const channel = job.binding.channel
  if (!['oppo', 'tencent', 'harmony', 'huawei'].includes(channel)) throw Error('invalid_response')
  const material = await store
    .resolveForLocalExecution({
      credentialProfile: job.binding.credentialReference,
      platform: channel,
      purpose: 'verify',
    })
    .catch(() => {
      throw Error('authentication')
    })
  if (channel === 'oppo') {
    const app = await oppoRequest(
      'info',
      await oppoSession(material.fields, transport),
      { pkg_name: job.identifier, ...(job.query ? { version_code: job.query.buildNumber } : {}) },
      transport,
    )
    if (app.pkg_name !== job.identifier || storeScalar(app.type) !== '7')
      throw Error('invalid_response')
    const name = storeScalar(app.version_name),
      code = storeScalar(app.version_code)
    if (!name || !code) throw Error('invalid_response')
    // 指定构建只能接受完全匹配的响应，平台忽略参数时不能保存成该构建的成功结果。
    if (job.query && code !== job.query.buildNumber) throw Error('invalid_response')
    // 最新资料只证明返回版本的状态，不能推断未出现在本次响应中的另一个送审包。
    return [
      {
        versionId: storeScalar(app.version_id) || null,
        versionName: name,
        buildNumber: code,
        ...oppoReviewState(app),
        materials: materialReport(
          { description: materialText(app.detail_desc), screenshots: materialImages(app.pic_url) },
          {
            name: materialText(app.app_name),
            icon: materialUrl(app.icon_url),
            privacy_policy: materialUrl(app.privacy_source_url),
          },
        ),
        ...(rejectionSummary(
          oppoReviewState(app).state,
          app.refuse_reason ?? app.business_refuse_reason ?? app.freeze_reason,
        )
          ? {
              rejection: rejectionSummary(
                oppoReviewState(app).state,
                app.refuse_reason ?? app.business_refuse_reason ?? app.freeze_reason,
              ),
            }
          : {}),
      },
    ]
  }
  if (channel === 'tencent') {
    const app = await tencentRequest(
      material.fields,
      'query_app_detail',
      { pkg_name: job.identifier, app_id: job.binding.appId },
      transport,
    )
    if (
      app.pkg_name !== job.identifier ||
      app.app_type !== 1 ||
      (Object.hasOwn(app, 'app_id') && storeScalar(app.app_id) !== job.binding.appId)
    )
      throw Error('invalid_response')
    const name = storeScalar(app.VersionName),
      code = storeScalar(app.VersionCode)
    if (!name || !code) throw Error('invalid_response')
    const audit = await tencentRequest(
      material.fields,
      'query_app_update_status',
      { pkg_name: job.identifier, app_id: job.binding.appId },
      transport,
    )
    const auditCode = audit.audit_status
    if (
      typeof auditCode !== 'number' ||
      !Number.isSafeInteger(auditCode) ||
      auditCode < 0 ||
      auditCode > 1000
    )
      throw Error('invalid_response')
    // 审核接口不返回版本标识，不能将最新审核状态挂到详情接口的旧线上版本。
    const states: Record<number, StoreVersionStatus['state']> = {
      1: 'in_review',
      2: 'rejected',
      3: 'approved',
      8: 'withdrawn',
    }
    return [
      {
        versionId: null,
        versionName: null,
        buildNumber: null,
        state: states[auditCode] ?? 'unknown',
        rawState: auditCode,
        ...(rejectionSummary(states[auditCode] ?? 'unknown', audit.audit_reason)
          ? { rejection: rejectionSummary(states[auditCode] ?? 'unknown', audit.audit_reason) }
          : {}),
      },
      {
        versionId: null,
        versionName: name,
        buildNumber: code,
        state: 'unknown',
        rawState: null,
        materials: materialReport(
          { description: materialText(app.introduce) },
          { name: materialText(app.app_name) },
        ),
      },
    ]
  }
  // 3. 华为 Android 与鸿蒙分别读取已核实的全网状态，不混用测试发布字典。
  return readHuaweiStoreStatus(job, material.fields, transport)
}
