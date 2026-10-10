# bluemanta Desktop：定位、决定与路线

最后更新：2026-10-10

## 定位

一个完全按 Chris 个人习惯定制的工作台。长期收拢：代码项目、新媒体内容（小红书、X）、To B / FDE 交付、SalesOS 数云交付、个人与工作知识库、家庭事务（如孩子教育）。

这是一次整合重构，不是从零开始：以前分散在 workbench、灵感台、Notion、本地 Markdown 中的东西，要逐步收进一个地方。

## 已拍板的决定

| 日期 | 决定 |
|---|---|
| 2026-10-10 | `bluemanta-workbench` 冻结，不再更新；其全部内容迁入 Desktop |
| 2026-10-10 | Notion ContentHub 和 Grok Bot 每日选题流程暂时保留，近期内容更新仍在 Notion 里做；之后整套流程迁入 Desktop，由 Desktop 实现类似 ContentHub 的功能 |
| 2026-10-10 | dsh Desktop 是唯一的交互外壳；灵感清单、发布台等看板做成 dsh 插件面板（[ADR 0001](decisions/0001-dsh-shell-data-outside.md)；S1 已在 web 版和 Desktop 内验证可行） |
| 2026-10-10 | 关闭 dsh 的会话日志上传：Desktop profile 与命令行 web profile 均设为 `session-log-deepseek.enabled: false` |
| 2026-10-10 | 产品核心用 TypeScript 重写，灵感台 Python 核心只作为规格来源（[ADR 0003](decisions/0003-typescript-core.md)） |
| 2026-10-10 | 跨模块数据（如统一任务看板）通过公共对象实现：任务、项目、人、卡片在 core 中只有一份，各模块写入并带来源模块；不做插件之间的数据同步 |
| 2026-10-10 | 敏感信息：工作资料（含 SalesOS、FDE）默认可进入、agent 默认可读；管控放在对外时（发布、对外 PPT、分享）做对外检查，不做读取分级（[对象模型](object-model.md) 第 5 节） |
| 2026-10-10 | 场景卡字段和脱敏流程由用户先重新梳理 Notion，阶段 2 再设计；阶段 1 只做灵感卡片、项目、任务和 core |
| 2026-10-10 | 领域按"长期责任/角色"划分为工作、内容、产品、成长、家庭，可配置；知识不是领域，而是贯穿所有领域的卡片层；灵感、场景卡、笔记统一为卡片（[对象模型](object-model.md)） |
| 2026-10-10 | 阶段 1 计划见 [phase-1.md](phase-1.md) |
| 2026-10-10 | dsh 锁定 0.2.0-rc.2；参考源码放在 `~/Developer/bluemanta-harness`（[ADR 0002](decisions/0002-dsh-version-and-reference-source.md)） |
| 2026-10-10 | 分工：Cursor 单线开发；Claude Code 当项目经理（委派、验收、合并、更新本地版本）；用户只做产品决策和阶段试用；任务在 Linear「BlueManta-Desktop」项目管理（[ADR 0004](decisions/0004-dev-workflow.md)） |
| 2026-10-10 | 代码托管在私有仓库 `bluemanta/bluemanta-desktop` |

## 架构

自上而下四层，下层不依赖上层：

1. **交互层**：dsh Desktop。对话在主区；看板做成左侧栏的面板；编辑器放在右栏 tab；agent 写入的结果在对话里显示成卡片。
2. **Agent 层**：dsh 的 skills、subagent、定时、MCP 客户端。skills 复用 AgentSkillRepos 体系。
3. **能力层**：按领域划分的模块（内容线、知识库、交付、开发、家庭），通过 CLI 和 MCP 暴露，任何 agent 都能调用。
4. **数据正本层**：本地优先，文件加 SQLite，可导出。沿用 workbench 已验证的写入协议：来源区分 human 和 agent、版本冲突检测、幂等 `request_id`、先预览后写入。

领域先登记，后建模块：交付、开发、家庭在出现高频重复操作之前，只建档案页和文件夹链接。

## 正本归属表（现状）

| 数据 | 当前正本 | 状态 | 去向 |
|---|---|---|---|
| 灵感（29 条）及内容线的账号、选题、产出 | workbench `store.json` 中的灵感台模块数据 | 冻结，只读 | 阶段 1 一次性导入 Desktop |
| 场景卡、选题卡（内容台账） | Notion ContentHub | 活跃，暂留 | 阶段 2 功能对齐后导入 Desktop，Notion 归档为只读 |
| 成长 / 项目档案（英语学习、AI 基础、个人北极星等） | workbench `store.json` | 冻结，只读 | 迁入 Desktop，阶段待定 |
| 本地 ContentHub Markdown | `~/Documents/ContentHub` | 待确认是否仍在使用 | 知识库阶段导入 |
| 灵感台 L1 云端数据 | `inspiration-desk-l1-web` 的云端库 | 冻结 | 待确认是否有真实数据 |
| Obsidian 笔记 | `~/Documents/Obsidian`、`~/Documents/Obsidian Vault` | 未定 | 知识库阶段决定 |
| SalesOS 项目材料 | `~/Documents/Shuyun/SalesOS` | 活跃，不迁移 | 阶段 4 接入方式待定（索引或导入），默认 agent 可读 |

## 路线

每个阶段用真实使用来验收，不用功能数量验收。

| 阶段 | 内容 | 验收 |
|---|---|---|
| 0 | 本仓库的规划文档；技术验证 S1（dsh 面板扩展点，已通过）；确认正本归属表；对象模型草案，先定公共对象（任务、项目、人、卡片），再定各模块对象（参照 Notion 两个库和灵感台 schema 6） | 文档定稿；S1 结论为 verified 或 failed |
| 1 | Desktop core（项目、任务、卡片、写入规则、存储）；灵感清单面板；agent 读写灵感的工具；导入 workbench 冻结数据中的灵感和档案（内容线数据留到阶段 2） | 日常记录和回看灵感都在 Desktop 里完成，不再打开 workbench |
| 2 | 内容线：场景卡、选题、产出、发布台、内容台账面板，对齐 Notion ContentHub；Grok Bot 改为写入 Desktop | 连续 2 周内容生产全部在 Desktop 完成，每周发布 N 篇（N 由用户定） |
| 3 | 知识库：知识卡片、检索、导入本地 ContentHub 和 Obsidian | 随口问一个半年前的想法，能找回来 |
| 4 起 | 交付（SalesOS 只读索引、飞书纪要）、开发项目、家庭 | 按领域分别定义 |

## 待决问题

1. 本地 `~/Documents/ContentHub` 还在用吗？它和 Notion ContentHub 是什么关系？
2. 灵感台 L1 云端版里有没有真实数据？
3. ~~小红书账号名不一致~~ 不是不一致：Notion 内容台账中共有 4 个账号（深蓝夜航、bluemanta、被迫进化的打工人三个小红书号，加 bluemanta@X），见 [object-model.md](object-model.md)。
4. ~~产品 core 的语言~~ 已决定用 TypeScript 重写（ADR 0003）。
5. ~~敏感分级~~ 已决定：读取不设限，对外时检查（见对象模型第 5 节）。
6. 迁移阶段 Grok Bot 怎么写入本机的 Desktop（webhook 加隧道，或者 Desktop 从云端收件箱拉取）。
7. workbench 冻结后，`opc-workbench` skill 仍然能写入 workbench，是否停用或改为只读？
8. ~~是否关闭 dsh 的会话日志上传~~ Desktop 和 web profile 均已于 2026-10-10 关闭。
9. 面板读写数据的通道如何鉴权：S1 用的 `ctx.webServer` 自定义路由不经过 dsh 的 `/api` 鉴权。

## 主要风险

- **搭系统陷阱**：范围横跨 7 个领域。对策：一次只推进一个阶段，每个阶段用真实产出验收。
- **dsh 处于开发者预览**：API 会有破坏性变更。对策：锁版本；插件只做薄适配；页面写成普通 React 组件，必要时能脱离 dsh 独立运行。
- **多份正本**：对策：遵守正本归属表，迁移只做一次性导入。
- **数据合规**：工作资料会随模型请求发给模型提供方（与现在 Codex 读 SalesOS 的情况相同，由用户自行把握）；dsh 的会话日志上传已在 Desktop 和 web profile 关闭，新建 dsh profile 时要检查这一项。对外泄露的风险由对外检查兜底。

## 现有资产

| 资产 | 路径 | 在 Desktop 中的角色 |
|---|---|---|
| bluemanta-workbench（含灵感台模块） | `~/Documents/CodeProjects/bluemanta-workbench` | 冻结；灵感台的 `core/` 和 `ui/` 是移植来源 |
| 灵感台 L1 云端版 | `~/Documents/CodeProjects/inspiration-desk-l1-web` | 冻结 |
| DeepSeek Harness 参考源码 | `~/Developer/bluemanta-harness` | API 与文档的参考 |
| manta-recall | `~/Documents/CodeProjects/manta-recall` | 知识库检索的参考实现 |
| AgentSkillRepos 与 manifest | `~/Documents/AgentSkillRepos`、`~/Documents/AgentSkills/manifest.yaml` | skills 的源头，需要增加 dsh 安装目标 |
