# PersonalOS 看板 · 关于页说明书

- 实现与自查：Claude Code（做法同 [ADR 0012](../decisions/0012-personalos-desk-claude-implements.md)）
- 规则：[specs/personalos-ui.md](../specs/personalos-ui.md) 第 15 节
- 来由：2026-11-27 Chris 要求在「搜索」后加「关于」页，可视化显示 PersonalOS 当前的逻辑架构：入口和关键文件、领域和目录、接入的数据源，以及「关于」的版本和更新日期。版本信息放在 PersonalOS 的 `我/关于.md`，只记更新记录，不记阶段；版本号由 agent 在每次升级关于页时递增。
- 分支：从 `main` 新开 `claude/personalos-about`，在本机 worktree `~/Developer/bm-pos` 开发；开 PR 按 AGENTS.md 的 2026-10-24 授权执行，合并由 Chris 决定

## 任务

| 编号 | 内容 | 允许修改的路径 |
|---|---|---|
| A0 | PersonalOS 侧：新建 `我/关于.md`（更新记录 v1.0），`README.md`「使用入口」加一行链接，按 PersonalOS 协议写日志并提交。**先给 Chris 看内容，同意后再写**；开工前先看 PersonalOS 的 `git status`，别人未存档的改动不碰 | `~/Documents/PersonalOS/` 下的上述文件 |
| A1 | 数据层：架构汇总、更新记录解析；fixture 和单测 | `packages/knowledge/src/personalos/**`、`packages/knowledge/fixtures/**`、`packages/knowledge/test/**` |
| A2 | 接口：`GET /api/v1/personalos/about`；接口测试 | `packages/server/src/**`、`packages/server/test/**` |
| A3 | 网页：「关于」分段、架构图、目录结构、更新记录；走查和截图 | `packages/web/src/**`、`packages/web/e2e/**` |
| A4 | 真实环境只读核对（A0 完成后），写验收记录 | 本文件 |

## 验收项

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 构建、类型、单测 | verified | `env -u BLUEMANTA_TODAY -u BLUEMANTA_KNOWLEDGE_HOME sh -c 'npm run build && npm run check && npm test'` 全部退出 0，单测合计 506 项。新增：数据层 10 项（UTC、纽约、本机上海三个时区都通过），接口 3 项；路由单测加了 2 条断言。加了虚构 `我/关于.md` 后，原有单测全部照常通过。 |
| 走查 | verified | `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough`，一次运行 203 项全部通过，含关于页新用例 9 条（分段第 7 项、页头版本、三层架构、更新记录、点文件开阅读器和 Esc 回焦、点领域、命令面板、接了数据源的计数和跳转、两种空状态、720 宽无溢出、四张截图）；原「六个分段」断言改为七个。 |
| 截图 | verified | `packages/web/screenshots/personalos-about-{1440,720}-{light,dark}.png`，不提交。抽看 1440 浅色和 720 深色：三层架构、记录列、目录树、更新记录都清楚，720 宽改为单列、没有横向溢出。抽看时发现两处，已修：`CLAUDE.md` 被「转到 AGENTS.md」标签挤成省略号，改为标签写「转向」、正文写「转到 AGENTS.md」；页头「数据读取于」显示「—」，因为读取时间不认识关于页的查询，接入页也有同样问题，一并修好。 |
| 只读 | verified | 单测「只读」一项：读取前后 fixture 副本的文件哈希和修改时间不变。`about()` 只用 PersonalOS 内的读文件和列目录；数据源登记表用空的 `stat` 解析，不碰外部路径；没有子进程。 |
| 真实环境核对 | verified | 2026-11-27 经 Chris 同意，只读，见下面两节 |
| 交付检查 | not-run | |

## A0 记录（2026-11-27）

Chris 先看过草稿，同意后才写入。PersonalOS 提交只含三个文件：新建 `我/关于.md`（说明、维护规则和更新记录表，v1.0）、`README.md`「使用入口」加一行、`日志/2026-11.md` 追加一行。工作区里本来就有两处别人没提交的改动（收件箱和 v0.4 输入稿），没有动。

## A4 真实环境只读核对（2026-11-27）

做法：用构建好的数据层直接调用 `about()`，读本机真实 PersonalOS（不设 `BLUEMANTA_TODAY` 和 `BLUEMANTA_KNOWLEDGE_HOME`）。调用前后各做一次快照：HEAD、`git status --porcelain`（`GIT_OPTIONAL_LOCKS=0`）、工作区和 `.gitdata.nosync` 全部文件的 SHA-256，两次完全一致。仓库是公开的，下面只写计数，不写内容。

| 项 | 结果 |
|---|---|
| 版本 | 当前版本 v1.0，日期 2026-11-27，共 1 行更新记录 |
| 入口 | 6 个：README.md 标「路由表」，AGENTS.md 标「协作规则」，CLAUDE.md 标「转向」，3 个协议；标题和摘要都读到了 |
| 领域 | 9 个，全部已登记、目录都在 |
| 接入 | 2 个来源（1 个副本型带 1 个刷新任务，1 个查询型）；14 个后台任务（launchd 8、Codex 6），登记为「忽略」的 1 个没有计入，和登记表一致 |
| 记录 | 收件箱 3 条；日志 1 个月；蓝图 4 份，都读到了日期 |
| 读取提示 | 无 |

没跑网页对真实数据的截图：页面结构走查已经覆盖，真实截图里会有私人内容。合并、重启本机服务后，Chris 打开页面看一眼就行。

## 返工 R1：页面不能向下滚动（2026-11-27）

Chris 上线后发现关于页不能向下滚动。原因：其他页面都有带 `overflow-y: auto` 的内层滚动容器，关于页的 `.page` 没加，超出窗口的内容被外层裁掉。之前截图用的是 1800 高的窗口，走查也没有测滚动，所以没发现。

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 修复 | verified | `.page` 加 `overflow-y: auto`，子块不压缩（`flex: none`）|
| 新走查 | verified | 「内容比窗口高时页面能滚动到底部的更新记录」：1440×700 下更新记录一开始不在视口里，滚轮后进入视口、`scrollTop` 大于 0。修复前运行失败（`overflowY` 不是 `auto`），修复后通过 |
| 走查 | verified | `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough`：203 项通过，1 项失败，是接入页「定时任务段」用例，S1 记录过它在全量并发下偶发失败；单独运行接入页走查两次，8 项都通过 |
