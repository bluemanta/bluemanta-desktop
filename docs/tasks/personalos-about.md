# PersonalOS 看板 · 关于页说明书

- 实现与自查：Claude Code（做法同 [ADR 0012](../decisions/0012-personalos-desk-claude-implements.md)）
- 规则：[specs/personalos-ui.md](../specs/personalos-ui.md) 第 15 节
- 来由：2026-11-27 Chris 要求在「搜索」后加「关于」页，可视化显示 PersonalOS 当前的逻辑架构：入口和关键文件、领域和目录、接入的数据源，以及「关于」的版本和更新日期。版本信息放在 PersonalOS 的 `我/关于.md`，只记更新记录，不记阶段；版本号由 agent 在每次升级关于页时递增。
- 分支：从 `main` 新开 `claude/personalos-about`，在本机 worktree `~/Developer/bm-pos` 开发；开 PR 按 AGENTS.md 的 2026-10-24 授权执行，合并由 Chris 决定

## 任务

| 编号 | 内容 | 允许修改的路径 |
|---|---|---|
| A0 | PersonalOS 侧：新建 `我/关于.md`（更新记录 v1.0），`README.md`「使用入口」加一行链接，按 PersonalOS 协议写日志并提交。**先给 Chris 看内容，同意后再写**；开工前先看 PersonalOS 的 `git status`，别人未存档的改动不碰 | `~/Documents/PersonalOS/` 下的上述文件 |
| A1 | 数据层：架构汇总、更新记录解析；fixture 和单测 | `packages/knowledge/src/personalos/**`、`packages/knowledge/fixtures/**`、`packages/knowledge/test/**` |
| A2 | 接口：`GET /api/v1/personalos/about`；接口测试 | `packages/server/src/**`、`packages/server/test/**` |
| A3 | 网页：「关于」分段、架构图、目录结构、更新记录；走查和截图 | `packages/web/src/**`、`packages/web/e2e/**` |
| A4 | 真实环境只读核对（A0 完成后），写验收记录 | 本文件 |

## 验收项

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 构建、类型、单测 | not-run | |
| 走查 | not-run | |
| 截图 | not-run | |
| 只读 | not-run | |
| 真实环境核对 | not-run | |
| 交付检查 | not-run | |
