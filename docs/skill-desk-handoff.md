# Skill 台交接文档（给 Codex）

- 日期：2026-10-22
- 状态：定稿（2026-10-22）。架构约定与实现者见 [ADR 0008](decisions/0008-skill-desk.md)；任务在 Linear「BlueManta-Desktop」项目，委派给 Codex
- 写给：Codex（实现者）。项目经理与验收：Claude Code。产品决策：用户（Chris）
- 依据：[AGENTS.md](../AGENTS.md)、[vision.md](vision.md)、ADR 0001–0008、dsh 0.2.1-rc.2 源码（提交 `d1b9c04067`）、本机 `~/Documents/AgentSkills` 现状（2026-10-22 核对）

本文分两部分：第 1–3 节讲**在这个仓库里给 dsh 加一个模块的通用做法**，以后任何模块都照这个走；第 4–8 节讲 **Skill 台这个模块本身**。

---

## 1. 开工前必读（按顺序）

| # | 文件 | 读什么 |
|---|---|---|
| 1 | [AGENTS.md](../AGENTS.md) | 硬规则 1–7、Git 规则、验收口径。**这是最高约束** |
| 1a | [ADR 0008](decisions/0008-skill-desk.md) | Skill 台的架构约定：正本不搬家、`packages/skills`、本机模块、只读先行 |
| 2 | [ADR 0005](decisions/0005-web-app-dsh-entry.md) | 三层结构：数据与规则 / 网页 / dsh 入口层。整个模块模式的来源 |
| 3 | [ADR 0006](decisions/0006-acceptance-tiers.md) | 轻验收与独立验收、Playwright 走查、截图尺寸 |
| 4 | [ADR 0007](decisions/0007-dsh-0-2-1-rc-2.md) | dsh 锁定 0.2.1-rc.2，插件用到的 API 清单 |
| 5 | [packages/dsh-plugin/README.md](../packages/dsh-plugin/README.md) | 插件现在做什么：左栏框、右栏标签、消息桥 `bm:*`、agent 工具、本地服务拉起、`npm run dev:dsh` |
| 6 | [packages/server/README.md](../packages/server/README.md) | `/api/v1` 的口令、Host 校验、接口风格 |
| 7 | [docs/design/DESIGN.md](design/DESIGN.md) | 网页视觉与交互规范；样式只用 `docs/design/tokens.css` |
| 7a | [docs/specs/idea-ui.md](specs/idea-ui.md)、[docs/specs/skill-ui.md](specs/skill-ui.md) | 灵感台的界面规格是页面模式的样板；Skill 台的界面规格只写和灵感台不同的地方 |
| 8 | dsh skill 子系统：上游提交 `d1b9c04067` 下的 `docs/subsystems/skills.zh.md`、`packages/skill/skill-filesystem/README.zh.md` | dsh 从哪些目录发现 skill、优先级、frontmatter 规则 |
| 9 | dsh 插件开发指南：同一提交 `packages/preset/agent-preset/skills/cordis-plugin-development/`（SKILL.md 与 references/），以及 [spikes/s1-panel](../spikes/s1-panel/README.md)、[spikes/s3-embed](../spikes/s3-embed/README.md) | 插件写法以这里和现有 `client.js` 为准，不凭记忆 |
| 10 | 本文第 4 节 | 用户现有的 skill 管理体系：源头 → manifest → 各工具安装目录。原始文件在用户本机，云端读不到，第 4 节已摘出需要的全部信息 |

**读 dsh 源码：** 在云端读上游公开源码 <https://github.com/deepseek-ai/deepseek-harness/tree/d1b9c04067>（例如 `docs/subsystems/skills.zh.md`）；在用户本机可以用 `git -C ~/Developer/bluemanta-harness show ref/dsh-0.2.1-rc.2:<路径>`，不要切换那个仓库的分支，也不要改它。

**在云端运行时：** 文中出现的 `~/Documents/...`、`~/.codex` 等用户本机路径都读不到，也不需要读。代码和测试只用临时目录里现造的虚构数据（第 4.3 节有 manifest 样例）。

---

## 2. 在本仓库给 dsh 加一个模块：通用模式

### 2.1 一张图

```
 浏览器 / dsh 主区 iframe / dsh 右栏 iframe
        │  只走 HTTP（Authorization: Bearer <口令>）
        ▼
 packages/web          网页页面（React + Vite + wouter + react-query）
        │
        ▼
 packages/server       /api/v1/<资源>   口令、Host 校验、参数校验、组装返回体
        │
        ▼
 数据与规则包          读写正本、业务规则、写入协议（core 或本模块自己的包）
        ▲
        │  同一组函数
 packages/dsh-plugin   agent 工具（宿主端）、工具卡片、左栏入口框、消息桥
 packages/mcp          同一组工具给 Claude Code / Codex
```

### 2.2 每一层放什么、不放什么

| 层 | 放 | 不放 | 照着抄的现有代码 |
|---|---|---|---|
| 数据与规则 | 正本读写、校验、状态计算、写入命令。纯函数优先，路径全部可注入 | HTTP、界面、dsh API | `packages/core/src/commands/*.ts`、`packages/cli/src/idea-tools.ts` |
| 本地服务 | `/api/v1/<资源>` 路由；响应类型写进 `src/api-types.ts` 供网页直接引用 | 业务规则（只调用下层） | `packages/server/src/app.ts` 里 `/api/v1/ideas` 一组路由 |
| 网页 | 新的顶层路由与页面目录 `packages/web/src/<模块>/`；侧栏加一个入口；Playwright 走查 | 直接读文件或数据库；本机路径拼接 | `packages/web/src/ideas/`、`src/api/queries.ts`、`src/shell/Sidebar.tsx`、`e2e/walkthrough.spec.ts` |
| dsh 入口层 | ① 左侧栏 `sidebar.panellist` 入口 + 主区 `main` keyed slot 里一个铺满的 iframe（带 `data-html-preview` 与 `name`，见 S5/T17）；② `ctx.tools.register(defineTool(...))` 注册 agent 工具，执行函数在下层；③ 需要时 `tool.call.toolview` 工具卡片；④ 需要时扩展 `bm:*` 消息 | 任何业务界面和业务规则（硬规则 6） | `packages/dsh-plugin/client.js` 中 `PANEL_ID = 'bluemanta.ideas'` 那一段、`src/register-idea-tools.ts` |
| MCP | 同一组工具函数，stdio | 另写一套逻辑 | `packages/mcp/src/mcp.ts` |

要点：

1. **一个工具函数，三个入口。** agent 工具、MCP 工具、HTTP 接口调用的是同一个下层函数，不各写一遍。
2. **dsh 插件浏览器端不 import `@deepseek-ai/*`。** `client.js` 是手写的、无构建的 JS；宿主端用 peer 依赖 `@deepseek-ai/dsh-tools@0.2.1-rc.2`。
3. **网页嵌入时的快捷键：** 焦点在 iframe 里时 ⌘ 组合键归 dsh，网页只用单键（T17）。
4. **一个网页应用、一个本地服务。** 新模块是同一个 `packages/web` 里的新页面，不另起前端工程、不另起端口。

### 2.3 写入协议（有写操作时必须遵守）

沿用 core 已有的约定：每次写入带 `requestId`（幂等）和 `rev`（冲突检测），记录来源（`human` / `agent`）和操作历史；**先预览后写入**；agent 能做的写入范围由说明书逐项列出，不可逆操作只有人能做。

### 2.4 本地验证（永远隔离）

```bash
npm ci
npm run build
npm run check
npm test
npm run walkthrough
npm run dev:dsh
```

- `npm run dev:dsh` 在仓库内的 `.dsh-dev/`（已 gitignore）建隔离 `DSH_HOME` 和数据目录，服务开在 4311，dsh 开在 3092。**不要碰 `~/.dsh`、用户的 Desktop profile 和 `~/Library/Application Support/BluemantaDesktop/`。**
- 截图按 DESIGN.md 第 10 节：1440×900、1280×800、1024×768、720 宽，深浅色各一套，附在 PR 里。截图只用虚构数据。

---

## 3. 流程与分工

- 一个任务一个分支、一个 PR，PR 目标 `main`，描述链接任务。分支名用 Linear 的 `gitBranchName`，或 Codex 自己的前缀（如 `codex/…`）。不直接推 `main`，不自己合并。
- 开工时在任务下写一条计划；开完 PR 写结果评论：做了什么、偏离说明书之处及原因、已知问题、PR 链接。
- 只改说明书「允许修改的路径」里的文件。说明书不清楚或与 ADR 冲突时，**不要猜**：在任务里写明问题、加 `Blocked`、停下等答复。
- 开工前 `git status`；不认识的改动属于别的 session，不 stash、不还原、不删除。只用 `git add <具体文件>`。
- **并行风险：** Cursor 可能同时在做任务台（[task-desk-plan.md](task-desk-plan.md)，草案），会改 `packages/server/src/app.ts`、`packages/web/src/app/App.tsx`、`packages/web/src/shell/Sidebar.tsx`、`packages/dsh-plugin/client.js`。你的代码尽量放在**新文件**里，对这几个共享文件只加几行注册代码（挂路由、加入口），方便合并；发生冲突时在 PR 里说明，不要改动对方的逻辑。唯一的例外是 K0（第 7 节）：它专门改网页外壳，开工前确认没有别人在改 `packages/web/src/shell/`。

---

## 4. Skill 台是什么

一句话：**在一个页面里看清本机所有 skill 装在哪里、是否正常、dsh 能不能用到**，之后再逐步支持在页面里安装和修复。

为什么要做：用户同时用 Codex、Claude Code、Cursor、dsh，skill 的源头、登记表和各工具的安装目录分散在 6 个地方，现在只能靠命令行 `skill_manager.py check` 查，而且 dsh 还不在登记表里（vision「现有资产」写明「需要增加 dsh 安装目标」）。

**和灵感台是同一个网页应用。** Skill 台是 `packages/web` 里的第二个模块：同一套外壳（侧栏、页头、命令面板）、同一套组件（`packages/web/src/ui/`）、同一份 tokens.css、同一个本地服务和口令，嵌进 dsh 的方式也和灵感台一样。不另起前端工程，不引入 Tailwind 或别的样式方案。界面细节见 [skill-ui.md](specs/skill-ui.md)。

**参考原型 skill-board。** 用户早先做过一个 Skill 看板原型（`~/Documents/CodeProjects/idash/skill-board`，React + Vite + Tailwind，暗色，数据是构建时快照加演示事件）。用户已决定不原样嵌入，而是重写进本仓库。它只作为信息结构的参考，取舍见 skill-ui.md 第 8 节。**不要复制它的代码、样式、`public/agent-skill-repos.json`（里面是真实 skill 清单）和截图。**

### 4.1 本机现状（2026-10-22 核对，供理解问题，**不要写进代码或测试**）

| 位置 | 角色 | 现状 |
|---|---|---|
| `~/Documents/AgentSkillRepos/<name>/` | skill 内容的正本 | 34 个目录，少数是独立 Git 仓库 |
| `~/Documents/AgentSkills/manifest.yaml` | 登记表正本（`schema_version: 1`） | 每个 skill 一段：`visibility`、`lifecycle`、`scope`、`source`、`notes`、`install.<工具>.{path, mode, reason}`。`mode` 有 `symlink`（39 处）、`pending`（17）、`external-managed`（6）。工具键目前只有 codex、claude、cursor 等，**没有 dsh** |
| `~/Documents/AgentSkillRepos/skill-manager/scripts/skill_manager.py` | 现有的管理规则实现 | 子命令 `create`、`install`、`check`、`register-external`、`publish-check`；输出是给人看的文本 |
| `~/.codex/skills`、`~/.claude/skills`、`~/.cursor/skills` | 各工具安装目录（生成物，指向源头的软链） | 其中有 manifest 没登记的条目（例如 Codex 目录里有一个、Claude 目录里有一个） |
| `~/.agents/skills` | 多个工具共用的 agent 目录 | 50 多个外部 skill（lark、vercel、cursor 自带等），dsh 会扫到 |
| `~/.dsh/skills` | dsh 用户级 skill 目录 | 不存在 |
| `~/Documents/AgentSkills/disabled/` | 停用 skill 的软链存放处 | 按工具分 `codex/`、`claude/` 子目录，例如 `opc-workbench` |

### 4.2 dsh 怎么发现 skill（0.2.1-rc.2，来自 `skill-filesystem` README）

| rank（小者优先） | 来源 | 目录 |
|---|---|---|
| 100 | `project-dsh` | `<项目根>/.dsh/skills` |
| 200 | `project-agents` | `<项目根>/.agents/skills` |
| 300 | `custom` | 配置项 `customSkillDirs` |
| 400 | `user-dsh` | `<DSH_HOME>/skills`（默认 `~/.dsh/skills`，跳过 `.system`） |
| 500 | `user-agents` | `<DSH_AGENTS_HOME>/skills`（默认 `~/.agents/skills`） |

- 只认一层：`<根>/<name>/SKILL.md` 或 `<根>/<name>.md`；支持软链目录。
- frontmatter 必填 `name`（kebab-case `^[a-z0-9]+(?:-[a-z0-9]+)*$`）和 `description`；可选 `whenToUse`、`metadata`、`disable-model-invocation`、`user-invocable`（布尔，接受 true/false/yes/no/on/off/1/0）。不合规的 skill **会被 dsh 静默跳过**，模型看不到原因。Skill 台要把这类问题显示出来。
- 同名时 rank 小的胜出。

### 4.3 manifest 的格式（虚构样例，结构与真实文件一致）

测试和种子数据照这个结构在临时目录里生成，`<HOME>` 换成临时目录。

```yaml
schema_version: 1
updated_at: "2026-10-01"

defaults:
  new_skill_visibility: private
  new_skill_lifecycle: draft
  preferred_install_mode: symlink
  install_dirs_are_generated: true

locations:
  control_workspace: <HOME>/Documents/AgentSkills
  skill_sources_root: <HOME>/Documents/AgentSkillRepos

skills:
  demo-writer:
    display_name: Demo Writer
    visibility: private
    lifecycle: stable
    scope: global
    source: <HOME>/Documents/AgentSkillRepos/demo-writer
    notes:
      - 虚构样例。
    install:
      codex:
        path: <HOME>/.codex/skills/demo-writer
        mode: symlink
      claude:
        path: <HOME>/.claude/skills/demo-writer
        mode: symlink
      cursor:
        path: <HOME>/.cursor/skills/demo-writer
        mode: pending
        reason: Verify Cursor personal skill discovery before enabling.

  demo-retired:
    display_name: Demo Retired
    visibility: internal
    lifecycle: stable
    scope: domain
    source: <HOME>/Documents/AgentSkillRepos/demo-retired
    notes:
      - 没有 install 段：登记了但不安装到任何工具。

  demo-framework:
    display_name: Demo Framework
    visibility: external
    lifecycle: managed
    scope: framework
    source: <HOME>/Documents/AgentSkillRepos/demo-vendor/skills/demo-framework
    install:
      agents:
        path: <HOME>/.agents/skills
        mode: external-managed
```

解析时要处理的真实情况：

| 字段 | 取值与注意点 |
|---|---|
| `visibility` | `private`、`internal`、`public-candidate`、`public`、`external` |
| `lifecycle` | `draft`、`stable`、`managed`（外部托管） |
| `scope` | `global`、`domain`、`product`、`framework` |
| `install` | 可以没有；工具键除 codex、claude、cursor 外还有 `agents` 等，不要写死成三个 |
| `mode` | `symlink`、`pending`（常带 `reason`）、`external-managed` |
| `external-managed` 的 `path` | 可能指向一个装着很多 skill 的目录，而不是单个 skill，只登记不检查 |
| `source` | 可能嵌套（`<repo>/skills/<name>`），目录名不一定等于 skill 名 |
| 其他 | 顶层和每段里可能出现未知键，忽略即可，不报错 |

`skill_manager.py` 是逐行手写解析的；Skill 台用 `yaml` 包按标准 YAML 读，只读不写。

---

## 5. Skill 台的架构约定（已写入 [ADR 0008](decisions/0008-skill-desk.md)）

1. **正本不搬家。** skill 内容的正本仍是 `AgentSkillRepos`，登记表的正本仍是 `manifest.yaml`。Desktop 不把 skill 导入 SQLite、不缓存副本、不双写（硬规则 1）。Skill 台是这套文件的**查看与操作界面**。
2. **新建一个包 `packages/skills`（`@bluemanta/skills`）** 放数据与规则：读 manifest、扫描各目录、解析 frontmatter、算状态，后续的写入命令也放这里。不放进 core，因为 core 的正本是 SQLite 存储，这个模块的正本是用户目录里的文件。server、dsh-plugin、mcp 依赖它。AGENTS.md 的目录表已登记。
3. **路径全部可注入，不写死 `/Users/apple`。** 所有入口函数收一个 `SkillEnv` 对象（`home`、`manifestPath`、`dshHome`、`agentsHome`，以及各工具安装目录）。默认值：`home = os.homedir()`，`manifestPath = <home>/Documents/AgentSkills/manifest.yaml`，源头目录取 manifest 的 `locations.skill_sources_root`，`dshHome = $DSH_HOME ?? <home>/.dsh`，`agentsHome = $DSH_AGENTS_HOME ?? <home>/.agents`。本地服务另认环境变量 `BLUEMANTA_SKILL_HOME` 覆盖 `home`，供 `dev:dsh` 和走查指向虚构目录。
4. **这是只在本机的模块。** ADR 0005 决定 4 要求接口里不出现本机路径；Skill 台管的就是本机目录，路径是必要信息。约定：接口返回的路径只用于显示，`home` 前缀缩写成 `~`；接口不接受客户端传来的任意路径，只接受 skill 名和工具键，由服务端按 manifest 解析出路径。ADR 0008 把这一条记为 ADR 0005 的例外。
5. **M1 只读。** 读取不设限（硬规则 4），可以读全部 skill 正文。任何写入（建软链、改 manifest、往 `~/.dsh/skills` 放东西）都是在改用户环境（硬规则 7），留到 M2，并且 M2 的每个写操作都要先预览、再由用户在页面上确认。
6. **私人内容不进仓库。** 用户的 skill 里有 SalesOS、客户相关内容。测试、fixture、种子数据、PR 截图一律用虚构 skill（例如 `demo-writer`、`demo-broken-link`），在临时目录里现造。

---

## 6. 状态模型（M1 的核心）

对每个「skill × 目标」算一个状态。目标包括 manifest 里的工具键，加上 dsh 的两个用户目录。

| 状态 | 含义 | 判定 |
|---|---|---|
| `ok` | 正常 | manifest 写 `symlink`，安装路径是软链且指向 `source` |
| `broken` | 软链坏了 | 软链目标不存在，或指向的不是 `source` |
| `missing` | 该装没装 | manifest 写 `symlink`，路径不存在 |
| `not-link` | 被复制了 | 路径存在但不是软链（违反「安装目录是生成物」） |
| `pending` | 有意未装 | manifest 写 `pending`，显示 `reason` |
| `external` | 外部托管 | manifest 写 `external-managed`，只登记不检查 |
| `unmanaged` | 没登记 | 安装目录里有，manifest 里没有这个名字 |
| `disabled` | 已停用 | 在 `AgentSkills/disabled/` 里 |

另外两类检查：

- **内容问题**（针对每个 skill 的源头）：`source` 不存在、没有 `SKILL.md`、frontmatter 不合 dsh 规则（第 4.2 节）、frontmatter 里的 `name` 与目录名不一致。
- **dsh 视角**：按第 4.2 节的 rank 算出 dsh 实际会加载哪些 skill、来自哪个目录；同名被覆盖的列出来。M1 只算用户级（400、500）和 `customSkillDirs`；项目级（100、200）跟随 dsh 当前工作区，不算。

`dsh` 还不是 manifest 的工具键。M1 里 dsh 只作为「视角」显示，不作为安装目标；是否加 `dsh` 键到 M2 再定（第 9 节）。

---

## 7. 分期与任务

### M1：只读，能一眼看清（5 个任务：K0 与 K1 可同时做，然后 K2 → K3 → K4）

**为什么有 K0：** 网页外壳现在是按「只有灵感台」写的。`Sidebar.tsx` 只有灵感台一个入口，并直接读灵感列表；`Header.tsx` 的分段和搜索绑定灵感状态；`ideas/hotkeys.tsx` 是全局挂载的，`N` 在任何页面都会打开记灵感；`App.tsx` 的 Provider 和兜底路由也只认 `/ideas`。第二个模块进来之前，要先把外壳改成能放多个模块。任务台（[task-desk-plan.md](task-desk-plan.md) 的 T21）也需要这一步，所以 **K0 必须在任何别的模块改外壳之前合并**，由 Claude Code 协调先后。

Linear：K0 IFM-293、K1 IFM-292、K2 IFM-294、K3 IFM-295、K4 IFM-296。说明书以 Linear issue 为准，下表是摘要。

| 任务 | 内容 | 允许修改 | 验收级别 |
|---|---|---|---|
| K0 | 网页外壳支持多个模块，**灵感台的外观和行为不变**：侧栏的模块列表改为配置（每项：名称、图标、路径前缀、可选计数），按当前路径标 `aria-current`；页头接收模块名和分段配置，灵感台专属的搜索与「记一条」由灵感台自己传入；灵感台快捷键只在 `/ideas*` 下生效；命令面板的命令按模块注册，加上模块间跳转；`/` 仍跳 `/ideas`。灵感台现有 vitest 和 Playwright 走查全部通过，截图与改动前一致 | `packages/web/src/shell/**`、`packages/web/src/app/App.tsx`、`packages/web/src/ideas/hotkeys.tsx`、`packages/web/src/ideas/CommandPalette.tsx` 及其直接依赖、对应测试 | 独立（改动面大，影响已在用的灵感台） |
| K1 | 新建 `packages/skills`：`SkillEnv`、读 manifest（新增依赖 `yaml`，只读，不回写）、扫描目录、frontmatter 校验、第 6 节状态与 dsh 视角。导出 `listSkills(env)`、`getSkill(env, name)`（含 `SKILL.md` 正文和目录文件列表）、`listIssues(env)`。vitest 在临时目录里现造 manifest 和软链，覆盖第 6 节每个状态 | `packages/skills/**`、根 `package.json` 与 `package-lock.json`（只加 workspace） | 独立 |
| K2 | 本地服务：`GET /api/v1/skills`、`GET /api/v1/skills/:name`、`GET /api/v1/skill-issues`（不用 `/skills/issues`，避免和名为 `issues` 的 skill 冲突）；响应类型进 `api-types.ts`；读取 `BLUEMANTA_SKILL_HOME`；manifest 不存在或解析失败时返回明确错误，不崩 | `packages/server/src/skills*.ts`（新文件）、`app.ts`（只加挂载）、`api-types.ts`、`packages/server/test/` | 独立 |
| K3 | 网页 Skill 台，按 [skill-ui.md](specs/skill-ui.md) 全文实现：清单（筛选、分组列表、详情）、矩阵、问题三页；在 K0 的模块配置里注册入口、分段和命令。复用 `packages/web/src/ui/` 和灵感台的详情卡片、列表行、提示条，不新造同类组件。种子脚本在临时目录现造虚构的 manifest、源目录和软链，覆盖第 6 节每种状态；Playwright 走查与截图（DESIGN.md 第 10 节的尺寸，深浅色） | `packages/web/src/skills/**`（新目录）、K0 留出的模块注册处（只加配置）、`packages/web/src/api/` 中新增 skills 查询、`packages/web/scripts/seed*.ts`、`packages/web/e2e/skills*.spec.ts` | 轻验收（改了接口或外壳则升为独立） |
| K4 | dsh 入口：左侧栏「Skill 台」入口（新面板 id `bluemanta.skills`，主区 iframe 指向 `/skills?embed=main`，照抄灵感台那段）；agent 只读工具 `bluemanta_skill_list`、`bluemanta_skill_get`、`bluemanta_skill_issues`；MCP 同一组工具；`dev:dsh` 把 `BLUEMANTA_SKILL_HOME` 指向虚构目录 | `packages/dsh-plugin/client.js`（只加一段）、`packages/dsh-plugin/src/` 新文件与 `index.ts` 注册、`packages/dsh-plugin/scripts/dev-dsh.mjs`、`packages/mcp/src/`、对应测试与 README | 独立 |

M1 的验收（用户试用一周）：

- 用户想知道「某个 skill 在 Codex / Claude / dsh 里能不能用」时，打开 Skill 台就能回答，不用开终端。
- Skill 台的问题列表与 `skill_manager.py check --all` 的结论一致（Claude Code 验收时对照）；多出来的只有 `unmanaged` 和 dsh 视角这两类 `check` 不管的问题。
- 在 dsh 对话里问「我有哪些 skill 装坏了」，agent 用 `bluemanta_skill_issues` 答对。

### M2 候选（M1 用过之后再定，不预先承诺）

写操作都要先预览后确认，开始前先请用户决定第 9 节的两个待定问题：修复软链（`missing` / `broken`）；把 `pending` 改为 `symlink` 并安装；给 skill 加 `dsh` 安装目标；新建 skill 草稿（等于 `skill_manager.py create`）；停用 / 恢复。

其他候选：`publish-check` 的结果显示；查看源头仓库的 Git 状态；「常用」钉选（skill-board 原型里有，偏好由 Desktop 自己存）；详情里「在对话中使用」，经消息桥把 `/<name>` 填进 dsh 输入框；真实的「最近使用」，从 dsh、Claude Code、Codex 的本机会话记录里找 skill 调用（这些记录的格式还没核实）。

---

## 8. 给 Codex 的硬约束清单

1. 不修改 `~/Documents/AgentSkills/`、`~/Documents/AgentSkillRepos/`、`~/.codex`、`~/.claude`、`~/.cursor`、`~/.agents`、`~/.dsh` 下的任何文件。M1 的代码对它们**只读**，你本人在开发中也只读。
2. 测试和走查不读真实目录：一律通过 `SkillEnv` 或 `BLUEMANTA_SKILL_HOME` 指向临时目录。CI 环境里不存在用户目录，测试必须照样能过。
3. 不写死 `/Users/apple` 或任何真实 skill 名。
4. 不把用户的 skill 名单、manifest 内容、`SKILL.md` 正文写进仓库、fixture、快照或截图。
5. 不在 dsh 插件里写业务规则和界面；不修改 `~/Developer/bluemanta-harness`。
6. 不重写 `skill_manager.py`，也不调用它的写命令。M1 只读，不需要它。
7. 新增依赖只允许 `yaml`。显示 `SKILL.md` 正文先用等宽原文；需要 Markdown 渲染库时先在任务里提出。
8. 每条验收项标 `verified` / `failed` / `not-run`，附实际命令和结果。没跑过的不写成通过。

---

## 9. 决策记录

| # | 问题 | 结论 |
|---|---|---|
| 1 | 是否原样嵌入 skill-board | 否。重写进本仓库，作为工作台第二个模块（用户 2026-10-22 决定） |
| 2 | 框架与视觉 | 与灵感台同一个网页应用、同一套外壳和设计规范（用户 2026-10-22 认可） |
| 3 | 谁来实现 | Skill 台相关任务全部交给 Codex，经 Linear 委派；Cursor 继续其余任务（用户 2026-10-22 决定，见 ADR 0008） |
| 4 | Codex 的模型 | 尽量用最高推理档；能选 fast 模式就用 fast（用户 2026-10-22 要求）。模型在 Codex 的设置里选，issue 里写明要求，结果评论报告实际使用的模型 |
| 5 | 模块名 | 「Skill 台」，路由 `/skills`，面板 id `bluemanta.skills` |

M2 开始前再请用户决定：

- 写操作用哪套规则实现。推荐由 `packages/skills` 调用现有 `skill_manager.py`（先给它加 `--json` 输出），不在 TypeScript 里再写一遍，规则只保留一份。
- dsh 是否成为 manifest 的正式安装目标。推荐新增工具键 `dsh`，软链到 `~/.dsh/skills/<name>`，新 skill 默认 `pending`。不用 `customSkillDirs` 直接指向 `AgentSkillRepos`，否则草稿和已停用的 skill 会一起暴露给 dsh。

---

## 10. Claude Code 的配套工作（不是 Codex 的任务）

1. ~~写 ADR 0008，更新 AGENTS.md 的分工与目录表~~（2026-10-22 完成）。
2. ~~把 K0–K4 建成 Linear issue~~（2026-10-22 完成）。K0、K1 先委派；K2 在 K1 合并后委派，K3 在 K0、K2 合并后委派，K4 在 K3 合并后委派。
3. 在隔离 `DSH_HOME` 里验证：`<DSH_HOME>/skills/<name>` 是软链时 dsh Desktop 0.2.1-rc.2 能否正常加载（源码文档写明支持，未实测；结果写进 `spikes/`）。M2 之前完成。
4. 和任务台的排期对齐：K0 先于任何其他改网页外壳的任务合并。
