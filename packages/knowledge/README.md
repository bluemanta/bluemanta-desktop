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
