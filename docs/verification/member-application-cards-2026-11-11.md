# 成员应用卡片统一核对

## 问题与处理

用户反馈成员的应用管理显示为独立纵向列表，与管理员的平铺卡片不一致。已确认两种角色使用不同组件：成员页自行拉取全部绑定并绘制简化卡，管理员使用共享应用目录和卡片。

成员页现直接复用 `ApplicationDirectory` 与 `ApplicationCard`，统一项目分组、分页、平台名称、项目归属、应用标识、渠道标签及本机摘要说明。配置由管理员维护，成员不挂载创建或配置入口；「前往发布中心」依成员菜单显示。配置只读说明改为按需展开，目录读取、卡片绑定摘要均只请求本机数据。

成员目录的空态说明联系管理员分配权限，不引导创建应用。旧应用详情定位在成员端仍显示目录标题，不因管理员专用详情定位隐藏页头。服务端应用过滤和配置写入拒绝规则保留。

## 验证

- 共享卡片 Chrome 专项已通过：同一安装的管理员与两名成员真实登录，比较 1440／375／844 下卡片列宽、列数、正文内边距、标题字号、应用标识与渠道摘要；人工查看三种视口截图。
- 覆盖未授权应用隔离、跨项目分组、刷新恢复、带应用定位前往发布中心、无发布菜单隐藏跳转、成员配置接口 403、页面导航零业务写入及无浏览器异常。
- `pnpm typecheck`：通过。
- `pnpm test`：316 项中 311 项通过、5 项按环境条件跳过、0 项失败。新增 Chrome 用例在此命令默认跳过，已用下述环境变量实际运行。
- `pnpm build`：通过。
- `RELEASE_HARBOR_TEAM_TEST_BROWSER=1 pnpm exec tsx --test tests/local-team-application-cards-browser.test.ts tests/local-team-permissions-browser.test.ts tests/local-team.test.ts`：4 项通过，0 项跳过。
- `pnpm format:check`：通过。
- `pnpm test:smoke`：完整 Chrome 冒烟通过，包含全站设计与已有发布、审核和维护流程。

截图位于 `artifacts/member-application-cards-1440.png`、`artifacts/member-application-cards-375.png` 与 `artifacts/member-application-cards-844.png`，只含合成数据。

开发时专项测试的浏览器回调曾因嵌套函数引入转译辅助变量 `__name` 而失败；改为浏览器回调内直接校验 DOM 后复跑通过。此问题属于测试回调序列化，未据此修改产品代码或宣称发生过用户侧运行错误。

所有检查使用独立端口与临时数据根，不读用户凭据或安装包，不请求真实商店。
