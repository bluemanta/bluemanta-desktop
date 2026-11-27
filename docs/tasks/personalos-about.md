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
| 真实环境核对 | not-run | |
| 交付检查 | not-run | |
