/** @description 本机增强可信装配；数据代与凭据根分离，恢复后重新启动所有旧存储和 worker。 */
import { join } from 'node:path'
import type { StoreStatusService } from './store-status.service.ts'
import type { CredentialAccountsService } from './credential-accounts.service.ts'
import { RecoverySafety } from './recovery-safety.ts'
import { LocalStateStore } from './local-state-store.ts'
import { LocalMaintenance } from './local-maintenance.ts'
import { LocalBackupService } from './local-backup.ts'
import { LocalTrackingService } from './local-tracking.service.ts'
import { LocalEfficiencyService } from './local-efficiency.service.ts'
/** 凭据配置进程暂停时销毁会话，恢复后只能重新打开向导。 */
export function localRuntime(
  root: string,
  data: string,
  installation: string,
  status: StoreStatusService,
  accounts: CredentialAccountsService,
  origins: readonly string[],
  safety: RecoverySafety,
  restarted: () => void,
): LocalEfficiencyService {
  const state = new LocalStateStore(join(data, 'local-efficiency.json'))
  const maintenance = new LocalMaintenance()
  return new LocalEfficiencyService(
    new LocalBackupService(root, data, installation, safety),
    state,
    new LocalTrackingService(state, status, maintenance),
    maintenance,
    safety,
    origins,
    {
      pause: () => accounts.onModuleDestroy(),
      resume: () => accounts.onModuleInit(),
      catalog: () => accounts.catalog(),
    },
    restarted,
  )
}
