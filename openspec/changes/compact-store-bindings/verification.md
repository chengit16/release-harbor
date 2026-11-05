# 商店绑定展示验收

## 实现范围

桌面白色紧凑表格、手机卡片、目标复制、准确绑定数量和说明、原行编辑焦点。查询及表单协议不变，无商店核验或发布动作。

## 已执行检查

- `pnpm typecheck`：通过。
- `pnpm test`：126 项通过，0 失败、0 跳过。
- `pnpm build`：通过。
- `pnpm format:check`：通过。
- `pnpm test:smoke`：真实 Chrome 通过，新增六渠道桌面／手机场景及既有完整流程回归通过。
- `git diff --check`：通过。

## 浏览器场景

在隔离服务创建独立合成应用，复用内存账号登记六个渠道。检查桌面表格完整显示长包名、数字 App ID 和账号，六行无巨大留白；手机只挂载紧凑卡片，不产生整页横向滚动。桌面第一行和手机中间行编辑／取消后，焦点返回对应渠道。原有保存、错误保稿、配置冲突、账号回填与刷新流程继续验收。

截图位于忽略目录 artifacts/bindings-compact-desktop.png 和 artifacts/bindings-compact-mobile.png，不提交真实账号或截图。无远端验收，本次没有修改用户运行数据。未安装 OpenSpec CLI，不声称 CLI 校验通过。
