# 应用宝与华为鸿蒙接口核对

## 官方依据

核对日期：2026-11-05。仅访问公开文档，本轮没有使用真实商店账号调用鉴权、上传或送审接口。

- [应用宝官方 API 文档](https://wikinew.open.qq.com/index.html#/iwiki/4015262492)：主账号 User ID、access_secret、HMAC-SHA256、query_app_detail、get_file_upload_info、COS PUT、update_app 和错误码。公开文档正文由 material.open.qq.com 的 getOpenWikiHtml 提供。
- [鸿蒙应用 ID 查询](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-appid-list-0000002271000617)：包名过滤及 packageTypes=7。
- [鸿蒙应用信息](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-appinfo-query-0000002236041422)及 [AppInfo](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-data-appinfo-0000002236041454)：正式全网来源状态、版本及默认语言。
- [分片 URL](https://developer.huawei.com/consumer/en/doc/appgallery-connect-references/agcapi-obbfile-uploadurl-0000001111685208)：分片描述、四分钟签名地址和存储专用请求头，开发者 Bearer 不复制到存储。
- [软件包绑定](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-app-package-info-update-0000002236201250)、[编译状态](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-query-compile-status-0000002236041434)及 [PackageStates](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-data-packagestates-0000002271160601)：绑定后的 packageId、0 完成／1 解析中／2 失败。
- [软件包信息](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-query-package-info-0000002328848469)：包 ID、文件名与版本回读，appId 使用 header。
- [更新语言信息](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-language-info-update-0000002271160569)：v3 PUT，仅更新默认语言 newFeatures。
- [鸿蒙提交发布](https://developer.huawei.com/consumer/cn/doc/app/agc-help-publish-api-app-submit-0000002271160585)：传包后至少等待两分钟；正式全网 releaseType=1、releasePhase=0；立即发布须防止继承旧 releaseTime。

华为 SPA 文档正文通过其公开 documentPortal/getDocumentById 文档服务读取，使用完整文档 slug，不访问开发者账号接口。所有业务参数含义来自官方文档；SDK 源码只作为锁定版本实际行为的证据。

## 与锁定 SDK 的差异

锁定 @huoye/app-ship 0.3.0 的 TencentUploader 在详情查询失败后会返回空对象继续，且未完整承载本产品的上架选择；HarmonyUploader 仅关联草稿，不完成送审。因此本轮在 provider 集中实现固定协议，不将 SDK 的通用成功当成审核受理。

应用宝签名对未 URL 编码的原始键值按 ASCII 排序，之后才编码表单。详情的 VersionCode／VersionName 保留官方大小写。既有普通软件之外拒绝；公开名称、版本白名单摘要固定，测试登录材料不传出可信进程。未修改的商店资料在 update_app 中省略，不能复制旧包流水。原生 ABI 决定单包使用 apk32 或 apk64；无原生库为通用包。两个上传标志分别使用 1／2，不能用 0。定时 deploy_time 使用 Unix 秒，不额外加八小时；时间戳表示同一时刻，界面按设备时区展示。ret=0 只表示提交受理。

鸿蒙是独立 harmony 平台，只接收正式 .app，读取根 pack.info 的 summary.app.bundleName 与 version；不声称本地检查已验证商店签名，不接受 HAP 或将 APK 改扩展名。v2 包类型 7 匹配独立 App ID，再以 v3 已上架、非分阶段来源准备。分片有界读取，SHA 与 ETag 一一核对；存储地址只允许官方 HTTPS OBS 域名，未知域名不放行。解析成功后读回软件包版本，更新默认语言说明并读回，使用单调时钟至少等待绑定后两分钟才送审。立即发布显式发送过去的 UTC releaseTime，清除旧定时；指定时间发送冻结 UTC 加 +0000，过期不降级。

## 工程验证与限制

隔离网络覆盖签名、来源失败／变化、真实合成 APK／APP 检查、完整独立执行、原子确认、错误 URL、解析未完成／失败、包版本不符、说明不符、受理结果丢失和无自动重试。真实浏览器覆盖账号向导、数字绑定、文件接入、定时摘要、关闭不上传、一次确认、回执和刷新不重放。具体本轮执行结果见 OpenSpec 验证记录。

仍是本机单实例产品，产物上限 256 MiB；应用宝仅既有普通软件单包更新，不做首发、游戏或双包。鸿蒙仅既有全网正式应用更新，不做首发、企业分发、测试分发、分阶段或自动补齐合规资料。签名存储域名不在核实范围、字段缺失或响应不明确时拒绝或待核对。平台签名地址四分钟有效期、Token 时效、网络和平台校验可能导致待核对，不能自动重新上传。商店真实验收、审核通过及最终上架均未在本轮执行。

复跑环境记录：此前完整 Chrome 通过；随后 Chrome 启动超时，在打开页面前失败，原因待定位，见 RH-0034 及 OpenSpec 验证记录。不能把启动失败视为页面通过或渠道失败；测试驱动限定 30 秒启动期限，本机浏览器环境待定位。
