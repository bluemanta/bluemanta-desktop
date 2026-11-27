# PersonalOS 收件箱自动分拣 · 任务与试运行记录

- 决定：[ADR 0014](../decisions/0014-personalos-auto-sort.md)
- 执行方：Codex 定时任务；规则正本在 PersonalOS 的 `协议/自动分拣.md`
- 本仓库只放这份记录和 ADR，不写产品代码。PersonalOS 和 Codex 配置的改动都在仓库外，**每一步先给 Chris 看，同意后再写**（AGENTS.md 硬规则 7）。

## 步骤

| 编号 | 内容 | 改哪里 | 状态 |
|---|---|---|---|
| A1 | 新建 `协议/自动分拣.md`（草稿见附录 1） | PersonalOS | 已完成：PersonalOS 提交 `e79f477` |
| A2 | 改 `协议/晨间简报.md` 第 2 步（附录 2） | PersonalOS | 已完成：同 `e79f477` |
| A3 | 改 `我/数据源.md` 说明段；「定时任务」表加一行（附录 3） | PersonalOS | 说明段已改（同 `e79f477`）；表格行等 A5 建好任务后再加 |
| A4 | Codex 规则加两条长期允许（附录 4） | `~/.codex/rules/default.rules` | 已完成：原文件备份为 `default.rules.bak-2026-11-27`；`codex execpolicy check` 核对见下 |
| A5 | 在 Codex 应用里新建定时任务（附录 5） | Codex 应用 | Chris 操作，或同意后由 Claude Code 协助 |
| A6 | 手动触发一次，按「上线检查」核对 | — | 未开始 |
| A7 | 试运行两周，到 2026-12-11，每天记一行 | 本文件 | 未开始 |
| A8 | 蓝图 v0.4 写进这个例外（等改蓝图的那个会话收尾） | PersonalOS | 未开始 |

A1–A3 按 PersonalOS 的 `协议/更新.md` 记日志、提交。开工前先看 PersonalOS 的 `git status`，别人没存档的改动（比如蓝图输入稿）不碰。

## 已完成的核对（A1–A4）

| 项 | 结果 | 命令与结果 |
|---|---|---|
| PersonalOS 只提交本次四个文件 | verified | `git -C ~/Documents/PersonalOS show --stat e79f477`：`协议/自动分拣.md`（新）、`协议/晨间简报.md`、`我/数据源.md`、`日志/2026-11.md`。提交后 `git status --short` 仍是开工前就有的 `收件箱.md` 和蓝图输入稿两处改动，没被带进去。 |
| Codex 规则只放行两条 | verified | `codex execpolicy check --rules ~/.codex/rules/default.rules …`：PersonalOS 的 `add`、`commit` 返回 `allow`；PersonalOS 的 `reset --hard`、`/tmp` 下的 `commit` 都没有匹配的规则。 |
| 规则在无人值守时能否免批准执行 | not-run | 等 A6 试跑 |

## 上线检查（A6）

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 有条目时：明确的条目进了对应领域的「未结事项」，相对日期按条目日期换算 | not-run | |
| 拿不准的条目留在收件箱 | not-run | |
| 「更新于」改成当天，日志每条一行 | not-run | |
| 一次提交，说明是 `[分拣] 自动分拣 N 条，留下 M 条`，只含改过的文件 | not-run | `git -C ~/Documents/PersonalOS show --stat HEAD` |
| 别人没提交的改动没被带进提交 | not-run | `git status --short` 前后对比 |
| Codex 没弹出批准请求就完成了提交 | not-run | |
| 收件箱为空时不改文件、不提交 | not-run | |
| 「接入」页能看到这个任务和最近一次运行 | not-run | |
| Mac 睡眠或 Codex 应用没开时的表现 | not-run | |

## 试运行记录（A7）

只记数字和错误类型，不写事项内容。

| 日期 | 分拣 | 留下 | 分错 | 备注 |
|---|---|---|---|---|

---

## 附录 1：`协议/自动分拣.md` 草稿

```markdown
# 自动分拣

每天 07:00 由 Codex 定时任务执行，也可以由 Chris 手动触发。只做收件箱分拣，不做晨间简报的其他步骤。决定见 bluemanta Desktop ADR 0014。

## 能改什么

- 读：`收件箱.md`、`README.md` 的路由表、各领域的 `状态.md`。
- 写：各领域（含「我」）`状态.md` 的「未结事项」「近期变化」两节和顶部「更新于」；`日志/当月.md` 末尾追加；从 `收件箱.md` 删除已分拣的条目。
- 其他文件和其他节一律不改。不新建领域、目录或文件（当月日志不存在时除外）。

## 步骤

1. **读收件箱。** 文件头部的说明文字不是条目。没有条目就结束，不改任何文件、不提交。
2. **记下开工前的状态。** 运行 `git -C /Users/apple/Documents/PersonalOS status --short`，记下哪些文件已经有没提交的改动。
3. **逐条判断。** 对每一条：
   - 按路由表判断领域。只可能是一个领域时才继续。
   - 判断类型：要做的事进「未结事项」，已经发生的事进「近期变化」。
   - 换算日期：相对时间按**这条记下的日期**换算（11-22 记的「明早」是 11-23）。有明确日期的加 `@due(年-月-日)`；在等别人的加 `@wait(谁)`。换算结果早于今天也照写。
   - 待办文本保留原意，去掉已经换算成日期的时间词。
   - 目标领域「未结事项」里已经有同一件事：不再写，只从收件箱删掉，日志注明「已存在」。
   - 以下情况**留在收件箱，原样不动**：领域可能有两个以上；看不出是待办还是变化；时间说法换算不出确定日期。
4. **写回。** 写之前重新读目标文件。每个改过的 `状态.md` 把「更新于」改成今天。每搬一条，在当月日志追加 `- 今天 [领域] 分拣：事项文本（收件箱 MM-DD）`。最后从 `收件箱.md` 删除已分拣的条目，留下的条目不动。
5. **提交。** 只暂存这次改过的文件，一次提交：
   `git -C /Users/apple/Documents/PersonalOS add <改过的文件>`
   `git -C /Users/apple/Documents/PersonalOS commit -m "[分拣] 自动分拣 N 条，留下 M 条"`
   - `收件箱.md` 里别人追加的、还没提交的行照常一起提交。
   - 第 2 步记下的文件里，如果有这次写过的 `状态.md` 或当月日志，就照写但不提交，日志末尾注明「自动分拣未提交：文件里有别的未存档改动」，由晨间存档带上。
   - 提交只用上面两条命令的写法。不 push，不开分支，不 reset，不改写历史。
6. **结束。** 最后输出一段摘要：分拣几条、各去了哪个领域、留下几条及原因。不对外发消息。
```

## 附录 2：`协议/晨间简报.md` 第 2 步改为

```markdown
2. **清收件箱。** 每天 07:00 的自动分拣（`协议/自动分拣.md`）会先处理一遍。读当天日志里的「分拣：」行，在简报里列出今早分拣了哪些、各去了哪个领域，请 Chris 看一眼有没有分错。再读 `收件箱.md`，对留下的条目逐条问 Chris 或按 `协议/更新.md` 写回，删除已分拣的条目。自动分拣当天没跑的话，按原来的做法全部分拣。
```

## 附录 3：`我/数据源.md`

说明段第二句改为：

```markdown
后台任务只做数据副本刷新：机械执行、不调用模型、不改 PersonalOS 文件，失败时本机通知，运行日志只写脱敏结果。唯一的例外是每天早上的收件箱自动分拣（`协议/自动分拣.md`），它按协议改收件箱、`状态.md` 的两节和日志。除此之外，不建让 agent 定时改写 `状态.md`、日志或收件箱的任务。
```

「定时任务」表加一行（标识在 A5 建好任务后填实际的 id）：

```markdown
| 收件箱自动分拣 | `codex:<id>` | 每天 7:00 按协议分拣收件箱 | — | 否 |
```

## 附录 4：Codex 规则

在 `~/.codex/rules/default.rules` 末尾加两行：

```text
prefix_rule(pattern=["git", "-C", "/Users/apple/Documents/PersonalOS", "add"], decision="allow")
prefix_rule(pattern=["git", "-C", "/Users/apple/Documents/PersonalOS", "commit"], decision="allow")
```

只放开 PersonalOS 里的 `add` 和 `commit`，别的目录、别的 Git 命令不受影响。这两条规则能不能让 Codex 在沙箱外直接执行、不弹批准请求，A6 试跑时核实。

## 附录 5：Codex 定时任务

- 名称：PersonalOS｜收件箱自动分拣
- 类型：定时（cron），每天 07:00
- 执行环境：本机；工作目录 `/Users/apple/Documents/PersonalOS`
- 提示词：

```text
按 /Users/apple/Documents/PersonalOS/协议/自动分拣.md 执行一次收件箱分拣。只做这份协议里的事，不做晨间简报的其他步骤，不改协议允许范围以外的文件。Git 提交只用协议里写的 `git -C /Users/apple/Documents/PersonalOS add` 和 `commit` 两条命令。最后输出协议第 6 步要求的摘要。
```
