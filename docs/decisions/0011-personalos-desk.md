# ADR 0011：知识台改为 PersonalOS 的可视化界面

- 状态：已采纳
- 日期：2026-11-21
- 补充：[ADR 0009](0009-knowledge-desk.md) 的决定 2（个人库部分）、决定 3、决定 10；[vision.md](../vision.md) 正本归属表「长期知识（个人）」一行。ADR 0009 的其余决定（正本在文件、Desktop 只建派生索引、本机模块接口可带库内相对路径、同一网页应用）继续有效。

## 背景

2026-11-12 起，Chris 用 agent 在 `~/Documents/PersonalOS/` 搭了个人上下文中枢 PersonalOS（蓝图 v0.3，阶段 1–3 已于 2026-11-20 验收）：按 9 个生活领域组织的 Markdown 目录，每个领域有一份 `状态.md`（现状、未结事项、近期变化、去哪查），另有路由表、收件箱、按月日志、资料登记和三份协议，本地 Git 记录每次改动。PersonalOS 的 `AGENTS.md` 写明它已是个人知识的正本，旧 `~/Documents/Knowledge` 原样保留、等知识台改造后归档。

知识台第一版按 Arsenal 的主题库结构做（总索引、编号分类、每个主题四个文件），与 PersonalOS 不是一种东西：PersonalOS 主要装的是状态和待办，知识只是其中一块。KB7（真实问题测试、Desktop 实测）也还没做。

2026-11-21 Chris 决定把知识台升级为 PersonalOS 的配套可视化界面，开发交给 Codex。方案和决策题见 [personalos-desk-plan.md](../personalos-desk-plan.md)，Chris 同意全部建议答案。

## 决定

1. **知识台改为 PersonalOS 看板。** 页面为「今天 / 领域 / 资料 / 动态 / 搜索」，先回答今天有什么事、各领域现在怎么样、最近改了什么，再回答东西在哪。界面规格见 [specs/personalos-ui.md](../specs/personalos-ui.md)。
2. **PersonalOS 取代个人库。** 知识台读 `~/Documents/PersonalOS`，不再读 `~/Documents/Knowledge`。旧库的归档由 Chris 在切换完成后自己做（移动文件需单独确认）。
3. **PersonalOS 的格式由它自己的蓝图定义，Desktop 去适配。** 解析要宽容：认得的结构化展示，认不出的原样渲染 Markdown，不报错、不丢内容。格式要变时先改 PersonalOS 蓝图，再改解析。
4. **先只读，派生索引照旧。** 正本是 PersonalOS 的文件，Desktop 不导入 SQLite、不双写；全文索引仍在 `knowledge-index.sqlite`，可删可重建。
5. **写入只做两类，且照 PersonalOS 协议执行**（迭代 3，排在只读看板验收之后）：速记追加到 `收件箱.md`；勾选完成待办（`@every` 事项顺延）。写前预览、用户确认；勾选待办要更新「更新于」、追加日志、本地 Git 提交，效果与 agent 按 `协议/更新.md` 做的一致。现状、近期变化、知识、事项文件、收件箱分拣需要判断，继续由 agent 在会话里做。
6. **个人待办的正本是 PersonalOS。** 各领域 `状态.md` 的「未结事项」就是个人待办，Desktop core 的 Task 对象不用于个人待办。仓库里的任务台草案（`docs/task-desk-plan.md`，2026-10-22）如果继续，只管开发 issue。
7. **Arsenal 保留为只读库**，参与搜索，可在「资料」页浏览主题。
8. **模块名仍叫「知识台」**，模块 id、路径前缀 `/knowledge` 不变。以后要改名只改显示名。
9. **实现者改为 Codex，说明书放在仓库本地。** 覆盖 ADR 0009 决定 10。本轮不经 Linear：任务说明书写在 `docs/tasks/personalos-*.md`，Codex 在本机 worktree `~/Developer/bm-pos`（分支 `codex/personalos-desk`）实现并做本地提交；Claude Code 验收。是否推送、开 PR、合并由 Chris 另行决定。
10. **KB7 由迭代 4 的验收代替。** 真实问题测试改用 PersonalOS 重做。

## 后果

- 好处：
  - 打开网页就能看到晨间简报的内容和各领域的新鲜度，不用开会话；
  - agent 维护、人看结果，分工和 PersonalOS 的设计一致；
  - 个人待办只有一份正本。
- 代价：
  - PersonalOS 由 agent 维护，写法会漂移，解析要跟着维护；
  - 网页写入和会话写入可能同时改同一文件，靠写前比对哈希兜底；
  - 迭代 1 期间 agent 工具仍指向旧个人库，到迭代 4 才切换。
