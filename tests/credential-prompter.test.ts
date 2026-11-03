/** @description 使用真实 readline 和内存终端流验证提示重绘、秘密关闭回显及取消，不访问 Keychain。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { CredentialPrompter } from '../packages/runner-local/src/credential-prompter.ts'

function fixture(t: test.TestContext) {
  const input = new PassThrough()
  let text = ''
  const output = new Writable({
    write(chunk, _encoding, done) {
      text += chunk.toString()
      done()
    },
  })
  const prompter = new CredentialPrompter(input, output)
  t.after(() => {
    prompter.close()
    input.destroy()
    output.destroy()
  })
  return { input, prompter, output: () => text }
}

test('凭据引用提示在终端清屏重绘后仍然可见，输入后进入下一问题', async (t) => {
  const f = fixture(t)
  const reference = f.prompter.ask('凭据引用')
  // 断言失败后的清理会取消等待，避免将取消误报为未处理拒绝。
  void reference.catch(() => undefined)
  assert.match(f.output(), /凭据引用/)
  const offset = f.output().length
  f.input.write('\x0c')
  assert.match(f.output().slice(offset), /凭据引用/, '终端重绘不能擦除正在等待的问题')
  f.input.write('synthetic-profile\r')
  assert.equal(await reference, 'synthetic-profile')
  const channel = f.prompter.ask('商店')
  assert.match(f.output(), /商店/)
  f.input.write('huawei\r')
  assert.equal(await channel, 'huawei')
})

test('秘密提示明确可见，输入、重绘和后续问题均不输出秘密', async (t) => {
  const f = fixture(t)
  const secret = 'synthetic-' + 'sensitive-value'
  const answer = f.prompter.ask('Client Secret', true)
  void answer.catch(() => undefined)
  assert.match(f.output(), /Client Secret/)
  f.input.write(secret)
  f.input.write('\x0c')
  assert.ok(!f.output().includes(secret))
  f.input.write('\r')
  assert.equal(await answer, secret)
  const next = f.prompter.ask('后续问题')
  f.input.write('public-answer\r')
  assert.equal(await next, 'public-answer')
  assert.ok(!f.output().includes(secret))
})

test('秘密输入中 Ctrl+C 立即取消，关闭后不再接受问题或泄漏输入', async (t) => {
  const f = fixture(t)
  const secret = 'synthetic-' + 'cancel-value'
  const answer = f.prompter.ask('Client Secret', true)
  const rejected = assert.rejects(answer, { name: 'AbortError' })
  f.input.write(secret)
  f.input.write('\x03')
  await rejected
  assert.ok(!f.output().includes(secret))
  await assert.rejects(f.prompter.ask('关闭后的问题'), /终端已关闭/)
})
