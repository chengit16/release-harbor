# 华为 Android 正式更新送审工程核对

**日期：**2026-11-07。范围为第四期 P4-1，新增正式送审未使用真实商店账号验收。

## 官方依据

以下资料经华为公开文档服务核对正文，不使用鸿蒙 v3 推断 Android 行为：

| 官方文档                                                                                                                                 | 本轮使用的合同                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [获取文件上传地址](https://developer.huawei.com/consumer/cn/doc/AppGallery-connect-References/agcapi-upload-url-new-0000001111685200/)   | GET `/api/publish/v2/upload-url/for-obs`，携带 appId、fileName、sha256、contentLength、releaseType=1；返回 objectId、PUT URL 和存储签名头；地址约五分钟有效 |
| [更新应用文件信息](https://developer.huawei.com/consumer/cn/doc/APPGallery-connect-References/agcapi-app-file-info-0000001111685202/)    | PUT `/api/publish/v2/app-file-info`；fileType=5，files 列表携带 fileName 及作为 fileDestUrl 的 objectId；已有 publishCountry 不可为空                       |
| [更新语言描述](https://developer.huawei.com/consumer/cn/doc/AppGallery-connect-References/agcapi-language-info-update-0000001158245057/) | PUT `/api/publish/v2/app-language-info`；只更新默认语言的 newFeatures，最多 1000 字，不替换其他语言                                                         |
| [提交发布](https://developer.huawei.com/consumer/cn/doc/AppGallery-connect-References/agcapi-app-submit-0000001158245061/)               | POST `/api/publish/v2/app-submit`；传包后等待至少两分钟；releaseTime 为带偏移 UTC 时间查询参数，省略表示审核通过后立即上架                                  |
| [查询应用信息](https://developer.huawei.com/consumer/cn/doc/AppGallery-connect-References/agcapi-app-info-query-0000001158365045/)       | v2 全网当前版本、在架版本、构建号、默认语言及语言资料；4 为审核中、5 为升级审核中，不能把 0 的旧在架版本当新包受理                                          |

## 工程边界

1. `huawei_submit_review` 与旧 `huawei_save_draft` 分开。准备时读取唯一包名对应 App ID、已上架来源、默认语言和公开文案摘要；执行重新读取比对，变化则在写许可前拒绝。
2. 固定 worker 执行 v2 链路，API 不解析凭据、不等待上传。许可先由控制面持久化，再取得短期上传地址、上传、绑定文件和更新默认语言说明。
3. 存储 URL 只接受官方 OBS HTTPS 域名、匹配 objectId 及允许的存储签名头；禁止重定向，不把 OAuth Bearer 带到文件服务器，不输出签名 URL 或上游错误正文。
4. 两分钟等待后须核对解析出的版本名、构建号和默认语言说明；官方未保证解析后必转为草稿，故允许仍为在架／草稿的可编辑状态，不固定要求为 7。在审、待发布或其他状态不继续提交。
5. app-submit 仅发一次；成功回执后同版本、同构建的在审回读才记明确受理。其他许可后异常一律待核对，无自动重传／重提。
6. 单渠道默认草稿；多渠道批次拒绝新送审动作。schema16 读旧格式不写迁移、不回填来源或重算旧摘要。

## 验证记录

本轮增加华为定向测试和隔离 Chrome 场景，覆盖官方路由／参数、许可顺序、两分钟等待、立即／定时策略、来源与构建错配、签名地址边界、等待中变更、一次确认、旧草稿兼容及刷新不重放。最终 `pnpm typecheck`、245 项 `pnpm test`、`pnpm build`、`pnpm format:check` 和完整 `pnpm test:smoke` 通过。华为 8 项专项另经定向复验，包含真实合成 APK 经独立副本核验的 worker 路径。Chrome 验证 1440／375／844 三种屏宽的表单、摘要、页头几何对齐、关闭零授权、一次确认与刷新去重，截图人工复核。

第一次全量测试发现七处断言仍期望当前写入版本 15；同步为 schema16，保留历史格式读取用例。第一次浏览器专项因复用另一个合成应用的商店 App ID 被正确拒绝（409），改用独立合成目标；未放宽生产唯一性规则。补充几何断言时，输入框焦点在切换视口后滚动，造成分次坐标测量不稳定；测试先结束输入并等待两帧后完整通过。构建过程中不并行启动使用同一 dist 的浏览器检查，避免懒加载文件在替换期间不可用。

未执行真实鉴权、上传、送审或上线。真实账号是否具备写权限、实际 OBS 响应及软件包解析时延、后台定时生效仍待用户明确选择具体版本后验收。限制和操作见[使用指南](../guides/huawei-android-updates.md)。
