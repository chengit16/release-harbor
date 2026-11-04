# 统一上架类型与自动资料复用验收

日期：2026-11-04。

## 检查

- `pnpm typecheck`：通过。
- `pnpm test`：85 项通过，无跳过，新增 6 项策略与资料复用集成测试。
- `pnpm build`：通过。
- `pnpm format:check`：通过。
- `pnpm test:smoke`：最终版本真实 Chrome 检查通过。

## 结果与证据

公共策略拒绝未知模式、额外字段、非法日期、无时区或非规范时间；历史已过去的时间仍可读，当前创建和执行拒绝过期。Android／iOS 均能准备并冻结策略；修改策略导致请求冲突或新摘要，旧小米计划缺少上架类型时在消费前拒绝，Apple 仍拒绝执行且不消费授权。

网络替身验证小米定时的 onlineTime 精确等于 UTC 毫秒，立即模式不设置延期时间；许可等待跨过时刻后不发送提交请求，不降级立即上架。受理不解释为审核通过或已上架。

小米准备不再要求浏览器发送名称、隐私政策或图标。独立只读检查从官方公开上架页读取并比对认证查询名称、包名，从固定官方 CDN 原图入口复用 PNG；公开请求不含鉴权头、请求正文或测试材料。解析缺失、身份不符、错误图标、越界来源、超限内容均失败，无占位补值或任意网站抓取。来源声明不可由浏览器伪造。

Chrome 覆盖 Android 及 iOS 上架选项、小米指定时间的实际页面输入、时区与摘要显示、三项资料字段消失、自动复用来源、关闭摘要不执行、单次确认、刷新原回执、桌面和 390px 窄屏；已有华为、Apple 阻塞、账号维护及产物检查回归保持。日期框回车只能确认日期，测试断言不会自动创建发布准备。

截图沿用被忽略目录 `artifacts/xiaomi-preparation-desktop.png`、`artifacts/xiaomi-preparation-mobile.png`、`artifacts/xiaomi-summary-mobile.png`。

## 能力边界

小米资料来源是公开上架版本，不能代表尚未公开的后台草稿。公开页面为兼容读取，结构变化时明确失败；读取不到资料不继续提交。图标预算 256 KiB，公开页预算 512 KiB，不访问第三方隐私政策网站。

仅对官方公开样本页面和原图做了只读结构核对；未使用用户账号、未请求真实鉴权或推送端点，也未设置任何真实商店的上架时间。自动化仅使用合成材料及受控 transport，首次真实受理、定时和即时上架行为仍待具体计划验收。

华为当前只保存草稿，Apple 执行继续暂缓；二者选择只记录意图，尚未设置商店审核版本发布策略。计划写版本 6，读取旧版本不改指纹，降级需要旧备份。没有实现定时上传队列、自动送审其他商店或绕过审核的强制上线。未安装 OpenSpec CLI，不宣称通过 CLI 校验。

依据：[小米自动发布接口](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1134)、[小米公开详情样本](https://app.mi.com/details?id=com.tencent.mm)、[Apple 版本发布选项](https://developer.apple.com/help/app-store-connect/manage-your-apps-availability/select-an-app-store-version-release-option/)。
