# @bluemanta/knowledge

知识台的数据与规则（[ADR 0009](../../docs/decisions/0009-knowledge-desk.md)）。读取按 SalesOS Arsenal 体系组织的本机 Markdown 库，只读。

## 库

| id | 默认位置 | 说明 |
|---|---|---|
| `personal` | `~/Documents/Knowledge` | 个人库，按人生领域分类 |
| `arsenal` | `~/Documents/Shuyun/SalesOS/Arsenal` | SalesOS 的售前主题库，始终只读 |

`BLUEMANTA_KNOWLEDGE_HOME` 覆盖 home 目录。开发、测试和走查用 `fixtures/home`（全是虚构内容）：

```bash
BLUEMANTA_KNOWLEDGE_HOME=packages/knowledge/fixtures/home node packages/server/dist/cli.js start --data-dir /tmp/bm-try
```

## 库的结构

- 根目录：`README.md`、总索引 `<名称>_Index.md`、`_Inbox/`、`_Templates/`、编号分类目录 `NN_名称/`、`99_Archive/`。
- 总索引每个分类一节（`## 01_业务主题`），每节一张表，按表头名取列：Topic、Path、Aliases、Keywords、Typical Questions、Related Topics、Status、Last Reviewed、Notes（也认中文表头）。Path 里带库自身目录名（如 `Arsenal/01_…/会员体系/`）时，从第一个分类段开始取。
- 分类目录下的每个子目录是一个主题，默认四个文件：`README.md`、`Asset_Index.md`、`Topic_Knowledge.md`、`Topic_Log.md`；历史版本在主题自己的 `_Archive/`。
- 总索引登记了但目录不存在的主题、有目录但没登记的主题都会列出，分别标 `exists: false`、`registered: false`。`99_` 开头或名字含 Archive 的分类不进默认浏览。

## 接口

| 函数 | 作用 |
|---|---|
| `defaultKnowledgeEnv()` | 默认两个库 |
| `listLibraries(env)` | 每个库是否存在、总索引文件、主题数、收件箱文件数 |
| `readLibraryIndex(env, lib)` | 分类与主题（含路由信息、四个默认文件是否存在）和警告 |
| `readTopic(env, lib, topicPath)` | 主题四个文件的正文、其他文件（目录在前）、`_Archive` 里的文件 |
| `readLibraryFile(env, lib, path)` | Markdown 返回正文（超过 1 MB 截断），其他文件只返回元信息 |
| `listInbox(env, lib)` | `_Inbox` 里的文件（不含 README） |
| `walkLibrary(env, lib)` | 全部 Markdown 文件及所在区域，供建索引 |

路径只接受库内相对路径：拒绝 `..`、反斜杠、NUL、盘符，跟随软链后仍须在库根目录内。错误统一抛 `KnowledgeError`，`code` 为 `library_not_found`、`library_missing`、`invalid_path`、`not_found`、`not_a_topic`、`read_error`。

## 全文索引与搜索

`KnowledgeIndex` 是可删可重建的派生索引（ADR 0009 决定 4），默认放在 Desktop 数据目录的 `knowledge-index.sqlite`：

- Markdown 按标题切段（第一个 H1 作标题，超过 1500 字按段落再拆），每段一行；另存总索引里每个主题的名称、别名、关键词和典型问题。
- 灵感由调用方传入（`ideas` 回调返回 `IdeaDoc[]`），本包不依赖 core。`packages/cli` 的 `ideaDocsFrom(core)` 把在用的灵感转成这种格式（正文 + 与正文不同的原文 + 追记）。
- `refresh()` 按文件大小和修改时间增量更新，30 秒内最多一次；`search()`、`route()` 调用前自动刷新。结构版本不一致时整体重建。
- `node:sqlite` 在打开时用 `process.getBuiltinModule` 加载，避免顶层 import 在 ESM 链接阶段触发实验警告（与 core 相同）。

搜索规则：

1. 关键词按空白拆分。三个字以上走 FTS5（trigram，不分大小写），一两个字走子串匹配。
2. 先取全部命中；不足 `limit` 时补只命中部分关键词的；仍不足时把不带空格的长中文词拆成两字片段兜底（至少命中 60% 的片段）。
3. 排序：命中次数（标题 ×4、标题链 ×3、正文 ×1，均有上限）× 命中比例；命中主题路由时加分；归档 ×0.4、模板 ×0.2；补充和兜底结果分别 ×0.6、×0.4。
4. `route(query)` 先去掉口语词（`extractKeywords`），再和主题的名称、别名、关键词、典型问题比对，返回候选主题和 Arsenal Router Lite 的读取顺序。

`evaluate(index, cases)` 跑真实问题测试集：每题按原文和提取出的关键词各搜一次，合并后看前 5 条里有没有命中 `expect`（库内路径片段、灵感 id 或原文里的一句话）。

## 命令行

在仓库根目录（先 `npm run build`）：

```bash
npm run knowledge -- search 小红书 归因
npm run knowledge -- route 会员等级怎么设计
npm run knowledge -- stats
npm run knowledge -- eval            # 默认读 <数据目录>/knowledge-eval.json
```

选项：`--data-dir`、`--library <id>`（可重复）、`--limit`、`--no-ideas`、`--json`。测试集格式：

```json
[{ "question": "去年说的会员分层那个想法", "expect": ["会员分层"] }]
```
