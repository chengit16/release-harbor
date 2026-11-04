/** @description OPPO 合成资料与敏感字段哨兵，仅供隔离测试，不调用真实商店。 */
import { type OppoUpdateDetails } from '../../packages/contracts/src/index.ts'

/** 不含账号或审核登录信息的公开来源快照。 */
export const oppoDetails: OppoUpdateDetails = {
  appName: 'OPPO 合成应用',
  sourceVersionId: '100',
  sourceVersionCode: '1',
  fields: {
    second_category_id: '74',
    third_category_id: '6685',
    summary: '合成应用简介',
    detail_desc: '这是只用于隔离自动化验证的合成应用介绍内容不会用于真实商店',
    privacy_source_url: 'https://example.com/privacy',
    icon_url: 'https://storepic.oppomobile.com/icon.png',
    pic_url: 'https://storepic.oppomobile.com/1.png,https://storepic.oppomobile.com/2.png',
    copyright_url: 'https://storepic.oppomobile.com/copyright.png',
    age_level: '3',
    adaptive_equipment: '4',
  },
}
/** 固定合成凭据通过真实 SDK 内存安全库保存，不接触用户 Keychain。 */
export const oppoCredentials = { clientId: 'synthetic-client-id', clientSecret: 's'.repeat(64) }
/** 原始响应故意带入秘密字段，验证只有白名单被公开。 */
export function oppoApp(identifier = 'com.example.android'): Record<string, unknown> {
  return {
    ...oppoDetails.fields,
    app_name: oppoDetails.appName,
    version_id: oppoDetails.sourceVersionId,
    version_code: oppoDetails.sourceVersionCode,
    pkg_name: identifier,
    type: 7,
    is_freeze: '0',
    state: '1',
    audit_status_name: '上线',
    release_type: '1',
    update_info_check: 0,
    business_username: 'synthetic-private-contact',
    business_email: 'private@example.com',
    business_mobile: 'synthetic-private-mobile',
    test_desc: 'synthetic-private-test-account',
    app_secret: 'synthetic-app-secret',
    server_secret: 'synthetic-server-secret',
    app_key: 'synthetic-app-key',
  }
}
