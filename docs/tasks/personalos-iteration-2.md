# PersonalOS 看板 · 迭代 2 任务说明书（P5a、P5b、P6）

- 负责实现：Codex（本机）
- 负责验收：Claude Code
- 关联：[ADR 0011](../decisions/0011-personalos-desk.md)、[界面规格](../specs/personalos-ui.md)（本轮看**第 12 节**）、[迭代方案](../personalos-desk-plan.md)、[迭代 1 验收记录](personalos-iteration-1-acceptance.md)
- 目标：看板「跟得上」。能看到 PersonalOS 的 Git 提交和差异；文件或提交变了，打开的页面几秒内自动更新。全程只读。
- 本轮不经 Linear（ADR 0011 决定 9）。本文件代替 issue 描述。
- 2026-11-21 答复：P5a 的停工问题（文件在隐藏目录和可见目录之间改名）已写进规格 12.1「跨隐藏边界的改名」，按 Codex 的建议执行。

## 交付方式（三个任务共用）

- **工作目录**：`~/Developer/bm-pos`，分支 `codex/personalos-desk`，接着迭代 1 的提交往下做。
- **不要**在 `~/Developer/bluemanta-desktop` 里改文件、切分支、构建或安装依赖。
- 开工前先提交工作区里你留下的 R3 SHA 补记那一行（`docs/tasks/personalos-iteration-1-report.md`），单独一笔，提交说明以 `docs:` 开头。
- 按 P5a → P5b → P6 的顺序做。**每个任务完成并自查后做一次本地提交**，提交说明以任务编号开头，如 `P5a PersonalOS Git 读取与接口`。只 `git add` 本任务的文件，不用 `git add -A`、`git add .`。
- **不要** push、开 PR、合并、改写已有提交。
- 结果写进新文件 `docs/tasks/personalos-iteration-2-report.md`，随 P5a 提交，后续任务追加。每个任务一节，写清：
  - 做了什么；
  - 偏离说明书之处及原因；
  - 已知问题；
  - 验收项逐条标 `verified` / `failed` / `not-run`，附实际命令和结果摘要；
  - 提交 SHA。

  没跑过的不能写成通过。
- 说明书不清楚，或与 ADR、规格冲突时，不要猜：把问题写进结果文件，停在当前任务。必须改「允许修改的路径」以外的文件时，同样写明原因并停下。

## 通用约束

- 必读：`AGENTS.md`、`docs/decisions/0011-personalos-desk.md`、`docs/specs/personalos-ui.md`（第 1、6、8、12 节）、`docs/design/DESIGN.md`。
- **不读、不写真实的 `~/Documents/PersonalOS`**，也不对它跑任何 git 命令。开发、测试、走查只用 fixture 和第 12.7 节在临时目录现建的 Git 历史。
- **只读**：产品代码里的 git 调用只能是第 12.1 节列的四个子命令和固定参数。代码里不得出现写文件、建目录、改名、删除的调用，`fs.watch` 和读文件除外。测试代码可以在临时目录里建仓库、写文件。
- fixture、Git 历史、测试快照、截图里只能有虚构内容（硬规则 3）。
- 不新增 npm 依赖。样式只用 `docs/design/tokens.css` 的变量，不改 `tokens.css`。
- 每个任务结束时，在 fixture 环境下运行 `npm run build && npm run check && npm test`，必须通过。fixture 环境指 `BLUEMANTA_KNOWLEDGE_HOME` 和 `BLUEMANTA_SKILL_HOME` 指向 `packages/knowledge/fixtures/home`，`BLUEMANTA_TODAY=2026-11-21`。
- 走查用 `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough`。**不要**下载或升级 Playwright 浏览器。

---

## P5a Git 读取与接口（`packages/knowledge`、`packages/server`）

### 要做

1. 建 Git 历史的脚本：按规格 12.7，把 fixture 的 `PersonalOS/` 复制到给定目录并建出历史。单测和走查共用这个脚本，所以放在 `packages/knowledge/scripts/`。
2. Git 读取模块（建议放在 `packages/knowledge/src/personalos/git.ts`），从 `index.ts` 导出。
   - 仓库定位、调用方式、隐藏路径过滤、失败处理按 12.1；
   - 提交对象和领域归属按 12.2；
   - 差异和截断按 12.3；
   - 未存档改动按 12.4；
   - git 可执行文件的路径可以注入，方便测试 `git_missing`。
3. 接口（类型写进 `packages/server/src/api-types.ts`，需要口令，`cache-control: no-store`）：

   | 方法与路径 | 返回 |
   |---|---|
   | `GET /api/v1/personalos/git/commits?domain=&unassigned=0\|1&skip=0&limit=30` | `available`、`reason?`、`commits`（提交对象，不含差异）、`hasMore`、`uncommitted` |
   | `GET /api/v1/personalos/git/commits/:sha` | `available`、`reason?`、`commit`（提交对象，`files` 每项加 `lines` 和 `truncated`）；提交号不合法返回 400 `invalid_path`，不存在返回 404 `not_found` |

   - `domain` 可多选（逗号分隔），只接受已知领域，未知领域返回 400。
   - `limit` 最大 100。
   - Git 不可用时两个接口都返回 200 和 `available: false`，PersonalOS 目录不存在时返回 404 `library_missing`。
4. 单元测试：
   - 用脚本建的历史逐条覆盖 12.7 的情形；
   - 覆盖 `no_repo`、`git_missing` 和 git 退出码非 0；
   - 父目录本身是 Git 仓库、PersonalOS 没有自己的仓库时，返回 `no_repo`，不能读到父仓库；
   - 中文路径原样返回，没有八进制转义；
   - **只读**：调用全部接口前后，临时仓库 git 目录里所有文件的 SHA-256 完全一致。
5. 接口测试：401、各错误码、`available: false` 的形状、分页、领域筛选（含「未归领域」）、隐藏路径不出现在任何返回里。

### 允许修改的路径

`packages/knowledge/src/**`、`packages/knowledge/test/**`、`packages/knowledge/scripts/**`、`packages/knowledge/package.json`（只加脚本命令，不加依赖）、`packages/server/src/**`、`packages/server/test/**`、`docs/tasks/personalos-iteration-2-report.md`。

### 验收

1. 在 fixture 环境下运行 `npm run build && npm run check && npm test`，退出 0。结果文件写出各 workspace 的测试数。
2. 结果文件列出测试名与 12.7 每种情形的对应。
3. 用脚本在临时目录建一份历史，把服务指过去（数据目录也用临时目录），用 `curl` 各调一次两个接口，结果摘要写进结果文件。
4. 用 `git grep` 查新代码，产品代码里的 git 子命令只有 `rev-parse`、`log`、`show`、`status`，结果写进结果文件。

---

## P5b 网页：提交视图（`packages/web`）

依赖 P5a。

### 要做

1. 动态页加「日志 | 提交」分段和路由（12.5），包括 `?domain=` 预选。
2. 提交列表：日期分组、行内容、领域筛选、加载更早、键盘移动、未存档改动行。
3. 提交详情卡片：元信息、正文、文件列表、差异渲染与折叠、截断提示、打开当前版本。
4. 领域详情加「提交」页签：最近 10 笔，加「在动态页查看全部」。
5. Git 不可用的三种说明。
6. 复用现有组件：详情卡片、列表行、日期分组标题、筛选胶囊、空状态、提示条。差异块如果没有现成组件，新建一个，放在 `packages/web/src/knowledge/` 下。
7. 走查：
   - 走查的 home 默认是仓库里的 fixture，没有 Git 历史；提交视图的用例改用单独起的服务，它的 home 指向 `.dev-data/` 下的 fixture 副本，用 P5a 的脚本建出 Git 历史；
   - 原有用例在没有 Git 的 fixture 上继续跑，「提交」分段显示 `no_repo` 的说明；
   - 新增 `packages/web/e2e/personalos-git.spec.ts`，覆盖：分段切换、日期分组、领域筛选（含未归领域）、加载更早、打开提交详情、差异展开和截断提示、改名和删除的显示、只改隐藏文件的提交、未存档改动、领域详情「提交」页签和跳转、`?domain=` 预选、`no_repo` 说明。

### 允许修改的路径

`packages/web/src/knowledge/**`、`packages/web/src/api/**`（只加查询）、`packages/web/src/ui/Icon.tsx`（只加图标）、`packages/web/scripts/**`、`packages/web/e2e/**`、`docs/tasks/personalos-iteration-2-report.md`。

### 验收

1. 在 fixture 环境下运行 `npm run build && npm run check && npm test`，退出 0；运行 `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough`，全部通过。结果文件写出通过数。
2. 截图（不提交）：
   - 提交列表；
   - 提交详情（含展开的差异和截断提示）；
   - 领域详情「提交」页签。

   尺寸为 1440 和 720 宽，深浅色各一张。结果文件写出截图路径。
3. 设计规范第 10 节逐项自查，结果写进结果文件。

---

## P6 自动刷新（`packages/knowledge`、`packages/server`、`packages/web`）

依赖 P5b。

### 要做

1. 服务端监听，按 12.6：
   - 第一次收到请求时开始监听，服务关闭时释放；
   - 去抖；`version` 与 `gitVersion` 分开计数；
   - 忽略 git 目录里的 `index`、`objects/**`、`*.lock`；
   - `watch` 失败时改为 `poll`，PersonalOS 目录不存在时为 `off`，目录出现后恢复监听。
   - 监听模块的时钟和 `fs.watch` 可以注入，方便测试。
2. 接口 `GET /api/v1/personalos/version`。
3. 搜索：收到变化后，下一次搜索强制刷新索引里 PersonalOS 的部分。
4. 网页，按 12.6：
   - 版本查询每 5 秒一次，页面不可见时停；
   - 按 `version` 和 `gitVersion` 分别让对应查询失效；
   - 后台重取时不闪、不丢状态；
   - 阅读器原地更新，文件被删时显示提示；
   - 页头显示「数据读取于」，悬停说明刷新方式，点击立即刷新；
   - 今天页概况行里原来的「数据读取于」去掉。
5. 单元测试：
   - 改文件、新增文件、删除文件都让 `version` 变化；
   - 改隐藏文件、git 的 `index` 或 `objects`，两个计数都不变；
   - 新提交让 `gitVersion` 变化；
   - 去抖：短时间内的多次变化只加一次；
   - `poll` 回退和 `off` 恢复；
   - 服务关闭后不再有监听句柄。
6. 走查（用 P5b 的 Git 副本服务，或另起一份副本，不要改仓库里的 fixture）：
   - 打开今天页，在副本里改一条待办的 `@due` 日期，10 秒内分组变化，页面没有闪成加载态；
   - 打开领域详情，改它的 `状态.md`，内容原地更新，当前页签和滚动位置不变；
   - 在副本里做一笔提交，「提交」分段 10 秒内出现这笔提交；
   - 阅读器打开一个文件后删除它，显示「这个文件已不存在」；
   - 页头「数据读取于」随刷新更新。

### 允许修改的路径

`packages/knowledge/src/**`、`packages/knowledge/test/**`、`packages/knowledge/scripts/**`、`packages/server/src/**`、`packages/server/test/**`、`packages/web/src/knowledge/**`、`packages/web/src/api/**`、`packages/web/scripts/**`、`packages/web/e2e/**`、`docs/tasks/personalos-iteration-2-report.md`。

### 验收

1. 在 fixture 环境下运行 `npm run build && npm run check && npm test`，退出 0；运行 `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough`，全部通过。
2. 手动核对一次：用 Git 副本起服务，用 `curl` 调 `/personalos/version`，然后改一个文件，再调一次，结果写进结果文件。两次调用的 `version` 应该不同，`mode` 应为 `watch`。
3. 灵感台、Skill 台、Arsenal 的已有走查不受影响。

---

## 迭代 2 整体验收（Claude Code 执行，Codex 不用做）

1. 逐个任务复核提交差异、允许修改的路径和结果文件。
2. 在 worktree 里用 fixture 重跑构建、测试、全量走查。
3. 经 Chris 同意后，在真实 PersonalOS 上做只读试跑：
   - 提交列表的笔数、每笔的领域归属和文件数，与独立运行的 `git log --name-status` 一致；
   - 抽 3 笔提交，核对差异；
   - 未存档改动与 `git status` 一致；
   - 自动刷新只用临时副本验证，不在真实目录里改文件；
   - 试跑前后，真实 PersonalOS 的 HEAD、`status`，以及**包括 `.gitdata.nosync` 在内**所有文件的 SHA-256 不变。
