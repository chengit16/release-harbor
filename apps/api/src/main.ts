/** @description 本机服务入口，集中读取运行配置并装配持久化，不开放公网监听。 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FileProjectStore } from './project-store.ts'
import { createApp } from './app.ts'
import { FileApplicationStore } from './application-store.ts'
import { ApplicationCatalog } from '@release-harbor/domain'
import { LocalArtifactInspector } from '@release-harbor/runner-local'
import { FileArtifactStore } from './artifact-store.ts'
import { ArtifactsService } from './artifacts.service.ts'

const mode = process.env.RELEASE_HARBOR_MODE || 'local'
const port = Number(process.env.RELEASE_HARBOR_PORT || 4399)
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('端口必须为 1024–65535 的整数')
const dataRoot = process.env.RELEASE_HARBOR_DATA_DIR || join(homedir(), '.release-harbor')
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url))
const projects = new FileProjectStore(join(dataRoot, 'projects.json'))
const applications = new FileApplicationStore(join(dataRoot, 'applications.json'))
const artifacts = new ArtifactsService(
  new ApplicationCatalog(projects, applications),
  new FileArtifactStore(join(dataRoot, 'artifacts')),
  new LocalArtifactInspector(),
)
const app = await createApp(projects, {
  applicationStore: applications,
  artifacts,
  mode,
  webRoot: existsSync(webRoot) ? webRoot : undefined,
})
app.enableShutdownHooks()
await app.listen(port, '127.0.0.1')
console.log(`Release Harbor API 已启动：http://127.0.0.1:${port}`)
