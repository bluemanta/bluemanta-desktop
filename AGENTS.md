# bluemanta Desktop

Chris 的个人工作台：以 DeepSeek Harness（dsh）Desktop 作为唯一的交互外壳，逐步收拢内容创作、知识库、交付项目、代码项目和家庭事务。本文件是所有 agent（Claude Code、Cursor、Codex 等）的统一入口。

## 当前阶段

阶段 0：规划与技术验证。仓库里还没有产品代码。路线和阶段划分见 [docs/vision.md](docs/vision.md)。

## 分工

详见 [ADR 0004](docs/decisions/0004-dev-workflow.md)。

- **Cursor**：唯一的产品代码实现者。从 Linear「BlueManta-Desktop」项目领取委派给自己的 issue，一次一个。
- **Claude Code**：项目经理。规划、写说明书、委派任务、处理技术阻塞、技术验证（`spikes/`）、验收、合并。
- **用户**：回答产品决策题；阶段开始时批准计划，结束时试用。

## 开工前必读

1. [docs/vision.md](docs/vision.md)：定位、已拍板的决定、路线
2. [docs/decisions/](docs/decisions/)：全部架构决策记录（ADR）
3. 当前 Linear issue 的描述（即任务说明书）。说明书不清楚或与 ADR 冲突时，不要自行猜测：在 issue 中写明问题，加 `Blocked` 标签，停下来等待答复

## 实现者的工作方式

- 按 issue 的 Linear `gitBranchName` 建分支，一个 issue 一个 PR，PR 目标是 `main`。不要直接推送 `main`。
- 开工时在 issue 写一条计划评论并移到 In Progress；开完 PR 后写结果评论（做了什么、偏离说明书之处及原因、已知问题、PR 链接）并移到 In Review。
- 不要把 issue 移到 Done：Done 表示已验收并合并。
- 只修改说明书"允许修改的路径"中的文件。

## 硬规则

1. **每类数据只有一份正本。** 不做双写；迁移只做一次性导入。正本在哪里以 vision.md 的正本归属表为准。
2. **正式数据只读。** `bluemanta-workbench` 已冻结，数据目录 `~/Library/Application Support/BluemantaOPC/` 只能读。Notion ContentHub 在迁移完成前仍是内容线正本，不写入。
3. **私人数据不进仓库。** 灵感、内容、账号信息、客户资料都不能进入代码、fixtures、测试快照或构建产物。测试用虚构样例，运行数据放在仓库外或已被 gitignore 的目录。
4. **读取不设限，对外时检查。** 工作资料（含 SalesOS、FDE）可以进入 Desktop，agent 默认都能读。凡是把内容变成对外材料的功能（发布、导出 PPT、分享），必须经过对外检查，见 [对象模型](docs/object-model.md) 第 5 节。不要为读取增加分级或权限拦截，除非说明书明确要求。
5. **dsh 版本锁定为 0.2.0-rc.2。** dsh 的 API 以该版本的文档和源码为准，不凭记忆写：
   - 云端 agent：读上游提交 `c1b47e41fc` 的公开源码 <https://github.com/deepseek-ai/deepseek-harness/tree/c1b47e41fc>，例如 `packages/client/ui-sidebar/README.zh.md`；
   - 本机：`~/Developer/bluemanta-harness` 的 `ref/dsh-0.2.0-rc.2` 分支（同一提交）。
   - 写插件前先读 dsh 自带的插件开发指南 `packages/preset/agent-preset/skills/cordis-plugin-development/`（SKILL.md 和 references/），以及 [spikes/s1-panel](spikes/s1-panel/README.md) 的已验证写法。
   - 不修改 fork 的源码。见 [ADR 0002](docs/decisions/0002-dsh-version-and-reference-source.md)。
6. **业务规则不写进 dsh 插件。** 插件只负责显示和适配，正本读写和业务规则放在 Desktop 自己的 core 里。见 [ADR 0001](docs/decisions/0001-dsh-shell-data-outside.md)。
7. **改动用户环境前先问。** 包括：往用户的 dsh Desktop profile 装插件、修改 `~/.dsh`、全局安装或升级软件。验证一律使用隔离的 `DSH_HOME`。

## Git

- 开工前先 `git status`。不认识的未提交改动属于别的 session，不要 stash、还原或删除；有冲突时停下来问用户。
- 只用 `git add <具体文件>` 暂存本任务的文件，禁止 `git add -A` 和 `git add .`。
- 提交信息只描述本任务的范围。
- push、merge、发布都需要用户授权。

## 验收口径

每条验收项标注 `verified`、`failed` 或 `not-run`，并附上实际运行的命令和结果。没跑过的不能写成通过。

## 目录

| 路径 | 内容 |
|---|---|
| `docs/vision.md` | 定位、决定、路线、现有资产 |
| `docs/decisions/` | 架构决策记录，编号递增，不改写已采纳的记录，变更时新增一条 |
| `docs/tasks/_template.md` | 任务说明书模板；说明书本身写在 Linear issue 描述里 |
| `spikes/` | 技术验证用的一次性代码，不作为产品代码复用 |

产品代码的目录结构在阶段 1 开始前确定。
