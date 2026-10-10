# 阶段 1 计划：core 与灵感清单

- 日期：2026-10-10
- 目标：日常记录和回看灵感都在 Desktop 里完成，不再打开 workbench。
- 范围：core（领域、项目、任务、卡片、关联、写入规则、存储）、灵感卡片、导入 workbench 冻结数据中的灵感和档案、dsh 插件中的灵感清单面板、agent 读写灵感的工具。内容线、场景卡留到阶段 2。
- 实现：Cursor；验收与合并：Claude Code（ADR 0004）。

## 任务

按顺序串行，前一个合并后再开下一个。

| # | 任务 | 依赖 | 要点 |
|---|---|---|---|
| T1 | 工程骨架与 core 数据层 | — | npm workspaces + TypeScript；`node:sqlite` 存储；对象模型第 2、3、6、7 节；写入命令框架；项目、任务、卡片、关联的基础命令；CI |
| T2 | dsh 插件外壳与数据通道 | T1 | `bluemanta` 插件包：宿主端挂载 core，浏览器端左侧栏「灵感清单」面板；数据通道复用 dsh 的鉴权（S1 遗留问题）；本地构建、安装到 Desktop、更新的脚本 |
| T3 | 灵感卡片规则 | T1 | 按 [`docs/specs/idea-rules.md`](specs/idea-rules.md)：标题兜底、原始输入、自动分类、回收站约束、收藏、追记、搜索；外加 T2 遗留的两处修复 |
| T4 | 导入 workbench 数据 | T3 | 灵感（含原 id 映射、追记、附件文件、收藏）、5 个成长/项目档案；**增量、可重复执行**：已导入的跳过，只导新增；只读来源，不改动 workbench |
| T5 | 灵感台正式版 | T2、T3 | 左侧栏一个入口「灵感台」，主区内二级菜单（灵感清单、数据统计、回收站；选题等阶段 2 再加）；列表、搜索、分类与收藏筛选、详情、新增、编辑、追记、贴图、回收站、频率热力图；交互沿用灵感台，视觉跟随 dsh。规格见 `docs/specs/idea-ui.md` |
| T6 | agent 灵感工具 | T3 | dsh 中可用的工具：记录灵感、查找灵感；与界面共用 core 命令。agent 不能追记、收藏、彻底删除（灵感台已有规则，见 `docs/specs/idea-rules.md`） |
| T7 | 本机灵感命令与 MCP 服务 | T6 | 供 Grok Bot 等本机 agent 写入 Desktop 的命令行（JSON 从标准输入读，不落临时文件，语义对齐 workbench `module-submit`），以及供 Claude Code / Codex 使用的 MCP 服务；均复用 T6 的工具函数 |

阶段 1 收尾（T7 合并后）：

1. 最后执行一次 T4 增量导入。
2. 把 Grok Bot 的写入命令从 workbench 的 `backend.py module-submit` 换成 T7 的命令。Grok Bot 的指令由用户在 Grok Bot 中更新，Claude Code 提供替换文本。
3. 让 Grok Bot 写一条测试灵感，确认出现在 Desktop 灵感台。
4. workbench 从此只读；`opc-workbench` skill 停用或改为只读（待用户确认）。
5. 用户在 Desktop 中试用，决定是否进入阶段 2。

在此之前，workbench 继续作为灵感收件箱，用户记灵感的方式不变。

## 已定的技术约束

- **存储用 Node 内置的 `node:sqlite`，不用原生扩展。** 已验证 DeepSeek Harness Desktop（Electron 44 / Node 24.18.1）和命令行 Node 24.13 都可用，dsh 自身也用它。原生扩展（如 better-sqlite3）在 Electron 中有 ABI 不匹配的风险。
- **用户数据目录：** 默认 `~/Library/Application Support/BluemantaDesktop/`，可配置；仓库和测试都不碰真实数据。
