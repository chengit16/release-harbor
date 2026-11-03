# 规格管理约定

本目录管理第一期及后续切片的需求、设计、任务和验收证据，使用 OpenSpec 的 `spec-driven` 文档结构。当前未安装 OpenSpec CLI；文档检查与工程检查分别记录，不能宣称已经通过 CLI 校验。

- `changes/{change-id}/proposal.md`：变更目的、范围与非目标。
- `changes/{change-id}/design.md`：模型、接口、依赖、安全与恢复取舍。
- `changes/{change-id}/specs/{capability}/spec.md`：新增或修改的需求及场景。
- `changes/{change-id}/tasks.md`：可勾选任务，仅完成实际验证的项目。
- `changes/{change-id}/verification.md`：命令结果、浏览器证据和未验收项。
- `specs/`：后续归档时整理已交付能力的现行规格。

先写当前切片的规格和任务再实现。人工与 AI 使用同一目录和规范；用户已授权进入相应开发范围时，按具体任务继续，不为文档流转重复请求许可。新增远端写动作仍需绑定明确账号、目标、产物和授权计划。

本地验收通过可以完成开发切片；第一期整体完成仍以[实施计划](../docs/plans/phase-1-implementation-plan.md)中的真实渠道验收为准。
