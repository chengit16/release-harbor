/** @description 代理超时可能返回空正文或 HTML，客户端须保留 HTTP 状态并引导核对真实记录。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { HttpError, request } from '../apps/web/src/api/client.ts'

for (const [status, body] of [
  [408, ''],
  [504, '<html>Gateway Time-out</html>'],
] as const) {
  test(`HTTP ${status} 的非JSON响应仍呈现超时与状态，不能被解析错误掩盖`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(body, { status }))
    await assert.rejects(
      request('/api/synthetic', (value) => value),
      (error: unknown) => {
        assert.ok(error instanceof HttpError)
        assert.equal(error.statusCode, status)
        assert.match(error.message, /超时/)
        assert.ok(error.message.includes(String(status)))
        assert.match(error.message, /核对/)
        assert.ok(!error.message.includes('<html>'))
        return true
      },
    )
  })
}

test('非JSON成功响应保留合同错误，正常JSON业务错误保留原安全文案', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('not-json'))
  await assert.rejects(
    request('/api/synthetic', (value) => value),
    /服务响应无法解析/,
  )
  fetch.mock.mockImplementation(
    async () => new Response(JSON.stringify({ message: '已有安装包正在接收' }), { status: 409 }),
  )
  await assert.rejects(
    request('/api/synthetic', (value) => value),
    {
      statusCode: 409,
      message: '已有安装包正在接收',
    },
  )
})
