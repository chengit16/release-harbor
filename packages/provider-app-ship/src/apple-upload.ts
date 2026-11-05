/** @description 可信执行器的 Apple API Key 上传适配；固定 altool 参数与单次上传，秘密只经受限临时文件交接。 */
import { execFile } from 'node:child_process'
import { createPrivateKey } from 'node:crypto'
import { lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CredentialResolver } from '@huoye/app-ship'
import type { AttemptResult, ReleasePlan, ExecutionDiagnostic } from '@release-harbor/contracts'
import { credentialStore, profileRevision } from './credentials.ts'
import { observeAppleBuild } from './apple-build-status.ts'
import { inspectIpaArtifact } from './inspect-ipa.ts'

/** 固定安全错误仅用于执行诊断，不携带底层工具输出。 */
export class AppleToolUnavailableError extends Error {
  constructor() {
    super('Apple 上传工具不可用或版本不匹配')
  }
}
/** 可信 Node 测试端口；生产只使用固定 xcrun，不从 HTTP 接受参数或命令。 */
export type AppleToolRunner = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<{ ok: boolean; stdout: string }>
/** provider 内部测试依赖，不属于公开合同或 worker 输入。 */
export interface AppleUploadDependencies {
  /** 测试使用内存安全库，生产默认本机 SDK Vault。 */
  store?: CredentialResolver
  /** 可信测试传输，不接触真实商店。 */
  transport?: typeof fetch
  /** 固定诊断码回报，不包含工具输出。 */
  report?: (code: ExecutionDiagnostic) => void
  /** 测试替换命令执行，不发起商店请求。 */
  tool?: AppleToolRunner
}
const nativeTool: AppleToolRunner = (args, env) =>
  new Promise((resolve) => {
    execFile(
      '/usr/bin/xcrun',
      [...args],
      {
        env,
        cwd: env.HOME,
        encoding: 'utf8',
        timeout: args.includes('--help') ? 15000 : 29 * 60 * 1000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => {
        // 原始输出只用于帮助探测，上传输出及 stderr 一律不交给控制面或日志。
        resolve({ ok: !error, stdout: args.includes('--help') ? stdout : '' })
      },
    )
  })

/** 只允许已确认 Apple 计划；许可前完成材料和副本核验，许可后任意失败都交给宿主标为待核对。 */
export async function uploadAppleBuild(
  plan: ReleasePlan,
  file: string,
  vault: string,
  runtimeRoot: string,
  beforeRemote: () => Promise<void>,
  dependencies: AppleUploadDependencies = {},
): Promise<AttemptResult> {
  const s = plan.snapshot
  if (
    s.action !== 'apple_upload_build' ||
    !plan.authorization ||
    !s.artifact.identity ||
    !s.artifact.sha256
  )
    return 'verification_failed'
  // 1. 运行目录必须由宿主新建且不经过别名；不能将密钥写到网页提供的路径。
  const stat = await lstat(runtimeRoot)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.() ||
    (await realpath(runtimeRoot)) !== runtimeRoot
  )
    throw new Error('执行目录不可用')
  const keyDirectory = join(runtimeRoot, 'private_keys')
  const env: NodeJS.ProcessEnv = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: runtimeRoot,
    TMPDIR: runtimeRoot,
    API_PRIVATE_KEYS_DIR: keyDirectory,
  }
  const tool = dependencies.tool ?? nativeTool
  const help = await tool(['altool', '--help'], env)
  if (
    !help.ok ||
    !['--upload-package', '--api-key', '--api-issuer', '--p8-file-path', '--output-format'].every(
      (flag) => help.stdout.includes(flag),
    )
  )
    throw new AppleToolUnavailableError()
  // 2. 仅解析原绑定的团队 Key；格式失败、外部路径或旧密码方式都不能静默回退。
  const material = await (dependencies.store ?? credentialStore(vault)).resolveForLocalExecution({
    credentialProfile: s.binding.credentialReference,
    platform: 'app_store',
    purpose: 'release_execution',
  })
  const keyId = material.fields.apiKeyId
  const issuer = material.fields.apiIssuerId
  const privateKey = material.files?.privateKey?.content
  if (
    !keyId ||
    !/^[A-Z0-9]{10}$/.test(keyId) ||
    !issuer ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(issuer) ||
    !privateKey ||
    Buffer.byteLength(privateKey) > 64 * 1024
  )
    throw new Error('Apple 团队 Key 材料无效')
  const parsed = createPrivateKey(privateKey)
  if (parsed.asymmetricKeyType !== 'ec' || parsed.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
    throw new Error('Apple 私钥格式无效')
  await mkdir(keyDirectory, { mode: 0o700 })
  try {
    const keyFile = join(keyDirectory, `AuthKey_${keyId}.p8`)
    await writeFile(keyFile, privateKey, { mode: 0o600, flag: 'wx' })
    // 3. 解密及写入期间可能配置变化；在请求许可前按真实字节再次核验，不复用 SDK 的 IPA 解析缺陷。
    const identity = await inspectIpaArtifact(file)
    if (
      identity.packageName !== s.application.identifier ||
      identity.versionName !== s.artifact.identity.versionName ||
      identity.buildNumber !== s.artifact.identity.buildNumber ||
      identity.sha256 !== s.artifact.sha256 ||
      identity.sizeBytes !== s.artifact.sizeBytes ||
      (await profileRevision(vault)) !== s.preflight.profileRevision ||
      Date.now() >= Date.parse(plan.authorization.expiresAt)
    )
      return 'verification_failed'
    await beforeRemote()
    // 4. 只发起一次命令，不加 --wait，不更新说明或送审；退出码 0 仅代表工具报告上传成功。
    const result = await tool(
      [
        'altool',
        '--upload-package',
        file,
        '--api-key',
        keyId,
        '--api-issuer',
        issuer,
        '--p8-file-path',
        keyFile,
        '--output-format',
        'json',
      ],
      env,
    )
    if (!result.ok) return 'needs_reconciliation'
    const observed = await observeAppleBuild(
      plan,
      keyId,
      issuer,
      privateKey,
      dependencies.transport,
    )
    if (observed === 'processing_failed') {
      dependencies.report?.('apple_processing_failed')
      return 'needs_reconciliation'
    }
    return observed
  } finally {
    await rm(keyDirectory, { recursive: true, force: true })
  }
}
