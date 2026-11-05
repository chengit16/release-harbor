# Apple 审核与发布工程核对

## 官方依据

本轮核对官方文档及其公开 schema，按固定路由实现，不调用已废弃的旧版本送审接口：

- [构建](https://developer.apple.com/documentation/appstoreconnectapi/builds)：已处理构建与上传资源区分。
- [创建审核集合](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissions)：应用与 IOS 平台关联。
- [创建审核项目](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-reviewsubmissionitems)：加入特定 App Store 版本。
- [提交审核集合](https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-reviewsubmissions-_id_)：`submitted=true`，核对 WAITING_FOR_REVIEW 等响应。
- [修改版本](https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversions-_id_)：设置 MANUAL／AFTER_APPROVAL，绑定已选构建。
- [手动发布](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-appstoreversionreleaserequests)：仅已批准待开发者发布版本，发布请求不能取消。

## 实际范围

已有应用及已有可编辑商店版本，复用已有构建和现有语种／审核资料；准备只读检查，最终摘要一次确认，独立进程执行。原上传与新审核／发布同文件执行槽，schema11 兼容 1–10，旧快照和未知上传事实不改写。目录超限不跟随任意分页 URL，拒绝不完整结果。

本轮不自动创建 App Store 版本，不代填隐私／评级／合同或生成翻译，不迁移真实材料。资料检查只验证当前可读取字段，最终资格及失败细节以 Apple 为准。记录用户反馈的重复构建复用需求，不把旧 remote_unknown 追认为重复构建错误或上传成功。

## 验证

类型检查、161 项测试、构建、格式与真实 Chrome 验收均通过，覆盖：独立协议、状态与部分失败、API 范围／来源、并发一次消费、恢复及人工核对、真实 Chrome 桌面和手机流程。测试仅合成传输，没有真实 Apple 鉴权、审核或上线调用。真实验收另行由用户显式执行具体意图。

Chrome 使用隔离端口和合成网络，验证已有构建选择、手动策略摘要、关闭不消费、确认送审、刷新去重、显式远端观察、批准后的第二份手动发布摘要及桌面／390px 布局。真实 worker 无档案时在鉴权前失败，不调用商店；私有八字段准备协议单独覆盖。来源指纹覆盖公开语种资料、截图标识及可用校验和，截图替换或说明变化使旧摘要失效。
