/** @description 用户主动运行的本机凭据录入；秘密仅通过关闭回显的 TTY 输入，不支持秘密参数。 */
import { createPrivateKey } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  credentialStore,
  profileCatalog,
  validateCredentialSubmission,
} from '@release-harbor/provider-app-ship'
import { isProfileReference } from '@release-harbor/contracts'
import { CredentialPrompter } from './credential-prompter.ts'

async function readPrivateKey(path: string): Promise<string> {
  // 使用同一文件描述符检查和读取，避免路径在 lstat 与读取之间被替换成符号链接。
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > 64 * 1024) throw new Error('私钥文件不符合要求')
    const bytes = Buffer.alloc(64 * 1024 + 1)
    let length = 0
    while (length < bytes.length) {
      const read = await file.read(bytes, length, bytes.length - length, null)
      if (!read.bytesRead) break
      length += read.bytesRead
    }
    const after = await file.stat()
    if (
      length > 64 * 1024 ||
      before.size !== length ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error('私钥文件读取期间变化')
    return bytes.subarray(0, length).toString('utf8')
  } finally {
    await file.close()
  }
}

async function add(vaultPath: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.platform !== 'darwin')
    throw new Error('需要 macOS 本机交互终端')
  console.log('开始配置本机凭据。请逐项输入并按回车；秘密字段不回显，按 Ctrl+C 取消。')
  // 1. 终端交互独立管理回显与取消，凭据仍只交由可信 CLI 保存。
  const prompter = new CredentialPrompter(process.stdin, process.stdout)
  const ask = prompter.ask.bind(prompter)
  try {
    const reference = await ask('凭据引用（字母开头，最长 64 位）')
    if (!isProfileReference(reference)) throw new Error('引用格式不正确')
    const channel = await ask('商店（huawei、xiaomi 或 app_store）')
    if (channel !== 'huawei' && channel !== 'app_store' && channel !== 'xiaomi')
      throw new Error('不支持的商店')
    const store = credentialStore(vaultPath)
    if (await store.getMetadata(reference))
      throw new Error('引用已存在，请使用新的引用，不自动覆盖')
    // 2. API Key 只支持只读鉴权；没有 Apple ID／App 专用密码也不能声称具备上传能力。
    if (channel === 'xiaomi') {
      const userName = await ask('小米开发者邮箱', true)
      const privateKey = await ask('小米 API 访问密码（平台称私钥）', true)
      const publicKey = await readPrivateKey(resolve(await ask('小米公钥／证书文件路径', true)))
      const testAccountJson = await ask('新版结构化测试材料 JSON（单行）', true)
      const { material } = validateCredentialSubmission('xiaomi', {
        displayName: '维护档案',
        credentials: { userName, privateKey, publicKey, testAccountJson },
      })
      await store.saveProfile({ credentialProfile: reference, platform: 'xiaomi', material })
    } else if (channel === 'huawei') {
      const clientId = await ask('华为 Client ID', true)
      const clientSecret = await ask('华为 Client Secret', true)
      await store.saveProfile({
        credentialProfile: reference,
        platform: channel,
        material: { fields: { clientId, clientSecret } },
      })
    } else {
      const apiIssuerId = await ask('Apple Issuer ID', true)
      const apiKeyId = await ask('Apple Key ID', true)
      if (
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(apiIssuerId) ||
        !/^[A-Z0-9]{10}$/.test(apiKeyId)
      )
        throw new Error('Apple 标识格式不正确')
      const path = resolve(await ask('Apple .p8 私钥文件路径（仅本机读取）', true))
      const content = await readPrivateKey(path)
      const key = createPrivateKey(content)
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
        throw new Error('需要 Apple P-256 私钥')
      await store.saveProfile({
        credentialProfile: reference,
        platform: channel,
        material: { fields: { apiIssuerId, apiKeyId }, files: { privateKey: { content } } },
      })
    }
    // 3. 只回显安全结论，不打印输入、解密材料或原始存储异常。
    console.log('凭据已安全保存，尚未核验。请在工作台刷新凭据目录并运行只读预检。')
  } finally {
    prompter.close()
  }
}

const vaultPath = join(
  resolve(process.env.RELEASE_HARBOR_DATA_DIR || join(homedir(), '.release-harbor')),
  'credentials',
  'profiles.json',
)
try {
  const command = process.argv[2]
  if (process.argv.length !== 3 || !['add', 'list'].includes(command ?? ''))
    throw new Error('用法：pnpm credentials add 或 pnpm credentials list；不接受凭据参数')
  if (command === 'list') console.log(JSON.stringify(await profileCatalog(vaultPath), null, 2))
  else await add(vaultPath)
} catch {
  console.error(
    '操作未完成。请检查命令、输入格式、重复引用、macOS Keychain 权限及存储状态；不接受凭据命令参数。',
  )
  process.exitCode = 1
}
