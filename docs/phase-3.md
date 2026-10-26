# 阶段 3 计划：知识台

- 日期：2026-10-26
- 状态：已启动（2026-10-26 用户决定直接启动；核心决定见 [ADR 0009](decisions/0009-knowledge-desk.md)）
- 目标：用一个搜索框找回散在各处的想法和资料；个人知识按 Arsenal 体系长期沉淀，agent 能按路由读、帮着维护。
- 验收（vision 路线表）：随口问一个半年前的想法，能找回来。具体口径见第 6 节。
- 实现与验收：Claude Code（用户 2026-10-26 决定，暂不委派其他 agent）。

## 1. 摸底结论（2026-10-13、10-26）

| 来源 | 规模与现状 | 第一版怎么处理 |
|---|---|---|
| Desktop 灵感 | 正本在 Desktop，每天在增长 | 纳入索引 |
| `~/Documents/Shuyun/SalesOS/Arsenal` | 126 篇 Markdown + pptx 等素材；结构即本阶段要沿用的体系 | 只读挂载、纳入索引 |
| `~/Documents/Obsidian` | 26 篇，最后改动 2026-03 | 个人库主题里登记引用 |
| `Brainstorm`、`Career`、`SolutionLoop` | 发展规划、成长规划、SolutionLoop 商业计划与 GTM | 个人库主题里登记引用 |
| `~/Documents/Obsidian Vault` | 基本为空 | 不处理 |
| `~/Documents/ContentHub` | 已停用（见 vision 待决问题 1） | 不处理 |
| `~/Documents/Codex` | 3000 多篇，几乎都是 SalesOS 代码仓库副本 | 不纳入 |
| `~/Documents/Personal` | 家庭、身份等私密资料 | 第一版不纳入（用户未选） |
| Notion「工作资料」 | 量最大：职场资料、数云 Wiki、客户页、创业副业专题 | 第一版不纳入；真实问题测试显示缺口后再定（需要只读 integration 口令） |

## 2. 范围

- 要做：
  - 个人库 `~/Documents/Knowledge` 的初始结构、模板和种子主题，并登记已有资料的引用；
  - `packages/knowledge`：库配置、Arsenal 结构解析、FTS5 全文索引与搜索、真实问题测试脚本；
  - 本地服务 `/api/v1/knowledge*` 只读接口；
  - 网页模块「知识台」：主题浏览、全文搜索、收件箱（只读）、Markdown 阅读；
  - agent 工具（MCP 与 dsh 插件）：路由、搜索、读取；dsh 左侧栏入口；
  - 验收：10 个真实问题、Desktop 实测、文档收尾。
- 不做（留到后续）：写入（入 `_Inbox`、入库、更新主题知识）、语义检索、Notion、pptx/pdf 正文抽取、Personal。

## 3. 设计要点

- **库**：`{ id, name, root, writable }`。默认两个：`personal`（`~/Documents/Knowledge`，第一版也按只读处理）、`arsenal`（`~/Documents/Shuyun/SalesOS/Arsenal`，只读）。home 可由 `BLUEMANTA_KNOWLEDGE_HOME` 覆盖。库目录不存在时接口如实报告，不自动创建。
- **结构解析**：根目录的 `*_Index.md` 是总索引；其中每个分类一节、每节一张表（列：Topic、Path、Aliases、Keywords、Typical Questions、Related Topics、Status、Last Reviewed、Notes），按表头名取列，缺列时容错。分类目录形如 `NN_名称/`，其下每个子目录是一个主题；总索引里没登记、但磁盘上存在的主题也列出来并标「未登记」。`_Inbox`、`_Templates`、`99_Archive`、各主题的 `_Archive` 不进默认浏览，但可以搜到（搜索结果标出「归档」）。
- **索引**：Desktop 数据目录的 `knowledge-index.sqlite`，删掉可重建。Markdown 按标题切段，每段一行（库、相对路径、标题链、正文）；另存主题路由信息；灵感从 core 读入。增量刷新：按文件大小和修改时间判断，搜索前若距上次刷新超过 30 秒就刷新一次。
- **搜索**：每个关键词 ≥3 个字时走 FTS5 `MATCH`（trigram），1–2 个字时走子串匹配；多个关键词取交集。排序：命中次数与 bm25，标题和标题链命中加权，主题别名或关键词命中加权（Router Lite），归档降权。结果附库、路径、标题链、摘录（命中处前后共约 120 字）。
- **接口**：只接受库 id 和库内相对路径，服务端规范化后校验不越出库根目录、不跟随指向库外的软链；返回的绝对路径一律 `~` 缩写。

## 4. 任务

按顺序串行，每个任务一个分支、一个 PR；CI 通过并按验收口径自查后合并。

| # | 任务 | 依赖 | 要点 |
|---|---|---|---|
| KB0 | 计划与决定 | — | ADR 0009、本文件、[界面规格](specs/knowledge-ui.md)、vision 与 AGENTS 更新 |
| KB1 | `packages/knowledge` 结构解析 | KB0 | 库配置与环境变量；总索引表格解析；分类、主题、主题文件、收件箱列表；路径安全；虚构库 fixture 与单元测试 |
| KB2 | 全文索引与搜索 | KB1 | FTS5 索引、增量刷新、中文短词回退、路由加权、灵感纳入；`npm run knowledge -- search/eval` 命令 |
| KB3 | 本地服务接口 | KB2 | `/api/v1/knowledge/libraries`、`…/:lib/index`、`…/:lib/topics/*`、`…/:lib/files/*`、`/api/v1/knowledge/search`；接口测试覆盖 401、路径越界、库不存在 |
| KB4 | 网页「知识台」 | KB3 | 侧栏入口；主题、搜索、收件箱三页；Markdown 阅读（表格、相对链接）；嵌入模式；Playwright 走查进 CI |
| KB5 | agent 工具与 dsh 入口 | KB3 | MCP 与 dsh 插件各三个工具：`bluemanta_knowledge_route`、`_search`、`_read`；工具卡片「打开」进知识台；dsh 左侧栏「知识台」 |
| KB6 | 个人库初始化 | KB1 | 在 `~/Documents/Knowledge` 建结构、模板、种子主题，登记已有资料引用（写用户目录，用户已同意）；内容只在用户目录，不进仓库 |
| KB7 | 验收与收尾 | 全部 | 10 个真实问题测试；Desktop 实测；更新 vision、本文件、`local-update.md` |

种子主题（KB6，用户可随时改）：

| 分类 | 主题 | 先登记的引用 |
|---|---|---|
| 01_思考与判断 | 人生与成长、个人发展规划 | Obsidian「思考」；`Brainstorm`、`Career` 的规划文档 |
| 02_职业与业务 | 售前方法、SolutionLoop、副业探索、数云工作笔记 | Obsidian 客户研究 SOP；`SolutionLoop`；Obsidian 副业计划与快站；Obsidian「数云」 |
| 03_AI与技术 | AI 关注、AI 编程与工作台、自动化小工具 | Obsidian AI 关注清单、AICoding；本仓库；Obsidian 微博签到方案 |
| 04_内容创作 | 小红书与 X | Notion ContentHub（链接）；已停用的 `~/Documents/ContentHub` |
| 05_家庭与生活 | 家庭 | （空） |

## 5. 与其他进行中工作的关系

Skill 台 K3、K4（Codex）和 T20、T21（Cursor）也会改网页外壳、本地服务、MCP 和 dsh 插件。知识台的改动以新增文件为主，共享文件（`shell/modules.ts`、`App.tsx`、`server/src/app.ts`、MCP 与插件的工具注册）只加注册行；谁后合并谁负责变基，冲突由 Claude Code 处理。

## 6. 验收口径

1. **真实问题测试**：用户给 10 个想找回的东西（问题 + 记得的一句线索），存在本机 `~/Library/Application Support/BluemantaDesktop/knowledge-eval.json`，不进仓库。`npm run knowledge -- eval` 报告每题前 5 条里有没有命中。第一版目标 8/10；没命中的逐条记录原因（来源没纳入、说法不同、切段问题），作为下一步（接 Notion、语义检索）的依据。
2. **Desktop 实测**：左侧栏「知识台」能打开；在对话里问一个问题，agent 用路由和搜索工具找到并给出出处，工具卡片「打开」能在右侧栏看到原文。
3. **只读核对**：全程不写 Arsenal 和已有资料目录；个人库只有 KB6 新建的文件。

## 7. 风险

- 「半年前的想法」不少在 Notion，第一版召回会受限。对策：测试集如实记录未命中原因，再决定是否接 Notion。
- 自己实现、自己验收。对策：CI、真实问题测试由用户出题、Desktop 实测由用户操作。
- 与 Skill 台并行改共享文件。对策：见第 5 节。
