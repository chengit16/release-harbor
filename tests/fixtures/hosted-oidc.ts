/** @description 在线专项的合成 HTTPS IdP；签发测试身份，不读取外部账号或私有日志。 */
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer, type Server } from 'node:https'
import type { ServerResponse } from 'node:http'
import { once } from 'node:events'
import { getCACertificates, setDefaultCACertificates } from 'node:tls'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'

const run = promisify(execFile)

/** 分配独立 HTTPS 监听端口，只在回环开放。 */
export async function listenTls(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试 HTTPS 端口不可用')
  return address.port
}

/** 为测试进程生成临时证书并限制信任范围，结束后清理。 */
export async function testTls(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'harbor-hosted-tls-'))
  const original = getCACertificates('default')
  t.after(async () => {
    setDefaultCACertificates(original)
    await rm(dir, { recursive: true, force: true })
  })
  const keyPath = join(dir, 'key.pem')
  const certPath = join(dir, 'cert.pem')
  await run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '2',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-keyout',
    keyPath,
    '-out',
    certPath,
  ])
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)])
  setDefaultCACertificates([...original, cert.toString()])
  return { key, cert }
}

const clientId = 'hosted-test'
const clientSecret = 'synthetic-client-value'
const subjects = ['pilot-admin', 'pilot-viewer', 'other-admin', 'uninvited']
type TlsFixture = Awaited<ReturnType<typeof testTls>>

function json(reply: ServerResponse, body: object, status = 200) {
  reply.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
}

/** 启动可验证签名、PKCE、nonce 及一次性授权码的固定测试 IdP。 */
export async function testIdentityProvider(t: TestContext, tls: TlsFixture) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const grants = new Map<
    string,
    { subject: string; nonce: string; challenge: string; callback: string }
  >()
  let issuer = ''

  // 授权页仅用于选择合成 subject，控制台仍走真实 OIDC 发现、交换和签名验证。
  const server = createServer(tls, (request, response) => {
    const url = new URL(request.url ?? '/', issuer)
    if (url.pathname === '/issuer/.well-known/openid-configuration') {
      json(response, {
        issuer,
        authorization_endpoint: issuer + '/authorize',
        token_endpoint: issuer + '/token',
        jwks_uri: issuer + '/jwks',
        id_token_signing_alg_values_supported: ['RS256'],
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      })
    } else if (url.pathname === '/issuer/jwks') {
      json(response, {
        keys: [
          { ...publicKey.export({ format: 'jwk' }), use: 'sig', alg: 'RS256', kid: 'synthetic' },
        ],
      })
    } else if (url.pathname === '/issuer/authorize') {
      authorize(url, response, grants)
    } else if (url.pathname === '/issuer/token' && request.method === 'POST') {
      request.setEncoding('utf8')
      let body = ''
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        const input = new URLSearchParams(body)
        const code = input.get('code') ?? ''
        const grant = grants.get(code)
        grants.delete(code)
        const basic = 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
        if (
          !grant ||
          (input.get('client_secret') !== clientSecret &&
            request.headers.authorization !== basic) ||
          input.get('redirect_uri') !== grant.callback ||
          createHash('sha256')
            .update(input.get('code_verifier') ?? '')
            .digest('base64url') !== grant.challenge
        ) {
          json(response, { error: 'invalid_grant' }, 400)
          return
        }
        const iat = Math.floor(Date.now() / 1000)
        const signed = [
          encode({ alg: 'RS256', kid: 'synthetic', typ: 'JWT' }),
          encode({
            iss: issuer,
            sub: grant.subject,
            aud: clientId,
            nonce: grant.nonce,
            iat,
            exp: iat + 120,
          }),
        ].join('.')
        json(response, {
          access_token: 'synthetic-access',
          token_type: 'Bearer',
          id_token:
            signed +
            '.' +
            sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url'),
        })
      })
    } else {
      response.writeHead(404).end()
    }
  })
  issuer = 'https://127.0.0.1:' + (await listenTls(server)) + '/issuer'
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return { issuer, clientId, clientSecret }
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function authorize(
  url: URL,
  response: ServerResponse,
  grants: Map<string, { subject: string; nonce: string; challenge: string; callback: string }>,
) {
  const subject = url.searchParams.get('identity')
  if (!subject) {
    const choices = subjects.map((candidate) => {
      const target = new URL(url)
      target.searchParams.set('identity', candidate)
      return `<li><a href="${target.pathname + target.search.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">${candidate}</a></li>`
    })
    response
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<ul>' + choices.join('') + '</ul>')
    return
  }
  const callback = url.searchParams.get('redirect_uri')
  const nonce = url.searchParams.get('nonce')
  const state = url.searchParams.get('state')
  const challenge = url.searchParams.get('code_challenge')
  if (
    !subjects.includes(subject) ||
    !callback ||
    !nonce ||
    !state ||
    !challenge ||
    url.searchParams.get('code_challenge_method') !== 'S256'
  ) {
    response.writeHead(400).end()
    return
  }
  const code = randomUUID()
  grants.set(code, { subject, nonce, challenge, callback })
  const redirect = new URL(callback)
  redirect.searchParams.set('code', code)
  redirect.searchParams.set('state', state)
  response.writeHead(302, { Location: redirect.href }).end()
}
