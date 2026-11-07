# Apple 指定版本资料检查验收

日期：2026-11-07。本轮为第三期 P3-3 的有限只读资料检查，不改变发布动作和授权。

## 范围与边界

- 先核对绑定 App ID、Bundle ID 和商店版本目录，再读取指定版本的关系接口。没有本机发布计划也可检查。
- 检查构建关联、各语言描述和支持网址、截图上传状态、审核联系人及测试登录资料，仅返回固定完整性状态。
- 联系人、邮箱、电话、登录名、密码、网址和审核意见不出可信进程。未验证联系人有效、测试登录可用或截图尺寸与内容。
- 截图检查限三个语种和六组；预算外为未确认。隐私政策、隐私标签、评级、加密、合同及其他合规材料为未检查。
- 缺项汇入待办；拒绝原因和附件仍引导到官方后台查看，处理后从发布中心准备新操作，不自动送审。

## 存储和恢复

独立状态缓存写 schema4，兼容读取 schema1–3，GET 不迁移、不补造报告。每绑定指纹保留最近五个版本，每版保留最近失败及上次成功；资料报告与状态目录、查询变化历史分开。共享原预约与十秒防重复间隔，改绑隔离旧报告，损坏拒绝覆盖。原计划、授权、回执和未知执行保护保持原事实。

## 官方接口依据

复用现有受限 Apple 客户端，只调用固定 GET 路由；本轮没有真实账号调用。

- [版本语言资料](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionlocalizations)：读取 locale、description、supportUrl。
- [审核详情](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstorereviewdetail)：私密联系人及测试登录字段只在 worker 判断完整性。
- [语言截图组](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversionlocalizations-_id_-appscreenshotsets)与[截图](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appscreenshotsets-_id_-appscreenshots)：仅将完成上传状态用于有限截图存在性判断。

## 实际验证

类型检查、236 项全量测试、构建和格式检查已通过。新增七项定向测试覆盖合成网络 GET 限制、私人字段投影、跨应用／版本拒绝、不完整目录、截图预算、独立缓存、失败保留、schema3 零写读取及 schema4 升级、来源／归属和冷却窗口。

完整隔离 Chrome 冒烟通过。首轮资料断言因为 Ant Design 标题与状态标签合并文本而超时，实际报告已返回；修正定位后完整复验通过。最终构建又通过资料专项浏览器验收，覆盖显式检查、刷新零请求、待办、1440／375／844 像素无溢出，以及目录查询失败后历史版本仍可选择、旧资料报告可读取。三种视口与手机报告底部截图已人工复核。补充自动测试保护新官方状态已经推进时，旧资料报告不会重建缺项待办。测试仅使用合成材料及隔离目录，没有真实查询、上传、送审或发布。
