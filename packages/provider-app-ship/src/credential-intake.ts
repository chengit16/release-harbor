/** @description 页面录入的可信 Node 边界，验证渠道材料后复用 SDK 安全库；不供业务 API 加载。 */
import { normalizeXiaomiPublicKey, parseXiaomiTestAccount } from './xiaomi-material.ts'
import { createPrivateKey } from 'node:crypto'
import { isRecord, type BindingChannel, type ProfileCatalog } from '@release-harbor/contracts'
import { credentialStore, profileCatalog } from './credentials.ts'
import type { SecretStore } from '@huoye/app-ship'

/** 材料仅能在配置进程内持有，禁止导出到公共 contracts 或日志。 */
export interface CredentialMaterialInput {
  fields: Record<string, string>
  files?: Record<string, { content: string }>
}

/** 可信存储端口允许测试使用内存替身，生产仍由 provider 装配 SDK。 */
export interface CredentialRepository {
  catalog(): Promise<ProfileCatalog>
  save(
    reference: string,
    channel: BindingChannel,
    material: CredentialMaterialInput,
    overwrite?: boolean,
  ): Promise<void>
  /** 只读回并验证材料，不发起商店请求，不向调用方返回秘密。 */
  check(reference: string, channel: BindingChannel): Promise<boolean>
  /** 明确用户动作后删除指定档案，缺失档案也可清理残留标签。 */
  delete(reference: string): Promise<void>
}

/** 只暴露安全目录和写入口，没有向浏览器读取秘密的能力。 */
export function localCredentialRepository(
  vaultPath: string,
  secrets?: SecretStore,
): CredentialRepository {
  // 仅测试显式注入内存安全库；正常启动从不根据环境变量切换为模拟存储。
  const injected = secrets ? credentialStore(vaultPath, secrets) : undefined
  return {
    catalog: () => profileCatalog(vaultPath, injected),
    async save(reference, channel, material, overwrite = false) {
      await (injected ?? credentialStore(vaultPath)).saveProfile(
        {
          credentialProfile: reference,
          platform: channel,
          material,
        },
        { overwrite },
      )
      if (!(await this.check(reference, channel))) throw new Error('材料保存后无法核对')
    },
    async check(reference, channel) {
      const store = injected ?? credentialStore(vaultPath)
      const metadata = await store.getMetadata(reference)
      if (!metadata || metadata.platform !== channel) return false
      const material = await store.resolveForLocalExecution({
        credentialProfile: reference,
        platform: channel,
        purpose: 'verify',
      })
      try {
        validateCredentialSubmission(channel, {
          displayName: '本机核对',
          credentials:
            channel === 'huawei' ||
            channel === 'oppo' ||
            channel === 'meizu' ||
            channel === 'honor' ||
            channel === 'vivo'
              ? material.fields
              : channel === 'xiaomi'
                ? { ...material.fields, publicKey: material.files?.publicKey?.content }
                : {
                    ...material.fields,
                    privateKey: material.files?.privateKey?.content,
                  },
        })
        return true
      } catch {
        return false
      }
    },
    async delete(reference) {
      await (injected ?? credentialStore(vaultPath)).deleteProfile(reference)
    },
  }
}

/** 输入错误消息固定，不携带解析器、密钥或文件正文。 */
export class CredentialInputError extends Error {}

/** 白名单验证同时保护浏览器绕过和错误渠道，私钥仅接受内容，不读取任意本机路径。 */
export function validateCredentialSubmission(
  channel: BindingChannel,
  value: unknown,
): { displayName: string; material: CredentialMaterialInput } {
  // 1. 严格限制请求与名称，防止渠道材料通过未知字段越过边界。
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !isRecord(value.credentials) ||
    typeof value.displayName !== 'string' ||
    !value.displayName.trim() ||
    value.displayName.trim().length > 60 ||
    /[\x00-\x1f\x7f]/.test(value.displayName)
  )
    throw new CredentialInputError('请填写合法账号名称和对应渠道的凭据')
  const data = value.credentials
  const keys =
    channel === 'huawei' || channel === 'oppo' || channel === 'meizu' || channel === 'honor'
      ? ['clientId', 'clientSecret']
      : channel === 'vivo'
        ? ['accessKey', 'accessSecret']
        : channel === 'xiaomi'
          ? ['userName', 'privateKey', 'publicKey', 'testAccountJson']
          : ['apiIssuerId', 'apiKeyId', 'privateKey']
  if (
    Object.keys(data).length !== keys.length ||
    keys.some((key) => typeof data[key] !== 'string' || !data[key].trim())
  )
    throw new CredentialInputError('请完整填写当前渠道的凭据字段')
  const fields: Record<string, string> = {}
  // 2. 标量限制为单行；测试材料 JSON 单独限制控制字符，不从文件路径推导账号。
  for (const key of keys.filter(
    (key) => key !== 'publicKey' && (channel === 'xiaomi' || key !== 'privateKey'),
  )) {
    const field = data[key]
    if (
      typeof field !== 'string' ||
      field.length > 4096 ||
      (key === 'testAccountJson' ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(
        field,
      )
    )
      throw new CredentialInputError('凭据字段格式不正确')
    fields[key] = field
  }
  if (channel === 'oppo' && (fields.clientId?.length !== 19 || fields.clientSecret?.length !== 64))
    throw new CredentialInputError('OPPO Client ID 须为 19 字符，Client Secret 须为 64 字符')
  if (
    channel === 'huawei' ||
    channel === 'oppo' ||
    channel === 'meizu' ||
    channel === 'honor' ||
    channel === 'vivo'
  )
    return { displayName: value.displayName.trim(), material: { fields } }
  // 3. 小米的访问密码与测试账号留在安全库，平台公钥规范化后加密保存。
  if (channel === 'xiaomi') {
    try {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.userName ?? '')) throw new Error()
      fields.testAccountJson = JSON.stringify(parseXiaomiTestAccount(fields.testAccountJson ?? ''))
      const content = normalizeXiaomiPublicKey(String(data.publicKey))
      return {
        displayName: value.displayName.trim(),
        material: { fields, files: { publicKey: { content } } },
      }
    } catch {
      throw new CredentialInputError('请核对小米开发者邮箱、RSA 公钥与新版结构化测试材料')
    }
  }
  // 4. Apple 首轮使用团队 API Key，复核标识及 P-256 私钥，解析异常不可原样输出。
  if (
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(fields.apiIssuerId ?? '') ||
    !/^[A-Z0-9]{10}$/.test(fields.apiKeyId ?? '')
  )
    throw new CredentialInputError('Apple Issuer ID 或 Key ID 格式不正确')
  const content = data.privateKey
  if (typeof content !== 'string' || Buffer.byteLength(content) > 64 * 1024)
    throw new CredentialInputError('私钥文件超过 64 KiB 限制')
  try {
    const key = createPrivateKey(content)
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
      throw new Error('不支持的私钥')
  } catch {
    throw new CredentialInputError('请选择有效的 Apple P-256 .p8 私钥文件')
  }
  return {
    displayName: value.displayName.trim(),
    material: { fields, files: { privateKey: { content } } },
  }
}
