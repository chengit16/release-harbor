# 第三期商店资料与拒绝原因只读能力核对

核对日期：2026-11-07。范围为第三期九个商店渠道已固定的只读查询及 Apple App Store Connect API。只阅读官方公开文档、公开文档服务和仓库既有 provider 实现；没有调用真实账号鉴权、商店业务查询或写入接口。本记录核实接口合同，不代表某账号已授权这些字段。

## 结论

可以在当前商店版本查询结果上附加有界资料摘要，但资料必须跟随官方响应中的真实版本／审核流程，不可把“应用当前资料”误标成任意历史或审核版本。对荣耀等同时返回当前流程与在架资料的渠道，应分开投影。缺字段、商店未公开或响应不完整统一保持“未检查／未提供”，不能推断缺失或合规通过。

审核意见字段虽由部分官方接口返回，仍属于自由文本，可能含个人信息、测试凭据或内部链接。不得将原文、原始附件 URL、附件内容带出 worker；只可在 worker 内按固定关键词分类投影为有限类别，显示“分类提示，完整原因请到商店后台查看”。分类不匹配或无文本时显示未分类／未提供，不能声称覆盖完整拒绝原因。拒绝附件只给出后台核对提示，不下载、不代理展示。

## 渠道字段矩阵

表中字段为官方文档明确列出的响应字段。`应用级/版本范围`表示接口是否保证资料和状态来自同一个审核版本；没有明确保证时不得自行建立关联。

| 渠道／固定查询                                           | 名称、描述                                                             | 图标、截图                                                                             | 隐私网址                           | 审核拒绝意见                                                                                                      | 范围与限制                                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 华为 Android `/api/publish/v2/app-info`                  | `languages[].appName`、`appDesc`、`briefInfo`、`newFeatures`           | `languages[].icon`、`introPic`；也可从 `deviceMaterials[].appIcon`、`screenShots` 读取 | `appInfo.privacyPolicy`            | `auditInfo.auditOpinion`；分类意见还有 `copyRightAuditOpinion`、`copyRightCodeAuditOpinion`、`recordAuditOpinion` | 响应同时有当前流程 `versionId/Number/Code` 和旧在架 `onShelfVersion*`。只能把同一响应中明确关联的资料附到对应条目；分项意见可能是资质类，不等同完整审核拒绝。            |
| 华为鸿蒙 `/api/publish/v3/app-info`                      | 样例明确 `languages[].appName`、`appDesc`、`briefInfo`、`newFeatures`  | 样例明确 `icon`、`introPic`、`deviceMaterials[].appIcon`、`screenShots`                | `appInfo.privacyPolicy`            | `auditInfo.auditOpinion`                                                                                          | 固定查询须先以包类型 7 解析 App ID，再核对 HarmonyOS 身份。文档示例有版本／审核数据；不可仅因 Android v2 有字段就把未在 v3 正文／样例核实的属性强行视为必返。            |
| 小米 `app.mi.com/details?id=包名`                        | 不可靠地提供当前送审资料；本次只读取公开在架版本                       | 不作为本地审核资料来源                                                                 | 未确认                             | 官方 FAQ 未开放审核进度查询                                                                                       | 这是公开商品详情页，不是开发者审核资料 API；只可保留“公开在架版本”摘要。不能通过网页抓取猜图文结构、私有接口或以旧在架版本代替新审核。                                   |
| OPPO `/resource/v1/app/info`                             | `app_name`、`summary`、`detail_desc`、`app_subname`、`update_desc`     | `icon_url`、`pic_url`（文档列资源 URL，竖／横屏素材另字段）                            | `privacy_source_url`               | `refuse_reason`（审核拒绝原因）、`freeze_reason`、`business_refuse_reason`                                        | 可用 `version_code` 指定版本；省略时为官方默认最新版本。仅投影确切响应版本的资料，拒绝原文做固定分类。不同拒绝字段对应业务审核阶段，不能混为同一意见。                   |
| vivo `app.query.details`                                 | `mainTitle`、`subTitle`、`detailDesc`、`simpleDesc`、`updateDesc`      | `icon`、`screenshot`（多个地址逗号分隔）                                               | `privateSelfCheck`（隐私政策地址） | `unPassReason`                                                                                                    | 官方查询按包名返回单个详情对象；资料与该响应的 `versionCode/Name` 配对。版本名可缺失，不能补猜。自由文本不出 worker。                                                    |
| 魅族 `/open/api/v1/app/detail?verId=...`（另有版本目录） | `name`、`appDescription`、`verDescription`、`recommendDesc`、`keyword` | `icon`、`screenShots`                                                                  | `privacyPolicyUrl`                 | 当前核对的官方公开文档未确认该详情接口提供版本审核拒绝意见字段                                                    | 必须用户显式选取目录内 `verId` 后读取详情并核对 appId、包名及 verId；官方无构建号。不得按最新／同名版本猜关联。未找到拒绝意见字段不表示官方后台没有意见。                |
| 荣耀 `/openapi/v1/publish/get-app-detail`                | `languageInfo[].appName`、`intro`、`briefIntro`、`newFeature`          | `fileInfo[].fileType/fileUrl`；官方文件类型表 1 为图标、2/3 为横／竖应用介绍截图       | `basicInfo.privacyPolicyUrl`       | 当前审核查询 `get-audit-result`／`get-app-detail` 的审核结果对象含 `auditMessage` 与 `auditAttachment`            | `get-app-detail` 的多语言、资源和 `releaseInfo` 是应用详情／上架版本；审核意见须来自具体 `releaseId` 的审核结果接口并与 `current` 同一审核单核对。附件 URL 不出 worker。 |
| 应用宝 `/query_app_detail`                               | `app_name`、`introduce`、`one_word_summary`                            | 固定详情响应文档未列图标／截图读取字段；更新字段中的上传流水号不是读取资料             | 固定详情响应文档未列隐私字段       | `/query_app_update_status` 返回 `audit_reason`                                                                    | 审核状态接口没有版本标识，意见只能附于“当前应用审核流程（官方未返回对应版本）”，不可绑定到详情里的旧线上版本。                                                           |

矩阵覆盖华为 Android、小米、OPPO、vivo、魅族、荣耀、应用宝、华为鸿蒙；Apple 见下节，共九个渠道。HarmonyOS 是独立目标，不可复用华为 Android ID 查询或构造平台字段。

### 来源

- 华为：[Android 查询应用信息 v2](https://developer.huawei.com/consumer/cn/doc/AppGallery-connect-References/agcapi-app-info-query-0000001158365045)、[鸿蒙查询应用信息 v3](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-appinfo-query-0000002236041422)、[鸿蒙 AppInfo 字段](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-data-appinfo-0000002236041454)。鸿蒙正文由华为公开 `documentPortal/getDocumentById` 以文档 ID `agc-help-publish-api-appinfo-query-0000002236041422` 读取；没有鉴权。
- 小米：[审核查询 FAQ](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1134)、[公开应用详情](https://app.mi.com)。
- OPPO：[普通应用详情 API](https://open.oppomobile.com/documentation/page/info?id=11004)、[审核状态对照表](https://open.oppomobile.com/documentation/page/info?id=11176)。字段定义亦见本仓库[OPPO 审核查询调查](oppo-review-tracking-research-2026-11-07.md)。
- vivo：[查询详细信息 doc 346](https://dev.vivo.com.cn/documentCenter/doc/346)。
- 魅族：[应用与版本详情文档](https://open.flyme.cn/docs?id=333)，公开正文为 `https://apiopen.flyme.cn/api/web/v1/doc-wiki/detail?id=333`。
- 荣耀：[应用发布开放接口](https://developer.honor.com/cn/doc/guides/101359)，正文包含 get-app-detail、fileInfo 类型表、get-audit-result 的响应结构。只读查询 ID、资料及审核结果的接口合同均以该官方文档为准。
- 应用宝：[官方 API 文档](https://wikinew.open.qq.com/index.html#/iwiki/4015262492)，正文公开服务为 `https://material.open.qq.com/openwiki/getOpenWikiHtml?directoryId=4015262492`；第 3.2、3.5 节分别描述详情与审核查询。
- 固定路由、版本绑定与实际字段投影可对照本仓库 `packages/provider-app-ship/src/store-status.ts`、`store-status-other.ts`、`store-client.ts`；代码只证明本项目当前行为，不替代官方字段定义。

## Apple App Store Connect

Apple 的资料资源分为 AppInfo（应用元数据）、AppStoreVersion（商店版本）、Build（上传构建）和 AgeRatingDeclaration（评级问卷）。它们有关联但并非同一版本快照；页面应分别标注资源归属和最后查询时间。

| 只读资源                                                                                              | 官方字段／关系                                                                                                                      | 可安全呈现的含义                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/apps/{id}/appInfos` → AppInfo                                                                | `state`、地区年龄分级（如 `appStoreAgeRating` 等）及 `ageRatingDeclaration`、`appInfoLocalizations` 关系                            | 应用资料当前状态及 Apple 年龄分级资料。具体 rating 问卷读取 `/v1/appInfos/{id}/ageRatingDeclaration`。问卷答案不是审核通过，也不应自行推算一个年龄标签替代官方返回值。 |
| `GET /v1/appInfos/{id}/appInfoLocalizations` → AppInfoLocalization                                    | `locale`、`name`、`privacyPolicyUrl`、`privacyPolicyText`、`privacyChoicesUrl`                                                      | Apple Connect 当前应用信息中的隐私网址与各语言隐私文字。它不是某个 App Store 版本的隐私快照；多语言分别展示，缺失保持未检查。                                          |
| `GET /v1/appStoreVersions/{id}/appStoreVersionLocalizations`                                          | 版本本地化的 `description`、`supportUrl`、`locale` 等                                                                               | 可作为指定商店版本的描述资料。现有项目另读该版本截图关系。该资源没有隐私网址字段，不能从这里编造隐私值。                                                               |
| `GET /v1/builds/{id}`                                                                                 | `version`、`processingState`、`usesNonExemptEncryption`、`uploadedDate` 等                                                          | 构建版本和处理状态；`usesNonExemptEncryption` 是上传构建属性（布尔），不等于审核意见或自动完成全部出口合规判断。                                                       |
| `GET /v1/builds/{id}/appEncryptionDeclaration`                                                        | `usesEncryption`、`exempt`、`containsThirdPartyCryptography`、`containsProprietaryCryptography`、`appEncryptionDeclarationState` 等 | 加密声明属性。只投影有限枚举／布尔。不要返回 `documentUrl`、申报文件正文、`codeValue` 等文档／内部值。                                                                 |
| `GET /v1/reviewSubmissions`、`GET /v1/reviewSubmissions/{id}`、`GET /v1/reviewSubmissions/{id}/items` | ReviewSubmission 状态、提交日期及关联提交项                                                                                         | 可读提交状态与所含项目；不是审核员给开发者的拒绝评语接口。                                                                                                             |
| `GET /v1/appStoreReviewDetails/{id}`                                                                  | 联系人、演示账号／密码等审核联络资料                                                                                                | 属于开发者提供给审核员的审核信息，不是审核结果或拒绝理由；不得带出 worker。                                                                                            |

**Apple 拒绝意见结论：** 在 Apple 公开 App Store Connect API 目录中核对了 ReviewSubmission、AppStoreReviewDetail、CustomerReview 与相关关系。ReviewSubmission 暴露提交状态／项目；AppStoreReviewDetail 是联系和演示账号资料；CustomerReview 是用户评价。没有找到可读取 App Review Resolution Center 审核员拒绝意见／回复正文的公开 API 字段或端点。故 Apple 拒绝意见继续指引用户到 App Store Connect 的 App Review 页面人工查看，不解析网页内部接口，不把 `appStoreReviewDetail` 冒充审核回复。

**范围与权限：** 上述接口需要 App Store Connect API Key 的适当角色和资源权限。本记录只依据公开 schema 与接口文档，不曾调用真实鉴权接口。`AppInfoLocalization` 的隐私网址是 AppInfo 级；`AgeRatingDeclaration` 是问卷资源；Build 加密声明是 Build 级。除非 API 明确返回版本关系且目标一致，不将这些资源声称为指定送审版本的审查结论。`usesNonExemptEncryption=false` 只表示字段值，不代表所有加密出口合规流程均已满足。

### Apple 官方依据

- [App Info 列表与关系](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appinfos)、[App Info Localization 列表](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-appinfolocalizations)、[AppInfoLocalization 字段](https://developer.apple.com/documentation/appstoreconnectapi/appinfolocalization/attributes-data.dictionary)。
- [Age Rating Declaration 读取](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appinfos-_id_-ageratingdeclaration)、[AgeRatingDeclaration 字段](https://developer.apple.com/documentation/appstoreconnectapi/ageratingdeclaration/attributes-data.dictionary)。
- [Build 列表](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds)、[Build 字段](https://developer.apple.com/documentation/appstoreconnectapi/build/attributes-data.dictionary)、[Build 加密声明关系](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds-_id_-appencryptiondeclaration)、[AppEncryptionDeclaration 字段](https://developer.apple.com/documentation/appstoreconnectapi/appencryptiondeclaration/attributes-data.dictionary)。
- [App Store Review Detail 读取](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstorereviewdetails-_id_)、[Review Submission 列表](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-reviewsubmissions)、[提交项目列表](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-reviewsubmissions-_id_-items)、[Customer Reviews](https://developer.apple.com/documentation/appstoreconnectapi/customerreviews)。
- 仓库现有 Apple 状态、截图与资料读取实现：`packages/provider-app-ship/src/apple-review-client.ts`、`apple-store-materials.ts`、`store-status-other.ts`。当前资料检查要求截图有界，并将 privacy／compliance 留作未检查；这与官方只读资料存在但不能推断合规通过相符。

## 最小安全实施矩阵

1. **商店版本资料报告。** 为每个 `StoreVersionStatus` 加可选、固定键的 `materials` 摘要。仅含 `name`、`description`、`icon`、`screenshots`、`privacyPolicy` 等有限检查结果（`present/missing/unknown/unchecked`）。不得把商店签名 URL、文件 URL、原文描述、审核附件 URL 放入公开合同／缓存；不下载图片、不打开隐私站点。
2. **当前审核意见。** Worker 只把明确匹配到的拒绝状态对应字段送入 `rejectionSummary`，投影为固定类别 `privacy/functionality/listing/qualification/policy`、`categorized/unclassified/not_provided`。保留渠道、明确版本或审核单引用、查询时间及“关键词分类不完整”的标记。不同渠道审核字段（例如 OPPO 资质拒绝与 APK 拒绝）分开处理。
3. **不支持或无关联。** 小米审核状态及拒绝原因保持 unsupported；应用宝审核状态／拒绝原因保持应用级、无版本标识；魅族当前文档未确认拒绝字段；Apple 没有公开拒绝意见读取端点。呈现具体原因的商店后台人工核对入口，不猜字段、不抓取私有页面。
4. **版本隔离。** 荣耀当前审核 `releaseId` 的意见不挂到 `releaseInfo` 旧在架版本；华为当前流程版本与 onShelf 版本分开；魅族仅使用用户选定且回读身份一致的 `verId`；OPPO 尽可能带 `version_code`；vivo 以返回的 `versionCode` 为准；Apple 分开呈现 AppInfo、AppStoreVersion、Build 三种资源。
5. **不构造总体合规结论。** 单个字段出现不等同资料完整、公开页面展示、隐私合规、送审受理或审核通过。目标版本资料缺失可提示用户后台核对，不触发准备、写入、上传或提交动作。

## 未核实与禁止推断

- 小米没有公开审核状态 API；不能从商品详情页推断审核中或拒绝原因，也不抓包探索开发者中心内部请求。
- 华为鸿蒙字段应以 v3 文档本身为依据；Android v2 独有字段不能无证据复制到鸿蒙实现。鸿蒙官方查询样例确认常见元数据与 `auditOpinion`，但没有据此声称所有可选字段必返。
- 应用宝固定详情没有证明图标、截图、隐私网址读取能力；更新时的文件流水号不能反向当成文件查询接口。
- 魅族版本详情没有在本次公开合同中找到拒绝意见字段；不能使用新版本提交返回文案或后台私有接口替代。
- Apple ReviewSubmission、AppStoreReviewDetail、用户 CustomerReview 不等于 Resolution Center 审核回复；不得读取网站私有接口。
- 无论平台是否返回 URL，URL 可能是短期签名链接或含内部资源标识；本项目公开边界只传摘要，不传链接。

以上是代码实现前的官方字段调查，需与合成网络测试及独立浏览器回归共同验证。没有使用真实商店账号，也没有读取或修改真实发布数据。
