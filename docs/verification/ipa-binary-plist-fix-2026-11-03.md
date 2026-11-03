# IPA 二进制 plist 解析故障复盘

**日期：**2026-11-03

## 结论与证据

一份已接收的 IPA 返回 `inspection_failed`。下载目录原文件的 SHA-256 与上传记录一致，ZIP CRC 校验正常，原始根 Info.plist 可被本机 plutil 正常解析，三个身份／版本字段完整。

锁定 SDK `@huoye/app-ship@0.3.0` 的 IPA 分支通过返回 UTF-8 字符串的 `exec` 提取 plist，再把字符串写入 plutil。XML 样本不会暴露问题，`bplist00` 开头的二进制 plist 在 UTF-8 往返后失真，稳定触发 `Unexpected character b at line 1`。

使用只含合成二进制 plist 的最小 IPA 可复现相同错误。直接传原始 Buffer 时 plutil 返回 0；转为 UTF-8 文本再编码后返回 1。原文件只在本机手动复核，未复制到仓库或自动化测试夹具。

## 修复范围

兼容处理集中于 `packages/provider-app-ship/src/inspect-ipa.ts`，APK 路径仍调用原 SDK；没有修改 node_modules，也没有改写用户 IPA。

- 限定唯一根应用 Info.plist，使用有界 Buffer 提取并直接写入 plutil stdin。
- 检查包身份、版本和构建号，安全投影排除原始 plist、路径与其他应用字段。
- SHA-256 仍计算整个原 IPA；保留普通文件、符号链接及读取期间大小、时间和 inode 稳定性检查。
- 新增合成二进制 plist 的真实 HTTP → 子进程回归测试，确认完整身份、摘要及原 IPA 字节不变；浏览器成功样本也采用二进制 plist。

回归命令：`pnpm exec tsx --test --test-name-pattern='二进制 Info.plist' tests/artifacts.test.ts`。修复前返回 `failed / inspection_failed`，修复后通过。原失败文件经适配器及真实独立 worker 重新只读检查通过，目标身份匹配，原始摘要保持一致。

## 防止再次发生

已有测试只有 XML plist，不能覆盖真实 IPA 常见的二进制编码。保留两种编码的合成样本，升级 SDK 时同时验证；上游修复后再评估移除此兼容实现，不能只凭版本号删除。

历史失败记录保持原状。失败字节按现有策略已清理，用户需重新上传才能产生新的检查记录；本次不执行商店上传、送审或上线。

修复后 `pnpm typecheck`、`pnpm test`（22 项，无跳过）、`pnpm build`、`pnpm format:check` 和 `pnpm test:smoke` 均通过。原始包检查、最小二进制样本与真实 HTTP／子进程回归的结果一致。
