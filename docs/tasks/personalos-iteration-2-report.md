# PersonalOS 看板 · 迭代 2 结果

## 准备

verified — `git status --short --branch` 和 `git diff -- docs/tasks/personalos-iteration-1-report.md` 确认分支正确、仅有 R3 SHA 补记。以具体路径暂存并单独提交，`git commit -m 'docs: 补记 R3 提交 SHA'` 成功（`b50783e`）。

## P5a · 停在接口行为确认

已核对任务说明书和规格 12.1、12.2、12.5。隐藏路径必须从所有文件列表、未存档改动和差异中移除。改名又要求识别为 R 并展示旧、新路径。文件跨隐藏目录边界移动时，说明书没有规定可见的一侧如何计数和展示。

verified — 通过 `python3` 在 TemporaryDirectory 中用 `git init --separate-git-dir=<副本>/.gitdata.nosync <副本>` 创建独立的虚构仓库，禁用系统和用户 Git 配置，固定虚构作者和日期。把同一文件从 `.claude/草稿.md` 改名为 `领域/写作/纸环.md`，分别提交改名前后两个状态。运行 `git -c core.quotepath=false show --no-ext-diff --no-textconv --format= --name-status -z -M HEAD`，得到三个字段 R100、隐藏旧路径、可见新路径。运行 `git -c core.quotepath=false show --no-ext-diff --no-textconv --format= -M -U3 HEAD`，差异头及 rename from 行均含隐藏旧路径。命令全部退出 0，临时仓库已随上下文清理。

建议按可见路径处理：隐藏 → 可见按 A，可见 → 隐藏按 D，文件计数与领域归属取可见端，增删行数与差异也按该端的新增或删除计算。两端都可见时保留 R，两端都隐藏时过滤。相同规则用于已提交与未存档的改名。这一选择影响接口返回、领域筛选和展示，待确认。

偏离与已知问题：按说明书停在 P5a，尚未修改产品代码。P5a 提交 SHA：无。

| 验收项 | 状态 | 实际结果 |
|---|---|---|
| 1 fixture 构建、类型检查及全仓测试 | not-run | 未执行本任务的 `npm run build && npm run check && npm test`。 |
| 2 覆盖 12.7 并列出测试名 | not-run | 仅完成上述独立 Git 行为复现，未编写任务测试。 |
| 3 临时服务两个接口的 curl 验证 | not-run | 接口尚未实现。 |
| 4 git grep 核对产品命令白名单 | not-run | 尚无新增产品代码。 |

P5b、P6 未开始，无任务提交。迭代 2 的 Chrome 全量走查 not-run，无通过数。

## P5a · 完成（规格答复 47a39cb 后续）

已实现可复用的临时历史生成脚本、PersonalOS Git 读取模块、提交列表和详情接口。跨边界改名按可见端重新读取增删统计与差异。所有 Git 调用使用 execFile，接口复用 Host 和口令校验。偏离：无。已知限制：单次 Git 输出超过规格的 8 MB 时返回 git_error。

| 验收 | 结果与命令 |
|---|---|
| 构建、类型、单测 | verified。按说明书设置两个 fixture home 和固定日期，运行 `npm run build && npm run check && npm test` 退出 0。core 57、knowledge 86、cli 18、dsh 73、importer 4、mcp 5、server 104、skills 24、web 56，另有 PR 检查器 15 项。 |
| 12.7 映射 | verified。上述命令运行 personalos-git.test.ts。「跨月、单领域、领域加日志、三个领域、正文与普通标签」覆盖 34 笔跨月提交、路径归属及标题正文。「中文改名、删除、隐藏及跨边界的完整差异」覆盖中文原文、删除、四种改名、两笔未存档改动。「二进制无正文、单文件500行及每笔3000行」覆盖二进制和七个大文件。「忽略父仓库、找不到git及非零退出」验证三个降级原因。 |
| 接口与只读 | verified。同一全仓命令中 server 的「Git 接口鉴权、缺库、无仓库、分页筛选、隐藏路径与逐文件只读」通过。比较临时 Git 目录内全部文件的 SHA-256 及路径。 |
| curl 实测 | verified。用 createGitFixture 在临时 home 建库，startServer 使用另一临时 dataDir，`curl -fsS -H 'Authorization: Bearer …' …/api/v1/personalos/git/commits` 返回 30 笔、hasMore=true、未存档 2 个。再调同路径 /:sha，返回「[技术] 导入七组观测」、7 个文件、差异共 3000 行。 |
| 产品 Git 调用 | verified。`git grep --untracked -nE "type Command|run\\('|sha \\? 'show'" -- packages/knowledge/src/personalos/git.ts` 核对唯一执行入口的命令类型及调用点，仅有 rev-parse、log、show、status。 |
