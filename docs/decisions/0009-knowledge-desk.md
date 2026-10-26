# ADR 0009：知识台——按 Arsenal 体系组织的本机 Markdown 库，Desktop 只建索引

- 状态：已采纳
- 日期：2026-10-26
- 补充：[ADR 0004](0004-dev-workflow.md) 决定 1（实现者）；vision.md 2026-10-10「知识是贯穿所有领域的卡片层」；[ADR 0005](0005-web-app-dsh-entry.md) 决定 4 第 2 条（接口里不出现本机路径）。这三处的其余内容不变。

## 背景

路线图的阶段 3 原计划是「知识卡片、检索、导入本地 ContentHub 和 Obsidian」，验收标准是「随口问一个半年前的想法，能找回来」。2026-10-13 和 10-26 的摸底推翻了原计划的前提：

- 本地 ContentHub 已停用，Obsidian 只有 26 篇笔记，撑不起一个知识库；
- 用户的知识实际分散在 Notion「工作资料」、Desktop 灵感和若干本地文件夹里；
- 用户在 SalesOS 里已有一套成型的知识组织体系 `~/Documents/Shuyun/SalesOS/Arsenal`：按主题分目录，每个主题固定 `README.md`、`Asset_Index.md`、`Topic_Knowledge.md`、`Topic_Log.md` 四个文件；新材料先进 `_Inbox/`；总索引 `Arsenal_Index.md` 做轻量路由，agent 按固定顺序读文件，不全盘扫描；主题知识由 agent 维护，写入前先给计划、等用户确认。

2026-10-26 用户决定：照 Arsenal 体系重新规划本机知识库，资料不搬家、统一搜索。

## 决定

1. **知识的正本是本机 Markdown 文件夹（「库」），结构沿用 Arsenal。** 根目录有 `README.md`、总索引 `<名称>_Index.md`、`_Inbox/`、`_Templates/`、编号分类目录（`01_…`）和 `99_Archive/`；每个主题目录有上述四个文件，当前材料平铺在主题根部，历史版本进主题自己的 `_Archive/`。Desktop 不把这些文件导入 SQLite，不双写。
2. **两个库：**
   - **个人库** `~/Documents/Knowledge`（新建，走 iCloud）。分类按人生领域：`01_思考与判断`、`02_职业与业务`、`03_AI与技术`、`04_内容创作`、`05_家庭与生活`、`99_Archive`。先建种子主题，边用边加。
   - **Arsenal**（SalesOS 的工作库）只读挂载：知识台能浏览、搜索，agent 能按路由读；写入仍由 SalesOS 的主题专家线程按它自己的规则做。
3. **已有资料先登记引用，不一次性迁移。** Obsidian、`Brainstorm`、`Career`、`SolutionLoop` 等的文件原地不动，个人库主题的 `Asset_Index.md` 写原文件路径；以后经 `_Inbox/` 逐步入库。入库即搬家（原文件移入个人库），不复制，保证一份正本。
4. **Desktop 只建派生索引。** 全文索引放在 Desktop 数据目录的 `knowledge-index.sqlite`，用 SQLite FTS5（trigram 分词，中文可用；一两个字的词回退到子串匹配），可以随时删掉重建，不算正本。索引范围：各库的 Markdown 文件（按标题切段）、主题路由信息（别名、关键词）、Desktop 灵感。其他文件（pptx、pdf 等）第一版只索引文件名和资产索引里的登记信息。
5. **第一版只做本机全文检索，不做语义检索。** 零依赖、零费用、数据不出本机。在对话里提问时，由 agent 换几种说法多搜几次、并按总索引的别名路由来弥补语义差距。语义检索（本机模型或云端 embedding）等真实问题测试集跑出召回不足后再评估。
6. **新增包 `packages/knowledge`**：库配置、Arsenal 结构解析、索引与搜索。不进 core（core 的正本是 SQLite，这个模块的正本是文件），与 `packages/skills` 同样的位置。路径全部可注入，本地服务认环境变量 `BLUEMANTA_KNOWLEDGE_HOME`（覆盖 home 目录），开发、测试和走查指向虚构库。
7. **本机模块，接口可以带路径（与 ADR 0008 决定 4 相同的例外）。** 接口返回库内相对路径，库根目录只用于显示且 home 缩写成 `~`；接口只接受库 id 和库内相对路径，服务端校验不越出库根目录。将来迁云时这个模块不迁。
8. **写入放第二步，且必须预览、确认。** 第一版只读（索引是派生数据，不算写入）。之后的写入（新材料入 `_Inbox`、入库、更新主题知识）照 Arsenal 的 `topic_intake` 规则：agent 先给写入计划，用户在页面上确认后才写；只写个人库，不写 Arsenal。
9. **界面与灵感台、Skill 台同一个网页应用**（模块「知识台」），同一套外壳、tokens.css、本地服务和口令；agent 工具同时提供给 MCP（Claude Code、Codex）和 dsh 插件。界面规格见 [docs/specs/knowledge-ui.md](../specs/knowledge-ui.md)。
10. **阶段 3 由 Claude Code 自己规划和开发**，暂不委派其他 agent（用户 2026-10-26 决定）。流程照旧：一个任务一个分支一个 PR，CI 通过、按验收口径自查（verified / failed / not-run）后再合并；用户的 10 个真实问题和 Desktop 试用是独立于实现者的验收。

## 后果

- 好处：
  - 不产生第二份知识；文件在 iCloud 里，Desktop 坏了也不丢；
  - 用户熟悉的 Arsenal 用法（总索引、主题专家、先计划后写入）直接延续到个人知识；
  - agent 不用全盘扫描，先路由再读，省上下文。
- 代价：
  - 「半年前的想法」有相当一部分在 Notion，第一版不纳入，召回会受限；真实问题测试会暴露缺口，届时再决定是否接 Notion（需要用户建只读 integration 口令）；
  - 全文检索对换了说法的问题召回弱，要靠 agent 多搜和别名路由；
  - 实现者同时是自查者，独立性靠 CI、真实问题测试集和用户试用保证。
- vision.md「知识是贯穿所有领域的卡片层」改为：灵感仍是 Desktop 里的卡片；长期知识以 Markdown 库为正本，Desktop 只索引。
