# PersonalOS 看板 · 迭代 4 记录（P9：agent 工具改用 PersonalOS）

- 实现与自查：Claude Code，2026-11-22 至 2026-11-23（[ADR 0012](../decisions/0012-personalos-desk-claude-implements.md)）
- 规则：[规格第 14 节](../specs/personalos-ui.md)
- 分支 `claude/personalos-iteration-4`，PR #37

## 做了什么

- 默认知识库配置只剩 `personalos` 和 `arsenal`，旧的个人库 `~/Documents/Knowledge` 不再读取，文件本身没有动。工具参数 `library=personal` 被拒绝，并提示改用 `personalos`。
- `bluemanta_knowledge_route`：PersonalOS 领域按领域名、别名、典型问题命中，返回读取顺序 `状态.md → 资料登记.md`。
- `bluemanta_knowledge_search`：覆盖 PersonalOS、Arsenal 和灵感；PersonalOS 的结果带领域。
- `bluemanta_knowledge_read`：读领域目录时返回 `状态.md` 和该领域的文件清单；隐藏路径和库外路径拒绝。
- 新增 `bluemanta_personalos_today`：分组与今天页相同，按晨间简报顺序输出，每条带文件和行号，末尾说明日历、Linear、SalesOS 不在其中。
- 工具说明重写：写明两个库各管什么；工具只读，要改 PersonalOS 时按它自己的 `AGENTS.md` 和 `协议/更新.md` 直接改文件。

## 验收项

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 构建、类型、单测 | verified | fixture 环境下运行 `npm run build && npm run check && npm test`，退出 0，合计 458 项。其中包括：MCP 服务以独立进程启动、dsh 插件加载，两侧都注册四个知识工具，`personal` 被拒绝。 |
| 全量走查 | verified | `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough`：186 passed。 |
| 交付检查 | verified | `npm run check:pr`。 |
| 真实问题测试 | verified，有一处改进项 | 2026-11-23，Chris 同意，只读。见下一节。 |

## 真实问题测试（2026-11-23）

做法：用本分支的构建，直接调用 MCP 和 dsh 共用的工具函数（`personalOsToday`、`routeKnowledge`、`searchKnowledge`、`readKnowledge`）。没有设 `BLUEMANTA_KNOWLEDGE_HOME`、`BLUEMANTA_TODAY`，所以读的是真实目录。索引建在临时目录，测完删除。下面不写事项、资料和领域的原文。

| # | 问题类型 | 调用顺序 | 结果 |
|---|---|---|---|
| 1 | 今天要做什么 | today | 答到点上。一次调用拿到：未来 7 天 1 件、更晚 1 件、收件箱 2 条，每条带文件和行号。独立核对：各领域 `状态.md` 里未完成事项 2 条（截止日分别在 7 天内和 7 天后），收件箱 2 行，一致。 |
| 2 | 某领域现状（用口语说法问，没说领域名） | route → read 领域目录 | 答到点上。route 只给出 1 个候选，就是对的领域，命中的是别名和典型问题。read 返回该领域的 `状态.md` 全文和文件清单，现状、未结事项、去哪查都在里面。 |
| 3 | 某资料在哪 | search | 答到点上。两次提问（问商业计划、问某份 SOP），第 1 条都是对应领域的 `资料登记.md`，摘录里就有资料的路径。 |
| 4 | 按别名找领域 | route | 答到点上。用一个项目别名、一个典型问题各问一次，都只返回 1 个候选，是对的领域。 |
| 5 | 找以前的记录（上次什么时候完成某件周期事项） | search → read 日志 | 部分答到。昨天的完成记录在当月日志里，search 第 2 条就是包含它的那一段。但问法比较笼统时（两个关键词），摘录落在这一段前面的别的位置，标题也是该段所属的旧小节标题，只看搜索结果看不出答案；再 read 日志就能找到。换成事项的原名去搜，摘录就正好是那一行。 |

**改进项（不阻塞合并）**：PersonalOS 的日志是在当月文件末尾逐行追加 `- 日期 [领域] …`，这些行落在最后一个 `##` 小节下面。搜索按小节切段，所以新追加的行会和一个无关的旧小节合成一段，摘录只取第一个关键词的第一次出现。可以改成：日志文件按日期行切段，或者摘录优先选关键词最集中的位置。

**前后快照**：

- HEAD 相同，未存档改动都是 2 个，文件数相同，没有遗留 `.bm-write`。
- 包括 `.gitdata.nosync` 在内的所有文件，SHA-256 汇总值前后**不同**。原因：唯一变动的文件是 Git 自己的缓存 `.gitdata.nosync/index`，修改时间是 07:06:09，正好在测完、拍后快照的时候。
- 测试窗口内没有其他文件被修改；暂存区内容仍与 HEAD 相同。
- 这次调用的四个工具都不启动 git：代码里只有 `git.ts` 和 `write.ts` 会启动子进程，这次都没有用到。带 `GIT_OPTIONAL_LOCKS=0` 运行 `git status` 也不会改这个文件（已实测）。
- 是谁刷新了缓存没有查清。内容文件没有被改。

## 补充：日志的搜索切段（2026-11-23）

针对上面第 5 问的改进项，按[规格 14.5](../specs/personalos-ui.md) 改了索引：日志里每条 `- YYYY-MM-DD …` 条目单独成一段，标题是日期和标签，领域按标签；小节正文去掉条目后照旧按标题切段。索引版本号从 2 升到 3，已有索引在下次打开时自动重建。

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 单测 | verified | 不设本机环境变量（同 CI）运行 `npm run build && npm run check && npm test`，退出 0，合计 462 项。新增 4 项（`search.test.ts`「PersonalOS 日志切段」）：小节后追加的条目、夹在小节列表中间的条目、非领域标签、无标签条目、小节正文不含条目文字、其他文件切段不变。 |
| 全量走查 | verified | `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough`：186 passed。 |
| 真实复测 | verified | 只读，同上一节的做法。用原来那个笼统的两词问法再搜：昨天的完成记录作为单独一条出现在第 3 条，标题是日期和领域，摘录就是那一行，不必再读日志。加上「上次」这个词后，它不在前 3 条（协议文件里也有「上次」，排到了前面）。试跑前后 HEAD、`status` 和包括 `.gitdata.nosync` 在内所有文件的 SHA-256 逐个一致。 |
