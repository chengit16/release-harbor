/** @description 将已校验的问题档案与登记证据复制到发布资源；仅构建时写受控输出，不读用户运行数据。 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { IssuesService } from '../apps/api/src/issues.service.ts'

/** 完整验证后替换本次资源目录，临时失败仅清理自己创建的目录。 */
export async function buildIssueAssets(
  webRoot: string,
  sourceRoot = fileURLToPath(new URL('../', import.meta.url)),
): Promise<void> {
  // 1. 先验证完整目录和证据，不能把坏文件打包成空知识库。
  const service = new IssuesService(join(sourceRoot, 'docs/issues/catalog.json'), sourceRoot)
  const catalog = await service.list(),
    documents = new Map<string, string>()
  for (const issue of catalog.items)
    for (const [index, path] of issue.evidence.documents.entries())
      documents.set(path, await service.document(issue.id, String(index)))
  // 2. 所有输出都在构建目录内，路径来自已验证白名单，不接受网页参数。
  const stage = join(webRoot, '.knowledge-' + randomUUID())
  try {
    await mkdir(stage, { recursive: true })
    await writeFile(join(stage, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
    for (const [path, content] of documents) {
      const file = join(stage, 'documents', path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content)
    }
    // 3. 验证完成才发布资源；删除范围固定为本构建的 knowledge，不涉及用户数据目录。
    await rm(join(webRoot, 'knowledge'), { recursive: true, force: true })
    await rename(stage, join(webRoot, 'knowledge'))
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void buildIssueAssets(fileURLToPath(new URL('../apps/web/dist', import.meta.url))).catch(() => {
    console.error('问题档案资源构建失败，请检查目录和证据文件')
    process.exitCode = 1
  })
}
