/** @description 真实 Vite 入口的慢速传输回归，缩放原生 HTTP 时钟并使用隔离上游核对字节完整性。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createHttpServer, Server, request } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from '../apps/web/node_modules/vite/dist/node/index.js'

test(
  '经实际 Vite 配置代理的持续上传跨过旧五分钟期限后仍完整到达上游',
  { timeout: 10000 },
  async (t) => {
    // 1. 临时上游只核对合成字节与摘要，不访问用户项目或安装包。
    const temporary = await mkdtemp(join(tmpdir(), 'harbor-vite-upload-'))
    t.after(() => rm(temporary, { recursive: true, force: true }))
    const bytes = Buffer.from('synthetic-proxy-upload')
    const upstream = createHttpServer(async (incoming, response) => {
      try {
        const chunks: Buffer[] = []
        for await (const chunk of incoming) chunks.push(chunk)
        const received = Buffer.concat(chunks)
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            size: received.length,
            sha256: createHash('sha256').update(received).digest('hex'),
          }),
        )
      } catch {
        // 原生 HTTP 超时会中断上游；由客户端状态断言呈现失败，避免未处理的流异常。
        response.destroy()
      }
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    t.after(async () => {
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    })
    const address = upstream.address()
    assert.ok(address && typeof address !== 'string')
    // 2. 加载项目实际配置，再缩放原生接收期限；未修复配置会返回空正文408。
    const vite = await createServer({
      configFile: fileURLToPath(new URL('../apps/web/vite.config.ts', import.meta.url)),
      cacheDir: join(temporary, 'vite-cache'),
      logLevel: 'silent',
      server: {
        host: '127.0.0.1',
        port: 0,
        watch: null,
        proxy: { '/api': `http://127.0.0.1:${address.port}` },
      },
    })
    t.after(() => vite.close())
    const server = vite.httpServer
    assert.ok(server instanceof Server)
    // 将配置实际得到的原生总期限缩放为千分之一，300秒变为300毫秒；仍由 Node 解析器执行超时。
    // 请求头一次发齐，正文每50毫秒有进度，避免把头部或空闲超时混作总时限回归。
    Object.assign(server, {
      requestTimeout: server.requestTimeout / 1000,
      headersTimeout: 100,
      connectionsCheckingInterval: 10,
    })
    await vite.listen()
    const proxyAddress = server.address()
    assert.ok(proxyAddress && typeof proxyAddress !== 'string')
    // 3. 持续分段传输越过旧总时限，最终同时核对HTTP结果与完整摘要。
    const outgoing = request(`http://127.0.0.1:${proxyAddress.port}/api/upload`, {
      method: 'POST',
      headers: { 'content-length': String(bytes.length) },
    })
    t.after(() => outgoing.destroy())
    const received = new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        outgoing.on('response', (response) => {
          let body = ''
          response.on('data', (chunk) => {
            body += chunk
          })
          response.on('end', () => resolve({ status: response.statusCode, body }))
          response.on('error', reject)
        })
        outgoing.on('error', reject)
      },
    )
    void received.catch(() => undefined)
    outgoing.write(bytes.subarray(0, Math.floor(bytes.length / 10)))
    // 分段总耗时450毫秒，超过原生默认总期限；不在测试中覆盖实际配置得到的时限比例。
    for (let index = 1; index <= 9; index++) {
      await delay(50)
      if (!outgoing.destroyed) {
        const start = Math.floor((bytes.length * index) / 10)
        const end = Math.floor((bytes.length * (index + 1)) / 10)
        outgoing.write(bytes.subarray(start, end))
      }
    }
    outgoing.end()
    const result = await received
    assert.equal(result.status, 200, '持续有进度的请求不能由Vite原生300秒期限返回空正文408')
    assert.deepEqual(JSON.parse(result.body), {
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  },
)
