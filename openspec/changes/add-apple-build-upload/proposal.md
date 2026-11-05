# Apple API Key 构建上传

接通第一期 Apple 上传构建动作，复用团队 API Key 档案与现有计划、一次性消费、独立检查、许可握手及人工核对。锁定 SDK 的 Apple 上传不能使用已有 API Key，且 IPA 检查有既有兼容问题，因此由 provider 新增独立 altool 适配，不修改第三方代码。

本轮只实现 iOS IPA 构建上传；不更新 App Store 更新说明、不选择送审构建、不分发 TestFlight、不送审或上线。真实验收须另由用户显式执行具体计划。
