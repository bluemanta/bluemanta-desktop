# PersonalOS 看板 · 迭代 2 验收记录

- 验收：Claude Code，2026-11-22
- 被验收：`codex/personalos-desk` 上的 P5a `ae7cb60`、P5b `1f1a0fd`、P6 `026f930`（起点 `47a39cb`）。验收中由 Claude Code 补了一笔 `fd11839`。
- 2026-11-22 起 Chris 决定不再把任务派给 Codex，后续开发由 Claude Code 接手。
- 结论：**fixture 上验收通过**。真实 PersonalOS 只读试跑需要 Chris 同意，还没有做（见第 3 节）。

## 1. 验收记录

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 提交与改动路径 | verified | `git show --stat` 逐笔核对：P5a、P5b、P6 各一笔，改动都在说明书「允许修改的路径」内。工作区唯一未提交的是 Codex 留下的 P6 SHA 补记，随本记录提交。 |
| Git 读取代码 | verified | 读了 `packages/knowledge/src/personalos/git.ts` 全文：只调用 `rev-parse`、`log`、`show`、`status` 四个子命令。用 `execFile` 调用，不经 shell。固定参数和环境变量符合 12.1，另外还屏蔽了用户的全局和系统 Git 配置，比规格要求更严。提交号经正则校验。父目录的仓库通过 toplevel 核对挡掉。跨隐藏边界的改名按 47a39cb 的答复处理。 |
| 监听与刷新代码 | verified | 读了 `version.ts`、服务端接线和 `PersonalOsRefresh.tsx`：首次请求时才开始监听，服务关闭时释放。隐藏路径以及 git 的 `index`、`objects` 被忽略。网页每 5 秒查一次版本，按 `version` 和 `gitVersion` 分别让对应查询失效。小问题（不阻塞）：每次退回 poll 时，`version` 会多加一次，只多刷新一次。 |
| 构建、类型、单测 | verified | fixture 环境下运行 `npm run build && npm run check && npm test`，退出 0。各 workspace 合计 430 项通过：core 57、knowledge 88、cli 18、dsh 73、importer 4、mcp 5、server 105、skills 24、web 56。 |
| 全量走查 | verified | `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough`：179 passed。补丁后重跑，仍是 179 passed，其中包含新加的两条断言。 |
| 截图 | verified，有补丁 | 抽看了提交详情（1440 浅色）和领域「提交」页签（720 深色）。发现两处显示问题，已修正：① 提交详情的时间显示成 ISO 原文 `2026-11-22T02:00:00Z`，改成 `2026-11-22 02:00`（按提交者自己的时区）；② 领域「提交」页签的行没有日期分组，却只显示 `02:00`，改成 `11-15 02:00`。走查里加了对应断言（`fd11839`）。 |
| 临时副本实测 | verified | 用 `createGitFixture` 在临时目录建 home，`cli.js start --port 4392` 起服务。结果：<br>• 提交列表 `limit=5` 返回 5 笔，`hasMore` 为 true，未存档改动 2 个，领域归属正确；<br>• 最新一笔的详情有 7 个文件，差异合计 3000 行，正好是上限；<br>• 非法提交号返回 400，没有口令返回 401；<br>• `limit=100` 的返回里没有 `.claude`、`.gitdata` 路径；<br>• 改一个文件后，`/version` 从 `…-0` 变成 `…-1`，`gitVersion` 不变，`mode` 是 `watch`；<br>• 调用前后，`.gitdata.nosync` 里所有文件的 SHA-256 汇总值相同。<br>服务已停，临时目录已删。开机自启的 4310 服务没有动。 |
| 真实 PersonalOS 只读试跑 | not-run | 需要 Chris 同意。 |

## 2. 已知问题（不阻塞）

- 构建时 Vite 提示网页包超过 500 kB，迭代 1 就有。
- 每次读提交列表都要读全部历史，再在内存里筛选和分页。真实库现在约 25 笔提交，没有影响。提交到上千笔时，再改成用 git 分页。

## 3. 真实只读试跑（待 Chris 同意）

做法同迭代 1：临时数据目录和端口，不设 `BLUEMANTA_KNOWLEDGE_HOME`，所以服务读真实目录。核对内容：

1. 提交笔数、每笔的领域归属和文件数，与独立运行的 `git log --name-status` 一致；
2. 抽 3 笔提交，核对差异；
3. 未存档改动与 `git status` 一致；
4. 试跑前后，HEAD、`status`，以及**包括 `.gitdata.nosync` 在内**所有文件的 SHA-256 都不变。

自动刷新只用临时副本验证，不在真实目录里改文件。
