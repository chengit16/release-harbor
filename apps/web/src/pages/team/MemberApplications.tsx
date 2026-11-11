/** @description 成员复用管理员应用目录及卡片；数据由服务端按授权过滤，只读边界不因界面统一而扩大。 */
import type { Project } from '@release-harbor/contracts'
import { ApplicationDirectory } from '../projects/ApplicationDirectory.tsx'
import { PageHelp } from '../../components/PageHelp.tsx'
import { useTeamAccess } from './teamAccess.tsx'

/** 共享项目分组、分页和本机摘要，不挂载应用或渠道维护；发布导航依菜单授权显示。 */
export function MemberApplications({ projects }: { /** 可访问项目。 */ projects: Project[] }) {
  const access = useTeamAccess()
  return (
    <>
      <ApplicationDirectory projects={projects} canOpenReleaseCenter={access.menu('releases')} />
      <PageHelp title="成员应用权限说明">
        这里只显示分配给你的应用和渠道，配置由管理员维护。发布与审核分别从已授权的对应菜单操作；查看本机摘要不会查询商店。
      </PageHelp>
    </>
  )
}
