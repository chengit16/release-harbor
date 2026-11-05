# Apple 构建上传能力核对

## 依据与范围

- [Apple 上传说明](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)：允许 altool／Transporter，并按 Bundle ID 和版本关联应用；上传后异步处理。
- [构建查询](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-builds)：固定 GET /v1/builds，支持 app、version、preReleaseVersion.version 和 preReleaseVersion.platform 筛选及 preReleaseVersion 关联。
- [上传状态](https://developer.apple.com/help/app-store-connect/reference/app-uploads/build-upload-statuses)：Processing、Failed、Complete 与审核／上架不同。
- 本机 2026-11-05 无网络帮助探测确认 altool 支持 --upload-package、--api-key、--api-issuer、--p8-file-path、--output-format。工具探测不是账号或真实上传验收。

SDK 0.3.0 原有 Apple 上传依赖密码方式，本切片由可信 provider 固定工具参数消费已有团队 API Key；保留原始暂存分支，不整体应用过时改动。上传前维持摘要、字节、副本、目录版本及远端许可核对；上传后一次受限查询只投影固定构建状态，不返回原始响应。

## 工程验证

类型检查、151 项测试、构建及格式检查通过；真实 Chrome 回归通过，覆盖 Apple 摘要明确动作、勾选前禁用、关闭不授权、合成上传后处理状态及刷新不重传，同时保留 Android 全链路回归。独立 runner 使用合成二进制 plist IPA 和内存凭据，验证工具门禁、受限私钥及清理、一次许可、工具异常待核对、目标不匹配零上传、构建状态白名单、人工核对动作隔离及重复上传阻止。真实 Apple 上传尚未执行；审核、上架及持续状态观察属于后续切片。存储写入版本 10，兼容读取 1–9，历史快照不回填、不改指纹。

按用户纠正补测 iOS 自动／手动发布：新 iOS 定时和 Android 手动意图被拒绝，旧定时计划不可执行；Chrome 验证 iOS 不显示指定时间选项，摘要保存手动选择，刷新不重放上传。
