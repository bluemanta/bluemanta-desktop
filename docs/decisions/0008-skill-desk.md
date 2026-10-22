# ADR 0008：Skill 台——正本留在原处、本机模块、由 Codex 实现

- 状态：已采纳
- 日期：2026-10-22
- 补充：[ADR 0004](0004-dev-workflow.md) 决定 1（只有 Cursor 一个实现者）；[ADR 0005](0005-web-app-dsh-entry.md) 决定 4 第 2 条（接口里不出现本机路径）。两条 ADR 的其余内容不变。

## 背景

用户在 Codex、Claude Code、Cursor、dsh 里都用 skill。skill 的源头（`~/Documents/AgentSkillRepos`）、登记表（`~/Documents/AgentSkills/manifest.yaml`）和各工具的安装目录分散在多处，现在只能用命令行 `skill_manager.py check` 检查，dsh 也不在登记表里。

用户早先做过一个 Skill 看板原型（`~/Documents/CodeProjects/idash/skill-board`），是纯前端，数据来自构建时快照和演示事件。用户决定不原样嵌入 dsh，而是在本仓库里重写成工作台的第二个模块「Skill 台」，并指定由 Codex 实现。

## 决定

1. **正本不搬家。** skill 内容的正本仍是 `AgentSkillRepos`，登记表的正本仍是 `manifest.yaml`。Desktop 不把 skill 导入 SQLite、不缓存副本、不双写。Skill 台是这些文件的查看与操作界面。
2. **新增包 `packages/skills`**，放 Skill 台的数据与规则：读 manifest、扫描目录、解析 frontmatter、计算安装状态，以后的写入命令也放这里。它不进 core，因为 core 的正本是 SQLite 存储，而这个模块的正本是用户目录里的文件。本地服务、dsh 插件、MCP 都依赖它。
3. **路径全部可注入。** 不写死用户目录；本地服务认环境变量 `BLUEMANTA_SKILL_HOME`（覆盖 home 目录），供开发、测试和走查指向虚构目录。
4. **本机模块，接口可以带路径（ADR 0005 决定 4 第 2 条的例外）。** Skill 台管理的就是本机目录，路径是必要信息。接口返回的路径只用于显示，home 前缀缩写成 `~`；接口不接受客户端传来的路径，只接受 skill 名和工具键，路径由服务端按 manifest 解析。将来迁云时，这个模块不迁。
5. **界面与灵感台同一个网页应用。** 同一套外壳、组件、tokens.css、本地服务和口令，嵌入 dsh 的方式相同。界面规格见 [docs/specs/skill-ui.md](../specs/skill-ui.md)。
6. **先只读。** M1 只读取。任何写入（建软链、改 manifest、往 `~/.dsh/skills` 放东西）都是改用户环境（AGENTS.md 硬规则 7），留到 M2；M2 的每个写操作都要先预览、再由用户在页面上确认。M2 的写入规则由谁实现（调用现有 `skill_manager.py` 还是重写）、dsh 是否成为 manifest 的正式安装目标，到 M2 开始前再定。
7. **Skill 台由 Codex 实现。** Skill 台相关的任务都委派给 Linear 里的 Codex（员工标签 `Agent-Codex`），流程与 Cursor 相同：一个 issue 一个分支一个 PR，Claude Code 验收、合并。其余任务仍由 Cursor 实现。两边改到同一批共享文件时，由 Claude Code 安排先后。

## 后果

- 好处：
  - 不产生第二份 skill 数据；
  - 用户不开终端就能看清各工具的 skill 状态；
  - Skill 台和 Cursor 的任务基本不交叉，可以并行推进。
- 代价：
  - 网页外壳要先改成能放多个模块（K0），而且要赶在别的模块改外壳之前合并；
  - 多一个实现者，Claude Code 要按 Codex 的结果评论和 PR 验收；
  - Codex 在云端运行，读不到用户本机文件，说明书必须自带足够的信息（虚构样例、上游源码地址）。
- Codex 用哪个模型、推理档和 fast 模式，在 Codex 的设置里选，不能由 Linear issue 指定；说明书里写明要求，结果评论里要报告实际使用的模型。
