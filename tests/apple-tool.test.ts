/** @description Apple 真实进程适配的输出流回归；只注入合成帮助和上传输出，不连接商店。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAppleToolRunner } from '../packages/provider-app-ship/src/apple-tool.ts'

const help = '--upload-package --api-key --api-issuer --p8-file-path --output-format'
test('Apple 帮助写到 stderr 且退出成功仍可探测；错误退出不得显示工具可用', async () => {
  for (const [out, err] of [
    [help, ''],
    ['', help],
    ['--upload-package --api-key', '--api-issuer --p8-file-path --output-format'],
  ] as const) {
    const run = createAppleToolRunner((args, _env, done) => {
      assert.deepEqual(args, ['altool', '--help'])
      done(null, out, err)
    })
    const result = await run(['altool', '--help'], {})
    assert.equal(result.ok, true)
    // 两个输出流分别保留，不能因为参数恰好分流而漏掉完整帮助。
    assert.ok(help.split(' ').every((flag) => result.stdout.includes(flag)))
  }
  const failed = createAppleToolRunner((_args, _env, done) => done(Error('failed'), help, help))
  assert.equal((await failed(['altool', '--help'], {})).ok, false)
})
test('Apple 上传不回传两个输出流，也不重试命令', async () => {
  for (const error of [null, Error('raw private error')]) {
    let calls = 0
    const run = createAppleToolRunner((_args, _env, done) => {
      calls++
      done(error, 'private stdout', 'private stderr')
    })
    assert.deepEqual(await run(['altool', '--upload-package', 'synthetic.ipa'], {}), {
      ok: !error,
      stdout: '',
    })
    assert.equal(calls, 1)
  }
})
