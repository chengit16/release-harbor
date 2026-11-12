/** @description 本机账号向导先在工作台创建会话，再向独立回环端口提交材料；不经过通用 Client 或缓存。 */
import {
  isRecord,
  isProfileReference,
  type CredentialReplacement,
  isCredentialOperation,
  type BindingChannel,
  type CredentialOperation,
} from '@release-harbor/contracts'

const SESSION_PATH = '/api/local-credential-sessions'

/** 私有配置能力只存向导内存，不导出至公共 contracts。 */
export interface SetupSession {
  id: string
  operationId: string
  reference: string
  channel: BindingChannel
  endpoint: string
  token: string
  expiresAt: string
}

/** 临时输入只由向导及本适配持有；关闭后丢弃，不作为查询数据返回。 */
export interface CredentialDraft {
  displayName: string
  credentials: Record<string, string>
}

/** 明确拒绝的输入可在当前会话修正；网络和服务故障仍必须查询原操作。 */
export class CredentialSetupError extends Error {
  constructor(
    message: string,
    readonly retryInput: boolean,
  ) {
    super(message)
  }
}

function decodeSession(value: unknown, channel: BindingChannel): SetupSession {
  if (!isRecord(value) || !isRecord(value.session))
    throw new Error('配置会话无法核对，请重新打开向导')
  const s = value.session
  if (
    Object.keys(s).length !== 7 ||
    !['id', 'operationId'].every((k) => typeof s[k] === 'string' && /^[a-f0-9-]{36}$/.test(s[k])) ||
    !isProfileReference(s.reference) ||
    s.channel !== channel ||
    typeof s.endpoint !== 'string' ||
    typeof s.token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(s.token) ||
    typeof s.expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(s.expiresAt)) ||
    Date.parse(s.expiresAt) <= Date.now()
  )
    throw new Error('配置会话无法核对，请重新打开向导')
  const url = new URL(s.endpoint)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    s.endpoint !== url.origin ||
    url.username ||
    url.password
  )
    throw new Error('本机配置端点不可信')
  return {
    id: String(s.id),
    operationId: String(s.operationId),
    reference: s.reference,
    channel,
    endpoint: s.endpoint,
    token: s.token,
    expiresAt: s.expiresAt,
  }
}

async function sensitiveRequest(
  path: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  const creatingSession = path === SESSION_PATH
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      // 仅工作台同源的会话创建需要团队 Cookie；回环端口不同但 Cookie 可按主机发送，故材料请求显式禁用。
      credentials: creatingSession ? 'same-origin' : 'omit',
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    })
  } catch {
    if (creatingSession) throw new Error('无法连接本机工作台以创建配置会话，请刷新后重试')
    throw new Error('本机配置连接中断。若已经点击保存，请查询本次结果，勿重复提交。')
  }
  const value: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    // 不传播原始响应；只允许本产品固定的错误提示，阻止材料被上游异常回显。
    if (creatingSession) {
      const messages: Record<number, string> = {
        401: '登录已失效，请刷新页面并重新登录后再配置商店账号',
        403: '请在服务所在电脑打开本机工作台；启用团队时须以管理员身份配置商店账号',
        404: '原账号已不存在，请刷新商店账号列表后重试',
        409: '账号状态已变化，请刷新商店账号列表后重试',
      }
      throw new CredentialSetupError(
        messages[response.status] ?? '未能创建本机配置会话，请刷新后重试',
        false,
      )
    }
    const messages: Record<number, string> = {
      400: '请核对账号名称及当前渠道的凭据格式',
      403: '配置会话无效，请关闭后重新打开向导',
      409: '账号名称冲突、状态已变化或已有操作，请刷新账号列表后重试',
      410: '配置会话已过期，请重新打开向导',
      413: '配置材料超过大小限制',
      415: '配置材料格式不受支持',
      503: '本机安全存储暂不可用，请核对本次保存结果',
    }
    throw new CredentialSetupError(
      messages[response.status] ?? '本机配置未能完成，请核对保存结果',
      [400, 409, 413, 415].includes(response.status),
    )
  }
  return value
}

/** 以当前同源登录申请短期配置会话，仅发送渠道及可选替换标识，不发送材料。 */
export async function beginCredentialSetup(
  channel: BindingChannel,
  signal: AbortSignal,
  replacement?: CredentialReplacement,
): Promise<SetupSession> {
  const value = await sensitiveRequest(
    SESSION_PATH,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Release-Harbor-Setup': '1' },
      body: JSON.stringify({ channel, ...(replacement ? { replacement } : {}) }),
    },
    signal,
  )
  const session = decodeSession(value, channel)
  if (replacement && session.reference !== replacement.reference)
    throw new Error('账号替换会话无法核对')
  return session
}

/** 材料直接交给已验证回环端点；202 只表示开始保存，不表示鉴权通过。 */
export async function saveCredentialSetup(
  session: SetupSession,
  draft: CredentialDraft,
  signal: AbortSignal,
): Promise<CredentialOperation> {
  const value = await sensitiveRequest(
    `${session.endpoint}/v1/sessions/${session.id}/profile`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify(draft),
    },
    signal,
  )
  if (
    !isRecord(value) ||
    !isCredentialOperation(value.operation) ||
    value.operation.id !== session.operationId ||
    value.operation.reference !== session.reference ||
    value.operation.channel !== session.channel
  )
    throw new Error('保存回报无法核对，请查询本次结果')
  return value.operation
}

/** 尚未保存时释放会话；保存中关闭只停止等待，不承诺撤销。 */
export async function cancelCredentialSetup(session: SetupSession): Promise<void> {
  await sensitiveRequest(
    `${session.endpoint}/v1/sessions/${session.id}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${session.token}` } },
    AbortSignal.timeout(3000),
  ).catch(() => undefined)
}
