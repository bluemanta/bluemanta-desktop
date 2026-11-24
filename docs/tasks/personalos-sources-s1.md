# PersonalOS 看板 · 接入页 S1 说明书（只读接入页）

- 实现与自查：Claude Code（[ADR 0013](../decisions/0013-personalos-sources-page.md) 决定 6，做法同 [ADR 0012](../decisions/0012-personalos-desk-claude-implements.md)）
- 规则：[specs/personalos-sources.md](../specs/personalos-sources.md)
- 前置：迭代 4（[PR #37](https://github.com/bluemanta/bluemanta-desktop/pull/37)）已合并到 `main`
- 分支：从合并后的 `main` 新开 `claude/personalos-sources-s1`，在本机 worktree `~/Developer/bm-pos` 开发；开 PR 按 AGENTS.md 的 2026-10-24 授权执行，合并由 Chris 决定

## 任务

| 编号 | 内容 | 允许修改的路径 |
|---|---|---|
| S0 | PersonalOS 侧的准备（**每一步都先给 Chris 看改动再写**）：在蓝图 v0.4 中写进 ADR 0013 决定 2 和决定 4（登记表格式、两类后台任务）；新建 `我/数据源.md`，登记微信来源和本机现有的自建任务；在 `README.md` 根导航加链接；按 PersonalOS 协议写日志并提交。开工前先看 PersonalOS 的 `git status`，别人未存档的改动不碰。 | `~/Documents/PersonalOS/` 下的上述文件 |
| S1a | 数据层：登记表解析、新鲜度、launchd / Codex / Claude 三种任务发现、`launchctl list` 解析、自建判断、参数脱敏；fixture 和单测 | `packages/knowledge/src/personalos/sources/**`、`packages/knowledge/test/**` |
| S1b | 接口：`GET /api/v1/personalos/sources` 和日志接口；接口测试 | `packages/server/src/**`、`packages/server/test/**` |
| S1c | 网页：「接入」页两段、详情卡片、今天页提醒行；走查和截图 | `packages/web/src/**`、`packages/web/e2e/**` |
| S1d | 真实环境只读试跑（需 Chris 同意），写验收记录 | 本文件 |

每个任务一笔提交。

## 验收项

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 构建、类型、单测 | not-run | `npm run build && npm run check && npm test` |
| 走查 | not-run | `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough`，包含新加的接入页用例 |
| 截图 | not-run | 1440 / 720，深浅色 |
| 只读 | not-run | 测试中给 fixture 目录做哈希，运行前后一致；服务端代码里只有 `launchctl list` 这一条子进程调用 |
| 隐私 | not-run | Codex 返回值里没有 `prompt` 等非白名单字段；日志接口对未登记为可显示的任务返回 403；仓库 fixture 不含真实标识 |
| 真实环境试跑 | not-run | 见规格第 7 节最后一条 |
| 交付检查 | not-run | `npm run check:pr` |

## S0 记录（2026-11-24）

Chris 先看过草稿，同意后才写入。仓库是公开的，下面只写做了什么，不写具体的任务标识和路径。

| 项 | 结果 | 核对结果 |
|---|---|---|
| `我/数据源.md` | verified | 新建。来源表登记 2 个来源：1 个副本型，成功标记含两个状态词；1 个查询型。定时任务表登记本机的 launchd 定时任务、Codex 自动化（含已暂停的）、Claude 定时任务（标为忽略）和 4 个常驻服务。有一个来历不明的 LaunchAgent 故意没登记，留给页面的「未登记」组去发现。 |
| 根导航 | verified | `README.md`「使用入口」加了一行，链接到数据源。 |
| 蓝图 | verified | v0.4 输入稿第 6 节加了「2026-11-23 补充决定：后台任务与数据源登记」，第 7 节相应一行改写。输入稿里本来就有别人未存档的改动，所以没有单独提交，留给晨间存档。 |
| 提交 | verified | PersonalOS 本地提交一笔，只包含 3 个文件：数据源、README、当月日志。提交说明为 `[我] 新建数据源登记表，根导航加入口`。收件箱和输入稿仍在工作区，没有被带进提交。 |
