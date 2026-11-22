# PersonalOS 看板 · 迭代 1 任务说明书（P1–P4）

- 负责实现：Codex（本机）
- 负责验收：Claude Code
- 关联：[ADR 0011](../decisions/0011-personalos-desk.md)、[界面规格](../specs/personalos-ui.md)、[迭代方案](../personalos-desk-plan.md)
- 本轮不经 Linear（ADR 0011 决定 9）。本文件代替 issue 描述；AGENTS.md 里「开工在 issue 写计划评论、移动 issue 状态」的要求本轮不适用，改为下面「交付方式」。

## 交付方式（四个任务共用）

- **工作目录**：`~/Developer/bm-pos`，分支 `codex/personalos-desk`（已建好，本文件就在这个分支上）。
- **不要**在 `~/Developer/bluemanta-desktop` 里改文件、切分支、构建或安装依赖：dsh Desktop 从那里加载插件，开机自启的本地服务托管那里的网页构建产物。
- 按 P1 → P2 → P3 → P4 的顺序做。**每个任务完成并自查后做一次本地提交**，提交说明以任务编号开头，如 `P1 PersonalOS 解析`。只 `git add` 本任务的文件，不用 `git add -A`、`git add .`。
- **不要** push、不要开 PR、不要合并、不要改写已有提交。
- 每个任务做完，在 `docs/tasks/personalos-iteration-1-report.md` 追加一节结果（新建该文件，随 P1 提交，后续任务追加）：做了什么、偏离说明书之处及原因、已知问题、本任务的验收项逐条标 `verified` / `failed` / `not-run` 并附实际命令和结果摘要、提交 SHA。没跑过的不能写成通过。
- 说明书不清楚或与 ADR、规格冲突时，不要猜：把问题写进结果文件，停在当前任务，不继续后面的任务。
- 遇到必须修改「允许修改的路径」以外的文件，同样写明原因并停下。

## 通用约束

- 必读：`AGENTS.md`、`docs/decisions/0009-knowledge-desk.md`、`docs/decisions/0011-personalos-desk.md`、`docs/specs/personalos-ui.md`（全文）、`docs/specs/knowledge-ui.md`、`docs/design/DESIGN.md`。
- **不读、不写真实的 `~/Documents/PersonalOS`、`~/Documents/Knowledge`、`~/Documents/Shuyun`。** 开发、测试、走查只用 fixture（`BLUEMANTA_KNOWLEDGE_HOME` 指向 `packages/knowledge/fixtures/home`）。
- fixture、测试快照、截图里只能有虚构内容（硬规则 3）。
- 不新增 npm 依赖。样式只用 `docs/design/tokens.css` 的变量，不改 `tokens.css`。
- 解析一律宽容：任何一处格式不符都不能让整个接口或整页报错（规格第 1 节）。
- 每个任务结束时 `npm run build && npm run check && npm test` 必须通过。
- Playwright：本机 `~/Library/Caches/ms-playwright` 里已有浏览器时运行 `npm run walkthrough`；版本不匹配就标 `not-run` 并说明，**不要**全局下载或升级浏览器。

---

## P1 `packages/knowledge`：PersonalOS 解析与 fixture

### 要做

1. 按规格第 9 节建虚构 fixture：`packages/knowledge/fixtures/home/Documents/PersonalOS/`。
2. 新增 PersonalOS 解析模块（建议 `packages/knowledge/src/personalos/`），从 `index.ts` 导出：
   - 路由表与「关于我」（规格 1.2），领域列表含「未登记」「目录不存在」；
   - `状态.md` 解析（1.3）：更新于、分节、空节、近期变化、去哪查的链接与挂接卡片；
   - 待办语法（1.4）：含行号、未知标签、不合法日期警告；
   - 今天分组（1.5）：纯函数，入参是待办列表、领域摘要和「今天」日期；过期领域判断；
   - 资料登记（1.6）：多表、三类位置；本机路径存在判断经可注入的 `stat` 函数（测试可替换），home 缩写成 `~`；
   - 收件箱、日志（1.7）；事项与知识文件发现（1.8）；
   - 文件读取：库内相对路径，拒绝越界和以 `.` 开头的路径段，识别 `.icloud` 占位；
   - 「今天」日期：读 `BLUEMANTA_TODAY`，没有时用本机时区的当天。
3. 库配置：`LibraryConfig` 增加 `kind: 'arsenal' | 'personalos'`。默认库变为 `personalos`（`~/Documents/PersonalOS`）、`personal`（旧 `~/Documents/Knowledge`，保留到迭代 4）、`arsenal`。现有调用方行为不变（`personal`、`arsenal` 按 Arsenal 结构解析）。
4. 单元测试（vitest）：覆盖规格第 9 节 fixture 的每一种情形，以及分组的边界（今天 + 7 天当天、今天 + 8 天、等待加到期）。

### 允许修改的路径

`packages/knowledge/src/**`、`packages/knowledge/test/**`、`packages/knowledge/fixtures/home/Documents/PersonalOS/**`、`packages/knowledge/README.md`、`docs/tasks/personalos-iteration-1-report.md`。

### 验收

1. `npm run build && npm run check && npm test` 通过。
2. 新增测试覆盖规格第 9 节逐条情形（结果文件里列出测试名与情形的对应）。
3. 用 fixture 跑一个只读脚本或测试，打印今天分组的条数，与 fixture 设计一致（已逾期 2、今天 1、未来 7 天 2、等待中按设计、无日期 5、更晚 1）。
4. `git grep` 确认 fixture 中没有真实人名、真实路径（`/Users/` 开头）和真实 PersonalOS 文字。
5. 现有 `packages/knowledge` 测试全部仍通过（Arsenal 解析行为不变）。

---

## P2 本地服务 `/api/v1/personalos*`

依赖 P1。

### 要做

1. 按规格第 8 节实现六个接口，注册到本地服务；类型写进 `packages/server/src/api-types.ts`（网页从这里取类型）。
2. 复用现有口令和 Host 校验；`cache-control: no-store`。
3. 错误：PersonalOS 不存在（概览 `exists: false`，其余 404 `library_missing`）、越界或点开头路径 400 `invalid_path`、文件不存在 404、读取失败 500。新增的错误码加进 `ApiErrorCode`。
4. 本机路径的返回一律 `~` 缩写；接口里不出现 fixture home 以外的绝对路径。
5. 接口测试：401、各错误码、六个接口在 fixture 上的形状和关键数值、`BLUEMANTA_TODAY` 生效、`.claude/`、`.DS_Store`、`.gitdata.nosync` 不出现在任何返回里。

### 允许修改的路径

`packages/server/src/**`、`packages/server/test/**`、`packages/knowledge/src/**`（只为接口需要做的小改，写明原因）、`docs/tasks/personalos-iteration-1-report.md`。

### 验收

1. `npm run build && npm run check && npm test` 通过。
2. 用 fixture 起服务（`BLUEMANTA_KNOWLEDGE_HOME=… BLUEMANTA_TODAY=2026-11-21`，数据目录用临时目录），`curl` 六个接口各一次，结果摘要写进结果文件。
3. 现有 `/api/v1/knowledge*` 接口测试全部仍通过。

---

## P3 网页：外壳、今天页、领域页

依赖 P2。

### 要做

1. 知识台模块配置（`packages/web/src/knowledge/module.ts`）：分段改为 今天 / 领域 / 资料 / 动态 / 搜索；侧栏计数改为已逾期 + 今天到期；命令面板命令按规格第 2 节。
2. 路由按规格第 2 节，含旧路径重定向。本任务里「资料」「动态」两个分段先放占位页（「下一步实现」），P4 替换。
3. 今天页（规格第 3 节）、领域网格与领域详情（第 4 节）、阅读器面包屑（4.3）、「待补充」「（推断）」「未核验」高亮、相对链接跳转。
4. 复用现有组件：详情卡片、列表行、阅读器 `Markdown.tsx`、空状态、提示条。不新造同类组件。
5. 走查与种子：`packages/web/e2e/global-setup.ts` 设置 `BLUEMANTA_TODAY=2026-11-21`；新增 `packages/web/e2e/personalos*.spec.ts` 覆盖规格第 10 节中属于今天页、领域页、嵌入、空状态、旧路径重定向的部分；改写受影响的 `knowledge.spec.ts` 用例（个人库主题页、收件箱页已移除）。`npm run dev:web` 的开发模式也把 `BLUEMANTA_KNOWLEDGE_HOME` 指向 fixture。

### 允许修改的路径

`packages/web/src/knowledge/**`、`packages/web/src/api/**`（只加查询）、`packages/web/src/ui/Icon.tsx`（只加图标）、`packages/web/scripts/**`、`packages/web/e2e/**`、`packages/web/README.md`、`docs/tasks/personalos-iteration-1-report.md`。

### 验收

1. `npm run build && npm run check && npm test` 通过；`npm run walkthrough` 通过或按通用约束标 `not-run`。
2. 截图（虚构数据，存 `packages/web/test-results` 或走查产物目录，不提交）：今天页、领域网格、领域详情（状态页签含挂接卡片），1440 与 720 宽，深浅色。结果文件里写出截图路径。
3. 设计规范第 10 节逐项自查，结果写进结果文件。
4. 灵感台、Skill 台已有走查不受影响。

---

## P4 网页：资料页、动态页、搜索切换

依赖 P3。

### 要做

1. 资料页（规格第 5 节）：资料登记合表与筛选；Arsenal 分段复用 v1 主题页（库固定 Arsenal）。
2. 动态页（规格第 6 节）：日志时间线、领域筛选、折叠小节、加载更早。
3. 搜索（规格第 7 节）：索引加入 PersonalOS 库（按 PersonalOS 结构遍历，跳过点开头的文件和目录、`.icloud` 占位），结果分组改为 PersonalOS / Arsenal / 灵感，PersonalOS 结果带领域标签和「领域 › 文件 › 小节」标题链，路由表别名和关键词加权。网页搜索不显示旧个人库；agent 工具（MCP、dsh）的行为本任务不改。
4. 索引结构有变化时提高 `INDEX_SCHEMA_VERSION`，旧索引自动重建。
5. 走查补齐规格第 10 节剩余部分（资料、动态、搜索）。

### 允许修改的路径

`packages/knowledge/src/**`、`packages/knowledge/test/**`、`packages/server/src/**`（只为搜索分组和类型）、`packages/server/test/**`、`packages/web/src/knowledge/**`、`packages/web/src/api/**`、`packages/web/e2e/**`、`docs/tasks/personalos-iteration-1-report.md`。

### 验收

1. `npm run build && npm run check && npm test` 通过；`npm run walkthrough` 通过或标 `not-run`。
2. fixture 上搜索三个词（一个只在 PersonalOS、一个只在 Arsenal、一个是路由表别名），结果分组和加权符合规格，写进结果文件。
3. MCP 与 dsh 的知识工具测试全部仍通过（行为不变）。
4. 截图：资料页（含路径不存在的行）、动态页（展开一个小节）、搜索结果，1440 宽深浅色。

---

## 迭代 1 整体验收（Claude Code 执行，Codex 不用做）

1. 逐个任务复核提交差异、允许修改的路径、结果文件中的验收记录。
2. 在 worktree 里用 fixture 重跑构建、测试、走查。
3. 经 Chris 同意后，用真实 PersonalOS 只读试跑：「今天」页与 Claude Code 新会话的晨间简报一致；任选三个领域，详情和文件内容一致；前后 PersonalOS 的 Git 工作区和提交没有变化。
