# ADR 0004：开发工作流——Cursor 单线开发，Claude Code 当项目经理

- 状态：已采纳
- 日期：2026-10-10

## 背景

用户考虑过把不同模块分给 Cursor、Codex、Gemini 等多个 agent 并行开发。这个项目真正的瓶颈是用户的精力：agent 越多，阻塞、提问、合并请求越多，都会落回用户身上；而个人工作台的开发速度并不是瓶颈。

## 决定

1. **只有一个实现者：Cursor。** 一次只做一个任务，串行推进。其他 agent 暂不参与产品代码开发。
2. **Claude Code 当项目经理：** 拆任务、写说明书、在 Linear 中委派给 Cursor、处理技术阻塞、验收、合并、更新用户本地版本、阶段汇报。
3. **用户只做两件事：** 回答产品决策题（由 Claude Code 整理成带推荐的选择题，成批提问）；每个阶段开始时批准计划，结束时亲自试用。技术问题不上报给用户。
4. **任务管理用 Linear。** 沿用用户已有的 OPC 约定：
   - 项目：Infomili 团队下的「BlueManta-Desktop」。
   - 状态：Backlog → Todo → In Progress → In Review → Done。Claude Code 建 issue 时直接进入 Todo（阶段计划已获批准）。
   - 标签：角色 `AI-Dev`、员工 `Agent-Cursor`、类型 `Feature` / `Bug` / `Improvement`；阻塞用 `Blocked`。
   - 说明书写在 issue 描述里，按 [docs/tasks/_template.md](../tasks/_template.md) 的结构。仓库只放长期文档（vision、ADR、对象模型、接口约定）。
5. **代码流转：**
   - Cursor 在云端按 issue 的 Linear `gitBranchName` 建分支开发，开 PR 到 `main`，PR 描述链接 issue 并写实现说明，issue 移到 In Review。
   - Claude Code 验收：对照说明书看改动，在本地独立 worktree 中跑检查，用隔离的 `DSH_HOME` 实际运行，在 PR 和 issue 中写结论（verified / failed / not-run）。
   - 通过：Claude Code 合并 PR，更新本地 `main` 并构建、刷新用户 Desktop 中的插件，升级前备份用户数据，然后通知用户可以试用；issue 移到 Done。
   - 不通过：写清复现步骤，退回 In Progress。
6. **用户已授权（2026-10-10）：** 在已批准的阶段计划范围内，Claude Code 可以在 Linear 中委派任务给 Cursor、合并验收通过的 PR、更新用户本地版本。超出阶段计划的事项、对外发布、删除数据仍需单独确认。

## 补充（2026-10-10，T1–T2 运行后）

- **验收通过后主动推进：** Claude Code 合并后直接按阶段计划写下一个任务并委派，汇报时告知"下一个已在做"，不再询问是否继续。只在产品决策、计划外事项、阶段末试用时停下。
- **Linear 的 GitHub 自动化：** PR 有新提交或新开时会把 issue 改回 In Progress，与 agent 手动设的 In Review 冲突；PR 合并时会自动移到 Done。验收以 GitHub 上的 PR 状态为准，不以 Linear 状态为准。
- **本地更新：** 见 [docs/local-update.md](../local-update.md)。

## 后果

- 用户的投入：每个阶段批准一次计划、回答几批选择题、阶段末试用。
- 验收由用户说"验收"触发；流程稳定后可改为定时检查。
- `main` 没有设分支保护：Claude Code 会直接提交文档类改动；产品代码只通过 PR 进入 `main`，Cursor 不直接推送 `main`。
- 以后出现完全独立、低风险的工作（测试、文档、无数据交叉的小工具）时，再考虑增加 agent。
