/** @description 从 OPPO 商店详情投影公开白名单；测试说明与联系人只供可信执行内存复用。 */
import {
  isOppoUpdateDetails,
  isRecord,
  oppoRequiredFields,
  oppoOptionalFields,
  type OppoUpdateDetails,
} from '@release-harbor/contracts'
import { OppoRequestError } from './oppo-client.ts'

function text(value: unknown): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : ''
}
/** 只复用已上架普通应用及完整现有资料，未知状态不猜测为可更新。 */
export function oppoMaterials(
  data: Record<string, unknown>,
  identifier: string,
): { summary: OppoUpdateDetails; privateFields: Record<string, string> } {
  // 1. 只有确定身份及可更新状态才能复用资料，其他资源类型保守拒绝。
  if (data.pkg_name !== identifier) throw new OppoRequestError('merchant_target')
  if (
    String(data.type) !== '7' ||
    String(data.is_freeze) !== '0' ||
    String(data.state) !== '1' ||
    data.audit_status_name !== '上线' ||
    String(data.release_type) !== '1' ||
    String(data.update_info_check) !== '0'
  )
    throw new OppoRequestError('oppo_target_not_ready')
  // 2. 公开快照只保留规定字段；来源版本及链接完整性均需核对。
  const fields: OppoUpdateDetails['fields'] = {}
  for (const key of [...oppoRequiredFields, ...oppoOptionalFields]) {
    const value = text(data[key])
    if (value) fields[key] = value
  }
  const summary = {
    appName: text(data.app_name),
    sourceVersionId: text(data.version_id),
    sourceVersionCode: text(data.version_code),
    fields,
  }
  if (!isOppoUpdateDetails(summary)) throw new OppoRequestError('oppo_materials_missing')
  if (
    Array.from(fields.summary ?? '').length > 13 ||
    Array.from(fields.detail_desc ?? '').length < 20 ||
    !/^[1-9]\d*$/.test(fields.second_category_id ?? '') ||
    !/^[1-9]\d*$/.test(fields.third_category_id ?? '') ||
    !/^\d+$/.test(fields.age_level ?? '') ||
    !['4', '5', '6'].includes(fields.adaptive_equipment ?? '')
  )
    throw new OppoRequestError('oppo_materials_missing')
  // 公开链接仅作为同平台提交资料，不下载第三方网址，不将带凭据 URL 投影到页面。
  for (const key of [
    'privacy_source_url',
    'icon_url',
    'pic_url',
    'copyright_url',
    'landscape_pic_url',
    'special_url',
    'special_file_url',
    'electronic_cert_url',
  ] as const) {
    const value = fields[key]
    if (!value) continue
    try {
      const urls = value.split(',').filter(Boolean)
      if (!urls.length) throw new Error()
      for (const raw of urls) {
        const url = new URL(raw)
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error()
      }
      if (key === 'pic_url' && urls.length < 2) throw new Error()
    } catch {
      throw new OppoRequestError('oppo_materials_missing')
    }
  }
  // 3. 私有审核信息只留在执行内存，不能随公开快照回传或计算秘密摘要。
  const privateFields: Record<string, string> = {}
  for (const key of ['test_desc', 'business_username', 'business_email', 'business_mobile']) {
    const value = text(data[key])
    if (
      !value.trim() ||
      value.length > (key === 'test_desc' ? 400 : 500) ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
    )
      throw new OppoRequestError('oppo_materials_missing')
    privateFields[key] = value
  }
  return { summary, privateFields }
}
