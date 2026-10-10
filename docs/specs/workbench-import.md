# workbench 导入规格

- 日期：2026-10-10
- 来源：Claude Code 对 `~/Library/Application Support/BluemantaOPC/store.json` 的结构盘点（只看字段，不含内容）
- 用于：阶段 1 · T4。实现者不需要、也不应该读取真实数据；测试用虚构 fixture。

## 1. 原则

- **只读来源。** 只读取 workbench 的 `store.json` 和 `media/` 目录，绝不写入；导入前后 `store.json` 的修改时间和内容不变。
- **增量、可重复执行。** 每条来源记录导入后记一条台账；再次运行时，已在台账中的跳过，只导新增。workbench 在阶段 1 结束前仍是灵感收件箱，会持续有新灵感。
- **不覆盖。** 已导入的来源记录如果之后在 workbench 里被修改（来源的 `updatedAt` 晚于台账记录的），只在报告里列出"来源已变化"，不改 Desktop 中的数据。
- **保留原貌。** 原来的时间、来源、标题来源、分类等全部保留，不重新计算；每条来源记录的完整原始 JSON 存入台账，信息不丢失。
- **先演练。** 支持 `--dry-run`：只输出计划（将新增 / 跳过 / 来源已变化各多少条及明细），不写任何东西。
- **先备份。** 真正写入前，把 Desktop 数据库备份到 `<数据目录>/backups/<时间戳>-before-import/`。

## 2. 来源结构（schema 6）

```
store.json
  projects[]          档案：id, category (learning|project), title, summary, background,
                      initial_positioning, current_positioning, status（文本，当前说明）,
                      source, created_at, updated_at, version,
                      demo?, pinned?, archived?, direction_map?, direction_map_stale?, map_source?, map_updated_at?
  entries[]           档案下的笔记：id, project_id, kind, title, body, source, created_at, demo?, public_candidate?
  module_data["inspiration-desk"]["inspiration_desk"]
    schema_version: 6
    data.ideas[]      灵感：id, title, titleOrigin (user|fallback), text,
                      rawInput {status: present, kind: web|bot, text} | {status: legacy, kind: legacy_unknown},
                      organizationStatus, createdSource {kind, name}, updatedSource, createdAt, updatedAt,
                      attachments[] {id, path, mime, width, height, byteSize},
                      category, categorySource (auto|user), extensions[] {id, body, createdAt},
                      captureGroupId?, deletedAt?, starred?
    data.accounts[] / topics[] / outputs[]   内容线，阶段 2 再导，本任务跳过
media/inspiration-desk/inspiration_desk/<附件 id>        图片文件
media/inspiration-desk/inspiration_desk/<附件 id>.json   元数据，含 sha256
```

时间字段为 ISO 8601 字符串；`created_at` 一类为下划线命名，灵感为驼峰命名。

## 3. 映射

### 档案 → Project

- **跳过 `demo: true` 的档案及其笔记。**
- `title` → `title`；`background` → `background`
- `positioning`：依次拼接"初始定位：{initial_positioning}"、"当前定位：{current_positioning}"、"当前说明：{status}"，空的部分省略，段落之间空一行。
- `area`：按导入配置文件中的映射表决定（见第 5 节）；映射表里没有的档案，`category: learning` 默认 `growth`，`category: project` 默认 `product`。
- `status`：`archived: true` → `archived`，否则 `active`。
- `pinned` → `pinned`（缺省 `false`）。
- 时间：`created_at` / `updated_at` 原样保留；来源：`source` 原样保留到 `createdBy` / `updatedBy`（缺失时 `{ kind: 'human', name: 'legacy_unknown' }`）。
- `direction_map` 等其余字段不映射，完整保留在台账的原始 JSON 中。

### 档案笔记 → Card（`cardType: 'note'`）

- 只导入非 demo 档案下的笔记；`projectId` 指向对应 Project。
- `title` → `title`（为空时用正文兜底，规则同灵感）；`body` → `body`；`rawInput` 记 `{ status: 'legacy' }`。
- 时间、来源原样保留。

### 灵感 → Card（`cardType: 'idea'`）

| 来源 | Desktop |
|---|---|
| `title`、`titleOrigin` | 原样保留 |
| `text` | `body` |
| `rawInput {status: present, kind, text}` | `{ status: 'present', channel: kind（web / bot）, text }` |
| `rawInput {status: legacy}` | `{ status: 'legacy' }` |
| `category`、`categorySource` | 原样保留，不重新分类 |
| `captureGroupId` | 原样保留 |
| `starred` | 原样保留 |
| `extensions[]` | 原样保留（id 重新生成，`body`、`createdAt` 保留） |
| `deletedAt` | 原样保留（导入后仍在回收站） |
| `createdSource` / `updatedSource` | `createdBy` / `updatedBy` |
| `createdAt` / `updatedAt` | 原样保留 |
| `organizationStatus` | 不映射（只在台账原始 JSON 中） |

### 附件

- 按元数据中的 `path` 读取文件，校验 `sha256` 与 `.json` 元数据一致；不一致或文件缺失时，该灵感照常导入但不带这张图，报告中列出。
- 复制到 `<数据目录>/media/<新附件 id>`（扩展名按 mime），在 core 中创建 Attachment 记录（`mime`、`byteSize`、`width`、`height`、`sha256`、`path` 为相对数据目录的路径），挂到对应卡片的 `attachmentIds`。T5 的附件存储沿用这个目录约定。

## 4. 写入方式

- 导入需要保留原始时间和来源，普通命令做不到（普通命令把时间记为当前时间）。在 core 中新增**仅供导入使用**的写入入口，例如 `core.importer.*`：
  - 和普通命令共用校验规则（字段长度、领域 id 等）和事务；
  - 允许显式传入 `createdAt` / `updatedAt` / `createdBy` / `updatedBy` / `titleOrigin` / `categorySource` 等；
  - 每条导入写一条历史，`command` 为 `import.workbench.<类型>`；`requestId` 由来源确定性生成（如 `workbench:<类型>:<来源 id>`），重复执行天然幂等。
  - 不通过 dsh 接口暴露，只给导入脚本用。
- **台账表** `import_sources`：`source_system`（`bluemanta-workbench`）、`source_type`（`project` / `entry` / `idea` / `attachment`）、`source_id`、`source_updated_at`、`target_id`、`imported_at`、`raw_json`。`(source_system, source_type, source_id)` 唯一。需要一次 schema 迁移。
- 单条记录导入失败不影响其他记录；失败的不记台账，下次重试；报告中列出原因。

## 5. 命令行

```bash
npm run import:workbench -- [--source <store.json 路径>] [--data-dir <Desktop 数据目录>] [--config <映射配置>] [--dry-run]
```

- `--source` 默认 `~/Library/Application Support/BluemantaOPC/store.json`，附件目录取其所在目录下的 `media/`。
- `--data-dir` 默认 core 的默认数据目录。
- `--config` 是 JSON 文件，目前只有档案领域映射，例如 `{ "projectArea": { "personal-north-star": "growth", "inspiration-desk": "product" } }`。仓库里提供 `example` 文件，不放真实映射。
- 输出报告：各类型的新增 / 跳过 / 来源已变化 / 失败数量及明细（明细只列来源 id 和标题，不打印正文）。
- Desktop 正在运行时也可以执行（SQLite WAL + 等待锁）；导入完成后需要重启 Desktop 才能在面板中看到。

## 6. 本任务不做

- 内容线（accounts / topics / outputs）：阶段 2。
- 把 Grok Bot 等写入入口切到 Desktop：阶段 1 收尾。
- 反向同步到 workbench：永远不做。
