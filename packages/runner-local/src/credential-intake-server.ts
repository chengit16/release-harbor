/** @description 独立回环 HTTP 材料入口；来源和会话先于解析，正文只交给本进程保存引擎。 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { CredentialIntakeEngine, CredentialIntakeError } from './credential-intake-engine.ts'

/** 超时及大小均独立限制，不能靠页面校验控制材料内存。 */
const MAX_BODY_BYTES = 128 * 1024

/** 只允许固定浏览器来源、精确端口和配置路径，不提供任意代理或重定向。 */
export class CredentialIntakeServer {
  private server: Server | null = null
  endpoint = ''
  constructor(
    private readonly engine: CredentialIntakeEngine,
    private readonly origins: readonly string[],
  ) {}

  /** 端口由操作系统分配，只有可信父进程可把端点交给工作台。 */
  async start(): Promise<void> {
    await this.engine.initialize()
    const server = createServer((request, response) => {
      void this.handle(request, response)
    })
    server.headersTimeout = 5000
    server.requestTimeout = 10000
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('本机配置服务启动失败')
    this.endpoint = `http://127.0.0.1:${address.port}`
  }

  private async body(request: IncomingMessage): Promise<unknown> {
    if (
      request.headers['content-type'] !== 'application/json' ||
      request.headers['content-encoding']
    )
      throw new CredentialIntakeError('只接受 JSON 配置材料', 415)
    if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES)
      throw new CredentialIntakeError('配置请求超过大小限制', 413)
    const parts: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => request.destroy(), 10000)
    try {
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += bytes.length
        if (size > MAX_BODY_BYTES) throw new CredentialIntakeError('配置请求超过大小限制', 413)
        parts.push(bytes)
      }
      try {
        return JSON.parse(Buffer.concat(parts).toString('utf8'))
      } catch {
        throw new CredentialIntakeError('配置请求格式不正确')
      }
    } finally {
      clearTimeout(timer)
    }
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const send = (status: number, value: unknown): void => {
      if (response.destroyed || response.writableEnded) return
      response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      response.end(JSON.stringify(value))
    }
    try {
      // 1. OPTIONS 也必须验证精确来源和 Host，不能把任意站点纳入本机配置权限。
      const origin = request.headers.origin
      if (
        request.headers.host !== new URL(this.endpoint).host ||
        !origin ||
        !this.origins.includes(origin)
      )
        throw new CredentialIntakeError('配置请求来源不受信任', 403)
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
      const path = request.url ?? ''
      const match = /^\/v1\/sessions\/([a-f0-9-]{36})(?:\/(profile|operation))?$/.exec(path)
      if (!match?.[1]) throw new CredentialIntakeError('配置接口不存在', 404)
      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS')
        response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        send(204, null)
        return
      }
      // 2. 先校验短期能力，再读取材料；会话始终固定渠道及唯一操作。
      const bearer = request.headers.authorization
      if (!bearer?.startsWith('Bearer '))
        throw new CredentialIntakeError('请重新打开账号配置向导', 403)
      this.engine.authorize(match[1], bearer.slice(7), origin)
      if (request.method === 'POST' && match[2] === 'profile') {
        send(202, { operation: await this.engine.save(match[1], await this.body(request)) })
      } else if (request.method === 'GET' && match[2] === 'operation') {
        const operation = await this.engine.sessionOperation(match[1])
        send(200, { operation })
      } else if (request.method === 'DELETE' && !match[2]) {
        this.engine.cancel(match[1])
        send(200, { cancelled: true })
      } else throw new CredentialIntakeError('配置接口不存在', 404)
    } catch (error) {
      // 3. SDK、系统错误和材料均不能被回显；仅使用预先定义的公开分类。
      send(error instanceof CredentialIntakeError ? error.statusCode : 503, {
        message:
          error instanceof CredentialIntakeError
            ? error.message
            : '本机配置暂未完成，请核对保存结果',
      })
    } finally {
      if (!request.destroyed) request.resume()
    }
  }

  /** 先停止接纳并关闭连接，再等待当前保存；进程宿主另有退出硬上限。 */
  async close(): Promise<void> {
    if (this.server) {
      const closed = new Promise<void>((resolve) => this.server?.close(() => resolve()))
      this.server.closeAllConnections()
      await closed
    }
    await this.engine.close()
  }
}
