# PersonalOS 看板 · 收件箱完成与不跟踪、待办不做了 说明书

- 实现与自查：Claude Code（做法同 [ADR 0012](../decisions/0012-personalos-desk-claude-implements.md)）
- 决定：[ADR 0015](../decisions/0015-personalos-inbox-resolve-and-drop.md)；规则：[specs/personalos-ui.md](../specs/personalos-ui.md) 第 16 节
- 来由：2026-11-27 Chris 想把收件箱里顺手做掉的、不想跟踪的条目当场清掉。自动分拣上线后，多数条目早上就进了领域，所以领域待办也要能「不做了」。
- 分支：文档合并后，从 `main` 新开 `claude/personalos-inbox-resolve`，在本机 worktree `~/Developer/bm-pos` 开发；开 PR 按 AGENTS.md 的 2026-10-24 授权执行，合并由 Chris 决定

## 任务

| 编号 | 内容 | 允许修改的路径 |
|---|---|---|
| D0 | PersonalOS 侧：`协议/更新.md` 第 2 步加两条写法（草稿见附录）。**先给 Chris 看，同意后再写**；按 PersonalOS 协议写日志并提交，别人未存档的改动不碰 | `~/Documents/PersonalOS/协议/更新.md`、当月日志 |
| D1 | 数据层：收件箱完成 / 不跟踪、撤销、待办不做了；今天页结果加 `inboxHash` 和条目 `raw`；单测 | `packages/knowledge/src/personalos/**`、`packages/knowledge/test/**`、`packages/knowledge/fixtures/**` |
| D2 | 接口：`POST /personalos/inbox/resolve`、`/inbox/undo`、`/todos/drop`；接口测试 | `packages/server/src/**`、`packages/server/test/**` |
| D3 | 网页：收件箱行按钮与快捷键、撤销提示条（10 秒）、待办「不做了」与确认框；走查和截图 | `packages/web/src/**`、`packages/web/e2e/**` |
| D4 | 真实试写（需 Chris 同意）：在真实 PersonalOS 上各做一次完成、不跟踪、撤销、不做了，用 `git log` 和 `git status` 核对；写验收记录 | 本文件 |

每个任务一笔提交。本地跑测试用 `env -u BLUEMANTA_TODAY -u BLUEMANTA_KNOWLEDGE_HOME` 模拟 CI。

## 验收项

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 构建、类型、单测 | not-run | |
| 走查 | not-run | |
| 截图 | not-run | |
| 写入只碰允许的文件 | not-run | |
| D0 PersonalOS 协议 | not-run | |
| D4 真实试写 | not-run | |
| 交付检查 | not-run | |

## 附录：`协议/更新.md` 第 2 步加的两条

加在「普通事项完成后……」那一条后面：

```markdown
   - 决定不做的事项：从“未结事项”删掉这一行，日志写 `- 日期 [领域] 不做了：事项文本`（去掉标签）。周期性事项这样删掉后就不再出现；只想跳过一次，按完成处理，把 `@due` 改成下一次。
   - 收件箱里顺手做完、或不用跟踪的条目：直接从 `收件箱.md` 删掉，日志写 `- 日期 完成：内容（收件箱 MM-DD）` 或 `- 日期 不跟踪：内容（收件箱 MM-DD）`，不写领域，不改任何 `状态.md`。
```
