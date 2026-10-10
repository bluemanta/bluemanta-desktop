# @bluemanta/core

bluemanta Desktop 的数据层。对象、存储和写入规则都在这里；dsh 插件只负责显示，不写业务规则。

运行时要求 Node.js ≥ 24。存储使用内置的 `node:sqlite`（`DatabaseSync`），没有原生扩展。这个模块在打开数据库时用 `process.getBuiltinModule('node:sqlite')` 按需加载，避免顶层 `import` 在静默过滤器生效前打印 ExperimentalWarning。

## 脚本

在仓库根目录：

```bash
npm ci
npm run check   # 类型检查
npm test        # vitest
npm run build   # 输出 packages/core/dist
```

冒烟脚本要在构建之后执行，数据目录用临时目录，不要指向真实用户数据：

```bash
node packages/core/scripts/smoke.mjs <数据目录>
```

## 打开数据库

```ts
import { openCore, defaultDataDir } from '@bluemanta/core';

const core = openCore({ dataDir: defaultDataDir() });
// 测试和脚本应传入自己的目录，而不是省略 dataDir。
core.close();
```

默认数据目录是 `~/Library/Application Support/BluemantaDesktop/`。数据库文件是该目录下的 `store.sqlite`。

`openCore` 会建表或迁移：

- 空库直接建表，并把 schema 版本记为当前代码版本。
- 库版本低于代码时，先把数据库文件复制到 `<数据目录>/backups/<时间戳>/store.sqlite`，再迁移。
- 库版本高于代码时抛出 `UnsupportedSchemaError`（`code: 'unsupported_schema_version'`），不改文件。

当前 schema 版本是 `SCHEMA_VERSION`（2）。版本 2 给已有卡片补上 `titleOrigin: 'user'`，不改标题。

## 类型

每条 Project、Task、Card、Link 都有记录信封：`id`、`module`、`rev`、`createdAt`、`updatedAt`、`createdBy`、`updatedBy`、`deletedAt`。`id` 形如 `project_<ULID>`。

| 类型 | 说明 |
|---|---|
| Area | 领域配置。默认 `work` / `content` / `product` / `growth` / `family`，存在 `areas` 表里 |
| Project | `title`、`area`、`status`（active / paused / done / archived）、`background`、`positioning`、`pinned`、`locations` |
| Task | `title`、`status`（todo / doing / done / canceled）、`blocked`、`blockedReason`、`projectId`、`due`、`priority`、`origin`、`notes`、`ext` |
| Card | `cardType` 为 `idea` / `scene` / `note`。卡片带 `titleOrigin`（`user` / `fallback`）。只有 idea 有 `fields`（`category`、`categorySource`、`captureGroupId`） |
| Attachment | 只有元数据。可以按 id 读取、按回收站筛选，本任务没有写入命令 |
| Link | `from`、`to`、`rel`，并带完整信封 |

追记存在卡片的 JSON 列里，形状是 `{ id, body, createdAt }`。灵感的标题兜底、原始输入补全和自动分类在写入时完成，规则见 `docs/specs/idea-rules.md`。

## 写入

所有写入都是命名命令。输入带 `requestId`、`source: { kind: 'human' | 'agent', name }`。除了新建，还要带目标记录当前的 `rev`。

成功时返回 `{ ok: true, record }`。失败时返回 `{ ok: false, code, message }`，不改数据，也不写历史。

| code | 含义 |
|---|---|
| `invalid_input` | 字段不合法，例如超长、未知领域、缺少要改的字段 |
| `not_found` | 记录或关联对象不存在 |
| `version_conflict` | `rev` 与当前不一致 |
| `duplicate_request_mismatch` | `requestId` 已经成功过，但这次内容不同 |
| `forbidden_source` | agent 执行了只有人能做的命令 |

相同 `requestId` 且内容相同（对象键顺序无关）时，返回第一次的结果，不新增历史。失败的命令不占用 `requestId`，改正后可以用同一个 `requestId` 再试。

收藏（`card.setStar`，以及新建时 `starred: true`）和彻底删除（`task.purge`、`card.purge`）拒绝 `agent`。追记的追加和删除也拒绝 `agent`。

`card.setStar` 不改 `updatedAt` 和 `updatedBy`，`rev` 仍然加 1，并照常写历史。

回收站中的卡片不能修改、追记或收藏，要先恢复。`card.purge` 和 `task.purge` 只能删除已经在回收站里的记录。`card.purge` 的成功结果是 `{ id, attachmentIds }`，附件文件由调用方清理。

每条成功命令在同一事务里写一条历史。用 `listHistory()` 读取，字段是 `requestId`、`command`、`source`、`objectId`、`revBefore`、`revAfter`、`at`。新建的 `revBefore` 是 `null`，`revAfter` 是 1。彻底删除的 `revAfter` 是 `null`。

### 命令

| 命令 | 作用 |
|---|---|
| `project.create` / `project.update` / `project.setStatus` | 新建、改字段、改状态。`area` 必须在领域表里 |
| `task.create` / `task.update` / `task.setStatus` | 新建、改字段、改状态 |
| `task.delete` / `task.restore` / `task.purge` | 软删除、恢复、彻底删除。彻底删除只接受回收站中的任务 |
| `card.create` / `card.update` | 新建、改标题/正文/标签/附件 id/项目/idea 字段。灵感的 `title` 和 `rawInput` 新建时可省略：没给标题时按正文生成兜底标题；没给 `rawInput` 时按来源生成 `web` 或 `agent`。`rawInput` 写入后不能改。修改时不带 `title` 不重算标题 |
| `card.delete` / `card.restore` / `card.purge` | 软删除、恢复、彻底删除。彻底删除只接受回收站中的卡片，并返回附件 id |
| `card.setStar` | 收藏或取消收藏。不改 `updatedAt` / `updatedBy`，`rev` 加 1 |
| `card.addExtension` / `card.deleteExtension` | 追加一条追记，或按 id 删掉一条。只有人能执行 |
| `link.create` / `link.delete` | 新建关联、软删除关联 |

`delete` 写 `deletedAt`。`purge` 删掉该对象，并级联硬删除指向它或由它指出的 links。卡片的追记随卡片行一起删除。

字段限制：卡片标题 ≤ 80 字，正文 ≤ 8000 字，追记 ≤ 8000 字（按 Unicode 码位计）。灵感的 `attachmentIds` 最多 4 个。任务截止日期是 `YYYY-MM-DD`。

灵感新建或修改后，标题、正文、附件至少要有一项内容；纯空白不算内容，否则 `invalid_input`。没给标题时按正文生成兜底标题；正文折叠后为空、但有附件时，标题为「未命名灵感」。

灵感新建时 `fields` 可整体省略。省略 `fields` 或省略其中的 `category`，都按关键词自动分类，`categorySource` 为 `auto`，`captureGroupId` 为 `null`。传入 `fields.category` 则 `categorySource` 为 `user`，之后修改标题或正文不会再自动改分类。调用方不要传 `categorySource`。`channel: 'bot'` 和 `{ status: 'legacy' }` 只在调用方显式传入 `rawInput` 时出现。

## 读取

`getProject` / `getTask` / `getCard` / `getLink` / `getAttachment` 按 id 读取，包含已软删除的记录；不存在或已彻底删除时返回 `null`。

`listProjects` / `listTasks` / `listCards` / `listLinks` / `listAttachments` 默认只返回未删除记录。`deleted: 'trash'` 只看回收站，`deleted: 'all'` 两者都看。

可筛选的条件：

- 项目：`area`、`status`
- 任务：`projectId`（`null` 表示未挂项目）、`status`
- 卡片：`cardType`、`projectId`、`starred`、`category`
- 关联：`from`、`to`、`rel`

`listAreas()` 返回当前领域配置。`listHistory({ objectId })` 可按对象过滤历史。

`searchCards(query, options)` 在标题、正文、原始输入的 `text`、灵感分类的中文名里搜索。关键词按空白切分，全部要命中，不区分大小写。默认不含回收站；`options.deleted` 和 `options.cardType` 可以收窄范围。每条结果是 `{ card, field, excerpt }`：`field` 按 `title`、`body`、`rawInput`、`category` 的顺序取第一个命中字段，`excerpt` 是命中位置前后约 120 字。结果按创建时间倒序。空查询返回空列表。
