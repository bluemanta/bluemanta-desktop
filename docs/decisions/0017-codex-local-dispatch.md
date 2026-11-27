# ADR 0017：Codex 改为本机派发，Claude Code 提交和开 PR

- 状态：试行（2026-11-28 Chris 同意以「工作台」一单试派）
- 日期：2026-11-28
- 补充：[ADR 0004](0004-dev-workflow.md)（开发工作流）、[ADR 0008](0008-skill-desk.md)（Codex 做 Skill 台）

## 背景

- 之前经 Linear 把任务派给云端 Codex，Codex 开不出 PR，Chris 停掉了。
- Chris 想试「Claude 规划和验收、Codex 执行」的分工。本机 `codex exec` 可以在指定目录里非交互运行，跑完留下事件日志和最后一条报告，也可以按会话 id 续接返工。

## 决定

1. **本机派发，不经 Linear。** Claude Code 用 `scripts/codex-worker.mjs` 在任务 worktree 里运行 `codex exec`。说明书写在 `docs/tasks/<任务>.md`，提交在任务分支上。
2. **Codex 只改文件。** 不提交、不推送、不装依赖、不联网、不读真实数据。脚本用 `--ignore-user-config` 去掉用户配置里的插件和 MCP（其中有邮件、日历、SalesOS 等能访问真实数据的工具），沙箱用 `workspace-write`，`approval_policy = never`。依赖由 Claude Code 先装好。
3. **Claude Code 负责其余步骤。** 读 diff、重跑检查、走查、截图、提交、推送任务分支、开 PR，均适用 2026-10-24 授权。合并、装进 Chris 的 Desktop、真实数据试用仍要 Chris 同意。
4. **每次运行留档。** 运行记录放在仓库外的 `~/Developer/.codex-runs/<时间>-<任务>/`：`prompt.md`、`events.jsonl`、`report.md`、`session-id`、`diff.patch`。验收结论引用这些文件，不进仓库。
5. **验收分五道关：** 范围（只改允许的路径）、工程（check / test / build / dsh:smoke）、逐条对照说明书、界面截图、真实只读试用（需 Chris 同意）。只有严重问题退回返工，返工最多两轮，用 `codex exec resume` 续接同一会话。每次退回的问题都要变成一条测试或检查。
6. **一次一个 Codex。** 不并行派多个任务。小改动 Claude Code 可以直接做，不必派发。

## 后果

- 好处：Codex 在本机跑，提交和 PR 由 Claude Code 统一完成，不再卡在云端发布。
- 代价：Codex 运行时占用本机；沙箱里可能跑不了 `dsh:smoke`（要起浏览器和端口），这一步由 Claude Code 补跑。
- 试行一单后复盘：返工次数、Claude Code 的验收耗时、问题是否都被说明书挡住。结论补在本 ADR。
