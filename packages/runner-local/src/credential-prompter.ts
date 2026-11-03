/** @description 本机凭据交互终端，统一管理提示、关闭回显和取消；秘密只交还可信 CLI 内存。 */
import { createInterface, type Interface } from 'node:readline/promises'
import { Writable, type Readable } from 'node:stream'

/** 复用同一 readline 且关闭历史记录，避免终端输入竞争及秘密残留；测试可注入内存流。 */
export class CredentialPrompter {
  private muted = false
  private closed = false
  private readonly controller = new AbortController()
  private readonly terminal: Writable
  private readonly readline: Interface

  constructor(
    input: Readable,
    private readonly output: Writable,
  ) {
    this.terminal = new Writable({
      write: (chunk, _encoding, done) => {
        if (!this.muted) this.output.write(chunk)
        done()
      },
    })
    this.readline = createInterface({
      input,
      output: this.terminal,
      terminal: true,
      historySize: 0,
    })
    this.readline.on('SIGINT', () => this.close())
  }

  /** 仅返回非空单行输入；隐藏字段关闭所有字符重绘，取消时拒绝尚未完成的问题。 */
  async ask(label: string, hidden = false): Promise<string> {
    if (this.closed) throw new Error('终端已关闭')
    const prompt = label + (hidden ? '（输入不回显）' : '') + '：'
    this.muted = hidden
    // 普通问题必须由 readline 持有完整提示，手写文字加空问题会在 Ctrl+L 或重绘时被擦除。
    // 秘密问题只显式输出安全标签，readline 仍持有提示，但所有字符重绘都被关闭。
    if (hidden) this.output.write(prompt)
    try {
      const value = (
        await this.readline.question(prompt, { signal: this.controller.signal })
      ).trim()
      if (!value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value))
        throw new Error('输入不符合要求')
      return value
    } finally {
      this.muted = false
      if (hidden) this.output.write('\n')
    }
  }

  /** 退出或 Ctrl+C 时恢复终端并中止等待，不写入凭据或打印当前输入。 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.controller.abort()
    this.readline.close()
    this.terminal.end()
  }
}
