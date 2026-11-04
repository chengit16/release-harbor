# OPPO 接口能力核对

核对日期：2026-11-04。官方旧 SDK 链接 11280 已不可用；通过官方文档搜索及公开详情接口读取现行内容，不使用第三方转载作为实施依据。

- [API 传包能力](https://open.oppomobile.com/documentation/page/info?id=10998)：企业开发者、先在后台创建应用；Client ID 19 字符、Secret 64 字符；token GET、48 小时有效，旧 token 刷新后五分钟内失效；公共参数按 ASCII 排序拼接后 HMAC-SHA256 小写十六进制。
- [发布版本](https://open.oppomobile.com/documentation/page/info?id=10999)：固定 POST app/upd，异步任务；online_type=1 或 2，定时字段 sche_online_time 格式 yyyy-MM-dd HH:mm:ss。cpu_code=0 是非多包应用。缺少资料不得虚构。
- [文件上传](https://open.oppomobile.com/documentation/page/info?id=11003)：先取上传配置，每文件 sign 单次；multipart file/sign/type，回传文件 url、MD5 及大小。
- [普通包详情](https://open.oppomobile.com/documentation/page/info?id=11004)：以 pkg_name 查询；type=7 普通应用，8 游戏，10 合作应用；详情还含保密字段，不能整份投影。
- [任务状态](https://open.oppomobile.com/documentation/page/info?id=11001)：固定 POST task-state，只读查询包名与 version_code；1 待处理、2 成功、3 失败。

SDK 0.3.0 静态代码只允许 onlineType=1、查询失败仍继续、缺少任务结果核对，不能直接作为可信产品执行器使用。本切片由 provider 补齐，不更改固定依赖。

官方定时时间未显式注明时区，当前国内商店适配按 Asia/Shanghai 显式发送并在摘要提示；真实验收须核对后台显示时间，不宣称已完成真实验证。
