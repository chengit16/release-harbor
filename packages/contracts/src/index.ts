/** @description 浏览器与服务端共享的公开合同，禁止放置秘密和执行器本地路径。 */
export * from './applications.ts'
export * from './artifacts.ts'
export * from './preflights.ts'
export * from './credential-accounts.ts'

/** 已支持登记的项目技术栈，不作为发布动作依据。 */
export const frameworks = ['react-native', 'flutter', 'native', 'other'] as const
export type Framework = (typeof frameworks)[number]
export interface Project {
  id: string
  workspaceId: string
  name: string
  key: string
  framework: Framework
  description: string
  createdAt: string
}
export interface CreateProject {
  name: string
  key: string
  framework: Framework
  description?: string
}
export interface ProductStatus {
  product: 'release-harbor'
  mode: 'local'
  milestone: 'foundation'
  publishingEnabled: false
  workspaceId: string
}
export interface ChannelCapability {
  id: string
  name: string
  artifact: string
  plannedAction: string
  implemented: false
}
/** 能力规划与产品已实现状态分别表达，不能把上游支持直接标为可发布。 */
export const channelCapabilities: ChannelCapability[] = [
  {
    id: 'huawei',
    name: '华为 AppGallery',
    artifact: 'APK',
    plannedAction: '保存草稿',
    implemented: false,
  },
  {
    id: 'app_store',
    name: 'Apple App Store',
    artifact: 'IPA',
    plannedAction: '上传构建',
    implemented: false,
  },
  {
    id: 'xiaomi',
    name: '小米应用商店',
    artifact: 'APK',
    plannedAction: '提交审核',
    implemented: false,
  },
  {
    id: 'oppo',
    name: 'OPPO / vivo / 应用宝',
    artifact: 'APK',
    plannedAction: '逐渠道核验发布动作',
    implemented: false,
  },
]
export interface ArtifactIdentity {
  format: string
  packageName: string
  versionName: string
  buildNumber: string
  sizeBytes: number
  sha256: string
}
export interface ApiError {
  message: string
  statusCode: number
}
