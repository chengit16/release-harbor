# 魅族与荣耀接口核对

核对日期：2026-11-05。只访问官方公开文档与页面使用的公开文档详情接口，没有使用用户账号、商店 Token 或真实产物。固定 SDK 为 `@huoye/app-ship@0.3.0`，仍用于安全库及本机解析。

## 魅族

依据：[开发者 API 传包文档](https://open.flyme.cn/docs?id=333)，公开正文来自 `https://apiopen.flyme.cn/api/web/v1/doc-wiki/detail?id=333`。

- 正式 API 域名为 developer.meizu.com。创建客户端凭据后，GET `/open/api/v1/token` 的请求头传 clientId／clientSecret；业务请求头使用 accessToken。
- traceId、clientId、timestamp、uri 的原值排序拼串，追加冒号和 clientSecret 后计算 SHA-256；时间为毫秒。不把材料放入 URL。
- 应用列表按 start／limit 分页，最大每页 10；使用包名和数字应用 ID 精确匹配，再以 verId 查询详情。
- 当前切片要求列表与详情为已上架普通应用，已有待审修改时停止。详情明确允许未变更的图标、截图、资质路径复用；其他必需资料从同一版本复用，联系方式和私人备案字段留在进程内。
- `/open/api/v1/app/apk/upload` 只返回临时文件路径，不是提交完成。产品继续调用 `/open/api/v1/app/publish` 创建新版本，并核对返回 verId 的目标、版本和在审状态。
- 官方错误字典禁止包含 32 位库的安装包，执行器在上传前用真实解析器检查。文档不提供来源 versionCode，不能按版本名推断递增大小；本机阻止相同版本名，平台仍负责 APK 版本资格校验。
- 当前公开字段没有定时上架参数，也未核实替代接口。页面禁用指定时间，准备、冻结和执行均拒绝 scheduled；不发送虚构参数、不静默降级。本轮仅实现立即提交新版本，定时能力待平台明确协议。

## 荣耀

依据：[API 传包服务指引](https://developer.honor.com/cn/doc/guides/101359)（公开文档 V14）及[发布应用说明](https://developer.honor.com/cn/doc/guides/100884)。正文由官网公开的 `document/portal/tree/101359?platformNo=10001&lang=cn` 获取。

- 客户端凭据换取 `https://iam.developer.honor.com/auth/token` 的 access_token；业务网关为 appmarket-openapi-drcn.cloud.honor.com，Bearer 认证，不能使用华为材料或应用详情中的 secretKey。
- 按包名查询唯一 App ID，再读取详情和当前流程。首批只支持已有全网上架普通应用，当前流程须审核通过且版本与已上架版本一致；过去的定时已发布版本可继续更新，尚未来临的时间和分阶段类型不放行。
- 上传之前获取文件对象，提交 SHA-256／大小；这是可能创建远端状态的操作，因此远端许可放在此调用前。上传入口必须属于固定官方网关并匹配 appId／objectId，不跟随重定向。
- APK 文件类型为 100；上传后绑定 objectId，其余文件继承。读取绑定文件的 SHA-256、当前编辑态构建号和版本名，完全匹配才继续送审。
- 复用公开多语言资料，只更新默认语种的新版本说明，`setAll=0` 防止删除其他语言。私人测试账号、密码、审核备注仅在执行进程复用，basicInfo.secretKey 不进入公开摘要。
- `/openapi/v1/publish/submit-audit` 使用 releaseType=1（全网）或 2（定时），后者发送带 +0000 的 UTC releaseTime，符合官方带偏移格式。成功必须取得 releaseId；不频繁轮询审核状态，官方建议审核查询间隔为 3 小时。

## SDK 差异与验证边界

上游 SDK 对魅族仅上传未绑定文件，对荣耀只绑定草稿，无法满足本次完整送审和上架意图。因此网络适配集中实现于 provider，API／Web 不直接调用 SDK，不移除现有授权及未知结果核对。

自动化使用内存材料、隔离目录和受控网络；真实 APK 为本机生成的合成包。真实账号权限、生产 APK、商店审核／后台记录及荣耀定时设置仍待用户在具体计划显式验收。详见[工程验证](../../openspec/changes/add-meizu-honor-updates/verification.md)。
