/** @description 启动边界验证：只复用身份明确的本机产品，端口占用不结束原进程。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
// 启动脚本保留原生 MJS，避免为运行启动器先依赖 TypeScript 工具。
import {
  assertPortAvailable,
  checkNodeVersion,
  isHarborService,
  isHarborWorkbench,
} from '../scripts/startup-checks.mjs'

test('启动器拒绝不兼容 Node 和冒充产品的健康响应', async () => {
  assert.throws(() => checkNodeVersion('22.0.0'), /Node.js 24/)
  assert.doesNotThrow(() => checkNodeVersion('24.10.0'))
  const response = (body: unknown) => async () =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  assert.equal(await isHarborService('http://127.0.0.1', response({ ok: true })), false)
  assert.equal(
    await isHarborService(
      'http://127.0.0.1',
      response({ product: 'release-harbor', mode: 'hosted', workspaceId: 'local' }),
    ),
    false,
  )
  assert.equal(
    await isHarborService(
      'http://127.0.0.1',
      response({ product: 'release-harbor', mode: 'local', workspaceId: 'local' }),
    ),
    true,
  )
  assert.equal(
    await isHarborWorkbench(
      'http://127.0.0.1',
      response({ product: 'release-harbor', mode: 'local', workspaceId: 'local' }),
    ),
    false,
    '只有 API 时不能打开空页面',
  )
})

test('占用端口时报错，原监听继续可用', async (t) => {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  )
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await assert.rejects(() => assertPortAvailable(address.port), /不会自动结束其他进程/)
  assert.equal(server.listening, true)
})
