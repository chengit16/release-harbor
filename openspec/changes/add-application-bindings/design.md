# 模型与实现设计

## 模型

- `Application`：`id`、可信 `workspaceId`、`projectId`、`name`、`platform`（`android`／`ios`）、`identifier`、UTC `createdAt`。名称去首尾空白后 1～60 字；标识去首尾空白后最多 255 字，至少两段。Android 各段以字母开头，可含字母、数字、下划线；iOS 各段含字母、数字、短横线。本产品暂不接受通配标识，标识保留大小写。
- 同工作空间的同平台标识唯一，即使跨项目也不重复登记；唯一性按保留后的精确值比较，不把不同大小写自动合并。跨工作空间可重复。
- `ChannelBinding`：`id`、`workspaceId`、`projectId`、`applicationId`、`channel`、`appId`、`credentialReference`、正整数 `revision`、UTC `createdAt/updatedAt`、固定 `verification: 'not_checked'`。
- 首批只允许 Android → `huawei`、iOS → `app_store`；同应用同渠道唯一，同空间同渠道同 appId 不可指向另一个应用。appId 是独立商店标识，允许 1～128 位字母、数字、点、下划线、短横线并以字母或数字开头；不从包名推导，也不据此认定商店目标真实存在。
- 凭据引用只接受 1～64 位字母、数字、点、下划线和短横线，以字母开头；它是本机提供器的别名，禁止输入密码、令牌、文件路径或 JSON。通过字符格式检查不代表凭据存在或有效。
- 绑定编辑只允许 appId 与凭据引用，必须携带 `expectedRevision`；成功递增 revision。平台、包身份及绑定渠道不可修改。后续计划冻结必须引用绑定版本，当前尚无计划需迁移。

## HTTP 合同

统一前缀 `/api`，归属来自本地可信上下文；未知输入字段拒绝，错误沿用 `{ statusCode, message }`。

| 方法与路径                                                                 | 请求与响应                                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /projects/:projectId/applications`                                    | `{ items: Application[] }`                                                      |
| `POST /projects/:projectId/applications`                                   | 输入 `{ name, platform, identifier }`，201 返回 `{ application }`               |
| `GET /projects/:projectId/applications/:applicationId`                     | `{ application }`                                                               |
| `GET /projects/:projectId/applications/:applicationId/bindings`            | `{ items: ChannelBinding[] }`                                                   |
| `POST /projects/:projectId/applications/:applicationId/bindings`           | 输入 `{ channel, appId, credentialReference }`，201 返回 `{ binding }`          |
| `PUT /projects/:projectId/applications/:applicationId/bindings/:bindingId` | 输入 `{ appId, credentialReference, expectedRevision }`，200 返回 `{ binding }` |

不存在或归属不符返回 404，输入无效返回 400，重复或版本冲突返回 409。先核对项目和应用归属，再读写绑定，不能只凭 applicationId 或 bindingId 访问。

## 存储与并发

`applications.json` 使用 `{ schemaVersion: 1, applications: [], bindings: [] }`，位于项目文件同一数据目录。缺失时视为空状态，不迁移或修改已有项目文件。未知版本、无效记录或断裂的绑定关系拒绝读取和写入；不降级成空数据覆盖。单进程内同一 Store 串行写入，同目录临时文件原子替换；失败清理临时文件，保留调用方错误并恢复后续队列。

应用和绑定共同原子写入，存储边界再次验证唯一性及 revision。当前无删除接口，项目存在性由用例核对，不引入跨文件删除事务。恢复使用停止服务后的有效备份；不自动忽略或修复未知结构。

## 页面与兼容

按最新主题要求采用白色侧栏、顶栏与卡片，以浅灰和中性色区分内容层级，表单、输入、选择、动作按钮和配置状态优先使用 Ant Design，由 ConfigProvider 统一中文与主题。业务选择卡片保留自定义布局及原生键盘语义。项目详情下展示应用列表，选中后展示包身份和商店绑定；新建／编辑为页面内表单，保存失败保留输入，版本冲突保留草稿并要求刷新。使用 URL 查询参数保存 project/application 定位，返回项目列表可清除定位，刷新可恢复。导航／归属变化时卸载局部业务组件并取消旧请求，旧响应不能进入新对象。

公共 API Client 负责错误与运行时响应校验；涉及本次修改的原有项目请求一起迁移。新增公开数据不包含 SDK 对象、秘密及本机路径；现有项目接口兼容，发布能力保持关闭。
