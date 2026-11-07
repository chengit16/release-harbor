# 商店状态补齐与 iOS 查询修复

核对日期：2026-11-07。用户反馈小米、华为没有查询按钮，OPPO／vivo 状态无法确认，Apple 查询失败。本轮继续采用独立只读 worker，查询不依赖本机发布记录，不修改计划、回执、授权、人工核对及旧锚点。

## iOS 根因与修复

真实只读诊断确认旧 `/v1/apps/{id}/builds?include=preReleaseVersion` 被 Apple 以 HTTP 400、`PARAMETER_ERROR.ILLEGAL` 拒绝，参数为 `include`。改用合法全构建集合后，实际历史构建超过原有 200 条完整性限制，仍不能作为独立审核状态的前置查询。

状态查询现在直接请求 `/v1/apps/{id}/appStoreVersions?filter[platform]=IOS&include=build&limit=200`，只读取商店版本及明确关联的构建号，不扫描 TestFlight 历史。先核对 App ID 与 Bundle ID，关联构建存在其他应用关系时拒绝，不跟随任意 next URL。超过 200 个商店版本仍明确失败，不把截断目录当完整结果。

原有审核准备的构建读取同步修正为 `/v1/builds?filter[app]=...&include=preReleaseVersion,app` 并验证构建归属。它仍保留有界完整性限制，本轮没有宣称“审核准备的超大历史目录”已解决。

官方依据：[应用商店版本关系接口](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions)、[构建集合](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds)。公开机器文档也可从 `https://developer.apple.com/tutorials/data/documentation/appstoreconnectapi/get-v1-builds.json` 核对。

## 华为 Android 与鸿蒙

依据：[Android 应用信息 v2](https://developer.huawei.com/consumer/cn/doc/AppGallery-connect-References/agcapi-app-info-query-0000001158365045)、[应用 ID 查询](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-appid-list-0000002271000617)、[鸿蒙 AppInfo](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-data-appinfo-0000002236041454)。官方 SPA 正文通过公开 `documentPortal/getDocumentById` 服务核对。

固定 `releaseType=1`，Android 使用 v2，鸿蒙使用 v3。全网 `releaseState` 字典：0 在架；1／8 上架或升级审核不通过；2／10 下架；3 待上架；4／5 在审；6 申请下架；7 草稿；9 下架审核不通过；11 撤销上架；12 预审中；13 预审不通过。未知整数保持未知，缺失状态拒绝；不混用测试发布字典。

按包名读取唯一 App ID 并与绑定一致。鸿蒙使用已核实的 `packageTypes=7`；Android 省略可选类型参数，不猜测未核实的数字。`versionNumber/Code/Id` 表示当前流程，`onShelfVersionNumber/Code/Id` 明确表示在架版本；两者分别投影，不能用旧在架覆盖当前草稿或审核。私人审核意见、测试账号等正文不传出 worker。

## vivo

依据：[字典项](https://dev.vivo.com.cn/documentCenter/doc/344)、[查询详细信息](https://dev.vivo.com.cn/documentCenter/doc/346)。正文由官方 `/webapi/doc/info?id=344` 和 346 核对。

`status`：1 草稿、2 在审、3 通过、4 不通过、5 撤审。仅 status=3 时结合 `saleStatus`：1 在架、2 下架；其他值只确认通过。未知审核码保持未知，不用旧包 saleStatus 覆盖在审、拒绝或撤审。

## 小米与 OPPO

小米依据：[官方 API 常见问题](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1134)及 [小米应用商店](https://app.mi.com)。审核进度接口仍未开放。本轮接入固定 HTTPS 公开详情页，核对包名后只读取版本号，无账号请求、图标下载、隐私站点访问或更新许可请求；15 秒期限、512 KiB 预算、拒绝重定向。页面明确标记“公开在架”，不代表当前送审版本已通过。结构变化或包名不符时失败，不伪装成空成功。

OPPO 依据：[官方普通包详情](https://open.oppomobile.com/new/developmentDoc/info?id=11004)，其公开正文由 `/oneoppoapi/doc/detail`、`doc_id=11004` 核对。`audit_status_name` 定义为审核状态描述，官方样例明确给出“上线”，因此只对此精确文案映射已上架。完整数字字典仍缺失，其余状态保持未确认，不用应用级 `state` 或版本异步处理成功推断。RH-0046 保持处理中。

## 应用宝

依据：[应用宝官方 API 文档](https://wikinew.open.qq.com/index.html#/iwiki/4015262492)，公开正文由 `https://material.open.qq.com/openwiki/getOpenWikiHtml?directoryId=4015262492` 核对。

第 3.5 节明确 `/query_app_update_status` 是应用更新审核查询，并非包处理任务：`audit_status` 1 在审、2 驳回、3 通过、8 主动撤销。此前将它视为不可用任务状态的判断已更正。接口只按包名及 App ID 查询，不返回版本标识，因此单列“当前审核流程（官方未返回对应版本）”；`query_app_detail` 的线上版本资料另列，不能将两者强行关联，也不把审核通过当上架。审核原因原文不返回页面。未知码保持未知，业务拒绝或缺字段不构造成功。

## 验证范围

独立临时探针使用本机已有绑定执行一次固定只读查询，仅输出渠道、结果分类、数量和有限状态，没有输出账号、token、包标识、版本号、审核意见或原始响应：

| 实际绑定     | 只读结果                                      |
| ------------ | --------------------------------------------- |
| 华为 Android | observed，2 项：draft、published              |
| 小米         | observed，1 项：published；页面限定为公开在架 |
| OPPO         | observed，1 项：published                     |
| vivo         | observed，1 项：published                     |
| Apple        | observed，41 项：published、superseded        |

这不是上传、送审或发布验收，也没有解除旧记录保护。应用宝与鸿蒙没有本轮真实绑定查询结果，使用合成网络验证官方协议及状态边界。

工程检查实绩：

- `pnpm typecheck`：通过（构建同时执行同一类型门禁）。
- `pnpm test`：217 项通过，0 失败；其中渠道与 Apple 定向回归 29 项通过。
- `pnpm build`：通过，包含问题档案资源验证与复制。
- `pnpm format:check`：通过。
- `pnpm test:smoke`：完整隔离 Chrome 冒烟通过；新增小米范围说明、华为新旧版本并列、应用宝无版本关联流程及 iOS 请求拒绝提示，覆盖 1440／375／844 像素，原无计划绑定、刷新零查询、导航和几何对齐继续通过。
- 人工复核本轮桌面与手机截图；本机运行中的 GET 目录返回七个既有绑定且查询均可用，没有由 GET 触发官方请求。

测试全部使用合成材料和替身网络。上表五个真实只读诊断独立进行，不属于自动化测试；没有任何真实上传、送审或上线。临时诊断探针已清理，不提交凭据、原始响应或测试截图。
