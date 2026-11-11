/** @description 在线分片测试使用真实隔离 S3 服务；临时 TLS 代理仅提供测试源和 CORS。 */
import { request } from 'node:http'
import { createServer } from 'node:https'
import type { TestContext } from 'node:test'
import { HostedArtifactStorage } from '../../apps/api/src/hosted/artifacts/storage.ts'
import { listenTls, type testTls } from './hosted-oidc.ts'

/** 连接预先配置的独立测试桶，代理保持 SigV4 签名的 Host 和请求字节。 */
export async function hostedTestStorage(
  t: TestContext,
  tls: Awaited<ReturnType<typeof testTls>>,
  consoleOrigin: URL,
): Promise<HostedArtifactStorage> {
  const upstream = new URL(required('ENDPOINT'))
  if (
    upstream.protocol !== 'http:' ||
    upstream.hostname !== '127.0.0.1' ||
    upstream.pathname !== '/'
  )
    throw new Error('测试存储只接受隔离回环 HTTP 地址')
  const proxy = createServer(tls, (req, res) => {
    const cors =
      req.headers.origin === consoleOrigin.origin
        ? {
            'access-control-allow-origin': consoleOrigin.origin,
            'access-control-allow-methods': 'PUT, GET, HEAD',
            'access-control-allow-headers': 'x-amz-checksum-sha256, content-type',
          }
        : {}
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end()
      return
    }
    const outgoing = request(
      {
        hostname: upstream.hostname,
        port: upstream.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (incoming) => {
        res.writeHead(incoming.statusCode ?? 502, { ...incoming.headers, ...cors })
        incoming.pipe(res)
      },
    )
    outgoing.on('error', () => {
      if (!res.headersSent) res.writeHead(502).end()
    })
    req.on('aborted', () => outgoing.destroy())
    req.pipe(outgoing)
  })
  const port = await listenTls(proxy)
  t.after(() => new Promise<void>((done) => proxy.close(() => done())))
  const storage = new HostedArtifactStorage({
    endpoint: new URL('https://127.0.0.1:' + port),
    bucket: required('BUCKET'),
    region: 'us-east-1',
    accessKeyId: required('ACCESS_KEY'),
    secretAccessKey: required('SECRET_KEY'),
  })
  t.after(() => storage.close())
  await storage.verify()
  return storage
}

function required(suffix: string): string {
  const key = 'RELEASE_HARBOR_HOSTED_TEST_S3_' + suffix
  const value = process.env[key]
  if (!value) throw new Error('缺少测试存储配置：' + key)
  return value
}
