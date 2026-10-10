# bluemanta Desktop

Chris 的个人工作台：以 DeepSeek Harness（dsh）Desktop 作为唯一的交互外壳，逐步收拢内容创作、知识库、交付项目、代码项目和家庭事务。本文件是所有 agent（Claude Code、Cursor、Codex 等）的统一入口。

## 当前阶段

阶段 0：规划与技术验证。仓库里还没有产品代码。路线和阶段划分见 [docs/vision.md](docs/vision.md)。

## 分工

- **Claude Code**：规划文档、任务说明书、技术验证（`spikes/`）、代码审查和运行验收。
- **Cursor / Codex**：按 `docs/tasks/` 里的说明书实现产品代码。
- **用户**：拍板决策；用真实使用来验收；授权所有对外或不可逆的动作。

## 开工前必读

1. [docs/vision.md](docs/vision.md)：定位、已拍板的决定、路线
2. [docs/decisions/](docs/decisions/)：全部架构决策记录（ADR）
3. 当前任务的说明书 `docs/tasks/<id>.md`；没有说明书的工作先补说明书，再动手

## 硬规则

1. **每类数据只有一份正本。** 不做双写；迁移只做一次性导入。正本在哪里以 vision.md 的正本归属表为准。
2. **正式数据只读。** `bluemanta-workbench` 已冻结，数据目录 `~/Library/Application Support/BluemantaOPC/` 只能读。Notion ContentHub 在迁移完成前仍是内容线正本，不写入。
3. **私人数据不进仓库。** 灵感、内容、账号信息、客户资料都不能进入代码、fixtures、测试快照或构建产物。测试用虚构样例，运行数据放在仓库外或已被 gitignore 的目录。
4. **客户资料默认视为机密。** 数云及其客户的任何资料，在敏感分级方案确定之前，不进入任何模型请求，也不接入 Desktop。
5. **dsh 版本锁定为 0.2.0-rc.2。** dsh 的 API 以 `~/Developer/bluemanta-harness`（分支 `ref/dsh-0.2.0-rc.2`）中的文档和源码为准，不凭记忆写。不修改 fork 的源码。见 [ADR 0002](docs/decisions/0002-dsh-version-and-reference-source.md)。
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
| `docs/tasks/` | 任务说明书，模板见 `_template.md` |
| `spikes/` | 技术验证用的一次性代码，不作为产品代码复用 |

产品代码的目录结构在阶段 1 开始前确定。
