import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FileProjectStore } from './project-store.ts'
import { createApp } from './app.ts'

const mode = process.env.RELEASE_HARBOR_MODE || 'local'
const port = Number(process.env.RELEASE_HARBOR_PORT || 4399)
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('端口必须为 1024–65535 的整数')
const dataRoot = process.env.RELEASE_HARBOR_DATA_DIR || join(homedir(), '.release-harbor')
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url))
const app = await createApp(new FileProjectStore(join(dataRoot, 'projects.json')), {
  mode,
  webRoot: existsSync(webRoot) ? webRoot : undefined,
})
app.enableShutdownHooks()
await app.listen(port, '127.0.0.1')
console.log(`Release Harbor API 已启动：http://127.0.0.1:${port}`)
