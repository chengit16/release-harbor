/** @description 魅族与荣耀合成资料；测试替身的唯一来源，禁止用于真实商店请求。 */
import type { HonorUpdateDetails } from '../../packages/contracts/src/index.ts'
import { meizuMaterials } from '../../packages/provider-app-ship/src/meizu-material.ts'

/** 两家使用独立客户端凭据，测试只注入内存安全库。 */
export const storeCredentials = {
  clientId: 'synthetic-client-id',
  clientSecret: 'synthetic-client-secret-only-tests',
}
/** 公开来源与私人材料采用可断言的不同值，防止误把完整详情持久化。 */
export function meizuApp(identifier = 'com.example.android'): Record<string, unknown> {
  return {
    id: 123456,
    verId: 100,
    status: 50,
    versionName: '1.0.0',
    packageName: identifier,
    name: '魅族合成应用',
    appDescription: '隔离测试中的应用介绍',
    keyword: '合成',
    recommendDesc: '合成应用推荐',
    authorName: '合成主体',
    categoryId: 1,
    category2Id: 2,
    tagId: 3,
    icon: 'https://example.com/icon.png',
    screenShots: ['https://example.com/1.png'],
    certificates: 'https://example.com/cert.png',
    privacyPolicyUrl: 'https://example.com/privacy',
    softwareAuthorNum: 'synthetic-registration',
    ageBracket: 3,
    qualifcation: '其他类',
    dwmc: '合成主体',
    yylb: '0',
    zbzShengId: 440000,
    devContact: 'private-contact-sentinel',
    zjlx: 1,
    zjhm: 'private-id-sentinel',
    yyzzjlx: 1,
    yyzmc: '合成主体',
    yyzzjhm: 'private-id-sentinel',
    yyzlxrlxfs: 'private-contact-sentinel',
  }
}
/** 必须与真实来源构造使用同样公开字段，私人字段不参与摘要。 */
export const meizuDetails = meizuMaterials(meizuApp()).summary
/** 其他语种必须在默认语种说明修改后继续存在。 */
export const honorDetails: HonorUpdateDetails = {
  sourceReleaseId: '100',
  sourceVersionCode: '6',
  defaultLanguage: 'zh-CN',
  releaseCountry: 'CN',
  languages: [
    { languageId: 'en-US', appName: 'Synthetic', intro: 'Synthetic app', newFeature: 'Old notes' },
    {
      languageId: 'zh-CN',
      appName: '荣耀合成应用',
      intro: '隔离应用介绍',
      briefIntro: '简介',
      newFeature: '旧说明',
    },
  ],
}
/** SecretKey 和审核账号不得出现在公开结果、快照或错误信息中。 */
export function honorApp(identifier = 'com.example.android'): Record<string, unknown> {
  return {
    basicInfo: {
      appId: 123456,
      packageName: identifier,
      appCategoryId: 2,
      defaultLanguage: 'zh-CN',
      releaseCountry: 'CN',
      secretKey: 'private-secretkey-sentinel',
    },
    languageInfo: honorDetails.languages,
    releaseInfo: { versionCode: 6, versionName: '1.0.0' },
    publishInfo: {
      releaseType: 1,
      forceUpdate: 0,
      testAccount: 'private-test-user',
      testPassword: 'private-test-password',
      testComment: 'private-test-comment',
    },
    fileInfo: [],
  }
}
