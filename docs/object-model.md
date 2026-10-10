# 对象模型（草案 v0.2）

- 日期：2026-10-10
- 状态：v0.3（2026-10-10）阶段 1 范围已确认。v0.2 取消读取分级、改为对外检查，场景卡和内容线留到阶段 2；v0.3 确定领域列表，确认卡片统一
- 依据：灵感台业务 schema 6（`bluemanta-workbench/modules/inspiration_desk/core/schema.py`）、Notion「场景卡库」「内容台账」、[vision.md](vision.md)、ADR 0001 / 0003

本文定义 Desktop core 中有哪些对象、对象之间如何关联、所有写入遵守什么规则。字段名用英文（代码里的名字），说明用中文。具体的 TypeScript 类型和数据库表结构在阶段 1 的任务中按本文落地。

## 1. 总体结构

```
公共层（所有模块共用，只有一份）
  记录信封  每条记录都带的元字段
  Area      领域（可配置列表）
  Project   项目（归属一个领域）
  Task      任务
  Card      卡片：灵感、场景卡、笔记……都是卡片的不同类型
  Person    人（阶段 1 不实现，先占位）
  Attachment 附件
  Link      对象之间的多对多关联

模块层（各模块自有）
  content 内容线：Account 账号、Topic 选题、Output 产出
  以后：salesos、fde、family……
```

**规则：** 模块对象可以引用公共对象，公共对象不引用任何模块对象。模块的特有字段放在模块自己的对象里；必须挂在公共对象上的模块数据，放进该公共对象的 `ext.<模块名>` 中。统一的视图（如任务看板）只读公共字段。

## 2. 记录信封（所有对象都有）

| 字段 | 含义 |
|---|---|
| `id` | 全局唯一、永不改变。格式为 `<类型前缀>_<ULID>`，如 `card_01J…`、`task_01J…` |
| `module` | 产生这条记录的模块：`core` / `content` / … |
| `rev` | 版本号，每次修改加 1；写入时必须带上读到的 `rev`，不一致就拒绝（防止覆盖别人的修改） |
| `createdAt` / `updatedAt` | 时间，ISO 8601 |
| `createdBy` / `updatedBy` | 来源：`{ kind: 'human' \| 'agent', name }`。来源是声明，不是身份认证 |
| `deletedAt` | 软删除时间；有值时只出现在回收站 |

## 3. 公共对象

### Area 领域

领域回答"这件事是为了哪一块长期责任"，按你扮演的角色划分。只用于给项目分组和筛选，不涉及权限和存储。

| id | 名称 | 角色 | 放什么 |
|---|---|---|---|
| `work` | 工作 | 职业人、顾问 | 本职工作和客户交付：数云项目、SalesOS 客户项目、FDE |
| `content` | 内容 | 创作者 | 个人品牌与内容运营：小红书、X 账号 |
| `product` | 产品 | 构建者 | 自己做的产品和工具：bluemanta Desktop、OnCue、PortDash、个人网站 |
| `growth` | 成长 | 学习者 | 学习与个人发展：英语、AI 基础、个人北极星 |
| `family` | 家庭 | 家人 | 家庭事务：孩子教育 |

- 领域列表是配置，不写死在代码里；`id` 稳定不变，名称可改，可新增。
- 一个项目只属于一个领域，按主要目的判断；跨领域的关系用 Link 表达。例如「SalesOS 客户交付」归工作、「SalesOS 产品」归产品，两者关联。
- "知识"不是领域，而是贯穿所有领域的卡片层：卡片挂在项目下即间接属于该领域，不挂项目的卡片是通用知识。

### Project 项目

| 字段 | 含义 |
|---|---|
| `title` | 名称 |
| `area` | 所属领域的 `id`，见上 |
| `status` | `active` / `paused` / `done` / `archived` |
| `background` | 背景（来自 workbench 的"背景"） |
| `positioning` | 定位（来自 workbench 的"初始定位"和"当前说明"） |
| `pinned` | 是否置顶 |
| `locations` | 相关位置：本地文件夹路径、网址等，只是链接，不搬运内容 |

workbench 的"成长"档案迁入后是 `area: growth` 的项目；"项目"档案按主要目的归入对应领域，导入时由用户确认归属。

### Task 任务

| 字段 | 含义 |
|---|---|
| `title` | 标题 |
| `status` | `todo` / `doing` / `done` / `canceled` |
| `blocked` | 是否卡住，附原因 `blockedReason` |
| `projectId` | 所属项目，可空 |
| `due` | 截止日期，可空 |
| `priority` | `high` / `normal` / `low`，可空 |
| `origin` | 由哪个模块的哪个对象产生：`{ module, objectId }`，可空。统一看板据此显示"来自 SalesOS 的某某项目" |
| `notes` | 说明，Markdown |
| `ext` | 模块特有字段，如 `ext.salesos.stage` |

### Card 卡片

知识库的基本单位。灵感、场景卡、普通笔记都是卡片，共用标题、正文、附件、追记和检索；不同类型的特有字段放在 `fields` 里。

| 字段 | 含义 |
|---|---|
| `cardType` | `idea` 灵感 / `scene` 场景卡 / `note` 笔记，以后可加 |
| `title` | 标题；为空时按规则生成兜底标题，并标记 `titleOrigin: 'fallback'` |
| `body` | 整理后的正文，Markdown |
| `rawInput` | 原始输入，写入后不可修改：`{ status: 'present', channel: 'web' \| 'bot' \| 'agent', text }`，或历史数据的 `{ status: 'legacy' }` |
| `starred` | 收藏 |
| `tags` | 标签 |
| `attachmentIds` | 附件，灵感最多 4 张图（沿用灵感台规则） |
| `extensions` | 追记：用户对这张卡的后续补充，只能追加或单条删除，`{ id, body, createdAt }[]` |
| `projectId` | 所属项目，可空 |
| `fields` | 类型特有字段，见下 |

**灵感（`cardType: 'idea'`）的 `fields`：**

| 字段 | 含义 |
|---|---|
| `category` | `product` 产品想法 / `learning` 学习备忘 / `work` 工作事务 / `life` 生活随想 / `other` 其他 |
| `categorySource` | `auto`（关键词自动分类）/ `user`（用户改过后不再自动覆盖） |
| `captureGroupId` | 同一次捕捉产生的多条灵感的分组，可空 |

**场景卡（`cardType: 'scene'`）：** 字段待阶段 2 设计。用户会先重新梳理 Notion 场景卡库和其中的脱敏流程，现有字段（痛点、解法思路、我的观点、效果、来源、行业、内容可用性、脱敏状态、转化状态）只作参考，不在阶段 1 落地。

### Attachment 附件

`{ id, mime, byteSize, width, height, sha256, path }`。文件存在仓库外的数据目录，记录里只存引用。图片格式和大小限制沿用灵感台（jpeg / png / gif / webp，单张 ≤ 8 MB）。

### Link 关联

多对多的松散关系用一张关联表：`{ id, from, to, rel, createdAt, createdBy }`。例如：

| `rel` | 从 → 到 | 含义 |
|---|---|---|
| `material` | 选题 → 卡片 | 选题用到的素材（灵感、场景卡） |
| `related` | 卡片 → 卡片 | 两张卡相关 |

一对多的固定关系直接用字段（如 `task.projectId`、`output.topicId`），不走关联表。

## 4. 内容线模块（`module: 'content'`）

> 阶段 2 再定稿。下面基于灵感台 schema 6 和 Notion 内容台账整理，作为阶段 2 设计的起点，阶段 1 不实现。

### Account 账号

| 字段 | 含义 |
|---|---|
| `platform` | `xiaohongshu` / `x` |
| `name` / `handle` | 显示名 / 账号 |
| `positioning` / `audience` / `voice` / `samples` | 定位、读者、语气、样例 |
| `rules` | 平台限制：`titleMax` / `bodyMax` / `imagesMax` / `tagsMax`；X 默认正文 280、图片 4 |
| `archived` | 是否停用 |

现有账号（Notion「平台」选项）：深蓝夜航@小红书、bluemanta@小红书、被迫进化的打工人@小红书、bluemanta@X。

### Topic 选题

一个选题是"想让读者记住的一个观点"，可以在多个账号上各产出一篇。

| 字段 | 含义 | Notion 字段 |
|---|---|---|
| `title` | 选题标题 | 标题 |
| `thesis` | 核心观点 | 核心观点 |
| `pillar` | 内容支柱，可配置选项（AI进化论 / AI进化论·跨界篇 / 夜航手记 / 落地场景库） | 内容支柱 |
| `notes` | 素材与要点 | 正文 |
| `status` | `proposed`（agent 起草、待你确认）/ `active` / `paused` / `done` / `dropped` | — |
| 素材 | 通过 Link `material` 关联灵感、场景卡 | 来源场景卡 |

### Output 产出

某个选题在某个账号上的一篇内容。

| 字段 | 含义 | Notion 字段 |
|---|---|---|
| `topicId` / `accountId` | 所属选题、发布账号 | 平台 |
| `angle` | 切入角度 | — |
| `stage` | `planned`（待写）/ `drafting`（生产中）/ `ready`（待发布）/ `published`（已发布） | 状态 |
| `versions` | 稿件版本 `{ id, title, body, tags, note, createdBy, createdAt }[]`，最多 10 个 | — |
| `currentVersionId` | 当前采用的版本 | — |
| `attachmentIds` | 配图，最多 20 张，有顺序 | — |
| `plannedOn` | 计划发布日期 | 计划发布日期 |
| `publication` | `{ url, publishedAt }`，只有 `published` 时有值 | 发布链接 |
| `metrics` | `{ reads, saves, newFollowers, productionMinutes, recordedAt }` | 阅读、收藏、新增关注、生产耗时 |

Notion 的一行导入时拆成：一个选题，加上「平台」里每个账号各一个产出。Notion 的"选题"状态对应选题 `active`、产出 `planned`。

## 5. 敏感信息：读取不设限，对外时检查

**原则：** Desktop 里的所有内容，包括 SalesOS、FDE 的工作资料，默认都可以进来、agent 都可以读。管控放在内容"对外"的那一刻：转成对外发布的内容、对外演讲的 PPT、分享给别人的材料时，才检查有没有机密信息。

**对外检查**（阶段 2 随内容线实现，之后其他对外出口复用）：

1. **触发点：** 产出进入"待发布"或"已发布"之前；导出对外材料（PPT、分享页）之前。
2. **检查什么：**
   - 敏感词表：客户名、品牌名、项目代号等，由用户维护，也可以从 SalesOS 的项目目录名生成候选，用户确认后加入；
   - 素材来源：产出引用的素材里，有没有来自 `salesos`、`fde` 等工作模块的记录；
   - 内容红线：沿用 ContentHub 已有的规则（不出现雇主或客户名、不编数据、不写价格等），可由 agent 按清单复核。
3. **结果：** 只提示，不拦截。把命中项列给用户，由用户改稿或确认放行。发布本来就是只有人能做的操作。

记录信封里不设敏感级别字段。以后确实需要"某条内容不给 AI 读"时，再加一个手动标记。

## 6. 写入规则

沿用 workbench 已验证的协议，所有写入（界面按钮、agent 工具、导入脚本）都走同一套 core 命令：

1. **命令化：** 每次写入是一条命名命令（如 `card.create`、`output.addVersion`），带 `requestId`、`source`、目标记录的 `rev`。
2. **幂等：** 相同 `requestId` 和相同内容，返回上一次的结果；相同 `requestId` 但内容不同，拒绝。
3. **版本冲突：** `rev` 与当前不一致就拒绝，调用方重新读取后再决定。
4. **只有人能做的操作：** 收藏、彻底删除、改变发布状态、采用某个版本。agent 可以新建卡片、起草选题（`proposed`）、为产出添加草稿版本、创建任务。
5. **操作历史：** 每条成功的命令写一条历史 `{ requestId, command, source, objectId, revBefore, revAfter, at }`，用于审计和撤销。
6. **软删除优先：** 删除先进回收站；彻底删除才级联删除附件文件。

## 7. 存储

- SQLite 单文件，放在仓库外的数据目录（暂定 `~/Library/Application Support/BluemantaDesktop/`），附件放在同目录的 `media/` 下。
- 每种对象一张表：信封字段和常用查询字段单独成列，其余放 JSON 列。
- 升级前自动备份数据文件；数据库结构的版本号单调递增，迁移脚本随代码提交。

## 8. 迁移来源对照

| 来源 | 去向 | 阶段 |
|---|---|---|
| workbench 灵感（29 条） | Card `idea`，保留原 id 映射、原文、追记、附件、收藏 | 1 |
| workbench 账号 / 选题 / 产出 | content 模块的 Account / Topic / Output | 2 |
| workbench 成长 / 项目档案 | Project | 1 |
| Notion 场景卡库 | Card `scene` | 2 |
| Notion 内容台账 | Topic + Output | 2 |
| 本地 ContentHub Markdown、Obsidian | Card `note` | 3 |

所有迁移都是一次性导入，导入后来源只读。

## 9. 留到阶段 2 讨论

- 场景卡字段与脱敏流程（用户先梳理 Notion）。
- 一个选题能否在多个账号各产出一篇。
