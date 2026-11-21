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

P5a 提交 SHA：`ae7cb60f2b38627b69e215ff160e55916b42094b`。

## P5b · 网页提交视图

动态页增加日志/提交分段、日期分页、领域筛选、未存档行，支持键盘选择。详情卡片可复制提交号、展开文件差异、打开当前版本。领域页签列最近十笔，可跳转完整列表。走查单独使用 .dev-data/git-home，原有服务继续用无 Git 的 fixture。偏离：无。Vite 对大于 500 kB 的网页包给出体积提示，构建成功。

1. verified：fixture 环境 `npm run build && npm run check && npm test && BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough` 通过（427 项 workspace + 15 项 PR 检查器，首轮走查 173 项）。补充嵌入、放大、错误状态用例及差异块滚动后，网页构建、类型检查与同一全量走查再次通过，最终 **175 passed (29.9s)**。
2. verified：全量走查生成 `packages/web/screenshots/personalos-git-{list,detail,domain}-{1440,720}-{light,dark}.png` 共 12 张。抽看 720 深色详情，新增行及 500 行截断说明可见。
3. 设计规范 §10 自查如下。

| 项 | 验证 |
|---|---|
| 1 颜色、字体 | verified，检查 PersonalOsGit.module.css 和 tokens.css，使用既有颜色、行高与等宽字体变量。 |
| 2 数据状态 | verified，Chrome 走查覆盖跨领域、无记录、无命令、读取失败重试、空筛选、长差异和多标签。写操作与 legacy 原文沿用灵感台原有走查；未专测超长提交标题。 |
| 3 尺寸、主题与嵌入 | verified，上述 Chrome 全量走查覆盖四档宽度、深浅色、main/sidebar 模拟嵌入；真实 Desktop not-run。 |
| 4 键盘 | verified，J/Enter 选择并打开提交及全仓原有快捷键走查通过；全页面逐控件人工焦点走查 not-run。 |
| 5 放大 | verified，提交视图 200% 放大下检查无整页横向溢出并键盘或点击打开详情。 |
| 6 结果及截图 | verified，检查上述本地产物，未登记视觉基线。 |

P5b 提交 SHA：`1f1a0fd6815598a96a1b857ba1ff4cbaaa5069f4`。

## P6 · 自动刷新

服务按需开始监听，分开记录文件版本和 Git 版本，300 ms 去抖，监控失败后按 10 秒签名比对，库出现后恢复监听，服务关闭时释放句柄。搜索在检测到新的内容版本后对 PersonalOS 做增量索引。网页每 5 秒检查版本，保留已加载的日志窗口和阅读状态，页头展示当前主查询的读取时间并支持手动刷新。走查使用独立的 .dev-data/refresh-home，避免改变 P5b 的历史和截图。

| 验收项 | 状态、命令与结果 |
|---|---|
| 1 构建、类型与单测 | verified。任务规定的 fixture 环境中执行 `npm run build && npm run check && npm test`，退出 0。core 57、knowledge 88、cli 18、dsh 73、importer 4、mcp 5、server 105、skills 24、web 56，合计 430 项，另有 15 项 PR 检查器单测。 |
| 监听与搜索 | verified。上述测试中的 personalos-version.test.ts 验证去抖、隐藏路径、Git index/objects/lock、独立计数、poll 的增改删、off 恢复、关闭清理。server 的「版本接口需口令且 no-store，下一次搜索立即刷新 PersonalOS」使用临时副本，先查询无命中、再创建文件并检查下一次查询命中。 |
| 1 Chrome 全量走查 | verified。`BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough` 退出 0，179 passed (33.9s)。专用副本上的四条 P6 用例分别用时 5.8、5.7、5.9、5.6 秒，验证待办换组且无加载闪烁、读取时间更新、领域页签与非零滚动位置保持、新提交出现、正在阅读的文件删除后提示。 |
| 2 curl 手工核对 | verified。临时 Git 副本启动服务，以 `curl -fsS -H 'Authorization: Bearer …' http://127.0.0.1:48672/api/v1/personalos/version` 调用两次。中间向副本的 我/纸船.md 追加虚构文字。两次 mode=watch，启动标识同为 5ce33db3-a9ca-4343-8a30-018e4f01de16，version 后缀 0→1，gitVersion 后缀均为 0，changedAt 从 08:08:26.897Z 变为 08:08:27.222Z。 |
| 3 既有模块回归 | verified，以上全量运行覆盖已有灵感台、Arsenal 与外壳走查；Skill 包 24 项单测及 server 的 4 项 Skill API 测试通过。not-run：仓库无 Skill 台专属浏览器用例。 |

过程与已知问题：首次单测发现无遍历权限时监听器覆盖概览接口的 read_error，已修正并重跑。新增搜索测试曾因响应未声明类型以及回调类型过窄而未通过类型检查，已修正。最终检查无剩余失败。无范围偏离。与 P5b 相同，构建仍有 Vite 包体积提示。真实 PersonalOS 试跑属于整体验收方，本轮 not-run。
