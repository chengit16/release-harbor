# 设计

执行器仍核对不可变快照、实际 IPA 副本、凭据目录版本及只读商店目标。Apple 分支使用已有二进制 plist 兼容检查，绕开 SDK 的 Apple 执行入口。provider 只接受固定上传动作与团队 API Key，检查 P-256 私钥、Issuer ID 和 Key ID；不回退 Apple ID 或专用密码。

本机基线为 Xcode altool 支持 --upload-package、--api-key、--api-issuer、--p8-file-path、--output-format。启动前只探测工具帮助，不运行网络上传。固定 /usr/bin/xcrun，不接受网页命令或工具路径。参数含公开 ID 与临时文件路径，私钥正文不进入参数、日志、URL、普通 API 或 IPC。

父进程为单次 worker 创建 0700 真实路径运行目录。私钥只在其子目录以 0600 临时写入；altool 的 HOME、TMPDIR 和 API_PRIVATE_KEYS_DIR 均隔离。上传完成或失败立即清理，worker 被强制停止时父进程杀死其进程组、等待退出再清理本次目录。父进程整体被 SIGKILL 或系统崩溃时仍可能留有受限目录，须如实记录限制，不能声称绝无残留。

许可前再次检查副本摘要和身份、目录版本与有效期；API 持久化远端许可后仅调用一次上传，无重试或备用工具。命令退出码为 0 才记录 build_uploaded；只表示工具报告上传成功，不表示 Apple 处理完成、TestFlight 可用或已上架。许可后异常或工具失败均保守待核对，原始输出留在可信进程且不返回或落日志。

公开回执增加构建已上传与 Apple 工具诊断。人工核对支持 build_present／no_build，不能用华为草稿结论处理 Apple；已有构建阻止相同产物重传，未接收且无处理中上传允许新计划。兼容存储 1–9，写入版本 10；历史事实不重写。

更新说明继续作为计划审批内容保存，Apple 构建上传不会将它同步到 App Store；页面在冻结及执行确认处明确说明。

工具报告上传成功后，对固定 /v1/builds 发起一次 GET，以应用、营销版本和构建号筛选并匹配 included 的 IOS 版本；VALID、PROCESSING、FAILED／INVALID 分别记录可用、处理中、待核对。查询延迟、空列表、重复或异常只记录上传已接收，不推断构建可用。当前未提供持续轮询或刷新状态入口，后续在 App Store Connect 核对。

按用户最新纠正，iOS 发布方式为审核通过后自动发布或手动发布，不提供指定时间选项；新准备及冻结拒绝 iOS 定时／Android 手动策略，旧 iOS 定时快照只读保留且不可执行，须重新准备。选择随计划固定，本轮仅记录，后续送审时再同步 Apple。
