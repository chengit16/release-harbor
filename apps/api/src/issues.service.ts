/** @description 已审核问题档案的只读资源服务；文件来源由启动装配固定，浏览器不能指定路径，损坏不降级为空。 */
import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isIssueCatalog,
  isRecord,
  isIssueId,
  type IssueCatalog,
  type IssueRecord,
} from '@release-harbor/contracts'
import { DomainError } from '@release-harbor/domain'

/** 控制面及构建脚本共用有界读取，拒绝链接文件和非普通资源。 */
export async function readIssueResource(file: string, limit: number): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit) throw new Error('资源超限')
    const buffer = Buffer.alloc(limit + 1)
    let size = 0
    while (size < buffer.length) {
      const part = await handle.read(buffer, size, buffer.length - size, size)
      if (!part.bytesRead) break
      size += part.bytesRead
    }
    if (size > limit) throw new Error('资源超限')
    return buffer.subarray(0, size).toString('utf8')
  } finally {
    await handle.close()
  }
}
/** 文档和目录同属受信任资源包，不读取用户运行数据，也没有任何写入口。 */
export class IssuesService {
  constructor(
    private readonly catalogFile = fileURLToPath(
      new URL('../../../docs/issues/catalog.json', import.meta.url),
    ),
    private readonly documentsRoot = fileURLToPath(new URL('../../../', import.meta.url)),
  ) {}
  /** 每次读取完整校验，刷新不改变档案，不缓存损坏结果或伪造空目录。 */
  async list(): Promise<IssueCatalog> {
    try {
      const value: unknown = JSON.parse(await readIssueResource(this.catalogFile, 1024 * 1024))
      // 早期人工归档曾使用 preflight 分类；只映射此已知别名，源文件不改写，未知分类继续拒绝。
      if (isRecord(value) && value.schemaVersion === 1 && Array.isArray(value.items))
        for (const item of value.items)
          if (isRecord(item) && item.category === 'preflight') item.category = 'publishing'
      if (!isIssueCatalog(value)) throw new Error('无效目录')
      return value
    } catch {
      throw new DomainError('问题档案暂时无法读取，请检查发布资源后重新读取', 503)
    }
  }
  /** 仅通过稳定编号查找，不以编号拼接任意磁盘路径。 */
  async get(id: string): Promise<IssueRecord> {
    if (!isIssueId(id)) throw new DomainError('问题记录不存在', 404)
    const issue = (await this.list()).items.find((i) => i.id === id)
    if (!issue) throw new DomainError('问题记录不存在', 404)
    return issue
  }
  /** 证据序号只在已登记的文档中定位；真实路径还需匹配固定资源根，防止符号链接越界。 */
  async document(id: string, index: string): Promise<string> {
    const issue = await this.get(id)
    if (!/^(0|[1-9]\d{0,3})$/.test(index)) throw new DomainError('证据文档不存在', 404)
    const relative = issue.evidence.documents[Number(index)]
    if (!relative) throw new DomainError('证据文档不存在', 404)
    try {
      const root = await realpath(this.documentsRoot),
        file = join(root, relative)
      if ((await realpath(file)) !== resolve(root, relative)) throw new Error('无效资源')
      return await readIssueResource(file, 512 * 1024)
    } catch {
      throw new DomainError('证据文档暂时无法读取', 503)
    }
  }
}
