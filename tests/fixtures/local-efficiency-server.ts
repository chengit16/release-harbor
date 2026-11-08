/** @description 本机增强浏览器隔离宿主，支持恢复后重建；所有官方响应来自固定合成替身。 */
import { LocalProductivityService } from '../../apps/api/src/local-productivity.service.ts'
import { FileArtifactStore } from '../../apps/api/src/artifact-store.ts'
import { FileReleasePlanStore } from '../../apps/api/src/release-plan-store.ts'
import { join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectCatalog, ApplicationCatalog } from '../../packages/domain/src/index.ts'
import { FileProjectStore } from '../../apps/api/src/project-store.ts'
import { FileApplicationStore } from '../../apps/api/src/application-store.ts'
import { localDataRoot } from '../../apps/api/src/local-backup.ts'
import { RecoverySafety } from '../../apps/api/src/recovery-safety.ts'
import { LocalBackupService } from '../../apps/api/src/local-backup.ts'
import { LocalStateStore } from '../../apps/api/src/local-state-store.ts'
import { LocalMaintenance } from '../../apps/api/src/local-maintenance.ts'
import { LocalTrackingService, addLocalNotice } from '../../apps/api/src/local-tracking.service.ts'
import { LocalEfficiencyService } from '../../apps/api/src/local-efficiency.service.ts'
import { StoreStatusService } from '../../apps/api/src/store-status.service.ts'
import { StoreStatusStore } from '../../apps/api/src/store-status-store.ts'
import { createApp } from '../../apps/api/src/app.ts'
const root = process.env.RELEASE_HARBOR_DATA_DIR
if (!root || !basename(root).startsWith('release-harbor-ui-')) throw Error('仅限隔离目录')
const port = Number(process.env.RELEASE_HARBOR_PORT || 4402)
const origin = `http://127.0.0.1:${port}`
async function start() {
  if (!root) throw Error()
  const { data, installation } = await localDataRoot(root)
  const projects = new FileProjectStore(join(data, 'projects.json'))
  const apps = new FileApplicationStore(join(data, 'applications.json')),
    catalog = new ApplicationCatalog(projects, apps)
  if (!(await projects.list('local')).length) {
    const p = await new ProjectCatalog(projects).create('local', {
      key: 'local-ui',
      name: '本机增强验收',
      framework: 'native',
    })
    const a = await catalog.create('local', p.id, {
      name: '合成跟踪应用',
      platform: 'android',
      identifier: 'com.example.localui',
    })
    await catalog.bind('local', p.id, a.id, {
      channel: 'meizu',
      appId: '123456',
      credentialReference: 'synthetic-local-profile',
    })
  }
  const statuses = new StoreStatusService(
    projects,
    catalog,
    new StoreStatusStore(join(data, 'store-status.json')),
    {
      async run(job) {
        return {
          bindingId: job.binding.id,
          channel: job.binding.channel,
          checkedAt: new Date().toISOString(),
          code: 'observed',
          versions: [
            {
              versionId: '100',
              versionName: '1.0.0',
              buildNumber: null,
              state: 'in_review',
              rawState: 20,
            },
          ],
        }
      },
      close() {},
    },
    [origin],
    async () => 'synthetic-directory',
  )
  const safety = new RecoverySafety(join(root, '.local', 'release-safety.json')),
    state = new LocalStateStore(join(data, 'local-efficiency.json')),
    maintenance = new LocalMaintenance()
  const local = new LocalEfficiencyService(
    new LocalBackupService(root, data, installation, safety),
    state,
    new LocalTrackingService(state, statuses, maintenance),
    maintenance,
    safety,
    [origin],
    {
      pause: async () => {},
      resume: async () => {},
      catalog: async () => ({ code: 'available', accounts: [] }),
    },
    () => {
      void api.close().then(start)
    },
  )
  if (!(await state.read()).notices.length)
    await state.change((s) =>
      addLocalNotice(
        s,
        'synthetic-notice',
        '合成验收通知',
        '仅用于浏览器验证通知展示，不代表真实商店变化',
      ),
    )
  const bytes = new FileArtifactStore(join(data, 'artifacts'))
  await bytes.initialize()
  const productivity = new LocalProductivityService(
    projects,
    catalog,
    bytes,
    new FileReleasePlanStore(join(data, 'release-plans.json')),
    local,
    async () => [
      {
        key: 'synthetic-tools',
        label: '合成检查工具',
        state: 'ready',
        detail: '仅用于隔离浏览器验收',
      },
    ],
  )
  const api = await createApp(projects, {
    productivity,
    applicationStore: apps,
    storeStatus: statuses,
    localEfficiency: local,
    webRoot: fileURLToPath(new URL('../../apps/web/dist', import.meta.url)),
  })
  await api.listen(port, '127.0.0.1')
}
await start()
