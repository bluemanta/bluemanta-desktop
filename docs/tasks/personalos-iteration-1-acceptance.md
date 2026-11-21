# PersonalOS 看板 · 迭代 1 验收记录与返工单

- 验收：Claude Code，2026-11-21
- 被验收：`codex/personalos-desk` 上的 P1 `2cc750f`、P2 `bf79f88`、P3 `9178183`、P4 `00f7e02`（起点 `b46e411`）
- 结论：**有条件通过**。四个任务的实现符合说明书，构建、测试和截图都没问题；返工 R1–R3 做完并复验后，再做真实 PersonalOS 只读试跑。

## 1. 验收记录

| 项 | 结果 | 命令与结果 |
|---|---|---|
| 提交与改动路径 | verified | `git log main..HEAD`：4 笔任务提交，顺序 P1→P4。逐笔 `git show --stat`：改动都在各任务「允许修改的路径」内。工作区唯一未提交的是 Codex 留下的 P4 SHA 补记（一行）。 |
| 结果文件 | verified | 每个任务都有：偏离说明、逐条 verified/failed/not-run、提交 SHA。走查 not-run 的原因如实写明（缺 Chromium 1248）。 |
| 构建、类型、单测 | verified | fixture 环境（`BLUEMANTA_KNOWLEDGE_HOME`、`BLUEMANTA_SKILL_HOME` 指向 fixture home，`BLUEMANTA_TODAY=2026-11-21`）下 `npm run build && npm run check && npm test` 退出 0；各 workspace 合计 418 项通过（core 57、knowledge 79、server 102、web 56、dsh 73、skills 24、cli 18、mcp 5、importer 4）。 |
| 隐私与只读 | verified | `git grep` 在 fixture 与 PersonalOS 走查用例里查 `/Users/`、真实人名、公司与项目名：0 命中。新增代码里没有写文件、建目录、改名、删除或拉起子进程的调用，没有写死的绝对路径。 |
| 浏览器走查 | **failed（2/165）** | 本机缓存只有 Chromium 1217，Playwright 1.64 要 1248。验收时用临时配置改走本机 Google Chrome（`channel: 'chrome'`，不下载）跑全量：163 通过，2 失败，都在 `personalos-p4.spec.ts`（第 47、105 行）。原因见 R2：是测试辅助函数的问题，不是产品问题；改成先导航到 `about:blank` 再打开后，P4 全部 12 条通过。 |
| 截图 | verified | 上面那次走查生成了 30 张截图，在 `packages/web/screenshots/personalos-*.png`，不提交。抽看了今天页（1440 浅、720 深）、领域详情（1440 深，含两张挂接卡片和「未核验」高亮）、动态页（1440 浅，小节已展开），布局、配色和规格一致。 |
| 真实日志格式 | **failed** | 只读查看了真实 `日志/2026-11.md` 的标题和条目分布，没有改动它：`##` 交付说明后面还会继续追加 `- 日期 [领域] …` 条目，有的条目夹在小节的列表中间；方括号里也有不是领域名的标签（如蓝图、阶段号）。现在的解析把小节标题之后的所有行都算进小节，所以真实数据上动态页几乎看不到独立条目。规格 1.7 原来没写边界，是规格的缺口，已在本次补上（见 R1）。 |
| 真实 PersonalOS 只读试跑 | not-run | 需要 Chris 同意，放在返工复验之后。 |

## 2. 返工单（Codex 执行）

工作方式与 [迭代 1 说明书](personalos-iteration-1.md) 的「交付方式」「通用约束」相同：只在 `~/Developer/bm-pos` 工作，按 R1→R2→R3 顺序，每项一笔本地提交（提交说明以 `R1`、`R2`、`R3` 开头），只 `git add` 具体文件；不 push、不开 PR、不改写已有提交、不加依赖、不下载浏览器。

开工前先把工作区里 P4 SHA 补记那一行随 R1 一起提交。各项结果追加到 `docs/tasks/personalos-iteration-1-report.md` 的新一节「返工」。

### R1 日志条目与小节的边界，以及非领域标签

依据：规格 1.7 新增的两条（「条目和小节的边界」「条目的方括号标签」）和第 9 节新增的「日志边界」fixture 要求。

1. `parseLog`：不缩进的 `- YYYY-MM-DD …` 行一律解析为条目，不论出现在哪个小节下面，并且不计入小节正文。小节正文是标题到下一个 `##`/`###` 标题之间、去掉这些条目后的内容。
2. 条目的 `[…]` 只在和路由表领域名（含「我」）一致时才填 `domain`；不一致时 `domain` 为空，原文进新增字段 `tag`。接口类型在 `api-types.ts` 增加可选 `tag`。
3. 动态页：`tag` 显示为灰色标签；领域筛选增加「未归领域」选项，包含 `domain` 为空的条目和小节。
4. fixture：按第 9 节新增要求补日志内容。更新受影响的单测、接口测试和走查用例的期望数字。

允许修改：`packages/knowledge/src/**`、`packages/knowledge/test/**`、`packages/knowledge/fixtures/home/Documents/PersonalOS/日志/**`、`packages/server/src/**`（只为类型和日志接口）、`packages/server/test/**`、`packages/web/src/knowledge/**`、`packages/web/e2e/**`、结果文件。

### R2 走查辅助函数的同页导航

现象：`personalos-p4.spec.ts` 的 `open()` 在同一个用例里第二次打开同一路径时，因为网页启动后会把地址栏里的 `#token=…` 去掉，第二次 `page.goto` 只是同一文档内的锚点跳转，页面不重新加载，上一次的筛选状态还在。第 47 行用例因此得到 0 行（期望 2），第 105 行用例找不到「加载更早」而超时。

改法：让辅助函数每次都真正重新加载，例如先 `page.goto('about:blank')`。顺手检查 `personalos.spec.ts`、`personalos-screenshots.spec.ts` 里有没有同样的写法。不改产品代码。

允许修改：`packages/web/e2e/**`、结果文件。

### R3 走查可以用本机 Chrome

背景：本机 Playwright 浏览器缓存的版本和 `@playwright/test` 1.64 不匹配，主仓库的走查也受影响。不下载浏览器，改为允许用环境变量选本机 Chrome。

1. `packages/web/e2e/playwright.config.ts`：读环境变量 `BLUEMANTA_PW_CHANNEL`，有值时作为 `use.channel`（例如 `chrome`），没有时行为不变。
2. `packages/web/README.md` 的走查说明加一行用法。
3. 用 `BLUEMANTA_PW_CHANNEL=chrome npm run walkthrough` 跑全量走查，结果写进结果文件（期望全部通过）。

允许修改：`packages/web/e2e/playwright.config.ts`、`packages/web/README.md`、结果文件。

## 3. 返工后的验收（Claude Code）

1. 复核 R1–R3 的提交和路径；重跑构建、测试和全量走查（`BLUEMANTA_PW_CHANNEL=chrome`）。
2. 经 Chris 同意后，用真实 PersonalOS 只读试跑：今天页与晨间简报一致；任选三个领域核对详情；动态页条目数与日志条目数一致；前后 PersonalOS 的 Git 工作区和提交不变。
