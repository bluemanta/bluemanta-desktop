# bluemanta Desktop

Chris 的个人工作台：核心功能做成本机运行的独立网页，DeepSeek Harness（dsh）Desktop 作为对话与 agent 的入口并嵌入这些网页（[ADR 0005](docs/decisions/0005-web-app-dsh-entry.md)），逐步收拢内容创作、知识库、交付项目、代码项目和家庭事务。本文件是所有 agent（Claude Code、Cursor、Codex 等）的统一入口。

## 当前阶段

阶段 1.5（灵感台迁网页，ADR 0005）开发已完成，收尾中（用户试用一周，见 [docs/phase-1-5.md](docs/phase-1-5.md) 第 10 节）；阶段 2（内容线）暂缓。同时开发工作台第二个模块「Skill 台」（[ADR 0008](docs/decisions/0008-skill-desk.md)，[交接文档](docs/skill-desk-handoff.md)）和阶段 3「知识台」（[ADR 0009](docs/decisions/0009-knowledge-desk.md)，[计划](docs/phase-3.md)）。路线和阶段划分见 [docs/vision.md](docs/vision.md)，阶段 1 记录见 [docs/phase-1.md](docs/phase-1.md)。

## 分工

详见 [ADR 0004](docs/decisions/0004-dev-workflow.md)、[ADR 0008](docs/decisions/0008-skill-desk.md)。

- **Cursor**：产品代码实现者（Skill 台、知识台以外的任务）。从 Linear「BlueManta-Desktop」项目领取委派给自己的 issue，一次一个。
- **Codex**：Skill 台的实现者，同样从 Linear 领取委派给自己的 issue。先读 [docs/skill-desk-handoff.md](docs/skill-desk-handoff.md)。
- **Claude Code**：项目经理。规划、写说明书、委派任务、处理技术阻塞、技术验证（`spikes/`）、验收、合并。阶段 3 知识台由 Claude Code 自己实现（ADR 0009 决定 10）。
- **用户**：回答产品决策题；阶段开始时批准计划，结束时试用。

## 开工前必读

1. [docs/vision.md](docs/vision.md)：定位、已拍板的决定、路线
2. [docs/decisions/](docs/decisions/)：全部架构决策记录（ADR）
3. 当前 Linear issue 的描述（即任务说明书）。说明书不清楚或与 ADR 冲突时，不要自行猜测：在 issue 中写明问题，加 `Blocked` 标签，停下来等待答复

## 实现者的工作方式

- 一个 issue 一个分支、一个 PR，PR 目标是 `main`，PR 描述链接 issue。分支名可用 Linear `gitBranchName`，云端 agent 也可用自己的前缀（如 `cursor/…`）。不要直接推送 `main`。
- 开工时在 issue 写一条计划评论并移到 In Progress；开完 PR 后写结果评论（做了什么、偏离说明书之处及原因、已知问题、PR 链接）并移到 In Review。
- 不要把 issue 移到 Done：Done 表示已验收并合并。
- 只修改说明书"允许修改的路径"中的文件。

### 分支与 worktree 的 PR 交付

- 本项目已授权的实现任务，包括云端任务和本地 worktree，在首个可审查提交完成后及时推送任务分支并开 PR；不要等到会话结束才发布。返工继续更新原分支和原 PR。
- 用户已于 2026-10-24 授权上述任务的提交、任务分支推送及 PR 创建和更新。同一范围不重复询问。此授权不包含推送 `main`、强推、合并、部署或提交其他会话的改动。
- 每次交接前运行 `npm run check:pr`。它只读核对当前提交、GitHub PR、远端任务分支和 PR 引用。工作区必须干净，PR 目标必须是 `main`。失败或网络不可用时明确报告 `failed` 或 `not-run`，不要报告“已交付”。
- 结果评论必须包含 PR URL、目标分支、GitHub 上的完整 head SHA 和交付检查结果。`make_pr` 的元数据、云端任务链接或本地 commit 都不能代替这些证据。云端发布若改写了 commit SHA，先核对发布前后代码一致，再报告实际的 GitHub SHA。
- 无法从云端推送时，保留原任务和补丁，明确标记“待发布”。可在隔离 worktree 恢复原补丁、验证并推送原 PR，不要重新触发实现任务或另开重复 PR。
- 清理 worktree 前确认没有未提交改动和未推送提交，且对应 PR 可访问。纯只读验收的临时 worktree 不需要另开 PR。

## 硬规则

1. **每类数据只有一份正本。** 不做双写；迁移只做一次性导入。正本在哪里以 vision.md 的正本归属表为准。
2. **正式数据只读。** `bluemanta-workbench` 已冻结，数据目录 `~/Library/Application Support/BluemantaOPC/` 只能读。Notion ContentHub 在迁移完成前仍是内容线正本，不写入。
3. **私人数据不进仓库。** 灵感、内容、账号信息、客户资料都不能进入代码、fixtures、测试快照或构建产物。测试用虚构样例，运行数据放在仓库外或已被 gitignore 的目录。
4. **读取不设限，对外时检查。** 工作资料（含 SalesOS、FDE）可以进入 Desktop，agent 默认都能读。凡是把内容变成对外材料的功能（发布、导出 PPT、分享），必须经过对外检查，见 [对象模型](docs/object-model.md) 第 5 节。不要为读取增加分级或权限拦截，除非说明书明确要求。
5. **dsh 版本锁定为 0.2.1-rc.2。** dsh 的 API 以该版本的文档和源码为准，不凭记忆写：
   - 云端 agent：读上游提交 `d1b9c04067` 的公开源码 <https://github.com/deepseek-ai/deepseek-harness/tree/d1b9c04067>，例如 `packages/client/ui-sidebar/README.zh.md`；
   - 本机：`~/Developer/bluemanta-harness` 的 `ref/dsh-0.2.1-rc.2` 分支（同一提交）。
   - 写插件前先读 dsh 自带的插件开发指南 `packages/preset/agent-preset/skills/cordis-plugin-development/`（SKILL.md 和 references/），以及 [spikes/s1-panel](spikes/s1-panel/README.md) 的已验证写法。
   - 不修改 fork 的源码。见 [ADR 0002](docs/decisions/0002-dsh-version-and-reference-source.md)、[ADR 0007](docs/decisions/0007-dsh-0-2-1-rc-2.md)。
6. **业务规则和业务界面都不写进 dsh 插件。** 正本读写和业务规则放在 core 里；核心功能的界面做成独立网页，由本地服务提供。dsh 插件只保留入口与嵌入框、agent 工具、工具卡片、消息桥和本地服务的启停。网页只经 HTTP 接口访问数据。见 [ADR 0001](docs/decisions/0001-dsh-shell-data-outside.md)、[ADR 0005](docs/decisions/0005-web-app-dsh-entry.md)。
7. **改动用户环境前先问。** 包括：往用户的 dsh Desktop profile 装插件、修改 `~/.dsh`、全局安装或升级软件。验证一律使用隔离的 `DSH_HOME`。

## Git

- 开工前先 `git status`。不认识的未提交改动属于别的 session，不要 stash、还原或删除；有冲突时停下来问用户。
- 只用 `git add <具体文件>` 暂存本任务的文件，禁止 `git add -A` 和 `git add .`。
- 提交信息只描述本任务的范围。
- push、merge、发布都需要用户授权；本项目任务分支的常规提交、推送和 PR 操作适用上面的 2026-10-24 授权，其他操作不变。

## 验收口径

每条验收项标注 `verified`、`failed` 或 `not-run`，并附上实际运行的命令和结果。没跑过的不能写成通过。

## 目录

| 路径 | 内容 |
|---|---|
| `docs/vision.md` | 定位、决定、路线、现有资产 |
| `docs/decisions/` | 架构决策记录，编号递增，不改写已采纳的记录，变更时新增一条 |
| `docs/tasks/_template.md` | 任务说明书模板；说明书本身写在 Linear issue 描述里 |
| `spikes/` | 技术验证用的一次性代码，不作为产品代码复用 |
| `packages/core` | 产品核心的数据层：对象、存储与写入命令 |
| `packages/cli` | 本机灵感命令（Grok Bot 等经标准输入调用）与共用的灵感工具函数 |
| `packages/mcp` | 供 Claude Code、Codex 使用的 MCP 服务（stdio） |
| `packages/importer` | workbench 数据增量导入 |
| `packages/dsh-plugin` | dsh 插件：agent 工具与工具卡片；左侧栏和右侧栏只放嵌入灵感台网页的框（带 `data-html-preview` 与 `name`，让 Desktop 快捷键归 dsh）；消息桥；本地服务没在跑时临时拉起；侧栏品牌 |
| `packages/server` | 本地服务：`/api/v1` 接口、本机口令与 Host 校验，托管网页构建产物（默认 `127.0.0.1:4310`）；`npm run service` 管理 launchd 开机自启 |
| `packages/web` | 网页版工作台（灵感台；Skill 台、知识台开发中）：React + Vite，样式只用 `docs/design/tokens.css`；Playwright 走查 |
| `packages/skills` | Skill 台的数据与规则（开发中，K1）：读 skill 登记表和各工具安装目录，只读 |
| `packages/knowledge` | 知识台的数据与规则（开发中，KB1）：读 Arsenal 结构的 Markdown 库，建可重建的全文索引，只读 |
