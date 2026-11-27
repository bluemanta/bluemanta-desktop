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
| 构建、类型、单测 | verified | `env -u BLUEMANTA_TODAY -u BLUEMANTA_KNOWLEDGE_HOME sh -c 'npm run build && npm run check && npm test'` 全部退出 0，单测合计 524 项（原 506 项）。新增：数据层 16 项（`personalos-inbox-resolve.test.ts`：today 带 `inboxHash` 和 `raw`；完成、不跟踪、手机追加行一起提交、日志有改动时不提交、400/404/409、并发、撤销及文件已变时的两条警告、撤销参数校验；不做了的 dry-run 差异、普通/等待/周期事项、400/409；没有 Git 时保留 CRLF 和新建当月日志），接口 2 项。原收件箱解析单测改为断言带 `raw`。 |
| 走查 | verified | `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough` 共 209 项，新增 5 条（截图、完成与撤销、`x` 和 `Delete` 键及速记框不受影响、收件箱冲突、不做了的取消/确认/`Delete`/周期说明）。两次全量运行各有 1 项偶发失败，都不在这次改动的页面：第一次是接入页「定时任务段」键盘焦点，单独跑 3 次都通过；第二次是迭代 3 已记录的 `personalos-refresh.spec.ts`「新提交在十秒内出现」高负载超时，单独跑通过。写入走查和今天页走查合跑 32 项全部通过。 |
| 截图 | verified | `packages/web/screenshots/personalos-inbox-hover-{1440,720}-{light,dark}.png`、`personalos-drop-{1440,720}-{light,dark}.png`、`personalos-inbox-undo-1440-light.png`，不提交。抽看撤销提示条 1440 浅色、不做了确认框 720 深色、收件箱悬停 1440 浅色：按钮、提示条、确认框和差异都清楚，720 宽没有横向溢出。撤销提示条只截了 1440 浅色一张（每截一张都要真写一次再撤销），与规格写的四种组合有出入。 |
| 写入只碰允许的文件 | verified | 单测断言：收件箱操作只改 `收件箱.md` 和当月日志、提交只含这两个文件，不改任何 `状态.md`；不做了只改该领域 `状态.md` 和当月日志；别的未存档文件（`我/纸船.md`、`领域/写作/纸样.md`）提交后仍是未存档状态。 |
| D0 PersonalOS 协议 | verified | 2026-11-28 Chris 同意后写入，PersonalOS 提交 `25f5139`。`git show --stat 25f5139` 只含 `协议/更新.md`（+2 行）和 `日志/2026-11.md`（+1 行）；提交后 `git status --short` 仍是开工前就有的收件箱、蓝图输入稿、`tools/`、`协议/微信晨检.md`，没被带进去 |
| D4 真实试写 | verified | 2026-11-28 00:5x Chris 同意后，用本分支起临时服务（`cli.js start --data-dir <临时> --port 4391`，不设 `BLUEMANTA_KNOWLEDGE_HOME`/`BLUEMANTA_TODAY`）连真实 PersonalOS，走接口试写。只用测试条目：经速记接口加两条「测试：…（可删）」收件箱条目；在「数云工作」手动加一件测试待办并单独提交（`690f203`）。结果：完成 `b9e2cdb`、不跟踪 `9dc2d05`、撤销 `96dabcc`（条目回到原第 11 行，日志行删除，无警告）、再次不跟踪做清理 `ef7f2f2`、不做了 `dd26187`（先预览再写，预览与实际改动一致）。`git show --numstat` 逐笔核对：收件箱四笔只含 `收件箱.md` 和 `日志/2026-11.md`，不做了只含 `领域/数云工作/状态.md` 和日志。`收件箱.md` 原有 5 行微信扫描写入、未提交的条目随第一笔提交一起入库（ADR 0015 的收件箱例外，符合设计）；试写后收件箱剩原有 6 条、无测试行，`/today` 无警告。`git status --short` 前后都只有别的会话的蓝图输入稿、`tools/`、`协议/微信晨检.md`。副作用：「数云工作」更新于从 11-27 变成 11-28（「不做了」按协议改更新于）。临时服务已停、临时目录已删 |
| 交付检查 | 见 PR 评论 | `npm run check:pr`，每次推送后运行 |

## 和规格的出入

- 按钮的无障碍名称带上事项文本（「完成：…」「不跟踪：…」「不做了：…」），和已有的完成复选框一致；规格 16.4 写的是只有动作名。悬停提示仍是「完成」「不跟踪」「不做了」。
- 今天页收件箱的说明行原来写「晨间简报时由 agent 分拣」，自动分拣上线后已不准确，改为「每天 07:30 自动分拣；顺手做完的点 ✓，不用跟的点 ✕」，规格第 3 节同步改了。

## 附录：`协议/更新.md` 第 2 步加的两条

加在「普通事项完成后……」那一条后面：

```markdown
   - 决定不做的事项：从“未结事项”删掉这一行，日志写 `- 日期 [领域] 不做了：事项文本`（去掉标签）。周期性事项这样删掉后就不再出现；只想跳过一次，按完成处理，把 `@due` 改成下一次。
   - 收件箱里顺手做完、或不用跟踪的条目：直接从 `收件箱.md` 删掉，日志写 `- 日期 完成：内容（收件箱 MM-DD）` 或 `- 日期 不跟踪：内容（收件箱 MM-DD）`，不写领域，不改任何 `状态.md`。
```
